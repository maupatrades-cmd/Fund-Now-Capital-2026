-- Staff build, Batch 1 (3/5): reusable organisations, teams and memberships.
--
-- An "organisation" is a referral_partners row (Bright Destiny is just one of
-- them — nothing here hardcodes it). The owner can create more organisations,
-- Team Leaders and teams, and set effective membership dates, with no code
-- deployment. Identity (profiles), organisation, team membership, operational
-- assignee and introducing parties stay separate concepts.
--
-- Optional branding config is stored as data only. It never influences access.

alter table public.referral_partners
  add column if not exists branding_config jsonb not null default '{}'::jsonb;

-- Branding is a closed set of display keys; anything else is rejected so the
-- column can never become a back door for access or policy settings.
create or replace function public.branding_config_is_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and octet_length(p::text) <= 4096
     and not exists (
       select 1 from jsonb_object_keys(p) k
        where k not in ('display_name', 'logo_url', 'primary_color', 'accent_color'))
     and coalesce(p ->> 'primary_color' ~ '^#[0-9a-fA-F]{6}$', p -> 'primary_color' is null)
     and coalesce(p ->> 'accent_color'  ~ '^#[0-9a-fA-F]{6}$', p -> 'accent_color'  is null)
     and coalesce(p ->> 'logo_url' ~ '^https://', p -> 'logo_url' is null);
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'referral_partners_branding_config_ck') then
    alter table public.referral_partners
      add constraint referral_partners_branding_config_ck
      check (public.branding_config_is_valid(branding_config));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Teams and memberships
-- ---------------------------------------------------------------------------
create table if not exists public.referral_teams (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.referral_partners(id) on delete restrict,
  name            text not null,
  is_active       boolean not null default true,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint referral_teams_name_ck check (length(btrim(name)) between 1 and 120),
  constraint referral_teams_org_name_uq unique (organisation_id, name)
);

create table if not exists public.referral_team_memberships (
  id                    uuid primary key default gen_random_uuid(),
  team_id               uuid not null references public.referral_teams(id) on delete restrict,
  profile_id            uuid not null references public.profiles(id) on delete restrict,
  membership_role       text not null default 'member',
  effective_from        date not null,
  effective_to          date,
  -- Label of the agreement version in force for this membership (a reference
  -- such as "FNC-PARTNER-44589912 v1"), never contract text or personal data.
  agreement_version_ref text,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint referral_team_memberships_role_ck check (membership_role in ('team_leader', 'member')),
  constraint referral_team_memberships_dates_ck check (effective_to is null or effective_to >= effective_from),
  constraint referral_team_memberships_ref_len_ck
    check (agreement_version_ref is null or length(agreement_version_ref) <= 120)
);

create index if not exists referral_team_memberships_team_idx on public.referral_team_memberships (team_id);
create index if not exists referral_team_memberships_profile_idx on public.referral_team_memberships (profile_id);
create index if not exists referral_teams_org_idx on public.referral_teams (organisation_id);

drop trigger if exists referral_teams_set_updated_at on public.referral_teams;
create trigger referral_teams_set_updated_at
  before update on public.referral_teams
  for each row execute function public.set_updated_at();

-- The organisation a partner / lead-referrer profile belongs to. NULL for a
-- direct agent (lead_referrer with no sourcing partner) and for everyone else.
create or replace function public.my_organisation_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p.role::text
           when 'partner' then p.referral_partner_id
           when 'lead_referrer' then p.sourced_via_partner_id
         end
    from public.profiles p
   where p.id = (select auth.uid()) and p.is_active;
$$;

create or replace function public.my_team_ids(p_leader_only boolean default false)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.team_id
    from public.referral_team_memberships m
   where m.profile_id = (select auth.uid())
     and (not p_leader_only or m.membership_role = 'team_leader')
     and m.effective_from <= public.current_sast_date()
     and (m.effective_to is null or m.effective_to >= public.current_sast_date());
$$;

revoke all on function public.my_organisation_id() from public, anon;
revoke all on function public.my_team_ids(boolean) from public, anon;
grant execute on function public.my_organisation_id() to authenticated;
grant execute on function public.my_team_ids(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Membership validation. Server-side, so it holds for the owner RPCs and any
-- direct owner write alike.
--   * the person must be an agent-type profile (partner / lead_referrer);
--   * their organisation must be the team's organisation (cross-organisation
--     membership is impossible);
--   * a person is in at most one team at any moment;
--   * a team has at most one Team Leader at any moment.
-- ---------------------------------------------------------------------------
create or replace function public.referral_team_memberships_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role   text;
  v_active boolean;
  v_org    uuid;
  v_team_org uuid;
  v_team_active boolean;
  v_range  daterange;
