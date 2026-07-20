-- C0.3 Schema Alignment (part 2 of 2) — the preflight before C1.1 invoicing.
-- Reference: ROADMAP Phase C0 · SPEC S7A · owner decision (2026-07-20, Option A).
--
-- Option A (locked): keep `funders` as the single canonical funder table. Instead
-- of splitting off a `contracted_funders` table, we mark which funders FNC has a
-- signed agreement with via `funders.is_contracted`, and gate rate-structure
-- creation to those funders. No FK changes; every existing deal/UI/relationship on
-- `funders` stays intact.
--
-- This migration adds:
--   funders                     : is_contracted (bool), short_code (text)
--   funder_commission_structures: payment_terms_days (int), contract_reference (text)
--                                 + a BEFORE-trigger gating rates to contracted funders
--   deal_funder_submissions     : finance_charge_amount (money) + a required-when
--                                 rate_type='percent_of_finance_charge' CHECK
--
-- NOTE on the "CHECK that rates only exist for contracted funders": a Postgres CHECK
-- constraint cannot reference another table (funders.is_contracted lives on a
-- different row/table), so the gate is implemented as a BEFORE INSERT/UPDATE trigger
-- on funder_commission_structures — the correct cross-table equivalent. Existing
-- rate rows are never re-validated (un-contracting a funder preserves its rates, per
-- owner intent); the trigger only blocks NEW rates (and re-pointing a rate to a
-- different, non-contracted funder).
--
-- Backfill: NONE. is_contracted defaults false for all 21 funders; the owner flips
-- the ~7 real contracted funders (and enters each short_code) by hand via the C0.2
-- UI after this lands — a deliberate, reviewed decision, not an auto-migration.

-- ===========================================================================
-- 1. funders — is_contracted + short_code.
--    Adding a bool with a constant default and a nullable text column are
--    metadata-only operations (no FK, no table rewrite) — safe on the populated
--    (21-row) table without NOT VALID / CONCURRENTLY (that dance is for FK cols).
-- ===========================================================================
alter table public.funders
  add column if not exists is_contracted boolean not null default false,
  add column if not exists short_code    text;

comment on column public.funders.is_contracted is
  'True when FNC has a signed broker/lead-provider agreement with this funder. Only contracted funders can carry commission rate structures and be invoiced (C0.3 / C1). Owner-set via /settings/funders.';
comment on column public.funders.short_code is
  'Owner-set uppercase short code used in invoice payment references, e.g. POLLEN → POLLEN-INV0032-CHICKANOS (C1). Nullable; entered when the funder is flagged contracted. Not auto-populated (intentional decision).';

-- ===========================================================================
-- 2. funder_commission_structures — payment_terms_days + contract_reference.
--    payment_terms_days: 0 = "Due on receipt" (skipped by the C1 overdue sweep);
--    14/30/etc. = net-N days. contract_reference: the human agreement reference
--    that flows onto the invoice ("Lead Provider Agreement dated 28 April 2026").
-- ===========================================================================
alter table public.funder_commission_structures
  add column if not exists payment_terms_days integer not null default 0,
  add column if not exists contract_reference text;

alter table public.funder_commission_structures
  drop constraint if exists fcs_payment_terms_days_nonneg;
alter table public.funder_commission_structures
  add constraint fcs_payment_terms_days_nonneg check (payment_terms_days >= 0);

comment on column public.funder_commission_structures.payment_terms_days is
  '0 = Due on receipt (no due date; skipped by the C1 overdue sweep); N = net-N days from invoice date. Owner-set per rate structure.';
comment on column public.funder_commission_structures.contract_reference is
  'Human agreement reference rendered on the invoice, e.g. "Lead Provider Agreement dated 28 April 2026". Inherited by every invoice generated under this rate period (C1).';

