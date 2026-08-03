-- Commission Picker BACKEND (Sprint 1, Lane 1a) — part 2 of 3: data model + engine.
-- ============================================================================
-- Real business truth (PICKER.md): funders pay Fund Now Capital in different,
-- dynamic ways per deal. At fund-time the owner picks 4 dimensions on the deal —
--   A: calculation base (1 of 8)   B: tier modifier (0–2)
--   C: timing model (1)            D: special adjustments (0–N)
-- — and the deal's commission moves through POTENTIAL → PENDING → LOCKED.
--
-- THIS PR is BACKEND ONLY (no UI — that is the follow-up PICKER-UI lane):
--   1. Picker columns on `deals` (jsonb picks + state + estimated/actual + lock stamps).
--   2. Seven SECURITY DEFINER calculation-base helpers (the 8th base, owner_override,
--      is a direct owner-typed R amount — no function, per the lane brief).
--   3. Five belt-and-braces state-transition RPCs (set / update / →pending / →locked /
--      unlock) — DEFINER + search_path='' + is_owner() + advisory lock + state guard +
--      activity_logs write + idempotent no-op on same-state.
--   4. Two owner-only read RPCs for downstream use.
--
-- OUT OF SCOPE (later PRs, per brief): UI; partner "Potential Earning" display; the
--   C2 money-engine hand-off (write_commission_record) at LOCK; the Sprint-1b tier
--   engine; notification triggers on state transitions. This PR only *captures* the
--   picker state and *stores* the owner-supplied estimated/actual gross — it never
--   recomputes money into commission_records (that integration lands with LOCK later).
--
-- PRIVACY (POPIA + commission-privacy): every picker column and RPC here is
--   owner-only. The `deals` table is owner-ALL under RLS; every RPC additionally
--   gates on is_owner(). No partner surface is added in this PR.
--
-- Standing rules: money numeric(14,2); percentages numeric(10,4); DEFINER +
--   search_path='' + grants matrix (authenticated; anon/PUBLIC revoked) on every
--   function; RETURNING/FOUND checks (silent-RLS rule); DO-block assertions.
--
-- Rate convention: the picker's `rate` dimension is a WHOLE-NUMBER PERCENT
--   (10 = 10%, per PICKER.md "rate: 10%" → R140,000 finance charge → R14,000). The
--   percent-based calc helpers therefore divide by 100. This is deliberately the
--   picker layer's own convention and is distinct from C0's funder_commission_
--   structures.rate_fraction (0.10) consumed by fnc_gross_commission() — the two
--   layers do not share a rate representation.
-- ============================================================================

-- ===========================================================================
-- 1. Picker columns on `deals`.
--    deals is populated (3 rows) but every new column lands NULL, so the ADDs
--    are metadata-only and the CHECK/FK validate against 3 all-NULL rows in
--    microseconds. Per CLAUDE.md FK discipline the commission_locked_by FK is
--    added NOT VALID here; its backing index is built CONCURRENTLY and the
--    constraint VALIDATEd in part 3 (20260803120200, outside any transaction).
-- ===========================================================================
alter table public.deals
  add column if not exists commission_calculation     jsonb,
  add column if not exists commission_state           text,
  add column if not exists estimated_gross_commission numeric(14,2),
  add column if not exists actual_gross_commission    numeric(14,2),
  add column if not exists commission_locked_at        timestamptz,
  add column if not exists commission_locked_by        uuid;

-- commission_state is a small, closed lifecycle. Kept as text + CHECK (rather than
-- a new enum type) to (a) match the lane brief's stated shape and (b) avoid any
-- confusion with the pre-existing, semantically-different public.commission_state
-- enum (earned/outstanding/payable/settled/void) used by commission_records.
-- NULL = "no picker configured yet" (the deal's default until the owner first sets it).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deals'::regclass and conname = 'deals_commission_state_check'
  ) then
    alter table public.deals
      add constraint deals_commission_state_check
      check (commission_state is null or commission_state in ('potential','pending','locked'));
  end if;
end $$;

-- commission_locked_by → profiles(id) (the owner who locked the actual figure).
-- NOT VALID now (validated in part 3). SET NULL on delete: losing a profile must
-- never delete a deal, only null out the lock attribution.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deals'::regclass and conname = 'deals_commission_locked_by_fkey'
  ) then
    alter table public.deals
      add constraint deals_commission_locked_by_fkey
      foreign key (commission_locked_by) references public.profiles(id) on delete set null
      not valid;
  end if;
end $$;

comment on column public.deals.commission_calculation is
  'Commission Picker 4-dimension picks (jsonb): {base:text, rate:numeric, tier_modifiers:text[], timing:text, adjustments:text[]}. Owner-only. base drives the calculation-base semantics; rate is a whole-number percent (10 = 10%).';
comment on column public.deals.commission_state is
  'Picker lifecycle: NULL (no picker) → potential → pending → locked. Guarded by deals_commission_state_check + the picker state RPCs. Distinct from commission_records.status (the C2 commission_state enum).';
comment on column public.deals.estimated_gross_commission is
  'Owner-supplied estimated FNC gross commission (Rands) at POTENTIAL/PENDING. numeric(14,2). Editable until LOCKED.';
comment on column public.deals.actual_gross_commission is
  'Owner-entered actual FNC gross commission (Rands) captured at LOCK. numeric(14,2). Populated only in the LOCKED state.';
comment on column public.deals.commission_locked_at is 'When the commission was locked (LOCKED state). Cleared on unlock.';
comment on column public.deals.commission_locked_by is 'profiles.id of the owner who locked the commission. Cleared on unlock.';

