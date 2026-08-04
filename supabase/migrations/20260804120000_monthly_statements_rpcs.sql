-- Monthly Statements — Sprint 4 Lane 4b (STATEMENTS)
--
-- Real problem: the money engine (commission_records + bonus_records) is live but
-- nobody could see a *monthly* roll-up of it. This ships three read-only
-- aggregation RPCs — one per audience — that return a self-contained statement
-- document (period + totals + line items) for a chosen calendar month.
--
-- WHY RPCs (not client-side aggregation like /reports):
--   1. POPIA / S7C funder anonymisation MUST happen server-side. The partner &
--      contractor statements resolve the funder name via
--      public.funder_display_name(funder_id, auth.uid()) so the REAL funder name
--      never reaches a partner/contractor client — only the fictional name does.
--   2. commission_records has a partner SELECT policy that exposes the forbidden
--      S7C columns (gross_commission / company_retention / partner_pool /
--      owner_share / tier_pct). A DEFINER RPC that returns ONLY the partner's own
--      take guarantees those columns can never leak through this surface.
--   3. commission_records has NO contractor SELECT policy at all, so a DEFINER RPC
--      is the only read path a contractor has to their own earnings.
--
-- Belt-and-braces on every function: SECURITY DEFINER + `search_path=''`
-- (everything schema-qualified) + an explicit role/identity gate that raises on
-- an unauthorised caller + read-only (no writes, so no advisory lock needed).
--
-- Money windowing mirrors /reports: a row belongs to a month by
-- coalesce(earned_at, created_at); void rows are always excluded. The window is
-- anchored to the **business timezone (Africa/Johannesburg)**, not the session
-- timezone: `earned_at`/`created_at` are timestamptz and the month bounds are
-- dates, so a naive comparison would bucket rows by the session's UTC calendar
-- day — putting an early-morning SAST funding (e.g. 01:00 on the 1st = 23:00 UTC
-- on the last of the prior month) into the wrong month's statement. We convert
-- each timestamp to SAST wall time before slicing to a date, and return
-- occurred_at as SAST wall time so the displayed date matches the window month.

