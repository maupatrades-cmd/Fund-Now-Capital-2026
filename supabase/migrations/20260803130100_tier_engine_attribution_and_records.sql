-- TIER ENGINE (Sprint 1, Lane 1b) — part 2 of 4: attribution table + ledger shape.
-- ============================================================================
-- Real business truth (TIERS.md): every deal has exactly ONE attribution, and the
-- attribution decides which commission structure applies at LOCK:
--   * Direct_FNC             — Thapelo keeps 100% (no partner/contractor payout)
--   * FNC_Contractor         — flat rand tier lookup, NO 40/60 split
--   * Bright_Destiny_Partner — 40% FNC retention / 60% pool, partner's tier % of pool
--   * Bright_Destiny_Sub_Agent — reserved (Phase later; no tier table defined yet)
--
-- This migration lays the SUBSTRATE the tier engine (part 4) writes against:
--   1. deal_attributions — one row per deal, owner-only, DEFINER-write-only.
--   2. commission_records EXTENSION so the one shared ledger the reader lanes
--      (REPORTS-V1, MY-DEALS-VIEW) already consume can also hold the contractor
--      and Direct_FNC shapes — not just C2's referral-partner shape.
--
-- WHY EXTEND commission_records RATHER THAN A NEW TABLE
--   The reader lanes read commission_records; a separate tier ledger would strand
--   them. The lane brief says to write commission_records and "add columns only if
--   genuinely missing". Verified live (2026-08-03): commission_records has
--   referral_partner_id but NO contractor_id / contractor_share, a NOT-NULL
--   deal_funder_submission_id (the C2 path is per-funded-submission; the tier path
--   fires on picker LOCK with no submission), and a sums check with no room for a
--   contractor payout. So the genuinely-missing pieces are added here.
--
-- BACKWARD COMPATIBILITY (C2 path must be byte-for-byte unchanged)
--   commission_records has 0 rows live. Every change here is additive/relaxing:
--     * new columns are nullable or default 0 → existing C2 inserts unaffected;
--     * deal_funder_submission_id relaxed to NULLable → C2's writer always sets it,
--       so C2 behaviour is identical; only tier rows leave it NULL;
--     * sums check gains "+ contractor_share" (default 0) → C2 rows still satisfy it;
--     * the recompute trigger gains a one-line guard that skips tier rows (submission
--       NULL). C2 rows always carry a submission, so C2's auto-split is untouched.
--
-- EMPTY-TABLE RATIONALE (mirrors the C2.1/C2.2/picker headers): commission_records
--   is empty, so inline ALTER / ADD CONSTRAINT / CREATE INDEX are metadata-only or
--   scan-nothing — instant, no write-blocking lock. The NOT VALID / CONCURRENTLY
--   dance exists to keep locks off POPULATED tables; it buys nothing here (the FK to
--   the populated profiles table takes only a brief, sub-ms SHARE ROW EXCLUSIVE lock
--   on profiles, unavoidable and harmless). deal_attributions is created empty too.
--
-- Money numeric(14,2); percentages numeric(10,4). Per standing rules.
-- ============================================================================

-- ===========================================================================
-- 1. deal_attributions — one attribution per deal. Owner-only, DEFINER-write.
--    attributed_to_id is POLYMORPHIC (referral_partners.id for a partner,
--    profiles.id for a contractor, optionally the owner's profiles.id for
--    Direct_FNC, a future sub_agents.id for sub-agents) so it carries NO single
--    FK — set_deal_attribution() validates the referent per type instead.
-- ===========================================================================
create table if not exists public.deal_attributions (
  id                uuid primary key default gen_random_uuid(),
  deal_id           uuid not null unique
                      references public.deals(id) on delete cascade,
  attribution_type  text not null
                      check (attribution_type in
                        ('Direct_FNC','FNC_Contractor','Bright_Destiny_Partner','Bright_Destiny_Sub_Agent')),
  -- Polymorphic referent. Required for everything except Direct_FNC (Thapelo is the
  -- owner — the referent is implicit). The per-type entity check lives in
  -- set_deal_attribution(); this CHECK only enforces presence.
  attributed_to_id  uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id) on delete set null,
  constraint deal_attributions_referent_presence check (
    attribution_type = 'Direct_FNC' or attributed_to_id is not null
  )
);