-- ===========================================================================
-- 2. Calculation-base helpers (7). Pure math — IMMUTABLE — but SECURITY DEFINER
--    + search_path='' + authenticated-only grants per the lane brief's belt-and-
--    braces rule. All return numeric(14,2) (rounded, half-away-from-zero). NULL
--    inputs propagate to NULL (unknown), never to a silent 0.
--
--    These are stateless building blocks for the UI's live estimate; the state
--    RPCs below store whatever estimated/actual gross the owner supplies and do
--    NOT call these (the picker deliberately keeps the human in the loop).
-- ===========================================================================

-- A1: percent of gross funded (rate × facility amount) — business/MCA finance.
create or replace function public.calc_percent_of_gross_funded(
  p_facility_amount numeric, p_rate numeric
) returns numeric(14,2) language sql immutable security definer set search_path to '' as $$
  select round(p_facility_amount * p_rate / 100.0, 2);
$$;

-- A2: percent of finance charge (rate × total fee to client) — Pollen model.
create or replace function public.calc_percent_of_finance_charge(
  p_finance_charge numeric, p_rate numeric
) returns numeric(14,2) language sql immutable security definer set search_path to '' as $$
  select round(p_finance_charge * p_rate / 100.0, 2);
$$;

-- A3: percent of revenue collected (rate × merchant paybacks) — Merchant Capital.
create or replace function public.calc_percent_of_revenue_collected(
  p_revenue numeric, p_rate numeric
) returns numeric(14,2) language sql immutable security definer set search_path to '' as $$
  select round(p_revenue * p_rate / 100.0, 2);
$$;

-- A4: percent of MDR (rate × card processing fee).
create or replace function public.calc_percent_of_mdr(
  p_mdr numeric, p_rate numeric
) returns numeric(14,2) language sql immutable security definer set search_path to '' as $$
  select round(p_mdr * p_rate / 100.0, 2);
$$;

-- A5: percent of client interest (rate × interest earned by lender) — Bright On.
create or replace function public.calc_percent_of_client_interest(
  p_client_interest numeric, p_rate numeric
) returns numeric(14,2) language sql immutable security definer set search_path to '' as $$
  select round(p_client_interest * p_rate / 100.0, 2);
$$;

-- A6: points margin (sell − buy) — MCA buy/sell spread, expressed in points.
--     Returned as numeric(14,2); a negative result (buy > sell) is a real loss
--     and is preserved, not clamped.
create or replace function public.calc_points_margin(
  p_sell_rate numeric, p_buy_rate numeric
) returns numeric(14,2) language sql immutable security definer set search_path to '' as $$
  select round(p_sell_rate - p_buy_rate, 2);
$$;

-- A7: flat rand per deal — the owner-agreed flat R commission (identity round).
create or replace function public.calc_flat_rand_per_deal(
  p_amount numeric
) returns numeric(14,2) language sql immutable security definer set search_path to '' as $$
  select round(p_amount, 2);
$$;
-- A8 (owner override) has NO function: the owner types the exact R amount and it is
-- stored directly as estimated/actual gross — a direct input, per the lane brief.

comment on function public.calc_percent_of_gross_funded(numeric, numeric) is
  'Picker calc base: rate%% of facility amount. rate is a whole-number percent (10 = 10%%). numeric(14,2); NULL-in→NULL-out.';

-- Grants matrix for the 7 calc helpers: authenticated only; anon/PUBLIC revoked.
do $$
declare
  fn text;
  calc_fns constant text[] := array[
    'calc_percent_of_gross_funded(numeric, numeric)',
    'calc_percent_of_finance_charge(numeric, numeric)',
    'calc_percent_of_revenue_collected(numeric, numeric)',
    'calc_percent_of_mdr(numeric, numeric)',
    'calc_percent_of_client_interest(numeric, numeric)',
    'calc_points_margin(numeric, numeric)',
    'calc_flat_rand_per_deal(numeric)'
  ];
begin
  foreach fn in array calc_fns loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ===========================================================================
