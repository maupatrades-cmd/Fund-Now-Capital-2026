-- Build 1 (forward-fix) — Lead-Referrer commission engine: recognise Path A.
-- ============================================================================
-- FORWARD-FIX of Build 56 / PR #198 (`20260810240000_lead_referrer_commission_engine`).
-- Do NOT rewrite #198 — this migration relaxes the ledger's Path-B-only shape and
-- redefines the single writer with CREATE OR REPLACE, applied AFTER #198 in
-- timestamp order. `commission_records` and the locked partner engine are
-- UNTOUCHED (read, never recomputed).
--
-- WHAT CHANGES
--   #198's writer HARD-REJECTS a Path-A lead referrer (one sourced directly by
--   FNC, `profiles.sourced_via_partner_id IS NULL`) with
--   "Lead referrer is Path A … no LR commission". This forward-fix RECOGNISES
--   Path A as a first-class path instead of a flat rejection.
--
-- CONFIRMED MONEY MODEL (owner ruling, 2026-08-12b handover / #229 §4)
--   * The LR earning is carved from THAPELO'S RESIDUAL (`owner_share`) on BOTH
--     paths — never from Doctor's `partner_share`, never from FNC retention.
--   * Both paths earn via the SAME tier ladder (L1 25 / L2 35 / L3 40 / L4 50 %).
--   * Path B (sub-lead-referrer under a Doctor): tier% of Doctor's earning
--     (`partner_share`), carved from `owner_share`. **Unchanged from #198.**
--
-- ✅ OWNER RULING — Path-A base (2026-08-16): "Path-A base is tier% of Thapelo's
--   owner_share — proceed."
--   A Direct-FNC deal has Thapelo at 100 % — there is NO partner / `partner_share`.
--   So the Path-A LR's tier% applies to THAPELO'S OWN TAKE on the deal:
--     base = SUM(owner_share) over the deal's owner-direct commission_records
--            (referral_partner_id IS NULL).
--   This representation is not invented — `write_commission_record` (C2.2, rule
--   G4) writes exactly one commission_records row for a no-partner deal with
--   `referral_partner_id IS NULL`, `partner_share = 0`, and `owner_share = the
--   full 60% partner_pool` (proven live: gross R100k → owner_share R60,000).
--
--   Two schema sub-questions the gated draft flagged, resolved here (see §0):
--     (1) doctor_partner_id was NOT NULL — a Direct-FNC row has no Doctor, so the
--         column is relaxed to NULL, and NULL is the Path-A discriminator.
--     (2) the Path-B-only invariant lr_earning <= doctor_earning is made
--         Path-B-only; a Path-A row carries doctor_earning = 0 and is bounded
--         instead by lr_earning <= owner_share (already enforced by the existing
--         lrc_owner_net_nonneg constraint).
--
-- Table is EMPTY live (no genuine funding yet), so the constraint relaxations and
-- the NOT NULL drop are instant metadata-only changes — no rows to rewrite/scan.
-- ============================================================================

-- ===========================================================================
-- 0. Relax the ledger's Path-B-only shape so a Path-A (no-Doctor) row is legal.
--    All on an empty table → instant. NULL doctor_partner_id = Path A.
-- ===========================================================================
alter table public.lead_referrer_commission_records
  alter column doctor_partner_id drop not null;

-- The LR-earning ceiling invariant is Path-B-specific (there is a Doctor earning
-- to bound against). For Path A there is no Doctor earning; the real ceiling is
-- lr_earning <= owner_share, already guaranteed by lrc_owner_net_nonneg
-- (owner_net_after_lr = owner_share_snapshot - lr_earning AND >= 0).
alter table public.lead_referrer_commission_records
  drop constraint if exists lrc_lr_le_doctor;
alter table public.lead_referrer_commission_records
  add constraint lrc_lr_le_doctor
  check (doctor_partner_id is null or lr_earning <= doctor_earning);

-- A Path-A row (no Doctor) must carry NO Doctor earning; a Path-B row keeps its
-- real doctor_earning. Locks the two shapes apart.
alter table public.lead_referrer_commission_records
  drop constraint if exists lrc_path_a_no_doctor_earning;
alter table public.lead_referrer_commission_records
  add constraint lrc_path_a_no_doctor_earning
  check (doctor_partner_id is not null or doctor_earning = 0);

comment on column public.lead_referrer_commission_records.doctor_partner_id is
  'The Doctor (referral_partners.id) whose earning a Path-B LR commission is a tier% of. NULL = Path A (Direct-FNC): there is no Doctor; the LR earns tier% of Thapelo''s own residual (owner_share) instead, and doctor_earning is 0. NULL is the Path-A discriminator.';

-- ===========================================================================
-- 1. The single writer — now recognises BOTH paths.
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
  v_doctor          uuid;         -- deals.referral_partner_id (the Doctor; Path B only)
  v_lr_channel      uuid;         -- profiles.sourced_via_partner_id of the LR (null = Path A)
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

  -- Deal.
  select * into v_deal from public.deals where id = p_deal_id;
  if v_deal.id is null then
    raise exception 'Deal % not found', p_deal_id;
  end if;

  -- The LR's attribution channel decides the PATH. Load it FIRST (before the
  -- Doctor check) so a Path-A LR routes to the Path-A branch instead of tripping
  -- the "deal has no referral partner" guard, which is Path-B-specific.
  select sourced_via_partner_id into v_lr_channel
    from public.profiles where id = p_lead_refer_id;
  if not found then
    raise exception 'Lead referrer profile % not found', p_lead_refer_id;
  end if;

  -- =====================================================================
  -- PATH A — Direct-FNC lead referrer (sourced_via_partner_id IS NULL).
  -- Owner ruling (2026-08-16): the LR earns tier% of THAPELO'S OWN TAKE on the
  -- deal — SUM(owner_share) over the deal's owner-direct commission_records
  -- (referral_partner_id IS NULL; a Direct-FNC deal hands the owner the full
  -- 60% partner_pool per write_commission_record's no-partner rule G4). Same
  -- tier ladder; carved from that residual; owner_net = residual - lr_earning.
  -- Fully self-contained: does its own guards + idempotency and RETURNS, never
  -- falling through to the Path-B code (whose base/doctor join do not apply).
  -- =====================================================================
  if v_lr_channel is null then
    -- A Path-A LR belongs to a Direct-FNC deal (no Doctor). If the deal DOES have
    -- a referral partner the attribution is inconsistent — refuse rather than guess.
    if v_deal.referral_partner_id is not null then
      raise exception 'Lead referrer % is Path A (FNC-direct) but deal % has referral partner % — attribution mismatch',
        p_lead_refer_id, p_deal_id, v_deal.referral_partner_id;
    end if;

    -- Sourcing gate: the LR must be the one who actually SOURCED this deal's lead.
    -- A deal has exactly one lead, so exactly one LR can source it — this also
    -- structurally enforces ONE LR commission per deal.
    if not exists (
      select 1 from public.deals d
        join public.leads l on l.id = d.lead_id
       where d.id = p_deal_id
         and l.sourced_by_lead_refer_id = p_lead_refer_id
    ) then
      raise exception 'Lead referrer % did not source deal %''s lead — only the deal''s lead sourcer earns an LR commission',
        p_lead_refer_id, p_deal_id;
    end if;

    -- Over-carve guard: at most ONE LR commission per deal (reject a DIFFERENT LR
    -- already holding a non-void commission, so two LRs never each carve the full
    -- residual and push it negative).
    if exists (
      select 1 from public.lead_referrer_commission_records
       where deal_id = p_deal_id and lead_refer_id <> p_lead_refer_id and status <> 'void'
    ) then
      raise exception 'Deal % already has an LR commission for a different lead referrer', p_deal_id;
    end if;

    -- Idempotency + freshness for the (deal, LR) Path-A row.
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
      -- 'earned' → refresh against the CURRENT owner residual (co-funding may add
      -- commission_records rows). Tier stays FROZEN at first write.
      select coalesce(sum(cr.owner_share), 0)::numeric(14,2)
        into v_owner_share
        from public.commission_records cr
       where cr.deal_id = p_deal_id and cr.referral_partner_id is null and cr.status <> 'void';
      v_lr_earning := public.calculate_lead_referrer_earning(v_owner_share, v_ex_pct);
      v_owner_net  := v_owner_share - v_lr_earning;
      if v_owner_net < 0 then
        raise exception 'Refreshed LR earning % exceeds owner residual % on deal %', v_lr_earning, v_owner_share, p_deal_id;
      end if;
      update public.lead_referrer_commission_records
         set owner_share_snapshot = v_owner_share,
             lr_earning = v_lr_earning, owner_net_after_lr = v_owner_net, updated_at = now()
       where id = v_existing and status = 'earned'
         and (owner_share_snapshot is distinct from v_owner_share or lr_earning is distinct from v_lr_earning)
       returning id into v_id;
      return jsonb_build_object('was_created', false, 'lead_referrer_commission_id', v_existing,
                                'was_refreshed', (v_id is not null),
                                'reason', case when v_id is not null then 'refreshed' else 'already_current' end);
    end if;

    -- READ Thapelo's residual on the deal = SUM(owner_share) over the deal's
    -- owner-direct (no-partner) commission rows. Never recompute.
    select coalesce(sum(cr.owner_share), 0)::numeric(14,2), count(*), max(cr.id)
      into v_owner_share, v_rows, v_single_cr
      from public.commission_records cr
     where cr.deal_id = p_deal_id and cr.referral_partner_id is null and cr.status <> 'void';

    if v_rows = 0 then
      raise exception 'No owner-direct commission on deal % yet — fund the deal (write_commission_record) first', p_deal_id;
    end if;
    if v_owner_share <= 0 then
      raise exception 'Owner residual on deal % is zero — nothing to base an LR commission on', p_deal_id;
    end if;

    -- Tier from the LR's prior closed-deal count (day-one = 0 → Level 1).
    select count(distinct deal_id) into v_count
      from public.lead_referrer_commission_records
     where lead_refer_id = p_lead_refer_id and status <> 'void';

    v_tier       := public.lead_referrer_tier(v_count);
    v_pct        := public.lead_referrer_tier_pct(v_tier);
    -- Reuse the pure calculator with the Path-A base (owner residual). Its
    -- "earning <= base" ceiling maps to lr_earning <= owner_share here.
    v_lr_earning := public.calculate_lead_referrer_earning(v_owner_share, v_pct);
    v_owner_net  := v_owner_share - v_lr_earning;
    if v_owner_net < 0 then
      raise exception 'LR earning % would push owner net negative (residual %) on deal %',
        v_lr_earning, v_owner_share, p_deal_id;
    end if;

    insert into public.lead_referrer_commission_records (
      deal_id, lead_refer_id, doctor_partner_id,
      commission_record_id, doctor_earning, owner_share_snapshot,
      tier, tier_pct, lr_earning, owner_net_after_lr, closed_deal_count,
      status, earned_at, notes
    ) values (
      p_deal_id, p_lead_refer_id, null,                     -- Path A: no Doctor
      case when v_rows = 1 then v_single_cr else null end,
      0, v_owner_share,                                     -- no Doctor earning; base = owner residual
      v_tier, v_pct, v_lr_earning, v_owner_net, v_count,
      'earned', now(),
      'PATH A (Direct-FNC). Auto-written from ' || v_rows || ' owner-direct commission_records row(s); LR earns ' ||
      to_char(v_pct * 100, 'FM990.00') || '% (L' || v_tier || ') of Thapelo''s residual R' ||
      to_char(v_owner_share, 'FM999G999G990D00') || ', carved from that residual.'
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
      'path', 'A',
      'lead_referrer_commission_id', v_id,
      'tier', v_tier,
      'tier_pct', v_pct,
      'owner_residual', v_owner_share,
      'lr_earning', v_lr_earning,
      'owner_net_after_lr', v_owner_net
    );
  end if;

  -- =====================================================================
  -- PATH B — sub-lead-referrer under a Doctor. UNCHANGED from #198.
  -- =====================================================================
  v_doctor := v_deal.referral_partner_id;
  if v_doctor is null then
    raise exception 'Deal % has no referral partner — a Path-B lead referrer requires a Doctor pool', p_deal_id;
  end if;
  -- Path-B guard: the LR must be sourced via THIS deal's Doctor.
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
    'PATH B (under Doctor). Auto-written from ' || v_rows || ' commission_records row(s); LR earns ' ||
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
    'path', 'B',
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
  'Build 56 + Build-1 forward-fix. Path B (sub-lead-referrer under a Doctor): LR earns tier% of Doctor''s partner_share. Path A (Direct-FNC lead referrer, sourced_via_partner_id IS NULL): LR earns tier% of Thapelo''s own residual (SUM(owner_share) over the deal''s owner-direct commission_records) — owner ruling 2026-08-16. Both carve from owner_share; never recompute Doctor''s or FNC''s money. Owner-only, advisory-locked, idempotent.';

-- Grants unchanged (owner-gated in body; authenticated only).
revoke all on function public.write_lead_referrer_commission(uuid, uuid) from public;
revoke all on function public.write_lead_referrer_commission(uuid, uuid) from anon;
grant  execute on function public.write_lead_referrer_commission(uuid, uuid) to authenticated;

-- ===========================================================================
-- Assertions — structural + a rolled-back behavioural proof that Path B is
-- PRESERVED (LR = R4,500 on the R100k / 30%-tier fixture) and Path A now WRITES
-- (LR = 25% of Thapelo's R60,000 residual = R15,000; owner net R45,000; Doctor
-- id null, Doctor earning 0). Synthetic DML is unwound by the ROLLBACK_TEST_DATA
-- sentinel (house pattern).
-- ===========================================================================
do $$
declare
  v_prosecdef boolean; v_proconfig text[];
  v_client uuid; v_doctor uuid; v_owner uuid; v_lr uuid;
  v_lead uuid; v_deal uuid; v_cr public.commission_records;
  v_res jsonb; v_row public.lead_referrer_commission_records;
  v_lead_a uuid; v_deal_a uuid;
begin
  -- (a) writer is still DEFINER + search_path pinned + granted to authenticated, not anon.
  select p.prosecdef, p.proconfig into v_prosecdef, v_proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='write_lead_referrer_commission';
  if v_prosecdef is not true then raise exception 'assert FAIL: writer not SECURITY DEFINER'; end if;
  if not exists (select 1 from unnest(v_proconfig) e where e like 'search_path=%') then
    raise exception 'assert FAIL: writer search_path not set'; end if;
  if not has_function_privilege('authenticated','public.write_lead_referrer_commission(uuid,uuid)','execute') then
    raise exception 'assert FAIL: authenticated cannot execute writer'; end if;
  if has_function_privilege('anon','public.write_lead_referrer_commission(uuid,uuid)','execute') then
    raise exception 'assert FAIL: anon can execute writer'; end if;

  -- (b) doctor_partner_id is now nullable (Path A support).
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='lead_referrer_commission_records'
       and column_name='doctor_partner_id' and is_nullable='NO'
  ) then raise exception 'assert FAIL: doctor_partner_id still NOT NULL'; end if;

  -- ---- Behavioural (synthetic, unwound) --------------------------------------
  begin
    select id into v_client from public.clients           limit 1;
    select id into v_doctor from public.referral_partners limit 1;
    select id into v_owner  from public.profiles where role='owner' limit 1;
    v_lr := v_owner;  -- stand-in LR profile (satisfies the FK); rolled back

    if v_client is null or v_doctor is null or v_owner is null then
      raise notice 'Build 1 forward-fix: missing client/partner/owner fixtures — behavioural proof skipped.';
      raise exception 'ROLLBACK_TEST_DATA';
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    -- ===== PATH B still works (unchanged) =====
    insert into public.leads (business_name, contact_name, referral_partner_id, sourced_by_lead_refer_id)
      values ('B1 FF Path-B Lead', 'Test Contact', v_doctor, v_lr) returning id into v_lead;
    insert into public.deals (client_id, lead_id, reference, stage, is_purchase_order, referral_partner_id)
      values (v_client, v_lead, 'B1FF_PATH_B', 'funded', false, v_doctor) returning id into v_deal;
    insert into public.commission_records
      (deal_id, referral_partner_id, gross_commission, is_purchase_order, status, contractor_share, earned_at)
      values (v_deal, v_doctor, 100000, false, 'earned', 0, now()) returning * into v_cr;
    if v_cr.partner_share <> 18000.00 or v_cr.owner_share <> 42000.00 then
      raise exception 'assert FAIL: unexpected Doctor split (partner % owner %)', v_cr.partner_share, v_cr.owner_share; end if;
    update public.profiles set sourced_via_partner_id = v_doctor where id = v_lr;  -- Path B

    v_res := public.write_lead_referrer_commission(v_deal, v_lr);
    if (v_res->>'was_created')::boolean is not true then raise exception 'assert FAIL: Path-B write did not create'; end if;
    select * into v_row from public.lead_referrer_commission_records
      where deal_id = v_deal and lead_refer_id = v_lr and status <> 'void';
    if v_row.lr_earning <> 4500.00 then raise exception 'assert FAIL: Path-B lr_earning % (exp 4500)', v_row.lr_earning; end if;
    if v_row.owner_net_after_lr <> 37500.00 then raise exception 'assert FAIL: Path-B owner_net % (exp 37500)', v_row.owner_net_after_lr; end if;
    if v_row.doctor_partner_id is null then raise exception 'assert FAIL: Path-B doctor_partner_id should be set'; end if;

    -- ===== PATH A now WRITES (tier% of Thapelo's residual) =====
    update public.profiles set sourced_via_partner_id = null where id = v_lr;  -- Path A
    insert into public.leads (business_name, contact_name, referral_partner_id, sourced_by_lead_refer_id)
      values ('B1 FF Path-A Lead', 'Test Contact', null, v_lr) returning id into v_lead_a;
    insert into public.deals (client_id, lead_id, reference, stage, is_purchase_order, referral_partner_id)
      values (v_client, v_lead_a, 'B1FF_PATH_A', 'funded', false, null) returning id into v_deal_a;
    -- Direct-FNC commission: no partner → owner keeps the full 60% pool (rule G4).
    insert into public.commission_records
      (deal_id, referral_partner_id, gross_commission, is_purchase_order, status, contractor_share, earned_at)
      values (v_deal_a, null, 100000, false, 'earned', 0, now()) returning * into v_cr;
    if v_cr.owner_share <> 60000.00 then
      raise exception 'assert FAIL: Direct-FNC owner_share % (exp 60000)', v_cr.owner_share; end if;
    if v_cr.partner_share <> 0.00 then
      raise exception 'assert FAIL: Direct-FNC partner_share % (exp 0)', v_cr.partner_share; end if;

    v_res := public.write_lead_referrer_commission(v_deal_a, v_lr);
    if (v_res->>'was_created')::boolean is not true then raise exception 'assert FAIL: Path-A write did not create'; end if;
    if (v_res->>'path') <> 'A' then raise exception 'assert FAIL: Path-A result path % (exp A)', v_res->>'path'; end if;
    select * into v_row from public.lead_referrer_commission_records
      where deal_id = v_deal_a and lead_refer_id = v_lr and status <> 'void';
    -- L1 = 25% of Thapelo's R60,000 residual = R15,000; owner net R45,000.
    if v_row.lr_earning <> 15000.00 then raise exception 'assert FAIL: Path-A lr_earning % (exp 15000)', v_row.lr_earning; end if;
    if v_row.owner_net_after_lr <> 45000.00 then raise exception 'assert FAIL: Path-A owner_net % (exp 45000)', v_row.owner_net_after_lr; end if;
    if v_row.doctor_partner_id is not null then raise exception 'assert FAIL: Path-A doctor_partner_id should be null'; end if;
    if v_row.doctor_earning <> 0 then raise exception 'assert FAIL: Path-A doctor_earning % (exp 0)', v_row.doctor_earning; end if;

    raise notice 'Build 1 forward-fix proof passed (Path B unchanged: LR=4500; Path A writes: LR=15000, owner_net=45000, no Doctor).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;

  raise notice 'Build 1 forward-fix assertions passed (writer DEFINER/grants; doctor_partner_id nullable; Path B preserved; Path A writes).';
end $$;

notify pgrst, 'reload schema';
