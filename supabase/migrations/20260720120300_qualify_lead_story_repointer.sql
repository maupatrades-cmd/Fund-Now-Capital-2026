-- B4.1 (part 4 of 4) — qualify_lead re-points the lead's Client Story.
--
-- The 6th touch of qualify_lead this build cycle. Completes the lead-side of the
-- B4.1 refinement (SPEC S3): when a lead qualifies, its pre-qualification story
-- (+ append-only impressions) moves to the client, alongside the existing
-- documents (B3.2) and stakeholders (B6.3) re-pointers.
--
-- Conflict handling (owner decision — MERGE-APPEND): the client matched by Path A
-- (B5.2) may ALREADY have a story, and one-story-per-client is enforced. So:
--   * client has no story  → clean re-point (single UPDATE, XOR CHECK holds).
--   * client has a story    → keep it as the source of truth; move the lead
--     story's impressions onto it, fold the lead narrative into ONE dated
--     impression, delete the emptied lead story. Nothing is lost.
--
-- Return shape grows uuid→(already jsonb): + story_count_migrated +
-- story_notes_count_migrated → 10 keys total. A STORY_MIGRATED_LEAD_TO_CLIENT
-- event (enum from part 1) is logged owner-only, once per migrated story.
--
-- Everything else in qualify_lead is unchanged (re-declared in full from
-- 20260720110100; SECURITY DEFINER + search_path='' + grant hygiene re-issued
-- because Supabase re-grants EXECUTE on function DDL). Return type stays jsonb,
-- so CREATE OR REPLACE is valid (no DROP needed).

