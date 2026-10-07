-- Staff build, Batch 1 (5/5): the only doors into the intake tables.
--
-- Authority (enforced here in the database, not in the UI):
--   Owner       everything below, plus Verified, archive reversal, Complete
--               reversal, attribution correction, review-flag resolution.
--   Coordinator New -> Documents incomplete -> Complete -> With Founder, audited
--               backward corrections, archive withdrawn/duplicate/lapsed,
--               assign work, record receipts, add/remove introducing parties.
--   Switchboard register an enquiry, record receipts, add introducing parties,
--               flag a document as suspicious. No workflow, assignment or
--               archive authority.
-- Neither staff role can read commission, bank, ID contents, funder identity,
-- another introducer's private file, or any stored document. Projections below
-- return operational fields only and are capped at 100 rows per call.

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------
create or replace function public.intake_require_actor(p_allowed text[])
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.staff_actor_role();
begin
  if v_role is null or not (v_role = any (p_allowed)) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

create or replace function public.intake_membership_active(p_team_id uuid, p_profile_id uuid, p_leader_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.referral_team_memberships m
     where m.team_id = p_team_id and m.profile_id = p_profile_id
       and (not p_leader_only or m.membership_role = 'team_leader')
       and m.effective_from <= public.current_sast_date()
       and (m.effective_to is null or m.effective_to >= public.current_sast_date()));
$$;