comment on table public.deal_attributions is
  'One attribution per deal (TIERS.md): which entity earned commission on the deal. Owner-only (owner-ALL RLS, no partner/contractor policy). Written ONLY by the SECURITY DEFINER set_deal_attribution RPC — direct INSERT/UPDATE/DELETE is revoked from authenticated. attributed_to_id is polymorphic (referral_partners.id | profiles.id | future sub_agents.id) and carries no FK; the RPC validates the referent per attribution_type. POPIA: owner/service-role only.';
comment on column public.deal_attributions.attribution_type is
  'One of Direct_FNC / FNC_Contractor / Bright_Destiny_Partner / Bright_Destiny_Sub_Agent (TIERS.md). Decides which commission structure apply_tier_on_lock uses.';
comment on column public.deal_attributions.attributed_to_id is
  'Polymorphic referent: referral_partners.id (Bright_Destiny_Partner), profiles.id (FNC_Contractor; optional owner id for Direct_FNC), future sub_agents.id (Bright_Destiny_Sub_Agent). NULL only for Direct_FNC. Validated per type by set_deal_attribution.';

create index if not exists idx_deal_attributions_type on public.deal_attributions (attribution_type);
create index if not exists idx_deal_attributions_attributed_to on public.deal_attributions (attributed_to_id);

drop trigger if exists deal_attributions_set_updated_at on public.deal_attributions;
create trigger deal_attributions_set_updated_at
  before update on public.deal_attributions
  for each row execute function public.set_updated_at();

-- Owner-only RLS. No partner/contractor policy — attribution is owner-facing only.
alter table public.deal_attributions enable row level security;
drop policy if exists deal_attributions_owner_all on public.deal_attributions;
create policy deal_attributions_owner_all on public.deal_attributions
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Grants (mirror deal_commissions): authenticated may SELECT (owner reads, scoped by
-- the owner-only policy; a partner/contractor SELECT returns zero rows) but holds no
-- write privilege — every write is a DEFINER RPC. `revoke all` first strips the
-- Supabase default in full (incl. TRUNCATE, which would bypass RLS); grant back SELECT.
revoke all on table public.deal_attributions from anon, public, authenticated;
grant select on table public.deal_attributions to authenticated;

-- ===========================================================================
-- 2. commission_records extension — add the contractor + attribution shape.
--    All additive/backward-compatible (see header). commission_records is empty.
-- ===========================================================================

-- 2a. New columns.
alter table public.commission_records
  add column if not exists contractor_id     uuid,
  add column if not exists contractor_share  numeric(14,2) not null default 0,
  add column if not exists attribution_type  text;

-- contractor_id → profiles.id (contractors are profiles with role='contractor').
-- SET NULL on delete: removing a contractor profile must not delete the ledger row.
alter table public.commission_records
  drop constraint if exists commission_records_contractor_fkey;
alter table public.commission_records
  add constraint commission_records_contractor_fkey
  foreign key (contractor_id) references public.profiles(id) on delete set null;

-- contractor_share never negative (a payout, not a clawback).
alter table public.commission_records
  drop constraint if exists commission_records_contractor_share_nonneg_ck;
alter table public.commission_records
  add constraint commission_records_contractor_share_nonneg_ck
  check (contractor_share >= 0);

-- attribution_type: which model produced the row (NULL for legacy/C2 rows).
alter table public.commission_records
  drop constraint if exists commission_records_attribution_type_ck;
alter table public.commission_records
  add constraint commission_records_attribution_type_ck
  check (attribution_type is null or attribution_type in
    ('Direct_FNC','FNC_Contractor','Bright_Destiny_Partner','Bright_Destiny_Sub_Agent'));

create index if not exists idx_commission_records_contractor
  on public.commission_records (contractor_id);

comment on column public.commission_records.contractor_id is
  'Tier engine (attribution FNC_Contractor): the contractor (profiles.id) this commission is owed to. NULL for partner/direct/C2 rows. FK ON DELETE SET NULL. Mutually exclusive with referral_partner_id.';
comment on column public.commission_records.contractor_share is
  'Tier engine: flat rand contractor commission (TIERS.md Section 2). 0 for partner/direct/C2 rows. Included in the sums check.';
