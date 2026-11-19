-- Staff correct capture mistakes (owner, 19 Nov 2026), 2/2. Sinah: "is it possible to edit on the CRM if details were put
-- incorrectly … an agent added as Direct instead of Sub". Owner: "not team role, just edit if they captured and did a
-- mistake". The Director's Team page (admin_update_user_role) stays exactly as it is and stays owner-only.
--
-- 1. staff_correct_agent: the Office Administrator (and the Director) correct an AGENT's name, cell number and type:
--      Direct agent  = contractor, no organisation;
--      Sub-agent     = lead_referrer under an active organisation (sourced_via_partner_id + partner_lead_referrers row);
--      Team Leader   = partner of an active organisation (referral_partner_id).
--    Only agents (partner / contractor / lead_referrer) and only into those three roles: never a staff role or the owner.
--    A TYPE change is refused once the agent has anything attributed to them (leads, intakes, team membership,
--    commission, rewards, invoices): "This agent already has leads — ask the Director". Name and cell can always be
--    corrected. A reason is required. Before/after goes to activity_logs and the staff history; the Director is told.
--    The agent's bank details (payee profile) follow a Direct <-> Sub-agent change; a change that involves a Team Leader
--    is refused while bank details are on file (a Team Leader's bank details belong to the organisation).
-- 2. staff_agent_type_state: what the Agent file shows (current type, organisation, whether the type can still change).
-- 3. staff_correct_intake_details: the person who captured a submission, the Sales Coordinator, the Office Administrator
--    and the Director correct a captured lead's business name, contact name, cell, email, CIPC, amount, purpose and
--    funding type. Never the channel or who the sale is for (owner_correct_intake_attribution, Director only). Refused
--    once the lead is qualified or has a deal ("This lead is already a client — ask the Director"). The CIPC duplicate
--    block (leads_cipc_block) still applies. Every change is audited with before/after.

-- 1. Agent corrections -----------------------------------------------------------------------------------------------------
create or replace function public.agent_has_attributions(p_profile uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.submission_intakes si where si.agent_profile_id = p_profile or si.team_leader_profile_id = p_profile)
      or exists (select 1 from public.submission_introducing_parties ip where ip.profile_id = p_profile and ip.removed_at is null)
      or exists (select 1 from public.referral_team_memberships m where m.profile_id = p_profile)
      or exists (select 1 from public.leads l where l.attributed_to_contractor_id = p_profile
                    or l.attributed_to_lead_referrer_id = p_profile or l.sourced_by_lead_refer_id = p_profile)
      or exists (select 1 from public.commission_records c where c.contractor_id = p_profile)
      or exists (select 1 from public.lead_referrer_commission_records r where r.lead_refer_id = p_profile)
      or exists (select 1 from public.complete_document_reward_locks k where k.beneficiary_profile_id = p_profile)
      or exists (select 1 from public.owner_commission_entries e where e.beneficiary_profile_id = p_profile)
      or exists (select 1 from public.contractor_invoices i where i.contractor_id = p_profile);
$$;
revoke all on function public.agent_has_attributions(uuid) from public, anon, authenticated;

create or replace function public.agent_type_of(p_role text)
returns text
language sql immutable set search_path = '' as $$
  select case p_role when 'contractor' then 'direct' when 'lead_referrer' then 'sub' when 'partner' then 'team_leader' end;
$$;

create or replace function public.staff_agent_type_state(p_profile uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor text := public.staff_actor_role(); v_p public.profiles; v_org uuid; v_payee boolean;
begin
  if v_actor is null or v_actor not in ('owner', 'administrator') then
    raise exception 'Only the Director or the Office Administrator corrects an agent' using errcode = '42501';
  end if;
  select * into v_p from public.profiles p where p.id = p_profile and p.role::text in ('partner', 'contractor', 'lead_referrer');
  if not found then raise exception 'Agent not found'; end if;
  v_org := case v_p.role::text when 'partner' then v_p.referral_partner_id when 'lead_referrer' then v_p.sourced_via_partner_id end;
  v_payee := exists (select 1 from public.payee_payment_profiles pp where pp.contractor_id = p_profile or pp.lead_referrer_id = p_profile);
  return jsonb_build_object(
    'type', public.agent_type_of(v_p.role::text),
    'organisation_id', v_org,
    'organisation_name', (select r.name from public.referral_partners r where r.id = v_org),
    'has_bank_details', v_payee,
    'type_locked', public.agent_has_attributions(p_profile),
    'type_locked_reason', case when public.agent_has_attributions(p_profile)
                               then 'This agent already has leads — ask the Director' end);
end;
$$;
revoke all on function public.staff_agent_type_state(uuid) from public, anon;
grant execute on function public.staff_agent_type_state(uuid) to authenticated;

create or replace function public.staff_correct_agent(
  p_profile uuid, p_full_name text, p_phone text, p_type text, p_organisation_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_actor text := public.staff_actor_role();
  v_old public.profiles; v_new public.profiles;
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s()-]', '', 'g'), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_old_type text; v_new_type text; v_new_role text; v_org uuid; v_old_org uuid;
  v_type_change boolean := false; v_payee public.payee_payment_profiles; v_rows int; v_to uuid;
begin
  if v_actor is null or v_actor not in ('owner', 'administrator') then
    raise exception 'Only the Director or the Office Administrator corrects an agent' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 5 then raise exception 'Say what was wrong (at least 5 characters)'; end if;
  if length(v_reason) > 300 then raise exception 'Keep the reason under 300 characters'; end if;

  perform pg_advisory_xact_lock(hashtextextended('agent_file:' || p_profile::text, 0));
  select * into v_old from public.profiles p where p.id = p_profile for update;
  if not found or v_old.role::text not in ('partner', 'contractor', 'lead_referrer') then
    raise exception 'Only an agent (Direct agent, Sub-agent or Team Leader) can be corrected here' using errcode = '42501';
  end if;

  if v_name is not null and length(v_name) not between 2 and 120 then raise exception 'Enter the full name (2 to 120 characters)'; end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{10,15}$' then raise exception 'Enter a cell number of 10 to 15 digits'; end if;

  v_old_type := public.agent_type_of(v_old.role::text);
  v_old_org := case v_old.role::text when 'partner' then v_old.referral_partner_id when 'lead_referrer' then v_old.sourced_via_partner_id end;
  v_new_type := coalesce(nullif(btrim(coalesce(p_type, '')), ''), v_old_type);
  if v_new_type not in ('direct', 'sub', 'team_leader') then raise exception 'Choose Direct agent, Sub-agent or Team Leader'; end if;
  v_new_role := case v_new_type when 'direct' then 'contractor' when 'sub' then 'lead_referrer' else 'partner' end;
  if v_new_type = 'direct' then
    if p_organisation_id is not null then raise exception 'A Direct agent has no organisation'; end if;
    v_org := null;
  else
    v_org := coalesce(p_organisation_id, case when v_new_type = v_old_type then v_old_org end);
    if v_org is null or not exists (select 1 from public.referral_partners r where r.id = v_org and r.is_active) then
      raise exception 'Choose the active organisation (Team Leader) this agent belongs to';
    end if;
  end if;
  v_type_change := v_new_role <> v_old.role::text or v_org is distinct from v_old_org;

  if v_type_change then
    if public.agent_has_attributions(p_profile) then
      raise exception 'This agent already has leads — ask the Director' using errcode = '42501';
    end if;
    select * into v_payee from public.payee_payment_profiles pp
     where pp.contractor_id = p_profile or pp.lead_referrer_id = p_profile limit 1;
    if v_payee.id is not null and (v_new_type = 'team_leader' or v_old_type = 'team_leader') then
      raise exception 'Bank details are on file for this agent — ask the Director to change a Team Leader' using errcode = '42501';
    end if;
  end if;

  if not v_type_change and (v_name is null or v_name is not distinct from v_old.full_name)
     and (v_phone is null or v_phone is not distinct from v_old.phone_number) then
    raise exception 'Nothing to change';
  end if;

  update public.profiles
     set full_name = coalesce(v_name, full_name),
         phone_number = coalesce(v_phone, phone_number),
         role = v_new_role::public.user_role,
         referral_partner_id = case when v_new_role = 'partner' then v_org end,
         sourced_via_partner_id = case when v_new_role = 'lead_referrer' then v_org end
   where id = p_profile
   returning * into v_new;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'Correcting the agent affected no rows'; end if;

  -- Sub-agent membership of the organisation (same as the Director's Team page).
  if v_new_role = 'lead_referrer' then
    insert into public.partner_lead_referrers (profile_id, referral_partner_id, display_name, status, invited_by)
    values (p_profile, v_org, coalesce(nullif(btrim(v_new.full_name), ''), v_new.email, 'Lead referrer'), 'active', v_uid)
    on conflict (profile_id) do update
      set referral_partner_id = excluded.referral_partner_id, display_name = excluded.display_name, status = 'active',
          updated_at = now();
  else
    delete from public.partner_lead_referrers where profile_id = p_profile;
  end if;

  -- Bank details follow a Direct <-> Sub-agent change (both are keyed on the person).
  if v_type_change and v_payee.id is not null then
    update public.payee_payment_profiles
       set contractor_id = case when v_new_role = 'contractor' then p_profile end,
           lead_referrer_id = case when v_new_role = 'lead_referrer' then p_profile end
     where id = v_payee.id;
  end if;

  -- The agent file's contract type follows the type.
  if v_type_change and v_new_role in ('contractor', 'lead_referrer') then
    update public.agent_details
       set contract_type = case v_new_role when 'contractor' then 'DRA-01' else 'SAA-01' end,
           updated_by = v_uid, updated_by_role = v_actor, updated_at = now()
     where profile_id = p_profile;
  end if;

  insert into public.activity_logs
    (user_id, user_email, user_role, event_type, entity_type, entity_id, description, changed_fields, before_values, after_values)
  select v_uid, actor.email, v_actor,
         (case when v_type_change then 'PERMISSION_CHANGE' else 'UPDATE' end)::public.activity_event_type,
         'profile', p_profile, 'Agent details corrected: ' || v_reason,
         jsonb_build_array('full_name', 'phone_number', 'role', 'referral_partner_id', 'sourced_via_partner_id'),
         jsonb_build_object('full_name', v_old.full_name, 'phone_number', v_old.phone_number, 'role', v_old.role,
                            'referral_partner_id', v_old.referral_partner_id, 'sourced_via_partner_id', v_old.sourced_via_partner_id),
         jsonb_build_object('full_name', v_new.full_name, 'phone_number', v_new.phone_number, 'role', v_new.role,
                            'referral_partner_id', v_new.referral_partner_id, 'sourced_via_partner_id', v_new.sourced_via_partner_id)
    from public.profiles actor where actor.id = v_uid;

  perform public.staff_audit_write('agent_file', p_profile, 'agent_corrected', v_reason,
    jsonb_build_object('before', jsonb_build_object('full_name', v_old.full_name, 'type', v_old_type, 'organisation_id', v_old_org),
                       'after', jsonb_build_object('full_name', v_new.full_name, 'type', v_new_type, 'organisation_id', v_org),
                       'phone_changed', v_new.phone_number is distinct from v_old.phone_number));

  for v_to in select p.id from public.profiles p where p.role::text = 'owner' and p.is_active loop
    continue when v_to = v_uid;
    perform public.staff_notify(v_to, 'AGENT_DETAILS_CORRECTED',
      'Agent corrected: ' || coalesce(nullif(btrim(v_new.full_name), ''), v_new.email),
      case when v_type_change
           then 'Changed from ' || case v_old_type when 'direct' then 'Direct agent' when 'sub' then 'Sub-agent' else 'Team Leader' end
                || ' to ' || case v_new_type when 'direct' then 'Direct agent' when 'sub' then 'Sub-agent' else 'Team Leader' end || '. '
           else 'Name or cell number corrected. ' end || 'Reason: ' || v_reason,
      '/staff/agents/' || p_profile::text, jsonb_build_object('profile_id', p_profile));
  end loop;
  return p_profile;
end;
$$;
revoke all on function public.staff_correct_agent(uuid, text, text, text, uuid, text) from public, anon;
grant execute on function public.staff_correct_agent(uuid, text, text, text, uuid, text) to authenticated;

-- 2. Captured lead corrections ------------------------------------------------------------------------------------------
create or replace function public.staff_correct_intake_details(
  p_lead_id uuid, p_business_name text, p_contact_name text, p_contact_cell text, p_contact_email text,
  p_cipc_number text, p_funding_amount numeric, p_funding_purpose text, p_funding_type text, p_reason text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := public.staff_actor_role();
  v_si public.submission_intakes; v_old public.leads; v_new public.leads;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_biz text := nullif(btrim(coalesce(p_business_name, '')), '');
  v_contact text := nullif(btrim(coalesce(p_contact_name, '')), '');
  v_cell text := nullif(regexp_replace(coalesce(p_contact_cell, ''), '[\s()-]', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
  v_cipc text := nullif(btrim(coalesce(p_cipc_number, '')), '');
  v_purpose text := nullif(btrim(coalesce(p_funding_purpose, '')), '');
  v_ftype text := nullif(btrim(coalesce(p_funding_type, '')), '');
  v_ftype_changed boolean := false; v_rows int;
begin
  if v_reason is null or length(v_reason) < 5 then raise exception 'Say what was wrong (at least 5 characters)'; end if;
  if length(v_reason) > 300 then raise exception 'Keep the reason under 300 characters'; end if;
  select * into v_si from public.submission_intakes si where si.lead_id = p_lead_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if v_role is null or not (v_role in ('owner', 'coordinator', 'administrator')
                            or (v_role = 'switchboard' and v_si.created_by = v_uid)) then
    raise exception 'Only whoever captured this lead, the Sales Coordinator, the Office Administrator or the Director can correct it'
      using errcode = '42501';
  end if;
  select * into v_old from public.leads l where l.id = p_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;
  if v_old.qualification_stage::text = 'qualified' or exists (select 1 from public.deals d where d.lead_id = p_lead_id) then
    raise exception 'This lead is already a client — ask the Director' using errcode = '42501';
  end if;

  if v_biz is not null and length(v_biz) not between 2 and 160 then raise exception 'Business name must be 2 to 160 characters'; end if;
  if v_contact is not null and length(v_contact) not between 2 and 120 then raise exception 'Contact name must be 2 to 120 characters'; end if;
  if v_cell is not null and v_cell !~ '^\+?[0-9]{10,15}$' then raise exception 'Enter a cell number of 10 to 15 digits'; end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email address'; end if;
  if v_cipc is not null and length(v_cipc) > 40 then raise exception 'Keep the CIPC number under 40 characters'; end if;
  if p_funding_amount is not null and p_funding_amount < 0 then raise exception 'Requested amount cannot be negative'; end if;
  if v_purpose is not null and length(v_purpose) > 300 then raise exception 'Keep the purpose under 300 characters'; end if;
  if v_ftype is not null and v_ftype is distinct from v_si.funding_type then
    if not exists (select 1 from public.funding_product_catalog f where f.code = v_ftype and f.is_active) then
      raise exception 'Unknown or inactive funding type';
    end if;
    v_ftype_changed := true;
  end if;

  update public.leads
     set business_name = coalesce(v_biz, business_name),
         contact_name = coalesce(v_contact, contact_name),
         contact_cell = coalesce(v_cell, contact_cell),
         contact_email = coalesce(v_email, contact_email),
         cipc_number = coalesce(v_cipc, cipc_number),
         funding_amount = coalesce(p_funding_amount, funding_amount),
         funding_purpose = case when v_purpose is not null then to_jsonb(array[v_purpose]) else funding_purpose end
   where id = p_lead_id
   returning * into v_new;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'Correcting the lead affected no rows'; end if;

  if v_ftype_changed then
    -- The intake guard treats the funding type as registration attribution; this one column is corrected here.
    perform set_config('fnc.intake_attribution_correction', 'on', true);
    update public.submission_intakes set funding_type = v_ftype where lead_id = p_lead_id;
    perform set_config('fnc.intake_attribution_correction', 'off', true);
  end if;

  if (v_new.business_name, v_new.contact_name, v_new.contact_cell, v_new.contact_email, v_new.cipc_number,
      v_new.funding_amount, v_new.funding_purpose)
     is not distinct from
     (v_old.business_name, v_old.contact_name, v_old.contact_cell, v_old.contact_email, v_old.cipc_number,
      v_old.funding_amount, v_old.funding_purpose) and not v_ftype_changed then
    raise exception 'Nothing to change';
  end if;

  perform public.staff_audit_write('submission_intake', p_lead_id, 'details_corrected', v_reason,
    jsonb_build_object(
      'before', jsonb_build_object('business_name', v_old.business_name, 'contact_name', v_old.contact_name,
                 'contact_cell', v_old.contact_cell, 'contact_email', v_old.contact_email, 'cipc_number', v_old.cipc_number,
                 'funding_amount', v_old.funding_amount, 'funding_purpose', v_old.funding_purpose, 'funding_type', v_si.funding_type),
      'after', jsonb_build_object('business_name', v_new.business_name, 'contact_name', v_new.contact_name,
                 'contact_cell', v_new.contact_cell, 'contact_email', v_new.contact_email, 'cipc_number', v_new.cipc_number,
                 'funding_amount', v_new.funding_amount, 'funding_purpose', v_new.funding_purpose,
                 'funding_type', coalesce(v_ftype, v_si.funding_type))));
  return p_lead_id;
end;
$$;
revoke all on function public.staff_correct_intake_details(uuid, text, text, text, text, text, numeric, text, text, text) from public, anon;
grant execute on function public.staff_correct_intake_details(uuid, text, text, text, text, text, numeric, text, text, text) to authenticated;