-- ===========================================================================
-- 3. Contracted-funder gate — BEFORE INSERT/UPDATE trigger (cross-table check).
--    Blocks a rate structure whose funder is not is_contracted. Fires on INSERT,
--    and on UPDATE only when funder_id changes (re-pointing) — so editing an
--    existing rate's dates/notes on a now-un-contracted funder stays allowed.
-- ===========================================================================
create or replace function public.enforce_rate_funder_contracted()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_contracted boolean;
begin
  -- Only gate rate CREATION or a funder re-point; leave edits to existing rows alone.
  if tg_op = 'UPDATE' and new.funder_id = old.funder_id then
    return new;
  end if;

  select f.is_contracted into v_contracted
    from public.funders f where f.id = new.funder_id;

  if not coalesce(v_contracted, false) then
    raise exception
      'Rate structures can only be created for contracted funders. Flag this funder as contracted (signed agreement) in Settings first.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_rate_funder_contracted on public.funder_commission_structures;
create trigger enforce_rate_funder_contracted
  before insert or update on public.funder_commission_structures
  for each row execute function public.enforce_rate_funder_contracted();

-- ===========================================================================
-- 4. deal_funder_submissions — finance_charge_amount + required-when CHECK.
--    Money per rule 6. Nullable (only captured for percent_of_finance_charge
--    funders). The CHECK bites only once the approval-time rate snapshot is
--    present (written in C2) and names percent_of_finance_charge — so it's
--    vacuously satisfied by all existing rows (applied_rate_snapshot is null
--    today). NOT VALID + VALIDATE keeps the lock brief on the populated table
--    (belt-and-braces; the table is tiny but the pattern is the standing rule).
--    Hard "required at approval/funding" enforcement also lives in the C1.1 RPC.
-- ===========================================================================
alter table public.deal_funder_submissions
  add column if not exists finance_charge_amount numeric(14,2);

comment on column public.deal_funder_submissions.finance_charge_amount is
  'Client finance charge on the facility — the basis for percent_of_finance_charge commission (e.g. Pollen). Distinct from amount_requested/approved/funded. Required (enforced by CHECK + C1.1 RPC) when the applied rate_type is percent_of_finance_charge.';

alter table public.deal_funder_submissions
  drop constraint if exists dfs_finance_charge_required;
alter table public.deal_funder_submissions
  add constraint dfs_finance_charge_required check (
    applied_rate_snapshot is null
    or (applied_rate_snapshot ->> 'rate_type') is distinct from 'percent_of_finance_charge'
    or finance_charge_amount is not null
  ) not valid;
alter table public.deal_funder_submissions
  validate constraint dfs_finance_charge_required;

-- ===========================================================================
-- 5. In-migration assertions (RAISE → roll the whole migration back). Every
--    synthetic row and its activity_logs are cleaned up; the migration commits
--    no test data. Role-simulation/data-dependent blocks are guarded to skip on
--    a fresh/CI DB (replay-safe).
-- ===========================================================================
do $$
declare
  v_default   text;
  v_nullable  text;
  v_funder    uuid;
  v_old_flag  boolean;
  v_rate_id   uuid;
  v_deal      uuid;
  v_sub_id    uuid;