comment on column public.commission_records.attribution_type is
  'Tier engine: the deal_attributions.attribution_type that produced this row (Direct_FNC/FNC_Contractor/Bright_Destiny_Partner/Bright_Destiny_Sub_Agent). NULL for C2 (funder-submission) rows.';

-- 2b. Relax deal_funder_submission_id to NULLable — tier rows have no funder
--     submission (they derive from a picker LOCK, not a funded submission). C2's
--     write_commission_record ALWAYS sets it, so the C2 path is unchanged; only
--     tier rows leave it NULL. The existing partial unique
--     (commission_records_submission_unique WHERE status<>'void') is unaffected:
--     Postgres treats NULLs as distinct, so many tier rows coexist under it.
alter table public.commission_records
  alter column deal_funder_submission_id drop not null;

-- 2c. Extend the sums check to account for the contractor payout.
--     C2 rows: company_retention + partner_share + owner_share + 0 = gross (unchanged).
--     Contractor rows: company_retention + 0 + 0 + contractor_share = gross.
--     Direct rows: company_retention(=gross) + 0 + 0 + 0 = gross.
alter table public.commission_records drop constraint if exists commission_records_sums_ck;
alter table public.commission_records
  add constraint commission_records_sums_ck
  check ((company_retention + partner_share + owner_share + contractor_share) = gross_commission);

-- 2d. Tier-engine idempotency arbiter: at most one non-void tier commission per deal.
--     Tier rows are identified by a NULL submission id (distinct from the C2
--     one-per-submission arbiter). apply_tier_on_lock / set_contractor_manual_amount
--     rely on this as the belt-and-braces backstop behind their advisory lock.
create unique index if not exists commission_records_tier_deal_unique
  on public.commission_records (deal_id)
  where (deal_funder_submission_id is null and status <> 'void');

-- ===========================================================================
-- 3. Guard commission_records_recompute() so it NEVER touches tier rows.
--    This is a byte-for-byte copy of the live C2.2 body with ONE addition: an
--    early return for rows with a NULL deal_funder_submission_id (tier rows). Those
--    rows carry FINAL, attribution-aware split values written by apply_tier_on_lock;
--    C2's referral-partner-only auto-split (calculate_commission) must not clobber
--    them. C2 rows always carry a submission id, so the C2 code path below is
--    reached exactly as before — no behaviour change for the existing path.
-- ===========================================================================
create or replace function public.commission_records_recompute()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare
  b public.commission_breakdown;
begin
  -- Tier-engine rows (Sprint 1) carry a NULL deal_funder_submission_id and are
  -- inserted with final, attribution-aware split values by apply_tier_on_lock. The
  -- C2 auto-split (referral-partner 40/60 via calculate_commission) does not know
  -- about the contractor / Direct_FNC shapes, so it must leave these rows alone.
  if new.deal_funder_submission_id is null then
    return new;
  end if;

  -- Freeze: only (re)compute when the split's inputs actually change (C2.2 rule).
  if tg_op = 'UPDATE'
     and new.gross_commission  is not distinct from old.gross_commission
     and new.is_purchase_order is not distinct from old.is_purchase_order then
    return new;
  end if;

  b := public.calculate_commission(new.gross_commission, new.is_purchase_order);
  new.tier_pct          := b.tier_pct;
  new.company_retention := b.company_retention;
  new.partner_pool      := b.partner_pool;

  if new.referral_partner_id is null then
    -- G4: no partner -> owner keeps the whole pool; nothing is owed to a partner.
    new.tier_pct      := 0;
    new.partner_share := 0;
    new.owner_share   := b.partner_pool;
  else
    new.partner_share := b.partner_share;
    new.owner_share   := b.owner_share;
  end if;

  new.computed_at := now();
  return new;
end;
$function$;

