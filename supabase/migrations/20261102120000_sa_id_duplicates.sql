-- SA ID number as the identity for clients without a CIPC number (owner, 30 Oct 2026).
--
-- A company is identified by its CIPC registration number (already blocked twice:
-- leads_cipc_block / clients_cipc_block + their partial unique indexes). A sole
-- proprietor or individual has no CIPC number, so the SA ID number of the person
-- stands in for it. Duplicates on either are refused, so a second agent cannot
-- resubmit an agent's lead (non-circumvention).
--
-- Where the ID lives:
--   leads   → leads.contact_id_number (captured on every lead form).
--   clients → clients has no ID column. qualify_lead copies the lead's ID onto the
--             client's PRIMARY DIRECTOR contact (client_contacts.id_number,
--             is_primary_director). That row is the client's identity when the
--             client has no CIPC. No new column, no backfill, no copy of the ID.
--
-- Rules (only records WITHOUT a CIPC number take part — a director's ID on a
-- company is just a contact, and one person may run several companies):
--   1. leads_sa_id_block: a lead with no CIPC whose ID matches another OPEN lead
--      (new_lead / under_qualification) with no CIPC is refused. A qualified lead
--      is represented by its client; a not-qualified lead is closed.
--   2. client_contacts_sa_id_block: a primary director whose ID matches the
--      primary director of ANOTHER client with no CIPC is refused, while the
--      contact's own client has no CIPC. clients_sa_id_on_cipc_clear covers a
--      client whose CIPC number is removed.
--   3. qualify_lead Path A matches CIPC → SA ID → name, so a returning sole
--      trader re-points onto the existing client instead of hitting rule 2.
--   4. find_lead_duplicates reports SA ID matches (block vs open lead, warn vs
--      client) without ever returning the ID number.
-- Same as CIPC: no override. Concurrent saves of one ID are serialised with an
-- advisory lock (no unique index: the "open lead" rule depends on the stage, and
-- an index build would fail on any existing collision).
--
-- POPIA: messages and RPC rows never contain the ID number. Only the Director is
-- told which business holds it; everyone else gets a neutral message, because a
-- partner must not learn another agent's client.

-- ---------------------------------------------------------------------------
-- 1. Normalised SA ID: digits only, exactly 13, Luhn check digit valid. Anything
--    else is not an identity and never matches (a typo must not block a lead).
-- ---------------------------------------------------------------------------
create or replace function public.sa_id_normalise(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v   text := regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g');
  v_sum integer := 0;
  n   integer;
  i   integer;
begin
  if length(v) <> 13 then return null; end if;
  -- Luhn from the right: every second digit (from the check digit) is doubled.
  for i in 1..13 loop
    n := substr(v, i, 1)::integer;
    if (13 - i) % 2 = 1 then
      n := n * 2;
      if n > 9 then n := n - 9; end if;
    end if;
    v_sum := v_sum + n;
  end loop;
  if v_sum % 10 <> 0 then return null; end if;
  return v;
end;
$$;

revoke all on function public.sa_id_normalise(text) from public, anon;
grant execute on function public.sa_id_normalise(text) to authenticated;

-- The no-CIPC client (other than p_exclude_client_id) whose primary director holds
-- this normalised ID, if any. Internal.
create or replace function public.client_by_sa_id(p_sa_id text, p_exclude_client_id uuid default null)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
    from public.client_contacts cc
    join public.clients c on c.id = cc.client_id
   where p_sa_id is not null
     and cc.is_primary_director
     and nullif(btrim(c.cipc_number), '') is null
     and public.sa_id_normalise(cc.id_number) = p_sa_id
     and (p_exclude_client_id is null or c.id <> p_exclude_client_id)
   order by c.created_at nulls last, c.id
   limit 1;
$$;

revoke all on function public.client_by_sa_id(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Leads: refuse a second open lead for the same person.
-- ---------------------------------------------------------------------------
create or replace function public.leads_sa_id_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       text;
  v_existing text;
begin
  if nullif(btrim(new.cipc_number), '') is not null then return new; end if;
  if new.qualification_stage not in ('new_lead', 'under_qualification') then return new; end if;
  v_id := public.sa_id_normalise(new.contact_id_number);
  if v_id is null then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended('fnc_sa_id:' || v_id, 0));
  select l.business_name into v_existing
    from public.leads l
   where l.id <> new.id
     and nullif(btrim(l.cipc_number), '') is null
     and l.qualification_stage in ('new_lead', 'under_qualification')
     and public.sa_id_normalise(l.contact_id_number) = v_id
   limit 1;
  if v_existing is not null then
    if coalesce(public.is_owner(), false) then
      raise exception
        'A lead already exists for this ID number — %. Open the existing lead instead.', v_existing
        using errcode = 'unique_violation';
    end if;
    raise exception
      'This client has already been submitted to Fund Now Capital (same ID number). Please contact the office.'
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.leads_sa_id_block() from public, anon, authenticated;

drop trigger if exists leads_sa_id_block on public.leads;
create trigger leads_sa_id_block
  before insert or update of contact_id_number, cipc_number, qualification_stage on public.leads
  for each row execute function public.leads_sa_id_block();

-- ---------------------------------------------------------------------------
-- 3. Clients: refuse a second no-CIPC client for the same primary director.
-- ---------------------------------------------------------------------------
create or replace function public.client_contacts_sa_id_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       text;
  v_cipc     text;
  v_other    uuid;
  v_existing text;
begin
  if not new.is_primary_director then return new; end if;
  v_id := public.sa_id_normalise(new.id_number);
  if v_id is null then return new; end if;
  select c.cipc_number into v_cipc from public.clients c where c.id = new.client_id;
  if nullif(btrim(v_cipc), '') is not null then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended('fnc_sa_id:' || v_id, 0));
  v_other := public.client_by_sa_id(v_id, new.client_id);
  if v_other is not null then
    select c.business_name into v_existing from public.clients c where c.id = v_other;
    raise exception
      'A client already exists for this ID number — %. Open the existing client instead.', v_existing
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.client_contacts_sa_id_block() from public, anon, authenticated;

