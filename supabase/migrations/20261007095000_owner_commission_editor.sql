-- Staff build, Batch 1B: Owner-only manual commission editor (ledger only).
--
-- Owner rule (6 October 2026): the Owner personally enters commission. Nothing
-- here calculates, assigns, approves or changes an amount from bands, deal
-- outcomes, memberships or background jobs. The database only does arithmetic
-- and validation, and raises flags for the Owner. Staff roles, agents, Team
-- Leaders and partners have no policy, grant or projection on any of it.
--
-- This migration creates NEW objects only. It does not edit the commission
-- writers, recompute trigger, tier lock, state cascade or invoice readers; those
-- are Codex's lane (see docs/STAFF-BUILD-OWNER-COMMISSION-EDITOR-2026-10-07.md).
-- Until Codex's guard lands, an automatic row can still exist beside an Owner
-- entry; approval and payout here use Owner entries only.
--
-- Approval is separate from payment. Approved or paid amounts never change:
-- corrections are append-only adjustments, and the effective amount is the
-- entry amount plus its adjustments.

-- ---------------------------------------------------------------------------
-- Stated total per deal: the figure the Owner's entries must add up to.
-- ---------------------------------------------------------------------------
create table if not exists public.owner_commission_deal_totals (
  deal_id      uuid primary key references public.deals(id) on delete restrict,
  currency     text not null default 'ZAR',
  total_amount numeric(14,2) not null,
  set_by       uuid not null references public.profiles(id) on delete restrict,
  set_at       timestamptz not null default now(),
  constraint owner_commission_deal_totals_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint owner_commission_deal_totals_amount_ck check (total_amount >= 0)
);

-- ---------------------------------------------------------------------------
-- Entries: one allocation per deal and beneficiary.
-- ---------------------------------------------------------------------------
create table if not exists public.owner_commission_entries (
  id                         uuid primary key default gen_random_uuid(),
  deal_id                    uuid not null references public.deals(id) on delete restrict,
  beneficiary_kind           text not null,
  beneficiary_profile_id     uuid references public.profiles(id) on delete restrict,
  beneficiary_organisation_id uuid references public.referral_partners(id) on delete restrict,
  beneficiary_name           text,
  currency                   text not null default 'ZAR',
  amount                     numeric(14,2) not null,
  basis                      text,
  percentage                 numeric(7,4),
  status                     text not null default 'draft',
  entered_by                 uuid not null references public.profiles(id) on delete restrict,
  reason                     text,
  approved_by                uuid references public.profiles(id) on delete set null,
  approved_at                timestamptz,
  paid_by                    uuid references public.profiles(id) on delete set null,
  paid_at                    timestamptz,
  payment_reference          text,
  void_reason                text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint owner_commission_entries_kind_ck
    check (beneficiary_kind in ('agent', 'team_leader', 'organisation', 'external_payee')),
  constraint owner_commission_entries_status_ck check (status in ('draft', 'approved', 'paid', 'void')),
  constraint owner_commission_entries_amount_ck check (amount >= 0),
  constraint owner_commission_entries_pct_ck check (percentage is null or (percentage >= 0 and percentage <= 100)),
  constraint owner_commission_entries_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint owner_commission_entries_basis_len_ck check (basis is null or length(basis) <= 300),
  constraint owner_commission_entries_beneficiary_ck check (
    (beneficiary_kind in ('agent', 'team_leader') and beneficiary_profile_id is not null
       and beneficiary_organisation_id is null and beneficiary_name is null)
    or (beneficiary_kind = 'organisation' and beneficiary_organisation_id is not null
       and beneficiary_profile_id is null and beneficiary_name is null)
    or (beneficiary_kind = 'external_payee' and beneficiary_name is not null and length(btrim(beneficiary_name)) > 0
       and beneficiary_profile_id is null and beneficiary_organisation_id is null)),
  constraint owner_commission_entries_state_ck check (
    (status in ('draft', 'void') and approved_at is null and paid_at is null)
    or (status = 'approved' and approved_at is not null and paid_at is null)
    or (status = 'paid' and approved_at is not null and paid_at is not null
        and payment_reference is not null and length(btrim(payment_reference)) >= 3)),
  constraint owner_commission_entries_void_ck check (status <> 'void' or (void_reason is not null and length(btrim(void_reason)) >= 10))
);