begin
  select p.role::text, p.is_active,
         case p.role::text when 'partner' then p.referral_partner_id
                           when 'lead_referrer' then p.sourced_via_partner_id end
    into v_role, v_active, v_org
    from public.profiles p where p.id = new.profile_id;
  if v_role is null then raise exception 'Profile not found'; end if;
  if v_role not in ('partner', 'lead_referrer') then
    raise exception 'Only partner or lead-referrer profiles can belong to a team (profile is %)', v_role;
  end if;

  select t.organisation_id, t.is_active into v_team_org, v_team_active
    from public.referral_teams t where t.id = new.team_id;
  if v_team_org is null then raise exception 'Team not found'; end if;
  if tg_op = 'INSERT' and not v_team_active then
    raise exception 'Team is not active';
  end if;
  if v_org is distinct from v_team_org then
    raise exception 'Profile belongs to a different organisation than this team';
  end if;

  v_range := daterange(new.effective_from, coalesce(new.effective_to, 'infinity'::date), '[]');
  if exists (
    select 1 from public.referral_team_memberships m
     where m.profile_id = new.profile_id and m.id <> new.id
       and daterange(m.effective_from, coalesce(m.effective_to, 'infinity'::date), '[]') && v_range
  ) then
    raise exception 'Profile already has a team membership overlapping these dates';
  end if;
  if new.membership_role = 'team_leader' and exists (
    select 1 from public.referral_team_memberships m
     where m.team_id = new.team_id and m.membership_role = 'team_leader' and m.id <> new.id
       and daterange(m.effective_from, coalesce(m.effective_to, 'infinity'::date), '[]') && v_range
  ) then
    raise exception 'Team already has a Team Leader for these dates';
  end if;
  return new;
end;
$$;

drop trigger if exists referral_team_memberships_validate on public.referral_team_memberships;
create trigger referral_team_memberships_validate
  before insert or update on public.referral_team_memberships
  for each row execute function public.referral_team_memberships_validate();

-- Membership history is evidence: only the end date may move, never earlier than
-- the start, and never rewrite who/what/when.
create or replace function public.referral_team_memberships_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Team membership history cannot be deleted; end the membership instead';
  end if;
  if new.team_id is distinct from old.team_id
     or new.profile_id is distinct from old.profile_id
     or new.membership_role is distinct from old.membership_role
     or new.effective_from is distinct from old.effective_from
     or new.agreement_version_ref is distinct from old.agreement_version_ref
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Only effective_to may change on a team membership';
  end if;
  return new;
end;
$$;

drop trigger if exists referral_team_memberships_immutable on public.referral_team_memberships;
create trigger referral_team_memberships_immutable
  before update or delete on public.referral_team_memberships
  for each row execute function public.referral_team_memberships_immutable();

-- ---------------------------------------------------------------------------
-- RLS: owner full; agents see only their own organisation / team.
-- Staff roles get no direct access (they read safe projections in migration 5).
-- ---------------------------------------------------------------------------
alter table public.referral_teams enable row level security;
alter table public.referral_team_memberships enable row level security;

drop policy if exists referral_teams_owner_all on public.referral_teams;
create policy referral_teams_owner_all on public.referral_teams
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists referral_teams_member_select on public.referral_teams;
create policy referral_teams_member_select on public.referral_teams
  for select to authenticated
  using (
    id in (select public.my_team_ids())
    or (organisation_id = public.my_organisation_id()
        and exists (select 1 from public.profiles p
                     where p.id = (select auth.uid()) and p.role::text = 'partner'))
  );

drop policy if exists referral_team_memberships_owner_all on public.referral_team_memberships;
create policy referral_team_memberships_owner_all on public.referral_team_memberships
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists referral_team_memberships_scoped_select on public.referral_team_memberships;
create policy referral_team_memberships_scoped_select on public.referral_team_memberships
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or team_id in (select public.my_team_ids(true))
    or team_id in (
      select t.id from public.referral_teams t
       where t.organisation_id = public.my_organisation_id()
         and exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role::text = 'partner'))
  );

revoke all on table public.referral_teams from anon;
revoke all on table public.referral_team_memberships from anon;

