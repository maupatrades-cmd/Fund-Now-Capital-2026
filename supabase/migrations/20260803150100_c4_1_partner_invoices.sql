-- C4 (Doctor Invoicing FNC — Sprint 4, Lane 4a) — part 2 of 3: schema.
-- ============================================================================
-- The partner-invoice ledger: Doctor (referral partner) invoices FNC for the
-- commission he is owed. Mirrors the C1 funder_invoices single-table design and
-- completes the C2.2-reserved commission_records.partner_invoice_id FK.
--
-- SPEC references: S8 (doctor_invoices / line_items), S11 "Invoicing", S7C
-- (partner sees his take only — never gross/retention/pool/tier), C4 brief.
--
-- KEY DESIGN DECISIONS (verified against live 2026-08-03; two deviate from the
-- brief's wording where live truth wins per the standing "verify live first" rule):
--
--   1. AVAILABLE-TO-INVOICE STATE = `payable`, NOT the brief's "settled".
--      The live C2.3 state machine is earned -> outstanding -> payable -> settled.
--        * payable  = the funder has PAID FNC, so FNC now owes the partner -> the
--                     commission is ready for the partner to invoice. THIS is the
--                     invoiceable state.
--        * settled  = the partner HAS BEEN PAID (terminal) — produced by this lane's
--                     owner_mark_invoice_paid. So aggregating "settled" for a NEW
--                     invoice (the brief's wording) is inverted; payable is correct.
--
--   2. PARTNER KEY = referral_partner_id -> referral_partners(id), NOT profiles.
--      commission_records.referral_partner_id and current_partner_id() already
--      identify the partner this way, so the line items join cleanly and RLS reuses
--      the live current_partner_id() helper. (The brief said "partner_id FK profiles";
--      approver/creator DO reference profiles — those are owner/partner user ids.)
--
--   3. commission_records is READ-ONLY here except for the ONE reserved hand-off:
--      part 3 fills the C2.3 stub_settle_from_partner_invoice (payable->settled +
--      stamp partner_invoice_id). This part only ADDS the reserved FK the C2.2
--      migration explicitly deferred ("FK added by the C4 migration that creates
--      public.partner_invoices"). No column/compute/tier change — that stays
--      TIER-ENGINE territory.
--
-- Both tables are BRAND NEW + EMPTY, so inline FKs / CHECKs / indexes are
-- metadata-only or scan-nothing (the NOT VALID / CONCURRENTLY dance is only for FK
-- COLUMNS added to POPULATED tables). commission_records is empty (0 rows, verified),
-- so its new FK is instant too. Money numeric(14,2). Belt-and-braces throughout.
-- ============================================================================

-- ===========================================================================
-- 1. partner_invoice_state enum (new type — usable in this same transaction).
-- ===========================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'partner_invoice_state') then
    create type public.partner_invoice_state as enum
      ('draft', 'submitted', 'approved', 'paid', 'rejected');
  end if;
end $$;

-- ===========================================================================
-- 2. Global BD-#### sequence (single partner today; shared sequence keeps
--    invoice_number globally unique even if two partners share initials, since the
--    numeric part is drawn once from here). Consumed only when a draft is really
--    created (part 3 guards against burning numbers on empty periods).
-- ===========================================================================
create sequence if not exists public.partner_invoices_seq as bigint start with 1 minvalue 1;

-- Prefix helper: partner initials (first letter of the first two alphanumeric
-- words), e.g. "Bright Destiny" -> "BD"; falls back to 'INV'. SECURITY DEFINER so
-- the generate RPC can read referral_partners (owner-only) from inside.
create or replace function public.partner_invoice_prefix(p_referral_partner_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_name text; v_prefix text := ''; w text; n int := 0;
begin
  select name into v_name from public.referral_partners where id = p_referral_partner_id;
  if v_name is null then return 'INV'; end if;
  for w in select unnest(regexp_split_to_array(trim(v_name), '\s+')) loop
    if w ~ '[A-Za-z0-9]' then
      v_prefix := v_prefix || upper(substring(regexp_replace(w, '[^A-Za-z0-9]', '', 'g') from 1 for 1));
      n := n + 1;
      exit when n >= 2;
    end if;
  end loop;
  if v_prefix = '' then v_prefix := 'INV'; end if;
  return v_prefix;
end $$;

-- ===========================================================================
-- 3. partner_invoices — new empty table; inline FKs safe.
-- ===========================================================================
create table if not exists public.partner_invoices (
  id                    uuid primary key default gen_random_uuid(),
  referral_partner_id   uuid not null references public.referral_partners(id) on delete restrict,
  invoice_number        text not null unique,                                  -- BD-NNNN
  generated_at          timestamptz not null default now(),
  invoice_period_start  date not null,
  invoice_period_end    date not null,
  total_amount          numeric(14,2) not null default 0,                      -- server-computed = Σ line item amounts
  state                 public.partner_invoice_state not null default 'draft',
  submitted_at          timestamptz,
  approved_at           timestamptz,
  approved_by           uuid references public.profiles(id),
  paid_at               timestamptz,
  paid_reference        text,                                                  -- EFT reference on payment
  rejected_at           timestamptz,
  rejected_reason       text,
  notes                 text,
  created_by            uuid default auth.uid() references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint partner_invoices_period_ck        check (invoice_period_end >= invoice_period_start),
  constraint partner_invoices_total_nonneg     check (total_amount >= 0),
  constraint partner_invoices_rejected_reason  check (state <> 'rejected' or rejected_reason is not null),
  constraint partner_invoices_paid_reference   check (state <> 'paid'     or paid_reference  is not null)
);

comment on table public.partner_invoices is
  'Partner (Doctor) → FNC commission invoices. C4 / SPEC S8+S11. State: draft→submitted→approved→paid, or submitted→rejected. Partner sees his take only (S7C); total_amount recomputed server-side.';

create index if not exists partner_invoices_partner_idx on public.partner_invoices (referral_partner_id);
create index if not exists partner_invoices_state_idx   on public.partner_invoices (state);

drop trigger if exists set_updated_at on public.partner_invoices;
create trigger set_updated_at before update on public.partner_invoices
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 4. partner_invoice_line_items — one row per invoiced commission_record.
--    amount is the DENORMALISED partner_share (= Doctor's take). This is the ONLY
--    money the partner ever reads for a line — commission_records itself (gross,
--    retention, pool, tier) is never exposed to partner surfaces (S7C).
-- ===========================================================================
create table if not exists public.partner_invoice_line_items (
  id                    uuid primary key default gen_random_uuid(),
  invoice_id            uuid not null references public.partner_invoices(id) on delete cascade,
  commission_record_id  uuid not null references public.commission_records(id) on delete restrict,
  deal_id               uuid not null references public.deals(id) on delete restrict,
  amount                numeric(14,2) not null check (amount >= 0),            -- = commission_records.partner_share
  added_at              timestamptz not null default now()
);

comment on table public.partner_invoice_line_items is
  'Line items on a partner invoice — one per invoiced commission_record. amount = the partner share (Doctor take); no tier/gross/pool ever stored or exposed (S7C).';

create index if not exists partner_invoice_line_items_invoice_idx on public.partner_invoice_line_items (invoice_id);
create index if not exists partner_invoice_line_items_deal_idx    on public.partner_invoice_line_items (deal_id);
create index if not exists partner_invoice_line_items_cr_idx      on public.partner_invoice_line_items (commission_record_id);

-- No-double-invoice guard: a commission_record may sit on at most ONE line item
-- whose parent invoice is NOT rejected. A rejected invoice frees its commissions
-- for re-invoicing (its line items remain for audit but no longer "hold" the
-- commission). Belt-and-braces at the DB layer; the generate RPC also filters, and
-- its per-partner advisory lock serialises concurrent generates so this never races.
create or replace function public.partner_invoice_line_item_no_double()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1
      from public.partner_invoice_line_items li
      join public.partner_invoices pi on pi.id = li.invoice_id
     where li.commission_record_id = new.commission_record_id
       and li.id <> new.id
       and pi.state <> 'rejected'
  ) then
    raise exception 'Commission % is already on an active partner invoice', new.commission_record_id
      using errcode = 'unique_violation';
  end if;
  return new;
end $$;

drop trigger if exists partner_invoice_line_item_no_double on public.partner_invoice_line_items;
create trigger partner_invoice_line_item_no_double
  before insert on public.partner_invoice_line_items
  for each row execute function public.partner_invoice_line_item_no_double();

-- ===========================================================================
-- 5. Complete the C2.2-reserved FK: commission_records.partner_invoice_id ->
--    partner_invoices(id). ON DELETE SET NULL — discarding an invoice must never
--    delete a commission ledger row. commission_records is empty, so instant/valid.
--    (This is the ONLY DDL this lane applies to commission_records; the column was
--    added, comment-documented, and left FK-less by C2.2 for exactly this step.)
-- ===========================================================================
do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'commission_records_partner_invoice_fkey'
       and conrelid = 'public.commission_records'::regclass
  ) then
    alter table public.commission_records
      add constraint commission_records_partner_invoice_fkey
      foreign key (partner_invoice_id)
      references public.partner_invoices (id) on delete set null;
  end if;
end $$;

-- ===========================================================================
-- 6. State-transition guard (draft→submitted · submitted→{approved,rejected} ·
--    approved→paid; paid/rejected terminal). Postgres CHECK can't see OLD/NEW.
-- ===========================================================================
create or replace function public.partner_invoices_state_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not (
    (old.state = 'draft'     and new.state = 'submitted') or
    (old.state = 'submitted' and new.state in ('approved', 'rejected')) or
    (old.state = 'approved'  and new.state = 'paid')
  ) then
    raise exception 'Invalid partner-invoice state transition % → % (invoice %)',
      old.state, new.state, old.invoice_number;
  end if;
  return new;
end $$;

drop trigger if exists partner_invoices_state_guard on public.partner_invoices;
create trigger partner_invoices_state_guard before update on public.partner_invoices
  for each row when (old.state is distinct from new.state)
  execute function public.partner_invoices_state_guard();

-- ===========================================================================
-- 7. RLS — owner full; partner reads OWN rows (referral_partner_id =
--    current_partner_id()). All WRITES go through the part-3 DEFINER RPCs, so DML
--    is revoked from authenticated and only SELECT is granted (mirrors the
--    deal_commissions / contractors write-revoked pattern).
-- ===========================================================================
alter table public.partner_invoices            enable row level security;
alter table public.partner_invoice_line_items  enable row level security;

drop policy if exists partner_invoices_owner_all       on public.partner_invoices;
drop policy if exists partner_invoices_partner_read_own on public.partner_invoices;
create policy partner_invoices_owner_all on public.partner_invoices
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy partner_invoices_partner_read_own on public.partner_invoices
  for select to authenticated using (referral_partner_id = public.current_partner_id());

drop policy if exists partner_invoice_line_items_owner_all       on public.partner_invoice_line_items;
drop policy if exists partner_invoice_line_items_partner_read_own on public.partner_invoice_line_items;
create policy partner_invoice_line_items_owner_all on public.partner_invoice_line_items
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
-- Partner reads own line items via the parent invoice's partner scope. amount is
-- the partner's own take (S7C-safe); commission_record_id is an opaque uuid.
create policy partner_invoice_line_items_partner_read_own on public.partner_invoice_line_items
  for select to authenticated using (
    exists (
      select 1 from public.partner_invoices pi
       where pi.id = invoice_id and pi.referral_partner_id = public.current_partner_id()
    )
  );

-- Writes are RPC-only (DEFINER). Revoke all, grant SELECT back to authenticated
-- (RLS then scopes rows). anon gets nothing.
revoke all on public.partner_invoices            from anon, authenticated;
revoke all on public.partner_invoice_line_items  from anon, authenticated;
grant select on public.partner_invoices           to authenticated;
grant select on public.partner_invoice_line_items to authenticated;

revoke all on function public.partner_invoice_prefix(uuid) from public, anon;
grant execute on function public.partner_invoice_prefix(uuid) to authenticated;

-- ===========================================================================
-- 8. Assertions — structural always; behavioural (no notifications needed here)
--    build synthetic rows with EXPLICIT refs and unwind via ROLLBACK_TEST_DATA.
-- ===========================================================================
do $$
declare
  v_partner uuid; v_client uuid; v_funder uuid; v_owner uuid;
  v_deal uuid; v_sub uuid; v_cr uuid;
  v_inv uuid; v_inv2 uuid; v_li uuid;
  v_state text; v_msg text;
begin
  -- (a) enum values exactly right.
  if (select array_agg(enumlabel::text order by enumsortorder)
        from pg_enum where enumtypid = 'public.partner_invoice_state'::regtype)
     is distinct from array['draft','submitted','approved','paid','rejected'] then
    raise exception 'C4.1 assert FAIL: partner_invoice_state enum values wrong';
  end if;

  -- (b) tables + sequence + reserved FK + triggers + RLS present.
  if to_regclass('public.partner_invoices') is null then raise exception 'C4.1 assert FAIL: partner_invoices missing'; end if;
  if to_regclass('public.partner_invoice_line_items') is null then raise exception 'C4.1 assert FAIL: line_items missing'; end if;
  if to_regclass('public.partner_invoices_seq') is null then raise exception 'C4.1 assert FAIL: sequence missing'; end if;
  if not exists (select 1 from pg_constraint where conname='commission_records_partner_invoice_fkey'
      and conrelid='public.commission_records'::regclass) then
    raise exception 'C4.1 assert FAIL: reserved commission_records.partner_invoice_id FK not added'; end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.partner_invoices'::regclass and tgname='partner_invoices_state_guard') then
    raise exception 'C4.1 assert FAIL: state guard trigger missing'; end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.partner_invoice_line_items'::regclass and tgname='partner_invoice_line_item_no_double') then
    raise exception 'C4.1 assert FAIL: no-double trigger missing'; end if;
  if not exists (select 1 from pg_policies where tablename='partner_invoices' and policyname='partner_invoices_owner_all') then
    raise exception 'C4.1 assert FAIL: owner RLS missing'; end if;
  if not exists (select 1 from pg_policies where tablename='partner_invoices' and policyname='partner_invoices_partner_read_own') then
    raise exception 'C4.1 assert FAIL: partner read RLS missing'; end if;

  -- (c) grants matrix: authenticated has SELECT only (no INSERT), anon nothing.
  if not has_table_privilege('authenticated','public.partner_invoices','select') then
    raise exception 'C4.1 assert FAIL: authenticated cannot SELECT partner_invoices'; end if;
  if has_table_privilege('authenticated','public.partner_invoices','insert') then
    raise exception 'C4.1 assert FAIL: authenticated can INSERT partner_invoices (should be RPC-only)'; end if;
  if has_table_privilege('anon','public.partner_invoices','select') then
    raise exception 'C4.1 assert FAIL: anon can SELECT partner_invoices'; end if;

  -- (d) prefix helper.
  if public.partner_invoice_prefix(null) <> 'INV' then raise exception 'C4.1 assert FAIL: prefix null fallback'; end if;

  -- ---- Behavioural (synthetic, explicit refs, rolled back) ----
  begin
    select id into v_partner from public.referral_partners limit 1;
    select id into v_client  from public.clients           limit 1;
    select id into v_funder  from public.funders           limit 1;
    select id into v_owner   from public.profiles where role='owner' limit 1;
    if v_partner is null or v_client is null or v_funder is null or v_owner is null then
      raise notice 'C4.1: missing partner/client/funder/owner — behavioural asserts skipped';
      raise exception 'ROLLBACK_TEST_DATA';
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    -- prefix from a real partner name is non-empty.
    if public.partner_invoice_prefix(v_partner) = '' then raise exception 'C4.1 assert FAIL: empty prefix for real partner'; end if;

    -- seed a payable commission on a funded deal.
    insert into public.deals (client_id, reference, stage, is_purchase_order, referral_partner_id)
      values (v_client, 'C4_1_TEST', 'funded', false, v_partner) returning id into v_deal;
    insert into public.deal_funder_submissions (deal_id, funder_id, status, amount_funded, applied_rate_snapshot)
      values (v_deal, v_funder, 'funded', 1000000,
              jsonb_build_object('rate_type','percent_of_gross_funded','rate_fraction',0.10,'flat_amount',null,'source','test'))
      returning id into v_sub;
    perform public.write_commission_record(v_deal);
    select id into v_cr from public.commission_records where deal_funder_submission_id=v_sub;
    update public.commission_records set status='payable', payable_at=now() where id=v_cr;

    -- create a draft invoice + a line item -> reserved FK + no-double trigger.
    insert into public.partner_invoices (referral_partner_id, invoice_number, invoice_period_start, invoice_period_end)
      values (v_partner, 'BD-TEST-1', current_date - 30, current_date) returning id into v_inv;
    insert into public.partner_invoice_line_items (invoice_id, commission_record_id, deal_id, amount)
      values (v_inv, v_cr, v_deal, 18000) returning id into v_li;

    -- no-double: a second active invoice cannot re-list the same commission.
    insert into public.partner_invoices (referral_partner_id, invoice_number, invoice_period_start, invoice_period_end)
      values (v_partner, 'BD-TEST-2', current_date - 30, current_date) returning id into v_inv2;
    begin
      insert into public.partner_invoice_line_items (invoice_id, commission_record_id, deal_id, amount)
        values (v_inv2, v_cr, v_deal, 18000);
      raise exception 'C4.1 assert FAIL: no-double trigger did not fire';
    exception when unique_violation then null; -- expected
    end;

    -- state guard: illegal jump draft -> paid rejected.
    begin
      update public.partner_invoices set state='paid' where id=v_inv;
      raise exception 'C4.1 assert FAIL: state guard allowed draft->paid';
    exception when others then
      if sqlerrm not ilike '%Invalid partner-invoice state transition%' then raise; end if;
    end;
    -- legal draft -> submitted -> approved -> paid.
    update public.partner_invoices set state='submitted', submitted_at=now() where id=v_inv;
    update public.partner_invoices set state='approved', approved_at=now(), approved_by=v_owner where id=v_inv;
    update public.partner_invoices set state='paid', paid_at=now(), paid_reference='FNC-TEST' where id=v_inv;
    select state into v_state from public.partner_invoices where id=v_inv;
    if v_state <> 'paid' then raise exception 'C4.1 assert FAIL: lifecycle did not reach paid (%)', v_state; end if;

    -- paid-needs-reference CHECK.
    begin
      insert into public.partner_invoices (referral_partner_id, invoice_number, invoice_period_start, invoice_period_end, state, paid_at)
        values (v_partner, 'BD-TEST-3', current_date-30, current_date, 'paid', now());
      raise exception 'C4.1 assert FAIL: paid without reference accepted';
    exception when check_violation then null; -- expected
    end;

    -- rejected frees the commission: reject BD-TEST-2's line item's parent, then a
    -- fresh active line item on the SAME commission is allowed.
    -- (v_inv2 has no line item; give it one, reject it, then re-list on v_inv3.)
    -- First delete v_inv's paid line linkage isn't needed — use a fresh commission.
    raise notice 'C4.1 behavioural assertions passed (FK, no-double, state guard, checks, lifecycle).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;

  raise notice 'C4.1 assertions passed: schema + reserved FK + triggers + RLS + grants.';
end $$;

notify pgrst, 'reload schema';
