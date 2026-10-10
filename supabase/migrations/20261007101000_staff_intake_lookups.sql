-- Staff build, Batch 2 (2/2): read-only lookups for the New Lead form.
--
-- Staff have no table access to organisations, teams or profiles, so the form
-- gets the minimum it needs through one role-checked projection: names and ids
-- of active organisations, teams, current members and independent agents, plus
-- active funding types. No contact details, no agreement refs, no commission.

create or replace function public.staff_intake_lookups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    'direct_agents', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', p.id, 'name', p.full_name) order by p.full_name)
        from public.profiles p
       where p.role::text = 'lead_referrer' and p.is_active
         and p.referral_partner_id is null and p.sourced_via_partner_id is null), '[]'::jsonb),
    'partner_agents', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', p.id, 'name', p.full_name,
               'organisation_id', coalesce(p.referral_partner_id, p.sourced_via_partner_id)) order by p.full_name)
        from public.profiles p
       where p.role::text in ('partner', 'lead_referrer') and p.is_active
         and coalesce(p.referral_partner_id, p.sourced_via_partner_id) is not null), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.staff_intake_lookups() from public, anon;
grant execute on function public.staff_intake_lookups() to authenticated;
