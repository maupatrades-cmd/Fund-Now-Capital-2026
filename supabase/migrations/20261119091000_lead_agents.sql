-- Lead agents (owner, 19 Nov 2026), 2/4: "Koketso is trying to capture who the sale is for; she can't add any other
-- consultant, even if they are not under Bright Destiny."
--
--   * Direct agent channel: a contractor (the "Direct agent" of agent onboarding: an independent agent with no
--     organisation) can now be chosen, as well as an independent lead-referrer. The R100 on Verified already pays a
--     contractor (r100_create_for_verified accepts partner / contractor / lead_referrer); commission records do not read
--     the intake's agent, so nothing else changes for money.
--   * New 'field' channel ("Fund Now Capital field team"): the sale is for a field consultant or the Field Supervisor,
--     stored in submission_intakes.field_agent_id (an active profile with that role and enabled staff access). A field
--     lead carries no agent, organisation or team. The 2.3% / 2% field commission (launch plan, 30 Oct) has NO engine in
--     the database yet, so this records the attribution only; nothing is paid from it.
--
-- Copied from 20261118171000 (applied 19 Nov and checked against live), changed only as above: submission_intakes_guard,
-- intake_validate_channel, staff_register_intake (one more defaulted parameter, p_field_agent_id), staff_intake_lookups
-- (contractors among direct_agents; new field_team list), staff_intake_queue (source label also for field leads), and
-- owner_correct_intake_attribution (can now move a lead INTO field with a validated field person, e.g. leads captured
-- as in-house -> employee as a workaround; INTO in-house stays refused; every correction clears the old channel's details).
-- staff_intake_detail (live) gains source_label.
--
-- submission_intakes holds rows: the new foreign key and checks are added NOT VALID here; the index is built
-- CONCURRENTLY in 20261119092000 and they are validated in 20261119093000.

-- 1. The field person on the intake -------------------------------------------------------------------------------------
alter table public.submission_intakes add column if not exists field_agent_id uuid;
alter table public.submission_intakes drop constraint if exists submission_intakes_field_agent_fk;
alter table public.submission_intakes add constraint submission_intakes_field_agent_fk
  foreign key (field_agent_id) references public.profiles(id) on delete restrict not valid;

-- The channel shape gains a field branch: no organisation, team or Team Leader.
alter table public.submission_intakes drop constraint if exists submission_intakes_channel_shape_ck;
alter table public.submission_intakes add constraint submission_intakes_channel_shape_ck check (
     (channel = 'direct_agent' and organisation_id is null and team_id is null and team_leader_profile_id is null)
  or (channel = 'team' and organisation_id is not null and team_id is not null and team_leader_profile_id is not null)
  or (channel = 'referral_partner' and organisation_id is not null and team_id is null and team_leader_profile_id is null)
  or (channel = 'inhouse' and organisation_id is null and team_id is null and team_leader_profile_id is null)
  or (channel = 'field' and organisation_id is null and team_id is null and team_leader_profile_id is null)) not valid;

-- A field intake has the field person and no agent; every other channel has no field person.
alter table public.submission_intakes drop constraint if exists submission_intakes_field_shape_ck;
alter table public.submission_intakes add constraint submission_intakes_field_shape_ck check (
     (channel = 'field' and field_agent_id is not null and agent_profile_id is null)
  or (channel <> 'field' and field_agent_id is null)) not valid;

-- 2. Field person check and the readable source ----------------------------------------------------------------------------
create or replace function public.intake_validate_field(p_profile uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_name text; v_role text;
begin
  if p_profile is null then raise exception 'Choose the field consultant the sale is for'; end if;
  select coalesce(nullif(btrim(p.full_name), ''), p.email), p.role::text into v_name, v_role
    from public.profiles p
    join public.staff_access s on s.profile_id = p.id and s.access_enabled and s.staff_role = p.role
   where p.id = p_profile and p.is_active and p.role::text in ('field_consultant', 'field_supervisor');
  if v_name is null then raise exception 'Choose an active field consultant or Field Supervisor'; end if;
  return jsonb_build_object('field_agent_id', p_profile, 'field_agent_name', v_name, 'field_agent_role', v_role);
end;
$$;
revoke all on function public.intake_validate_field(uuid) from public, anon, authenticated;

-- One readable source for screens: in-house as before, "Field team — <name>" for field leads, otherwise null.
create or replace function public.intake_source_label(p_channel public.submission_channel, p_kind text, p_staff uuid,
  p_office text, p_name text, p_field_agent uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_channel = 'inhouse' then public.intake_inhouse_label(p_kind, p_staff, p_office, p_name)
    when p_channel = 'field' then 'Field team — ' || coalesce((select coalesce(nullif(btrim(p.full_name), ''), p.email)
                                                               from public.profiles p where p.id = p_field_agent), 'field consultant')
  end;
$$;
revoke all on function public.intake_source_label(public.submission_channel, text, uuid, text, text, uuid) from public, anon, authenticated;

-- 3. Attribution stays fixed at registration (+ field_agent_id) --------------------------------------------------------
create or replace function public.submission_intakes_guard()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare
  v_transition  boolean := coalesce(current_setting('fnc.intake_transition', true), '') = 'on';
  v_attribution boolean := coalesce(current_setting('fnc.intake_attribution_correction', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    raise exception 'Submission intakes cannot be deleted; archive instead';
  end if;

  if tg_op = 'INSERT' then
    new.first_complete_at := null;
    new.first_complete_by := null;
    new.registered_at := now();
    new.workflow_status := 'new';
    new.archived_at := null;
    return new;
  end if;

  if new.lead_id is distinct from old.lead_id
     or new.registered_at is distinct from old.registered_at
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'Registration facts of a submission intake are immutable';
  end if;

  if (new.channel is distinct from old.channel
      or new.organisation_id is distinct from old.organisation_id
      or new.team_id is distinct from old.team_id
      or new.team_leader_profile_id is distinct from old.team_leader_profile_id
      or new.agent_profile_id is distinct from old.agent_profile_id
      or new.claimed_agent_reference is distinct from old.claimed_agent_reference
      or new.affiliation_snapshot is distinct from old.affiliation_snapshot
      or new.funding_type is distinct from old.funding_type
      or new.inhouse_kind is distinct from old.inhouse_kind
      or new.inhouse_staff_id is distinct from old.inhouse_staff_id
      or new.inhouse_office_code is distinct from old.inhouse_office_code
      or new.inhouse_referrer_name is distinct from old.inhouse_referrer_name
      or new.field_agent_id is distinct from old.field_agent_id)
     and not v_attribution then
    raise exception 'Attribution is fixed at registration; the Owner corrects it through the audited correction RPC';
  end if;

  if (new.workflow_status is distinct from old.workflow_status
      or new.archived_at is distinct from old.archived_at
      or new.archived_by is distinct from old.archived_by
      or new.archive_reason_code is distinct from old.archive_reason_code
      or new.archive_reason is distinct from old.archive_reason)
     and not v_transition then
    raise exception 'Workflow status changes only through the staff workflow RPCs';
  end if;

  if old.first_complete_at is not null
     and (new.first_complete_at is distinct from old.first_complete_at
          or new.first_complete_by is distinct from old.first_complete_by) then
    raise exception 'The first Complete timestamp is protected and cannot change';
  end if;

  if old.first_complete_at is null then
    if new.workflow_status = 'complete' and old.workflow_status is distinct from 'complete' then
      new.first_complete_at := now();
      new.first_complete_by := (select auth.uid());
    elsif new.first_complete_at is not null or new.first_complete_by is not null then
      raise exception 'first_complete_at is server-generated on the first Complete transition';
    end if;
  end if;
  return new;
end;
$function$;

-- 4. Channel validation (+ field; contractors as direct agents) ------------------------------------------------------
create or replace function public.intake_validate_channel(p_channel public.submission_channel, p_organisation_id uuid, p_team_id uuid, p_agent_profile_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_today       date := public.current_sast_date();
  v_org         uuid;
  v_org_name    text;
  v_org_active  boolean;
  v_team        public.referral_teams;
  v_leader      uuid;
  v_leader_mem  uuid;
  v_leader_ref  text;
  v_agent       public.profiles;
  v_agent_org   uuid;
  v_agent_ref   text;
begin
  if p_channel = 'direct_agent' then
    if p_organisation_id is not null or p_team_id is not null then
      raise exception 'A direct-agent submission cannot carry an organisation or team';
    end if;
  elsif p_channel = 'inhouse' then
    -- Fund Now Capital itself: never an agent, organisation or team (nobody outside FNC is credited).
    if p_organisation_id is not null or p_team_id is not null or p_agent_profile_id is not null then
      raise exception 'A Fund Now Capital (in-house) lead cannot carry an agent, organisation or team';
    end if;
  elsif p_channel = 'field' then
    -- The Fund Now Capital field team: the field person is stored in field_agent_id (validated by
    -- intake_validate_field), never as an agent, organisation or team.
    if p_organisation_id is not null or p_team_id is not null or p_agent_profile_id is not null then
      raise exception 'A field team lead cannot carry an agent, organisation or team';
    end if;
  elsif p_channel = 'team' then
    if p_team_id is null then raise exception 'A team submission needs a team'; end if;
    select * into v_team from public.referral_teams t where t.id = p_team_id;
    if not found or not v_team.is_active then raise exception 'Active team not found'; end if;
    if p_organisation_id is not null and p_organisation_id <> v_team.organisation_id then
      raise exception 'That team does not belong to the stated organisation';
    end if;
    v_org := v_team.organisation_id;
    select m.profile_id, m.id, m.agreement_version_ref into v_leader, v_leader_mem, v_leader_ref
      from public.referral_team_memberships m
     where m.team_id = p_team_id and m.membership_role = 'team_leader'
       and m.effective_from <= v_today and (m.effective_to is null or m.effective_to >= v_today)
     limit 1;
    if v_leader is null then raise exception 'That team has no active Team Leader'; end if;
  else
    if p_organisation_id is null then raise exception 'A referral-partner submission needs an organisation'; end if;
    if p_team_id is not null then raise exception 'A referral-partner submission cannot carry a team'; end if;
    v_org := p_organisation_id;
  end if;

  if v_org is not null then
    select rp.name, rp.is_active into v_org_name, v_org_active from public.referral_partners rp where rp.id = v_org;
    if not found or not v_org_active then raise exception 'Active organisation not found'; end if;
  end if;

  if p_agent_profile_id is not null then
    select * into v_agent from public.profiles p where p.id = p_agent_profile_id;
    if not found or not v_agent.is_active then raise exception 'Active agent not found'; end if;
    if v_agent.role::text not in ('lead_referrer', 'partner', 'contractor') then
      raise exception 'The agent must be a partner, lead-referrer or direct agent (contractor) profile';
    end if;
    v_agent_org := case v_agent.role::text
                     when 'partner' then v_agent.referral_partner_id
                     when 'contractor' then coalesce(v_agent.referral_partner_id, v_agent.sourced_via_partner_id)
                     else v_agent.sourced_via_partner_id end;
    -- A contractor ("Direct agent" in onboarding) is an independent agent: only on the direct-agent channel (19 Nov).
    if v_agent.role::text = 'contractor' and p_channel <> 'direct_agent' then
      raise exception 'A direct agent (contractor) is captured on the Direct agent channel';
    end if;
    if p_channel = 'direct_agent' then
      if v_agent.role::text not in ('lead_referrer', 'contractor') or v_agent_org is not null then
        raise exception 'A direct agent must be an independent lead-referrer or contractor with no organisation';
      end if;
    elsif p_channel = 'team' then
      if not public.intake_membership_active(p_team_id, p_agent_profile_id) then
        raise exception 'That agent is not an active member of the team';
      end if;
      select m.agreement_version_ref into v_agent_ref
        from public.referral_team_memberships m
       where m.team_id = p_team_id and m.profile_id = p_agent_profile_id
         and m.effective_from <= v_today and (m.effective_to is null or m.effective_to >= v_today)
       limit 1;
    else
      if v_agent_org is distinct from v_org then
        raise exception 'That agent does not belong to the stated organisation';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'channel', p_channel,
    'organisation_id', v_org,
    'organisation_name', v_org_name,
    'team_id', p_team_id,
    'team_name', v_team.name,
    'team_leader_profile_id', v_leader,
    'team_leader_membership_id', v_leader_mem,
    'team_leader_agreement_version_ref', v_leader_ref,
    'agent_profile_id', p_agent_profile_id,
    'agent_agreement_version_ref', v_agent_ref,
    'captured_on', v_today);
end;
$function$;

-- 5. Registration (+ p_field_agent_id) ----------------------------------------------------------------------------------
drop function if exists public.staff_register_intake(text, text, text, text, text, text, numeric, text,
  public.submission_channel, uuid, uuid, uuid, text, text, text, uuid, text, text);
create or replace function public.staff_register_intake(p_business_name text, p_contact_name text, p_contact_cell text, p_contact_email text, p_cipc_number text, p_funding_type text, p_funding_amount numeric, p_funding_purpose text, p_channel public.submission_channel, p_organisation_id uuid, p_team_id uuid, p_agent_profile_id uuid, p_claimed_agent_reference text, p_idempotency_key text,
  p_inhouse_kind text default null, p_inhouse_staff_id uuid default null, p_inhouse_office_code text default null,
  p_inhouse_referrer_name text default null, p_field_agent_id uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid       uuid := (select auth.uid());
  v_role      text;
  v_existing  public.submission_intakes;
  v_snapshot  jsonb;
  v_lead_id   uuid;
  v_cipc      text := nullif(btrim(p_cipc_number), '');
  v_conflict  boolean := false;
  v_flag_new  boolean := false;
  v_flags     jsonb;
  m           record;
  v_inhouse   jsonb;
  v_ref_name  text := nullif(btrim(coalesce(p_inhouse_referrer_name, '')), '');
  v_field     jsonb;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);

  if nullif(btrim(p_business_name), '') is null then raise exception 'Business name is required'; end if;
  if nullif(btrim(p_contact_name), '') is null then raise exception 'Contact name is required'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 100 then
    raise exception 'A client-generated idempotency key (8-100 characters) is required';
  end if;
  if p_funding_amount is not null and p_funding_amount < 0 then raise exception 'Requested amount cannot be negative'; end if;
  if not exists (select 1 from public.funding_product_catalog f where f.code = p_funding_type and f.is_active) then
    raise exception 'Unknown or inactive funding type';
  end if;

  select * into v_existing from public.submission_intakes si
   where si.created_by = v_uid and si.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', 'existing', 'lead_id', v_existing.lead_id, 'created', false);
  end if;

  v_snapshot := public.intake_validate_channel(p_channel, p_organisation_id, p_team_id, p_agent_profile_id);
  if p_channel = 'inhouse' then
    v_inhouse := public.intake_validate_inhouse(p_inhouse_kind, p_inhouse_staff_id, p_inhouse_office_code, v_ref_name);
    v_snapshot := v_snapshot || v_inhouse;
  elsif p_inhouse_kind is not null or p_inhouse_staff_id is not null or p_inhouse_office_code is not null
        or v_ref_name is not null then
    raise exception 'Only a Fund Now Capital (in-house) lead carries an in-house source';
  end if;
  if p_channel = 'field' then
    v_field := public.intake_validate_field(p_field_agent_id);
    v_snapshot := v_snapshot || v_field;
  elsif p_field_agent_id is not null then
    raise exception 'Only a field team lead carries a field consultant';
  end if;

  for m in select * from public.intake_duplicate_matches(p_business_name, v_cipc, p_contact_email, p_contact_cell)
            where flag_kind = 'registration_conflict' loop
    v_conflict := true;
    if not exists (select 1 from public.intake_review_flags f
                    where f.status = 'open' and f.flag_kind = 'registration_conflict' and f.raised_by = v_uid
                      and f.attempted_cipc = v_cipc
                      and f.existing_lead_id is not distinct from m.existing_lead_id
                      and f.existing_client_id is not distinct from m.existing_client_id) then
      insert into public.intake_review_flags
        (flag_kind, existing_lead_id, existing_client_id, attempted_business_name, attempted_cipc, attempted_channel,
         attempted_organisation_id, attempted_team_id, attempted_agent_profile_id, claimed_agent_reference, raised_by)
      values ('registration_conflict', m.existing_lead_id, m.existing_client_id, btrim(p_business_name), v_cipc, p_channel,
              (v_snapshot ->> 'organisation_id')::uuid, p_team_id, p_agent_profile_id,
              nullif(btrim(p_claimed_agent_reference), ''), v_uid);
      v_flag_new := true;
    end if;
  end loop;
  if v_conflict then
    perform public.staff_audit_write('submission_intake', null, 'registration_conflict_flagged', null,
      jsonb_build_object('new_flag', v_flag_new, 'channel', p_channel));
    return jsonb_build_object('status', 'registration_conflict_flagged', 'lead_id', null, 'created', false,
                              'flags', jsonb_build_object('registration_conflict', true));
  end if;

  insert into public.leads
    (business_name, contact_name, contact_cell, contact_email, cipc_number, funding_amount, funding_purpose, entered_by)
  values (btrim(p_business_name), btrim(p_contact_name), nullif(btrim(p_contact_cell), ''),
          nullif(btrim(p_contact_email), ''), v_cipc, p_funding_amount,
          case when nullif(btrim(p_funding_purpose), '') is null then '[]'::jsonb
               else to_jsonb(array[btrim(p_funding_purpose)]) end,
          v_uid)
  returning id into v_lead_id;

  insert into public.submission_intakes
    (lead_id, channel, organisation_id, team_id, team_leader_profile_id, agent_profile_id,
     claimed_agent_reference, funding_type, affiliation_snapshot, created_by, idempotency_key,
     inhouse_kind, inhouse_staff_id, inhouse_office_code, inhouse_referrer_name, field_agent_id)
  values (v_lead_id, p_channel, (v_snapshot ->> 'organisation_id')::uuid, p_team_id,
          (v_snapshot ->> 'team_leader_profile_id')::uuid, p_agent_profile_id,
          nullif(btrim(p_claimed_agent_reference), ''), p_funding_type, v_snapshot, v_uid, p_idempotency_key,
          case when p_channel = 'inhouse' then p_inhouse_kind end,
          case when p_channel = 'inhouse' and p_inhouse_kind = 'employee' then p_inhouse_staff_id end,
          case when p_channel = 'inhouse' and p_inhouse_kind = 'office' then p_inhouse_office_code end,
          case when p_channel = 'inhouse' and p_inhouse_kind = 'online' then v_ref_name end,
          case when p_channel = 'field' then p_field_agent_id end);

  for m in select distinct on (flag_kind, existing_lead_id)
                  flag_kind, existing_lead_id, existing_client_id
             from public.intake_duplicate_matches(p_business_name, v_cipc, p_contact_email, p_contact_cell)
            where flag_kind <> 'registration_conflict' and existing_lead_id is distinct from v_lead_id loop
    insert into public.intake_review_flags
      (flag_kind, existing_lead_id, existing_client_id, lead_id, attempted_business_name, attempted_cipc,
       attempted_channel, attempted_organisation_id, attempted_team_id, attempted_agent_profile_id,
       claimed_agent_reference, raised_by)
    values (m.flag_kind, m.existing_lead_id, m.existing_client_id, v_lead_id, btrim(p_business_name), v_cipc,
            p_channel, (v_snapshot ->> 'organisation_id')::uuid, p_team_id, p_agent_profile_id,
            nullif(btrim(p_claimed_agent_reference), ''), v_uid);
  end loop;

  select jsonb_build_object(
           'recent_submission', coalesce(bool_or(f.flag_kind = 'recent_submission'), false),
           'duplicate_contact', coalesce(bool_or(f.flag_kind = 'duplicate_contact'), false))
    into v_flags
    from public.intake_review_flags f where f.lead_id = v_lead_id;

  perform public.staff_audit_write('submission_intake', v_lead_id, 'registered', null,
    jsonb_build_object('channel', p_channel, 'organisation_id', v_snapshot -> 'organisation_id',
                       'team_id', p_team_id, 'agent_profile_id', p_agent_profile_id,
                       'claimed_agent_reference_given', nullif(btrim(p_claimed_agent_reference), '') is not null,
                       'funding_type', p_funding_type,
                       'inhouse_kind', v_inhouse -> 'inhouse_kind', 'inhouse_label', v_inhouse -> 'inhouse_label',
                       'field_agent_id', v_field -> 'field_agent_id'));

  return jsonb_build_object('status', 'created', 'lead_id', v_lead_id, 'created', true, 'flags', v_flags);
end;
$function$;
revoke all on function public.staff_register_intake(text, text, text, text, text, text, numeric, text,
  public.submission_channel, uuid, uuid, uuid, text, text, text, uuid, text, text, uuid) from public, anon;
grant execute on function public.staff_register_intake(text, text, text, text, text, text, numeric, text,
  public.submission_channel, uuid, uuid, uuid, text, text, text, uuid, text, text, uuid) to authenticated;

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
    -- The field team: field consultants and the Field Supervisor with enabled staff access.
    'field_team', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', p.id, 'name', coalesce(nullif(btrim(p.full_name), ''), p.email),
               'role', p.role::text) order by coalesce(nullif(btrim(p.full_name), ''), p.email))
        from public.profiles p
        join public.staff_access s on s.profile_id = p.id and s.access_enabled and s.staff_role = p.role
       where p.is_active and p.role::text in ('field_consultant', 'field_supervisor')), '[]'::jsonb),
    'fnc_offices', coalesce((
      select jsonb_agg(jsonb_build_object('code', o.code, 'label', o.label) order by o.label)
        from public.fnc_offices o where o.is_active), '[]'::jsonb)
  );