-- 3. Internal helper: write a picker activity_logs row as the calling owner.
--    Not an API surface (no anon/authenticated grant) — invoked only from the
--    DEFINER state RPCs below (which run as the function owner, so the owner
--    role's implicit EXECUTE is what matters, not the revoked API grants).
--    Mirrors the admin_update_user_role() activity-write shape.
-- ===========================================================================
create or replace function public.log_commission_picker_activity(
  p_deal_id     uuid,
  p_client_id   uuid,
  p_event       public.activity_event_type,
  p_description text,
  p_before      jsonb,
  p_after       jsonb
) returns void language plpgsql security definer set search_path to '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_email text;
  v_role  text;
begin
  if v_uid is not null then
    select email, role into v_email, v_role from public.profiles where id = v_uid;
  end if;
  insert into public.activity_logs
    (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id,
     description, before_values, after_values, related_entity_ids)
  values
    (now(), v_uid, v_email, v_role, p_event, 'deal', p_deal_id,
     p_description, p_before, p_after,
     case when p_client_id is null then null else jsonb_build_array(p_client_id::text) end);
end $$;

revoke all on function public.log_commission_picker_activity(uuid, uuid, public.activity_event_type, text, jsonb, jsonb) from public;
revoke all on function public.log_commission_picker_activity(uuid, uuid, public.activity_event_type, text, jsonb, jsonb) from anon;
revoke all on function public.log_commission_picker_activity(uuid, uuid, public.activity_event_type, text, jsonb, jsonb) from authenticated;

-- ===========================================================================
-- 4. Internal helper: validate the commission_calculation jsonb shape.
--    Strict where semantics depend on it (base ∈ the 8 canonical tokens); lenient
--    where the vocabulary is UI-driven and may grow (timing/modifiers/adjustments
--    are shape-checked, not value-enumerated). Raises on any violation. INVOKER
--    (pure inspection of its argument), search_path='' pinned, no API grant.
-- ===========================================================================
create or replace function public.validate_commission_calculation(p_calculation jsonb)
returns void language plpgsql immutable set search_path to '' as $$
declare
  v_base text;
begin
  if p_calculation is null or jsonb_typeof(p_calculation) <> 'object' then
    raise exception 'commission_calculation must be a JSON object';
  end if;

  v_base := p_calculation->>'base';
  if v_base is null or v_base not in (
    'percent_of_gross_funded','percent_of_finance_charge','percent_of_revenue_collected',
    'percent_of_mdr','percent_of_client_interest','points_margin','flat_rand_per_deal','owner_override'
  ) then
    raise exception 'commission_calculation.base is missing or not one of the 8 calculation bases (got %)', coalesce(v_base, '<null>');
  end if;

  -- timing (Section C, "pick 1") must be present and non-empty; value not enumerated.
  if coalesce(btrim(p_calculation->>'timing'), '') = '' then
    raise exception 'commission_calculation.timing is required';
  end if;

  -- tier_modifiers / adjustments are optional arrays when present.
  if p_calculation ? 'tier_modifiers' and jsonb_typeof(p_calculation->'tier_modifiers') <> 'array' then
    raise exception 'commission_calculation.tier_modifiers must be a JSON array';
  end if;
  if p_calculation ? 'adjustments' and jsonb_typeof(p_calculation->'adjustments') <> 'array' then
    raise exception 'commission_calculation.adjustments must be a JSON array';
  end if;
end $$;

revoke all on function public.validate_commission_calculation(jsonb) from public;
revoke all on function public.validate_commission_calculation(jsonb) from anon;
revoke all on function public.validate_commission_calculation(jsonb) from authenticated;

-- ===========================================================================
-- 5. State-transition RPCs. Every one: SECURITY DEFINER + search_path='' +
--    is_owner() gate + advisory xact lock on the deal + state guard + activity
--    write + idempotent same-state no-op. Grants: authenticated + postgres +
--    service_role; anon/PUBLIC revoked. Returns jsonb {deal_id, commission_state,
--    ..., changed}.
-- ===========================================================================

-- 5a. set_commission_picker — initial pick (→ POTENTIAL). Allowed only from
--     "no picker" (NULL) or an existing POTENTIAL (re-pick). PENDING edits go
--     through update_commission_picker; LOCKED is immutable (unlock first).
create or replace function public.set_commission_picker(
  p_deal_id uuid, p_calculation jsonb, p_estimated_gross numeric
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_deal public.deals;
  v_est  numeric(14,2);
begin
  if not public.is_owner() then raise exception 'Only the owner can set the commission picker'; end if;
  perform pg_advisory_xact_lock(hashtext('deal_commission_picker:' || p_deal_id::text));

  select * into v_deal from public.deals where id = p_deal_id;
  if v_deal.id is null then raise exception 'Deal % not found', p_deal_id; end if;

  if v_deal.commission_state = 'locked' then
    raise exception 'Cannot edit a locked commission (deal %) — unlock it first',
      coalesce(v_deal.reference, p_deal_id::text);
  end if;
  if v_deal.commission_state = 'pending' then
    raise exception 'Commission is pending on deal % — use update_commission_picker to edit',
      coalesce(v_deal.reference, p_deal_id::text);
  end if;

  perform public.validate_commission_calculation(p_calculation);

  v_est := round(p_estimated_gross, 2);
  if v_est is null then raise exception 'estimated gross commission is required to set the picker'; end if;
  if v_est < 0 then raise exception 'estimated gross commission cannot be negative'; end if;

  -- Idempotent: an identical pick already in POTENTIAL is a clean no-op (no log).
  if v_deal.commission_state = 'potential'
     and v_deal.commission_calculation      is not distinct from p_calculation
     and v_deal.estimated_gross_commission  is not distinct from v_est then
    return jsonb_build_object('deal_id', p_deal_id, 'commission_state', 'potential',
                              'estimated_gross_commission', v_est, 'changed', false);
  end if;

  update public.deals
     set commission_calculation     = p_calculation,
         commission_state           = 'potential',
         estimated_gross_commission = v_est,
         actual_gross_commission    = null,   -- only meaningful at LOCKED
         commission_locked_at       = null,
         commission_locked_by       = null
   where id = p_deal_id
   returning * into v_deal;
  if v_deal.id is null then raise exception 'Deal % picker not set (no row written)', p_deal_id; end if;

  perform public.log_commission_picker_activity(
    p_deal_id, v_deal.client_id, 'COMMISSION_PICKER_SET',
    'Commission picker set — POTENTIAL (base ' || (p_calculation->>'base') ||
      ', estimated R' || to_char(v_est, 'FM999999999990.00') || ')',
    jsonb_build_object('commission_state', null),
    jsonb_build_object('commission_state', 'potential',
                       'commission_calculation', p_calculation,
                       'estimated_gross_commission', v_est));

  return jsonb_build_object('deal_id', p_deal_id, 'commission_state', 'potential',
                            'estimated_gross_commission', v_est, 'changed', true);
end $$;

-- 5b. update_commission_picker — edit the picker during POTENTIAL or PENDING.
create or replace function public.update_commission_picker(
  p_deal_id uuid, p_calculation jsonb, p_estimated_gross numeric
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_deal public.deals;
  v_est  numeric(14,2);
begin
  if not public.is_owner() then raise exception 'Only the owner can update the commission picker'; end if;
  perform pg_advisory_xact_lock(hashtext('deal_commission_picker:' || p_deal_id::text));

  select * into v_deal from public.deals where id = p_deal_id;
  if v_deal.id is null then raise exception 'Deal % not found', p_deal_id; end if;

  if v_deal.commission_state is null then
    raise exception 'No commission picker set on deal % — use set_commission_picker first',
      coalesce(v_deal.reference, p_deal_id::text);
  end if;
  if v_deal.commission_state = 'locked' then
    raise exception 'Cannot edit a locked commission (deal %) — unlock it first',
      coalesce(v_deal.reference, p_deal_id::text);
  end if;

  perform public.validate_commission_calculation(p_calculation);

  v_est := round(p_estimated_gross, 2);
  if v_est is null then raise exception 'estimated gross commission is required'; end if;
  if v_est < 0 then raise exception 'estimated gross commission cannot be negative'; end if;

  -- Idempotent: no change → clean no-op (no log).
  if v_deal.commission_calculation     is not distinct from p_calculation
     and v_deal.estimated_gross_commission is not distinct from v_est then
    return jsonb_build_object('deal_id', p_deal_id, 'commission_state', v_deal.commission_state,
                              'estimated_gross_commission', v_est, 'changed', false);
  end if;

  update public.deals
     set commission_calculation     = p_calculation,
         estimated_gross_commission = v_est
   where id = p_deal_id
   returning * into v_deal;
  if v_deal.id is null then raise exception 'Deal % picker not updated (no row written)', p_deal_id; end if;

  perform public.log_commission_picker_activity(
    p_deal_id, v_deal.client_id, 'COMMISSION_PICKER_UPDATED',
    'Commission picker updated (' || v_deal.commission_state || ', base ' || (p_calculation->>'base') ||
      ', estimated R' || to_char(v_est, 'FM999999999990.00') || ')',
    jsonb_build_object('commission_calculation', p_calculation),   -- redundant-safe; full snapshot in after
    jsonb_build_object('commission_state', v_deal.commission_state,
                       'commission_calculation', p_calculation,
                       'estimated_gross_commission', v_est));

  return jsonb_build_object('deal_id', p_deal_id, 'commission_state', v_deal.commission_state,
                            'estimated_gross_commission', v_est, 'changed', true);
end $$;

-- 5c. transition_to_pending — POTENTIAL → PENDING (funder invoice issued).
create or replace function public.transition_to_pending(p_deal_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_deal public.deals;
begin
  if not public.is_owner() then raise exception 'Only the owner can transition commission state'; end if;
  perform pg_advisory_xact_lock(hashtext('deal_commission_picker:' || p_deal_id::text));

  select * into v_deal from public.deals where id = p_deal_id;
  if v_deal.id is null then raise exception 'Deal % not found', p_deal_id; end if;

  if v_deal.commission_state is null then
    raise exception 'No commission picker set on deal % — set it before moving to pending',
      coalesce(v_deal.reference, p_deal_id::text);
  end if;
  if v_deal.commission_state = 'locked' then
    raise exception 'Commission is locked on deal % — unlock it to move back to pending',
      coalesce(v_deal.reference, p_deal_id::text);
  end if;
  -- Idempotent: already pending → clean no-op.
  if v_deal.commission_state = 'pending' then
    return jsonb_build_object('deal_id', p_deal_id, 'commission_state', 'pending', 'changed', false);
  end if;
  -- Only remaining legal source is 'potential'.

  update public.deals set commission_state = 'pending'
   where id = p_deal_id and commission_state = 'potential'
   returning * into v_deal;
  if v_deal.id is null then raise exception 'Deal % not moved to pending (no row written)', p_deal_id; end if;

  perform public.log_commission_picker_activity(
    p_deal_id, v_deal.client_id, 'COMMISSION_STATE_TRANSITION',
    'Commission state POTENTIAL → PENDING',
    jsonb_build_object('commission_state', 'potential'),
    jsonb_build_object('commission_state', 'pending'));

  return jsonb_build_object('deal_id', p_deal_id, 'commission_state', 'pending', 'changed', true);
end $$;

-- 5d. transition_to_locked — PENDING → LOCKED (funder paid; owner enters actual).
--     actual gross is required; the lock stamps who/when. Idempotent if already locked.
create or replace function public.transition_to_locked(p_deal_id uuid, p_actual_gross numeric)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_deal   public.deals;
  v_actual numeric(14,2);
  v_uid    uuid := (select auth.uid());
begin
  if not public.is_owner() then raise exception 'Only the owner can lock a commission'; end if;
  perform pg_advisory_xact_lock(hashtext('deal_commission_picker:' || p_deal_id::text));

  v_actual := round(p_actual_gross, 2);
  if v_actual is null then raise exception 'actual gross commission is required to lock'; end if;
  if v_actual < 0 then raise exception 'actual gross commission cannot be negative'; end if;

  select * into v_deal from public.deals where id = p_deal_id;
  if v_deal.id is null then raise exception 'Deal % not found', p_deal_id; end if;

  if v_deal.commission_state is null then
    raise exception 'No commission picker set on deal % — cannot lock', coalesce(v_deal.reference, p_deal_id::text);
  end if;
  -- Idempotent: already locked → clean no-op (does NOT overwrite the locked actual).
  if v_deal.commission_state = 'locked' then
    return jsonb_build_object('deal_id', p_deal_id, 'commission_state', 'locked',
                              'actual_gross_commission', v_deal.actual_gross_commission, 'changed', false);
  end if;
  if v_deal.commission_state = 'potential' then
    raise exception 'Commission on deal % must be PENDING before locking (it is potential) — move it to pending first',
      coalesce(v_deal.reference, p_deal_id::text);
  end if;
  -- Only remaining legal source is 'pending'.

  update public.deals
     set commission_state        = 'locked',
         actual_gross_commission = v_actual,
         commission_locked_at     = now(),
         commission_locked_by     = v_uid
   where id = p_deal_id and commission_state = 'pending'
   returning * into v_deal;
  if v_deal.id is null then raise exception 'Deal % not locked (no row written)', p_deal_id; end if;

  perform public.log_commission_picker_activity(
    p_deal_id, v_deal.client_id, 'COMMISSION_STATE_TRANSITION',
    'Commission state PENDING → LOCKED (actual R' || to_char(v_actual, 'FM999999999990.00') || ')',
    jsonb_build_object('commission_state', 'pending'),
    jsonb_build_object('commission_state', 'locked', 'actual_gross_commission', v_actual,
                       'commission_locked_by', v_uid));

  return jsonb_build_object('deal_id', p_deal_id, 'commission_state', 'locked',
                            'actual_gross_commission', v_actual, 'changed', true);
end $$;

-- 5e. unlock_commission — LOCKED → PENDING (owner override, typed reason required).
--     Writes a prominent audit row. NOT a silent same-state no-op: unlocking is a
--     deliberate override that demands a reason, so a non-locked deal RAISES (there
--     is no benign "already unlocked" — PENDING is also the post-unlock state).
--     Keeps actual_gross_commission (the disputed figure, preserved for the audit
--     before/after); a subsequent transition_to_locked overwrites it.
create or replace function public.unlock_commission(p_deal_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_deal        public.deals;
  v_reason      text := btrim(coalesce(p_reason, ''));
  v_prev_actual numeric(14,2);
  v_prev_by     uuid;
  v_prev_at     timestamptz;
begin
  if not public.is_owner() then raise exception 'Only the owner can unlock a commission'; end if;
  if v_reason = '' then raise exception 'A typed reason is required to unlock a commission'; end if;
  perform pg_advisory_xact_lock(hashtext('deal_commission_picker:' || p_deal_id::text));

  select * into v_deal from public.deals where id = p_deal_id;
  if v_deal.id is null then raise exception 'Deal % not found', p_deal_id; end if;

  if v_deal.commission_state is distinct from 'locked' then
    raise exception 'Only a locked commission can be unlocked (deal % is %)',
      coalesce(v_deal.reference, p_deal_id::text), coalesce(v_deal.commission_state, 'unset');
  end if;

  v_prev_actual := v_deal.actual_gross_commission;
  v_prev_by     := v_deal.commission_locked_by;
  v_prev_at     := v_deal.commission_locked_at;

  update public.deals
     set commission_state    = 'pending',
         commission_locked_at = null,
         commission_locked_by = null
         -- actual_gross_commission intentionally retained (disputed figure).
   where id = p_deal_id and commission_state = 'locked'
   returning * into v_deal;
  if v_deal.id is null then raise exception 'Deal % not unlocked (no row written)', p_deal_id; end if;

  perform public.log_commission_picker_activity(
    p_deal_id, v_deal.client_id, 'COMMISSION_STATE_TRANSITION',
    'Commission UNLOCKED (owner override) LOCKED → PENDING — reason: ' || v_reason,
    jsonb_build_object('commission_state', 'locked', 'actual_gross_commission', v_prev_actual,
                       'commission_locked_by', v_prev_by, 'commission_locked_at', v_prev_at),
    jsonb_build_object('commission_state', 'pending', 'override_reason', v_reason));

  return jsonb_build_object('deal_id', p_deal_id, 'commission_state', 'pending',
                            'unlocked', true, 'changed', true);
end $$;

-- ===========================================================================
-- 6. Read RPCs (owner-only, DEFINER + is_owner() + search_path='', STABLE).
-- ===========================================================================

-- 6a. get_deal_commission_state — full picker + state + estimated/actual for one deal.
create or replace function public.get_deal_commission_state(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_deal public.deals;
begin
  if not public.is_owner() then raise exception 'Only the owner can read commission state'; end if;

  select * into v_deal from public.deals where id = p_deal_id;
  if v_deal.id is null then raise exception 'Deal % not found', p_deal_id; end if;

  return jsonb_build_object(
    'deal_id',                     v_deal.id,
    'reference',                   v_deal.reference,
    'commission_calculation',      v_deal.commission_calculation,
    'commission_state',            v_deal.commission_state,
    'estimated_gross_commission',  v_deal.estimated_gross_commission,
    'actual_gross_commission',     v_deal.actual_gross_commission,
    'commission_locked_at',        v_deal.commission_locked_at,
    'commission_locked_by',        v_deal.commission_locked_by);
end $$;

-- 6b. list_deals_by_commission_state — owner's deals in a given picker state.
create or replace function public.list_deals_by_commission_state(p_state text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_out jsonb;
begin
  if not public.is_owner() then raise exception 'Only the owner can list deals by commission state'; end if;
  if p_state is null or p_state not in ('potential','pending','locked') then
    raise exception 'p_state must be one of potential/pending/locked (got %)', coalesce(p_state, '<null>');
  end if;

  select coalesce(jsonb_agg(row_to_jsonb(t) order by t.updated_at desc), '[]'::jsonb)
    into v_out
  from (
    select d.id as deal_id, d.reference, d.client_id, d.commission_state,
           d.commission_calculation, d.estimated_gross_commission, d.actual_gross_commission,
           d.commission_locked_at, d.commission_locked_by, d.updated_at
    from public.deals d
    where d.commission_state = p_state
  ) t;

  return v_out;
end $$;

-- ===========================================================================
-- 7. Grants matrix for the 5 state RPCs + 2 read RPCs: authenticated + postgres
--    + service_role (per lane brief); anon/PUBLIC revoked. is_owner() is the real
--    gate inside every body.
-- ===========================================================================
do $$
declare
  fn text;
  api_fns constant text[] := array[
    'set_commission_picker(uuid, jsonb, numeric)',
    'update_commission_picker(uuid, jsonb, numeric)',
    'transition_to_pending(uuid)',
    'transition_to_locked(uuid, numeric)',
    'unlock_commission(uuid, text)',
    'get_deal_commission_state(uuid)',
    'list_deals_by_commission_state(text)'
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

comment on function public.set_commission_picker(uuid, jsonb, numeric) is
  'Picker BACKEND: owner sets the initial 4-dimension picks on a deal (→ POTENTIAL). DEFINER + is_owner + advisory lock + idempotent. Writes COMMISSION_PICKER_SET.';
comment on function public.transition_to_locked(uuid, numeric) is
  'Picker BACKEND: PENDING → LOCKED with the owner-entered actual gross (stamps locked_by/at). Idempotent if already locked. Writes COMMISSION_STATE_TRANSITION. Does NOT yet hand off to write_commission_record (that C2 integration is a later PR).';
comment on function public.unlock_commission(uuid, text) is
  'Picker BACKEND: LOCKED → PENDING owner override; requires a typed reason; writes a prominent COMMISSION_STATE_TRANSITION audit row. Raises on a non-locked deal.';

-- ===========================================================================
-- 8. Structural assertions — RAISE (roll the migration back) on any drift.
--    No production rows touched.
-- ===========================================================================
do $$
declare
  r        record;
  v_cnt    int;
  -- (fn signature, expected identity args)
  sigs constant text[][] := array[
    ['public.calc_percent_of_gross_funded(numeric,numeric)',       'p_facility_amount numeric, p_rate numeric'],
    ['public.calc_percent_of_finance_charge(numeric,numeric)',     'p_finance_charge numeric, p_rate numeric'],
    ['public.calc_percent_of_revenue_collected(numeric,numeric)',  'p_revenue numeric, p_rate numeric'],
    ['public.calc_percent_of_mdr(numeric,numeric)',                'p_mdr numeric, p_rate numeric'],
    ['public.calc_percent_of_client_interest(numeric,numeric)',    'p_client_interest numeric, p_rate numeric'],
    ['public.calc_points_margin(numeric,numeric)',                 'p_sell_rate numeric, p_buy_rate numeric'],
    ['public.calc_flat_rand_per_deal(numeric)',                    'p_amount numeric'],
    ['public.set_commission_picker(uuid,jsonb,numeric)',           'p_deal_id uuid, p_calculation jsonb, p_estimated_gross numeric'],
    ['public.update_commission_picker(uuid,jsonb,numeric)',        'p_deal_id uuid, p_calculation jsonb, p_estimated_gross numeric'],
    ['public.transition_to_pending(uuid)',                         'p_deal_id uuid'],
    ['public.transition_to_locked(uuid,numeric)',                  'p_deal_id uuid, p_actual_gross numeric'],
    ['public.unlock_commission(uuid,text)',                        'p_deal_id uuid, p_reason text'],
    ['public.get_deal_commission_state(uuid)',                     'p_deal_id uuid'],
    ['public.list_deals_by_commission_state(text)',                'p_state text']
  ];
  -- functions that must be SECURITY DEFINER with a pinned search_path
  definer_fns constant text[] := array[
    'public.calc_percent_of_gross_funded(numeric,numeric)',
    'public.calc_percent_of_finance_charge(numeric,numeric)',
    'public.calc_percent_of_revenue_collected(numeric,numeric)',
    'public.calc_percent_of_mdr(numeric,numeric)',
    'public.calc_percent_of_client_interest(numeric,numeric)',
    'public.calc_points_margin(numeric,numeric)',
    'public.calc_flat_rand_per_deal(numeric)',
    'public.set_commission_picker(uuid,jsonb,numeric)',
    'public.update_commission_picker(uuid,jsonb,numeric)',
    'public.transition_to_pending(uuid)',
    'public.transition_to_locked(uuid,numeric)',
    'public.unlock_commission(uuid,text)',
    'public.get_deal_commission_state(uuid)',
    'public.list_deals_by_commission_state(text)'
  ];
  -- API-callable set (calc = authenticated only; state/read = +postgres+service_role)
  auth_only_fns constant text[] := array[
    'calc_percent_of_gross_funded','calc_percent_of_finance_charge','calc_percent_of_revenue_collected',
    'calc_percent_of_mdr','calc_percent_of_client_interest','calc_points_margin','calc_flat_rand_per_deal'
  ];
  api_fns constant text[] := array[
    'set_commission_picker','update_commission_picker','transition_to_pending','transition_to_locked',
    'unlock_commission','get_deal_commission_state','list_deals_by_commission_state'
  ];
  fn text;
  fn_row text[];
  sig text;
  want text;
begin
  -- (a) picker columns exist with the right types.
  select count(*) into v_cnt from information_schema.columns
   where table_schema='public' and table_name='deals'
     and column_name in ('commission_calculation','commission_state','estimated_gross_commission',
                         'actual_gross_commission','commission_locked_at','commission_locked_by');
  if v_cnt <> 6 then raise exception 'assert: expected 6 picker columns on deals, found %', v_cnt; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='deals'
      and column_name='estimated_gross_commission' and numeric_precision=14 and numeric_scale=2) then
    raise exception 'assert: estimated_gross_commission is not numeric(14,2)'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='deals'
      and column_name='actual_gross_commission' and numeric_precision=14 and numeric_scale=2) then
    raise exception 'assert: actual_gross_commission is not numeric(14,2)'; end if;

  -- (b) constraints: state CHECK + locked_by FK present.
  if not exists (select 1 from pg_constraint where conrelid='public.deals'::regclass
      and conname='deals_commission_state_check') then
    raise exception 'assert: deals_commission_state_check missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid='public.deals'::regclass
      and conname='deals_commission_locked_by_fkey' and contype='f') then
    raise exception 'assert: deals_commission_locked_by_fkey missing'; end if;

  -- (c) every function exists with the exact signature.
  foreach fn_row slice 1 in array sigs loop
    sig  := fn_row[1];
    want := fn_row[2];
    if to_regprocedure(sig) is null then
      raise exception 'assert: function % does not exist', sig; end if;
    if pg_get_function_identity_arguments(sig::regprocedure) <> want then
      raise exception 'assert: % signature drift — got %', sig,
        pg_get_function_identity_arguments(sig::regprocedure); end if;
  end loop;

  -- (d) all 14 are SECURITY DEFINER with a pinned search_path.
  foreach sig in array definer_fns loop
    select p.prosecdef as is_def,
           exists(select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%') as sp_pinned
      into r
      from pg_proc p where p.oid = sig::regprocedure;
    if not r.is_def    then raise exception 'assert: % is not SECURITY DEFINER', sig; end if;
    if not r.sp_pinned then raise exception 'assert: % search_path not pinned', sig; end if;
  end loop;

  -- (e) grants matrix. calc helpers: authenticated only, no anon/PUBLIC.
  foreach fn in array auth_only_fns loop
    if not exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=fn and grantee='authenticated' and privilege_type='EXECUTE') then
      raise exception 'assert: % missing authenticated EXECUTE', fn; end if;
    if exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=fn and grantee in ('anon','PUBLIC') and privilege_type='EXECUTE') then
      raise exception 'assert: % still granted to anon/PUBLIC', fn; end if;
  end loop;
  -- state + read RPCs: authenticated (+ postgres + service_role), no anon/PUBLIC.
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

  -- (f) internal helpers hold NO API-role EXECUTE.
  foreach fn in array array['log_commission_picker_activity','validate_commission_calculation'] loop
    if exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=fn and grantee in ('anon','authenticated','PUBLIC') and privilege_type='EXECUTE') then
      raise exception 'assert: internal helper % is API-callable', fn; end if;
  end loop;

  -- (g) calc-base arithmetic (rate is whole-number percent → ÷100).
  if public.calc_percent_of_finance_charge(140000, 10)    <> 14000.00 then raise exception 'assert: finance_charge calc'; end if;
  if public.calc_percent_of_gross_funded(400000, 10)      <> 40000.00 then raise exception 'assert: gross_funded calc'; end if;
  if public.calc_percent_of_revenue_collected(50000, 5)   <>  2500.00 then raise exception 'assert: revenue calc'; end if;
  if public.calc_percent_of_mdr(20000, 2.5)               <>   500.00 then raise exception 'assert: mdr calc'; end if;
  if public.calc_percent_of_client_interest(80000, 7.5)   <>  6000.00 then raise exception 'assert: client_interest calc'; end if;
  if public.calc_points_margin(1.50, 1.20)                <>     0.30 then raise exception 'assert: points_margin calc'; end if;
  if public.calc_flat_rand_per_deal(12500.5)              <> 12500.50 then raise exception 'assert: flat calc'; end if;
  if public.calc_percent_of_gross_funded(null, 10)        is not null then raise exception 'assert: NULL-in should be NULL-out'; end if;

  raise notice 'Picker BACKEND structural assertions passed (columns, constraints, 14 signatures, definer/search_path, grants matrix, calc math).';
end $$;

-- ===========================================================================
-- 9. Behavioural assertions — full state machine, owner-gating, idempotency.
--    Uses the new activity_event_type values (added + committed in part 1), so
--    this runs ONLY at real apply (part 1 → part 2 in order), not in a same-tx
--    dry-run. Synthetic rows use an EXPLICIT reference (never nextval) and are
--    unwound by a deliberate ROLLBACK_TEST_DATA raise.
-- ===========================================================================
do $$
declare
  v_owner   uuid;
  v_nonown  uuid;
  v_client  uuid;
  v_deal    uuid;
  v_res     jsonb;
  v_state   jsonb;
  v_calc    jsonb := jsonb_build_object(
              'base','percent_of_finance_charge','rate',10,
              'tier_modifiers', jsonb_build_array(),
              'timing','upfront',
              'adjustments', jsonb_build_array('vat_inclusive'));
  v_txt     text;
begin
  select id into v_owner  from public.profiles where role='owner' limit 1;
  select id into v_nonown from public.profiles where role <> 'owner' limit 1;
  select id into v_client from public.clients limit 1;

  if v_owner is null or v_client is null then
    raise notice 'Picker BACKEND behavioural assertions skipped (no owner / no client present).';
    return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    insert into public.deals (client_id, reference, stage, is_purchase_order)
      values (v_client, 'PICKER_TEST_ROLLBACK', 'document_collection', false)
      returning id into v_deal;

    -- (1) set → POTENTIAL, estimated 14000.
    v_res := public.set_commission_picker(v_deal, v_calc, 14000);
    if (v_res->>'commission_state') <> 'potential' then raise exception 'assert: set state %', v_res; end if;
    if (v_res->>'changed') <> 'true' then raise exception 'assert: set changed flag'; end if;

    -- (2) get_deal_commission_state → potential + estimated 14000 + full picker.
    v_state := public.get_deal_commission_state(v_deal);
    if (v_state->>'commission_state') <> 'potential' then raise exception 'assert: get state'; end if;
    if (v_state->>'estimated_gross_commission')::numeric <> 14000 then raise exception 'assert: get estimated'; end if;
    if (v_state->'commission_calculation'->>'base') <> 'percent_of_finance_charge' then raise exception 'assert: get base'; end if;

    -- (2b) set idempotency: same pick again → changed=false, no dup activity row.
    v_res := public.set_commission_picker(v_deal, v_calc, 14000);
    if (v_res->>'changed') <> 'false' then raise exception 'assert: set idempotency'; end if;

    -- (2c) update during POTENTIAL → COMMISSION_PICKER_UPDATED.
    v_res := public.update_commission_picker(v_deal, v_calc, 15000);
    if (v_res->>'changed') <> 'true' or (v_res->>'estimated_gross_commission')::numeric <> 15000 then
      raise exception 'assert: update potential'; end if;

    -- (3) transition_to_pending → pending; idempotent second call.
    v_res := public.transition_to_pending(v_deal);
    if (v_res->>'commission_state') <> 'pending' or (v_res->>'changed') <> 'true' then raise exception 'assert: →pending'; end if;
    v_res := public.transition_to_pending(v_deal);
    if (v_res->>'changed') <> 'false' then raise exception 'assert: →pending idempotency'; end if;

    -- (3b) locking straight from... it is pending now; lock requires actual.
    begin
      v_res := public.transition_to_locked(v_deal, null);
      raise exception 'assert: lock without actual should have raised';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;  -- re-raise our own
    end;

    -- (4) transition_to_locked(14000) → locked + actual + locked_by owner.
    v_res := public.transition_to_locked(v_deal, 14000);
    if (v_res->>'commission_state') <> 'locked' then raise exception 'assert: →locked state'; end if;
    if (v_res->>'actual_gross_commission')::numeric <> 14000 then raise exception 'assert: →locked actual'; end if;
    v_state := public.get_deal_commission_state(v_deal);
    if (v_state->>'commission_locked_by') <> v_owner::text then raise exception 'assert: locked_by owner'; end if;
    if (v_state->>'commission_locked_at') is null then raise exception 'assert: locked_at set'; end if;

    -- (4b) locked idempotency: second lock → changed=false, actual unchanged.
    v_res := public.transition_to_locked(v_deal, 99999);
    if (v_res->>'changed') <> 'false' then raise exception 'assert: locked idempotency'; end if;
    if (v_res->>'actual_gross_commission')::numeric <> 14000 then raise exception 'assert: locked idempotency preserved actual'; end if;

    -- (5) set on a LOCKED deal → raises "cannot edit locked".
    begin
      v_res := public.set_commission_picker(v_deal, v_calc, 14000);
      raise exception 'assert: set on locked should have raised';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not like '%locked%' then raise exception 'assert: wrong locked error: %', sqlerrm; end if;
    end;

    -- (6) unlock (typed reason) → pending + lock stamps cleared + prominent audit row.
    v_res := public.unlock_commission(v_deal, 'funder disputed amount');
    if (v_res->>'commission_state') <> 'pending' then raise exception 'assert: unlock state'; end if;
    v_state := public.get_deal_commission_state(v_deal);
    if (v_state->>'commission_locked_by') is not null then raise exception 'assert: unlock cleared locked_by'; end if;
    if not exists (
      select 1 from public.activity_logs
      where entity_type='deal' and entity_id=v_deal and event_type='COMMISSION_STATE_TRANSITION'
        and description ilike '%UNLOCKED%funder disputed amount%') then
      raise exception 'assert: unlock did not write a prominent audit row'; end if;

    -- (6b) unlock again (now pending) → raises (not locked).
    begin
      v_res := public.unlock_commission(v_deal, 'again');
      raise exception 'assert: unlock on non-locked should have raised';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not like '%locked%' then raise exception 'assert: wrong unlock error: %', sqlerrm; end if;
    end;

    -- (6c) unlock without reason → raises.
    v_res := public.transition_to_locked(v_deal, 14000);  -- re-lock to test
    begin
      v_res := public.unlock_commission(v_deal, '   ');
      raise exception 'assert: unlock without reason should have raised';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not like '%reason%' then raise exception 'assert: wrong no-reason error: %', sqlerrm; end if;
    end;

    -- (7) list_deals_by_commission_state includes our locked deal.
    v_res := public.list_deals_by_commission_state('locked');
    if not (v_res @> jsonb_build_array(jsonb_build_object('deal_id', v_deal))) then
      -- @> on nested object arrays is picky; fall back to an explicit scan.
      if not exists (select 1 from jsonb_array_elements(v_res) e where (e->>'deal_id') = v_deal::text) then
        raise exception 'assert: list_deals_by_commission_state(locked) missing our deal'; end if;
    end if;
    -- invalid state arg → raises.
    begin
      v_res := public.list_deals_by_commission_state('bogus');
      raise exception 'assert: invalid list state should have raised';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
    end;

    -- (8) NON-OWNER is denied on every RPC.
    if v_nonown is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_nonown)::text, true);
      begin
        v_res := public.set_commission_picker(v_deal, v_calc, 14000);
        raise exception 'assert: non-owner set should have raised';
      exception when others then
        if sqlerrm like 'assert:%' then raise; end if;
        if sqlerrm not ilike '%owner%' then raise exception 'assert: wrong non-owner error: %', sqlerrm; end if;
      end;
      begin
        v_res := public.get_deal_commission_state(v_deal);
        raise exception 'assert: non-owner read should have raised';
      exception when others then
        if sqlerrm like 'assert:%' then raise; end if;
      end;
      perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
    end if;

    raise notice 'Picker BACKEND behavioural assertions passed (set/get/update/→pending/→locked/unlock, idempotency, owner-gating).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
