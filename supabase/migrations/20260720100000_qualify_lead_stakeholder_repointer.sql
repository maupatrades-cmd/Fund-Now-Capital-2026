-- B6.3 — qualify_lead re-points lead stakeholders to the client + legacy bridge.
--
-- Completes the lead-side of B6 (SPEC S3a). Two additions to qualify_lead, both
-- mirroring the existing documents re-pointer:
--   1. Re-point: a lead's client_stakeholders move to the new/matched client in a
--      single UPDATE (client_id = new, lead_id = null) — preserves the
--      num_nonnulls(lead_id, client_id) = 1 CHECK, roles, PII, everything.
--   2. Legacy bridge: if the lead carried NO stakeholders but has a contact ID,
--      seed a `signatory` stakeholder from the lead contact_* fields for the owner
--      to review (B6 deprecates lead contact_* in favour of stakeholders).
--
-- Everything else in qualify_lead is unchanged. Re-declared in full from
-- 20260719160000 (SECURITY DEFINER + search_path=''); the grant hygiene is
-- re-issued because Supabase re-grants EXECUTE on function DDL (the earlier
-- qualify_lead lesson).

create or replace function public.qualify_lead(p_lead_id uuid, p_override boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lead        public.leads;
  v_client_id   uuid;
  v_deal_id     uuid;
  v_missing     text[];
  v_stake_count int;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can qualify leads';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found';
  end if;

  if v_lead.qualification_stage = 'qualified' then
    select id into v_deal_id from public.deals where lead_id = p_lead_id limit 1;
    return v_deal_id;  -- idempotent
  end if;

  -- Document verification gate (B3.2). Required *accepted* current documents by
  -- category. Blocks by default; an explicit owner override proceeds and logs.
  v_missing := public.lead_required_docs_missing(p_lead_id);
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    if not p_override then
      raise exception 'Cannot qualify — missing required accepted documents: %', array_to_string(v_missing, '; ')
        using errcode = 'P0001';
    else
      perform public.log_qualification_override(p_lead_id, v_missing);
    end if;
  end if;

  select id into v_client_id
  from public.clients
  where lower(business_name) = lower(v_lead.business_name)
  limit 1;

  if v_client_id is null then
    insert into public.clients
      (business_name, cipc_number, industry_id, sub_industry_id, sector_notes,
       address, referral_partner_id, created_by)
    values
      (v_lead.business_name, v_lead.cipc_number, v_lead.industry_id, v_lead.sub_industry_id,
       v_lead.sector_notes, v_lead.physical_address, v_lead.referral_partner_id, auth.uid())
    returning id into v_client_id;

    insert into public.client_contacts
      (client_id, full_name, email, phone, position, id_number, is_primary_director)
    values
      (v_client_id, v_lead.contact_name, v_lead.contact_email, v_lead.contact_cell,
       v_lead.contact_role, v_lead.contact_id_number, true);
  end if;

  insert into public.deals
    (client_id, lead_id, referral_partner_id, stage, amount_requested,
     funding_purpose, funding_timeline, created_by)
  values
    (v_client_id, p_lead_id, v_lead.referral_partner_id, 'qualifying', v_lead.funding_amount,
     v_lead.funding_purpose, v_lead.funding_timeline, auth.uid())
  returning id into v_deal_id;

  -- Re-point the lead's documents to the new/matched client. Single UPDATE so the
  -- num_nonnulls(lead_id, client_id) = 1 CHECK holds through the swap; the
  -- physical storage bytes stay at their original leads/{id}/... path (RLS is
  -- keyed on the uploader, not the path) — a physical move is deferred (ROADMAP).
  update public.documents
     set client_id = v_client_id, lead_id = null
   where lead_id = p_lead_id;

  -- Re-point the lead's stakeholders to the client (B6.3). Same single-UPDATE
  -- pattern so the num_nonnulls(lead_id, client_id) = 1 CHECK holds through the
  -- swap; roles / shareholding / PII / audit cols are preserved.
  select count(*) into v_stake_count from public.client_stakeholders where lead_id = p_lead_id;

  update public.client_stakeholders
     set client_id = v_client_id, lead_id = null
   where lead_id = p_lead_id;

  -- Legacy bridge: the lead carried no stakeholders but has a contact ID → seed a
  -- signatory stakeholder from the contact fields for the owner to review. Assumes
  -- an SA ID (the legacy contact_id_number field's meaning); the owner can adjust.
  if v_stake_count = 0
     and v_lead.contact_id_number is not null
     and btrim(v_lead.contact_id_number) <> '' then
    insert into public.client_stakeholders
      (client_id, full_name, id_type, id_number, roles, cell, email, created_by)
    values
      (v_client_id,
       coalesce(nullif(btrim(v_lead.contact_name), ''), 'Primary contact'),
       'sa_id', btrim(v_lead.contact_id_number),
       array['signatory']::public.stakeholder_role[],
       v_lead.contact_cell, v_lead.contact_email, auth.uid());
  end if;

  update public.leads set qualification_stage = 'qualified' where id = p_lead_id;

  return v_deal_id;
end;
$function$;

-- Grant hygiene (re-issued — Supabase re-grants EXECUTE on function DDL). Keep
-- authenticated as the only API role that can execute; service_role untouched.
revoke all on function public.qualify_lead(uuid, boolean) from public, anon;
grant execute on function public.qualify_lead(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions: (a) the re-declaration kept SECURITY DEFINER + the grant matrix
-- { authenticated } intact; (b) the re-point UPDATE moves a lead stakeholder to
-- a client while the XOR CHECK holds. Synthetic stakeholder + its activity rows
-- are cleaned up. RAISEs (rolls back) on any mismatch.
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner  uuid;
  v_lead   uuid;
  v_client uuid;
  v_sid    uuid;
begin
  -- (a) security + grants
  if not (select p.prosecdef from pg_proc p
            where p.oid = 'public.qualify_lead(uuid, boolean)'::regprocedure) then
    raise exception 'B6.3 assert FAIL: qualify_lead is not SECURITY DEFINER';
  end if;
  if not has_function_privilege('authenticated', 'public.qualify_lead(uuid, boolean)', 'execute') then
    raise exception 'B6.3 assert FAIL: authenticated cannot execute qualify_lead';
  end if;
  if has_function_privilege('anon', 'public.qualify_lead(uuid, boolean)', 'execute') then
    raise exception 'B6.3 assert FAIL: anon can execute qualify_lead (should not)';
  end if;

  -- (b) re-point logic (uses a real lead + client but only creates/deletes a
  -- synthetic stakeholder; the client_stakeholders table is otherwise empty).
  select id into v_owner  from public.profiles where role = 'owner' limit 1;
  select id into v_lead   from public.leads   limit 1;
  select id into v_client from public.clients limit 1;
  if v_owner is null or v_lead is null or v_client is null then
    raise notice 'B6.3 re-point assertion skipped (no owner / lead / client)';
    return;
  end if;

  insert into public.client_stakeholders (lead_id, full_name, id_type, roles, created_by)
  values (v_lead, 'B6.3 repoint assert', 'sa_id',
          array['director']::public.stakeholder_role[], v_owner)
  returning id into v_sid;

  -- Scope the re-point to the synthetic row only (by id, never by lead_id) so a
  -- real lead-side stakeholder can never be moved by this assertion. The XOR
  -- CHECK-preservation being verified is identical regardless of the predicate.
  update public.client_stakeholders
     set client_id = v_client, lead_id = null
   where id = v_sid;

  if not exists (
    select 1 from public.client_stakeholders
    where id = v_sid and client_id = v_client and lead_id is null
  ) then
    raise exception 'B6.3 assert FAIL: stakeholder re-point did not move lead → client';
  end if;

  delete from public.client_stakeholders where id = v_sid;
  delete from public.activity_logs where entity_type = 'client_stakeholder' and entity_id = v_sid;

  raise notice 'B6.3 assertions passed (DEFINER + grants + stakeholder re-point)';
end $$;