end;
$function$;

-- 7. Queue (same columns; the source label now covers field leads) ------------------------------------------------------
create or replace function public.staff_intake_queue(p_status public.intake_workflow_status default null::public.intake_workflow_status, p_include_archived boolean default false, p_limit integer default 50, p_offset integer default 0)
 returns table(lead_id uuid, business_name text, contact_name text, contact_cell text, contact_email text, funding_type text, funding_type_label text, requested_amount numeric, channel text, organisation_name text, team_name text, agent_name text, claimed_agent_reference text, workflow_status text, assignee_id uuid, assignee_name text, registered_at timestamp with time zone, first_complete_at timestamp with time zone, archived_at timestamp with time zone, archive_reason_code text, missing_documents text[], has_review_flag boolean, source_label text)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  return query
    select si.lead_id, l.business_name, l.contact_name, l.contact_cell, l.contact_email,
           si.funding_type, fpc.display_name, l.funding_amount,
           si.channel::text, rp.name, rt.name, ap.full_name, si.claimed_agent_reference,
           si.workflow_status::text, si.operational_assignee_id, asg.full_name,
           si.registered_at, si.first_complete_at, si.archived_at, si.archive_reason_code::text,
           case when si.archived_at is null then public.intake_required_docs_missing(si.lead_id) else '{}'::text[] end,
           exists (select 1 from public.intake_review_flags f where f.lead_id = si.lead_id and f.status = 'open'),
           public.intake_source_label(si.channel, si.inhouse_kind, si.inhouse_staff_id, si.inhouse_office_code,
                                      si.inhouse_referrer_name, si.field_agent_id)
      from public.submission_intakes si
      join public.leads l on l.id = si.lead_id
      join public.funding_product_catalog fpc on fpc.code = si.funding_type
      left join public.referral_partners rp on rp.id = si.organisation_id
      left join public.referral_teams rt on rt.id = si.team_id
      left join public.profiles ap on ap.id = si.agent_profile_id
      left join public.profiles asg on asg.id = si.operational_assignee_id
     where (p_status is null or si.workflow_status = p_status)
       and (coalesce(p_include_archived, false) or si.archived_at is null)
     order by si.registered_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;
