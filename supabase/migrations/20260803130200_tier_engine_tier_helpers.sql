-- TIER ENGINE (Sprint 1, Lane 1b) — part 3 of 4: LOCKED tier-lookup helpers.
-- ============================================================================
-- Pure lookups off the LOCKED tier tables in TIERS.md. Both are read-only,
-- IMMUTABLE, and — per the lane brief's belt-and-braces rule — SECURITY DEFINER
-- with search_path='' and authenticated-only grants. NULL gross -> NULL (unknown),
-- never a silent 0.
--
-- These tables are LOCKED business truth: only the owner may change them, and any
-- change is audit-logged (TIERS.md "Locking Rules"). Changing a band here is a
-- deliberate, owner-signed migration — never an incidental edit.
--
-- Rate convention: calc_partner_tier_percent returns a WHOLE-NUMBER percent
-- (29/30/33/25/40), matching the lane brief and TIERS.md Section 1. Callers divide
-- by 100 to apply it to the 60% pool. This is validated to AGREE with the live,
-- SPEC-locked calculate_commission() engine (the single source of split truth per
-- CLAUDE.md) by the parity assertions at the foot of this file, so the two can
-- never silently drift.
-- ============================================================================

-- ===========================================================================
-- 1. calc_partner_tier_percent — Doctor's (referral partner) % of the 60% pool.
--    TIERS.md Section 1. Contiguous bands, inclusive upper bound. PO deals = 40 flat.
-- ===========================================================================
create or replace function public.calc_partner_tier_percent(
  p_fnc_gross numeric, p_is_po_deal boolean
) returns numeric(10,4)
language sql immutable security definer set search_path to '' as $$
  select case
    when p_fnc_gross is null then null
    when p_is_po_deal        then 40           -- all PO deals: 40% flat
    when p_fnc_gross <=  80000 then 29          -- R0 – R80,000
    when p_fnc_gross <= 150000 then 30          -- R80,001 – R150,000
    when p_fnc_gross <= 500000 then 33          -- R150,001 – R500,000
    else 25                                     -- R500,001+
  end::numeric(10,4);
$$;

comment on function public.calc_partner_tier_percent(numeric, boolean) is
  'TIERS.md Section 1: referral partner (Doctor) tier %% of the 60%% pool. Whole-number percent 29/30/33/25, or 40 flat for PO deals. NULL gross -> NULL. Validated to agree with calculate_commission().';

-- ===========================================================================
-- 2. calc_contractor_tier_amount — flat rand contractor commission.
--    TIERS.md Section 2. Contiguous bands, inclusive upper bound. NO 40/60 split.
--    R1,000,000+ returns NULL — the signal that a manual, owner-entered amount is
--    required (set_contractor_manual_amount). Path A: the flat R300 minimum stands
--    even when it exceeds a 40% retention floor; there is no floor logic here — the
--    caller simply pays the flat amount and FNC retains gross - amount.
-- ===========================================================================
create or replace function public.calc_contractor_tier_amount(
  p_fnc_gross numeric
) returns numeric(14,2)
language sql immutable security definer set search_path to '' as $$
  select case
    when p_fnc_gross is null      then null
    when p_fnc_gross <=    1999 then    300   -- R0 – R1,999      (Path A minimum)
    when p_fnc_gross <=    7999 then   1500   -- R2,000 – R7,999
    when p_fnc_gross <=   17999 then   3000   -- R8,000 – R17,999
    when p_fnc_gross <=   28999 then   5600   -- R18,000 – R28,999
    when p_fnc_gross <=   42999 then   6200   -- R29,000 – R42,999
    when p_fnc_gross <=   64999 then   6800   -- R43,000 – R64,999
    when p_fnc_gross <=   84999 then   8800   -- R65,000 – R84,999
    when p_fnc_gross <=   99999 then  12000   -- R85,000 – R99,999
    when p_fnc_gross <=  129999 then  22000   -- R100,000 – R129,999
    when p_fnc_gross <=  169999 then  30000   -- R130,000 – R169,999
    when p_fnc_gross <=  199999 then  41000   -- R170,000 – R199,999
    when p_fnc_gross <=  249999 then  49000   -- R200,000 – R249,999
    when p_fnc_gross <=  299999 then  63000   -- R250,000 – R299,999
    when p_fnc_gross <=  499999 then  82000   -- R300,000 – R499,999
    when p_fnc_gross <=  749999 then  95000   -- R500,000 – R749,999
    when p_fnc_gross <=  999999 then 105000   -- R750,000 – R999,999
    else null                                 -- R1,000,000+  -> manual entry required
  end::numeric(14,2);
$$;

comment on function public.calc_contractor_tier_amount(numeric) is
  'TIERS.md Section 2: flat rand contractor commission by FNC gross band (no 40/60 split). R0-1,999 -> R300 (Path A minimum) ... R750k-999,999 -> R105,000. R1,000,000+ -> NULL, meaning manual owner entry required (set_contractor_manual_amount). NULL gross -> NULL.';