-- ---------------------------------------------------------------------------
-- Owner RPCs (validated + audited). Direct owner writes remain possible through
-- the owner policies and are covered by the triggers above.
-- ---------------------------------------------------------------------------
create or replace function public.owner_create_organisation(
  p_name           text,
  p_contact_email  text default null,
  p_contact_phone  text default null,
  p_branding_config jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can create an organisation' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'Organisation name is required'; end if;
  insert into public.referral_partners (name, contact_email, contact_phone, branding_config)
  values (btrim(p_name), nullif(btrim(p_contact_email), ''), nullif(btrim(p_contact_phone), ''),
          coalesce(p_branding_config, '{}'::jsonb))
  returning id into v_id;
  perform public.staff_audit_write('organisation', v_id, 'organisation_created', null,
    jsonb_build_object('name', btrim(p_name)));
  return v_id;
end;
$$;

create or replace function public.owner_set_organisation_branding(
  p_organisation_id uuid,
  p_branding_config jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change organisation branding' using errcode = '42501';
  end if;
  update public.referral_partners
     set branding_config = coalesce(p_branding_config, '{}'::jsonb), updated_at = now()
   where id = p_organisation_id;
  if not found then raise exception 'Organisation not found'; end if;
  perform public.staff_audit_write('organisation', p_organisation_id, 'organisation_branding_changed', null,
    jsonb_build_object('keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(coalesce(p_branding_config, '{}'::jsonb)) k)));
  return p_organisation_id;
end;
$$;

create or replace function public.owner_create_team(
  p_organisation_id uuid,
  p_name            text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can create a team' using errcode = '42501';
  end if;
  if not exists (select 1 from public.referral_partners rp where rp.id = p_organisation_id and rp.is_active) then
    raise exception 'Active organisation not found';
  end if;
  insert into public.referral_teams (organisation_id, name, created_by)
  values (p_organisation_id, btrim(p_name), (select auth.uid()))
  returning id into v_id;
  perform public.staff_audit_write('team', v_id, 'team_created', null,
    jsonb_build_object('organisation_id', p_organisation_id, 'name', btrim(p_name)));
  return v_id;
end;
$$;

create or replace function public.owner_add_team_member(
  p_team_id               uuid,
  p_profile_id            uuid,
  p_membership_role       text,
  p_effective_from        date,
  p_effective_to          date default null,
  p_agreement_version_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change team membership' using errcode = '42501';
  end if;
  insert into public.referral_team_memberships
    (team_id, profile_id, membership_role, effective_from, effective_to, agreement_version_ref, created_by)
  values (p_team_id, p_profile_id, coalesce(p_membership_role, 'member'), p_effective_from, p_effective_to,
          nullif(btrim(p_agreement_version_ref), ''), (select auth.uid()))
  returning id into v_id;
  perform public.staff_audit_write('team', p_team_id, 'team_member_added', null,
    jsonb_build_object('membership_id', v_id, 'profile_id', p_profile_id, 'role', coalesce(p_membership_role, 'member'),
                       'effective_from', p_effective_from, 'effective_to', p_effective_to));
  return v_id;
end;
$$;

create or replace function public.owner_end_team_membership(
  p_membership_id uuid,
  p_effective_to  date,
  p_reason        text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change team membership' using errcode = '42501';
  end if;
  update public.referral_team_memberships
     set effective_to = p_effective_to
   where id = p_membership_id
   returning team_id into v_team;
  if v_team is null then raise exception 'Membership not found'; end if;
  perform public.staff_audit_write('team', v_team, 'team_member_ended', p_reason,
    jsonb_build_object('membership_id', p_membership_id, 'effective_to', p_effective_to));
  return p_membership_id;
end;
$$;

revoke all on function public.owner_create_organisation(text, text, text, jsonb) from public, anon;
revoke all on function public.owner_set_organisation_branding(uuid, jsonb) from public, anon;
revoke all on function public.owner_create_team(uuid, text) from public, anon;
revoke all on function public.owner_add_team_member(uuid, uuid, text, date, date, text) from public, anon;
revoke all on function public.owner_end_team_membership(uuid, date, text) from public, anon;
grant execute on function public.owner_create_organisation(text, text, text, jsonb) to authenticated;
grant execute on function public.owner_set_organisation_branding(uuid, jsonb) to authenticated;
grant execute on function public.owner_create_team(uuid, text) to authenticated;
grant execute on function public.owner_add_team_member(uuid, uuid, text, date, date, text) to authenticated;
grant execute on function public.owner_end_team_membership(uuid, date, text) to authenticated;