-- Relationship validation for a submission's channel. Returns the snapshot that
-- is frozen on the intake, or raises. Never trusts a caller-supplied claim.
create or replace function public.intake_validate_channel(
  p_channel          public.submission_channel,
  p_organisation_id  uuid,
  p_team_id          uuid,
  p_agent_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    if v_agent.role::text not in ('lead_referrer', 'partner') then
      raise exception 'The agent must be a partner or lead-referrer profile';
    end if;
    v_agent_org := case v_agent.role::text
                     when 'partner' then v_agent.referral_partner_id
                     else v_agent.sourced_via_partner_id end;
    if p_channel = 'direct_agent' then
      if v_agent.role::text <> 'lead_referrer' or v_agent_org is not null then
        raise exception 'A direct agent must be an independent lead-referrer with no organisation';
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
$$;

-- Duplicate detection. Internal: returns the matched record ids so the Owner
-- review flag can reference them; staff-facing code only ever surfaces booleans.
create or replace function public.intake_duplicate_matches(
  p_business_name text,
  p_cipc          text,
  p_email         text,
  p_cell          text
)
returns table (flag_kind text, existing_lead_id uuid, existing_client_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select 'registration_conflict', l.id, null::uuid
    from public.leads l
   where nullif(btrim(p_cipc), '') is not null and btrim(l.cipc_number) = btrim(p_cipc)
  union all
  select 'registration_conflict', null::uuid, c.id
    from public.clients c
   where nullif(btrim(p_cipc), '') is not null and btrim(c.cipc_number) = btrim(p_cipc)
  union all
  select 'recent_submission', l.id, null::uuid
    from public.leads l
   where nullif(btrim(p_business_name), '') is not null
     and lower(btrim(l.business_name)) = lower(btrim(p_business_name))
     and l.created_at >= now() - interval '6 months'
  union all
  select 'duplicate_contact', l.id, null::uuid
    from public.leads l
   where (nullif(btrim(p_email), '') is not null and lower(btrim(l.contact_email)) = lower(btrim(p_email)))
      or (nullif(btrim(p_cell), '') is not null and btrim(l.contact_cell) = btrim(p_cell));
$$;

-- Complete means the REQUIRED documents for this funding type were RECEIVED. It
-- does not mean they are genuine or acceptable (that is the Owner's Verified).
-- Uses the shared requirement rules; with no rules configured it refuses rather
-- than guessing.
create or replace function public.intake_required_docs_missing(p_lead_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type    text;
  v_rules   integer;
  v_missing text[];
begin
  select si.funding_type into v_type from public.submission_intakes si where si.lead_id = p_lead_id;
  if v_type is null then return array['Funding type not set']; end if;

  select count(*) into v_rules
    from public.document_requirement_rules r
   where r.rule_scope = 'product_baseline' and r.product_code = v_type
     and r.is_active and r.requirement = 'required';
  if v_rules = 0 then
    return array['No required-document rules are configured for this funding type'];
  end if;

  select coalesce(array_agg(r.document_type::text order by r.document_type::text), '{}'::text[])
    into v_missing
    from public.document_requirement_rules r
   where r.rule_scope = 'product_baseline' and r.product_code = v_type
     and r.is_active and r.requirement = 'required'
     and not exists (
       select 1 from public.intake_document_receipts x
        where x.lead_id = p_lead_id and x.document_type = r.document_type
          and coalesce((select f.event_kind from public.intake_document_flag_events f
                         where f.receipt_id = x.id order by f.id desc limit 1), '') <> 'suspicious_flagged')
     and not exists (
       select 1 from public.documents d
        where d.lead_id = p_lead_id and d.document_type = r.document_type and d.is_current_version);
  return v_missing;
end;
$$;

revoke all on function public.intake_require_actor(text[]) from public, anon, authenticated;
revoke all on function public.intake_membership_active(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.intake_validate_channel(public.submission_channel, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.intake_duplicate_matches(text, text, text, text) from public, anon, authenticated;
revoke all on function public.intake_required_docs_missing(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Register an enquiry (Switchboard / Coordinator / Owner)
-- ---------------------------------------------------------------------------
create or replace function public.staff_register_intake(
  p_business_name           text,
  p_contact_name            text,
  p_contact_cell            text,
  p_contact_email           text,
  p_cipc_number             text,
  p_funding_type            text,
  p_funding_amount          numeric,
  p_funding_purpose         text,
  p_channel                 public.submission_channel,
  p_organisation_id         uuid,
  p_team_id                 uuid,
  p_agent_profile_id        uuid,
  p_claimed_agent_reference text,
  p_idempotency_key         text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  -- Replays return the original outcome instead of creating a second file.
  select * into v_existing from public.submission_intakes si
   where si.created_by = v_uid and si.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', 'existing', 'lead_id', v_existing.lead_id, 'created', false);
  end if;

  v_snapshot := public.intake_validate_channel(p_channel, p_organisation_id, p_team_id, p_agent_profile_id);

  -- Registration conflict (same CIPC as an existing lead/client): never create a
  -- second file and never overwrite ownership from a caller's claim. Raise an
  -- Owner review flag and tell the caller only that a conflict exists.
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
     claimed_agent_reference, funding_type, affiliation_snapshot, created_by, idempotency_key)
  values (v_lead_id, p_channel, (v_snapshot ->> 'organisation_id')::uuid, p_team_id,
          (v_snapshot ->> 'team_leader_profile_id')::uuid, p_agent_profile_id,
          nullif(btrim(p_claimed_agent_reference), ''), p_funding_type, v_snapshot, v_uid, p_idempotency_key);

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
                       'funding_type', p_funding_type));

  return jsonb_build_object('status', 'created', 'lead_id', v_lead_id, 'created', true, 'flags', v_flags);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Workflow transitions
-- ---------------------------------------------------------------------------
create or replace function public.intake_status_rank(p_status public.intake_workflow_status)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
           when 'new' then 0 when 'documents_incomplete' then 1 when 'complete' then 2
           when 'with_founder' then 3 when 'verified' then 4 end;
$$;

create or replace function public.staff_set_intake_status(
  p_lead_id   uuid,
  p_to_status public.intake_workflow_status,
  p_reason    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role     text;
  v_row      public.submission_intakes;
  v_from     public.intake_workflow_status;
  v_backward boolean;
  v_allowed  boolean := false;
  v_missing  text[];
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator']);

  select * into v_row from public.submission_intakes si where si.lead_id = p_lead_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if v_row.archived_at is not null then raise exception 'An archived submission cannot change status; the Owner must reverse the archive first'; end if;
  if v_row.workflow_status = p_to_status then raise exception 'Submission is already %', p_to_status; end if;

  v_from := v_row.workflow_status;
  v_backward := public.intake_status_rank(p_to_status) < public.intake_status_rank(v_row.workflow_status);

  if v_role = 'owner' then
    v_allowed := true;
  else
    -- Coordinator: the agreed forward path plus audited corrections while the
    -- Owner has not yet acted. Verified is never available here.
    v_allowed := (v_row.workflow_status, p_to_status) in (
      ('new', 'documents_incomplete'), ('new', 'complete'),
      ('documents_incomplete', 'complete'), ('complete', 'with_founder'),
      ('complete', 'documents_incomplete'), ('documents_incomplete', 'new'),
      ('with_founder', 'complete'));
  end if;
  if not v_allowed then
    raise exception 'That status change is not permitted for your role (% to %)', v_row.workflow_status, p_to_status
      using errcode = '42501';
  end if;

  if (v_backward or v_row.workflow_status = 'verified') and (p_reason is null or length(btrim(p_reason)) < 10) then
    raise exception 'A reason of at least 10 characters is required for a backward correction';
  end if;

  if p_to_status = 'complete' then
    v_missing := public.intake_required_docs_missing(p_lead_id);
    if coalesce(array_length(v_missing, 1), 0) > 0 then
      raise exception 'Cannot mark Complete: required documents not yet received (%)', array_to_string(v_missing, ', ');
    end if;
  end if;

  perform set_config('fnc.intake_transition', 'on', true);
  update public.submission_intakes
     set workflow_status = p_to_status, updated_at = now()
   where lead_id = p_lead_id
   returning * into v_row;
  perform set_config('fnc.intake_transition', 'off', true);

  -- Reversing Complete is its own event type so eligibility history can be
  -- reconciled later; first_complete_at is never erased.
  perform public.staff_audit_write('submission_intake', p_lead_id,
    case when v_backward and public.intake_status_rank(v_from) >= 2 and public.intake_status_rank(p_to_status) < 2
         then 'complete_reversed' else 'status_changed' end,
    p_reason,
    jsonb_build_object('from', v_from, 'to', p_to_status, 'backward', v_backward,
                       'first_complete_at', v_row.first_complete_at));

  return jsonb_build_object('lead_id', p_lead_id, 'status', v_row.workflow_status,
                            'first_complete_at', v_row.first_complete_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Archive / reverse
-- ---------------------------------------------------------------------------
create or replace function public.staff_archive_intake(
  p_lead_id     uuid,
  p_reason_code public.intake_archive_reason,
  p_reason      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role  text;
  v_row   public.submission_intakes;
  v_stage text;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator']);
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'A reason of at least 10 characters is required to archive';
  end if;

  select * into v_row from public.submission_intakes si where si.lead_id = p_lead_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if v_row.archived_at is not null then raise exception 'Submission is already archived'; end if;

  if v_role = 'coordinator' then
    if v_row.workflow_status = 'verified' then
      raise exception 'Only the Owner can archive a verified submission' using errcode = '42501';
    end if;
    if v_row.deal_id is not null then
      select d.stage::text into v_stage from public.deals d where d.id = v_row.deal_id;
      if v_stage is not null and v_stage not in ('new_lead', 'qualifying', 'document_collection', 'deal_review') then
        raise exception 'Only the Owner can archive a submission whose deal is already with funders' using errcode = '42501';
      end if;
    end if;
  end if;

  perform set_config('fnc.intake_transition', 'on', true);
  update public.submission_intakes
     set archived_at = now(), archived_by = (select auth.uid()),
         archive_reason_code = p_reason_code, archive_reason = btrim(p_reason), updated_at = now()
   where lead_id = p_lead_id;
  perform set_config('fnc.intake_transition', 'off', true);

  perform public.staff_audit_write('submission_intake', p_lead_id, 'archived', p_reason,
    jsonb_build_object('reason_code', p_reason_code, 'status_at_archive', v_row.workflow_status));
  return jsonb_build_object('lead_id', p_lead_id, 'archived', true);
end;
$$;

create or replace function public.owner_reverse_intake_archive(p_lead_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.submission_intakes;
begin
  perform public.intake_require_actor(array['owner']);
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'A reason of at least 10 characters is required to reverse an archive';
  end if;
  select * into v_row from public.submission_intakes si where si.lead_id = p_lead_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if v_row.archived_at is null then raise exception 'Submission is not archived'; end if;

  perform set_config('fnc.intake_transition', 'on', true);
  update public.submission_intakes
     set archived_at = null, archived_by = null, archive_reason_code = null, archive_reason = null, updated_at = now()
   where lead_id = p_lead_id;
  perform set_config('fnc.intake_transition', 'off', true);

  -- The earlier archive event stays; reversal is a new event.
  perform public.staff_audit_write('submission_intake', p_lead_id, 'archive_reversed', p_reason,
    jsonb_build_object('previous_reason_code', v_row.archive_reason_code, 'previous_archived_at', v_row.archived_at));
  return jsonb_build_object('lead_id', p_lead_id, 'archived', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Assignment (operational only — never touches attribution)
-- ---------------------------------------------------------------------------
create or replace function public.staff_assign_intake(p_lead_id uuid, p_assignee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.submission_intakes;
  v_prev uuid;
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  select * into v_row from public.submission_intakes si where si.lead_id = p_lead_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if v_row.archived_at is not null then raise exception 'An archived submission cannot be assigned'; end if;
  v_prev := v_row.operational_assignee_id;

  if p_assignee_id is not null and not exists (
    select 1 from public.staff_access s join public.profiles p on p.id = s.profile_id
     where s.profile_id = p_assignee_id and s.access_enabled and p.is_active
       and p.role = s.staff_role
  ) then
    raise exception 'The assignee must be an enabled staff member';
  end if;

  update public.submission_intakes
     set operational_assignee_id = p_assignee_id, updated_at = now()
   where lead_id = p_lead_id;

  perform public.staff_audit_write('submission_intake', p_lead_id, 'assignee_changed', null,
    jsonb_build_object('from', v_prev, 'to', p_assignee_id));
  return jsonb_build_object('lead_id', p_lead_id, 'assignee_id', p_assignee_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Introducing parties (who introduced the file; no money)
-- ---------------------------------------------------------------------------
create or replace function public.staff_add_introducing_party(
  p_lead_id         uuid,
  p_kind            public.introducing_party_kind,
  p_profile_id      uuid default null,
  p_organisation_id uuid default null,
  p_external_name   text default null,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.submission_intakes;
  v_id  uuid;
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  select * into v_row from public.submission_intakes si where si.lead_id = p_lead_id;
  if not found then raise exception 'Submission not found'; end if;
  if v_row.archived_at is not null then raise exception 'An archived submission cannot be changed'; end if;

  if p_kind = 'agent' then
    if not exists (select 1 from public.profiles p where p.id = p_profile_id and p.is_active
                    and p.role::text in ('partner', 'lead_referrer')) then
      raise exception 'The agent must be an active partner or lead-referrer profile';
    end if;
  elsif p_kind = 'team_leader' then
    if not exists (select 1 from public.referral_team_memberships m
                    where m.profile_id = p_profile_id and m.membership_role = 'team_leader'
                      and m.effective_from <= public.current_sast_date()
                      and (m.effective_to is null or m.effective_to >= public.current_sast_date())) then
      raise exception 'That person is not an active Team Leader';
    end if;
  elsif p_kind = 'organisation' then
    if not exists (select 1 from public.referral_partners rp where rp.id = p_organisation_id and rp.is_active) then
      raise exception 'Active organisation not found';
    end if;
  end if;

  insert into public.submission_introducing_parties
    (lead_id, party_kind, profile_id, organisation_id, external_name, note, added_by)
  values (p_lead_id, p_kind, p_profile_id, p_organisation_id, nullif(btrim(p_external_name), ''),
          nullif(btrim(p_note), ''), (select auth.uid()))
  returning id into v_id;

  perform public.staff_audit_write('submission_intake', p_lead_id, 'introducing_party_added', null,
    jsonb_build_object('party_id', v_id, 'kind', p_kind));
  return v_id;
end;
$$;

create or replace function public.staff_remove_introducing_party(p_party_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead uuid;
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'A reason of at least 10 characters is required';
  end if;
  update public.submission_introducing_parties
     set removed_at = now(), removed_by = (select auth.uid()), removed_reason = btrim(p_reason)
   where id = p_party_id and removed_at is null
   returning lead_id into v_lead;
  if v_lead is null then raise exception 'Introducing party not found or already removed'; end if;
  perform public.staff_audit_write('submission_intake', v_lead, 'introducing_party_removed', p_reason,
    jsonb_build_object('party_id', p_party_id));
  return p_party_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Document receipts — metadata only, immutable. Returns no read path.
-- ---------------------------------------------------------------------------
create or replace function public.staff_record_document_receipt(
  p_lead_id           uuid,
  p_document_type     public.document_type,
  p_received_via      text,
  p_file_label        text default null,
  p_original_filename text default null,
  p_sha256            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_row  public.submission_intakes;
  v_id   uuid;
  v_at   timestamptz;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  select * into v_row from public.submission_intakes si where si.lead_id = p_lead_id;
  if not found then raise exception 'Submission not found'; end if;
  if v_row.archived_at is not null then raise exception 'An archived submission cannot receive documents'; end if;

  insert into public.intake_document_receipts
    (lead_id, document_type, received_via, file_label, original_filename, sha256, received_by, received_by_role)
  values (p_lead_id, p_document_type, p_received_via, nullif(btrim(p_file_label), ''),
          nullif(btrim(p_original_filename), ''), lower(nullif(btrim(p_sha256), '')), (select auth.uid()), v_role)
  returning id, received_at into v_id, v_at;

  perform public.staff_audit_write('submission_intake', p_lead_id, 'document_received', null,
    jsonb_build_object('receipt_id', v_id, 'document_type', p_document_type, 'via', p_received_via));
  return jsonb_build_object('receipt_id', v_id, 'document_type', p_document_type, 'received_at', v_at);
end;
$$;

create or replace function public.staff_flag_document_suspicious(p_receipt_id uuid, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_lead uuid;
  v_id   bigint;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  select r.lead_id into v_lead from public.intake_document_receipts r where r.id = p_receipt_id;
  if v_lead is null then raise exception 'Receipt not found'; end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'A reason of at least 10 characters is required';
  end if;
  insert into public.intake_document_flag_events (receipt_id, event_kind, reason, actor_id, actor_role)
  values (p_receipt_id, 'suspicious_flagged', btrim(p_reason), (select auth.uid()), v_role)
  returning id into v_id;
  -- The original receipt is untouched; the document is never edited or forwarded.
  perform public.staff_audit_write('submission_intake', v_lead, 'document_flagged_suspicious', p_reason,
    jsonb_build_object('receipt_id', p_receipt_id, 'flag_id', v_id));
  return v_id;
end;
$$;

create or replace function public.owner_clear_document_flag(p_receipt_id uuid, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead uuid;
  v_id   bigint;
begin
  perform public.intake_require_actor(array['owner']);
  select r.lead_id into v_lead from public.intake_document_receipts r where r.id = p_receipt_id;
  if v_lead is null then raise exception 'Receipt not found'; end if;
  insert into public.intake_document_flag_events (receipt_id, event_kind, reason, actor_id, actor_role)
  values (p_receipt_id, 'flag_cleared', coalesce(p_reason, ''), (select auth.uid()), 'owner')
  returning id into v_id;
  perform public.staff_audit_write('submission_intake', v_lead, 'document_flag_cleared', p_reason,
    jsonb_build_object('receipt_id', p_receipt_id, 'flag_id', v_id));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Owner-only review decisions
-- ---------------------------------------------------------------------------
create or replace function public.owner_resolve_intake_review_flag(
  p_flag_id uuid,
  p_status  text,
  p_note    text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.intake_require_actor(array['owner']);
  if p_status not in ('dismissed', 'confirmed_conflict') then
    raise exception 'Status must be dismissed or confirmed_conflict';
  end if;
  if p_note is null or length(btrim(p_note)) < 10 then
    raise exception 'A resolution note of at least 10 characters is required';
  end if;
  update public.intake_review_flags
     set status = p_status, resolved_by = (select auth.uid()), resolved_at = now(), resolution_note = btrim(p_note)
   where id = p_flag_id and status = 'open';
  if not found then raise exception 'Open review flag not found'; end if;
  perform public.staff_audit_write('intake_review_flag', p_flag_id, 'review_flag_resolved', p_note,
    jsonb_build_object('status', p_status));
  return p_flag_id;
end;
$$;

create or replace function public.owner_correct_intake_attribution(
  p_lead_id          uuid,
  p_channel          public.submission_channel,
  p_organisation_id  uuid,
  p_team_id          uuid,
  p_agent_profile_id uuid,
  p_reason           text
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
  select * into v_old from public.submission_intakes si where si.lead_id = p_lead_id for update;
  if not found then raise exception 'Submission not found'; end if;

  v_snapshot := public.intake_validate_channel(p_channel, p_organisation_id, p_team_id, p_agent_profile_id);

  perform set_config('fnc.intake_attribution_correction', 'on', true);
  update public.submission_intakes
     set channel = p_channel,
         organisation_id = (v_snapshot ->> 'organisation_id')::uuid,
         team_id = p_team_id,
         team_leader_profile_id = (v_snapshot ->> 'team_leader_profile_id')::uuid,
         agent_profile_id = p_agent_profile_id,
         affiliation_snapshot = v_snapshot,
         updated_at = now()
   where lead_id = p_lead_id;
  perform set_config('fnc.intake_attribution_correction', 'off', true);

  -- The previous attribution is preserved in the audit trail, never erased.
  perform public.staff_audit_write('submission_intake', p_lead_id, 'attribution_corrected', p_reason,
    jsonb_build_object('previous', v_old.affiliation_snapshot, 'previous_agent_profile_id', v_old.agent_profile_id,
                       'new', v_snapshot));
  return jsonb_build_object('lead_id', p_lead_id, 'channel', p_channel);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Safe projections for Switchboard / Coordinator / Owner. Operational fields
--    only: no commission, bank, ID contents, funder identity, stored documents,
--    credit reasons, or another introducer's private notes. Capped at 100 rows.
-- ---------------------------------------------------------------------------
create or replace function public.staff_intake_queue(
  p_status           public.intake_workflow_status default null,
  p_include_archived boolean default false,
  p_limit            integer default 50,
  p_offset           integer default 0
)
returns table (
  lead_id                 uuid,
  business_name           text,
  contact_name            text,
  contact_cell            text,
  contact_email           text,
  funding_type            text,
  funding_type_label      text,
  requested_amount        numeric,
  channel                 text,
  organisation_name       text,
  team_name               text,
  agent_name              text,
  claimed_agent_reference text,
  workflow_status         text,
  assignee_id             uuid,
  assignee_name           text,
  registered_at           timestamptz,
  first_complete_at       timestamptz,
  archived_at             timestamptz,
  archive_reason_code     text,
  missing_documents       text[],
  has_review_flag         boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  return query
    select si.lead_id, l.business_name, l.contact_name, l.contact_cell, l.contact_email,
           si.funding_type, fpc.display_name, l.funding_amount,
           si.channel::text, rp.name, rt.name, ap.full_name, si.claimed_agent_reference,
           si.workflow_status::text, si.operational_assignee_id, asg.full_name,
           si.registered_at, si.first_complete_at, si.archived_at, si.archive_reason_code::text,
           case when si.archived_at is null then public.intake_required_docs_missing(si.lead_id) else '{}'::text[] end,
           exists (select 1 from public.intake_review_flags f where f.lead_id = si.lead_id and f.status = 'open')
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
$$;

create or replace function public.staff_intake_detail(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
               'receipt_id', r.id, 'document_type', r.document_type, 'received_via', r.received_via,
               'received_at', r.received_at,
               'flagged_suspicious', coalesce((select f.event_kind from public.intake_document_flag_events f
                                                 where f.receipt_id = r.id order by f.id desc limit 1), '') = 'suspicious_flagged')
               order by r.received_at)
        from public.intake_document_receipts r where r.lead_id = si.lead_id), '[]'::jsonb),
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
$$;

-- ---------------------------------------------------------------------------
-- Grants: everything above is a named, role-checked door. Helpers stay private.
-- ---------------------------------------------------------------------------
revoke all on function public.intake_status_rank(public.intake_workflow_status) from public, anon;
grant execute on function public.intake_status_rank(public.intake_workflow_status) to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.staff_register_intake(text,text,text,text,text,text,numeric,text,public.submission_channel,uuid,uuid,uuid,text,text)',
    'public.staff_set_intake_status(uuid,public.intake_workflow_status,text)',
    'public.staff_archive_intake(uuid,public.intake_archive_reason,text)',
    'public.owner_reverse_intake_archive(uuid,text)',
    'public.staff_assign_intake(uuid,uuid)',
    'public.staff_add_introducing_party(uuid,public.introducing_party_kind,uuid,uuid,text,text)',
    'public.staff_remove_introducing_party(uuid,text)',
    'public.staff_record_document_receipt(uuid,public.document_type,text,text,text,text)',
    'public.staff_flag_document_suspicious(uuid,text)',
    'public.owner_clear_document_flag(uuid,text)',
    'public.owner_resolve_intake_review_flag(uuid,text,text)',
    'public.owner_correct_intake_attribution(uuid,public.submission_channel,uuid,uuid,uuid,text)',
    'public.staff_intake_queue(public.intake_workflow_status,boolean,integer,integer)',
    'public.staff_intake_detail(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
