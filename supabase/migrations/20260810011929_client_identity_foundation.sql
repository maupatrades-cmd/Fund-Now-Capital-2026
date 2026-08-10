-- Build 74A: client identity boundary and least-privilege read isolation.
-- Backend only. This does not expose public signup and does not create a portal.

alter table public.profiles
  add column if not exists client_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_client_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_client_id_fkey
      foreign key (client_id) references public.clients(id)
      on delete restrict not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_client_id_role_ck'
  ) then
    alter table public.profiles
      add constraint profiles_client_id_role_ck
      check ((role = 'client'::public.user_role) = (client_id is not null))
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_client_no_partner_ck'
  ) then
    alter table public.profiles
      add constraint profiles_client_no_partner_ck
      check (role <> 'client'::public.user_role or referral_partner_id is null)
      not valid;
  end if;
end;
$$;

alter table public.profiles validate constraint profiles_client_id_role_ck;
alter table public.profiles validate constraint profiles_client_no_partner_ck;

comment on column public.profiles.client_id is
  'For role=client only: the single CRM client business this authenticated user may access. Never derived from user-editable JWT metadata in RLS.';

create or replace function public.current_client_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.client_id
    from public.profiles p
   where p.id = (select auth.uid())
     and p.role = 'client'::public.user_role
     and p.is_active;
$$;

revoke execute on function public.current_client_id() from public;
revoke execute on function public.current_client_id() from anon;
grant execute on function public.current_client_id() to authenticated;

comment on function public.current_client_id() is
  'Returns only the active signed-in client profile client_id. Role-guarded client identity primitive for RLS.';

-- Preserve the existing owner/partner/contractor creation behaviour while
-- allowing the future service-role client bootstrap to provide app_metadata
-- role=client and client_id. Public signup remains disabled.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_partner_id uuid;
  v_client_id uuid;
  v_rows integer;
begin
  v_role := nullif(new.raw_app_meta_data ->> 'role', '')::public.user_role;
  if v_role is null then
    raise exception 'Auth users require a service-assigned app_metadata.role';
  end if;

  if v_role = 'partner'::public.user_role then
    v_partner_id := nullif(new.raw_app_meta_data ->> 'referral_partner_id', '')::uuid;
  end if;

  if v_role = 'client'::public.user_role then
    v_client_id := nullif(new.raw_app_meta_data ->> 'client_id', '')::uuid;
    if v_client_id is null then
      raise exception 'Client auth users require app_metadata.client_id';
    end if;
  end if;

  insert into public.profiles
    (id, email, full_name, role, referral_partner_id, client_id)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    v_role,
    v_partner_id,
    v_client_id
  )
  on conflict (id) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 1 and v_role = 'client'::public.user_role then
    insert into public.activity_logs (
      user_id,
      user_email,
      user_role,
      event_type,
      entity_type,
      entity_id,
      description,
      after_values,
      related_entity_ids
    ) values (
      new.id,
      new.email,
      'client',
      'CREATE',
      'profile',
      new.id,
      'Client portal profile provisioned',
      jsonb_build_object('role', 'client', 'client_id', v_client_id),
      jsonb_build_array(v_client_id)
    );
  end if;

  return new;
end;
$$;

alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;

drop policy if exists "clients_client_read_own" on public.clients;
create policy "clients_client_read_own"
  on public.clients for select
  to authenticated
  using (id = (select public.current_client_id()));

drop policy if exists "client_contacts_client_read_own" on public.client_contacts;
create policy "client_contacts_client_read_own"
  on public.client_contacts for select
  to authenticated
  using (client_id = (select public.current_client_id()));

-- Verification assertions. Fail the migration rather than silently shipping a
-- broad policy, an unguarded resolver, or a client role without a CRM link.
do $$
declare
  v_function text;
begin
  if exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public'
       and routine_name = 'current_client_id'
       and grantee in ('PUBLIC', 'anon')
       and privilege_type = 'EXECUTE'
  ) then
    raise exception 'Build 74A: current_client_id is executable by PUBLIC/anon';
  end if;

  if not exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public'
       and routine_name = 'current_client_id'
       and grantee = 'authenticated'
       and privilege_type = 'EXECUTE'
  ) then
    raise exception 'Build 74A: authenticated lacks current_client_id execute';
  end if;

  v_function := pg_get_functiondef('public.current_client_id()'::regprocedure);
  if position('role = ''client''::public.user_role' in v_function) = 0
     or position('p.is_active' in v_function) = 0 then
    raise exception 'Build 74A: current_client_id role/active guard missing';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'clients'
       and policyname = 'clients_client_read_own'
       and cmd = 'SELECT'
       and roles = array['authenticated']::name[]
  ) then
    raise exception 'Build 74A: client self-read policy missing on clients';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'client_contacts'
       and policyname = 'client_contacts_client_read_own'
       and cmd = 'SELECT'
       and roles = array['authenticated']::name[]
  ) then
    raise exception 'Build 74A: client self-read policy missing on client_contacts';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('clients', 'client_contacts')
       and policyname in ('clients_client_read_own', 'client_contacts_client_read_own')
       and cmd <> 'SELECT'
  ) then
    raise exception 'Build 74A: unexpected client write policy exists';
  end if;
end;
$$;