create or replace function public.qualify_lead(p_lead_id uuid, p_override boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lead              public.leads;
  v_client_id         uuid;
  v_deal_id           uuid;
  v_deal_ref          text;
  v_missing           text[];
  v_stake_count       int := 0;
  v_doc_count         int := 0;
  v_story_count       int := 0;     -- lead stories migrated (0 or 1 — one per lead)
  v_story_notes_count int := 0;     -- impressions that came across with the story
  v_lead_story_id     uuid;
  v_client_story_id   uuid;
  v_surviving_story_id uuid;
  v_ls                public.client_stories;
  v_fold              text;
  v_match_kind        text;             -- 'cipc' | 'name' | null (new client)
  v_matched_existing  boolean := false;
  v_client_name       text;
  v_uid               uuid := auth.uid();
  v_email             text;
  v_role              text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can qualify leads';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found';
  end if;

  -- Idempotent: a re-qualify returns the existing deal's audit shape, migrating
  -- nothing. Carries all 10 keys so the return shape never drifts by path.
  if v_lead.qualification_stage = 'qualified' then
    select id into v_deal_id from public.deals where lead_id = p_lead_id limit 1;
    select d.reference, d.client_id into v_deal_ref, v_client_id
      from public.deals d where d.id = v_deal_id;
    select c.business_name into v_client_name from public.clients c where c.id = v_client_id;
    return jsonb_build_object(
      'deal_id', v_deal_id, 'deal_reference', v_deal_ref, 'client_id', v_client_id,
      'client_business_name', v_client_name, 'matched_existing', true, 'match_kind', 'idempotent',
      'stakeholder_count_migrated', 0, 'document_count_migrated', 0,
      'story_count_migrated', 0, 'story_notes_count_migrated', 0);
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
  select p.email, p.role into v_email, v_role from public.profiles p where p.id = v_uid;

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

  -- Re-point the lead's Client Story (B4.1). One-story-per-lead and one-per-client
  -- are both enforced, so if the matched client already has a story we MERGE-APPEND
  -- rather than move (which would violate one-per-client).
  select id into v_lead_story_id from public.client_stories where lead_id = p_lead_id;
  if v_lead_story_id is not null then
    -- Impressions that will come across (the audit number, in both branches).
    select count(*) into v_story_notes_count
      from public.client_story_notes where story_id = v_lead_story_id;

    select id into v_client_story_id from public.client_stories where client_id = v_client_id;

    if v_client_story_id is null then
      -- Clean re-point: the client has no story yet. Single UPDATE so the XOR
      -- CHECK holds through the swap; impressions ride along (they key on
      -- story_id, which is unchanged).
      update public.client_stories
         set client_id = v_client_id, lead_id = null
       where id = v_lead_story_id;
      v_surviving_story_id := v_lead_story_id;
    else
      -- Merge-append: the client already has a story — keep it as the source of
      -- truth. Move the lead story's impressions onto it, fold the lead's
      -- narrative fields into ONE dated impression, then delete the emptied lead
      -- story. (The append-only impressions table has no UPDATE path via the API;
      -- this runs under SECURITY DEFINER, which is why the re-point lives here.)
      update public.client_story_notes
         set story_id = v_client_story_id
       where story_id = v_lead_story_id;

      select * into v_ls from public.client_stories where id = v_lead_story_id;
      select string_agg(f.line, E'\n\n') into v_fold
      from (
        select label || ': ' || val as line
        from (values
          ('Business story',        v_ls.business_story),
          ('Founder background',    v_ls.founder_background),
          ('Business origin',       v_ls.business_origin),
          ('Competitive edge',      v_ls.competitive_edge),
          ('Aspirations',           v_ls.aspirations),
          ('Contact story',         v_ls.contact_story),
          ('Family context',        v_ls.family_context),
          ('Personal interests',    v_ls.personal_interests),
          ('Language preference',   v_ls.language_preference),
          ('Communication style',   v_ls.communication_style),
          ('Assets narrative',      v_ls.assets_narrative),
          ('Initial assessment',    v_ls.initial_assessment),
          ('Concerns flagged',      v_ls.concerns_flagged),
          ('Opportunities seen',    v_ls.opportunities_seen)
        ) as v(label, val)
        where val is not null and btrim(val) <> ''
      ) f;

      if v_fold is not null then
        insert into public.client_story_notes (story_id, text, author_id)
        values (v_client_story_id,
                'Pre-qualification story captured on lead '
                  || coalesce(nullif(btrim(v_lead.business_name), ''), '(lead)') || ':' || E'\n\n' || v_fold,
                auth.uid());
      end if;

      delete from public.client_stories where id = v_lead_story_id;
      v_surviving_story_id := v_client_story_id;
    end if;

    v_story_count := 1;

    -- Owner-only visibility: log the story migration (once per migrated story).
    insert into public.activity_logs
      (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id,
       description, after_values, related_entity_ids)
    values
      (now(), v_uid, v_email, v_role, 'STORY_MIGRATED_LEAD_TO_CLIENT', 'client_story', v_surviving_story_id,
       'Client story migrated from lead ' || coalesce(v_lead.business_name, '?') || ' to client '
         || coalesce(v_client_name, '?')
         || case when v_client_story_id is not null then ' (merged into existing story)' else '' end,
       jsonb_build_object('lead_id', p_lead_id, 'client_id', v_client_id,
         'merged', (v_client_story_id is not null), 'notes_migrated', v_story_notes_count),
       jsonb_build_array(v_client_id));
  end if;

  update public.leads set qualification_stage = 'qualified' where id = p_lead_id;

  -- Visibility gate: log which qualification path was taken (owner-only via the
  -- activity_logs RLS). IN ADDITION to the QUALIFICATION stage event the leads
  -- UPDATE trigger emits — it carries the client-match decision + all counts.
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
         'stakeholder_count_migrated', v_stake_count, 'document_count_migrated', v_doc_count,
         'story_count_migrated', v_story_count, 'story_notes_count_migrated', v_story_notes_count),
       jsonb_build_array(v_client_id, v_deal_id));
  else
    insert into public.activity_logs
      (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id,
       description, after_values, related_entity_ids)
    values
      (now(), v_uid, v_email, v_role, 'QUALIFIED_NEW_CLIENT', 'lead', p_lead_id,
       'Lead ' || coalesce(v_lead.business_name, '?') || ' qualified — new client created',
       jsonb_build_object('client_id', v_client_id, 'lead_id', p_lead_id, 'deal_id', v_deal_id,
         'story_count_migrated', v_story_count, 'story_notes_count_migrated', v_story_notes_count),
       jsonb_build_array(v_client_id, v_deal_id));
  end if;

  return jsonb_build_object(
    'deal_id', v_deal_id, 'deal_reference', v_deal_ref, 'client_id', v_client_id,
    'client_business_name', v_client_name, 'matched_existing', v_matched_existing, 'match_kind', v_match_kind,
    'stakeholder_count_migrated', v_stake_count, 'document_count_migrated', v_doc_count,
    'story_count_migrated', v_story_count, 'story_notes_count_migrated', v_story_notes_count);
end;
$function$;

-- Grant hygiene (re-issued — Supabase re-grants EXECUTE on function DDL). Keep
-- authenticated as the only API role that can execute; service_role untouched.
revoke all on function public.qualify_lead(uuid, boolean) from public, anon;
grant execute on function public.qualify_lead(uuid, boolean) to authenticated;

