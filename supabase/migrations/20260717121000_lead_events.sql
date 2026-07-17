-- B2.3 (part 2 of 3) — lead-event integrity, activity logging & notifications.
--
-- Three pieces (SPEC S2 / S4 / S5), all additive — no new columns:
--
--   1. Duplicate detection at lead entry:
--      - find_lead_duplicates(): read-only advisory lookup (name similarity ≥
--        0.75, exact CIPC / email / cell) across leads + clients, used by the
--        Add-Lead form for its soft warnings.
--      - leads_cipc_block trigger: the ONE hard rule — an exact CIPC match
--        against another lead is a legal-identity collision and is rejected
--        server-side (the client-side warning can be bypassed; this cannot).
--
--   2. Activity logging on lead events: attaches the existing A10 log_activity()
--      trigger to leads (deferred in A10 until the table existed) and teaches the
--      function a `lead` branch — CREATE / UPDATE, and a QUALIFICATION event on a
--      qualification_stage transition (linking the created deal when qualified).
--
--   3. Notifications on lead events: LEAD_STARTED_QUALIFICATION / LEAD_QUALIFIED /
--      LEAD_NOT_QUALIFIED / LEAD_UPDATED / LEAD_CREATED_FOR_YOU via the A11/A12
--      emit_in_app_notification path (in-app + async email). Owner always; the
--      referring partner too on qualify / not-qualify (reason only, never notes —
--      matches partner_leads_view PII rules); LEAD_CREATED_FOR_YOU to the loaded-
--      on-behalf referrer. Partners have no login yet (Phase D) — notifications
--      land in their row silently, which is expected.
--
-- pg_trgm is enabled here; its GIN indexes are built CONCURRENTLY in the
-- follow-up 20260717122000 (CONCURRENTLY cannot run inside this migration's
-- transaction). The lookup works without them (seq scan on small tables).