revoke all on function public.staff_intake_queue(public.intake_workflow_status, boolean, integer, integer) from public, anon;
grant execute on function public.staff_intake_queue(public.intake_workflow_status, boolean, integer, integer) to authenticated;

-- 8. Owner attribution correction (+ into field). Some field-team leads were captured as in-house -> employee as a
--    workaround before this channel existed; the Director moves them INTO 'field' here, naming the field person
--    (validated like registration). Correcting into 'inhouse' stays refused (that source is chosen at registration).
--    Every correction clears the details of the channel left behind; the audit keeps the previous snapshot.
drop function if exists public.owner_correct_intake_attribution(uuid, public.submission_channel, uuid, uuid, uuid, text);
create or replace function public.owner_correct_intake_attribution(
  p_lead_id          uuid,
  p_channel          public.submission_channel,
  p_organisation_id  uuid,
  p_team_id          uuid,
  p_agent_profile_id uuid,
  p_reason           text,
  p_field_agent_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old      public.submission_intakes;
  v_snapshot jsonb;
begin
  perform public.intake_require_actor(array['owner']);
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'A reason of at least 10 characters is required';
  end if;
  if p_channel = 'inhouse' then
    raise exception 'A lead cannot be corrected into Fund Now Capital (in-house); that source is chosen at registration';
  end if;
  if p_channel <> 'field' and p_field_agent_id is not null then
    raise exception 'Only a field team lead carries a field consultant';
  end if;
  select * into v_old from public.submission_intakes si where si.lead_id = p_lead_id for update;
  if not found then raise exception 'Submission not found'; end if;

  v_snapshot := public.intake_validate_channel(p_channel, p_organisation_id, p_team_id, p_agent_profile_id);
  if p_channel = 'field' then
    v_snapshot := v_snapshot || public.intake_validate_field(p_field_agent_id);
  end if;

  perform set_config('fnc.intake_attribution_correction', 'on', true);
  update public.submission_intakes
     set channel = p_channel,
         organisation_id = (v_snapshot ->> 'organisation_id')::uuid,
         team_id = p_team_id,
         team_leader_profile_id = (v_snapshot ->> 'team_leader_profile_id')::uuid,
         agent_profile_id = p_agent_profile_id,
         affiliation_snapshot = v_snapshot,
         inhouse_kind = null, inhouse_staff_id = null, inhouse_office_code = null, inhouse_referrer_name = null,
         field_agent_id = case when p_channel = 'field' then p_field_agent_id end,
         updated_at = now()
   where lead_id = p_lead_id;
  perform set_config('fnc.intake_attribution_correction', 'off', true);

  -- The previous attribution is preserved in the audit trail, never erased.
  perform public.staff_audit_write('submission_intake', p_lead_id, 'attribution_corrected', p_reason,
    jsonb_build_object('previous', v_old.affiliation_snapshot, 'previous_agent_profile_id', v_old.agent_profile_id,
                       'previous_channel', v_old.channel, 'previous_inhouse_kind', v_old.inhouse_kind,
                       'previous_inhouse_staff_id', v_old.inhouse_staff_id, 'previous_field_agent_id', v_old.field_agent_id,
                       'new', v_snapshot));
  return jsonb_build_object('lead_id', p_lead_id, 'channel', p_channel);
end;
$$;
revoke all on function public.owner_correct_intake_attribution(uuid, public.submission_channel, uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.owner_correct_intake_attribution(uuid, public.submission_channel, uuid, uuid, uuid, text, uuid) to authenticated;

-- 9. The one-lead detail (live body + source_label) --------------------------------------------------------------------------
create or replace function public.staff_intake_detail(p_lead_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_result jsonb;
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  select jsonb_build_object(
    'lead_id', si.lead_id,
    'business_name', l.business_name,
    'contact_name', l.contact_name,
    'contact_cell', l.contact_cell,
    'contact_email', l.contact_email,
    'cipc_number', l.cipc_number,
    'requested_amount', l.funding_amount,
    'funding_purpose', l.funding_purpose,
    'funding_type', si.funding_type,
    'channel', si.channel,
    'organisation_name', rp.name,
    'team_name', rt.name,
    'agent_name', ap.full_name,
    'source_label', public.intake_source_label(si.channel, si.inhouse_kind, si.inhouse_staff_id, si.inhouse_office_code,
                                               si.inhouse_referrer_name, si.field_agent_id),
    'claimed_agent_reference', si.claimed_agent_reference,
    'workflow_status', si.workflow_status,
    'assignee_name', asg.full_name,
    'registered_at', si.registered_at,
    'first_complete_at', si.first_complete_at,
    'archived_at', si.archived_at,
    'archive_reason_code', si.archive_reason_code,
    'missing_documents', case when si.archived_at is null then to_jsonb(public.intake_required_docs_missing(si.lead_id)) else '[]'::jsonb end,
    'open_review_flags', (select count(*) from public.intake_review_flags f where f.lead_id = si.lead_id and f.status = 'open'),
    'introducing_parties', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ip.id, 'kind', ip.party_kind,
               'name', coalesce(pp.full_name, po.name, ip.external_name), 'note', ip.note))
        from public.submission_introducing_parties ip
        left join public.profiles pp on pp.id = ip.profile_id
        left join public.referral_partners po on po.id = ip.organisation_id
       where ip.lead_id = si.lead_id and ip.removed_at is null), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'receipt_id', r.id, 'document_type', coalesce(c.title, r.document_type::text), 'doc_code', r.doc_code,
               'received_via', r.received_via, 'received_at', r.received_at,
               'flagged_suspicious', coalesce((select f.event_kind from public.intake_document_flag_events f
                                                 where f.receipt_id = r.id order by f.id desc limit 1), '') = 'suspicious_flagged')
               order by r.received_at)
        from public.intake_document_receipts r left join public.doc_catalogue c on c.code = r.doc_code
       where r.lead_id = si.lead_id), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'at', e.occurred_at, 'event', e.event_type, 'actor_role', e.actor_role,
               'actor_name', ep.full_name, 'reason', e.reason,
               'to', e.detail ->> 'to') order by e.id)
        from public.staff_audit_events e
        left join public.profiles ep on ep.id = e.actor_id
       where e.entity_type = 'submission_intake' and e.entity_id = si.lead_id), '[]'::jsonb)
  ) into v_result
  from public.submission_intakes si
  join public.leads l on l.id = si.lead_id
  left join public.referral_partners rp on rp.id = si.organisation_id
  left join public.referral_teams rt on rt.id = si.team_id
  left join public.profiles ap on ap.id = si.agent_profile_id
  left join public.profiles asg on asg.id = si.operational_assignee_id
  where si.lead_id = p_lead_id;
  if v_result is null then raise exception 'Submission not found'; end if;
  return v_result;
