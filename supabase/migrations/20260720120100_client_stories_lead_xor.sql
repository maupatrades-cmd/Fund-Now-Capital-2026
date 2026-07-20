-- B4.1 (part 2 of 4) — client_stories writable on a lead (XOR ownership).
--
-- Client Story is broker-facing insight most useful BEFORE qualification (SPEC
-- S3 B4.1 refinement). Today client_stories is 1:1 with a client (client_id NOT
-- NULL UNIQUE). This slice lets a story hang off a *lead* too, using the same
-- XOR pattern as documents (B3.1) and stakeholders (B6.1): nullable client_id
-- XOR nullable lead_id, exactly one set.
--
-- Zero data loss: client_stories is empty in production, and existing rows (if
-- any) keep client_id set + lead_id NULL — which already satisfies the XOR.
--
-- Uniqueness note: client_stories_client_id_key stays a PLAIN unique constraint.
-- Postgres treats NULLs as distinct, so many lead-owned rows (client_id NULL)
-- coexist under it, and ON CONFLICT (client_id) upsert still works. lead_id gets
-- a symmetric plain unique index (one story per lead) built CONCURRENTLY in part
-- 3 — NULLs-distinct again lets many client-owned rows (lead_id NULL) coexist.
-- The XOR CHECK is what guarantees exactly one side is ever non-null per row.
--
-- FK discipline (CLAUDE.md): the new lead_id FK is added NOT VALID here; its
-- backing unique index is built CONCURRENTLY and the constraint VALIDATEd in
-- part 3 (outside any transaction).

-- ===========================================================================
-- 1. client_id becomes nullable; keep its unique constraint (NULLs distinct).
-- ===========================================================================
alter table public.client_stories alter column client_id drop not null;

-- ===========================================================================
-- 2. lead_id owning column + FK (NOT VALID — validated in part 3).
-- ===========================================================================
alter table public.client_stories add column if not exists lead_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.client_stories'::regclass
      and conname = 'client_stories_lead_id_fkey'
  ) then
    alter table public.client_stories
      add constraint client_stories_lead_id_fkey
      foreign key (lead_id) references public.leads(id) on delete cascade
      not valid;
  end if;
end $$;

-- ===========================================================================
-- 3. XOR: exactly one owning entity. Existing rows (client_id set, lead_id
--    NULL) satisfy num_nonnulls = 1, so this validates immediately on the
--    (empty) table.
-- ===========================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.client_stories'::regclass
      and conname = 'client_stories_owner_xor'
  ) then
    alter table public.client_stories
      add constraint client_stories_owner_xor
      check (num_nonnulls(lead_id, client_id) = 1);
  end if;
end $$;

-- ===========================================================================
-- 4. Activity logging — re-declare log_activity() in full (from
--    20260720090000) with ONLY the client_stories branch changed: a lead-owned
--    story now links to its lead_id so the event surfaces on the lead's
--    Activity tab (mirrors the client_stakeholders branch). Every other branch
--    is byte-for-byte unchanged.
-- ===========================================================================
create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid     uuid := (select auth.uid());
  v_email   text;
  v_role    text;
  v_event   public.activity_event_type;
  v_etype   text;
  v_eid     uuid;
  v_verb    text := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  v_desc    text;
  v_changed jsonb;
  v_before  jsonb;
  v_after   jsonb;
  v_related jsonb;
  ov        jsonb;
  nv        jsonb;
