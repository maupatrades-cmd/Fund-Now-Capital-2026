-- Commission Picker BACKEND (Sprint 1, Lane 1a) — part 2 of 2: data model + engine.
-- ============================================================================
-- Real business truth (PICKER.md): funders pay Fund Now Capital in different,
-- dynamic ways per deal. At fund-time the owner picks 4 dimensions on the deal —
--   A: calculation base (1 of 8)   B: tier modifier (0–2)
--   C: timing model (1)            D: special adjustments (0–N)
-- — and the deal's commission moves POTENTIAL → PENDING → LOCKED.
--
-- THIS PR is BACKEND ONLY (no UI — that is the follow-up PICKER-UI lane):
--   1. An OWNER-ONLY `deal_commissions` table (1:1 with deals) holding the picker
--      picks + state + estimated/actual gross + lock stamps.
--   2. Seven SECURITY DEFINER calculation-base helpers (the 8th base, owner_override,
--      is a direct owner-typed R amount — no function, per the lane brief).
--   3. Five belt-and-braces state-transition RPCs (set / update / →pending / →locked /
--      unlock) — DEFINER + search_path='' + is_owner() + advisory lock + state guard +
--      activity_logs write + idempotent no-op on same-state.
--   4. Two owner-only read RPCs for downstream use.
--
-- WHY A SEPARATE TABLE (Macroscope round-1, Critical + High — both fixed here):
--   * Critical: the picker fields were originally added to `deals`, but `deals` has a
--     partner SELECT policy (`deals_partner_read_own`). RLS is row-level, not
--     column-level, so a partner reading their own referred deal could SELECT the
--     FNC gross (estimated/actual) + calculation — data PICKER.md says partners must
--     NEVER see. `deal_commissions` has an owner-only policy and NO partner policy, so
--     partners cannot reach these columns at all.
--   * High: `deals_owner_all` grants the owner full UPDATE, so picker columns on `deals`
--     were directly writable — the state machine was only a convention the client could
--     ignore (e.g. set state='locked' with no actual). Here INSERT/UPDATE/DELETE on
--     `deal_commissions` are REVOKED from `authenticated`; only the SECURITY DEFINER
--     RPCs (which run as the table owner and bypass both the revoke and RLS) can write.
--     The lifecycle is now enforced at the table boundary, not by convention.
--
-- OUT OF SCOPE (later PRs, per brief): UI; partner "Potential Earning" display; the
--   C2 money-engine hand-off (write_commission_record) at LOCK; the Sprint-1b tier
--   engine; notification triggers on state transitions. This PR only *captures* the
--   picker state and *stores* the owner-supplied estimated/actual gross.
--
-- Standing rules: money numeric(14,2); percentages numeric(10,4); DEFINER +
--   search_path='' + grants matrix on every function; RETURNING/FOUND checks
--   (silent-RLS rule); DO-block assertions.
--
-- Rate convention: the picker's `rate` dimension is a WHOLE-NUMBER PERCENT
--   (10 = 10%, per PICKER.md "rate: 10%" → R140,000 finance charge → R14,000). The
--   percent-based calc helpers therefore divide by 100. Distinct from C0's
--   funder_commission_structures.rate_fraction (0.10) consumed by fnc_gross_commission().
--
-- EMPTY-TABLE RATIONALE (mirrors the C2.2 header precedent): deal_commissions is
--   created empty, so its PK / FKs / indexes are metadata-only or scan-nothing —
--   inline valid FKs + plain indexes are instant with no write-blocking lock. The
--   NOT VALID / CREATE INDEX CONCURRENTLY discipline exists to keep locks off
--   *populated* tables; it buys nothing on a brand-new empty one. (This is why the
--   round-1 CONCURRENTLY follow-up migration is gone.)
-- ============================================================================

