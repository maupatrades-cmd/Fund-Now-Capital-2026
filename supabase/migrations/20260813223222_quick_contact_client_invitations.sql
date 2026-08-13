-- Quick-contact client invitations.
-- A permitted CRM role may send portal access before completing a full lead.
-- Attribution is captured here and never inferred from client-editable data.

create table public.client_quick_invitations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  client_contact_id uuid not null references public.client_contacts(id) on delete restrict,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  inviter_role public.user_role not null,
  referral_partner_id uuid references public.referral_partners(id) on delete restrict,
  contact_email text not null check (
    contact_email = lower(btrim(contact_email))
    and length(contact_email) between 3 and 254
  ),
  status text not null default 'pending'
    check (status in ('pending','welcome_sent','welcome_failed','accepted','cancelled')),
  sent_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_quick_invitations_role_ck
    check (inviter_role in ('owner','partner','contractor','lead_referrer')),
  constraint client_quick_invitations_actor_unique unique (client_id, invited_by)
);

create index client_quick_invitations_actor_idx
  on public.client_quick_invitations (invited_by, created_at desc);
create index client_quick_invitations_email_idx
  on public.client_quick_invitations (contact_email, created_at desc);

create trigger client_quick_invitations_set_updated_at
  before update on public.client_quick_invitations
  for each row execute function public.set_updated_at();

alter table public.client_quick_invitations enable row level security;
revoke all on public.client_quick_invitations from public, anon, authenticated;
grant select on public.client_quick_invitations to authenticated;

create policy "quick_invitations_owner_read"
  on public.client_quick_invitations for select to authenticated
  using (public.is_owner());

create policy "quick_invitations_actor_read"
  on public.client_quick_invitations for select to authenticated
  using (invited_by = (select auth.uid()));

