-- B5.2 (part 2 of 3) — client duplicate detection + qualify_lead Path A.
--
--   1. find_client_duplicates(): advisory lookup for the Add/Edit-Client form —
--      CIPC exact vs a CLIENT → block; CIPC exact vs a LEAD → warn; fuzzy name
--      (>=0.75) vs clients + leads → warn. Mirrors find_lead_duplicates (B2.3),
--      reuses the existing clients_business_name_trgm_idx GIN index.
--   2. clients_cipc_block trigger: the ONE hard rule — a second client with the
--      same CIPC is the same legal entity → rejected server-side (the race-proof
--      partial UNIQUE INDEX is built CONCURRENTLY in part 3).
--   3. qualify_lead Path A: match an existing client by CIPC (authoritative) OR
--      name, re-point onto it (never insert a duplicate), and emit a visibility
--      event — QUALIFIED_ONTO_EXISTING_CLIENT (match_kind cipc|name) or
--      QUALIFIED_NEW_CLIENT. Returns a jsonb audit shape (8 keys) so the UI can
--      show "Qualified onto {business}. N stakeholders + M documents migrated.
--      DEAL-XXX created."
--
-- The QUALIFIED_* enum values were committed in part 1 (20260720110000).

-- ===========================================================================
-- 1. find_client_duplicates — advisory (read-only, SECURITY INVOKER so RLS
--    applies; owner-only entry surface). severity 'block' ONLY for exact CIPC
--    against another client.
-- ===========================================================================
create or replace function public.find_client_duplicates(
  p_business_name text,
  p_cipc          text default null,
  p_exclude_client_id uuid default null
)
returns table (
  match_kind    text,
  severity      text,
  entity        text,
  entity_id     uuid,
  business_name text,
  similarity    real
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- Exact CIPC against another client → hard block.
  select 'cipc', 'block', 'client', c.id, c.business_name, 1.0::real
    from public.clients c
   where p_cipc is not null and btrim(p_cipc) <> ''
     and btrim(c.cipc_number) = btrim(p_cipc)
     and (p_exclude_client_id is null or c.id <> p_exclude_client_id)
  union all
  -- Exact CIPC against a lead → warn (a lead exists for this business).
  select 'cipc', 'warn', 'lead', l.id, l.business_name, 1.0::real
    from public.leads l
   where p_cipc is not null and btrim(p_cipc) <> ''
     and btrim(l.cipc_number) = btrim(p_cipc)
  union all
  -- Fuzzy business-name similarity >= 0.75 → warn (clients).
  select 'name', 'warn', 'client', c.id, c.business_name,
         extensions.similarity(lower(c.business_name), lower(p_business_name))
    from public.clients c
   where p_business_name is not null and btrim(p_business_name) <> ''
     and (p_exclude_client_id is null or c.id <> p_exclude_client_id)
     and extensions.similarity(lower(c.business_name), lower(p_business_name)) >= 0.75
  union all
  -- Fuzzy business-name similarity >= 0.75 → warn (leads).
  select 'name', 'warn', 'lead', l.id, l.business_name,
         extensions.similarity(lower(l.business_name), lower(p_business_name))
    from public.leads l
   where p_business_name is not null and btrim(p_business_name) <> ''
     and extensions.similarity(lower(l.business_name), lower(p_business_name)) >= 0.75
  -- Positional ORDER BY (first branch uses unnamed literals): 2 = severity,
  -- 6 = similarity. 'block' sorts before 'warn', so blocks surface first.
  order by 2, 6 desc;
$$;

grant execute on function public.find_client_duplicates(text, text, uuid) to authenticated;

-- ===========================================================================
-- 2. clients_cipc_block — hard-block a second client with the same CIPC. The
--    friendly message; the partial UNIQUE INDEX (part 3) is the race-proof
--    guarantee. Both normalise with btrim() so they agree.
-- ===========================================================================
create or replace function public.clients_cipc_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing text;
begin
  if new.cipc_number is null or btrim(new.cipc_number) = '' then
    return new;
  end if;
  select c.business_name into v_existing
    from public.clients c
   where btrim(c.cipc_number) = btrim(new.cipc_number)
     and c.id <> new.id
   limit 1;
  if v_existing is not null then
    raise exception
      'A client already exists for this CIPC number — %. Open the existing client instead.', v_existing
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists clients_cipc_block on public.clients;
create trigger clients_cipc_block
  before insert or update of cipc_number on public.clients
  for each row execute function public.clients_cipc_block();

-- ===========================================================================
-- 3. qualify_lead — Path A (match by CIPC or name) + visibility gate + jsonb
--    audit return. Re-declared in full from 20260720100000 (SECURITY DEFINER +
--    search_path=''); the RETURN TYPE changes uuid → jsonb (callers updated).
-- ===========================================================================
create or replace function public.qualify_lead(p_lead_id uuid, p_override boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lead             public.leads;
  v_client_id        uuid;
  v_deal_id          uuid;
  v_deal_ref         text;
  v_missing          text[];
  v_stake_count      int := 0;
  v_doc_count        int := 0;
  v_match_kind       text;             -- 'cipc' | 'name' | null (new client)
  v_matched_existing boolean := false;
  v_client_name      text;
  v_uid              uuid := auth.uid();
  v_email            text;
  v_role             text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can qualify leads';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found';
  end if;

  -- Idempotent: a re-qualify returns the existing deal's audit shape, migrating
  -- nothing. (Behaviour locked by the migration's source assertion.)
  if v_lead.qualification_stage = 'qualified' then
    select id into v_deal_id from public.deals where lead_id = p_lead_id limit 1;
    select d.reference, d.client_id into v_deal_ref, v_client_id
      from public.deals d where d.id = v_deal_id;
    select c.business_name into v_client_name from public.clients c where c.id = v_client_id;
    return jsonb_build_object(
      'deal_id', v_deal_id, 'deal_reference', v_deal_ref, 'client_id', v_client_id,
      'client_business_name', v_client_name, 'matched_existing', true, 'match_kind', 'idempotent',
      'stakeholder_count_migrated', 0, 'document_count_migrated', 0);
  end if;

  -- Document verification gate (B3.2). Blocks by default; explicit owner override
  -- proceeds and logs the missing categories.
  v_missing := public.lead_required_docs_missing(p_lead_id);
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    if not p_override then
      raise exception 'Cannot qualify — missing required accepted documents: %', array_to_string(v_missing, '; ')
        using errcode = 'P0001';
    else
      perform public.log_qualification_override(p_lead_id, v_missing);
    end if;
  end if;

  -- Path A match: CIPC first (a CIPC is the authoritative legal identity), then
  -- name. Re-point onto the matched client — never insert a duplicate.
  if v_lead.cipc_number is not null and btrim(v_lead.cipc_number) <> '' then
    select id into v_client_id from public.clients
     where btrim(cipc_number) = btrim(v_lead.cipc_number) limit 1;
    if v_client_id is not null then v_match_kind := 'cipc'; end if;
  end if;
  if v_client_id is null then
    select id into v_client_id from public.clients
     where lower(business_name) = lower(v_lead.business_name) limit 1;
    if v_client_id is not null then v_match_kind := 'name'; end if;
  end if;

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
    v_matched_existing := false;
  else
    v_matched_existing := true;
  end if;

  select business_name into v_client_name from public.clients where id = v_client_id;

  insert into public.deals
    (client_id, lead_id, referral_partner_id, stage, amount_requested,
     funding_purpose, funding_timeline, created_by)
  values
    (v_client_id, p_lead_id, v_lead.referral_partner_id, 'qualifying', v_lead.funding_amount,
     v_lead.funding_purpose, v_lead.funding_timeline, auth.uid())
  returning id into v_deal_id;
  select reference into v_deal_ref from public.deals where id = v_deal_id;

  -- Re-point documents (count first — the count is the audit number returned).
  select count(*) into v_doc_count from public.documents where lead_id = p_lead_id;
  update public.documents
     set client_id = v_client_id, lead_id = null
   where lead_id = p_lead_id;

  -- Re-point stakeholders (count first). Single UPDATE so num_nonnulls(lead_id,
  -- client_id) = 1 holds through the swap.
  select count(*) into v_stake_count from public.client_stakeholders where lead_id = p_lead_id;
  update public.client_stakeholders
     set client_id = v_client_id, lead_id = null
   where lead_id = p_lead_id;

  -- Legacy bridge: no stakeholders but a contact ID → seed a signatory (B6.3).
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

  -- Visibility gate: log which qualification path was taken (owner-only via the
  -- activity_logs RLS). This is IN ADDITION to the QUALIFICATION stage event the
  -- leads UPDATE trigger emits — it carries the client-match decision + counts.
  select p.email, p.role into v_email, v_role from public.profiles p where p.id = v_uid;
  if v_matched_existing then
    insert into public.activity_logs
      (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id,
       description, after_values, related_entity_ids)
    values
      (now(), v_uid, v_email, v_role, 'QUALIFIED_ONTO_EXISTING_CLIENT', 'lead', p_lead_id,
       'Lead ' || coalesce(v_lead.business_name, '?') || ' qualified onto existing client '
         || coalesce(v_client_name, '?') || ' (' || v_match_kind || ' match)',
       jsonb_build_object('match_kind', v_match_kind, 'existing_client_id', v_client_id,
         'cipc', v_lead.cipc_number, 'lead_id', p_lead_id, 'deal_id', v_deal_id,
         'stakeholder_count_migrated', v_stake_count, 'document_count_migrated', v_doc_count),
       jsonb_build_array(v_client_id, v_deal_id));
  else
    insert into public.activity_logs
      (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id,
       description, after_values, related_entity_ids)
    values
      (now(), v_uid, v_email, v_role, 'QUALIFIED_NEW_CLIENT', 'lead', p_lead_id,
       'Lead ' || coalesce(v_lead.business_name, '?') || ' qualified — new client created',
       jsonb_build_object('client_id', v_client_id, 'lead_id', p_lead_id, 'deal_id', v_deal_id),
       jsonb_build_array(v_client_id, v_deal_id));
  end if;

  return jsonb_build_object(
    'deal_id', v_deal_id, 'deal_reference', v_deal_ref, 'client_id', v_client_id,
    'client_business_name', v_client_name, 'matched_existing', v_matched_existing, 'match_kind', v_match_kind,
    'stakeholder_count_migrated', v_stake_count, 'document_count_migrated', v_doc_count);
end;
$function$;

-- Grant hygiene (re-issued — Supabase re-grants EXECUTE on function DDL). Keep
-- authenticated as the only API role that can execute; service_role untouched.
revoke all on function public.qualify_lead(uuid, boolean) from public, anon;
grant execute on function public.qualify_lead(uuid, boolean) to authenticated;

-- ===========================================================================
-- 4. Assertions — belt-and-braces on the 5th qualify_lead touch this session.
--    Introspection-only (no invocation — qualify_lead needs an auth context +
--    has side effects, so runtime behaviour is the owner's smoke test; here we
--    LOCK the structural contract so drift is caught). RAISEs (rolls back).
-- ===========================================================================
do $$
declare
  v_def text := pg_get_functiondef('public.qualify_lead(uuid, boolean)'::regprocedure);
  v_key text;
begin
  -- enum values from part 1 are present
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'activity_event_type' and e.enumlabel = 'QUALIFIED_ONTO_EXISTING_CLIENT') then
    raise exception 'B5.2 assert FAIL: QUALIFIED_ONTO_EXISTING_CLIENT enum missing (run part 1 first)';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'activity_event_type' and e.enumlabel = 'QUALIFIED_NEW_CLIENT') then
    raise exception 'B5.2 assert FAIL: QUALIFIED_NEW_CLIENT enum missing (run part 1 first)';
  end if;

  -- (a) DEFINER + grant matrix { authenticated } (anon excluded)
  if not (select p.prosecdef from pg_proc p
            where p.oid = 'public.qualify_lead(uuid, boolean)'::regprocedure) then
    raise exception 'B5.2 assert FAIL: qualify_lead is not SECURITY DEFINER';
  end if;
  if not has_function_privilege('authenticated', 'public.qualify_lead(uuid, boolean)', 'execute') then
    raise exception 'B5.2 assert FAIL: authenticated cannot execute qualify_lead';
  end if;
  if has_function_privilege('anon', 'public.qualify_lead(uuid, boolean)', 'execute') then
    raise exception 'B5.2 assert FAIL: anon can execute qualify_lead (should not)';
  end if;

  -- (b) parameter signature snapshot — exactly (uuid, boolean), no drift
  if pg_get_function_identity_arguments('public.qualify_lead(uuid, boolean)'::regprocedure)
       <> 'p_lead_id uuid, p_override boolean' then
    raise exception 'B5.2 assert FAIL: qualify_lead signature drifted (expected p_lead_id uuid, p_override boolean)';
  end if;

  -- (c) return type is jsonb
  if pg_get_function_result('public.qualify_lead(uuid, boolean)'::regprocedure) <> 'jsonb' then
    raise exception 'B5.2 assert FAIL: qualify_lead return type is not jsonb';
  end if;

  -- (d) idempotency guard is present in the source (locks current behaviour)
  if position('qualification_stage = ''qualified''' in v_def) = 0 then
    raise exception 'B5.2 assert FAIL: qualify_lead idempotency guard is missing';
  end if;

  -- (e) return shape carries all 8 audit keys
  foreach v_key in array array[
    'deal_id', 'deal_reference', 'client_id', 'client_business_name',
    'matched_existing', 'match_kind', 'stakeholder_count_migrated', 'document_count_migrated'
  ] loop
    if position('''' || v_key || '''' in v_def) = 0 then
      raise exception 'B5.2 assert FAIL: qualify_lead return is missing key %', v_key;
    end if;
  end loop;

  raise notice 'B5.2 assertions passed (DEFINER + grants + signature + jsonb return + idempotency guard + 8 keys)';
end $$;
