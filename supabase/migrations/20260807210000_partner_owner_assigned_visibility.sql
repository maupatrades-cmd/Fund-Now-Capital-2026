-- Show partner-submitted AND owner-assigned work in the partner portal.
--
-- Root cause: partner submissions store the individual portal user's id in
-- leads.attributed_to_partner_id, while owner-captured work stores the partner
-- organisation in leads/deals.referral_partner_id and deal_attributions.
-- The old portal rules only recognised the first shape.

drop policy if exists leads_partner_read_own on public.leads;
create policy leads_partner_read_own on public.leads
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'partner'
        and p.is_active
        and (
          leads.attributed_to_partner_id = p.id
          or (
            p.referral_partner_id is not null
            and leads.referral_partner_id = p.referral_partner_id
          )
        )
    )
  );

create or replace function public.partner_list_own_deals()
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
  v_uid        uuid := (select auth.uid());
  v_role       text;
  v_active     boolean;
  v_partner_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select p.role, p.is_active, p.referral_partner_id
    into v_role, v_active, v_partner_id
  from public.profiles p
  where p.id = v_uid;

  if v_role is distinct from 'partner' or not coalesce(v_active, false) then
    raise exception 'Active partner account required' using errcode = '42501';
  end if;

  return query
  select
    d.id,
    d.reference,
    c.business_name,
    d.stage::text,
    public.funder_display_name(d.awarded_funder_id, v_uid),
    coalesce(l.created_at, d.created_at)
  from public.deals d
  join public.clients c on c.id = d.client_id
  left join public.leads l on l.id = d.lead_id
  left join public.deal_attributions da on da.deal_id = d.id
  where d.archived_at is null
    and (
      l.attributed_to_partner_id = v_uid
      or (
        v_partner_id is not null
        and (
          l.referral_partner_id = v_partner_id
          or d.referral_partner_id = v_partner_id
          or (
            da.attribution_type = 'Bright_Destiny_Partner'
            and da.attributed_to_id = v_partner_id
          )
        )
      )
    )
  order by coalesce(l.created_at, d.created_at) desc;
end;
$$;

revoke all on function public.partner_list_own_deals() from public, anon;
grant execute on function public.partner_list_own_deals() to authenticated, service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'leads'
      and policyname = 'leads_partner_read_own'
      and cmd = 'SELECT'
  ) then
    raise exception 'Partner lead visibility policy was not created';
  end if;

  if not exists (
    select 1
    from pg_proc
    where oid = 'public.partner_list_own_deals()'::regprocedure
      and prosecdef
  ) then
    raise exception 'partner_list_own_deals must remain SECURITY DEFINER';
  end if;

  if has_function_privilege('anon', 'public.partner_list_own_deals()', 'execute') then
    raise exception 'partner_list_own_deals must not be executable by anon';
  end if;
end;
$$;

notify pgrst, 'reload schema';