drop trigger if exists client_contacts_sa_id_block on public.client_contacts;
create trigger client_contacts_sa_id_block
  before insert or update of id_number, is_primary_director, client_id on public.client_contacts
  for each row execute function public.client_contacts_sa_id_block();

-- A client whose CIPC number is removed falls back to its primary director's ID.
create or replace function public.clients_sa_id_on_cipc_clear()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       text;
  v_other    uuid;
  v_existing text;
begin
  if nullif(btrim(new.cipc_number), '') is not null then return new; end if;
  if nullif(btrim(old.cipc_number), '') is null then return new; end if;
  for v_id in
    select distinct public.sa_id_normalise(cc.id_number)
      from public.client_contacts cc
     where cc.client_id = new.id and cc.is_primary_director
       and public.sa_id_normalise(cc.id_number) is not null
  loop
    perform pg_advisory_xact_lock(hashtextextended('fnc_sa_id:' || v_id, 0));
    v_other := public.client_by_sa_id(v_id, new.id);
    if v_other is not null then
      select c.business_name into v_existing from public.clients c where c.id = v_other;
      raise exception
        'Without a CIPC number this client has the same ID number as % — open the existing client instead.', v_existing
        using errcode = 'unique_violation';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.clients_sa_id_on_cipc_clear() from public, anon, authenticated;

drop trigger if exists clients_sa_id_on_cipc_clear on public.clients;
create trigger clients_sa_id_on_cipc_clear
  before update of cipc_number on public.clients
  for each row execute function public.clients_sa_id_on_cipc_clear();

-- ---------------------------------------------------------------------------
-- 4. find_lead_duplicates: + p_id_number. A new parameter changes the signature,
--    so the 5-argument version is dropped (an overload would make calls ambiguous).
--    The ID number is an input only; rows carry match_kind 'sa_id', never the ID.
-- ---------------------------------------------------------------------------
drop function if exists public.find_lead_duplicates(text, text, text, text, uuid);

