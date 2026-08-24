-- Replace SECURITY DEFINER views with narrowly projected, role-checked RPCs.
drop view if exists public.lead_referrer_my_earnings;
drop view if exists public.doctor_my_network;

create or replace function public.lead_referrer_my_earnings()
returns table (
  id uuid,
  deal_id uuid,
  lr_earning numeric,
  tier integer,
  status public.lead_referrer_commission_state,
  earned_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.user_role;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.role into v_role from public.profiles p where p.id=v_uid and p.is_active;
  if not public.is_owner() and v_role <> 'lead_referrer' then
    raise exception 'Lead referrer access required' using errcode='42501';
  end if;
  return query
    select r.id,r.deal_id,r.lr_earning,r.tier,r.status,r.earned_at,r.settled_at,r.created_at
      from public.lead_referrer_commission_records r
     where public.is_owner() or r.lead_refer_id=v_uid
     order by r.created_at desc;
end;
$$;

create or replace function public.doctor_my_network()
returns table (
  lead_refer_id uuid,
  lead_refer_name text,
  doctor_partner_id uuid,
  lead_count bigint,
  deal_count bigint,
  doctor_pool_growth numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_partner_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  v_partner_id := public.current_partner_id();
  if not public.is_owner() and v_partner_id is null then
    raise exception 'Partner access required' using errcode='42501';
  end if;
  return query
    select lr.id,lr.full_name,lr.sourced_via_partner_id,
           count(distinct l.id),count(distinct d.id),
           coalesce(sum(cr.partner_share),0)::numeric
      from public.profiles lr
      left join public.leads l on l.sourced_by_lead_refer_id=lr.id
      left join public.deals d on d.lead_id=l.id
      left join public.commission_records cr
        on cr.deal_id=d.id
       and cr.referral_partner_id=lr.sourced_via_partner_id
       and cr.status <> 'void'
     where lr.sourced_via_partner_id is not null
       and (public.is_owner() or lr.sourced_via_partner_id=v_partner_id)
     group by lr.id,lr.full_name,lr.sourced_via_partner_id
     order by lr.full_name;
end;
$$;

revoke all on function public.lead_referrer_my_earnings() from public, anon, authenticated;
revoke all on function public.doctor_my_network() from public, anon, authenticated;
grant execute on function public.lead_referrer_my_earnings() to authenticated;
grant execute on function public.doctor_my_network() to authenticated;

do $$
begin
  if to_regclass('public.lead_referrer_my_earnings') is not null
     or to_regclass('public.doctor_my_network') is not null then
    raise exception 'Role money/network SECURITY DEFINER views must not remain';
  end if;
  if has_function_privilege('anon','public.lead_referrer_my_earnings()','execute')
     or has_function_privilege('anon','public.doctor_my_network()','execute') then
    raise exception 'Anonymous role RPC access is forbidden';
  end if;
end $$;

notify pgrst, 'reload schema';