-- ============================================================================
-- OWNER — all commissions + bonuses across every funder / partner / contractor,
-- with REAL names and the full split breakdown.
-- ============================================================================
create or replace function public.get_owner_monthly_statement(p_year int, p_month int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date;
  v_end   date;
  v_items jsonb;
  v_totals jsonb;
begin
  -- Gate: owner only.
  if not public.is_owner() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'Invalid month: %', p_month using errcode = '22023';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'Invalid year: %', p_year using errcode = '22023';
  end if;

  v_start := make_date(p_year, p_month, 1);
  v_end   := (v_start + interval '1 month')::date;

  with items as (
    -- commission line items
    select
      cr.id,
      'commission'::text as kind,
      cr.deal_id,
      d.reference       as deal_reference,
      cl.business_name  as client_name,
      public.funder_display_name(coalesce(dfs.funder_id, d.awarded_funder_id), auth.uid()) as funder_name,
      cr.attribution_type,
      rp.name           as partner_name,
      pr.full_name      as contractor_name,
      cr.gross_commission,
      cr.company_retention,
      cr.partner_share,
      cr.owner_share,
      cr.contractor_share,
      0::numeric        as bonus_amount,
      cr.gross_commission as amount,
      cr.status::text   as state,
      (coalesce(cr.earned_at, cr.created_at) at time zone 'Africa/Johannesburg') as occurred_at
    from public.commission_records cr
    left join public.deals d on d.id = cr.deal_id
    left join public.clients cl on cl.id = d.client_id
    left join public.deal_funder_submissions dfs on dfs.id = cr.deal_funder_submission_id
    left join public.referral_partners rp on rp.id = cr.referral_partner_id
    left join public.profiles pr on pr.id = cr.contractor_id
    where cr.status <> 'void'
      and (coalesce(cr.earned_at, cr.created_at) at time zone 'Africa/Johannesburg')::date >= v_start
      and (coalesce(cr.earned_at, cr.created_at) at time zone 'Africa/Johannesburg')::date <  v_end
    union all
    -- discretionary owner bonuses (partner-attributed)
    select
      br.id,
      'bonus'::text     as kind,
      br.deal_id,
      d.reference       as deal_reference,
      cl.business_name  as client_name,
      public.funder_display_name(coalesce(dfs.funder_id, d.awarded_funder_id), auth.uid()) as funder_name,
      null::text        as attribution_type,
      rp.name           as partner_name,
      null::text        as contractor_name,
      0::numeric        as gross_commission,
      0::numeric        as company_retention,
      0::numeric        as partner_share,
      0::numeric        as owner_share,
      0::numeric        as contractor_share,
      br.bonus_amount,
      br.bonus_amount   as amount,
      br.state::text    as state,
      (coalesce(br.earned_at, br.created_at) at time zone 'Africa/Johannesburg') as occurred_at
    from public.bonus_records br
    left join public.deals d on d.id = br.deal_id
    left join public.clients cl on cl.id = d.client_id
    left join public.deal_funder_submissions dfs on dfs.id = br.deal_funder_submission_id
    left join public.referral_partners rp on rp.id = br.referral_partner_id
    where br.state <> 'void'
      and (coalesce(br.earned_at, br.created_at) at time zone 'Africa/Johannesburg')::date >= v_start
      and (coalesce(br.earned_at, br.created_at) at time zone 'Africa/Johannesburg')::date <  v_end
  )
  select
    coalesce(jsonb_agg(to_jsonb(i.*) order by i.occurred_at desc, i.id), '[]'::jsonb),
    jsonb_build_object(
      'gross_commission',  coalesce(sum(i.gross_commission), 0),
      'company_retention', coalesce(sum(i.company_retention), 0),
      'partner_share',     coalesce(sum(i.partner_share), 0),
      'owner_share',       coalesce(sum(i.owner_share), 0),
      'contractor_share',  coalesce(sum(i.contractor_share), 0),
      'bonus',             coalesce(sum(i.bonus_amount), 0),
      'line_count',        count(*)
    )
  into v_items, v_totals
  from items i;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'year',  p_year,
      'month', p_month,
      'label', to_char(v_start, 'FMMonth YYYY'),
      'start', v_start,
      'end',   (v_end - 1)
    ),
    'totals', v_totals,
    'line_items', v_items
  );
end;
$$;