create function public.find_lead_duplicates(
  p_business_name   text,
  p_cipc            text default null,
  p_email           text default null,
  p_cell            text default null,
  p_exclude_lead_id uuid default null,
  p_id_number       text default null
)
returns table (
  match_kind    text,   -- cipc | sa_id | name | email | cell
  severity      text,   -- block | warn
  entity        text,   -- lead | client
  entity_id     uuid,
  business_name text,
  similarity    real
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- Exact CIPC against another lead → hard block.
  select 'cipc', 'block', 'lead', l.id, l.business_name, 1.0::real
    from public.leads l
   where p_cipc is not null and btrim(p_cipc) <> ''
     and btrim(l.cipc_number) = btrim(p_cipc)
     and (p_exclude_lead_id is null or l.id <> p_exclude_lead_id)
  union all
  -- Exact CIPC against an existing client → warn (a repeat client may legitimately
  -- need a new lead; surfaced so the owner can open the client instead).
  select 'cipc', 'warn', 'client', c.id, c.business_name, 1.0::real
    from public.clients c
   where p_cipc is not null and btrim(p_cipc) <> ''
     and btrim(c.cipc_number) = btrim(p_cipc)
  union all
  -- No CIPC: SA ID against another OPEN no-CIPC lead → hard block (mirrors
  -- leads_sa_id_block).
  select 'sa_id', 'block', 'lead', l.id, l.business_name, 1.0::real
    from public.leads l
   where nullif(btrim(p_cipc), '') is null
     and public.sa_id_normalise(p_id_number) is not null
     and nullif(btrim(l.cipc_number), '') is null
     and l.qualification_stage in ('new_lead', 'under_qualification')
     and public.sa_id_normalise(l.contact_id_number) = public.sa_id_normalise(p_id_number)
     and (p_exclude_lead_id is null or l.id <> p_exclude_lead_id)
  union all
  -- No CIPC: SA ID against a no-CIPC client's primary director → warn (a repeat
  -- client; qualify re-points onto that client).
  select distinct 'sa_id', 'warn', 'client', c.id, c.business_name, 1.0::real
    from public.client_contacts cc
    join public.clients c on c.id = cc.client_id
   where nullif(btrim(p_cipc), '') is null
     and public.sa_id_normalise(p_id_number) is not null
     and cc.is_primary_director
     and nullif(btrim(c.cipc_number), '') is null
     and public.sa_id_normalise(cc.id_number) = public.sa_id_normalise(p_id_number)
  union all
  -- Fuzzy business-name similarity ≥ 0.75 → warn (leads).
  select 'name', 'warn', 'lead', l.id, l.business_name,
         extensions.similarity(lower(l.business_name), lower(p_business_name))
    from public.leads l
   where p_business_name is not null and btrim(p_business_name) <> ''
     and (p_exclude_lead_id is null or l.id <> p_exclude_lead_id)
     and extensions.similarity(lower(l.business_name), lower(p_business_name)) >= 0.75
  union all
  -- Fuzzy business-name similarity ≥ 0.75 → warn (clients).
  select 'name', 'warn', 'client', c.id, c.business_name,
         extensions.similarity(lower(c.business_name), lower(p_business_name))
    from public.clients c
   where p_business_name is not null and btrim(p_business_name) <> ''
     and extensions.similarity(lower(c.business_name), lower(p_business_name)) >= 0.75
  union all
  -- Exact contact email → warn (leads carry the contact email directly).
  select 'email', 'warn', 'lead', l.id, l.business_name, 1.0::real
    from public.leads l
   where p_email is not null and btrim(p_email) <> ''
     and lower(l.contact_email) = lower(btrim(p_email))
     and (p_exclude_lead_id is null or l.id <> p_exclude_lead_id)
  union all
  -- Exact contact cell (already normalised by the caller) → warn (leads).
  select 'cell', 'warn', 'lead', l.id, l.business_name, 1.0::real
    from public.leads l
   where p_cell is not null and btrim(p_cell) <> ''
     and l.contact_cell = btrim(p_cell)
     and (p_exclude_lead_id is null or l.id <> p_exclude_lead_id)
  -- Positional ORDER BY (2 = severity, 6 = similarity): blocks surface first.
  order by 2, 6 desc;
$$;

revoke all on function public.find_lead_duplicates(text, text, text, text, uuid, text) from public, anon;
grant execute on function public.find_lead_duplicates(text, text, text, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. qualify_lead — Path A now matches CIPC → SA ID → name. Re-declared in full
--    from the live definition (20260720120300, verified identical on live
--    2 Nov 2026); the only change is the SA ID branch and match_kind 'sa_id'.
-- ---------------------------------------------------------------------------
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
  v_match_kind        text;             -- 'cipc' | 'sa_id' | 'name' | null (new client)
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
  -- the SA ID for a lead with no CIPC (a sole trader / individual), then name.
  -- Re-point onto the matched client — never insert a duplicate.
  if v_lead.cipc_number is not null and btrim(v_lead.cipc_number) <> '' then
    select id into v_client_id from public.clients
     where btrim(cipc_number) = btrim(v_lead.cipc_number) limit 1;
    if v_client_id is not null then v_match_kind := 'cipc'; end if;
  elsif public.sa_id_normalise(v_lead.contact_id_number) is not null then
    v_client_id := public.client_by_sa_id(public.sa_id_normalise(v_lead.contact_id_number));
    if v_client_id is not null then v_match_kind := 'sa_id'; end if;
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
  -- An SA ID match logs only match_kind 'sa_id', never the ID number.
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