end;
$function$;

-- 10. Printable lead form (owner, 19 Nov: "PDF of the lead form after being captured"). Only the fields the sheet
--     prints: never bank details, ID numbers or funder names. Same people as the submission queue (the Director, the
--     Sales Coordinator, Switchboard; the Office Administrator through intake_require_actor).
create or replace function public.staff_intake_sheet(p_lead_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  select jsonb_build_object(
    'lead_id', si.lead_id,
    'reference', upper(left(si.lead_id::text, 8)),
    'registered_at', si.registered_at,
    'captured_by_name', coalesce(nullif(btrim(cp.full_name), ''), cp.email),
    'captured_by_role', cp.role::text,
    'business_name', l.business_name,
    'cipc_number', l.cipc_number,
    'contact_name', l.contact_name,
    'contact_cell', l.contact_cell,
    'contact_email', l.contact_email,
    'funding_type_label', fpc.display_name,
    'requested_amount', l.funding_amount,
    'funding_purpose', l.funding_purpose,
    'channel', si.channel,
    'organisation_name', rp.name,
    'team_name', rt.name,
    'agent_name', coalesce(nullif(btrim(ap.full_name), ''), ap.email),
    'source_label', public.intake_source_label(si.channel, si.inhouse_kind, si.inhouse_staff_id, si.inhouse_office_code,
                                               si.inhouse_referrer_name, si.field_agent_id),
    'claimed_agent_reference', si.claimed_agent_reference,
    'workflow_status', si.workflow_status,
    'review_flags', coalesce((select jsonb_agg(distinct f.flag_kind) from public.intake_review_flags f
                               where f.lead_id = si.lead_id and f.status = 'open'), '[]'::jsonb),
    'missing_documents', case when si.archived_at is null then to_jsonb(public.intake_required_docs_missing(si.lead_id))
                              else '[]'::jsonb end
  ) into v_result
  from public.submission_intakes si
  join public.leads l on l.id = si.lead_id
  join public.funding_product_catalog fpc on fpc.code = si.funding_type
  left join public.profiles cp on cp.id = si.created_by
  left join public.referral_partners rp on rp.id = si.organisation_id
  left join public.referral_teams rt on rt.id = si.team_id
  left join public.profiles ap on ap.id = si.agent_profile_id
  where si.lead_id = p_lead_id;
  if v_result is null then raise exception 'Submission not found'; end if;
  return v_result;
end;
$$;
revoke all on function public.staff_intake_sheet(uuid) from public, anon;
grant execute on function public.staff_intake_sheet(uuid) to authenticated;