-- No duplicate allocation: one live entry per deal and beneficiary.
create unique index if not exists owner_commission_entries_live_uq
  on public.owner_commission_entries
  (deal_id, beneficiary_kind, coalesce(beneficiary_profile_id::text, ''),
   coalesce(beneficiary_organisation_id::text, ''), lower(coalesce(beneficiary_name, '')))
  where status <> 'void';
create index if not exists owner_commission_entries_deal_idx on public.owner_commission_entries (deal_id);

-- ---------------------------------------------------------------------------
-- Adjustments (append-only) and advisory flags
-- ---------------------------------------------------------------------------
create table if not exists public.owner_commission_adjustments (
  id              bigint generated always as identity primary key,
  entry_id        uuid not null references public.owner_commission_entries(id) on delete restrict,
  delta           numeric(14,2) not null,
  previous_effective numeric(14,2) not null,
  new_effective   numeric(14,2) not null,
  reason          text not null,
  actor_id        uuid not null references public.profiles(id) on delete restrict,
  created_at      timestamptz not null default now(),
  constraint owner_commission_adjustments_delta_ck check (delta <> 0),
  constraint owner_commission_adjustments_reason_ck check (length(btrim(reason)) >= 10),
  constraint owner_commission_adjustments_floor_ck check (new_effective >= 0)
);
create index if not exists owner_commission_adjustments_entry_idx on public.owner_commission_adjustments (entry_id, id);

