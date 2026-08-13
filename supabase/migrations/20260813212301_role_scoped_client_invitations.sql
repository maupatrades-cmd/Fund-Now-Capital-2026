create or replace function public.role_client_invitation_candidates(p_actor_id uuid default auth.uid())
returns table (
  client_id uuid,
  business_name text,
  contact_id uuid,
  contact_name text,
  contact_email text,
  latest_status text,
  welcome_sent_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select p.id, p.role, p.referral_partner_id
    from public.profiles p
    where p.id = p_actor_id
      and p.id = auth.uid()
      and p.is_active
      and p.role in ('owner', 'partner', 'contractor', 'lead_referrer')
  ), allowed as (
    select distinct c.id, c.business_name
    from actor a
    join public.clients c on (
      a.role = 'owner'
      or (a.role = 'partner' and c.referral_partner_id = a.referral_partner_id)
      or exists (
        select 1
        from public.deals d
        join public.leads l on l.id = d.lead_id
        where d.client_id = c.id
          and (
            (a.role = 'contractor' and l.attributed_to_contractor_id = a.id)
            or (a.role = 'lead_referrer' and l.original_referrer_id = a.id)
          )
      )
    )
  )
  select a.id,
         a.business_name,
         cc.id,
         cc.full_name,
         cc.email,
         b.status,
         b.welcome_sent_at
  from allowed a
  left join lateral (
    select c.id, c.full_name, c.email
    from public.client_contacts c
    where c.client_id = a.id and c.is_primary_director
    order by c.created_at, c.id
    limit 1
  ) cc on true
  left join lateral (
    select cab.status, cab.welcome_sent_at
    from public.client_account_bootstraps cab
    where cab.client_id = a.id
    order by cab.requested_at desc, cab.id desc
    limit 1
  ) b on true
  order by a.business_name, a.id;
$$;

revoke all on function public.role_client_invitation_candidates(uuid) from public, anon;
grant execute on function public.role_client_invitation_candidates(uuid) to authenticated, service_role;

comment on function public.role_client_invitation_candidates(uuid) is
  'Returns only clients a signed-in Owner, Partner, Contractor or Lead Referrer is authorised to invite. The actor argument must equal auth.uid().';

do $$
begin
  if has_function_privilege('anon', 'public.role_client_invitation_candidates(uuid)', 'execute') then
    raise exception 'anon can execute role_client_invitation_candidates';
  end if;
end;
$$;
