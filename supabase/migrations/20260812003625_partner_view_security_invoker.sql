-- C2: Remove SECURITY DEFINER views without exposing sensitive base tables.
-- Sanitised SECURITY DEFINER functions retain the original partner scoping;
-- SECURITY INVOKER views call only those safe projections.

create or replace function public.partner_safe_submission_rows()
returns table (
  id uuid,
  deal_id uuid,
  funder_display_name text,
  status text,
  decline_reason_category public.submission_decline_reason
)
language sql stable security definer set search_path = '' as $$
  select s.id, s.deal_id, f.display_name_for_partner, s.status, s.decline_reason_category
  from public.deal_funder_submissions s
  join public.deals d on d.id = s.deal_id
  join public.funders f on f.id = s.funder_id
  where coalesce(public.is_owner(), false)
     or d.referral_partner_id = public.current_partner_id();
$$;

create or replace function public.partner_safe_funder_appetite_rows()
returns table (
  industry_id uuid,
  industry_name text,
  funder_display_name text,
  appetite_level public.appetite_level
)
language sql stable security definer set search_path = '' as $$
  select p.industry_id, i.name, f.display_name_for_partner, p.appetite_level
  from public.funder_industry_preferences p
  join public.funders f on f.id = p.funder_id
  join public.industries i on i.id = p.industry_id
  where coalesce(public.is_owner(), false)
     or public.current_partner_id() is not null;
$$;

create or replace function public.partner_safe_lead_rows()
returns table (
  id uuid,
  business_name text,
  industry_id uuid,
  sub_industry_id uuid,
  sector_notes text,
  funding_amount numeric,
  funding_purpose jsonb,
  funding_timeline public.lead_funding_timeline,
  qualification_stage public.lead_qualification_stage,
  referred_by public.lead_referred_by,
  referral_partner_id uuid,
  original_referrer_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  not_qualified_reason public.lead_not_qualified_reason
)
language sql stable security definer set search_path = '' as $$
  select l.id, l.business_name, l.industry_id, l.sub_industry_id, l.sector_notes,
         l.funding_amount, l.funding_purpose, l.funding_timeline,
         l.qualification_stage, l.referred_by, l.referral_partner_id,
         l.original_referrer_id, l.created_at, l.updated_at, l.not_qualified_reason
  from public.leads l
  where coalesce(public.is_owner(), false)
     or l.referral_partner_id = public.current_partner_id()
     or l.original_referrer_id = public.current_partner_id();
$$;

create or replace function public.partner_safe_stakeholder_rows()
returns table (
  id uuid,
  client_id uuid,
  lead_id uuid,
  full_name text,
  roles public.stakeholder_role[],
  shareholding_percent numeric
)
language sql stable security definer set search_path = '' as $$
  select s.id, s.client_id, s.lead_id, s.full_name, s.roles, s.shareholding_percent
  from public.client_stakeholders s
  left join public.clients c on c.id = s.client_id
  left join public.leads l on l.id = s.lead_id
  where coalesce(public.is_owner(), false)
     or c.referral_partner_id = public.current_partner_id()
     or l.referral_partner_id = public.current_partner_id();
$$;

revoke all on function public.partner_safe_submission_rows() from public, anon;
revoke all on function public.partner_safe_funder_appetite_rows() from public, anon;
revoke all on function public.partner_safe_lead_rows() from public, anon;
revoke all on function public.partner_safe_stakeholder_rows() from public, anon;
grant execute on function public.partner_safe_submission_rows() to authenticated;
grant execute on function public.partner_safe_funder_appetite_rows() to authenticated;
grant execute on function public.partner_safe_lead_rows() to authenticated;
grant execute on function public.partner_safe_stakeholder_rows() to authenticated;

create or replace view public.partner_submission_view
with (security_invoker = true, security_barrier = true) as
  select * from public.partner_safe_submission_rows();
create or replace view public.partner_funder_industry_appetite
with (security_invoker = true, security_barrier = true) as
  select * from public.partner_safe_funder_appetite_rows();
create or replace view public.partner_leads_view
with (security_invoker = true, security_barrier = true) as
  select id, business_name, industry_id, sub_industry_id, sector_notes,
         funding_amount::numeric(14,2) as funding_amount,
         funding_purpose, funding_timeline, qualification_stage, referred_by,
         referral_partner_id, original_referrer_id, created_at, updated_at,
         not_qualified_reason
  from public.partner_safe_lead_rows();
create or replace view public.partner_stakeholders_view
with (security_invoker = true, security_barrier = true) as
  select id, client_id, lead_id, full_name, roles,
         shareholding_percent::numeric(5,2) as shareholding_percent
  from public.partner_safe_stakeholder_rows();

comment on view public.partner_submission_view is
  'Security-invoker partner projection backed by a scoped definer function. Exposes only fictional funder name, status and generic decline reason.';
comment on view public.partner_funder_industry_appetite is
  'Security-invoker partner projection backed by a scoped definer function. Exposes anonymised appetite data only.';
comment on view public.partner_leads_view is
  'Security-invoker partner projection backed by a scoped definer function. Exposes only partner-safe lead fields within caller attribution.';
comment on view public.partner_stakeholders_view is
  'Security-invoker partner projection backed by a scoped definer function. Excludes stakeholder identity and contact PII.';

grant select on public.partner_submission_view,
  public.partner_funder_industry_appetite,
  public.partner_leads_view,
  public.partner_stakeholders_view to authenticated;

do $$
declare v_name text; v_options text[];
begin
  foreach v_name in array array[
    'partner_submission_view','partner_funder_industry_appetite',
    'partner_leads_view','partner_stakeholders_view'
  ] loop
    select c.reloptions into v_options
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=v_name and c.relkind='v';
    if v_options is null or not ('security_invoker=true'=any(v_options)) then
      raise exception 'C2: public.% is not security_invoker', v_name;
    end if;
    if not has_table_privilege('authenticated','public.'||v_name,'SELECT') then
      raise exception 'C2: authenticated cannot select public.%', v_name;
    end if;
  end loop;
  if exists (
    select 1
    from unnest(array[
      'funders','deal_funder_submissions','funder_industry_preferences',
      'leads','clients','client_stakeholders','deals','industries'
    ]) t(name)
    where not (select c.relrowsecurity from pg_class c where c.oid=to_regclass('public.'||t.name))
  ) then
    raise exception 'C2: an underlying partner-projection table does not enforce RLS';
  end if;
  -- Base-table grants may exist in the canonical schema; RLS above remains the
  -- access boundary. Anonymous execution of these definer projections is denied.
  if has_function_privilege('anon','public.partner_safe_submission_rows()','EXECUTE')
     or has_function_privilege('anon','public.partner_safe_funder_appetite_rows()','EXECUTE')
     or has_function_privilege('anon','public.partner_safe_lead_rows()','EXECUTE')
     or has_function_privilege('anon','public.partner_safe_stakeholder_rows()','EXECUTE') then
    raise exception 'C2: anonymous safe-projection access exposed';
  end if;
end;
$$;

notify pgrst, 'reload schema';
