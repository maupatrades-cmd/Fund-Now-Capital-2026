-- Reconcile main <-> live: funders.phone column + the funder data mutations that were
-- applied DIRECTLY to live during the 2026-07-27 funder-billing session (never captured
-- in a migration until now). This file brings main's migration history in line with live.
--
-- WHY a single reconcile migration: the phone column was added via apply_migration, and
-- the data changes (Bright On Capital rename, Merchant Capital billing block, Spartan +
-- AAA Consortium additions, the BRIGHTON short_code fix) were done via direct owner SQL.
-- None were in the repo. This captures all of them.
--
-- IDEMPOTENT + SAFE TO (RE-)APPLY: every statement is a no-op against live (the state is
-- already present) and reproduces the change on a fresh DB. No hardcoded generated UUIDs
-- (new funders insert by natural-key guard, letting the id default apply). Money-safe:
-- guarded so a re-run never clobbers a later owner edit.
--
-- Not schema-heavy: one nullable column add (metadata-only on PG11+, no rewrite/lock on
-- the small funders table) + guarded data statements. RLS unchanged (new column inherits
-- the funders owner-only policies; partner surfaces read anonymised views, not raw rows).
-- ============================================================================

-- 1. phone column (nullable text; metadata-only). Idempotent via IF NOT EXISTS.
alter table public.funders add column if not exists phone text;

comment on column public.funders.phone is
  'Funder contact phone number (nullable, e.g. +27 11 217 2880). Owner-only; not part of the invoice INVOICE TO block.';

-- 2. "Brighton Capital" -> "Bright On Capital" (owner-confirmed real name) + legal_name.
--    Self-limiting: fires only while the old name is still present (no-op on live).
update public.funders
   set name       = 'Bright On Capital',
       legal_name = coalesce(legal_name, 'Bright On Capital')
 where name = 'Brighton Capital';

-- 2b. short_code fix "BRIGHT ON" (malformed, had a space) -> "BRIGHTON".
--     Fires only when not already correct (no-op on live).
update public.funders
   set short_code = 'BRIGHTON'
 where name = 'Bright On Capital' and short_code is distinct from 'BRIGHTON';

-- 3. Merchant Capital INVOICE TO billing block (populate-once guard on legal_name null).
--    VAT intentionally NOT set (owner to confirm / not-registered -> stays NULL).
--    No-op on live (legal_name already set); populates on a fresh DB.
update public.funders
   set legal_name           = 'Merchant Capital (Pty) Ltd',
       billing_address      = '32 Impala Road, Chislehurston, Johannesburg 2196, South Africa',
       company_registration = '2012/217256/07',
       accounts_email       = 'info@merchantcapital.co.za',
       phone                = '+27 11 217 2880'
 where name = 'Merchant Capital' and legal_name is null;

-- 4. Two new SIGNED/CONTRACTED funders (SPEC S1 deliberate-add). Insert-once by name
--    guard; id + timestamps take their column defaults (no hardcoded generated UUIDs).
--    display_name_for_partner = new fictional names beyond the original 21-name pool.
insert into public.funders (name, display_name_for_partner, is_contracted, short_code)
select 'Spartan', 'Naledi', true, 'SPARTAN'
where not exists (select 1 from public.funders where name = 'Spartan');

insert into public.funders (name, display_name_for_partner, is_contracted, short_code)
select 'AAA Consortium', 'Sizwe', true, 'AAA'
where not exists (select 1 from public.funders where name = 'AAA Consortium');

-- 5. Assertions — verify the reconciled end-state (rolls the migration back on drift).
--    Unconditional for what this migration always guarantees; conditional for the
--    update-targets (robust if a base seed row is absent in some CI state).
do $$
begin
  -- phone column exists
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='funders' and column_name='phone'
  ) then raise exception 'reconcile: funders.phone column missing'; end if;

  -- the two new contracted funders exist
  if not exists (select 1 from public.funders where name='Spartan'
                   and display_name_for_partner='Naledi' and short_code='SPARTAN' and is_contracted)
    then raise exception 'reconcile: Spartan not present/contracted'; end if;
  if not exists (select 1 from public.funders where name='AAA Consortium'
                   and display_name_for_partner='Sizwe' and short_code='AAA' and is_contracted)
    then raise exception 'reconcile: AAA Consortium not present/contracted'; end if;

  -- the old name is gone
  if exists (select 1 from public.funders where name='Brighton Capital')
    then raise exception 'reconcile: legacy "Brighton Capital" name still present'; end if;

  -- conditional checks on update-targets (only if the base row exists)
  if exists (select 1 from public.funders where name='Bright On Capital') then
    if not exists (select 1 from public.funders where name='Bright On Capital' and short_code='BRIGHTON')
      then raise exception 'reconcile: Bright On Capital short_code not BRIGHTON'; end if;
  end if;
  if exists (select 1 from public.funders where name='Merchant Capital') then
    if not exists (select 1 from public.funders where name='Merchant Capital' and legal_name is not null)
      then raise exception 'reconcile: Merchant Capital legal_name not populated'; end if;
  end if;

  raise notice 'funders phone+billing reconcile: assertions passed.';
end $$;
