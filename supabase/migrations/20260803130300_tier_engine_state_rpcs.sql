-- TIER ENGINE (Sprint 1, Lane 1b) — part 4 of 4: state RPCs + LOCK hook.
-- ============================================================================
-- The real-money engine. When a deal's commission is LOCKED (picker lane), read
-- the actual FNC gross + the deal's attribution and write ONE commission_record
-- with the correct split per TIERS.md:
--   * Direct_FNC             -> FNC keeps 100% (company_retention = gross).
--   * Bright_Destiny_Partner -> 40/60 split, partner tier % of the pool. Delegated
--                               to the LOCKED calculate_commission() engine (single
--                               source of split truth, CLAUDE.md) so the numbers are
--                               SPEC-exact and the sums check is guaranteed.
--   * FNC_Contractor         -> flat rand tier lookup; FNC retains gross - amount.
--                               R1,000,000+ -> manual entry required.
--   * Bright_Destiny_Sub_Agent -> reserved (no tier table yet) -> logged, not written.
--
-- INTEGRATION (Option A, trigger-based, per the lane brief): a trigger ON
-- deal_commissions (written HERE — it does NOT modify the picker lane's table) fires
-- when commission_state transitions to 'locked' and calls apply_tier_on_lock. The
-- trigger is DEFENSIVE: any tier-engine failure — including the R1M+ manual-entry
-- signal (sqlstate FNC1M) — is caught and logged, and the picker LOCK still succeeds.
-- A tier-engine bug must NEVER block the owner from locking a commission. The owner
-- then resolves via set_deal_attribution / set_contractor_manual_amount and re-runs.
--
-- Every state RPC: SECURITY DEFINER + search_path='' + is_owner() + advisory lock +
-- state guard + idempotency + activity_logs write. Grants: authenticated + postgres
-- + service_role; anon/PUBLIC revoked. Writes to commission_records go through the
-- DEFINER (bypassing RLS); the is_owner() body guard is the real gate.
--
-- POPIA (lane brief): attribution + commission_records writes stay owner/service-role
-- only. Money numeric(14,2); percentages numeric(10,4).
-- ============================================================================

-- ===========================================================================
-- 0. Internal audit helper (no API grant) — writes a tier-engine activity_logs
--    row as the calling owner, entity = the DEAL (surfaces on the deal Activity
--    tab). Mirrors the picker lane's log_commission_picker_activity pattern.
-- ===========================================================================
create or replace function public.log_tier_engine_activity(
  p_deal_id uuid, p_client_id uuid, p_event public.activity_event_type,
  p_description text, p_before jsonb, p_after jsonb
) returns void language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_email text; v_role text;
begin
  if v_uid is not null then select email, role into v_email, v_role from public.profiles where id = v_uid; end if;
  insert into public.activity_logs
    (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id,
     description, before_values, after_values, related_entity_ids)
  values (now(), v_uid, v_email, v_role, p_event, 'deal', p_deal_id, p_description, p_before, p_after,
     case when p_client_id is null then null else jsonb_build_array(p_client_id::text) end);
end $$;
revoke all on function public.log_tier_engine_activity(uuid, uuid, public.activity_event_type, text, jsonb, jsonb) from public, anon, authenticated;

-- ===========================================================================
-- 1. set_deal_attribution — owner sets/updates which entity earned the deal.
--    Immutable once the commission is LOCKED or a tier record exists ("locked,
--    no changes"). Polymorphic referent validated per attribution_type.
-- ===========================================================================
create or replace function public.set_deal_attribution(
  p_deal_id uuid, p_attribution_type text, p_attributed_to_id uuid default null
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_deal public.deals; v_ref text; v_uid uuid := (select auth.uid());
  v_existing public.deal_attributions; v_before jsonb; v_dc_state text;
begin
  if not public.is_owner() then raise exception 'Only the owner can set deal attribution'; end if;
  if p_attribution_type is null or p_attribution_type not in
     ('Direct_FNC','FNC_Contractor','Bright_Destiny_Partner','Bright_Destiny_Sub_Agent') then
    raise exception 'Invalid attribution_type % (Direct_FNC/FNC_Contractor/Bright_Destiny_Partner/Bright_Destiny_Sub_Agent)', coalesce(p_attribution_type,'<null>');
  end if;
  perform pg_advisory_xact_lock(hashtext('apply_tier_on_lock:' || p_deal_id::text));

  select * into v_deal from public.deals where id = p_deal_id;
  if v_deal.id is null then raise exception 'Deal % not found', p_deal_id; end if;
  v_ref := coalesce(v_deal.reference, p_deal_id::text);

  -- Immutability guard ("locked, no changes"): once the commission is locked or a
  -- tier commission has been written, attribution is frozen.
  select commission_state into v_dc_state from public.deal_commissions where deal_id = p_deal_id;
  if v_dc_state = 'locked' then
    raise exception 'Deal % commission is locked — attribution cannot be changed', v_ref;
  end if;
  if exists (select 1 from public.commission_records
      where deal_id = p_deal_id and deal_funder_submission_id is null and status <> 'void') then
    raise exception 'Deal % already has a commission record — attribution cannot be changed', v_ref;
  end if;

  -- Per-type referent validation (polymorphic attributed_to_id).
  if p_attribution_type = 'Bright_Destiny_Partner' then
    if p_attributed_to_id is null then raise exception 'Bright_Destiny_Partner requires a referral partner id'; end if;
    if not exists (select 1 from public.referral_partners where id = p_attributed_to_id) then
      raise exception 'Referral partner % not found', p_attributed_to_id; end if;
  elsif p_attribution_type = 'FNC_Contractor' then
    if p_attributed_to_id is null then raise exception 'FNC_Contractor requires a contractor (profiles) id'; end if;
    if not exists (select 1 from public.profiles where id = p_attributed_to_id and role = 'contractor') then
      raise exception 'Contractor % not found (must be a profile with role=contractor)', p_attributed_to_id; end if;
  elsif p_attribution_type = 'Direct_FNC' then
    -- attributed_to_id optional; if provided it must be the owner's profile.
    if p_attributed_to_id is not null and not exists
       (select 1 from public.profiles where id = p_attributed_to_id and role = 'owner') then
      raise exception 'Direct_FNC attributed_to_id must be the owner profile (or NULL)'; end if;
  else -- Bright_Destiny_Sub_Agent
    if p_attributed_to_id is null then raise exception 'Bright_Destiny_Sub_Agent requires a sub-agent id'; end if;
    -- No sub_agents table yet (Phase later) — store the id; defer entity validation.
  end if;

  select * into v_existing from public.deal_attributions where deal_id = p_deal_id;

  -- Idempotent: identical attribution -> clean no-op (no log).
  if v_existing.deal_id is not null
     and v_existing.attribution_type is not distinct from p_attribution_type
     and v_existing.attributed_to_id is not distinct from p_attributed_to_id then
    return jsonb_build_object('deal_id', p_deal_id, 'attribution_type', p_attribution_type,
      'attributed_to_id', p_attributed_to_id, 'changed', false);
  end if;

  v_before := case when v_existing.deal_id is null then null
    else jsonb_build_object('attribution_type', v_existing.attribution_type,
                            'attributed_to_id', v_existing.attributed_to_id) end;

  insert into public.deal_attributions (deal_id, attribution_type, attributed_to_id, created_by)
  values (p_deal_id, p_attribution_type, p_attributed_to_id, v_uid)
  on conflict (deal_id) do update
    set attribution_type = excluded.attribution_type,
        attributed_to_id = excluded.attributed_to_id
  returning * into v_existing;
  if v_existing.deal_id is null then raise exception 'Deal % attribution not written (no row)', p_deal_id; end if;

  perform public.log_tier_engine_activity(p_deal_id, v_deal.client_id, 'DEAL_ATTRIBUTION_SET',
    'Deal ' || v_ref || ' attribution set — ' || p_attribution_type, v_before,
    jsonb_build_object('attribution_type', p_attribution_type, 'attributed_to_id', p_attributed_to_id));

  return jsonb_build_object('deal_id', p_deal_id, 'attribution_type', p_attribution_type,
    'attributed_to_id', p_attributed_to_id, 'changed', true);
end $$;

-- ===========================================================================
-- 2. apply_tier_on_lock — the split writer. Called by the LOCK trigger (and
--    directly by the owner). Idempotent; owner-gated; advisory-locked. Business
--    states (no attribution / sub-agent) return gracefully; only hard errors and
--    the R1M+ manual signal (sqlstate FNC1M) raise.
-- ===========================================================================
create or replace function public.apply_tier_on_lock(p_deal_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_deal public.deals; v_dc public.deal_commissions; v_attr public.deal_attributions;
  v_ref text; v_gross numeric(14,2); v_is_po boolean;
  v_existing_id uuid; v_new_id uuid;
  v_existing_gross numeric(14,2); v_existing_status public.commission_state; v_existing_is_po boolean;
  b public.commission_breakdown;
  v_pct numeric(10,4); v_amt numeric(14,2);
  v_pool numeric(14,2); v_retention numeric(14,2);
  v_partner_share numeric(14,2); v_owner_share numeric(14,2); v_contractor_share numeric(14,2);
  v_tier_pct numeric(10,4); v_ref_partner uuid; v_contractor uuid; v_notes text;
begin
  if not public.is_owner() then raise exception 'Only the owner can apply commission tiers'; end if;
  perform pg_advisory_xact_lock(hashtext('apply_tier_on_lock:' || p_deal_id::text));

  select * into v_deal from public.deals where id = p_deal_id;
  if v_deal.id is null then raise exception 'Deal % not found', p_deal_id; end if;
  v_ref   := coalesce(v_deal.reference, p_deal_id::text);
  v_is_po := coalesce(v_deal.is_purchase_order, false);

  -- Commission must be LOCKED with an actual gross figure.
  select * into v_dc from public.deal_commissions where deal_id = p_deal_id;
  if v_dc.deal_id is null or v_dc.commission_state is distinct from 'locked' then
    raise exception 'apply_tier_on_lock: deal % commission is not locked (state %)', v_ref, coalesce(v_dc.commission_state, 'unset');
  end if;
  v_gross := v_dc.actual_gross_commission;
  if v_gross is null then raise exception 'apply_tier_on_lock: deal % is locked with no actual gross', v_ref; end if;

  -- Detect an existing (non-void) tier commission. We do NOT early-exit: an
  -- unlock -> corrected actual -> re-lock (picker unlock_commission exists exactly
  -- for a disputed figure) must be able to REWRITE a still-'earned' row with the new
  -- split. The write step below decides: same gross -> true no-op; changed gross on an
  -- 'earned' row -> rewrite; changed gross on an already-billed row -> raise.
  select id, gross_commission, status, is_purchase_order
    into v_existing_id, v_existing_gross, v_existing_status, v_existing_is_po
    from public.commission_records
    where deal_id = p_deal_id and deal_funder_submission_id is null and status <> 'void'
    limit 1;

  -- Attribution required. Missing/sub-agent are NON-FATAL (never abort the LOCK).
  select * into v_attr from public.deal_attributions where deal_id = p_deal_id;
  if v_attr.deal_id is null then
    perform public.log_tier_engine_activity(p_deal_id, v_deal.client_id, 'COMMISSION_TIER_APPLIED',
      'Deal ' || v_ref || ' locked (actual R' || to_char(v_gross,'FM999999999990.00') ||
        ') but has no attribution — commission NOT written. Set attribution, then re-run apply_tier_on_lock.',
      null, jsonb_build_object('actual_gross_commission', v_gross, 'status', 'no_attribution'));
    return jsonb_build_object('deal_id', p_deal_id, 'status', 'no_attribution', 'changed', false);
  end if;

  -- Baseline (Direct_FNC), overwritten per branch below.
  v_pool := 0; v_partner_share := 0; v_owner_share := 0; v_contractor_share := 0;
  v_tier_pct := 0; v_ref_partner := null; v_contractor := null;

  if v_attr.attribution_type = 'Direct_FNC' then
    v_retention := v_gross;                       -- owner keeps 100%
    v_notes := 'Tier engine: Direct_FNC — owner keeps 100%.';

  elsif v_attr.attribution_type = 'Bright_Destiny_Partner' then
    -- Delegate the money to the LOCKED engine (exact, SPEC-aligned, sums guaranteed).
    b := public.calculate_commission(v_gross, v_is_po);
    v_retention     := b.company_retention;
    v_pool          := b.partner_pool;
    v_tier_pct      := b.tier_pct;
    v_partner_share := b.partner_share;
    v_owner_share   := b.owner_share;
    v_ref_partner   := v_attr.attributed_to_id;
    v_pct           := public.calc_partner_tier_percent(v_gross, v_is_po);  -- brief helper (validated to agree)
    v_notes := 'Tier engine: Bright_Destiny_Partner — 40/60 split, partner tier ' ||
               to_char(v_pct,'FM990') || '% of pool.';

  elsif v_attr.attribution_type = 'FNC_Contractor' then
    v_amt := public.calc_contractor_tier_amount(v_gross);
    if v_amt is null then
      -- R1,000,000+ -> manual entry. Custom sqlstate so the LOCK trigger can log +
      -- continue, while a direct owner call gets a clear, actionable error.
      raise exception using errcode = 'FNC1M',
        message = 'apply_tier_on_lock: contractor commission for deal ' || v_ref ||
                  ' requires manual entry (FNC gross R' || to_char(v_gross,'FM999999999990.00') ||
                  ' >= R1,000,000). Call set_contractor_manual_amount.';
    end if;
    v_contractor_share := v_amt;
    v_retention        := v_gross - v_amt;        -- Path A: no floor; FNC absorbs any hit
    v_contractor       := v_attr.attributed_to_id;
    v_notes := 'Tier engine: FNC_Contractor — flat R' || to_char(v_amt,'FM999999999990.00') ||
               ' (TIERS.md Section 2); FNC retains R' || to_char(v_retention,'FM999999999990.00') || '.';

  else -- Bright_Destiny_Sub_Agent (reserved)
    perform public.log_tier_engine_activity(p_deal_id, v_deal.client_id, 'COMMISSION_TIER_APPLIED',
      'Deal ' || v_ref || ' attributed to a Bright Destiny sub-agent — tier structure not yet defined; commission NOT written.',
      null, jsonb_build_object('actual_gross_commission', v_gross, 'status', 'unsupported_subagent'));
    return jsonb_build_object('deal_id', p_deal_id, 'status', 'unsupported_subagent', 'changed', false);
  end if;

  -- REWRITE PATH (finding #1): an existing tier row means the deal was locked before.
  if v_existing_id is not null then
    -- Same actual gross AND same purchase-order flag -> a genuine idempotent no-op (e.g.
    -- the LOCK trigger re-fired). is_purchase_order is a split input (PO = 40% flat vs the
    -- gross-banded partner tiers via calculate_commission), so a corrected PO flag on the
    -- same gross must still trigger a rewrite (Macroscope M3).
    if v_existing_gross is not distinct from v_gross
       and v_existing_is_po is not distinct from v_is_po then
      return jsonb_build_object('deal_id', p_deal_id, 'status', 'already_written',
        'commission_record_id', v_existing_id, 'changed', false);
    end if;
    -- Changed gross: only a still-'earned' commission may be rewritten in place. Once it
    -- has advanced (outstanding/payable/settled — i.e. tied to an invoice) the figure is
    -- committed; the owner must void/redo through the ledger, not silently overwrite it.
    if v_existing_status <> 'earned' then
      raise exception 'apply_tier_on_lock: deal % commission already advanced (status %); void it before re-locking with a new gross',
        v_ref, v_existing_status;
    end if;
    update public.commission_records set
        referral_partner_id = v_ref_partner, contractor_id = v_contractor,
        gross_commission = v_gross, is_purchase_order = v_is_po, tier_pct = v_tier_pct,
        company_retention = v_retention, partner_pool = v_pool,
        partner_share = v_partner_share, owner_share = v_owner_share,
        contractor_share = v_contractor_share, attribution_type = v_attr.attribution_type,
        notes = v_notes || ' (rewritten on re-lock; gross R' || to_char(v_existing_gross,'FM999999999990.00') ||
                ' -> R' || to_char(v_gross,'FM999999999990.00') || ')'
      where id = v_existing_id
      returning id into v_new_id;
    if v_new_id is null then raise exception 'apply_tier_on_lock: deal % rewrite wrote no row', v_ref; end if;
    perform public.log_tier_engine_activity(p_deal_id, v_deal.client_id, 'COMMISSION_TIER_APPLIED',
      'Commission tier REWRITTEN on re-lock — ' || v_attr.attribution_type || ' — ' || v_notes,
      jsonb_build_object('previous_fnc_gross', v_existing_gross),
      jsonb_build_object('commission_record_id', v_new_id, 'attribution_type', v_attr.attribution_type,
        'fnc_gross', v_gross, 'fnc_retention', v_retention, 'partner_share', v_partner_share,
        'contractor_share', v_contractor_share, 'owner_share', v_owner_share));
    return jsonb_build_object('deal_id', p_deal_id, 'status', 'rewritten', 'changed', true,
      'commission_record_id', v_new_id, 'attribution_type', v_attr.attribution_type,
      'fnc_gross', v_gross, 'fnc_retention', v_retention,
      'partner_share', v_partner_share, 'contractor_share', v_contractor_share, 'owner_share', v_owner_share);
  end if;

  -- FIRST-LOCK PATH: no existing tier row -> insert. ON CONFLICT is the race backstop.
  insert into public.commission_records (
    deal_id, deal_funder_submission_id, referral_partner_id, contractor_id,
    gross_commission, is_purchase_order, tier_pct, company_retention, partner_pool,
    partner_share, owner_share, contractor_share, attribution_type,
    status, earned_at, notes
  ) values (
    p_deal_id, null, v_ref_partner, v_contractor,
    v_gross, v_is_po, v_tier_pct, v_retention, v_pool,
    v_partner_share, v_owner_share, v_contractor_share, v_attr.attribution_type,
    'earned'::public.commission_state, now(), v_notes
  )
  on conflict (deal_id) where (deal_funder_submission_id is null and status <> 'void') do nothing
  returning id into v_new_id;

  if v_new_id is null then
    -- Lost the race (concurrent writer won the arbiter) — report the surviving row.
    select id into v_existing_id from public.commission_records
      where deal_id = p_deal_id and deal_funder_submission_id is null and status <> 'void' limit 1;
    return jsonb_build_object('deal_id', p_deal_id, 'status', 'already_written',
      'commission_record_id', v_existing_id, 'changed', false);
  end if;

  perform public.log_tier_engine_activity(p_deal_id, v_deal.client_id, 'COMMISSION_TIER_APPLIED',
    'Commission tier applied on LOCK — ' || v_attr.attribution_type || ' — ' || v_notes, null,
    jsonb_build_object('commission_record_id', v_new_id, 'attribution_type', v_attr.attribution_type,
      'fnc_gross', v_gross, 'fnc_retention', v_retention, 'partner_share', v_partner_share,
      'contractor_share', v_contractor_share, 'owner_share', v_owner_share));

  return jsonb_build_object('deal_id', p_deal_id, 'status', 'written', 'changed', true,
    'commission_record_id', v_new_id, 'attribution_type', v_attr.attribution_type,
    'fnc_gross', v_gross, 'fnc_retention', v_retention,
    'partner_share', v_partner_share, 'contractor_share', v_contractor_share, 'owner_share', v_owner_share);
end $$;

-- ===========================================================================
-- 3. set_contractor_manual_amount — owner enters the R1M+ contractor amount by
--    hand (prominent audit trail). Requires a LOCKED deal with an actual gross,
--    an FNC_Contractor attribution, and a typed reason. Upserts the single tier
--    commission for the deal.
-- ===========================================================================
create or replace function public.set_contractor_manual_amount(
  p_deal_id uuid, p_amount numeric, p_reason text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_deal public.deals; v_ref text; v_dc public.deal_commissions; v_attr public.deal_attributions;
  v_reason text := btrim(coalesce(p_reason,'')); v_amt numeric(14,2) := round(p_amount, 2);
  v_gross numeric(14,2); v_retention numeric(14,2); v_existing_id uuid; v_new_id uuid; v_is_po boolean;
  v_existing_status public.commission_state;
begin
  if not public.is_owner() then raise exception 'Only the owner can set a manual contractor amount'; end if;
  if v_reason = '' then raise exception 'A typed reason is required to set a manual contractor amount'; end if;
  if v_amt is null then raise exception 'A manual contractor amount is required'; end if;
  if v_amt < 0 then raise exception 'Manual contractor amount cannot be negative'; end if;
  perform pg_advisory_xact_lock(hashtext('apply_tier_on_lock:' || p_deal_id::text));

  select * into v_deal from public.deals where id = p_deal_id;
  if v_deal.id is null then raise exception 'Deal % not found', p_deal_id; end if;
  v_ref := coalesce(v_deal.reference, p_deal_id::text);
  v_is_po := coalesce(v_deal.is_purchase_order, false);

  select * into v_dc from public.deal_commissions where deal_id = p_deal_id;
  if v_dc.deal_id is null or v_dc.commission_state is distinct from 'locked' then
    raise exception 'Deal % must be locked with an actual gross before a manual contractor amount', v_ref; end if;
  v_gross := v_dc.actual_gross_commission;
  if v_gross is null then raise exception 'Deal % has no actual gross', v_ref; end if;

  -- M2: manual entry is the documented R1,000,000+ fallback ONLY (TIERS.md R1M+). Below
  -- R1M the flat tier is authoritative (calc_contractor_tier_amount), so refuse a manual
  -- override there — it would bypass the tier table and defeat the tier system. If a
  -- sub-R1M override is ever needed, that is a canonical TIERS.md change, not a runtime one.
  if v_gross < 1000000 then
    raise exception 'set_contractor_manual_amount is the R1,000,000+ fallback only; deal % gross is R% — the flat contractor tier applies automatically',
      v_ref, to_char(v_gross,'FM999999999990.00'); end if;

  select * into v_attr from public.deal_attributions where deal_id = p_deal_id;
  if v_attr.deal_id is null or v_attr.attribution_type <> 'FNC_Contractor' then
    raise exception 'set_contractor_manual_amount only applies to FNC_Contractor deals (deal % is %)',
      v_ref, coalesce(v_attr.attribution_type, 'unattributed'); end if;

  v_retention := v_gross - v_amt;

  select id, status into v_existing_id, v_existing_status from public.commission_records
    where deal_id = p_deal_id and deal_funder_submission_id is null and status <> 'void' limit 1;

  if v_existing_id is not null then
    -- M1: never overwrite a commission that has advanced past 'earned' (tied to an invoice
    -- or paid); the owner must void/redo through the ledger. Mirrors apply_tier_on_lock.
    if v_existing_status <> 'earned' then
      raise exception 'set_contractor_manual_amount: deal % commission already advanced (status %); void it before re-entering the manual amount',
        v_ref, v_existing_status; end if;
    update public.commission_records
      set contractor_share   = v_amt,
          company_retention  = v_retention,
          contractor_id      = v_attr.attributed_to_id,
          referral_partner_id = null,
          partner_share = 0, owner_share = 0, partner_pool = 0, tier_pct = 0,
          attribution_type = 'FNC_Contractor',
          gross_commission = v_gross,
          notes = 'Tier engine: FNC_Contractor MANUAL amount R' || to_char(v_amt,'FM999999999990.00') || ' — reason: ' || v_reason
      where id = v_existing_id returning id into v_new_id;
  else
    insert into public.commission_records (
      deal_id, deal_funder_submission_id, referral_partner_id, contractor_id,
      gross_commission, is_purchase_order, tier_pct, company_retention, partner_pool,
      partner_share, owner_share, contractor_share, attribution_type, status, earned_at, notes
    ) values (
      p_deal_id, null, null, v_attr.attributed_to_id,
      v_gross, v_is_po, 0, v_retention, 0,
      0, 0, v_amt, 'FNC_Contractor', 'earned'::public.commission_state, now(),
      'Tier engine: FNC_Contractor MANUAL amount R' || to_char(v_amt,'FM999999999990.00') || ' — reason: ' || v_reason
    ) returning id into v_new_id;
  end if;

  perform public.log_tier_engine_activity(p_deal_id, v_deal.client_id, 'CONTRACTOR_MANUAL_AMOUNT_SET',
    'MANUAL contractor commission set on deal ' || v_ref || ' — R' || to_char(v_amt,'FM999999999990.00') ||
      ' of FNC gross R' || to_char(v_gross,'FM999999999990.00') || ' — reason: ' || v_reason, null,
    jsonb_build_object('commission_record_id', v_new_id, 'contractor_share', v_amt,
      'fnc_gross', v_gross, 'fnc_retention', v_retention, 'reason', v_reason));

  return jsonb_build_object('deal_id', p_deal_id, 'status', 'written', 'changed', true,
    'commission_record_id', v_new_id, 'contractor_share', v_amt, 'fnc_retention', v_retention);
end $$;

-- ===========================================================================
-- 4. LOCK trigger on deal_commissions (Option A). DEFENSIVE: never aborts a LOCK.
--    Written HERE — it adds a trigger to the picker table but does not alter its
--    columns/policies. Fires on the -> 'locked' transition (and a defensive INSERT
--    case, though the picker never inserts straight to locked).
-- ===========================================================================
create or replace function public.deal_commissions_apply_tier_on_lock()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.commission_state = 'locked'
     and (tg_op = 'INSERT' or old.commission_state is distinct from new.commission_state) then
    begin
      perform public.apply_tier_on_lock(new.deal_id);
    exception when others then
      -- LANE ISOLATION: a tier-engine failure (incl. the R1M+ FNC1M manual signal)
      -- must NEVER abort the picker LOCK. Log prominently; owner resolves + re-runs.
      insert into public.activity_logs
        (occurred_at, user_id, event_type, entity_type, entity_id, description)
      values (now(), (select auth.uid()), 'COMMISSION_TIER_APPLIED', 'deal', new.deal_id,
        'Tier engine did not write a commission on LOCK: ' || sqlerrm);
    end;
  end if;
  return null;
end $$;

drop trigger if exists deal_commissions_apply_tier_on_lock on public.deal_commissions;
create trigger deal_commissions_apply_tier_on_lock
  after insert or update of commission_state on public.deal_commissions
  for each row execute function public.deal_commissions_apply_tier_on_lock();

-- ===========================================================================
-- 5. Grants matrix: the 3 API RPCs -> authenticated + postgres + service_role;
--    anon/PUBLIC revoked. The trigger fn needs no API grant (fired by the engine).
-- ===========================================================================
do $$
declare fn text;
  api_fns constant text[] := array[
    'set_deal_attribution(uuid, text, uuid)',
    'apply_tier_on_lock(uuid)',
    'set_contractor_manual_amount(uuid, numeric, text)'
  ];
begin
  foreach fn in array api_fns loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
    execute format('grant execute on function public.%s to postgres', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;

comment on function public.apply_tier_on_lock(uuid) is
  'Tier engine: on commission LOCK, reads deal_attributions + deal_commissions.actual_gross_commission and writes ONE commission_record with the correct TIERS.md split (Direct_FNC 100% / Bright_Destiny_Partner 40/60 via calculate_commission / FNC_Contractor flat lookup). Owner-only, advisory-locked. Idempotent on an unchanged actual; on an unlock->corrected-actual->re-lock it REWRITES a still-earned row (and raises if the row has already been billed). R1M+ contractor raises sqlstate FNC1M (manual entry). Called by the deal_commissions LOCK trigger.';
comment on function public.set_deal_attribution(uuid, text, uuid) is
  'Tier engine: owner sets/updates a deal''s single attribution (deal_attributions). Frozen once the commission is locked or a tier record exists. Polymorphic referent validated per type. Owner-only, advisory-locked, audited (DEAL_ATTRIBUTION_SET).';
comment on function public.set_contractor_manual_amount(uuid, numeric, text) is
  'Tier engine: owner enters the R1,000,000+ contractor commission by hand (TIERS.md R1M+). Requires a locked FNC_Contractor deal + typed reason. Prominent audit (CONTRACTOR_MANUAL_AMOUNT_SET). Owner-only, advisory-locked.';

-- ===========================================================================
-- 6. Structural assertions — signatures, DEFINER/search_path, grants, trigger.
-- ===========================================================================
do $$
declare
  r record; sig text; want text; fn text; fn_row text[];
  sigs constant text[][] := array[
    ['public.set_deal_attribution(uuid,text,uuid)',           'p_deal_id uuid, p_attribution_type text, p_attributed_to_id uuid'],
    ['public.apply_tier_on_lock(uuid)',                       'p_deal_id uuid'],
    ['public.set_contractor_manual_amount(uuid,numeric,text)','p_deal_id uuid, p_amount numeric, p_reason text'],
    ['public.deal_commissions_apply_tier_on_lock()',          ''],
    ['public.log_tier_engine_activity(uuid,uuid,activity_event_type,text,jsonb,jsonb)',
                                                              'p_deal_id uuid, p_client_id uuid, p_event activity_event_type, p_description text, p_before jsonb, p_after jsonb']
  ];
  definer_fns constant text[] := array[
    'public.set_deal_attribution(uuid,text,uuid)','public.apply_tier_on_lock(uuid)',
    'public.set_contractor_manual_amount(uuid,numeric,text)','public.deal_commissions_apply_tier_on_lock()',
    'public.log_tier_engine_activity(uuid,uuid,activity_event_type,text,jsonb,jsonb)'
  ];
  api_fns constant text[] := array['set_deal_attribution','apply_tier_on_lock','set_contractor_manual_amount'];
begin
  -- (a) signatures exist + match
  foreach fn_row slice 1 in array sigs loop
    sig := fn_row[1]; want := fn_row[2];
    if to_regprocedure(sig) is null then raise exception 'assert: function % missing', sig; end if;
    if pg_get_function_identity_arguments(sig::regprocedure) <> want then
      raise exception 'assert: % signature drift — got %', sig, pg_get_function_identity_arguments(sig::regprocedure); end if;
  end loop;

  -- (b) all DEFINER + pinned search_path
  foreach sig in array definer_fns loop
    select p.prosecdef as is_def,
           exists(select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%') as sp
      into r from pg_proc p where p.oid = sig::regprocedure;
    if not r.is_def then raise exception 'assert: % not SECURITY DEFINER', sig; end if;
    if not r.sp then raise exception 'assert: % search_path not pinned', sig; end if;
  end loop;

  -- (c) API grants: authenticated + service_role, no anon/PUBLIC
  foreach fn in array api_fns loop
    if not exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=fn and grantee='authenticated' and privilege_type='EXECUTE') then
      raise exception 'assert: % missing authenticated EXECUTE', fn; end if;
    if not exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=fn and grantee='service_role' and privilege_type='EXECUTE') then
      raise exception 'assert: % missing service_role EXECUTE', fn; end if;
    if exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=fn and grantee in ('anon','PUBLIC') and privilege_type='EXECUTE') then
      raise exception 'assert: % still granted to anon/PUBLIC', fn; end if;
  end loop;

  -- (d) internal helper holds NO API-role grant
  if exists (select 1 from information_schema.routine_privileges
      where routine_schema='public' and routine_name='log_tier_engine_activity'
        and grantee in ('anon','authenticated','PUBLIC') and privilege_type='EXECUTE') then
    raise exception 'assert: log_tier_engine_activity is API-callable'; end if;

  -- (e) LOCK trigger present on deal_commissions
  if not exists (select 1 from pg_trigger where tgrelid='public.deal_commissions'::regclass
      and tgname='deal_commissions_apply_tier_on_lock' and not tgisinternal) then
    raise exception 'assert: deal_commissions_apply_tier_on_lock trigger missing'; end if;

  raise notice 'Tier engine part 4 structural assertions passed (3 RPCs + trigger fn + helper: signatures, definer/search_path, grants, LOCK trigger).';
end $$;

-- ===========================================================================
-- 7. Behavioural assertions — full flow via the LOCK trigger. Uses the tier
--    engine's new activity_event_type values (committed in part 1), so this runs
--    ONLY at real apply (matching the picker lane's discipline). deal_commissions
--    must exist (apply the picker lane's migrations FIRST). Synthetic rows use
--    EXPLICIT references and are unwound by a ROLLBACK_TEST_DATA raise.
-- ===========================================================================
do $$
declare
  v_owner uuid; v_nonown uuid; v_client uuid; v_partner uuid; v_contractor uuid;
  v_deal uuid; v_res jsonb; v_rec public.commission_records;
  v_calc jsonb := jsonb_build_object('base','percent_of_finance_charge','rate',10,'timing','upfront');
begin
  if to_regclass('public.deal_commissions') is null then
    raise notice 'Tier engine behavioural assertions SKIPPED — deal_commissions not present (apply the picker lane first).';
    return;
  end if;
  select id into v_owner   from public.profiles where role='owner' limit 1;
  select id into v_nonown  from public.profiles where role<>'owner' limit 1;
  select id into v_client  from public.clients limit 1;
  select id into v_partner from public.referral_partners limit 1;
  select id into v_contractor from public.profiles where role='contractor' limit 1;
  if v_owner is null or v_client is null then
    raise notice 'Tier engine behavioural assertions SKIPPED (no owner / no client present).'; return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    -- ============ PARTNER: gross 14000 -> 2436 (29% of 8400 pool) ============
    if v_partner is not null then
      insert into public.deals (client_id, reference, stage, is_purchase_order)
        values (v_client, 'TIER_TEST_PARTNER', 'document_collection', false) returning id into v_deal;
      perform public.set_deal_attribution(v_deal, 'Bright_Destiny_Partner', v_partner);
      insert into public.deal_commissions (deal_id, commission_calculation, commission_state, estimated_gross_commission)
        values (v_deal, v_calc, 'potential', 14000);
      -- LOCK -> trigger -> apply_tier_on_lock
      update public.deal_commissions
        set commission_state='locked', actual_gross_commission=14000,
            commission_locked_at=now(), commission_locked_by=v_owner
        where deal_id=v_deal;
      select * into v_rec from public.commission_records where deal_id=v_deal and deal_funder_submission_id is null and status<>'void';
      if v_rec.id is null then raise exception 'assert partner: no commission row written on lock'; end if;
      if v_rec.gross_commission  <> 14000.00 then raise exception 'assert partner: gross %', v_rec.gross_commission; end if;
      if v_rec.company_retention <> 5600.00  then raise exception 'assert partner: retention %', v_rec.company_retention; end if;
      if v_rec.partner_pool      <> 8400.00  then raise exception 'assert partner: pool %', v_rec.partner_pool; end if;
      if v_rec.partner_share     <> 2436.00  then raise exception 'assert partner: partner_share %', v_rec.partner_share; end if;
      if v_rec.owner_share       <> 5964.00  then raise exception 'assert partner: owner_share %', v_rec.owner_share; end if;
      if v_rec.contractor_share  <> 0        then raise exception 'assert partner: contractor_share %', v_rec.contractor_share; end if;
      if v_rec.referral_partner_id is distinct from v_partner then raise exception 'assert partner: referral_partner_id'; end if;
      if v_rec.attribution_type <> 'Bright_Destiny_Partner' then raise exception 'assert partner: attribution_type'; end if;
      -- idempotent second apply
      v_res := public.apply_tier_on_lock(v_deal);
      if (v_res->>'changed') <> 'false' or (v_res->>'status') <> 'already_written' then raise exception 'assert partner: idempotency %', v_res; end if;
      -- REWRITE (finding #1): unlock -> corrected actual -> re-lock rewrites the still-earned row.
      update public.deal_commissions set commission_state='pending', commission_locked_at=null, commission_locked_by=null where deal_id=v_deal;
      update public.deal_commissions set commission_state='locked', actual_gross_commission=100000,
        commission_locked_at=now(), commission_locked_by=v_owner where deal_id=v_deal;
      select * into v_rec from public.commission_records where deal_id=v_deal and deal_funder_submission_id is null and status<>'void';
      if v_rec.gross_commission  <> 100000.00 then raise exception 'assert rewrite: gross not updated %', v_rec.gross_commission; end if;
      if v_rec.partner_share     <> 18000.00  then raise exception 'assert rewrite: partner_share %', v_rec.partner_share; end if;
      if v_rec.company_retention <> 40000.00  then raise exception 'assert rewrite: retention %', v_rec.company_retention; end if;
      -- attribution frozen once locked
      begin perform public.set_deal_attribution(v_deal, 'Direct_FNC', null); raise exception 'assert: change attribution on locked should raise';
      exception when others then if sqlerrm like 'assert:%' then raise; end if;
        if sqlerrm not ilike '%locked%' then raise exception 'assert partner: wrong locked-attr error: %', sqlerrm; end if; end;
    end if;

    -- ============ DIRECT_FNC: gross 14000 -> retention 14000, no shares ============
    insert into public.deals (client_id, reference, stage, is_purchase_order)
      values (v_client, 'TIER_TEST_DIRECT', 'document_collection', false) returning id into v_deal;
    perform public.set_deal_attribution(v_deal, 'Direct_FNC', null);
    insert into public.deal_commissions (deal_id, commission_calculation, commission_state, estimated_gross_commission)
      values (v_deal, v_calc, 'potential', 14000);
    update public.deal_commissions set commission_state='locked', actual_gross_commission=14000,
      commission_locked_at=now(), commission_locked_by=v_owner where deal_id=v_deal;
    select * into v_rec from public.commission_records where deal_id=v_deal and deal_funder_submission_id is null and status<>'void';
    if v_rec.id is null then raise exception 'assert direct: no row'; end if;
    if v_rec.company_retention <> 14000.00 then raise exception 'assert direct: retention %', v_rec.company_retention; end if;
    if v_rec.partner_share <> 0 or v_rec.contractor_share <> 0 or v_rec.owner_share <> 0 then raise exception 'assert direct: shares not zero'; end if;
    if v_rec.attribution_type <> 'Direct_FNC' then raise exception 'assert direct: attribution_type'; end if;

    -- ============ CONTRACTOR: gross 14000 -> 3000 flat, retention 11000 ============
    if v_contractor is not null then
      insert into public.deals (client_id, reference, stage, is_purchase_order)
        values (v_client, 'TIER_TEST_CONTRACTOR', 'document_collection', false) returning id into v_deal;
      perform public.set_deal_attribution(v_deal, 'FNC_Contractor', v_contractor);
      insert into public.deal_commissions (deal_id, commission_calculation, commission_state, estimated_gross_commission)
        values (v_deal, v_calc, 'potential', 14000);
      update public.deal_commissions set commission_state='locked', actual_gross_commission=14000,
        commission_locked_at=now(), commission_locked_by=v_owner where deal_id=v_deal;
      select * into v_rec from public.commission_records where deal_id=v_deal and deal_funder_submission_id is null and status<>'void';
      if v_rec.id is null then raise exception 'assert contractor: no row'; end if;
      if v_rec.contractor_share <> 3000.00 then raise exception 'assert contractor: share %', v_rec.contractor_share; end if;
      if v_rec.company_retention <> 11000.00 then raise exception 'assert contractor: retention %', v_rec.company_retention; end if;
      if v_rec.partner_share <> 0 or v_rec.owner_share <> 0 then raise exception 'assert contractor: partner/owner not zero'; end if;
      if v_rec.contractor_id is distinct from v_contractor then raise exception 'assert contractor: contractor_id'; end if;

      -- small deal: gross 1500 -> 300 flat, retention 1200 (Path A)
      insert into public.deals (client_id, reference, stage, is_purchase_order)
        values (v_client, 'TIER_TEST_SMALL', 'document_collection', false) returning id into v_deal;
      perform public.set_deal_attribution(v_deal, 'FNC_Contractor', v_contractor);
      insert into public.deal_commissions (deal_id, commission_calculation, commission_state, estimated_gross_commission)
        values (v_deal, v_calc, 'potential', 1500);
      update public.deal_commissions set commission_state='locked', actual_gross_commission=1500,
        commission_locked_at=now(), commission_locked_by=v_owner where deal_id=v_deal;
      select * into v_rec from public.commission_records where deal_id=v_deal and deal_funder_submission_id is null and status<>'void';
      if v_rec.contractor_share <> 300.00 then raise exception 'assert small: share %', v_rec.contractor_share; end if;
      if v_rec.company_retention <> 1200.00 then raise exception 'assert small: retention %', v_rec.company_retention; end if;

      -- R1M+: apply raises FNC1M -> trigger swallows -> NO row on lock; then manual entry.
      insert into public.deals (client_id, reference, stage, is_purchase_order)
        values (v_client, 'TIER_TEST_R1M', 'document_collection', false) returning id into v_deal;
      perform public.set_deal_attribution(v_deal, 'FNC_Contractor', v_contractor);
      insert into public.deal_commissions (deal_id, commission_calculation, commission_state, estimated_gross_commission)
        values (v_deal, v_calc, 'potential', 1200000);
      update public.deal_commissions set commission_state='locked', actual_gross_commission=1200000,
        commission_locked_at=now(), commission_locked_by=v_owner where deal_id=v_deal;
      -- lock succeeded (defensive trigger), no tier row yet
      if exists (select 1 from public.commission_records where deal_id=v_deal and deal_funder_submission_id is null and status<>'void') then
        raise exception 'assert R1M: a row was written automatically (should require manual)'; end if;
      if (select commission_state from public.deal_commissions where deal_id=v_deal) <> 'locked' then
        raise exception 'assert R1M: lock did not succeed'; end if;
      -- direct apply raises FNC1M
      begin perform public.apply_tier_on_lock(v_deal); raise exception 'assert R1M: direct apply should raise';
      exception when sqlstate 'FNC1M' then null; when others then if sqlerrm like 'assert:%' then raise; else raise; end if; end;
      -- manual entry succeeds
      v_res := public.set_contractor_manual_amount(v_deal, 150000, 'agreed via email');
      select * into v_rec from public.commission_records where deal_id=v_deal and deal_funder_submission_id is null and status<>'void';
      if v_rec.contractor_share <> 150000.00 then raise exception 'assert R1M manual: share %', v_rec.contractor_share; end if;
      if v_rec.company_retention <> 1050000.00 then raise exception 'assert R1M manual: retention %', v_rec.company_retention; end if;
    else
      raise notice 'Tier engine: contractor behavioural tests SKIPPED (no profile with role=contractor).';
    end if;

    -- ============ NON-OWNER denied ============
    if v_nonown is not null then
      insert into public.deals (client_id, reference, stage, is_purchase_order)
        values (v_client, 'TIER_TEST_PERM', 'document_collection', false) returning id into v_deal;
      perform set_config('request.jwt.claims', json_build_object('sub', v_nonown)::text, true);
      begin perform public.set_deal_attribution(v_deal, 'Direct_FNC', null); raise exception 'assert: non-owner set_deal_attribution should raise';
      exception when others then if sqlerrm like 'assert:%' then raise; end if;
        if sqlerrm not ilike '%owner%' then raise exception 'assert: wrong non-owner attr error: %', sqlerrm; end if; end;
      begin perform public.apply_tier_on_lock(v_deal); raise exception 'assert: non-owner apply_tier_on_lock should raise';
      exception when others then if sqlerrm like 'assert:%' then raise; end if;
        if sqlerrm not ilike '%owner%' then raise exception 'assert: wrong non-owner apply error: %', sqlerrm; end if; end;
      begin perform public.set_contractor_manual_amount(v_deal, 100, 'x'); raise exception 'assert: non-owner manual should raise';
      exception when others then if sqlerrm like 'assert:%' then raise; end if;
        if sqlerrm not ilike '%owner%' then raise exception 'assert: wrong non-owner manual error: %', sqlerrm; end if; end;
      perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
    end if;

    raise notice 'Tier engine behavioural assertions passed (partner 2436 / direct 100%% / contractor 3000 / small 300 / R1M manual 150000 / attribution freeze / owner-gating).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception
    when others then if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
