-- Staff build, Batch 1 (2/5): staff access gate + append-only staff audit trail.
--
-- * staff_access: one row per staff profile. A switchboard/coordinator role does
--   nothing until the OWNER enables the person here (contract/start-date checks
--   happen outside the system; `contract_reference` stores a document code only,
--   never salary, ID or signature data).
-- * staff_audit_events: one append-only ledger for every staff-build action
--   (workflow transitions, org/team changes, access changes, receipts). Rows can
--   never be updated, deleted or truncated.
-- * Helpers: staff_role_of(), staff_actor_role().
-- * profiles guard: a direct client write cannot change role / is_active, and a
--   role change away from a staff role switches staff access off.

-- ---------------------------------------------------------------------------
-- staff_access
-- ---------------------------------------------------------------------------
create table if not exists public.staff_access (
  profile_id         uuid primary key references public.profiles(id) on delete cascade,
  staff_role         public.user_role not null,
  access_enabled     boolean not null default false,
  contract_reference text,
  activation_note    text,
  enabled_by         uuid references public.profiles(id) on delete set null,
  enabled_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint staff_access_role_ck check (staff_role::text in ('switchboard', 'coordinator')),
  constraint staff_access_contract_ref_len_ck
    check (contract_reference is null or length(contract_reference) <= 80)
);

alter table public.staff_access enable row level security;

drop policy if exists staff_access_owner_all on public.staff_access;
create policy staff_access_owner_all on public.staff_access
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- A staff member may see whether their own access is on (drives the
-- "waiting for the owner to activate your account" screen).
drop policy if exists staff_access_select_own on public.staff_access;
create policy staff_access_select_own on public.staff_access
  for select to authenticated
  using (profile_id = (select auth.uid()));

revoke all on table public.staff_access from anon;

create or replace function public.staff_access_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
begin
  -- Switching access OFF must always work (a role change does exactly that);
  -- creating or enabling a row requires the profile to hold the matching role.
  if tg_op = 'INSERT' or new.access_enabled then
    select p.role::text into v_role from public.profiles p where p.id = new.profile_id;
    if v_role is distinct from new.staff_role::text then
      raise exception 'staff_access.staff_role must match the profile role (profile is %)', coalesce(v_role, 'missing');
    end if;
  end if;
  if new.access_enabled and (tg_op = 'INSERT' or old.access_enabled is distinct from true) then
    new.enabled_by := (select auth.uid());
    new.enabled_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists staff_access_validate on public.staff_access;
create trigger staff_access_validate
  before insert or update on public.staff_access
  for each row execute function public.staff_access_validate();

-- ---------------------------------------------------------------------------
-- Role helpers. A caller is "active staff" only when the profile is active,
-- holds a staff role, and the owner has enabled the matching staff_access row.
-- ---------------------------------------------------------------------------
create or replace function public.staff_role_of()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role::text
    from public.profiles p
    join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
   where p.id = (select auth.uid())
     and p.is_active
     and s.access_enabled
     and p.role::text in ('switchboard', 'coordinator');
$$;

-- 'owner' | 'coordinator' | 'switchboard' | null (no operational authority).
create or replace function public.staff_actor_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_owner() then 'owner' else public.staff_role_of() end;
$$;

revoke all on function public.staff_role_of() from public, anon;
revoke all on function public.staff_actor_role() from public, anon;
grant execute on function public.staff_role_of() to authenticated;
grant execute on function public.staff_actor_role() to authenticated;

-- ---------------------------------------------------------------------------
-- staff_audit_events — append-only
-- ---------------------------------------------------------------------------
create table if not exists public.staff_audit_events (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  entity_type text not null,
  entity_id   uuid,
  event_type  text not null,
  actor_id    uuid,
  actor_role  text,
  reason      text,
  detail      jsonb not null default '{}'::jsonb
);

create index if not exists staff_audit_events_entity_idx
  on public.staff_audit_events (entity_type, entity_id, id);

alter table public.staff_audit_events enable row level security;