-- Install into the `extensions` schema (Supabase convention) so its functions
-- and operator classes are resolvable when a SECURITY-scoped function runs with
-- search_path = '' — the similarity() calls below are extensions-qualified to match.
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 1a. Duplicate lookup (advisory). Read-only, SECURITY INVOKER so RLS applies
--     (owner sees all; this is an owner-only entry surface). Returns one row per
--     match with a severity: 'block' ONLY for an exact CIPC match against another
--     lead (mirrors the hard-block trigger below); everything else is 'warn'.
-- ---------------------------------------------------------------------------
create or replace function public.find_lead_duplicates(
  p_business_name text,
  p_cipc          text default null,
  p_email         text default null,
  p_cell          text default null,
  p_exclude_lead_id uuid default null
)
returns table (
  match_kind    text,   -- cipc | name | email | cell
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
  -- Positional ORDER BY: the UNION's first branch uses unnamed literals, so refer
  -- to columns by position (2 = severity, 6 = similarity). 'block' sorts before
  -- 'warn' alphabetically, so blocks surface first.
  order by 2, 6 desc;
$$;

grant execute on function public.find_lead_duplicates(text, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1b. CIPC hard-block trigger. A CIPC number is a unique legal identifier, so a
--     second lead with the same one is the same legal entity — rejected. Runs
--     only when cipc_number is present and being set/changed. This is the
--     authoritative guard; the client-side warning is advisory only.
-- ---------------------------------------------------------------------------
create or replace function public.leads_cipc_block()
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
  -- Compare on btrim() to match the partial UNIQUE INDEX on btrim(cipc_number)
  -- (20260717122000): the index is the race-proof guarantee, this trigger is the
  -- friendly message. Both must normalise identically or they'd disagree.
  select l.business_name into v_existing
    from public.leads l
   where btrim(l.cipc_number) = btrim(new.cipc_number)
     and l.id <> new.id
   limit 1;
  if v_existing is not null then
    raise exception
      'A lead already exists for this CIPC number — %. Open the existing lead instead.', v_existing
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

create trigger leads_cipc_block
  before insert or update of cipc_number on public.leads
  for each row execute function public.leads_cipc_block();

-- ---------------------------------------------------------------------------
-- 2. Activity logging: extend the A10 log_activity() with a `lead` branch and
--    attach the trigger. (Re-declared in full from 20260714140000 with only the
--    leads branch added — the other five entities' behaviour is unchanged.)
-- ---------------------------------------------------------------------------
create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  -- Actor identity (best-effort; null user_id = system / no session).
  if v_uid is not null then
    select p.email, p.role into v_email, v_role from public.profiles p where p.id = v_uid;
  end if;

  -- Row snapshots + entity id.
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

  -- Field-level diff on UPDATE (ignore bookkeeping columns).
  if tg_op = 'UPDATE' then
    select jsonb_agg(k), jsonb_object_agg(k, ov->k), jsonb_object_agg(k, nv->k)
      into v_changed, v_before, v_after
    from jsonb_object_keys(nv) as k
    where (nv->k) is distinct from (ov->k)
      and k not in ('updated_at');

    -- Nothing meaningful changed (only bookkeeping columns like updated_at):
    -- skip the audit row entirely. Only reachable for UPDATE — INSERT/DELETE
    -- legitimately have no diff and must still be logged.
    if v_changed is null then
      return null;
    end if;
  end if;

  v_event := case tg_op when 'INSERT' then 'CREATE' when 'UPDATE' then 'UPDATE' else 'DELETE' end::public.activity_event_type;

  -- Per-entity type, description, related ids, and domain event overrides.
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
      -- Link the deal that qualify_lead() created (it exists by the time this
      -- AFTER trigger fires) so the lead and its deal cross-reference.
      if (nv->>'qualification_stage') = 'qualified' then
        v_related := (select jsonb_build_array(d.id) from public.deals d where d.lead_id = v_eid limit 1);
      end if;
    else
      v_desc := 'Lead ' || coalesce(nv->>'business_name', ov->>'business_name', '?') || ' ' || v_verb;
    end if;

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
$$;

create trigger log_activity_leads
  after insert or update or delete on public.leads
  for each row execute function public.log_activity();

-- ---------------------------------------------------------------------------
-- 3. Lead-event notifications.
-- ---------------------------------------------------------------------------

-- Resolve a referral partner's profile WITHOUT the owner fallback that
-- notify_recipient() applies — the partner legs must not silently re-target the
-- owner. Returns null when the partner has no profile yet (Phase D); emit skips.
create or replace function public.partner_profile_id(p_referral_partner_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p
   where p.referral_partner_id = p_referral_partner_id and p.role = 'partner'
   limit 1;
$$;
revoke execute on function public.partner_profile_id(uuid) from public, anon, authenticated;

-- LEAD_CREATED_FOR_YOU — its own INSERT trigger (activates the A11 placeholder,
-- which predicted exactly this trigger name). Fires when a lead is LOADED on
-- behalf of a referrer, not later at qualify time — one function per event,
-- consistent with the notify_deal_* / notify_commission_paid pattern.
create or replace function public.notify_lead_created_for_you()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner uuid;
begin
  if new.loaded_on_behalf and new.original_referrer_id is not null then
    v_partner := public.partner_profile_id(new.original_referrer_id);
    -- Partner receives the LEAD's business_name only — no contact PII (mirrors
    -- the partner PII contract on notify_lead_events).
    perform public.emit_in_app_notification(
      v_partner, 'LEAD_CREATED_FOR_YOU', 'A new lead has been loaded for you',
      'A new lead, ' || new.business_name || ', has been loaded on your behalf.',
      '/leads/' || new.id::text, jsonb_build_object('lead_id', new.id));
  end if;
  return null;
end;
$$;
revoke execute on function public.notify_lead_created_for_you() from public, anon, authenticated;

create trigger notify_lead_created_for_you
  after insert on public.leads
  for each row execute function public.notify_lead_created_for_you();

-- Qualification-lifecycle notifications on UPDATE: STARTED_QUALIFICATION,
-- QUALIFIED, NOT_QUALIFIED (each with its partner leg where applicable), and the
-- catch-all LEAD_UPDATED for any other edit.
--
-- PARTNER PII CONTRACT (partner legs only — the owner sees everything):
--   * The business identifier is ALWAYS `new.business_name` — the LEAD's name,
--     i.e. the business the partner referred, never the client record we may
--     create at qualification. (Usually the same string; semantically the
--     partner is told about "the business I referred".)
--   * Partner bodies carry ONLY: business_name + (not-qualified) the reason
--     CATEGORY. They NEVER carry contact_name / contact_id_number / contact_cell
--     / contact_email / contact_role, physical/registered address, initial_notes,
--     not_qualified_notes, or any funder identity. This mirrors partner_leads_view.
create or replace function public.notify_lead_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner   uuid := (select p.id from public.profiles p where p.role = 'owner' order by p.created_at limit 1);
  v_partner uuid;
  v_reason  text;
  v_ref     text;
  v_link    text := '/leads/' || new.id::text;
  v_data    jsonb := jsonb_build_object('lead_id', new.id);
begin
  -- UPDATE with a qualification-stage transition → the matching stage event(s).
  if new.qualification_stage is distinct from old.qualification_stage then
    if new.qualification_stage = 'under_qualification' then
      perform public.emit_in_app_notification(
        v_owner, 'LEAD_STARTED_QUALIFICATION', 'Lead qualification started',
        new.business_name || ' has moved into qualification.', v_link, v_data);

    elsif new.qualification_stage = 'qualified' then
      select d.reference into v_ref from public.deals d where d.lead_id = new.id limit 1;
      perform public.emit_in_app_notification(
        v_owner, 'LEAD_QUALIFIED', 'Lead qualified',
        new.business_name || ' has been qualified' || coalesce(' — deal ' || v_ref, '') || '.',
        v_link, v_data);
      -- Partner leg (not self-referred): LEAD business_name only + progressing
      -- message. No contact PII, no funder identity (see PII contract above).
      if new.referred_by <> 'self' and new.referral_partner_id is not null then
        v_partner := public.partner_profile_id(new.referral_partner_id);
        perform public.emit_in_app_notification(
          v_partner, 'LEAD_QUALIFIED', 'Your lead was qualified',
          new.business_name || ' has been qualified and is now progressing.', v_link, v_data);
      end if;

    elsif new.qualification_stage = 'not_qualified' then
      -- Prettify the reason enum for display (e.g. no_cipc → "No CIPC").
      v_reason := replace(initcap(replace(coalesce(new.not_qualified_reason::text, 'unspecified'), '_', ' ')), 'Cipc', 'CIPC');
      perform public.emit_in_app_notification(
        v_owner, 'LEAD_NOT_QUALIFIED', 'Lead not qualified',
        new.business_name || ' was not qualified. Reason: ' || v_reason
          || coalesce('. Notes: ' || new.not_qualified_notes, '') || '.',
        v_link, v_data);
      -- Partner leg: LEAD business_name + reason CATEGORY only. NEVER
      -- not_qualified_notes or any contact PII (owner-internal; excluded from
      -- partner_leads_view). See PII contract above.
      if new.referred_by <> 'self' and new.referral_partner_id is not null then
        v_partner := public.partner_profile_id(new.referral_partner_id);
        perform public.emit_in_app_notification(
          v_partner, 'LEAD_NOT_QUALIFIED', 'Update on your lead',
          new.business_name || ' was not qualified. Reason: ' || v_reason || '.', v_link, v_data);
      end if;
    end if;

  else
    -- Non-stage edit → owner-only LEAD_UPDATED (email suppressed by default via
    -- the preference seed below; too noisy to email or to send to a partner).
    perform public.emit_in_app_notification(
      v_owner, 'LEAD_UPDATED', 'Lead updated',
      new.business_name || ' was updated.', v_link, v_data);
  end if;

  return null;
end;
$$;
revoke execute on function public.notify_lead_events() from public, anon, authenticated;

create trigger notify_lead_events
  after update on public.leads
  for each row execute function public.notify_lead_events();

-- ---------------------------------------------------------------------------
-- Owner preference seed for the new lead events. Email ON for the three
-- partner-relevant milestones (they reuse the deal_approved / welcome layouts),
-- OFF for the two owner-only signals (STARTED_QUALIFICATION / UPDATED) so the
-- owner isn't emailed for her own routine edits. in_app is always on. Seeds only
-- MISSING rows (never overwrites an opt-out). LEAD_CREATED_FOR_YOU already has an
-- owner row from the A12 backfill.
-- ---------------------------------------------------------------------------
insert into public.notification_preferences (user_id, event_type, in_app_enabled, email_enabled)
select p.id, v.event_type, true, v.email_enabled
  from public.profiles p
  cross join (values
    ('LEAD_QUALIFIED'::public.notification_event_type, true),
    ('LEAD_NOT_QUALIFIED'::public.notification_event_type, true),
    ('LEAD_STARTED_QUALIFICATION'::public.notification_event_type, false),
    ('LEAD_UPDATED'::public.notification_event_type, false)
  ) as v(event_type, email_enabled)
 where p.role = 'owner'
on conflict (user_id, event_type) do nothing;