create or replace function public.service_create_quick_client_invitation(
  p_actor_id uuid,
  p_email text,
  p_contact_name text default null,
  p_phone text default null,
  p_business_name text default null
) returns table (invitation_id uuid, client_id uuid, client_contact_id uuid, business_name text, contact_name text, contact_email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_contact_name, '')), '');
  v_business text := nullif(btrim(coalesce(p_business_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_client_id uuid;
  v_contact_id uuid;
  v_invitation_id uuid;
begin
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v_email) > 254 then
    raise exception 'A valid client email address is required';
  end if;
  if v_phone is not null and length(v_phone) > 32 then
    raise exception 'Phone number is too long';
  end if;
  if v_name is not null and length(v_name) > 160 then
    raise exception 'Contact name is too long';
  end if;
  if v_business is not null and length(v_business) > 200 then
    raise exception 'Business name is too long';
  end if;

  select * into v_actor from public.profiles
   where id = p_actor_id and is_active
     and role in ('owner','partner','contractor','lead_referrer');
  if not found then raise exception 'This role cannot invite clients'; end if;

  -- Prevent two simultaneous callers from creating duplicate identities.
  perform pg_advisory_xact_lock(hashtext('quick-client:' || v_email));

  -- Never create a client shell for an email that already belongs to a
  -- non-client CRM user. Client identities reuse their existing client link.
  if exists (
    select 1 from public.profiles p
     where lower(btrim(p.email)) = v_email and p.role <> 'client'
  ) then
    raise exception 'This email already belongs to another CRM identity';
  end if;

  select p.client_id into v_client_id
    from public.profiles p
   where lower(btrim(p.email)) = v_email and p.role = 'client'
   limit 1;

  if v_client_id is not null then
    select cc.id into v_contact_id
      from public.client_contacts cc
     where cc.client_id = v_client_id and lower(btrim(cc.email)) = v_email
     order by cc.is_primary_director desc, cc.created_at, cc.id
     limit 1;
  end if;

  if v_client_id is null then
    select cc.client_id, cc.id
      into v_client_id, v_contact_id
      from public.client_contacts cc
     where lower(btrim(cc.email)) = v_email
       and cc.is_primary_director
     order by cc.created_at, cc.id
     limit 1;
  end if;

  if v_client_id is not null then
    if v_actor.role <> 'owner'
       and not exists (
         select 1 from public.client_quick_invitations qi
          where qi.client_id = v_client_id and qi.invited_by = v_actor.id
       )
       and not (
         v_actor.role = 'partner'
         and v_actor.referral_partner_id is not null
         and exists (select 1 from public.clients c where c.id = v_client_id and c.referral_partner_id = v_actor.referral_partner_id)
       )
       and not exists (
         select 1
           from public.deals d
           join public.leads l on l.id = d.lead_id
          where d.client_id = v_client_id and (
            (v_actor.role = 'contractor' and l.attributed_to_contractor_id = v_actor.id)
            or (v_actor.role = 'lead_referrer' and coalesce(l.attributed_to_lead_referrer_id, l.original_referrer_id) = v_actor.id)
          )
       ) then
      raise exception 'This email is already linked to another CRM relationship';
    end if;
    if v_contact_id is null then
      raise exception 'The existing client identity has no matching contact record';
    end if;
  else
    v_name := coalesce(v_name, split_part(v_email, '@', 1));
    v_business := coalesce(v_business, v_name || ' - application pending');
    insert into public.clients (business_name, referral_partner_id, created_by, notes)
    values (v_business, v_actor.referral_partner_id, v_actor.id, 'Quick portal invitation; client details pending completion.')
    returning id into v_client_id;

    insert into public.client_contacts (client_id, full_name, email, phone, position, is_primary_director)
    values (v_client_id, v_name, v_email, v_phone, 'Primary contact - details pending', true)
    returning id into v_contact_id;
  end if;

  select c.business_name, cc.full_name
    into v_business, v_name
    from public.clients c
    join public.client_contacts cc on cc.id = v_contact_id
   where c.id = v_client_id;

  insert into public.client_quick_invitations (
    client_id, client_contact_id, invited_by, inviter_role,
    referral_partner_id, contact_email, status
  ) values (
    v_client_id, v_contact_id, v_actor.id, v_actor.role,
    v_actor.referral_partner_id, v_email, 'pending'
  )
  on conflict (client_id, invited_by) do update set
    client_contact_id = excluded.client_contact_id,
    inviter_role = excluded.inviter_role,
    referral_partner_id = excluded.referral_partner_id,
    contact_email = excluded.contact_email,
    status = 'pending',
    updated_at = now()
  returning id into v_invitation_id;

  return query select v_invitation_id, v_client_id, v_contact_id, v_business, v_name, v_email;
end;
$$;

revoke all on function public.service_create_quick_client_invitation(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.service_create_quick_client_invitation(uuid,text,text,text,text) to service_role;

-- Extend the existing list without exposing another actor's contact details.
create or replace function public.role_client_invitation_candidates(p_actor_id uuid default auth.uid())
returns table (
  client_id uuid, business_name text, contact_id uuid, contact_name text,
  contact_email text, latest_status text, welcome_sent_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  with actor as (
    select p.id, p.role, p.referral_partner_id
      from public.profiles p
     where p.id = p_actor_id and p.id = auth.uid() and p.is_active
       and p.role in ('owner','partner','contractor','lead_referrer')
  ), allowed as (
    select distinct c.id, c.business_name
      from actor a
      join public.clients c on (
        a.role = 'owner'
        or (a.role = 'partner' and c.referral_partner_id = a.referral_partner_id)
        or exists (
          select 1 from public.client_quick_invitations qi
           where qi.client_id = c.id and qi.invited_by = a.id and qi.status <> 'cancelled'
        )
        or exists (
          select 1 from public.deals d join public.leads l on l.id = d.lead_id
           where d.client_id = c.id and (
             (a.role = 'contractor' and l.attributed_to_contractor_id = a.id)
             or (a.role = 'lead_referrer' and coalesce(l.attributed_to_lead_referrer_id, l.original_referrer_id) = a.id)
           )
        )
      )
  )
  select a.id, a.business_name, cc.id, cc.full_name, cc.email, b.status, b.welcome_sent_at
    from allowed a
    left join lateral (
      select c.id, c.full_name, c.email from public.client_contacts c
       where c.client_id = a.id and c.is_primary_director
       order by c.created_at, c.id limit 1
    ) cc on true
    left join lateral (
      select cab.status, cab.welcome_sent_at from public.client_account_bootstraps cab
       where cab.client_id = a.id order by cab.requested_at desc, cab.id desc limit 1
    ) b on true
   order by a.business_name, a.id;
$$;

revoke all on function public.role_client_invitation_candidates(uuid) from public, anon;
grant execute on function public.role_client_invitation_candidates(uuid) to authenticated, service_role;

do $$
begin
  if has_table_privilege('anon','public.client_quick_invitations','SELECT')
     or has_table_privilege('authenticated','public.client_quick_invitations','INSERT') then
    raise exception 'Quick invitation table grants are broader than intended';
  end if;
  if has_function_privilege('anon','public.service_create_quick_client_invitation(uuid,text,text,text,text)','execute')
     or has_function_privilege('authenticated','public.service_create_quick_client_invitation(uuid,text,text,text,text)','execute') then
    raise exception 'Quick invitation creation RPC is callable outside service role';
  end if;
end;
$$;
