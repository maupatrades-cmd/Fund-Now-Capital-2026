-- Lead-referrer operational pipeline.
--
-- Direct and partner-linked sub-agents share the lead_referrer profile role.
-- The caller is always scoped to their own immutable lead attribution; the
-- parent partner is deliberately not used as a visibility shortcut.

create or replace function public.lead_referrer_list_own_deals()
returns table (
  deal_id                uuid,
  deal_reference         text,
  client_business_name   text,
  current_stage          text,
  anonymized_funder_name text,
  submitted_at           timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_active boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select p.role::text, p.is_active
    into v_role, v_active
  from public.profiles p
  where p.id = v_uid;

  if v_role is distinct from 'lead_referrer' or not coalesce(v_active, false) then
    raise exception 'Active lead-referrer account required' using errcode = '42501';
  end if;

  return query
  select
    d.id,
    d.reference,
    c.business_name,
    d.stage::text,
    case when d.awarded_funder_id is null then null else 'Funding partner' end,
    coalesce(l.created_at, d.created_at)
  from public.deals d
  join public.leads l on l.id = d.lead_id
  join public.clients c on c.id = d.client_id
  where d.archived_at is null
    and (
      l.attributed_to_lead_referrer_id = v_uid
      or l.sourced_by_lead_refer_id = v_uid
    )
  order by coalesce(l.created_at, d.created_at) desc;
end;
$$;

revoke all on function public.lead_referrer_list_own_deals() from public, anon;
grant execute on function public.lead_referrer_list_own_deals() to authenticated, service_role;

do $$
begin
  if not exists (
    select 1
    from pg_proc
    where oid = 'public.lead_referrer_list_own_deals()'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'lead_referrer_list_own_deals must be SECURITY DEFINER with an empty search_path';
  end if;

  if has_function_privilege('anon', 'public.lead_referrer_list_own_deals()', 'execute') then
    raise exception 'lead_referrer_list_own_deals must not be executable by anon';
  end if;

  if not has_function_privilege('authenticated', 'public.lead_referrer_list_own_deals()', 'execute') then
    raise exception 'lead_referrer_list_own_deals must be executable by authenticated users';
  end if;
end;
$$;

notify pgrst, 'reload schema';
