-- Lead agents follow-up (owner, 19 Nov 2026): a sale can be credited to a field consultant whether or not they use the
-- CRM. 20261119091000 required enabled staff access, so only the Field Supervisor (the one field person with access
-- switched on) could be picked. The field person now only has to be an ACTIVE profile with the field_consultant or
-- field_supervisor role. Copied from 20261119091000; only the staff_access join is removed.

create or replace function public.intake_validate_field(p_profile uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_name text; v_role text;
begin
  if p_profile is null then raise exception 'Choose the field consultant the sale is for'; end if;
  select coalesce(nullif(btrim(p.full_name), ''), p.email), p.role::text into v_name, v_role
    from public.profiles p
   where p.id = p_profile and p.is_active and p.role::text in ('field_consultant', 'field_supervisor');
  if v_name is null then raise exception 'Choose an active field consultant or Field Supervisor'; end if;
  return jsonb_build_object('field_agent_id', p_profile, 'field_agent_name', v_name, 'field_agent_role', v_role);
end;
$$;
revoke all on function public.intake_validate_field(uuid) from public, anon, authenticated;

-- 6. Lookups (+ contractors, field team) --------------------------------------------------------------------------------
create or replace function public.staff_intake_lookups()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  return jsonb_build_object(
    'funding_types', coalesce((
      select jsonb_agg(jsonb_build_object('code', f.code, 'label', f.display_name) order by f.display_name)
        from public.funding_product_catalog f where f.is_active), '[]'::jsonb),
    'organisations', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.name)
        from public.referral_partners o where o.is_active), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'organisation_id', t.organisation_id) order by t.name)
        from public.referral_teams t where t.is_active), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id', m.profile_id, 'name', p.full_name, 'team_id', m.team_id,
               'membership_role', m.membership_role) order by p.full_name)
        from public.referral_team_memberships m
        join public.profiles p on p.id = m.profile_id and p.is_active
       where m.effective_from <= public.current_sast_date()
         and (m.effective_to is null or m.effective_to >= public.current_sast_date())), '[]'::jsonb),
    -- Independent agents: lead-referrers and contractors ("Direct agent") with no organisation. A contractor with no
    -- name on file shows by email so it can still be chosen.
    'direct_agents', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', p.id, 'name', coalesce(nullif(btrim(p.full_name), ''), p.email),
               'role', p.role::text) order by coalesce(nullif(btrim(p.full_name), ''), p.email))
        from public.profiles p
       where p.role::text in ('lead_referrer', 'contractor') and p.is_active
         and p.referral_partner_id is null and p.sourced_via_partner_id is null), '[]'::jsonb),
    'partner_agents', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', p.id, 'name', p.full_name,
               'organisation_id', coalesce(p.referral_partner_id, p.sourced_via_partner_id)) order by p.full_name)
        from public.profiles p
       where p.role::text in ('partner', 'lead_referrer') and p.is_active
         and coalesce(p.referral_partner_id, p.sourced_via_partner_id) is not null), '[]'::jsonb),
    -- Fund Now Capital people (the Director and staff with enabled access): name and role only.
    'fnc_people', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', p.id, 'name', coalesce(nullif(btrim(p.full_name), ''), p.email),
               'role', p.role::text) order by coalesce(nullif(btrim(p.full_name), ''), p.email))
        from public.profiles p
       where p.is_active
         and (p.role::text = 'owner'
              or exists (select 1 from public.staff_access s
                          where s.profile_id = p.id and s.access_enabled and s.staff_role = p.role))), '[]'::jsonb),
    -- The field team: every active field consultant and the Field Supervisor (CRM access not needed).
    'field_team', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', p.id, 'name', coalesce(nullif(btrim(p.full_name), ''), p.email),
               'role', p.role::text) order by coalesce(nullif(btrim(p.full_name), ''), p.email))
        from public.profiles p
       where p.is_active and p.role::text in ('field_consultant', 'field_supervisor')), '[]'::jsonb),
    'fnc_offices', coalesce((
      select jsonb_agg(jsonb_build_object('code', o.code, 'label', o.label) order by o.label)
        from public.fnc_offices o where o.is_active), '[]'::jsonb)
  );
end;
$function$;