begin
  -- (a) is_contracted: default false, and every existing funder is false.
  select column_default, is_nullable into v_default, v_nullable
    from information_schema.columns
   where table_schema='public' and table_name='funders' and column_name='is_contracted';
  if v_default is null or position('false' in v_default) = 0 then
    raise exception 'C0.3 assert FAIL: funders.is_contracted default is % (expected false)', v_default;
  end if;
  if exists (select 1 from public.funders where is_contracted) then
    raise exception 'C0.3 assert FAIL: some funders are is_contracted=true after migration (expected all false)';
  end if;

  -- (b) short_code is nullable.
  select is_nullable into v_nullable
    from information_schema.columns
   where table_schema='public' and table_name='funders' and column_name='short_code';
  if v_nullable <> 'YES' then
    raise exception 'C0.3 assert FAIL: funders.short_code should be nullable';
  end if;

  -- (c) payment_terms_days default 0 + not null.
  select column_default, is_nullable into v_default, v_nullable
    from information_schema.columns
   where table_schema='public' and table_name='funder_commission_structures' and column_name='payment_terms_days';
  if v_default is null or position('0' in v_default) = 0 then
    raise exception 'C0.3 assert FAIL: payment_terms_days default is % (expected 0)', v_default;
  end if;
  if v_nullable <> 'NO' then
    raise exception 'C0.3 assert FAIL: payment_terms_days should be NOT NULL';
  end if;

  -- (d) percent_of_finance_charge is now a usable enum value (committed in part 1).
  perform 'percent_of_finance_charge'::public.funder_rate_type;

  -- (e) the contracted-gate trigger exists.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.funder_commission_structures'::regclass
       and tgname = 'enforce_rate_funder_contracted'
  ) then
    raise exception 'C0.3 assert FAIL: enforce_rate_funder_contracted trigger missing';
  end if;

  -- (f) the finance-charge CHECK exists.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.deal_funder_submissions'::regclass
       and conname = 'dfs_finance_charge_required'
  ) then
    raise exception 'C0.3 assert FAIL: dfs_finance_charge_required constraint missing';
  end if;

  -- (g) contracted gate — pick a funder with no rates (avoids the 2 real rows).
  select f.id, f.is_contracted into v_funder, v_old_flag
    from public.funders f
   where not exists (select 1 from public.funder_commission_structures s where s.funder_id = f.id)
   limit 1;

  if v_funder is not null then
    -- (g1) NEGATIVE: rate INSERT blocked while is_contracted=false.
    begin
      insert into public.funder_commission_structures
        (funder_id, deal_type, rate_type, rate_fraction, effective_from)
      values (v_funder, 'non_po', 'percent_of_gross_funded', 0.05, date '2026-01-01')
      returning id into v_rate_id;
      -- reached only if the trigger failed to block
      delete from public.funder_commission_structures where id = v_rate_id;
      raise exception 'C0.3 assert FAIL: rate INSERT allowed on a non-contracted funder';
    exception when raise_exception then null;  -- expected block
    end;

    -- (g2) POSITIVE: flag contracted → rate INSERT succeeds. Then clean up fully.
    update public.funders set is_contracted = true where id = v_funder;
    insert into public.funder_commission_structures
      (funder_id, deal_type, rate_type, rate_fraction, effective_from)
    values (v_funder, 'non_po', 'percent_of_gross_funded', 0.05, date '2026-01-01')
    returning id into v_rate_id;
    if v_rate_id is null then
      raise exception 'C0.3 assert FAIL: rate INSERT blocked on a contracted funder';
    end if;
    delete from public.funder_commission_structures where id = v_rate_id;
    delete from public.activity_logs
      where entity_type = 'funder_commission_structure' and entity_id = v_rate_id;
    update public.funders set is_contracted = coalesce(v_old_flag, false) where id = v_funder;

    -- (h) finance-charge CHECK — NEGATIVE: finance-charge snapshot with null amount
    --     is rejected. Uses a real deal (DEAL-002, no submissions) if present; the
    --     failing INSERT persists nothing (CHECK aborts before AFTER triggers fire).
    select id into v_deal from public.deals where reference = 'DEAL-002' limit 1;
    if v_deal is not null then
      begin
        insert into public.deal_funder_submissions
          (deal_id, funder_id, applied_rate_snapshot)
        values (v_deal, v_funder, jsonb_build_object('rate_type', 'percent_of_finance_charge'))
        returning id into v_sub_id;
        -- reached only if the CHECK failed to block
        delete from public.deal_funder_submissions where id = v_sub_id;
        delete from public.activity_logs
          where entity_type = 'deal_funder_submission' and entity_id = v_sub_id;
        raise exception 'C0.3 assert FAIL: finance-charge CHECK allowed a null finance_charge_amount';
      exception when check_violation then null;  -- expected block
      end;
    else
      raise notice 'C0.3 finance-charge CHECK live-test skipped (DEAL-002 not present)';
    end if;
  else
    raise notice 'C0.3 gate assertions skipped (no funder without rates present)';
  end if;

  raise notice 'C0.3 assertions passed (is_contracted default+scope, short_code nullable, payment_terms_days default, finance_charge enum, contracted gate +/-, finance-charge CHECK)';
end $$;

notify pgrst, 'reload schema';