-- ===========================================================================
-- 3. Grants: authenticated only; anon/PUBLIC revoked (belt-and-braces).
-- ===========================================================================
do $$
declare fn text;
  helper_fns constant text[] := array[
    'calc_partner_tier_percent(numeric, boolean)',
    'calc_contractor_tier_amount(numeric)'
  ];
begin
  foreach fn in array helper_fns loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
    execute format('grant execute on function public.%s to postgres', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;

-- ===========================================================================
-- 4. Assertions — band math, NULL propagation, grants, AND parity with the
--    LOCKED calculate_commission() engine (drift guard).
-- ===========================================================================
do $$
declare fn text; v_pct numeric; v_eng_tier numeric;
  grant_fns constant text[] := array['calc_partner_tier_percent','calc_contractor_tier_amount'];
begin
  -- (a) partner band math (TIERS.md Section 1)
  if public.calc_partner_tier_percent(80000,false)  <> 29 then raise exception 'assert: partner 80000 band'; end if;
  if public.calc_partner_tier_percent(80001,false)  <> 30 then raise exception 'assert: partner 80001 band'; end if;
  if public.calc_partner_tier_percent(150000,false) <> 30 then raise exception 'assert: partner 150000 band'; end if;
  if public.calc_partner_tier_percent(150001,false) <> 33 then raise exception 'assert: partner 150001 band'; end if;
  if public.calc_partner_tier_percent(500000,false) <> 33 then raise exception 'assert: partner 500000 band'; end if;
  if public.calc_partner_tier_percent(500001,false) <> 25 then raise exception 'assert: partner 500001 band'; end if;
  if public.calc_partner_tier_percent(14000,true)   <> 40 then raise exception 'assert: partner PO flat'; end if;
  if public.calc_partner_tier_percent(null,false)   is not null then raise exception 'assert: partner NULL-in'; end if;

  -- (b) contractor band math (TIERS.md Section 2) — spot every boundary that matters
  if public.calc_contractor_tier_amount(300)    <>    300 then raise exception 'assert: contractor 300 (Path A)'; end if;
  if public.calc_contractor_tier_amount(1500)   <>    300 then raise exception 'assert: contractor 1500'; end if;
  if public.calc_contractor_tier_amount(1999)   <>    300 then raise exception 'assert: contractor 1999'; end if;
  if public.calc_contractor_tier_amount(2000)   <>   1500 then raise exception 'assert: contractor 2000'; end if;
  if public.calc_contractor_tier_amount(14000)  <>   3000 then raise exception 'assert: contractor 14000'; end if;
  if public.calc_contractor_tier_amount(17999)  <>   3000 then raise exception 'assert: contractor 17999'; end if;
  if public.calc_contractor_tier_amount(18000)  <>   5600 then raise exception 'assert: contractor 18000'; end if;
  if public.calc_contractor_tier_amount(749999) <>  95000 then raise exception 'assert: contractor 749999'; end if;
  if public.calc_contractor_tier_amount(750000) <> 105000 then raise exception 'assert: contractor 750000'; end if;
  if public.calc_contractor_tier_amount(999999) <> 105000 then raise exception 'assert: contractor 999999'; end if;
  if public.calc_contractor_tier_amount(1000000) is not null then raise exception 'assert: contractor R1M+ must be NULL (manual)'; end if;
  if public.calc_contractor_tier_amount(null)    is not null then raise exception 'assert: contractor NULL-in'; end if;

  -- (c) grants: authenticated present, anon/PUBLIC absent
  foreach fn in array grant_fns loop
    if not exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=fn and grantee='authenticated' and privilege_type='EXECUTE') then
      raise exception 'assert: % missing authenticated EXECUTE', fn; end if;
    if exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=fn and grantee in ('anon','PUBLIC') and privilege_type='EXECUTE') then
      raise exception 'assert: % still granted to anon/PUBLIC', fn; end if;
  end loop;

  -- (d) PARITY with the LOCKED engine: calc_partner_tier_percent/100 must equal
  --     calculate_commission().tier_pct for every band + PO. If a future owner edit
  --     changes one but not the other, this fails the migration loudly.
  foreach v_pct in array array[14000, 100000, 300000, 600000]::numeric[] loop
    v_eng_tier := (public.calculate_commission(v_pct, false)).tier_pct;
    if public.calc_partner_tier_percent(v_pct, false) / 100 <> v_eng_tier then
      raise exception 'assert: partner tier drift at gross % — helper % vs engine %',
        v_pct, public.calc_partner_tier_percent(v_pct, false)/100, v_eng_tier;
    end if;
  end loop;
  if public.calc_partner_tier_percent(14000, true) / 100 <> (public.calculate_commission(14000, true)).tier_pct then
    raise exception 'assert: partner PO tier drift vs engine';
  end if;

  raise notice 'Tier engine part 3 assertions passed (partner + contractor bands, NULL propagation, grants, engine parity).';
end $$;
