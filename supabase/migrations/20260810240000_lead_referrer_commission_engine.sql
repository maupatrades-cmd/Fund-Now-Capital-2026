-- Build 56 — Lead-Referrer commission engine (ADDITIVE, money-critical)
-- ============================================================================
-- A SEPARATE, additive commission engine for the Lead Referrer (LR) role,
-- locked in docs/lead-referrer-role.md + FNC-CONSOLIDATION §2.3–2.5.
--
-- THE LOCKED FORMULA
--   An LR earns X% of DOCTOR'S earning on a deal, where X is the LR's tier:
--     Level 1  25%   0–9  closed  (day-one entry)
--     Level 2  35%   10–24
--     Level 3  40%   25–49
--     Level 4  50%   50+
--   Money source = THAPELO'S PERSONAL RESIDUAL on the deal (commission_records
--   .owner_share). The LR earning is carved OUT of owner_share. It is NOT from
--   FNC's 40% retention (company_retention) and NOT from Doctor's earning
--   (partner_share).
--
-- INVARIANTS (enforced by CHECK constraints + proven in the DO-block below):
--   * Doctor's earning (partner_share)  — UNTOUCHED by LR presence (we only READ it).
--   * FNC retention (company_retention)  — UNTOUCHED (never referenced here).
--   * lr_earning <= doctor_earning       on the same deal.
--   * owner_net_after_lr = owner_share − lr_earning, and >= 0.
--
-- WHAT THIS DOES NOT DO (hard guardrails):
--   * Does NOT modify calculate_commission / commission_tier_pct / the partner
--     recompute trigger / write_commission_record — the locked partner engine.
--     It READS Doctor's numbers from the existing commission_records ledger.
--   * Does NOT recompute Doctor's or FNC's money. Money is read, never re-derived.
--
-- SCHEMA READS (verified live, read-only, 2026-08-10):
--   commission_records.partner_share     = Doctor's earning (the LR's % base)
--   commission_records.owner_share       = Thapelo's residual (the LR's money source)
--   commission_records.company_retention = FNC's 40% retention (untouched)
--   commission_records.referral_partner_id -> referral_partners(id)  (the Doctor)
--   deals.referral_partner_id            -> referral_partners(id)     (the Doctor)
--   Rounding: calculate_commission uses round(x, 2) (half-away-from-zero) — matched.
--
-- ATTRIBUTION COLUMNS ADDED (both nullable, both absent live before this build):
--   profiles.sourced_via_partner_id -> referral_partners(id)  null=Path A, Doctor=Path B
--   leads.sourced_by_lead_refer_id  -> profiles(id)           the LR who sourced the lead
--   NOTE: the locked doc phrases sourced_via_partner_id as "Doctor's profile id".
--   In this schema a partner (Doctor) is a referral_partners row and the money
--   ledger keys on referral_partners(id); referencing referral_partners keeps the
--   Path-B guard apples-to-apples with deals.referral_partner_id and matches the
--   doc's "leads.referral_partner_id auto-set from sourced_via_partner_id" rule
--   with zero translation. Flagged as an owner-confirm reconciliation item.
--
-- Money numeric(14,2); percentages numeric(10,4). Per standing money rules.
-- The new ledger table is created empty; profiles/leads are populated, so their
-- new FKs are added NOT VALID then VALIDATE'd (tiny tables — instant), per the
-- house populated-table FK convention. No CONCURRENTLY index is needed: this
-- engine's owner RPC queries by deal, not by the new attribution columns.
-- ============================================================================