-- ============================================================================
-- PARTNER (Doctor / Bright Destiny) — HIS take only. S7C: never gross, retention,
-- pool, owner share, or tier; funder name is the fictional display name only.
-- ============================================================================
create or replace function public.get_partner_monthly_statement(p_year int, p_month int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner uuid;
  v_start date;
  v_end   date;
  v_items jsonb;
  v_totals jsonb;
begin
  -- Gate: caller must be an active partner. current_partner_id() already
  -- enforces role = 'partner' and returns the caller's referral_partner_id.
  v_partner := public.current_partner_id();
  if v_partner is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'Invalid month: %', p_month using errcode = '22023';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'Invalid year: %', p_year using errcode = '22023';
  end if;

  v_start := make_date(p_year, p_month, 1);
  v_end   := (v_start + interval '1 month')::date;

  with items as (
    -- commission: the partner sees ONLY his partner_share as "amount"
    select
      cr.id,
      'commission'::text as kind,
      d.reference       as deal_reference,
      cl.business_name  as client_name,
      public.funder_display_name(coalesce(dfs.funder_id, d.awarded_funder_id), auth.uid()) as funder_name,
      cr.partner_share  as amount,
      cr.status::text   as state,
      (coalesce(cr.earned_at, cr.created_at) at time zone 'Africa/Johannesburg') as occurred_at
    from public.commission_records cr
    left join public.deals d on d.id = cr.deal_id
    left join public.clients cl on cl.id = d.client_id
    left join public.deal_funder_submissions dfs on dfs.id = cr.deal_funder_submission_id
    where cr.referral_partner_id = v_partner
      and cr.status <> 'void'
      and (coalesce(cr.earned_at, cr.created_at) at time zone 'Africa/Johannesburg')::date >= v_start
      and (coalesce(cr.earned_at, cr.created_at) at time zone 'Africa/Johannesburg')::date <  v_end
    union all
    -- discretionary bonus: the bonus amount is his to receive
    select
      br.id,
      'bonus'::text     as kind,
      d.reference       as deal_reference,
      cl.business_name  as client_name,
      public.funder_display_name(coalesce(dfs.funder_id, d.awarded_funder_id), auth.uid()) as funder_name,
      br.bonus_amount   as amount,
      br.state::text    as state,
      (coalesce(br.earned_at, br.created_at) at time zone 'Africa/Johannesburg') as occurred_at
    from public.bonus_records br
    left join public.deals d on d.id = br.deal_id
    left join public.clients cl on cl.id = d.client_id
    left join public.deal_funder_submissions dfs on dfs.id = br.deal_funder_submission_id
    where br.referral_partner_id = v_partner
      and br.state <> 'void'
      and (coalesce(br.earned_at, br.created_at) at time zone 'Africa/Johannesburg')::date >= v_start
      and (coalesce(br.earned_at, br.created_at) at time zone 'Africa/Johannesburg')::date <  v_end
  )
  select
    coalesce(jsonb_agg(to_jsonb(i.*) order by i.occurred_at desc, i.id), '[]'::jsonb),
    jsonb_build_object(
      'commission_total', coalesce(sum(i.amount) filter (where i.kind = 'commission'), 0),
      'bonus_total',      coalesce(sum(i.amount) filter (where i.kind = 'bonus'), 0),
      'total_earned',     coalesce(sum(i.amount), 0),
      'line_count',       count(*)
    )
  into v_items, v_totals
  from items i;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'year',  p_year,
      'month', p_month,
      'label', to_char(v_start, 'FMMonth YYYY'),
      'start', v_start,
      'end',   (v_end - 1)
    ),
    'totals', v_totals,
    'line_items', v_items
  );
end;
$$;

-- ============================================================================
-- CONTRACTOR — HIS commission take (contractor_share) only, plus a
-- reimbursements section. Funder name is the fictional display name only.
--
-- REIMBURSEMENTS NOTE: contractor operating-expense reimbursements
-- (petrol/airtime/data, per CONTRACTOR.md) live in the PROGRESSION lane's
-- schema, which is being built in parallel and does NOT yet exist live. This
-- statement therefore returns an empty `reimbursements` array with
-- `reimbursements_available: false` today. When PROGRESSION ships its
-- reimbursement ledger, this RPC extends to read it (a `reimbursements` CTE +
-- the `reimbursement_total` sum) with no change to the statement's JSON shape or
-- the frontend — the section is already rendered.
-- ============================================================================
create or replace function public.get_contractor_monthly_statement(p_year int, p_month int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_start date;
  v_end   date;
  v_items jsonb;
  v_commission_total numeric;
  v_count int;
begin
  -- Gate: caller must be an active contractor.
  if v_uid is null
     or not exists (
       select 1 from public.profiles
       where id = v_uid and role = 'contractor' and is_active
     ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'Invalid month: %', p_month using errcode = '22023';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'Invalid year: %', p_year using errcode = '22023';
  end if;

  v_start := make_date(p_year, p_month, 1);
  v_end   := (v_start + interval '1 month')::date;

  with items as (
    select
      cr.id,
      'commission'::text as kind,
      d.reference       as deal_reference,
      cl.business_name  as client_name,
      public.funder_display_name(coalesce(dfs.funder_id, d.awarded_funder_id), auth.uid()) as funder_name,
      cr.contractor_share as amount,
      cr.status::text   as state,
      (coalesce(cr.earned_at, cr.created_at) at time zone 'Africa/Johannesburg') as occurred_at
    from public.commission_records cr
    left join public.deals d on d.id = cr.deal_id
    left join public.clients cl on cl.id = d.client_id
    left join public.deal_funder_submissions dfs on dfs.id = cr.deal_funder_submission_id
    where cr.contractor_id = v_uid
      and cr.status <> 'void'
      and (coalesce(cr.earned_at, cr.created_at) at time zone 'Africa/Johannesburg')::date >= v_start
      and (coalesce(cr.earned_at, cr.created_at) at time zone 'Africa/Johannesburg')::date <  v_end
  )
  select
    coalesce(jsonb_agg(to_jsonb(i.*) order by i.occurred_at desc, i.id), '[]'::jsonb),
    coalesce(sum(i.amount), 0),
    count(*)
  into v_items, v_commission_total, v_count
  from items i;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'year',  p_year,
      'month', p_month,
      'label', to_char(v_start, 'FMMonth YYYY'),
      'start', v_start,
      'end',   (v_end - 1)
    ),
    'totals', jsonb_build_object(
      'commission_total',    v_commission_total,
      'reimbursement_total', 0,
      'total',               v_commission_total,
      'line_count',          v_count
    ),
    'line_items', v_items,
    -- Reimbursements land with the PROGRESSION lane's ledger (see header note).
    'reimbursements', '[]'::jsonb,
    'reimbursements_available', false
  );
