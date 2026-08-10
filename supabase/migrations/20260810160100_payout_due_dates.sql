-- Build 12 (part 2 of 2) — payout due dates + overdue reminders.
-- ============================================================================
-- When the owner APPROVES a partner/contractor invoice, a due date is stamped
-- (approval date + 7 business days, the outer bound of the CONTRACTOR 5–7
-- business-day payment window). A daily pg_cron sweep flags approved-but-unpaid
-- invoices past their due date, notifying the owner ONCE per invoice (dedup
-- ledger). "Overdue" is a DERIVED condition — partner/contractor invoices have
-- no 'overdue' state enum (unlike funder invoices), so nothing changes state.
--
-- Due date is set by a BEFORE-UPDATE trigger, NOT by editing the audited approve
-- RPCs (owner_approve_invoice / owner_approve_contractor_invoice) — keeps the
-- money-path RPCs untouched. Both invoice tables are populated only by their
-- RPCs and are empty today, so the new column is metadata-only.
--
-- Depends on 20260810160000_payout_overdue_event (PAYOUT_OVERDUE enum value).
-- ============================================================================

-- ===========================================================================
-- 1. due_date column on both invoice tables (nullable — set on approval).
-- ===========================================================================
alter table public.partner_invoices    add column if not exists due_date date;
alter table public.contractor_invoices add column if not exists due_date date;

-- ===========================================================================
-- 2. Business-day helper (skips Sat/Sun; no public-holiday calendar — a
--    deliberate simplification, documented for a later refinement).
-- ===========================================================================
create or replace function public.add_business_days(p_start date, p_days int)
returns date language plpgsql immutable set search_path = '' as $$
declare d date := p_start; added int := 0;
begin
  if p_days <= 0 then return p_start; end if;
  while added < p_days loop
    d := d + 1;
    if extract(isodow from d) < 6 then  -- Mon–Fri
      added := added + 1;
    end if;
  end loop;
  return d;
end $$;
-- Helper is trigger-internal only; no API surface (mirrors current_sast_date()).
revoke all on function public.add_business_days(date, int) from public, anon;

-- ===========================================================================
-- 3. Stamp due_date on the approved transition (BEFORE UPDATE, both tables).
--    Only sets it once (when it first becomes approved and is still null), so a
--    later re-approval or edit never silently moves the clock.
-- ===========================================================================
create or replace function public.set_payout_due_date()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.state = 'approved' and old.state is distinct from 'approved' and new.due_date is null then
    new.due_date := public.add_business_days(public.current_sast_date(), 7);
  end if;
  return new;
end $$;

drop trigger if exists set_payout_due_date on public.partner_invoices;
create trigger set_payout_due_date before update on public.partner_invoices
  for each row when (old.state is distinct from new.state)
  execute function public.set_payout_due_date();

drop trigger if exists set_payout_due_date on public.contractor_invoices;
create trigger set_payout_due_date before update on public.contractor_invoices
  for each row when (old.state is distinct from new.state)
  execute function public.set_payout_due_date();

-- ===========================================================================
-- 4. Dedup ledger — one overdue alert per (payee_kind, invoice). Claim-then-act:
--    the cron inserts here first and only notifies if the insert won the row, so
--    a re-run (or concurrent run) never double-notifies.
-- ===========================================================================
create table if not exists public.payout_overdue_alerts (
  id          uuid primary key default gen_random_uuid(),
  payee_kind  text not null check (payee_kind in ('partner', 'contractor')),
  invoice_id  uuid not null,
  due_date    date not null,
  alerted_at  timestamptz not null default now(),
  unique (payee_kind, invoice_id)
);

alter table public.payout_overdue_alerts enable row level security;
drop policy if exists payout_overdue_alerts_owner_read on public.payout_overdue_alerts;
create policy payout_overdue_alerts_owner_read on public.payout_overdue_alerts
  for select to authenticated using (public.is_owner());
revoke all on public.payout_overdue_alerts from anon, authenticated;
grant select on public.payout_overdue_alerts to authenticated; -- owner-only via RLS; writes are DEFINER-only