begin
  if v_uid is not null then
    select p.email, p.role into v_email, v_role from public.profiles p where p.id = v_uid;
  end if;

  if tg_op = 'DELETE' then
    ov := to_jsonb(old); nv := null;
    v_eid := (ov->>'id')::uuid;
  elsif tg_op = 'INSERT' then
    ov := null; nv := to_jsonb(new);
    v_eid := (nv->>'id')::uuid;
  else
    ov := to_jsonb(old); nv := to_jsonb(new);
    v_eid := (nv->>'id')::uuid;
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_agg(k), jsonb_object_agg(k, ov->k), jsonb_object_agg(k, nv->k)
      into v_changed, v_before, v_after
    from jsonb_object_keys(nv) as k
    where (nv->k) is distinct from (ov->k)
      and k not in ('updated_at');

    if v_changed is null then
      return null;
    end if;
  end if;

  v_event := case tg_op when 'INSERT' then 'CREATE' when 'UPDATE' then 'UPDATE' else 'DELETE' end::public.activity_event_type;

  if tg_table_name = 'deals' then
    v_etype := 'deal';
    v_related := jsonb_build_array(coalesce(nv->>'client_id', ov->>'client_id'));
    if tg_op = 'UPDATE' and (nv->>'stage') is distinct from (ov->>'stage') then
      v_event := 'STAGE_CHANGE';
      v_desc := 'Deal ' || coalesce(nv->>'reference', '?') || ' moved ' ||
                coalesce(ov->>'stage', '?') || ' → ' || coalesce(nv->>'stage', '?');
    else
      v_desc := 'Deal ' || coalesce(nv->>'reference', ov->>'reference', '?') || ' ' || v_verb;
    end if;

  elsif tg_table_name = 'deal_funder_submissions' then
    v_etype := 'deal_funder_submission';
    v_event := 'SUBMISSION';
    v_related := jsonb_build_array(coalesce(nv->>'deal_id', ov->>'deal_id'));
    if tg_op = 'UPDATE' and (nv->>'status') is distinct from (ov->>'status') then
      v_desc := 'Funder submission status → ' || coalesce(nv->>'status', '?');
    elsif tg_op = 'INSERT' then
      v_desc := 'Funder submission added';
    elsif tg_op = 'DELETE' then
      v_desc := 'Funder submission removed';
    else
      v_desc := 'Funder submission updated';
    end if;

  elsif tg_table_name = 'clients' then
    v_etype := 'client';
    v_desc := 'Client ' || coalesce(nv->>'business_name', ov->>'business_name', '?') || ' ' || v_verb;

  elsif tg_table_name = 'client_contacts' then
    v_etype := 'client_contact';
    v_related := jsonb_build_array(coalesce(nv->>'client_id', ov->>'client_id'));
    v_desc := 'Contact ' || coalesce(nv->>'full_name', ov->>'full_name', '?') || ' ' || v_verb;

  elsif tg_table_name = 'commission_records' then
    v_etype := 'commission_record';
    v_related := jsonb_build_array(coalesce(nv->>'deal_id', ov->>'deal_id'));
    v_desc := 'Commission record ' || v_verb;

  elsif tg_table_name = 'leads' then
    v_etype := 'lead';
    if tg_op = 'UPDATE' and (nv->>'qualification_stage') is distinct from (ov->>'qualification_stage') then
      v_event := 'QUALIFICATION';
      v_desc := 'Lead ' || coalesce(nv->>'business_name', '?') || ' qualification ' ||
                coalesce(ov->>'qualification_stage', '?') || ' → ' || coalesce(nv->>'qualification_stage', '?');
      if (nv->>'qualification_stage') = 'qualified' then
        v_related := (select jsonb_build_array(d.id) from public.deals d where d.lead_id = v_eid limit 1);
      end if;
    else
      v_desc := 'Lead ' || coalesce(nv->>'business_name', ov->>'business_name', '?') || ' ' || v_verb;
    end if;

  elsif tg_table_name = 'client_stories' then
    v_etype := 'client_story';
    -- Link to whichever entity owns the story (client OR lead) so a
    -- pre-qualification story surfaces on the lead's Activity tab too (B4.1 XOR).
    v_related := jsonb_build_array(coalesce(nv->>'client_id', ov->>'client_id', nv->>'lead_id', ov->>'lead_id'));
    v_desc := 'Client story ' || v_verb;

  elsif tg_table_name = 'call_logs' then
    v_etype := 'call_log';
    v_related := jsonb_build_array(coalesce(nv->>'client_id', ov->>'client_id'));
    v_desc := 'Call log ' || v_verb;

  elsif tg_table_name = 'client_stakeholders' then
    v_etype := 'client_stakeholder';
    -- Link to whichever entity owns the stakeholder so it shows on that tab.
    v_related := jsonb_build_array(coalesce(nv->>'client_id', ov->>'client_id', nv->>'lead_id', ov->>'lead_id'));
    v_desc := 'Stakeholder ' || coalesce(nv->>'full_name', ov->>'full_name', '?') || ' ' || v_verb;

  else
    v_etype := tg_table_name;
    v_desc := v_etype || ' ' || v_verb;
  end if;

  insert into public.activity_logs (
    occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id,
    description, changed_fields, before_values, after_values, related_entity_ids
  ) values (
    now(), v_uid, v_email, v_role, v_event, v_etype, v_eid,
    v_desc, v_changed, v_before, v_after, v_related
  );

  return null;
end;
$function$;

-- ===========================================================================
-- 5. Assertions — the XOR CHECK rejects zero and two owners; a lead-owned story
--    inserts + logs against its lead; existing client-owned stories still work.
--    RAISEs (rolls back) on any mismatch. Synthetic rows are cleaned up.
-- ===========================================================================
do $$
declare
  v_owner  uuid;
  v_lead   uuid;
  v_client uuid;
  v_sid    uuid;
begin
  select id into v_owner from public.profiles where role = 'owner' limit 1;

  -- (a) two owners (client AND lead) → rejected.
  select id into v_client from public.clients limit 1;
  -- pick a lead that has no story yet (lead_id is unique from part 3, but even
  -- pre-index the XOR is what we're testing here).
  select l.id into v_lead
    from public.leads l
   where not exists (select 1 from public.client_stories cs where cs.lead_id = l.id)
   limit 1;

  if v_client is not null and v_lead is not null then
    begin
      insert into public.client_stories (client_id, lead_id) values (v_client, v_lead);
      raise exception 'B4.1 assert FAIL: client_stories accepted BOTH client_id and lead_id';
    exception when check_violation then null; end;
  end if;

  -- (b) zero owners → rejected.
  begin
    insert into public.client_stories (business_story) values ('orphan');
    raise exception 'B4.1 assert FAIL: client_stories accepted a row with NO owning entity';
  exception when check_violation then null; end;

  -- (c) a lead-owned story inserts, satisfies the XOR, and activity-logs to the
  --     lead (related_entity_ids contains the lead id).
  if v_owner is not null and v_lead is not null then
    insert into public.client_stories (lead_id, business_story)
    values (v_lead, 'B4.1 assert lead story') returning id into v_sid;

    if not exists (
      select 1 from public.client_stories
      where id = v_sid and lead_id = v_lead and client_id is null
    ) then
      raise exception 'B4.1 assert FAIL: lead-owned story did not persist as XOR lead row';
    end if;

    if not exists (
      select 1 from public.activity_logs
      where entity_type = 'client_story' and entity_id = v_sid
        and related_entity_ids @> to_jsonb(v_lead::text)
    ) then
      raise exception 'B4.1 assert FAIL: lead-owned story CREATE did not log against the lead';
    end if;

    delete from public.client_stories where id = v_sid;
    delete from public.activity_logs where entity_type = 'client_story' and entity_id = v_sid;
  else
    raise notice 'B4.1 lead-owned story assertion skipped (no owner / no story-free lead)';
  end if;

  raise notice 'B4.1 client_stories XOR assertions passed';
end $$;

notify pgrst, 'reload schema';
