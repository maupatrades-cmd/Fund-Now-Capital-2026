-- The Office Administrator adds agents (owner, 18 Nov 2026), 2/2.
--
-- Sinah (Office Administrator) runs agent onboarding but could not add a new agent: only the Director (and the Field
-- Supervisor, for field consultants) could create accounts. The invite stays in the admin-invite-user Edge Function;
-- these helpers let it decide WHO may invite from the database, never from the request body:
--   * staff_inviter_role(): now also 'administrator' for an Office Administrator with enabled staff access. The Edge
--     Function lets the Administrator invite ONLY agents (Direct agent = contractor, Team Leader = partner, Sub-agent =
--     lead_referrer under a Team Leader), by emailed sign-in link only — never a staff role, never a password.
--     The owner and field_supervisor branches are unchanged (copied from the live definition, 20261118110100).
--   * agent_added_notify(profile): called by the Edge Function (as the Administrator) after creating the account; tells
--     the Director and writes the staff audit trail.
--   * staff_team_leader_options(): active Team Leaders (id + name only) for the Sub-agent picker. referral_partners is
--     owner-only under RLS, so the Administrator reads this list through here.

create or replace function public.staff_inviter_role()
returns text
language sql stable security definer set search_path = '' as $$
  select case when coalesce(public.is_owner(), false) then 'owner'
              when coalesce(public.staff_role_of() = 'field_supervisor', false) then 'field_supervisor'
              when coalesce(public.staff_role_of() = 'administrator', false) then 'administrator'
         end;
$$;
revoke all on function public.staff_inviter_role() from public, anon;
grant execute on function public.staff_inviter_role() to authenticated;

create or replace function public.agent_added_notify(p_profile uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_inviter text := public.staff_inviter_role(); v_name text; v_role text; v_by text; v_to uuid; v_count integer := 0;
begin
  if v_inviter is null or v_inviter not in ('owner', 'administrator') then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(p.full_name), ''), p.email), p.role::text into v_name, v_role
    from public.profiles p where p.id = p_profile and p.role::text in ('partner', 'contractor', 'lead_referrer');
  if v_name is null then raise exception 'Agent not found'; end if;
  select coalesce(nullif(btrim(p.full_name), ''), p.email) into v_by from public.profiles p where p.id = (select auth.uid());

  for v_to in select p.id from public.profiles p where p.role::text = 'owner' and p.is_active loop
    continue when v_to = (select auth.uid());
    perform public.staff_notify(v_to, 'AGENT_ADDED', 'New agent: ' || v_name,
      coalesce(v_by, 'The Office Administrator') || ' added ' || v_name || ' as '
        || case v_role when 'partner' then 'a Team Leader' when 'contractor' then 'a Direct agent' else 'a Sub-agent' end
        || '. Their onboarding checklist is open on the Onboarding page.',
      '/staff/agents/' || p_profile::text, jsonb_build_object('profile_id', p_profile));
    v_count := v_count + 1;
  end loop;
  perform public.staff_audit_write('profile', p_profile, 'agent_added', null,
    jsonb_build_object('invited_by_role', v_inviter, 'agent_role', v_role, 'notified', v_count));
  return v_count;
end;
$$;
revoke all on function public.agent_added_notify(uuid) from public, anon;
grant execute on function public.agent_added_notify(uuid) to authenticated;

create or replace function public.staff_team_leader_options()
returns table (id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.staff_inviter_role(), '') not in ('owner', 'administrator') then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query select r.id, r.name from public.referral_partners r where r.is_active order by r.name;
end;
$$;
revoke all on function public.staff_team_leader_options() from public, anon;
grant execute on function public.staff_team_leader_options() to authenticated;