end;
$$;

-- ---- grants matrix (FIX-A posture) -----------------------------------------
-- Supabase default-privileges auto-grant EXECUTE to anon + authenticated on new
-- public functions, so revoke from public + anon explicitly, then grant only to
-- the intended roles. Each RPC self-gates, so authenticated is safe.
revoke all on function public.get_owner_monthly_statement(int, int) from public, anon;
revoke all on function public.get_partner_monthly_statement(int, int) from public, anon;
revoke all on function public.get_contractor_monthly_statement(int, int) from public, anon;

grant execute on function public.get_owner_monthly_statement(int, int) to authenticated, service_role, postgres;
grant execute on function public.get_partner_monthly_statement(int, int) to authenticated, service_role, postgres;
grant execute on function public.get_contractor_monthly_statement(int, int) to authenticated, service_role, postgres;

-- ---- assertions ------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  -- All three exist and are SECURITY DEFINER with a pinned search_path.
  for v_ok in
    select p.prosecdef and coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_owner_monthly_statement',
        'get_partner_monthly_statement',
        'get_contractor_monthly_statement'
      )
  loop
    if not v_ok then
      raise exception 'statement RPC missing SECURITY DEFINER or pinned search_path';
    end if;
  end loop;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('get_owner_monthly_statement','get_partner_monthly_statement','get_contractor_monthly_statement')) <> 3 then
    raise exception 'expected exactly 3 statement RPCs';
  end if;

  -- anon must NOT hold EXECUTE on any of the three.
  if exists (
    select 1
    from information_schema.role_routine_grants g
    where g.specific_schema = 'public'
      and g.routine_name in ('get_owner_monthly_statement','get_partner_monthly_statement','get_contractor_monthly_statement')
      and g.grantee = 'anon'
  ) then
    raise exception 'anon must not have EXECUTE on statement RPCs';
  end if;

  -- authenticated MUST hold EXECUTE on all three.
  if (select count(distinct g.routine_name)
      from information_schema.role_routine_grants g
      where g.specific_schema = 'public'
        and g.routine_name in ('get_owner_monthly_statement','get_partner_monthly_statement','get_contractor_monthly_statement')
        and g.grantee = 'authenticated'
        and g.privilege_type = 'EXECUTE') <> 3 then
    raise exception 'authenticated must have EXECUTE on all 3 statement RPCs';
  end if;

  -- Identity gate fires for a non-owner/non-partner/non-contractor caller. At
  -- apply time the executing role is postgres with auth.uid() = null, so all
  -- three must raise 42501 (insufficient_privilege).
  begin
    perform public.get_owner_monthly_statement(2026, 8);
    raise exception 'owner statement did not gate an unauthorized caller';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_partner_monthly_statement(2026, 8);
    raise exception 'partner statement did not gate an unauthorized caller';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_contractor_monthly_statement(2026, 8);
    raise exception 'contractor statement did not gate an unauthorized caller';
  exception when insufficient_privilege then null;
  end;

  raise notice 'monthly-statements RPCs: structural + grant + gate assertions passed';
end;
$$;
