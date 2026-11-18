-- Field Supervisor adds field agents (owner, 17 Nov 2026), 2/2.
--
-- The invite itself stays in the admin-invite-user Edge Function. These two helpers let it decide WHO may invite from
-- the database, never from the request body:
--   * staff_inviter_role(): 'owner' for the Director, 'field_supervisor' for a Field Supervisor with enabled staff
--     access, otherwise null. The Edge Function lets the owner invite any role (unchanged) and a Field Supervisor
--     invite ONLY field consultants.
--   * field_agent_added_notify(profile): called by the Edge Function (as the Field Supervisor) after creating the
--     account. The new consultant's staff access is NOT switched on automatically: owner_set_staff_access is
--     Director-only, so the Director is asked to switch it on, and the Office Administrators are told for awareness.

create or replace function public.staff_inviter_role()
returns text
language sql stable security definer set search_path = '' as $$
  select case when coalesce(public.is_owner(), false) then 'owner'
              when coalesce(public.staff_role_of() = 'field_supervisor', false) then 'field_supervisor'
         end;
$$;
revoke all on function public.staff_inviter_role() from public, anon;
grant execute on function public.staff_inviter_role() to authenticated;

create or replace function public.field_agent_added_notify(p_profile uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_inviter text := public.staff_inviter_role(); v_name text; v_by text; v_to uuid; v_count integer := 0;
begin
  if v_inviter is null then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(p.full_name), ''), p.email) into v_name
    from public.profiles p where p.id = p_profile and p.role::text = 'field_consultant';
  if v_name is null then raise exception 'Field agent not found'; end if;
  select coalesce(nullif(btrim(p.full_name), ''), p.email) into v_by from public.profiles p where p.id = (select auth.uid());

  for v_to in
    select p.id from public.profiles p where p.role::text = 'owner' and p.is_active
    union
    select p.id from public.profiles p join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
     where p.role::text = 'administrator' and p.is_active and s.access_enabled
  loop
    continue when v_to = (select auth.uid());
    perform public.staff_notify(v_to, 'FIELD_AGENT_ADDED', 'New field agent: ' || v_name,
      coalesce(v_by, 'The Field Supervisor') || ' added ' || v_name
        || ' as a field agent. The Director switches on their staff access on the Team page before they can work.',
      '/team', jsonb_build_object('profile_id', p_profile));
    v_count := v_count + 1;
  end loop;
  perform public.staff_audit_write('profile', p_profile, 'field_agent_added', null,
    jsonb_build_object('invited_by_role', v_inviter, 'notified', v_count));
  return v_count;
end;
$$;
revoke all on function public.field_agent_added_notify(uuid) from public, anon;
grant execute on function public.field_agent_added_notify(uuid) to authenticated;