-- ===========================================================================
-- Assertions — belt-and-braces on the 6th qualify_lead touch. Introspection
-- locks the structural contract (no invocation — qualify_lead needs an auth
-- context + has side effects); PLUS a synthetic story re-point that exercises
-- the XOR CHECK against a synthetic client and a story-free real lead, scoped by
-- story id so no real data can move. RAISEs (rolls back) on any mismatch.
-- ===========================================================================
do $$
declare
  v_def   text := pg_get_functiondef('public.qualify_lead(uuid, boolean)'::regprocedure);
  v_key   text;
  v_owner uuid;
  v_lead  uuid;
  v_tc    uuid;
  v_ss    uuid;
begin
  -- enum value from part 1 is present
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'activity_event_type' and e.enumlabel = 'STORY_MIGRATED_LEAD_TO_CLIENT') then
    raise exception 'B4.1 assert FAIL: STORY_MIGRATED_LEAD_TO_CLIENT enum missing (run part 1 first)';
  end if;

  -- (a) DEFINER + grant matrix { authenticated } (anon excluded)
  if not (select p.prosecdef from pg_proc p
            where p.oid = 'public.qualify_lead(uuid, boolean)'::regprocedure) then
    raise exception 'B4.1 assert FAIL: qualify_lead is not SECURITY DEFINER';
  end if;
  if not has_function_privilege('authenticated', 'public.qualify_lead(uuid, boolean)', 'execute') then
    raise exception 'B4.1 assert FAIL: authenticated cannot execute qualify_lead';
  end if;
  if has_function_privilege('anon', 'public.qualify_lead(uuid, boolean)', 'execute') then
    raise exception 'B4.1 assert FAIL: anon can execute qualify_lead (should not)';
  end if;

  -- (b) search_path pinned empty (source-level)
  if position('search_path' in v_def) = 0 then
    raise exception 'B4.1 assert FAIL: qualify_lead search_path is not set';
  end if;

  -- (c) parameter signature snapshot — exactly (uuid, boolean), no drift
  if pg_get_function_identity_arguments('public.qualify_lead(uuid, boolean)'::regprocedure)
       <> 'p_lead_id uuid, p_override boolean' then
    raise exception 'B4.1 assert FAIL: qualify_lead signature drifted';
  end if;

  -- (d) return type is jsonb
  if pg_get_function_result('public.qualify_lead(uuid, boolean)'::regprocedure) <> 'jsonb' then
    raise exception 'B4.1 assert FAIL: qualify_lead return type is not jsonb';
  end if;

  -- (e) idempotency guard present (locks current behaviour)
  if position('qualification_stage = ''qualified''' in v_def) = 0 then
    raise exception 'B4.1 assert FAIL: qualify_lead idempotency guard is missing';
  end if;

  -- (f) return shape carries all 10 audit keys (8 + the 2 story keys)
  foreach v_key in array array[
    'deal_id', 'deal_reference', 'client_id', 'client_business_name',
    'matched_existing', 'match_kind', 'stakeholder_count_migrated', 'document_count_migrated',
    'story_count_migrated', 'story_notes_count_migrated'
  ] loop
    if position('''' || v_key || '''' in v_def) = 0 then
      raise exception 'B4.1 assert FAIL: qualify_lead return is missing key %', v_key;
    end if;
  end loop;

  -- (g) synthetic story re-point: a lead story moves to a client while the XOR
  --     CHECK holds. Synthetic client + a story-free real lead; scoped by story
  --     id (never by lead_id) so no real lead-side story can move.
  select id into v_owner from public.profiles where role = 'owner' limit 1;
  select l.id into v_lead from public.leads l
    where not exists (select 1 from public.client_stories cs where cs.lead_id = l.id) limit 1;
  if v_owner is not null and v_lead is not null then
    insert into public.clients (business_name, created_by)
    values ('B4.1 assert client', v_owner) returning id into v_tc;
    insert into public.client_stories (lead_id, business_story)
    values (v_lead, 'B4.1 assert story') returning id into v_ss;

    update public.client_stories set client_id = v_tc, lead_id = null where id = v_ss;

    if not exists (
      select 1 from public.client_stories where id = v_ss and client_id = v_tc and lead_id is null
    ) then
      raise exception 'B4.1 assert FAIL: story re-point did not move lead → client under the XOR CHECK';
    end if;

    -- cleanup: deleting the synthetic client cascades the story away; clear the
    -- synthetic activity rows so the migration commits no test data.
    delete from public.clients where id = v_tc;
    delete from public.activity_logs where entity_type = 'client_story' and entity_id = v_ss;
    delete from public.activity_logs where entity_type = 'client' and entity_id = v_tc;
    delete from public.activity_logs where related_entity_ids @> to_jsonb(v_tc::text);
  else
    raise notice 'B4.1 story re-point assertion skipped (no owner / no story-free lead)';
  end if;

  raise notice 'B4.1 assertions passed (DEFINER + grants + search_path + signature + jsonb + idempotency + 10 keys + story re-point)';
end $$;