-- ===========================================================================
-- 4. Assertions — structural (no data). RAISE (roll back) on any drift.
-- ===========================================================================
do $$
declare v_cnt int; v_using text;
begin
  -- deal_attributions shape
  if to_regclass('public.deal_attributions') is null then raise exception 'assert: deal_attributions missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid='public.deal_attributions'::regclass
      and contype='u' and conname like '%deal_id%') then
    -- unique may be named deal_attributions_deal_id_key; confirm a UNIQUE on deal_id exists
    if not exists (select 1 from pg_indexes where schemaname='public' and tablename='deal_attributions'
        and indexdef ilike '%unique%(deal_id)%') then
      raise exception 'assert: deal_attributions has no UNIQUE(deal_id)';
    end if;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.deal_attributions'::regclass
      and conname='deal_attributions_referent_presence') then
    raise exception 'assert: deal_attributions_referent_presence CHECK missing'; end if;

  -- deal_attributions RLS: enabled, exactly one owner-only policy
  if not (select relrowsecurity from pg_class where oid='public.deal_attributions'::regclass) then
    raise exception 'assert: RLS not enabled on deal_attributions'; end if;
  select count(*) into v_cnt from pg_policies where schemaname='public' and tablename='deal_attributions';
  if v_cnt <> 1 then raise exception 'assert: deal_attributions must have exactly 1 policy, found %', v_cnt; end if;

  -- deal_attributions grants: authenticated holds EXACTLY SELECT; anon holds nothing.
  select count(*) into v_cnt from information_schema.role_table_grants
    where table_schema='public' and table_name='deal_attributions' and grantee='authenticated';
  if v_cnt <> 1 then raise exception 'assert: authenticated must hold exactly SELECT on deal_attributions, found % privileges', v_cnt; end if;
  if not exists (select 1 from information_schema.role_table_grants
      where table_schema='public' and table_name='deal_attributions' and grantee='authenticated' and privilege_type='SELECT') then
    raise exception 'assert: authenticated must hold SELECT on deal_attributions'; end if;
  if exists (select 1 from information_schema.role_table_grants
      where table_schema='public' and table_name='deal_attributions' and grantee='anon') then
    raise exception 'assert: anon still holds a grant on deal_attributions'; end if;

  -- commission_records new columns + types
  if not exists (select 1 from information_schema.columns where table_schema='public'
      and table_name='commission_records' and column_name='contractor_id') then
    raise exception 'assert: commission_records.contractor_id missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public'
      and table_name='commission_records' and column_name='contractor_share'
      and numeric_precision=14 and numeric_scale=2 and is_nullable='NO') then
    raise exception 'assert: commission_records.contractor_share not numeric(14,2) NOT NULL'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public'
      and table_name='commission_records' and column_name='attribution_type') then
    raise exception 'assert: commission_records.attribution_type missing'; end if;

  -- deal_funder_submission_id is now nullable
  if exists (select 1 from information_schema.columns where table_schema='public'
      and table_name='commission_records' and column_name='deal_funder_submission_id' and is_nullable='NO') then
    raise exception 'assert: deal_funder_submission_id should be nullable now'; end if;

  -- extended sums check includes contractor_share
  select pg_get_constraintdef(oid) into v_using from pg_constraint
    where conrelid='public.commission_records'::regclass and conname='commission_records_sums_ck';
  if v_using is null or v_using not ilike '%contractor_share%' then
    raise exception 'assert: sums_ck does not include contractor_share (got %)', v_using; end if;

  -- tier idempotency partial unique present
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='commission_records'
      and indexname='commission_records_tier_deal_unique') then
    raise exception 'assert: commission_records_tier_deal_unique missing'; end if;

  -- contractor FK present
  if not exists (select 1 from pg_constraint where conrelid='public.commission_records'::regclass
      and conname='commission_records_contractor_fkey') then
    raise exception 'assert: commission_records_contractor_fkey missing'; end if;

  -- recompute trigger guard present (function body mentions the tier-row skip)
  if pg_get_functiondef('public.commission_records_recompute()'::regprocedure)
       not ilike '%deal_funder_submission_id is null%' then
    raise exception 'assert: commission_records_recompute() missing the tier-row guard'; end if;
  -- ...and still partner-aware for the C2 path
  if pg_get_functiondef('public.commission_records_recompute()'::regprocedure) not ilike '%calculate_commission%' then
    raise exception 'assert: commission_records_recompute() no longer calls calculate_commission'; end if;

  raise notice 'Tier engine part 2 structural assertions passed (deal_attributions + commission_records extension + recompute guard).';
end $$;

notify pgrst, 'reload schema';