-- ===========================================================================
-- 5. check_overdue_payouts() — daily sweep. Approved + unpaid + past due_date,
--    not yet alerted → notify the owner, record the alert. DERIVED overdue (no
--    state change). Idempotent via the ledger.
-- ===========================================================================
create or replace function public.check_overdue_payouts()
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_claimed uuid;
begin
  -- Partner invoices
  for r in
    select pi.id, pi.invoice_number, pi.due_date, pi.total_amount, rp.name as payee_name
      from public.partner_invoices pi
      left join public.referral_partners rp on rp.id = pi.referral_partner_id
     where pi.state = 'approved' and pi.due_date is not null
       and pi.due_date < public.current_sast_date()
       and not exists (select 1 from public.payout_overdue_alerts a
                        where a.payee_kind = 'partner' and a.invoice_id = pi.id)
  loop
    insert into public.payout_overdue_alerts (payee_kind, invoice_id, due_date)
      values ('partner', r.id, r.due_date)
      on conflict (payee_kind, invoice_id) do nothing
      returning id into v_claimed;
    if v_claimed is null then continue; end if;  -- lost the race; someone else notified
    perform public.emit_in_app_notification(
      public.notify_owner(), 'PAYOUT_OVERDUE', 'Partner payout overdue',
      'Invoice ' || r.invoice_number || ' to ' || coalesce(r.payee_name, 'a partner') ||
      ' — R' || trim(to_char(r.total_amount, 'FM999G999G990D00')) ||
      ' — is overdue (was due ' || to_char(r.due_date, 'DD Mon YYYY') || '). Approve payment or record the EFT.',
      '/invoices/partner-approvals', jsonb_build_object('partner_invoice_id', r.id));
  end loop;

  -- Contractor invoices
  for r in
    select ci.id, ci.invoice_number, ci.due_date, ci.total_amount, p.full_name as payee_name
      from public.contractor_invoices ci
      left join public.profiles p on p.id = ci.contractor_id
     where ci.state = 'approved' and ci.due_date is not null
       and ci.due_date < public.current_sast_date()
       and not exists (select 1 from public.payout_overdue_alerts a
                        where a.payee_kind = 'contractor' and a.invoice_id = ci.id)
  loop
    insert into public.payout_overdue_alerts (payee_kind, invoice_id, due_date)
      values ('contractor', r.id, r.due_date)
      on conflict (payee_kind, invoice_id) do nothing
      returning id into v_claimed;
    if v_claimed is null then continue; end if;
    perform public.emit_in_app_notification(
      public.notify_owner(), 'PAYOUT_OVERDUE', 'Contractor payout overdue',
      'Invoice ' || r.invoice_number || ' to ' || coalesce(r.payee_name, 'a contractor') ||
      ' — R' || trim(to_char(r.total_amount, 'FM999G999G990D00')) ||
      ' — is overdue (was due ' || to_char(r.due_date, 'DD Mon YYYY') || '). Approve payment or record the EFT.',
      '/invoices/contractor-approvals', jsonb_build_object('contractor_invoice_id', r.id));
  end loop;
end $$;
-- SECURITY DEFINER, RLS-bypassing system sweep: cron/postgres only, never an API
-- surface (mirrors check_overdue_invoices / check_followups_due / check_document_expiries).
revoke all on function public.check_overdue_payouts() from public, anon, authenticated;

-- Daily at 04:35 UTC / 06:35 SAST (after the funder overdue sweep at 04:30).
select cron.unschedule(jobid) from cron.job where jobname = 'payout-overdue-sweep';
select cron.schedule('payout-overdue-sweep', '35 4 * * *', $cron$ select public.check_overdue_payouts(); $cron$);

-- ===========================================================================
-- 6. Seed the PAYOUT_OVERDUE preference ON for every profile (owner-relevant;
--    never overwrites an existing opt-out).
-- ===========================================================================
insert into public.notification_preferences (user_id, event_type, in_app_enabled, email_enabled)
select p.id, 'PAYOUT_OVERDUE'::public.notification_event_type, true, true
  from public.profiles p
on conflict (user_id, event_type) do nothing;

-- ===========================================================================
-- 7. Assertions (structural + grant matrix; behavioural due-date stamp is
--    exercised at smoke test with a real approval).
-- ===========================================================================
do $$
begin
  if not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='partner_invoices' and column_name='due_date') then
    raise exception 'assert FAIL: partner_invoices.due_date missing'; end if;
  if not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='contractor_invoices' and column_name='due_date') then
    raise exception 'assert FAIL: contractor_invoices.due_date missing'; end if;
  if to_regprocedure('public.add_business_days(date,int)') is null then
    raise exception 'assert FAIL: add_business_days missing'; end if;
  if to_regprocedure('public.check_overdue_payouts()') is null then
    raise exception 'assert FAIL: check_overdue_payouts missing'; end if;
  if to_regclass('public.payout_overdue_alerts') is null then
    raise exception 'assert FAIL: payout_overdue_alerts ledger missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='set_payout_due_date'
      and tgrelid='public.partner_invoices'::regclass) then
    raise exception 'assert FAIL: partner set_payout_due_date trigger missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='set_payout_due_date'
      and tgrelid='public.contractor_invoices'::regclass) then
    raise exception 'assert FAIL: contractor set_payout_due_date trigger missing'; end if;
  if not exists (select 1 from cron.job where jobname='payout-overdue-sweep') then
    raise exception 'assert FAIL: payout-overdue-sweep cron not scheduled'; end if;
  -- business-day helper sanity: Fri (2026-08-14) + 1 business day = Mon 2026-08-17
  if public.add_business_days(date '2026-08-14', 1) <> date '2026-08-17' then
    raise exception 'assert FAIL: add_business_days skipped weekend wrong'; end if;
  -- grant matrix: the RLS-bypassing sweep must never be API-callable by end users.
  if has_function_privilege('authenticated', 'public.check_overdue_payouts()', 'execute') then
    raise exception 'assert FAIL: check_overdue_payouts must not be executable by authenticated'; end if;
  raise notice 'Build 12: payout due dates + overdue sweep created; asserts passed.';
end $$;