create table if not exists public.owner_commission_flags (
  id            uuid primary key default gen_random_uuid(),
  entry_id      uuid not null references public.owner_commission_entries(id) on delete restrict,
  flag_kind     text not null,
  note          text not null,
  raised_by     uuid not null references public.profiles(id) on delete restrict,
  raised_at     timestamptz not null default now(),
  status        text not null default 'open',
  resolved_by   uuid references public.profiles(id) on delete set null,
  resolved_at   timestamptz,
  resolution    text,
  constraint owner_commission_flags_kind_ck
    check (flag_kind in ('agreement_conflict', 'automatic_row_present', 'other')),
  constraint owner_commission_flags_status_ck check (status in ('open', 'acknowledged')),
  constraint owner_commission_flags_note_ck check (length(btrim(note)) >= 10),
  constraint owner_commission_flags_resolution_ck check (
    (status = 'open' and resolved_at is null)
    or (status = 'acknowledged' and resolved_at is not null and resolution is not null and length(btrim(resolution)) >= 10))
);
create index if not exists owner_commission_flags_entry_idx on public.owner_commission_flags (entry_id);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
create or replace function public.owner_commission_entries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ok boolean := coalesce(current_setting('fnc.commission_transition', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    raise exception 'Commission entries are never deleted; void a draft or adjust an approved entry';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.approved_by := null; new.approved_at := null; new.paid_by := null; new.paid_at := null;
    new.payment_reference := null; new.void_reason := null;
    return new;
  end if;
  if new.deal_id is distinct from old.deal_id
     or new.entered_by is distinct from old.entered_by
     or new.created_at is distinct from old.created_at then
    raise exception 'deal and author of a commission entry cannot change';
  end if;
  if old.status in ('approved', 'paid', 'void') and (
       new.beneficiary_kind is distinct from old.beneficiary_kind
       or new.beneficiary_profile_id is distinct from old.beneficiary_profile_id
       or new.beneficiary_organisation_id is distinct from old.beneficiary_organisation_id
       or new.beneficiary_name is distinct from old.beneficiary_name
       or new.currency is distinct from old.currency
       or new.amount is distinct from old.amount
       or new.basis is distinct from old.basis
       or new.percentage is distinct from old.percentage
       or new.reason is distinct from old.reason) then
    raise exception 'An approved, paid or void commission entry is history; record an adjustment instead';
  end if;
  if (new.status is distinct from old.status
      or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at
      or new.paid_by is distinct from old.paid_by or new.paid_at is distinct from old.paid_at
      or new.payment_reference is distinct from old.payment_reference
      or new.void_reason is distinct from old.void_reason) and not v_ok then
    raise exception 'Commission status changes only through the Owner commission RPCs';
  end if;
  if old.status = 'paid' and new.status <> 'paid' then raise exception 'A paid commission entry cannot change state'; end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists owner_commission_entries_guard on public.owner_commission_entries;
create trigger owner_commission_entries_guard
  before insert or update or delete on public.owner_commission_entries
  for each row execute function public.owner_commission_entries_guard();

create or replace function public.owner_commission_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: record a new row instead of changing history', tg_table_name;
end;
$$;

-- Flags: only the resolution fields may move, and only once (open -> acknowledged).
create or replace function public.owner_commission_flags_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'owner_commission_flags is append-only: flags are never deleted';
  end if;
  if old.status <> 'open'
     or new.entry_id is distinct from old.entry_id or new.flag_kind is distinct from old.flag_kind
     or new.note is distinct from old.note or new.raised_by is distinct from old.raised_by
     or new.raised_at is distinct from old.raised_at then
    raise exception 'owner_commission_flags is append-only: only the one-time resolution may be recorded';
  end if;
  return new;
end;
$$;

drop trigger if exists owner_commission_adjustments_append_only on public.owner_commission_adjustments;
create trigger owner_commission_adjustments_append_only
  before update or delete on public.owner_commission_adjustments
  for each row execute function public.owner_commission_append_only_guard();
drop trigger if exists owner_commission_flags_append_only on public.owner_commission_flags;
create trigger owner_commission_flags_append_only
  before update or delete on public.owner_commission_flags
  for each row execute function public.owner_commission_flags_guard();

-- ---------------------------------------------------------------------------
-- RLS: Owner reads; nobody writes except through the RPCs below.
-- ---------------------------------------------------------------------------
alter table public.owner_commission_deal_totals enable row level security;
alter table public.owner_commission_entries enable row level security;
alter table public.owner_commission_adjustments enable row level security;
alter table public.owner_commission_flags enable row level security;

drop policy if exists owner_commission_deal_totals_owner_select on public.owner_commission_deal_totals;
create policy owner_commission_deal_totals_owner_select on public.owner_commission_deal_totals
  for select to authenticated using (public.is_owner());
drop policy if exists owner_commission_entries_owner_select on public.owner_commission_entries;
create policy owner_commission_entries_owner_select on public.owner_commission_entries
  for select to authenticated using (public.is_owner());
drop policy if exists owner_commission_adjustments_owner_select on public.owner_commission_adjustments;
create policy owner_commission_adjustments_owner_select on public.owner_commission_adjustments
  for select to authenticated using (public.is_owner());
drop policy if exists owner_commission_flags_owner_select on public.owner_commission_flags;
create policy owner_commission_flags_owner_select on public.owner_commission_flags
  for select to authenticated using (public.is_owner());

revoke all on table public.owner_commission_deal_totals from anon, authenticated;
revoke all on table public.owner_commission_entries from anon, authenticated;
revoke all on table public.owner_commission_adjustments from anon, authenticated;
revoke all on table public.owner_commission_flags from anon, authenticated;
grant select on table public.owner_commission_deal_totals to authenticated;
grant select on table public.owner_commission_entries to authenticated;
grant select on table public.owner_commission_adjustments to authenticated;
grant select on table public.owner_commission_flags to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.owner_commission_require_owner()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can manage commission' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.owner_commission_effective(p_entry_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select e.amount + coalesce((select sum(a.delta) from public.owner_commission_adjustments a where a.entry_id = e.id), 0)
    from public.owner_commission_entries e where e.id = p_entry_id;
$$;

revoke all on function public.owner_commission_require_owner() from public, anon, authenticated;
revoke all on function public.owner_commission_effective(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reconciliation: arithmetic only. Reports, never fixes.
-- ---------------------------------------------------------------------------
create or replace function public.owner_commission_reconciliation(p_deal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total   public.owner_commission_deal_totals;
  v_sum     numeric(14,2);
  v_ccy     integer;
  v_flags   integer;
begin
  perform public.owner_commission_require_owner();
  select * into v_total from public.owner_commission_deal_totals t where t.deal_id = p_deal_id;
  select coalesce(sum(public.owner_commission_effective(e.id)), 0), count(distinct e.currency)
    into v_sum, v_ccy
    from public.owner_commission_entries e where e.deal_id = p_deal_id and e.status <> 'void';
  select count(*) into v_flags
    from public.owner_commission_flags f join public.owner_commission_entries e on e.id = f.entry_id
   where e.deal_id = p_deal_id and f.status = 'open';
  return jsonb_build_object(
    'deal_id', p_deal_id,
    'stated_total', v_total.total_amount,
    'currency', v_total.currency,
    'entered_effective_sum', v_sum,
    'difference', case when v_total.deal_id is null then null else v_total.total_amount - v_sum end,
    'reconciled', v_total.deal_id is not null and v_total.total_amount = v_sum and v_ccy <= 1
                  and (v_ccy = 0 or (select min(e.currency) from public.owner_commission_entries e
                                      where e.deal_id = p_deal_id and e.status <> 'void') = v_total.currency),
    'open_flags', v_flags);
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner RPCs
-- ---------------------------------------------------------------------------
create or replace function public.owner_set_commission_total(
  p_deal_id uuid, p_currency text, p_total numeric, p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.owner_commission_require_owner();
  if not exists (select 1 from public.deals d where d.id = p_deal_id) then raise exception 'Deal not found'; end if;
  if exists (select 1 from public.owner_commission_entries e
              where e.deal_id = p_deal_id and e.status in ('approved', 'paid')) then
    raise exception 'The stated total cannot change once an entry is approved; adjust entries instead';
  end if;
  insert into public.owner_commission_deal_totals (deal_id, currency, total_amount, set_by)
  values (p_deal_id, upper(coalesce(p_currency, 'ZAR')), p_total, (select auth.uid()))
  on conflict (deal_id) do update
    set currency = excluded.currency, total_amount = excluded.total_amount,
        set_by = excluded.set_by, set_at = now();
  perform public.staff_audit_write('owner_commission_entry', p_deal_id, 'commission_total_set', p_reason,
    jsonb_build_object('currency', upper(coalesce(p_currency, 'ZAR')), 'total', p_total));
  return p_deal_id;
end;
$$;

create or replace function public.owner_save_commission_entry(
  p_entry_id               uuid,
  p_deal_id                uuid,
  p_beneficiary_kind       text,
  p_beneficiary_profile_id uuid,
  p_beneficiary_organisation_id uuid,
  p_beneficiary_name       text,
  p_currency               text,
  p_amount                 numeric,
  p_basis                  text default null,
  p_percentage             numeric default null,
  p_reason                 text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id  uuid;
  v_old public.owner_commission_entries;
begin
  perform public.owner_commission_require_owner();
  if not exists (select 1 from public.deals d where d.id = p_deal_id) then raise exception 'Deal not found'; end if;

  if p_beneficiary_kind = 'agent' and not exists (
       select 1 from public.profiles p where p.id = p_beneficiary_profile_id and p.is_active
          and p.role::text in ('partner', 'lead_referrer')) then
    raise exception 'The agent must be an active partner or lead-referrer profile';
  elsif p_beneficiary_kind = 'team_leader' and not exists (
       select 1 from public.referral_team_memberships m
        where m.profile_id = p_beneficiary_profile_id and m.membership_role = 'team_leader') then
    raise exception 'That person has never been a Team Leader';
  elsif p_beneficiary_kind = 'organisation' and not exists (
       select 1 from public.referral_partners rp where rp.id = p_beneficiary_organisation_id and rp.is_active) then
    raise exception 'Active organisation not found';
  end if;

  if p_entry_id is null then
    insert into public.owner_commission_entries
      (deal_id, beneficiary_kind, beneficiary_profile_id, beneficiary_organisation_id, beneficiary_name,
       currency, amount, basis, percentage, entered_by, reason)
    values (p_deal_id, p_beneficiary_kind, p_beneficiary_profile_id, p_beneficiary_organisation_id,
            nullif(btrim(p_beneficiary_name), ''), upper(coalesce(p_currency, 'ZAR')), p_amount,
            nullif(btrim(p_basis), ''), p_percentage, (select auth.uid()), nullif(btrim(p_reason), ''))
    returning id into v_id;
    perform public.staff_audit_write('owner_commission_entry', v_id, 'commission_entry_created', p_reason,
      jsonb_build_object('deal_id', p_deal_id, 'kind', p_beneficiary_kind, 'amount', p_amount,
                         'currency', upper(coalesce(p_currency, 'ZAR')), 'percentage', p_percentage));
    return v_id;
  end if;

  select * into v_old from public.owner_commission_entries e where e.id = p_entry_id for update;
  if not found then raise exception 'Entry not found'; end if;
  if v_old.status <> 'draft' then
    raise exception 'Only a draft entry can be edited; use an adjustment for an approved or paid entry';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'A reason of at least 10 characters is required to amend an entry';
  end if;
  update public.owner_commission_entries
     set beneficiary_kind = p_beneficiary_kind, beneficiary_profile_id = p_beneficiary_profile_id,
         beneficiary_organisation_id = p_beneficiary_organisation_id,
         beneficiary_name = nullif(btrim(p_beneficiary_name), ''),
         currency = upper(coalesce(p_currency, 'ZAR')), amount = p_amount,
         basis = nullif(btrim(p_basis), ''), percentage = p_percentage, reason = btrim(p_reason)
   where id = p_entry_id;
  perform public.staff_audit_write('owner_commission_entry', p_entry_id, 'commission_entry_amended', p_reason,
    jsonb_build_object('previous_amount', v_old.amount, 'new_amount', p_amount,
                       'previous_percentage', v_old.percentage, 'new_percentage', p_percentage));
  return p_entry_id;
end;
$$;

create or replace function public.owner_void_commission_entry(p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  perform public.owner_commission_require_owner();
  select e.status into v_status from public.owner_commission_entries e where e.id = p_entry_id for update;
  if v_status is null then raise exception 'Entry not found'; end if;
  if v_status <> 'draft' then raise exception 'Only a draft entry can be voided'; end if;
  perform set_config('fnc.commission_transition', 'on', true);
  update public.owner_commission_entries set status = 'void', void_reason = btrim(p_reason) where id = p_entry_id;
  perform set_config('fnc.commission_transition', 'off', true);
  perform public.staff_audit_write('owner_commission_entry', p_entry_id, 'commission_entry_voided', p_reason, '{}'::jsonb);
  return p_entry_id;
end;
$$;

create or replace function public.owner_flag_commission_entry(
  p_entry_id uuid, p_kind text, p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.owner_commission_require_owner();
  if not exists (select 1 from public.owner_commission_entries e where e.id = p_entry_id) then
    raise exception 'Entry not found';
  end if;
  insert into public.owner_commission_flags (entry_id, flag_kind, note, raised_by)
  values (p_entry_id, p_kind, btrim(p_note), (select auth.uid()))
  returning id into v_id;
  perform public.staff_audit_write('owner_commission_entry', p_entry_id, 'commission_flag_raised', p_note,
    jsonb_build_object('flag_id', v_id, 'kind', p_kind));
  return v_id;
end;
$$;

create or replace function public.owner_resolve_commission_flag(p_flag_id uuid, p_resolution text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
begin
  perform public.owner_commission_require_owner();
  update public.owner_commission_flags
     set status = 'acknowledged', resolved_by = (select auth.uid()), resolved_at = now(), resolution = btrim(p_resolution)
   where id = p_flag_id and status = 'open'
   returning entry_id into v_entry;
  if v_entry is null then raise exception 'Open flag not found'; end if;
  perform public.staff_audit_write('owner_commission_entry', v_entry, 'commission_flag_acknowledged', p_resolution,
    jsonb_build_object('flag_id', p_flag_id));
  return p_flag_id;
end;
$$;

-- Approval is a deliberate Owner action on the whole deal: every live entry must
-- reconcile to the stated total, in one currency, with no open flag.
create or replace function public.owner_approve_commission_entries(p_deal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recon jsonb;
  v_n     integer;
begin
  perform public.owner_commission_require_owner();
  -- One approval per deal at a time.
  perform pg_advisory_xact_lock(hashtextextended('owner_commission:' || p_deal_id::text, 0));
  v_recon := public.owner_commission_reconciliation(p_deal_id);
  if v_recon -> 'stated_total' = 'null'::jsonb then
    raise exception 'State the total commission for this deal before approving';
  end if;
  if not exists (select 1 from public.owner_commission_entries e where e.deal_id = p_deal_id and e.status = 'draft') then
    raise exception 'There are no draft entries to approve';
  end if;
  if (v_recon ->> 'reconciled')::boolean is not true then
    raise exception 'Entries do not reconcile to the stated total (difference %); fix them before approval', v_recon ->> 'difference';
  end if;
  if (v_recon ->> 'open_flags')::integer > 0 then
    raise exception 'Resolve the open commission flags before approval';
  end if;

  perform set_config('fnc.commission_transition', 'on', true);
  update public.owner_commission_entries
     set status = 'approved', approved_by = (select auth.uid()), approved_at = now()
   where deal_id = p_deal_id and status = 'draft';
  get diagnostics v_n = row_count;
  perform set_config('fnc.commission_transition', 'off', true);

  perform public.staff_audit_write('owner_commission_entry', p_deal_id, 'commission_entries_approved', null,
    jsonb_build_object('entries', v_n, 'total', v_recon -> 'stated_total'));
  return jsonb_build_object('deal_id', p_deal_id, 'approved', v_n);
end;
$$;

create or replace function public.owner_adjust_commission_entry(
  p_entry_id uuid, p_delta numeric, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_prev   numeric(14,2);
begin
  perform public.owner_commission_require_owner();
  select e.status into v_status from public.owner_commission_entries e where e.id = p_entry_id for update;
  if v_status is null then raise exception 'Entry not found'; end if;
  if v_status not in ('approved', 'paid') then
    raise exception 'Only approved or paid entries are adjusted; edit a draft directly';
  end if;
  v_prev := public.owner_commission_effective(p_entry_id);
  insert into public.owner_commission_adjustments (entry_id, delta, previous_effective, new_effective, reason, actor_id)
  values (p_entry_id, p_delta, v_prev, v_prev + p_delta, btrim(p_reason), (select auth.uid()));
  perform public.staff_audit_write('owner_commission_entry', p_entry_id, 'commission_entry_adjusted', p_reason,
    jsonb_build_object('delta', p_delta, 'previous_effective', v_prev, 'new_effective', v_prev + p_delta));
  return jsonb_build_object('entry_id', p_entry_id, 'effective_amount', v_prev + p_delta);
end;
$$;

-- Payment is a separate act from approval and needs a payment reference.
create or replace function public.owner_mark_commission_entry_paid(
  p_entry_id uuid, p_payment_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  perform public.owner_commission_require_owner();
  select e.status into v_status from public.owner_commission_entries e where e.id = p_entry_id for update;
  if v_status is null then raise exception 'Entry not found'; end if;
  if v_status <> 'approved' then raise exception 'Only an approved entry can be marked paid'; end if;
  if p_payment_reference is null or length(btrim(p_payment_reference)) < 3 then
    raise exception 'A payment reference is required';
  end if;
  perform set_config('fnc.commission_transition', 'on', true);
  update public.owner_commission_entries
     set status = 'paid', paid_by = (select auth.uid()), paid_at = now(), payment_reference = btrim(p_payment_reference)
   where id = p_entry_id;
  perform set_config('fnc.commission_transition', 'off', true);
  perform public.staff_audit_write('owner_commission_entry', p_entry_id, 'commission_entry_paid', null,
    jsonb_build_object('effective_amount', public.owner_commission_effective(p_entry_id)));
  return p_entry_id;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.owner_commission_reconciliation(uuid)',
    'public.owner_set_commission_total(uuid,text,numeric,text)',
    'public.owner_save_commission_entry(uuid,uuid,text,uuid,uuid,text,text,numeric,text,numeric,text)',
    'public.owner_void_commission_entry(uuid,text)',
    'public.owner_flag_commission_entry(uuid,text,text)',
    'public.owner_resolve_commission_flag(uuid,text)',
    'public.owner_approve_commission_entries(uuid)',
    'public.owner_adjust_commission_entry(uuid,numeric,text)',
    'public.owner_mark_commission_entry_paid(uuid,text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