-- ===========================================================================
-- 1. Attribution columns on the populated tables (nullable, additive).
-- ===========================================================================
alter table public.profiles add column if not exists sourced_via_partner_id uuid;
alter table public.leads    add column if not exists sourced_by_lead_refer_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_sourced_via_partner_fkey') then
    alter table public.profiles
      add constraint profiles_sourced_via_partner_fkey
      foreign key (sourced_via_partner_id)
      references public.referral_partners (id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_sourced_by_lead_refer_fkey') then
    alter table public.leads
      add constraint leads_sourced_by_lead_refer_fkey
      foreign key (sourced_by_lead_refer_id)
      references public.profiles (id) on delete set null not valid;
  end if;
end $$;

-- Validate immediately — both tables are tiny (test data long removed), so the
-- validation scan is sub-millisecond and takes only a SHARE UPDATE EXCLUSIVE lock.
alter table public.profiles validate constraint profiles_sourced_via_partner_fkey;
alter table public.leads    validate constraint leads_sourced_by_lead_refer_fkey;

comment on column public.profiles.sourced_via_partner_id is
  'Lead Referrer attribution channel: null = Path A (FNC-direct), or the referral_partners id of the introducing partner (Doctor / Bright Destiny) = Path B. Set at invitation time. Only a Path-B LR generates a lead_referrer_commission_records row from that Doctor''s owner_share pool.';
comment on column public.leads.sourced_by_lead_refer_id is
  'The Lead Referrer (profiles.id) who sourced this lead. leads.referral_partner_id is auto-set from that LR''s sourced_via_partner_id at lead creation (Path B attributes to Doctor).';

-- ===========================================================================
-- 2. Tier ladder — pure resolvers (immutable, search_path='').
-- ===========================================================================
-- closed-deal count -> tier level (1..4). Level 1 is day-one entry (count 0).
create or replace function public.lead_referrer_tier(closed_deal_count int)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when closed_deal_count is null or closed_deal_count < 0 then 1  -- fail safe to entry tier
    when closed_deal_count <= 9  then 1
    when closed_deal_count <= 24 then 2
    when closed_deal_count <= 49 then 3
    else 4
  end;
$$;

comment on function public.lead_referrer_tier(int) is
  'Lead Referrer tier level from their closed-deal count (locked ladder): 0–9 -> 1, 10–24 -> 2, 25–49 -> 3, 50+ -> 4. Level 1 is day-one entry.';

-- tier level -> % of Doctor's earning (numeric(10,4) fraction).
create or replace function public.lead_referrer_tier_pct(p_tier int)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_tier
    when 1 then 0.2500
    when 2 then 0.3500
    when 3 then 0.4000
    when 4 then 0.5000
  end::numeric;
$$;

comment on function public.lead_referrer_tier_pct(int) is
  'Lead Referrer tier percentage of Doctor''s earning: L1 25%, L2 35%, L3 40%, L4 50% (locked). Null for an out-of-range tier (caller must pass 1..4).';

-- ===========================================================================
-- 3. Pure calculator — LR earning from Doctor's earning + tier %.
--    Rounds with round(x, 2) to MATCH calculate_commission (half-away-from-zero).
--    Enforces the locked ceiling: LR earning can never exceed Doctor's earning.
-- ===========================================================================
create or replace function public.calculate_lead_referrer_earning(
  p_doctor_earning numeric,
  p_tier_pct       numeric
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_doctor numeric(14,2);
  v_lr     numeric(14,2);
begin
  if p_doctor_earning is null or p_doctor_earning < 0 then
    raise exception 'doctor_earning must be non-negative, got %', p_doctor_earning;
  end if;
  if p_tier_pct is null or p_tier_pct < 0 or p_tier_pct > 0.5 then
    raise exception 'lead_referrer tier_pct must be in [0, 0.5], got %', p_tier_pct;
  end if;

  v_doctor := round(p_doctor_earning, 2);
  v_lr     := round(v_doctor * p_tier_pct, 2);   -- same rounding as calculate_commission

  -- Locked constraint: LR's earning must never exceed Doctor's on the same deal.
  -- With the tier ceiling at 50% this is inherently satisfied; assert defensively.
  if v_lr > v_doctor then
    raise exception 'lead_referrer earning % exceeds doctor earning % (invariant violated)', v_lr, v_doctor;
  end if;
  return v_lr;
end;
$$;

comment on function public.calculate_lead_referrer_earning(numeric, numeric) is
  'Pure LR-earning calculator: round(doctor_earning * tier_pct, 2), matching calculate_commission rounding. Enforces LR earning <= Doctor earning. Does NOT touch FNC retention or Doctor''s share — the caller carves the result out of the owner''s residual.';

-- ===========================================================================
-- 4. Lifecycle enum (minimal, mirrors the sensible subset of commission_state).
--    earned -> settled, plus void. (No funder-invoice cascade applies to LR pay,
--    which is Thapelo's direct personal residual.)
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_referrer_commission_state') then
    create type public.lead_referrer_commission_state as enum ('earned', 'settled', 'void');
  end if;
end $$;

-- ===========================================================================
-- 5. The LR commission ledger. One non-void row per (deal, LR). Snapshots the
--    Doctor earning + owner residual it was carved from, the tier at write time,
--    and the resulting LR earning + owner net. Money numeric(14,2).
-- ===========================================================================
create table if not exists public.lead_referrer_commission_records (
  id                    uuid primary key default gen_random_uuid(),
  deal_id               uuid not null references public.deals (id)               on delete cascade,
  lead_refer_id         uuid not null references public.profiles (id)            on delete restrict,
  doctor_partner_id     uuid not null references public.referral_partners (id)   on delete restrict,
  -- provenance: the Doctor commission_records row(s) read; null when aggregated
  -- across multiple funded submissions on the deal (count kept in notes).
  commission_record_id  uuid          references public.commission_records (id)  on delete set null,

  -- money snapshots (all carved from / measured against the owner's residual)
  doctor_earning        numeric(14,2) not null,   -- = SUM(partner_share) on the deal (UNTOUCHED source figure)
  owner_share_snapshot  numeric(14,2) not null,   -- = SUM(owner_share)   on the deal (Thapelo residual, pre-LR)
  tier                  int           not null,
  tier_pct              numeric(10,4) not null,
  lr_earning            numeric(14,2) not null,   -- = round(doctor_earning * tier_pct, 2)
  owner_net_after_lr    numeric(14,2) not null,   -- = owner_share_snapshot - lr_earning
  closed_deal_count     int           not null,   -- the LR's prior closed-deal count that resolved the tier

  status                public.lead_referrer_commission_state not null default 'earned',
  earned_at             timestamptz,
  settled_at            timestamptz,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint lrc_tier_range        check (tier between 1 and 4),
  constraint lrc_doctor_nonneg     check (doctor_earning >= 0),
  constraint lrc_owner_nonneg      check (owner_share_snapshot >= 0),
  constraint lrc_lr_nonneg         check (lr_earning >= 0),
  -- INVARIANT: LR earning never exceeds Doctor's earning on the same deal.
  constraint lrc_lr_le_doctor      check (lr_earning <= doctor_earning),
  -- INVARIANT: owner net is exactly the residual minus the LR earning...
  constraint lrc_owner_net_defn    check (owner_net_after_lr = owner_share_snapshot - lr_earning),
  -- ...and the owner is never pushed negative.
  constraint lrc_owner_net_nonneg  check (owner_net_after_lr >= 0)
);

-- Idempotency arbiter: exactly one non-void LR commission per (deal, LR).
create unique index if not exists lead_referrer_commission_records_deal_lr_unique
  on public.lead_referrer_commission_records (deal_id, lead_refer_id)
  where (status <> 'void');

create index if not exists idx_lead_referrer_commission_records_lr
  on public.lead_referrer_commission_records (lead_refer_id);
create index if not exists idx_lead_referrer_commission_records_deal
  on public.lead_referrer_commission_records (deal_id);

comment on table public.lead_referrer_commission_records is
  'Additive Lead-Referrer commission ledger (Build 56). One non-void row per (deal, LR): the LR earns tier% of Doctor''s earning (partner_share), carved from Thapelo''s owner_share residual. Doctor''s and FNC''s figures are read, never modified. Owner-full RLS; the LR sees only their own Rand figure via lead_referrer_my_earnings (never Doctor''s gross/pool/tier internals).';

-- ===========================================================================
-- 6. RLS. Owner: full. The LR gets NO direct base-table access (the base row
--    carries Doctor's earning + the owner residual — S7C-forbidden to the LR).
--    The LR reads ONLY their own Rand figure via the projection view below.
-- ===========================================================================
alter table public.lead_referrer_commission_records enable row level security;

drop policy if exists lead_referrer_commission_records_owner_all
  on public.lead_referrer_commission_records;
create policy lead_referrer_commission_records_owner_all
  on public.lead_referrer_commission_records
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

grant select on public.lead_referrer_commission_records to authenticated;  -- RLS gates to owner only

-- ===========================================================================
-- 7. LR-facing projection (S7C). Runs with the view owner's rights
--    (security_invoker off) to read the owner-only base table; security_barrier
--    blocks predicate push-down leaks; the WHERE scopes to the caller's own
--    rows. Exposes ONLY the LR's own Rand figure + their own tier/status —
--    NEVER doctor_earning, owner_share, owner_net, tier_pct, or provenance ids.
-- ===========================================================================
create or replace view public.lead_referrer_my_earnings
with (security_barrier = true) as
  select
    r.id,
    r.deal_id,
    r.lr_earning,      -- the LR's own earning in Rands (the only money they see)
    r.tier,            -- their own tier/level (gamification-safe)
    r.status,
    r.earned_at,
    r.settled_at,
    r.created_at
  from public.lead_referrer_commission_records r
  where public.is_owner()
     or r.lead_refer_id = (select auth.uid());

comment on view public.lead_referrer_my_earnings is
  'LR-safe projection of lead_referrer_commission_records: the caller''s OWN lr_earning (Rands), tier, and status only. Excludes doctor_earning, owner_share_snapshot, owner_net_after_lr, tier_pct, and all provenance ids per S7C. Owner reads the base table directly.';

grant select on public.lead_referrer_my_earnings to authenticated;

-- ===========================================================================
-- 8. write_lead_referrer_commission(p_deal_id, p_lead_refer_id) — the single
--    LR-commission writer. Owner-only, SECURITY DEFINER, search_path='',
--    advisory-locked per (deal, LR), idempotent, RETURNING-checked.
--
--    Reads Doctor's earning + the owner residual from the EXISTING
--    commission_records for the deal (SUM over the deal's non-void rows for the
--    deal's referral partner). Never recomputes Doctor's or FNC's money.
-- ===========================================================================
create or replace function public.write_lead_referrer_commission(
  p_deal_id       uuid,
  p_lead_refer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal            public.deals;
  v_doctor          uuid;         -- deals.referral_partner_id (the Doctor)
  v_lr_channel      uuid;         -- profiles.sourced_via_partner_id of the LR
  v_doctor_earning  numeric(14,2);
  v_owner_share     numeric(14,2);
  v_rows            int;
  v_single_cr       uuid;
  v_count           int;
  v_tier            int;
  v_pct             numeric(10,4);
  v_lr_earning      numeric(14,2);
  v_owner_net       numeric(14,2);
  v_existing        uuid;
  v_ex_status       public.lead_referrer_commission_state;
  v_ex_pct          numeric(10,4);
  v_id              uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can write lead-referrer commission records';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('write_lead_referrer_commission:' || p_deal_id::text || ':' || p_lead_refer_id::text));

  -- Deal + its Doctor (referral partner).
  select * into v_deal from public.deals where id = p_deal_id;
  if v_deal.id is null then
    raise exception 'Deal % not found', p_deal_id;
  end if;
  v_doctor := v_deal.referral_partner_id;
  if v_doctor is null then
    raise exception 'Deal % has no referral partner — a Path-A / no-Doctor deal generates no LR commission from a Doctor pool', p_deal_id;
  end if;

  -- Path-B guard: the LR must be sourced via THIS deal's Doctor.
  select sourced_via_partner_id into v_lr_channel
    from public.profiles where id = p_lead_refer_id;
  if not found then
    raise exception 'Lead referrer profile % not found', p_lead_refer_id;
  end if;
  if v_lr_channel is null then
    raise exception 'Lead referrer % is Path A (no sourcing partner) — no LR commission from a Doctor pool', p_lead_refer_id;
  end if;
  if v_lr_channel is distinct from v_doctor then
    raise exception 'Lead referrer % is sourced via partner %, not this deal''s partner % (Path-B mismatch)',
      p_lead_refer_id, v_lr_channel, v_doctor;
  end if;

  -- Sourcing gate (Gitar): being UNDER the Doctor is not enough — the LR must be
  -- the one who actually SOURCED this deal's lead, or any LR under the Doctor
  -- could be paid on deals they never sourced, wrongly carving owner residual.
  -- A deal has exactly one lead (deals.lead_id), so exactly one LR can source it
  -- — this also structurally enforces ONE LR commission per deal.
  if not exists (
    select 1 from public.deals d
      join public.leads l on l.id = d.lead_id
     where d.id = p_deal_id
       and l.sourced_by_lead_refer_id = p_lead_refer_id
  ) then
    raise exception 'Lead referrer % did not source deal %''s lead — only the deal''s lead sourcer earns an LR commission',
      p_lead_refer_id, p_deal_id;
  end if;

  -- Over-carve guard (Gitar): at most ONE LR commission per deal. The sourcing
  -- gate already guarantees this, but reject explicitly if a DIFFERENT LR already
  -- holds a non-void commission on this deal, so two LRs can never each carve
  -- from the full owner residual and push it negative.
  if exists (
    select 1 from public.lead_referrer_commission_records
     where deal_id = p_deal_id and lead_refer_id <> p_lead_refer_id and status <> 'void'
  ) then
    raise exception 'Deal % already has an LR commission for a different lead referrer', p_deal_id;
  end if;

  -- Idempotency + freshness (Gitar): a non-void row already exists for (deal, LR)?
  select id, status, tier_pct into v_existing, v_ex_status, v_ex_pct
    from public.lead_referrer_commission_records
    where deal_id = p_deal_id and lead_refer_id = p_lead_refer_id and status <> 'void'
    limit 1;
  if v_existing is not null then
    -- A settled/paid LR commission is frozen evidence — never recompute.
    if v_ex_status <> 'earned' then
      return jsonb_build_object('was_created', false, 'lead_referrer_commission_id', v_existing,
                                'reason', 'already_' || v_ex_status::text);
    end if;
    -- 'earned' → refresh against the CURRENT Doctor earning (co-funding may have
    -- added commission_records rows since the first write). Tier stays FROZEN at
    -- first-write: re-crediting the same deal must never bump the LR's tier.
    select coalesce(sum(cr.partner_share), 0)::numeric(14,2),
           coalesce(sum(cr.owner_share),   0)::numeric(14,2)
      into v_doctor_earning, v_owner_share
      from public.commission_records cr
     where cr.deal_id = p_deal_id and cr.referral_partner_id = v_doctor and cr.status <> 'void';
    v_lr_earning := public.calculate_lead_referrer_earning(v_doctor_earning, v_ex_pct);
    v_owner_net  := v_owner_share - v_lr_earning;
    if v_owner_net < 0 then
      raise exception 'Refreshed LR earning % exceeds owner residual % on deal %', v_lr_earning, v_owner_share, p_deal_id;
    end if;
    update public.lead_referrer_commission_records
       set doctor_earning = v_doctor_earning, owner_share_snapshot = v_owner_share,
           lr_earning = v_lr_earning, owner_net_after_lr = v_owner_net, updated_at = now()
     where id = v_existing and status = 'earned'
       and (doctor_earning is distinct from v_doctor_earning or lr_earning is distinct from v_lr_earning)
     returning id into v_id;
    return jsonb_build_object('was_created', false, 'lead_referrer_commission_id', v_existing,
                              'was_refreshed', (v_id is not null),
                              'reason', case when v_id is not null then 'refreshed' else 'already_current' end);
  end if;

  -- READ Doctor's earning + the owner residual on the deal. Never recompute.
  -- Sum across the deal's non-void commission rows for the deal's referral partner
  -- (future-proof for co-funded deals with multiple funded submissions).
  select coalesce(sum(cr.partner_share), 0)::numeric(14,2),
         coalesce(sum(cr.owner_share),   0)::numeric(14,2),
         count(*),
         max(cr.id)
    into v_doctor_earning, v_owner_share, v_rows, v_single_cr
    from public.commission_records cr
   where cr.deal_id = p_deal_id
     and cr.referral_partner_id = v_doctor
     and cr.status <> 'void';

  if v_rows = 0 then
    raise exception 'No Doctor commission on deal % yet — fund the deal (write_commission_record) first', p_deal_id;
  end if;
  if v_doctor_earning <= 0 then
    raise exception 'Doctor earning on deal % is zero — nothing to base an LR commission on', p_deal_id;
  end if;

  -- Tier from the LR's prior closed-deal count (distinct deals already carrying a
  -- non-void LR commission for this LR). Day-one = 0 -> Level 1.
  select count(distinct deal_id) into v_count
    from public.lead_referrer_commission_records
   where lead_refer_id = p_lead_refer_id and status <> 'void';

  v_tier       := public.lead_referrer_tier(v_count);
  v_pct        := public.lead_referrer_tier_pct(v_tier);
  v_lr_earning := public.calculate_lead_referrer_earning(v_doctor_earning, v_pct);
  v_owner_net  := v_owner_share - v_lr_earning;

  if v_owner_net < 0 then
    -- Should be impossible with the real engine numbers; fail closed rather than
    -- push the owner's residual negative.
    raise exception 'LR earning % would push owner net negative (residual %) on deal %',
      v_lr_earning, v_owner_share, p_deal_id;
  end if;

  insert into public.lead_referrer_commission_records (
    deal_id, lead_refer_id, doctor_partner_id,
    commission_record_id, doctor_earning, owner_share_snapshot,
    tier, tier_pct, lr_earning, owner_net_after_lr, closed_deal_count,
    status, earned_at, notes
  ) values (
    p_deal_id, p_lead_refer_id, v_doctor,
    case when v_rows = 1 then v_single_cr else null end,
    v_doctor_earning, v_owner_share,
    v_tier, v_pct, v_lr_earning, v_owner_net, v_count,
    'earned', now(),
    'Auto-written from ' || v_rows || ' commission_records row(s); LR earns ' ||
    to_char(v_pct * 100, 'FM990.00') || '% (L' || v_tier || ') of Doctor earning R' ||
    to_char(v_doctor_earning, 'FM999G999G990D00') || ', carved from owner residual.'
  )
  on conflict (deal_id, lead_refer_id) where (status <> 'void') do nothing
  returning id into v_id;

  if v_id is null then
    -- Lost the idempotency race — report the surviving row.
    select id into v_existing from public.lead_referrer_commission_records
      where deal_id = p_deal_id and lead_refer_id = p_lead_refer_id and status <> 'void'
      limit 1;
    return jsonb_build_object('was_created', false, 'lead_referrer_commission_id', v_existing,
                              'reason', 'lost_race');
  end if;

  return jsonb_build_object(
    'was_created', true,
    'lead_referrer_commission_id', v_id,
    'tier', v_tier,
    'tier_pct', v_pct,
    'doctor_earning', v_doctor_earning,
    'lr_earning', v_lr_earning,
    'owner_net_after_lr', v_owner_net
  );
end;
$$;

comment on function public.write_lead_referrer_commission(uuid, uuid) is
  'Build 56 — the single LR-commission writer. Reads Doctor''s earning (SUM partner_share) + owner residual (SUM owner_share) from the deal''s existing commission_records, resolves the LR''s tier from their closed-deal count, and writes lr_earning = round(doctor_earning * tier_pct, 2) carved from the owner residual. Owner-only, advisory-locked per (deal, LR), idempotent (one non-void row per pair). Never recomputes Doctor''s or FNC''s money.';

-- Grants: owner-gated in body; authenticated may call, anon/public revoked.
revoke all on function public.write_lead_referrer_commission(uuid, uuid) from public;
revoke all on function public.write_lead_referrer_commission(uuid, uuid) from anon;
grant  execute on function public.write_lead_referrer_commission(uuid, uuid) to authenticated;

-- ===========================================================================
-- 9. Assertions — structural + a rolled-back behavioural proof of the invariants
--    on synthetic numbers (Doctor untouched, LR = tier% × Doctor, LR <= Doctor,
--    owner_net = owner_share − LR). Pattern mirrors C2.2 / Build 10/13: synthetic
--    DML inside an inner block, unwound by a deliberate ROLLBACK_TEST_DATA raise.
-- ===========================================================================
do $$
declare
  v_enum text;
  v_prosecdef boolean; v_proconfig text[];
  -- pure-numeric proofs
  v_t int; v_p numeric; v_e numeric;
  -- behavioural fixtures
  v_client uuid; v_doctor uuid; v_owner uuid; v_lr uuid; v_lead uuid;
  v_deal uuid; v_cr public.commission_records;
  v_res1 jsonb; v_res2 jsonb; v_row public.lead_referrer_commission_records;
  v_cnt int;
begin
  -- (a) enum shape
  select string_agg(enumlabel, ',' order by enumsortorder) into v_enum
    from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'lead_referrer_commission_state';
  if v_enum <> 'earned,settled,void' then
    raise exception 'assert FAIL: lead_referrer_commission_state = %', v_enum;
  end if;

  -- (b) table + RLS + owner policy + LR view present
  if to_regclass('public.lead_referrer_commission_records') is null then
    raise exception 'assert FAIL: lead_referrer_commission_records table missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.lead_referrer_commission_records'::regclass) then
    raise exception 'assert FAIL: RLS not enabled on ledger'; end if;
  if not exists (select 1 from pg_policy where polrelid='public.lead_referrer_commission_records'::regclass
      and polname='lead_referrer_commission_records_owner_all') then
    raise exception 'assert FAIL: owner-all policy missing'; end if;
  if to_regclass('public.lead_referrer_my_earnings') is null then
    raise exception 'assert FAIL: lead_referrer_my_earnings view missing'; end if;

  -- (c) attribution columns + FKs present and validated
  if not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='profiles' and column_name='sourced_via_partner_id') then
    raise exception 'assert FAIL: profiles.sourced_via_partner_id missing'; end if;
  if not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='leads' and column_name='sourced_by_lead_refer_id') then
    raise exception 'assert FAIL: leads.sourced_by_lead_refer_id missing'; end if;
  if exists (select 1 from pg_constraint where conname='profiles_sourced_via_partner_fkey' and not convalidated) then
    raise exception 'assert FAIL: profiles FK not validated'; end if;

  -- (d) writer is DEFINER + search_path='' + granted to authenticated, not anon
  select p.prosecdef, p.proconfig into v_prosecdef, v_proconfig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='write_lead_referrer_commission';
  if v_prosecdef is not true then raise exception 'assert FAIL: writer not SECURITY DEFINER'; end if;
  if not exists (select 1 from unnest(v_proconfig) e where e like 'search_path=%') then
    raise exception 'assert FAIL: writer search_path not set'; end if;
  if not has_function_privilege('authenticated','public.write_lead_referrer_commission(uuid,uuid)','execute') then
    raise exception 'assert FAIL: authenticated cannot execute writer'; end if;
  if has_function_privilege('anon','public.write_lead_referrer_commission(uuid,uuid)','execute') then
    raise exception 'assert FAIL: anon can execute writer'; end if;

  -- (e) tier ladder is exactly the locked ladder
  if public.lead_referrer_tier(0)<>1 or public.lead_referrer_tier(9)<>1
     or public.lead_referrer_tier(10)<>2 or public.lead_referrer_tier(24)<>2
     or public.lead_referrer_tier(25)<>3 or public.lead_referrer_tier(49)<>3
     or public.lead_referrer_tier(50)<>4 or public.lead_referrer_tier(9999)<>4 then
    raise exception 'assert FAIL: tier ladder thresholds wrong';
  end if;
  if public.lead_referrer_tier_pct(1)<>0.25 or public.lead_referrer_tier_pct(2)<>0.35
     or public.lead_referrer_tier_pct(3)<>0.40 or public.lead_referrer_tier_pct(4)<>0.50 then
    raise exception 'assert FAIL: tier pct wrong';
  end if;

  -- (f) pure calculator: LR = round(doctor * pct, 2); rounding matches the engine;
  --     and the ceiling (LR <= doctor) holds at every tier.
  -- Doctor = R2,131.50 (a real settled partner_share shape). Expected values:
  --   L1 25% -> 532.88 (532.875 rounds half-away-from-zero up)
  --   L2 35% -> 746.03 (746.025 -> 746.03)
  --   L4 50% -> 1065.75
  if public.calculate_lead_referrer_earning(2131.50, 0.25) <> 532.88 then
    raise exception 'assert FAIL: L1 calc = %', public.calculate_lead_referrer_earning(2131.50, 0.25); end if;
  if public.calculate_lead_referrer_earning(2131.50, 0.35) <> 746.03 then
    raise exception 'assert FAIL: L2 calc = %', public.calculate_lead_referrer_earning(2131.50, 0.35); end if;
  if public.calculate_lead_referrer_earning(2131.50, 0.50) <> 1065.75 then
    raise exception 'assert FAIL: L4 calc = %', public.calculate_lead_referrer_earning(2131.50, 0.50); end if;
  for v_t in 1..4 loop
    v_p := public.lead_referrer_tier_pct(v_t);
    v_e := public.calculate_lead_referrer_earning(2131.50, v_p);
    if v_e > 2131.50 then raise exception 'assert FAIL: LR > Doctor at tier %', v_t; end if;
  end loop;

  -- ---- Behavioural (synthetic, unwound by ROLLBACK_TEST_DATA) ----------------
  begin
    select id into v_client from public.clients           limit 1;
    select id into v_doctor from public.referral_partners limit 1;
    select id into v_owner  from public.profiles where role='owner' limit 1;
    v_lr := v_owner;  -- stand-in LR profile (satisfies the FK); rolled back

    if v_client is null or v_doctor is null or v_owner is null then
      raise notice 'Build 56: missing client/partner/owner fixtures — behavioural proof skipped.';
      raise exception 'ROLLBACK_TEST_DATA';
    end if;

    -- Owner auth context so is_owner() passes inside the writer.
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    -- Synthetic lead SOURCED BY the LR (satisfies the new sourcing gate), Path-B
    -- attributed to the Doctor.
    insert into public.leads (business_name, contact_name, referral_partner_id, sourced_by_lead_refer_id)
      values ('B56 LR Rollback Lead', 'Test Contact', v_doctor, v_lr)
      returning id into v_lead;

    -- Synthetic funded deal LINKED to that lead, Doctor attribution.
    insert into public.deals (client_id, lead_id, reference, stage, is_purchase_order, referral_partner_id)
      values (v_client, v_lead, 'B56_LR_ROLLBACK', 'funded', false, v_doctor)
      returning id into v_deal;

    -- Doctor commission on the deal. The LOCKED partner recompute trigger fills
    -- the split from calculate_commission — we READ it, never set it. R100k gross
    -- non-PO -> retention 40000, pool 60000, tier 30% -> partner_share 18000,
    -- owner_share 42000. (deal_funder_submission_id nullable; contractor_share 0.)
    insert into public.commission_records
      (deal_id, referral_partner_id, gross_commission, is_purchase_order, status, contractor_share, earned_at)
      values (v_deal, v_doctor, 100000, false, 'earned', 0, now())
      returning * into v_cr;
    if v_cr.partner_share <> 18000.00 or v_cr.owner_share <> 42000.00 then
      raise exception 'assert FAIL: unexpected Doctor split (partner % owner %)', v_cr.partner_share, v_cr.owner_share;
    end if;

    -- Mark the LR as Path B via this Doctor.
    update public.profiles set sourced_via_partner_id = v_doctor where id = v_lr;

    -- Write the LR commission (day-one -> L1 25%).
    v_res1 := public.write_lead_referrer_commission(v_deal, v_lr);
    if (v_res1->>'was_created')::boolean is not true then
      raise exception 'assert FAIL: 1st LR write did not create'; end if;

    select * into v_row from public.lead_referrer_commission_records
      where deal_id = v_deal and lead_refer_id = v_lr and status <> 'void';

    -- LR = 25% × Doctor 18000 = 4500.00
    if v_row.tier <> 1 then raise exception 'assert FAIL: tier % (exp 1)', v_row.tier; end if;
    if v_row.doctor_earning <> 18000.00 then raise exception 'assert FAIL: doctor snapshot % (exp 18000)', v_row.doctor_earning; end if;
    if v_row.lr_earning <> 4500.00 then raise exception 'assert FAIL: lr_earning % (exp 4500)', v_row.lr_earning; end if;
    -- owner_net = owner_share 42000 − LR 4500 = 37500
    if v_row.owner_net_after_lr <> 37500.00 then raise exception 'assert FAIL: owner_net % (exp 37500)', v_row.owner_net_after_lr; end if;
    -- INVARIANT: LR <= Doctor
    if v_row.lr_earning > v_row.doctor_earning then raise exception 'assert FAIL: LR > Doctor'; end if;

    -- INVARIANT: Doctor + FNC figures UNTOUCHED (re-read the source row).
    select * into v_cr from public.commission_records where id = v_cr.id;
    if v_cr.partner_share <> 18000.00 then raise exception 'assert FAIL: Doctor partner_share mutated to %', v_cr.partner_share; end if;
    if v_cr.company_retention <> 40000.00 then raise exception 'assert FAIL: FNC retention mutated to %', v_cr.company_retention; end if;
    if v_cr.owner_share <> 42000.00 then raise exception 'assert FAIL: owner_share mutated to %', v_cr.owner_share; end if;

    -- Idempotency: 2nd call creates nothing; still exactly one row.
    v_res2 := public.write_lead_referrer_commission(v_deal, v_lr);
    if (v_res2->>'was_created')::boolean is not false then raise exception 'assert FAIL: 2nd LR write duplicated'; end if;
    select count(*) into v_cnt from public.lead_referrer_commission_records
      where deal_id = v_deal and lead_refer_id = v_lr and status <> 'void';
    if v_cnt <> 1 then raise exception 'assert FAIL: expected 1 LR row, got %', v_cnt; end if;

    -- Co-funding REFRESH (Gitar): a 2nd Doctor commission appears AFTER the LR
    -- write; re-calling refreshes the earned LR row to the new Doctor earning,
    -- with the tier FROZEN. Doctor 18000+18000=36000; LR L1 25% = 9000; still 1 row.
    insert into public.commission_records
      (deal_id, referral_partner_id, gross_commission, is_purchase_order, status, contractor_share, earned_at)
      values (v_deal, v_doctor, 100000, false, 'earned', 0, now());
    v_res2 := public.write_lead_referrer_commission(v_deal, v_lr);
    if (v_res2->>'was_created')::boolean is not false then raise exception 'assert FAIL: refresh should not create'; end if;
    select * into v_row from public.lead_referrer_commission_records
      where deal_id = v_deal and lead_refer_id = v_lr and status <> 'void';
    if v_row.doctor_earning <> 36000.00 then raise exception 'assert FAIL: refresh doctor_earning % (exp 36000)', v_row.doctor_earning; end if;
    if v_row.lr_earning <> 9000.00 then raise exception 'assert FAIL: refresh lr_earning % (exp 9000)', v_row.lr_earning; end if;
    if v_row.tier <> 1 then raise exception 'assert FAIL: tier bumped on refresh (exp 1), got %', v_row.tier; end if;
    if v_row.owner_net_after_lr <> 75000.00 then raise exception 'assert FAIL: refresh owner_net % (exp 75000)', v_row.owner_net_after_lr; end if;
    select count(*) into v_cnt from public.lead_referrer_commission_records
      where deal_id = v_deal and lead_refer_id = v_lr and status <> 'void';
    if v_cnt <> 1 then raise exception 'assert FAIL: refresh created a duplicate row (%)', v_cnt; end if;

    -- CHECK constraint proof: an over-cap direct insert must be rejected.
    -- status = 'void' so it bypasses the (deal, LR) partial-unique index and the
    -- lrc_lr_le_doctor CHECK is the constraint under test (not a unique violation).
    begin
      insert into public.lead_referrer_commission_records
        (deal_id, lead_refer_id, doctor_partner_id, doctor_earning, owner_share_snapshot,
         tier, tier_pct, lr_earning, owner_net_after_lr, closed_deal_count, status)
        values (v_deal, v_lr, v_doctor, 100.00, 200.00, 4, 0.5000, 150.00, 50.00, 0, 'void');
      raise exception 'assert FAIL: lrc_lr_le_doctor did not reject LR > Doctor';
    exception when check_violation then null;  -- expected
    end;

    raise notice 'Build 56 behavioural proof passed (LR=25%%×Doctor, LR<=Doctor, owner_net=residual−LR, Doctor/FNC untouched, idempotent).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;

  raise notice 'Build 56 assertions passed: tier ladder + pure calculator + ledger + RLS + LR view + owner writer.';
end $$;