drop policy if exists staff_audit_events_owner_select on public.staff_audit_events;
create policy staff_audit_events_owner_select on public.staff_audit_events
  for select to authenticated
  using (public.is_owner());

revoke all on table public.staff_audit_events from anon, authenticated;
grant select on table public.staff_audit_events to authenticated;

create or replace function public.staff_audit_block_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'staff_audit_events is append-only: corrections are new events';
end;
$$;

drop trigger if exists staff_audit_no_update_delete on public.staff_audit_events;
create trigger staff_audit_no_update_delete
  before update or delete on public.staff_audit_events
  for each row execute function public.staff_audit_block_rewrite();

drop trigger if exists staff_audit_no_truncate on public.staff_audit_events;
create trigger staff_audit_no_truncate
  before truncate on public.staff_audit_events
  for each statement execute function public.staff_audit_block_rewrite();

-- Internal writer. Not callable by clients; only other SECURITY DEFINER
-- functions in this build use it.
create or replace function public.staff_audit_write(
  p_entity_type text,
  p_entity_id   uuid,
  p_event_type  text,
  p_reason      text default null,
  p_detail      jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.staff_audit_events (entity_type, entity_id, event_type, actor_id, actor_role, reason, detail)
  values (p_entity_type, p_entity_id, p_event_type, (select auth.uid()), public.staff_actor_role(),
          p_reason, coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.staff_audit_write(text, uuid, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Owner provisioning RPC. Role assignment itself reuses admin_update_user_role /
-- admin-invite-user; this only switches the operational access on or off.
-- ---------------------------------------------------------------------------
create or replace function public.owner_set_staff_access(
  p_profile_id         uuid,
  p_enabled            boolean,
  p_contract_reference text default null,
  p_note               text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can enable or disable staff access' using errcode = '42501';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = p_profile_id;
  if v_role is null then raise exception 'Profile not found'; end if;
  if v_role not in ('switchboard', 'coordinator') then
    raise exception 'Profile is not a staff role (assign switchboard or coordinator first)';
  end if;

  insert into public.staff_access (profile_id, staff_role, access_enabled, contract_reference, activation_note)
  values (p_profile_id, v_role::public.user_role, coalesce(p_enabled, false),
          nullif(btrim(p_contract_reference), ''), nullif(btrim(p_note), ''))
  on conflict (profile_id) do update
    set access_enabled     = excluded.access_enabled,
        contract_reference = coalesce(excluded.contract_reference, public.staff_access.contract_reference),
        activation_note    = coalesce(excluded.activation_note, public.staff_access.activation_note);

  perform public.staff_audit_write(
    'staff_access', p_profile_id,
    case when coalesce(p_enabled, false) then 'staff_access_enabled' else 'staff_access_disabled' end,
    p_note,
    jsonb_build_object('staff_role', v_role, 'contract_reference', nullif(btrim(p_contract_reference), '')));
  return p_profile_id;
end;
$$;

revoke all on function public.owner_set_staff_access(uuid, boolean, text, text) from public, anon;
grant execute on function public.owner_set_staff_access(uuid, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- profiles guards (defense in depth — RLS already gives non-owners no UPDATE).
-- current_user is the session role for direct client statements and the function
-- owner inside SECURITY DEFINER code, so this only stops raw client writes.
-- ---------------------------------------------------------------------------
create or replace function public.profiles_privileged_change_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and not public.is_owner()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'Only the owner can change a role or active status' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_privileged_change_guard on public.profiles;
create trigger profiles_privileged_change_guard
  before update of role, is_active on public.profiles
  for each row execute function public.profiles_privileged_change_guard();

-- A role change always revokes operational staff access; the owner re-enables
-- it deliberately after the change.
create or replace function public.profiles_role_change_disable_staff_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    update public.staff_access
       set access_enabled = false
     where profile_id = new.id and access_enabled and staff_role is distinct from new.role;
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_role_change_disable_staff_access on public.profiles;
create trigger profiles_role_change_disable_staff_access
  after update of role on public.profiles
  for each row execute function public.profiles_role_change_disable_staff_access();