-- ===========================================================================
-- 1. deal_commissions — owner-only, 1:1 with deals.
--    commission_state is NOT NULL (a row exists only once the owner sets the
--    picker; "no picker configured" = no row). estimated_gross is captured at
--    creation; actual + lock stamps are populated only at LOCKED.
-- ===========================================================================
create table if not exists public.deal_commissions (
  deal_id                    uuid primary key
                               references public.deals(id) on delete cascade,
  commission_calculation     jsonb not null,
  commission_state           text  not null default 'potential'
                               check (commission_state in ('potential','pending','locked')),
  estimated_gross_commission numeric(14,2) not null,
  actual_gross_commission    numeric(14,2),
  commission_locked_at       timestamptz,
  commission_locked_by       uuid references public.profiles(id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  -- Integrity: actual + lock stamps exist iff locked; a locked row must carry an
  -- actual figure. Belt-and-braces so even a DEFINER RPC bug cannot persist a
  -- half-locked row.
  constraint deal_commissions_locked_shape check (
    (commission_state = 'locked'
       and actual_gross_commission is not null
       and commission_locked_at is not null)
    or
    (commission_state <> 'locked'
       and commission_locked_at is null
       and commission_locked_by is null)
  )
);

comment on table public.deal_commissions is
  'Owner-only Commission Picker state, 1:1 with deals (PICKER.md). Holds the 4-dimension picks + lifecycle state + estimated/actual FNC gross + lock stamps. NO partner RLS policy (FNC gross is owner-only forever). Written ONLY by the SECURITY DEFINER picker RPCs — direct INSERT/UPDATE/DELETE is revoked from authenticated so the state machine is enforced at the table boundary.';
comment on column public.deal_commissions.commission_calculation is
  'Picker 4-dimension picks (jsonb): {base:text, rate:numeric, tier_modifiers:text[], timing:text, adjustments:text[]}. rate is a whole-number percent (10 = 10%).';
comment on column public.deal_commissions.commission_state is
  'Picker lifecycle: potential → pending → locked (no row = no picker). Advanced only via the picker RPCs.';
comment on column public.deal_commissions.estimated_gross_commission is
  'Owner-supplied estimated FNC gross commission (Rands) at POTENTIAL/PENDING. Editable until LOCKED.';
comment on column public.deal_commissions.actual_gross_commission is
  'Owner-entered actual FNC gross commission (Rands) captured at LOCK. Populated only in the LOCKED state.';

create index if not exists idx_deal_commissions_state on public.deal_commissions (commission_state);
create index if not exists idx_deal_commissions_locked_by on public.deal_commissions (commission_locked_by);

-- keep updated_at fresh (house set_updated_at() trigger fn).
drop trigger if exists deal_commissions_set_updated_at on public.deal_commissions;
create trigger deal_commissions_set_updated_at
  before update on public.deal_commissions
  for each row execute function public.set_updated_at();

-- RLS: owner-only. No partner policy — partners can never read commission data.
alter table public.deal_commissions enable row level security;
drop policy if exists deal_commissions_owner_all on public.deal_commissions;
create policy deal_commissions_owner_all on public.deal_commissions
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Grants matrix (Macroscope High): authenticated may SELECT (owner reads, scoped by
-- the owner-only policy above; a partner's SELECT returns zero rows), but may hold NO
-- other privilege — every write goes through a DEFINER picker RPC. `revoke all` first
-- strips the Supabase default grant in full (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER — note TRUNCATE would bypass RLS and wipe the table), then only
-- SELECT is granted back. anon gets nothing.
revoke all on table public.deal_commissions from anon, public, authenticated;
grant select on table public.deal_commissions to authenticated;

-- ===========================================================================
-- 2. Calculation-base helpers (7). Pure math — IMMUTABLE — but SECURITY DEFINER
--    + search_path='' + authenticated-only grants per the lane brief's belt-and-
--    braces rule. All return numeric(14,2) (rounded, half-away-from-zero). NULL
--    inputs propagate to NULL (unknown), never to a silent 0.
-- ===========================================================================
create or replace function public.calc_percent_of_gross_funded(p_facility_amount numeric, p_rate numeric)
returns numeric(14,2) language sql immutable security definer set search_path to '' as $$ select round(p_facility_amount * p_rate / 100.0, 2); $$;
create or replace function public.calc_percent_of_finance_charge(p_finance_charge numeric, p_rate numeric)
returns numeric(14,2) language sql immutable security definer set search_path to '' as $$ select round(p_finance_charge * p_rate / 100.0, 2); $$;
create or replace function public.calc_percent_of_revenue_collected(p_revenue numeric, p_rate numeric)
returns numeric(14,2) language sql immutable security definer set search_path to '' as $$ select round(p_revenue * p_rate / 100.0, 2); $$;
create or replace function public.calc_percent_of_mdr(p_mdr numeric, p_rate numeric)
returns numeric(14,2) language sql immutable security definer set search_path to '' as $$ select round(p_mdr * p_rate / 100.0, 2); $$;
create or replace function public.calc_percent_of_client_interest(p_client_interest numeric, p_rate numeric)
returns numeric(14,2) language sql immutable security definer set search_path to '' as $$ select round(p_client_interest * p_rate / 100.0, 2); $$;
-- points margin (sell − buy), in points; a negative result (buy > sell) is a real loss, preserved.
create or replace function public.calc_points_margin(p_sell_rate numeric, p_buy_rate numeric)
returns numeric(14,2) language sql immutable security definer set search_path to '' as $$ select round(p_sell_rate - p_buy_rate, 2); $$;
-- flat rand per deal — the owner-agreed flat R commission (identity round).
create or replace function public.calc_flat_rand_per_deal(p_amount numeric)
returns numeric(14,2) language sql immutable security definer set search_path to '' as $$ select round(p_amount, 2); $$;
-- A8 (owner override) has NO function: the owner types the exact R amount and it is
-- stored directly as estimated/actual gross — a direct input, per the lane brief.

comment on function public.calc_percent_of_finance_charge(numeric, numeric) is
  'Picker calc base: rate%% of finance charge. rate is a whole-number percent (10 = 10%%). numeric(14,2); NULL-in→NULL-out.';

do $$
declare
  fn text;
  calc_fns constant text[] := array[
    'calc_percent_of_gross_funded(numeric, numeric)','calc_percent_of_finance_charge(numeric, numeric)',
    'calc_percent_of_revenue_collected(numeric, numeric)','calc_percent_of_mdr(numeric, numeric)',
    'calc_percent_of_client_interest(numeric, numeric)','calc_points_margin(numeric, numeric)',
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
--    DEFINER state RPCs (which run as the function owner). entity is the DEAL, so
--    picker events surface on the deal's Activity tab.
-- ===========================================================================
create or replace function public.log_commission_picker_activity(
  p_deal_id uuid, p_client_id uuid, p_event public.activity_event_type,
  p_description text, p_before jsonb, p_after jsonb
) returns void language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text; v_role text;
begin
  if v_uid is not null then select email, role into v_email, v_role from public.profiles where id = v_uid; end if;
  insert into public.activity_logs
    (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id,
     description, before_values, after_values, related_entity_ids)
  values (now(), v_uid, v_email, v_role, p_event, 'deal', p_deal_id, p_description, p_before, p_after,
     case when p_client_id is null then null else jsonb_build_array(p_client_id::text) end);
end $$;

revoke all on function public.log_commission_picker_activity(uuid, uuid, public.activity_event_type, text, jsonb, jsonb) from public, anon, authenticated;

-- ===========================================================================
-- 4. Internal helper: validate the commission_calculation jsonb shape.
--    Enforces the declared {base, rate:numeric, tier_modifiers:text[], timing,
--    adjustments:text[]} contract (Macroscope Medium round-1):
--      * base ∈ the 8 canonical tokens (drives calc semantics);
--      * timing present + non-empty (Section C "pick 1"; value not enumerated —
--        UI-driven vocabulary);
--      * rate present AND a JSON number for the 5 percent bases; optional but,
--        when present, still a JSON number for owner_override / flat_rand_per_deal
--        / points_margin (those don't consume a single percent rate);
--      * tier_modifiers / adjustments, when present, are arrays of STRINGS (text[]).
--    Raises on any violation. INVOKER, search_path='' pinned, no API grant.
-- ===========================================================================
create or replace function public.validate_commission_calculation(p_calculation jsonb)
returns void language plpgsql immutable set search_path to '' as $$
declare
  v_base text;
  v_percent_bases constant text[] := array[
    'percent_of_gross_funded','percent_of_finance_charge','percent_of_revenue_collected',
    'percent_of_mdr','percent_of_client_interest'];
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

  if coalesce(btrim(p_calculation->>'timing'), '') = '' then
    raise exception 'commission_calculation.timing is required';
  end if;

  -- rate: required + numeric for percent bases; optional-but-numeric otherwise.
  if v_base = any (v_percent_bases) then
    if not (p_calculation ? 'rate') or jsonb_typeof(p_calculation->'rate') <> 'number' then
      raise exception 'commission_calculation.rate must be a number for base %', v_base;
    end if;
  elsif (p_calculation ? 'rate') and jsonb_typeof(p_calculation->'rate') <> 'number' then
    raise exception 'commission_calculation.rate, when present, must be a number';
  end if;

  -- tier_modifiers / adjustments: arrays of strings (text[]) when present.
  if p_calculation ? 'tier_modifiers' then
    if jsonb_typeof(p_calculation->'tier_modifiers') <> 'array' then
      raise exception 'commission_calculation.tier_modifiers must be a JSON array';
    end if;
    if exists (select 1 from jsonb_array_elements(p_calculation->'tier_modifiers') e where jsonb_typeof(e) <> 'string') then
      raise exception 'commission_calculation.tier_modifiers must contain only strings';
    end if;
  end if;
  if p_calculation ? 'adjustments' then
    if jsonb_typeof(p_calculation->'adjustments') <> 'array' then
      raise exception 'commission_calculation.adjustments must be a JSON array';
    end if;
    if exists (select 1 from jsonb_array_elements(p_calculation->'adjustments') e where jsonb_typeof(e) <> 'string') then
      raise exception 'commission_calculation.adjustments must contain only strings';
    end if;
  end if;
end $$;

revoke all on function public.validate_commission_calculation(jsonb) from public, anon, authenticated;

-- ===========================================================================
-- 5. State-transition RPCs. Every one: SECURITY DEFINER + search_path='' +
--    is_owner() + advisory xact lock on the deal + state guard + activity write +
--    idempotent same-state no-op. Grants: authenticated + postgres + service_role;
--    anon/PUBLIC revoked. All writes hit deal_commissions (owner-bypasses-RLS via
--    DEFINER; direct writes are revoked from authenticated).
-- ===========================================================================

-- 5a. set_commission_picker — initial pick (→ POTENTIAL). Allowed only when there
--     is no picker row yet OR the existing row is POTENTIAL (re-pick). PENDING edits
--     go through update_commission_picker; LOCKED is immutable (unlock first).
create or replace function public.set_commission_picker(
  p_deal_id uuid, p_calculation jsonb, p_estimated_gross numeric
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_client_id uuid;
  v_ref       text;
  v_dc        public.deal_commissions;
  v_est       numeric(14,2);
  v_before    jsonb;
begin
  if not public.is_owner() then raise exception 'Only the owner can set the commission picker'; end if;
  perform pg_advisory_xact_lock(hashtext('deal_commission_picker:' || p_deal_id::text));

  select client_id, reference into v_client_id, v_ref from public.deals where id = p_deal_id;
  if not found then raise exception 'Deal % not found', p_deal_id; end if;

  select * into v_dc from public.deal_commissions where deal_id = p_deal_id;
  if found and v_dc.commission_state = 'locked' then
    raise exception 'Cannot edit a locked commission (deal %) — unlock it first', coalesce(v_ref, p_deal_id::text);
  end if;
  if found and v_dc.commission_state = 'pending' then
    raise exception 'Commission is pending on deal % — use update_commission_picker to edit', coalesce(v_ref, p_deal_id::text);
  end if;

  perform public.validate_commission_calculation(p_calculation);
  v_est := round(p_estimated_gross, 2);
  if v_est is null then raise exception 'estimated gross commission is required to set the picker'; end if;
  if v_est < 0 then raise exception 'estimated gross commission cannot be negative'; end if;

  -- Idempotent: identical pick already in POTENTIAL → clean no-op (no log).
  if found
     and v_dc.commission_calculation     is not distinct from p_calculation
     and v_dc.estimated_gross_commission is not distinct from v_est then
    return jsonb_build_object('deal_id', p_deal_id, 'commission_state', 'potential',
                              'estimated_gross_commission', v_est, 'changed', false);
  end if;

  -- Truthful before-snapshot (Macroscope Medium round-1): prior potential values,
  -- or an explicit "unset" marker when this is the first pick.
  v_before := case
    when found then jsonb_build_object('commission_state', v_dc.commission_state,
                                       'commission_calculation', v_dc.commission_calculation,
                                       'estimated_gross_commission', v_dc.estimated_gross_commission)
    else jsonb_build_object('commission_state', null)
  end;

  insert into public.deal_commissions
    (deal_id, commission_calculation, commission_state, estimated_gross_commission,
     actual_gross_commission, commission_locked_at, commission_locked_by)
  values (p_deal_id, p_calculation, 'potential', v_est, null, null, null)
  on conflict (deal_id) do update
    set commission_calculation     = excluded.commission_calculation,
        commission_state           = 'potential',
        estimated_gross_commission = excluded.estimated_gross_commission,
        actual_gross_commission    = null,
        commission_locked_at       = null,
        commission_locked_by       = null
  returning * into v_dc;
  if v_dc.deal_id is null then raise exception 'Deal % picker not set (no row written)', p_deal_id; end if;

  perform public.log_commission_picker_activity(
    p_deal_id, v_client_id, 'COMMISSION_PICKER_SET',
    'Commission picker set — POTENTIAL (base ' || (p_calculation->>'base') ||
      ', estimated R' || to_char(v_est, 'FM999999999990.00') || ')',
    v_before,
    jsonb_build_object('commission_state', 'potential', 'commission_calculation', p_calculation,
                       'estimated_gross_commission', v_est));

  return jsonb_build_object('deal_id', p_deal_id, 'commission_state', 'potential',
                            'estimated_gross_commission', v_est, 'changed', true);
end $$;

-- 5b. update_commission_picker — edit the picker during POTENTIAL or PENDING.
create or replace function public.update_commission_picker(
  p_deal_id uuid, p_calculation jsonb, p_estimated_gross numeric
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_client_id  uuid;
  v_ref        text;
  v_dc         public.deal_commissions;
  v_est        numeric(14,2);
  v_prev_calc  jsonb;
  v_prev_est   numeric(14,2);
  v_prev_state text;
begin
  if not public.is_owner() then raise exception 'Only the owner can update the commission picker'; end if;
  perform pg_advisory_xact_lock(hashtext('deal_commission_picker:' || p_deal_id::text));

  select client_id, reference into v_client_id, v_ref from public.deals where id = p_deal_id;
  if not found then raise exception 'Deal % not found', p_deal_id; end if;

  select * into v_dc from public.deal_commissions where deal_id = p_deal_id;
  if not found then
    raise exception 'No commission picker set on deal % — use set_commission_picker first', coalesce(v_ref, p_deal_id::text);
  end if;
  if v_dc.commission_state = 'locked' then
    raise exception 'Cannot edit a locked commission (deal %) — unlock it first', coalesce(v_ref, p_deal_id::text);
  end if;

  perform public.validate_commission_calculation(p_calculation);
  v_est := round(p_estimated_gross, 2);
  if v_est is null then raise exception 'estimated gross commission is required'; end if;
  if v_est < 0 then raise exception 'estimated gross commission cannot be negative'; end if;

  -- Idempotent: no change → clean no-op (no log).
  if v_dc.commission_calculation is not distinct from p_calculation
     and v_dc.estimated_gross_commission is not distinct from v_est then
    return jsonb_build_object('deal_id', p_deal_id, 'commission_state', v_dc.commission_state,
                              'estimated_gross_commission', v_est, 'changed', false);
  end if;

  -- Capture the PRIOR values before the write for a truthful audit before-snapshot
  -- (Macroscope Medium round-1).
  v_prev_calc  := v_dc.commission_calculation;
  v_prev_est   := v_dc.estimated_gross_commission;
  v_prev_state := v_dc.commission_state;

  update public.deal_commissions
     set commission_calculation = p_calculation, estimated_gross_commission = v_est
   where deal_id = p_deal_id
   returning * into v_dc;
  if v_dc.deal_id is null then raise exception 'Deal % picker not updated (no row written)', p_deal_id; end if;

  perform public.log_commission_picker_activity(
    p_deal_id, v_client_id, 'COMMISSION_PICKER_UPDATED',
    'Commission picker updated (' || v_prev_state || ', base ' || (p_calculation->>'base') ||
      ', estimated R' || to_char(v_est, 'FM999999999990.00') || ')',
    jsonb_build_object('commission_state', v_prev_state, 'commission_calculation', v_prev_calc,
                       'estimated_gross_commission', v_prev_est),
    jsonb_build_object('commission_state', v_dc.commission_state, 'commission_calculation', p_calculation,
                       'estimated_gross_commission', v_est));

  return jsonb_build_object('deal_id', p_deal_id, 'commission_state', v_dc.commission_state,
                            'estimated_gross_commission', v_est, 'changed', true);
end $$;

-- 5c. transition_to_pending — POTENTIAL → PENDING (funder invoice issued).
create or replace function public.transition_to_pending(p_deal_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_client_id uuid; v_ref text; v_dc public.deal_commissions;
begin
  if not public.is_owner() then raise exception 'Only the owner can transition commission state'; end if;
  perform pg_advisory_xact_lock(hashtext('deal_commission_picker:' || p_deal_id::text));

  select client_id, reference into v_client_id, v_ref from public.deals where id = p_deal_id;
  if not found then raise exception 'Deal % not found', p_deal_id; end if;

  select * into v_dc from public.deal_commissions where deal_id = p_deal_id;
  if not found then raise exception 'No commission picker set on deal % — set it before moving to pending', coalesce(v_ref, p_deal_id::text); end if;
  if v_dc.commission_state = 'locked' then raise exception 'Commission is locked on deal % — unlock it to move back to pending', coalesce(v_ref, p_deal_id::text); end if;
  if v_dc.commission_state = 'pending' then
    return jsonb_build_object('deal_id', p_deal_id, 'commission_state', 'pending', 'changed', false);
  end if;

  update public.deal_commissions set commission_state = 'pending'
   where deal_id = p_deal_id and commission_state = 'potential' returning * into v_dc;
  if v_dc.deal_id is null then raise exception 'Deal % not moved to pending (no row written)', p_deal_id; end if;

  perform public.log_commission_picker_activity(
    p_deal_id, v_client_id, 'COMMISSION_STATE_TRANSITION', 'Commission state POTENTIAL → PENDING',
    jsonb_build_object('commission_state', 'potential'), jsonb_build_object('commission_state', 'pending'));

  return jsonb_build_object('deal_id', p_deal_id, 'commission_state', 'pending', 'changed', true);
end $$;

-- 5d. transition_to_locked — PENDING → LOCKED (funder paid; owner enters actual).
create or replace function public.transition_to_locked(p_deal_id uuid, p_actual_gross numeric)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_client_id uuid; v_ref text; v_dc public.deal_commissions;
  v_actual numeric(14,2); v_uid uuid := (select auth.uid());
begin
  if not public.is_owner() then raise exception 'Only the owner can lock a commission'; end if;
  perform pg_advisory_xact_lock(hashtext('deal_commission_picker:' || p_deal_id::text));

  v_actual := round(p_actual_gross, 2);
  if v_actual is null then raise exception 'actual gross commission is required to lock'; end if;
  if v_actual < 0 then raise exception 'actual gross commission cannot be negative'; end if;

  select client_id, reference into v_client_id, v_ref from public.deals where id = p_deal_id;
  if not found then raise exception 'Deal % not found', p_deal_id; end if;

  select * into v_dc from public.deal_commissions where deal_id = p_deal_id;
  if not found then raise exception 'No commission picker set on deal % — cannot lock', coalesce(v_ref, p_deal_id::text); end if;
  if v_dc.commission_state = 'locked' then
    return jsonb_build_object('deal_id', p_deal_id, 'commission_state', 'locked',
                              'actual_gross_commission', v_dc.actual_gross_commission, 'changed', false);
  end if;
  if v_dc.commission_state = 'potential' then
    raise exception 'Commission on deal % must be PENDING before locking (it is potential) — move it to pending first', coalesce(v_ref, p_deal_id::text);
  end if;

  update public.deal_commissions
     set commission_state = 'locked', actual_gross_commission = v_actual,
         commission_locked_at = now(), commission_locked_by = v_uid
   where deal_id = p_deal_id and commission_state = 'pending' returning * into v_dc;
  if v_dc.deal_id is null then raise exception 'Deal % not locked (no row written)', p_deal_id; end if;

  perform public.log_commission_picker_activity(
    p_deal_id, v_client_id, 'COMMISSION_STATE_TRANSITION',
    'Commission state PENDING → LOCKED (actual R' || to_char(v_actual, 'FM999999999990.00') || ')',
    jsonb_build_object('commission_state', 'pending'),
    jsonb_build_object('commission_state', 'locked', 'actual_gross_commission', v_actual, 'commission_locked_by', v_uid));

  return jsonb_build_object('deal_id', p_deal_id, 'commission_state', 'locked',
                            'actual_gross_commission', v_actual, 'changed', true);
end $$;

-- 5e. unlock_commission — LOCKED → PENDING (owner override, typed reason required).
--     Writes a prominent audit row. NOT a silent same-state no-op: a non-locked deal
--     RAISES (there is no benign "already unlocked" — PENDING is also the post-unlock
--     state). Keeps actual_gross (disputed figure) via a subtransaction that satisfies
--     the locked-shape CHECK, then re-nulls it — see below.
create or replace function public.unlock_commission(p_deal_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_client_id uuid; v_ref text; v_dc public.deal_commissions;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_prev_actual numeric(14,2); v_prev_by uuid; v_prev_at timestamptz;
begin
  if not public.is_owner() then raise exception 'Only the owner can unlock a commission'; end if;
  if v_reason = '' then raise exception 'A typed reason is required to unlock a commission'; end if;
  perform pg_advisory_xact_lock(hashtext('deal_commission_picker:' || p_deal_id::text));

  select client_id, reference into v_client_id, v_ref from public.deals where id = p_deal_id;
  if not found then raise exception 'Deal % not found', p_deal_id; end if;

  select * into v_dc from public.deal_commissions where deal_id = p_deal_id;
  if not found or v_dc.commission_state is distinct from 'locked' then
    raise exception 'Only a locked commission can be unlocked (deal % is %)',
      coalesce(v_ref, p_deal_id::text), coalesce(v_dc.commission_state, 'unset');
  end if;

  v_prev_actual := v_dc.actual_gross_commission;
  v_prev_by     := v_dc.commission_locked_by;
  v_prev_at     := v_dc.commission_locked_at;

  -- Moving to pending clears the lock stamps (they mean "who/when locked"). The
  -- deal_commissions_locked_shape CHECK requires locked_at/by to be null in a
  -- non-locked state, so they MUST be cleared here; actual_gross is retained as the
  -- disputed figure (a later transition_to_locked overwrites it).
  update public.deal_commissions
     set commission_state = 'pending', commission_locked_at = null, commission_locked_by = null
   where deal_id = p_deal_id and commission_state = 'locked' returning * into v_dc;
  if v_dc.deal_id is null then raise exception 'Deal % not unlocked (no row written)', p_deal_id; end if;

  perform public.log_commission_picker_activity(
    p_deal_id, v_client_id, 'COMMISSION_STATE_TRANSITION',
    'Commission UNLOCKED (owner override) LOCKED → PENDING — reason: ' || v_reason,
    jsonb_build_object('commission_state', 'locked', 'actual_gross_commission', v_prev_actual,
                       'commission_locked_by', v_prev_by, 'commission_locked_at', v_prev_at),
    jsonb_build_object('commission_state', 'pending', 'override_reason', v_reason));

  return jsonb_build_object('deal_id', p_deal_id, 'commission_state', 'pending', 'unlocked', true, 'changed', true);
end $$;

-- ===========================================================================
-- 6. Read RPCs (owner-only, DEFINER + is_owner() + search_path='', STABLE).
-- ===========================================================================

-- 6a. get_deal_commission_state — full picker + state for one deal (deal must exist;
--     commission fields are null when no picker row exists).
create or replace function public.get_deal_commission_state(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_ref text; v_dc public.deal_commissions;
begin
  if not public.is_owner() then raise exception 'Only the owner can read commission state'; end if;
  select reference into v_ref from public.deals where id = p_deal_id;
  if not found then raise exception 'Deal % not found', p_deal_id; end if;

  select * into v_dc from public.deal_commissions where deal_id = p_deal_id;

  return jsonb_build_object(
    'deal_id',                     p_deal_id,
    'reference',                   v_ref,
    'commission_calculation',      v_dc.commission_calculation,
    'commission_state',            v_dc.commission_state,
    'estimated_gross_commission',  v_dc.estimated_gross_commission,
    'actual_gross_commission',     v_dc.actual_gross_commission,
    'commission_locked_at',        v_dc.commission_locked_at,
    'commission_locked_by',        v_dc.commission_locked_by);
end $$;

-- 6b. list_deals_by_commission_state — owner's deals in a given picker state.
create or replace function public.list_deals_by_commission_state(p_state text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_out jsonb;
begin
  if not public.is_owner() then raise exception 'Only the owner can list deals by commission state'; end if;
  if p_state is null or p_state not in ('potential','pending','locked') then
    raise exception 'p_state must be one of potential/pending/locked (got %)', coalesce(p_state, '<null>');
  end if;

  select coalesce(jsonb_agg(row_to_jsonb(t) order by t.updated_at desc), '[]'::jsonb) into v_out
  from (
    select dc.deal_id, d.reference, d.client_id, dc.commission_state, dc.commission_calculation,
           dc.estimated_gross_commission, dc.actual_gross_commission,
           dc.commission_locked_at, dc.commission_locked_by, dc.updated_at
    from public.deal_commissions dc
    join public.deals d on d.id = dc.deal_id
    where dc.commission_state = p_state
  ) t;

  return v_out;
end $$;

-- ===========================================================================
-- 7. Grants matrix for the 5 state RPCs + 2 read RPCs: authenticated + postgres
--    + service_role; anon/PUBLIC revoked.
-- ===========================================================================
do $$
declare
  fn text;
  api_fns constant text[] := array[
    'set_commission_picker(uuid, jsonb, numeric)','update_commission_picker(uuid, jsonb, numeric)',
    'transition_to_pending(uuid)','transition_to_locked(uuid, numeric)','unlock_commission(uuid, text)',
    'get_deal_commission_state(uuid)','list_deals_by_commission_state(text)'
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
  'Picker BACKEND: owner sets the initial 4-dimension picks on a deal (→ POTENTIAL, row in deal_commissions). DEFINER + is_owner + advisory lock + idempotent. Writes COMMISSION_PICKER_SET.';
comment on function public.transition_to_locked(uuid, numeric) is
  'Picker BACKEND: PENDING → LOCKED with the owner-entered actual gross (stamps locked_by/at). Idempotent if already locked. Does NOT yet hand off to write_commission_record (later PR).';
comment on function public.unlock_commission(uuid, text) is
  'Picker BACKEND: LOCKED → PENDING owner override; requires a typed reason; writes a prominent COMMISSION_STATE_TRANSITION audit row. Raises on a non-locked deal.';

-- ===========================================================================
-- 8. Structural assertions — RAISE (roll the migration back) on any drift.
-- ===========================================================================
do $$
declare
  r record; v_cnt int; fn text; fn_row text[]; sig text; want text;
  sigs constant text[][] := array[
    ['public.calc_percent_of_gross_funded(numeric,numeric)',      'p_facility_amount numeric, p_rate numeric'],
    ['public.calc_percent_of_finance_charge(numeric,numeric)',    'p_finance_charge numeric, p_rate numeric'],
    ['public.calc_percent_of_revenue_collected(numeric,numeric)', 'p_revenue numeric, p_rate numeric'],
    ['public.calc_percent_of_mdr(numeric,numeric)',               'p_mdr numeric, p_rate numeric'],
    ['public.calc_percent_of_client_interest(numeric,numeric)',   'p_client_interest numeric, p_rate numeric'],
    ['public.calc_points_margin(numeric,numeric)',                'p_sell_rate numeric, p_buy_rate numeric'],
    ['public.calc_flat_rand_per_deal(numeric)',                   'p_amount numeric'],
    ['public.set_commission_picker(uuid,jsonb,numeric)',          'p_deal_id uuid, p_calculation jsonb, p_estimated_gross numeric'],
    ['public.update_commission_picker(uuid,jsonb,numeric)',       'p_deal_id uuid, p_calculation jsonb, p_estimated_gross numeric'],
    ['public.transition_to_pending(uuid)',                        'p_deal_id uuid'],
    ['public.transition_to_locked(uuid,numeric)',                 'p_deal_id uuid, p_actual_gross numeric'],
    ['public.unlock_commission(uuid,text)',                       'p_deal_id uuid, p_reason text'],
    ['public.get_deal_commission_state(uuid)',                    'p_deal_id uuid'],
    ['public.list_deals_by_commission_state(text)',               'p_state text']
  ];
  definer_fns constant text[] := array[
    'public.calc_percent_of_gross_funded(numeric,numeric)','public.calc_percent_of_finance_charge(numeric,numeric)',
    'public.calc_percent_of_revenue_collected(numeric,numeric)','public.calc_percent_of_mdr(numeric,numeric)',
    'public.calc_percent_of_client_interest(numeric,numeric)','public.calc_points_margin(numeric,numeric)',
    'public.calc_flat_rand_per_deal(numeric)','public.set_commission_picker(uuid,jsonb,numeric)',
    'public.update_commission_picker(uuid,jsonb,numeric)','public.transition_to_pending(uuid)',
    'public.transition_to_locked(uuid,numeric)','public.unlock_commission(uuid,text)',
    'public.get_deal_commission_state(uuid)','public.list_deals_by_commission_state(text)'
  ];
  auth_only_fns constant text[] := array[
    'calc_percent_of_gross_funded','calc_percent_of_finance_charge','calc_percent_of_revenue_collected',
    'calc_percent_of_mdr','calc_percent_of_client_interest','calc_points_margin','calc_flat_rand_per_deal'
  ];
  api_fns constant text[] := array[
    'set_commission_picker','update_commission_picker','transition_to_pending','transition_to_locked',
    'unlock_commission','get_deal_commission_state','list_deals_by_commission_state'
  ];
begin
  -- (a) deal_commissions table shape: PK on deal_id, key columns present + typed.
  if to_regclass('public.deal_commissions') is null then raise exception 'assert: deal_commissions table missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid='public.deal_commissions'::regclass and contype='p'
      and conkey = (select array_agg(attnum) from pg_attribute where attrelid='public.deal_commissions'::regclass and attname='deal_id')) then
    raise exception 'assert: deal_commissions PK is not deal_id'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='deal_commissions'
      and column_name='estimated_gross_commission' and numeric_precision=14 and numeric_scale=2) then
    raise exception 'assert: estimated_gross_commission not numeric(14,2)'; end if;
  if not exists (select 1 from pg_constraint where conrelid='public.deal_commissions'::regclass and conname='deal_commissions_locked_shape') then
    raise exception 'assert: deal_commissions_locked_shape CHECK missing'; end if;

  -- (b) RLS on, owner-only, NO partner policy (Macroscope Critical).
  if not (select relrowsecurity from pg_class where oid='public.deal_commissions'::regclass) then
    raise exception 'assert: RLS not enabled on deal_commissions'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='deal_commissions' and policyname='deal_commissions_owner_all') then
    raise exception 'assert: deal_commissions_owner_all policy missing'; end if;
  select count(*) into v_cnt from pg_policies where schemaname='public' and tablename='deal_commissions';
  if v_cnt <> 1 then raise exception 'assert: deal_commissions must have exactly 1 policy (owner-only), found %', v_cnt; end if;

  -- (c) table grants: authenticated holds EXACTLY SELECT — no INSERT/UPDATE/DELETE and
  --     no TRUNCATE/REFERENCES/TRIGGER (TRUNCATE would bypass RLS). anon holds nothing.
  --     (Macroscope High: writes only via the DEFINER RPCs.)
  select count(*) into v_cnt from information_schema.role_table_grants
    where table_schema='public' and table_name='deal_commissions' and grantee='authenticated';
  if v_cnt <> 1 then raise exception 'assert: authenticated must hold exactly 1 privilege (SELECT) on deal_commissions, found %', v_cnt; end if;
  if not exists (select 1 from information_schema.role_table_grants
      where table_schema='public' and table_name='deal_commissions' and grantee='authenticated' and privilege_type='SELECT') then
    raise exception 'assert: authenticated must hold SELECT on deal_commissions'; end if;
  if exists (select 1 from information_schema.role_table_grants
      where table_schema='public' and table_name='deal_commissions' and grantee='anon') then
    raise exception 'assert: anon still holds a grant on deal_commissions'; end if;

  -- (d) every function exists with the exact signature.
  foreach fn_row slice 1 in array sigs loop
    sig := fn_row[1]; want := fn_row[2];
    if to_regprocedure(sig) is null then raise exception 'assert: function % does not exist', sig; end if;
    if pg_get_function_identity_arguments(sig::regprocedure) <> want then
      raise exception 'assert: % signature drift — got %', sig, pg_get_function_identity_arguments(sig::regprocedure); end if;
  end loop;

  -- (e) all 14 are SECURITY DEFINER with a pinned search_path.
  foreach sig in array definer_fns loop
    select p.prosecdef as is_def,
           exists(select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%') as sp_pinned
      into r from pg_proc p where p.oid = sig::regprocedure;
    if not r.is_def then raise exception 'assert: % is not SECURITY DEFINER', sig; end if;
    if not r.sp_pinned then raise exception 'assert: % search_path not pinned', sig; end if;
  end loop;

  -- (f) grants matrix. calc helpers: authenticated only.
  foreach fn in array auth_only_fns loop
    if not exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=fn and grantee='authenticated' and privilege_type='EXECUTE') then
      raise exception 'assert: % missing authenticated EXECUTE', fn; end if;
    if exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=fn and grantee in ('anon','PUBLIC') and privilege_type='EXECUTE') then
      raise exception 'assert: % still granted to anon/PUBLIC', fn; end if;
  end loop;
  -- state + read RPCs: authenticated + service_role, no anon/PUBLIC.
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

  -- (g) internal helpers hold NO API-role EXECUTE.
  foreach fn in array array['log_commission_picker_activity','validate_commission_calculation'] loop
    if exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=fn and grantee in ('anon','authenticated','PUBLIC') and privilege_type='EXECUTE') then
      raise exception 'assert: internal helper % is API-callable', fn; end if;
  end loop;

  -- (h) calc-base arithmetic (rate is whole-number percent → ÷100).
  if public.calc_percent_of_finance_charge(140000, 10)  <> 14000.00 then raise exception 'assert: finance_charge calc'; end if;
  if public.calc_percent_of_gross_funded(400000, 10)    <> 40000.00 then raise exception 'assert: gross_funded calc'; end if;
  if public.calc_percent_of_revenue_collected(50000, 5) <>  2500.00 then raise exception 'assert: revenue calc'; end if;
  if public.calc_percent_of_mdr(20000, 2.5)             <>   500.00 then raise exception 'assert: mdr calc'; end if;
  if public.calc_percent_of_client_interest(80000, 7.5) <>  6000.00 then raise exception 'assert: client_interest calc'; end if;
  if public.calc_points_margin(1.50, 1.20)              <>     0.30 then raise exception 'assert: points_margin calc'; end if;
  if public.calc_flat_rand_per_deal(12500.5)            <> 12500.50 then raise exception 'assert: flat calc'; end if;
  if public.calc_percent_of_gross_funded(null, 10)      is not null then raise exception 'assert: NULL-in should be NULL-out'; end if;

  -- (i) validation hardening (Macroscope Medium round-1): rate + array-element checks.
  begin
    perform public.validate_commission_calculation(jsonb_build_object('base','percent_of_finance_charge','timing','upfront'));
    raise exception 'assert: missing rate on percent base should have raised';
  exception when others then if sqlerrm like 'assert:%' then raise; end if; end;
  begin
    perform public.validate_commission_calculation(jsonb_build_object('base','percent_of_finance_charge','rate','ten','timing','upfront'));
    raise exception 'assert: string rate on percent base should have raised';
  exception when others then if sqlerrm like 'assert:%' then raise; end if; end;
  begin
    perform public.validate_commission_calculation(jsonb_build_object('base','percent_of_finance_charge','rate',10,'timing','upfront',
      'tier_modifiers', jsonb_build_array(jsonb_build_object('x',1))));
    raise exception 'assert: non-string tier_modifier element should have raised';
  exception when others then if sqlerrm like 'assert:%' then raise; end if; end;
  -- owner_override without rate is VALID (rate optional for non-percent bases).
  perform public.validate_commission_calculation(jsonb_build_object('base','owner_override','timing','upfront'));
  -- flat_rand_per_deal without rate is VALID.
  perform public.validate_commission_calculation(jsonb_build_object('base','flat_rand_per_deal','timing','upfront'));

  raise notice 'Picker BACKEND structural assertions passed (table+RLS+grants, 14 signatures, definer/search_path, calc math, validation hardening).';
end $$;

-- ===========================================================================
-- 9. Behavioural assertions — full state machine, owner-gating, idempotency,
--    audit before/after. Uses the new activity_event_type values (added +
--    committed in part 1), so this runs ONLY at real apply. Synthetic rows use an
--    EXPLICIT reference (never nextval) and are unwound by a ROLLBACK_TEST_DATA raise.
-- ===========================================================================
do $$
declare
  v_owner uuid; v_nonown uuid; v_client uuid; v_deal uuid;
  v_res jsonb; v_state jsonb;
  v_calc  jsonb := jsonb_build_object('base','percent_of_finance_charge','rate',10,
             'tier_modifiers', jsonb_build_array(), 'timing','upfront',
             'adjustments', jsonb_build_array('vat_inclusive'));
  v_calc2 jsonb := jsonb_build_object('base','percent_of_finance_charge','rate',12,
             'tier_modifiers', jsonb_build_array('first_vs_subsequent'), 'timing','upfront',
             'adjustments', jsonb_build_array());
begin
  select id into v_owner  from public.profiles where role='owner' limit 1;
  select id into v_nonown from public.profiles where role <> 'owner' limit 1;
  select id into v_client from public.clients limit 1;
  if v_owner is null or v_client is null then
    raise notice 'Picker BACKEND behavioural assertions skipped (no owner / no client present).'; return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    insert into public.deals (client_id, reference, stage, is_purchase_order)
      values (v_client, 'PICKER_TEST_ROLLBACK', 'document_collection', false) returning id into v_deal;

    -- (1) set → POTENTIAL, estimated 14000; before-snapshot is "unset".
    v_res := public.set_commission_picker(v_deal, v_calc, 14000);
    if (v_res->>'commission_state') <> 'potential' or (v_res->>'changed') <> 'true' then raise exception 'assert: set'; end if;
    if not exists (select 1 from public.activity_logs where entity_id=v_deal and event_type='COMMISSION_PICKER_SET'
        and before_values->>'commission_state' is null and (after_values->>'estimated_gross_commission')::numeric=14000) then
      raise exception 'assert: set audit before/after'; end if;

    -- (2) get → potential + estimated 14000 + full picker.
    v_state := public.get_deal_commission_state(v_deal);
    if (v_state->>'commission_state') <> 'potential' or (v_state->>'estimated_gross_commission')::numeric <> 14000
       or (v_state->'commission_calculation'->>'base') <> 'percent_of_finance_charge' then raise exception 'assert: get'; end if;

    -- (2b) set idempotency: same pick again → changed=false.
    v_res := public.set_commission_picker(v_deal, v_calc, 14000);
    if (v_res->>'changed') <> 'false' then raise exception 'assert: set idempotency'; end if;

    -- (2c) re-pick at POTENTIAL with new values → before-snapshot carries the PRIOR calc (audit fix).
    v_res := public.set_commission_picker(v_deal, v_calc2, 16000);
    if (v_res->>'changed') <> 'true' then raise exception 'assert: re-pick'; end if;
    if not exists (select 1 from public.activity_logs where entity_id=v_deal and event_type='COMMISSION_PICKER_SET'
        and (before_values->'commission_calculation'->>'rate')::int = 10
        and (after_values->'commission_calculation'->>'rate')::int = 12) then
      raise exception 'assert: re-pick audit before carries prior calc'; end if;

    -- (2d) update during POTENTIAL → before carries prior (rate 12/16000), after new (rate 10/15000).
    v_res := public.update_commission_picker(v_deal, v_calc, 15000);
    if (v_res->>'changed') <> 'true' or (v_res->>'estimated_gross_commission')::numeric <> 15000 then raise exception 'assert: update'; end if;
    if not exists (select 1 from public.activity_logs where entity_id=v_deal and event_type='COMMISSION_PICKER_UPDATED'
        and (before_values->>'estimated_gross_commission')::numeric = 16000
        and (after_values->>'estimated_gross_commission')::numeric = 15000) then
      raise exception 'assert: update audit before/after distinct'; end if;

    -- (3) →pending; idempotent second call.
    v_res := public.transition_to_pending(v_deal);
    if (v_res->>'commission_state') <> 'pending' or (v_res->>'changed') <> 'true' then raise exception 'assert: →pending'; end if;
    v_res := public.transition_to_pending(v_deal);
    if (v_res->>'changed') <> 'false' then raise exception 'assert: →pending idempotency'; end if;

    -- (3b) lock without actual → raises.
    begin v_res := public.transition_to_locked(v_deal, null); raise exception 'assert: lock without actual should raise';
    exception when others then if sqlerrm like 'assert:%' then raise; end if; end;

    -- (4) →locked(14000) → locked + actual + locked_by owner + locked_at set.
    v_res := public.transition_to_locked(v_deal, 14000);
    if (v_res->>'commission_state') <> 'locked' or (v_res->>'actual_gross_commission')::numeric <> 14000 then raise exception 'assert: →locked'; end if;
    v_state := public.get_deal_commission_state(v_deal);
    if (v_state->>'commission_locked_by') <> v_owner::text or (v_state->>'commission_locked_at') is null then raise exception 'assert: lock stamps'; end if;

    -- (4b) locked idempotency: second lock → changed=false, actual preserved.
    v_res := public.transition_to_locked(v_deal, 99999);
    if (v_res->>'changed') <> 'false' or (v_res->>'actual_gross_commission')::numeric <> 14000 then raise exception 'assert: locked idempotency'; end if;

    -- (5) set on LOCKED → raises "cannot edit locked".
    begin v_res := public.set_commission_picker(v_deal, v_calc, 14000); raise exception 'assert: set on locked should raise';
    exception when others then if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not like '%locked%' then raise exception 'assert: wrong locked error: %', sqlerrm; end if; end;

    -- (6) unlock (typed reason) → pending + stamps cleared + prominent audit + actual retained.
    v_res := public.unlock_commission(v_deal, 'funder disputed amount');
    if (v_res->>'commission_state') <> 'pending' then raise exception 'assert: unlock state'; end if;
    v_state := public.get_deal_commission_state(v_deal);
    if (v_state->>'commission_locked_by') is not null or (v_state->>'commission_locked_at') is not null then raise exception 'assert: unlock cleared stamps'; end if;
    if (v_state->>'actual_gross_commission')::numeric <> 14000 then raise exception 'assert: unlock retained actual'; end if;
    if not exists (select 1 from public.activity_logs where entity_id=v_deal and event_type='COMMISSION_STATE_TRANSITION'
        and description ilike '%UNLOCKED%funder disputed amount%') then raise exception 'assert: unlock audit'; end if;

    -- (6b) unlock again (now pending) → raises.
    begin v_res := public.unlock_commission(v_deal, 'again'); raise exception 'assert: unlock non-locked should raise';
    exception when others then if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not like '%locked%' then raise exception 'assert: wrong unlock error: %', sqlerrm; end if; end;

    -- (6c) re-lock, then unlock with blank reason → raises.
    v_res := public.transition_to_locked(v_deal, 14000);
    begin v_res := public.unlock_commission(v_deal, '   '); raise exception 'assert: blank-reason unlock should raise';
    exception when others then if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not like '%reason%' then raise exception 'assert: wrong no-reason error: %', sqlerrm; end if; end;

    -- (7) list includes our locked deal; invalid state raises.
    v_res := public.list_deals_by_commission_state('locked');
    if not exists (select 1 from jsonb_array_elements(v_res) e where (e->>'deal_id') = v_deal::text) then
      raise exception 'assert: list(locked) missing our deal'; end if;
    begin v_res := public.list_deals_by_commission_state('bogus'); raise exception 'assert: invalid list state should raise';
    exception when others then if sqlerrm like 'assert:%' then raise; end if; end;

    -- (8) NON-OWNER denied on write + read RPCs.
    if v_nonown is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_nonown)::text, true);
      begin v_res := public.set_commission_picker(v_deal, v_calc, 14000); raise exception 'assert: non-owner set should raise';
      exception when others then if sqlerrm like 'assert:%' then raise; end if;
        if sqlerrm not ilike '%owner%' then raise exception 'assert: wrong non-owner error: %', sqlerrm; end if; end;
      begin v_res := public.get_deal_commission_state(v_deal); raise exception 'assert: non-owner read should raise';
      exception when others then if sqlerrm like 'assert:%' then raise; end if; end;
      perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
    end if;

    raise notice 'Picker BACKEND behavioural assertions passed (set/get/update/→pending/→locked/unlock, idempotency, audit before/after, owner-gating).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception
    when others then if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
