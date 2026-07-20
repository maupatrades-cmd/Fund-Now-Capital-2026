-- B6.1 — Stakeholders schema (SPEC S3a).
--
-- Directors, shareholders, sureties, key persons, signatories + beneficial
-- owners (FICA) for a client or a pre-qualification lead — with SA ID (Luhn,
-- via B5.1) OR passport (+ ISO country) support. Owner-locked decisions
-- (2026-07-20): (1) one row PER PERSON with a roles[] array; (2) shareholding
-- total >100% warns in the UI, never blocks (no DB rule); (3) passport country
-- is an ISO alpha-2 code from a dropdown; (4) beneficial-owner auto-suggested at
-- >=25% in the UI, owner-overridable (the DB stores the owner's final bool);
-- (5) no ownership backfill of existing clients.
--
-- This slice is SCHEMA ONLY. The qualify_lead lead->client stakeholder
-- re-pointer + legacy-contact signatory auto-create (SPEC S3a) land with the
-- lead-side UI (B6.2) so this migration never re-touches the just-hotfixed
-- qualify_lead. client_stakeholders is a NEW empty table, so its FKs are inline
-- and VALID (the NOT VALID + CONCURRENTLY dance is only for populated tables).

-- ===========================================================================
-- 1. Enums (guarded for replay safety — no CREATE TYPE IF NOT EXISTS).
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'stakeholder_id_type') then
    create type public.stakeholder_id_type as enum ('sa_id', 'passport');
  end if;
  if not exists (select 1 from pg_type where typname = 'stakeholder_role') then
    create type public.stakeholder_role as enum
      ('director', 'shareholder', 'surety', 'key_person', 'signatory');
  end if;
end $$;

-- ===========================================================================
-- 2. client_stakeholders — one row per person (roles[] carries every hat).
-- ===========================================================================
create table if not exists public.client_stakeholders (
  id                   uuid primary key default gen_random_uuid(),
  -- Owning entity: exactly one of client / lead (XOR, documents pattern).
  client_id            uuid references public.clients(id) on delete cascade,
  lead_id              uuid references public.leads(id)   on delete cascade,
  full_name            text not null,
  id_type              public.stakeholder_id_type not null,
  -- SA ID (Luhn-validated app-side, B5.1) OR passport number (free-text 6-12
  -- alphanumeric app-side). Nullable at the DB layer — capture may be partial.
  id_number            text,
  -- ISO 3166 alpha-2, only for passports (decision 3). CHECK ties it to id_type.
  passport_country     text,
  roles                public.stakeholder_role[] not null,
  shareholding_percent numeric(5,2),
  is_beneficial_owner  boolean not null default false,
  cell                 text,
  email                text,
  physical_address     text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by           uuid references public.profiles(id) on delete restrict,

  constraint client_stakeholders_owner_xor
    check (num_nonnulls(lead_id, client_id) = 1),
  -- passport => country present; sa_id => country absent.
  constraint client_stakeholders_passport_country
    check (
      (id_type = 'passport' and passport_country is not null) or
      (id_type = 'sa_id'    and passport_country is null)
    ),
  -- at least one role (empty array must be rejected — array_length('{}') is NULL,
  -- so coalesce to 0 or the CHECK would pass on a NULL result).
  constraint client_stakeholders_roles_nonempty
    check (coalesce(array_length(roles, 1), 0) >= 1),
  constraint client_stakeholders_shareholding_range
    check (shareholding_percent is null or (shareholding_percent >= 0 and shareholding_percent <= 100)),
  -- a shareholder must carry a percentage (decision 1 corollary).
  constraint client_stakeholders_shareholder_needs_pct
    check (not ('shareholder'::public.stakeholder_role = any (roles)) or shareholding_percent is not null)
);

-- FK / partner-view-join support (new empty table → plain CREATE INDEX is safe).
create index if not exists client_stakeholders_client_idx
  on public.client_stakeholders (client_id) where client_id is not null;
create index if not exists client_stakeholders_lead_idx
  on public.client_stakeholders (lead_id) where lead_id is not null;

-- ===========================================================================
-- 3. updated_at / updated_by stamp (BEFORE UPDATE).
-- ===========================================================================
create or replace function public.client_stakeholders_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

drop trigger if exists client_stakeholders_touch on public.client_stakeholders;
create trigger client_stakeholders_touch
  before update on public.client_stakeholders
  for each row execute function public.client_stakeholders_touch();

-- ===========================================================================
-- 4. RLS. Owner has full access to the base table (which holds PII — ID/passport
--    numbers, cell, email, address). Partners get NO direct base-table access;
--    they read a PII-safe projection of their referred entities' stakeholders
--    via public.partner_stakeholders_view (below). Partner writes are Phase D.
-- ===========================================================================
alter table public.client_stakeholders enable row level security;

drop policy if exists client_stakeholders_owner_all on public.client_stakeholders;
create policy client_stakeholders_owner_all on public.client_stakeholders
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Pin created_by to the caller on INSERT (RESTRICTIVE → AND-composes with the
-- owner policy; the column default fills it, a spoofed value is rejected).
drop policy if exists client_stakeholders_created_by_is_caller on public.client_stakeholders;
create policy client_stakeholders_created_by_is_caller on public.client_stakeholders
  as restrictive for insert to authenticated
  with check (created_by = (select auth.uid()));

-- ===========================================================================
-- 5. Partner-safe projection (POPIA). A referring partner sees only
--    full_name / roles / shareholding_percent for stakeholders of their OWN
--    referred clients/leads — never id_number, passport_country, cell, email,
--    physical_address, is_beneficial_owner, or notes. Runs with the view
--    owner's privileges (security_invoker off) to read the owner-only base
--    table; security_barrier blocks predicate push-down leaks; the WHERE
--    enforces scope. (Same pattern as partner_leads_view.)
-- ===========================================================================
create or replace view public.partner_stakeholders_view
with (security_barrier = true) as
  select
    s.id,
    s.client_id,
    s.lead_id,
    s.full_name,
    s.roles,
    s.shareholding_percent
  from public.client_stakeholders s
  left join public.clients c on c.id = s.client_id
  left join public.leads   l on l.id = s.lead_id
  where public.is_owner()
     or c.referral_partner_id = public.current_partner_id()
     or l.referral_partner_id = public.current_partner_id();

comment on view public.partner_stakeholders_view is
  'Partner-safe projection of client_stakeholders: full_name, roles, shareholding_percent for the partner''s own referred clients/leads only. Excludes all PII (id_number, passport_country, cell, email, physical_address), is_beneficial_owner, and notes. Owner reads the base table directly.';

grant select on public.partner_stakeholders_view to authenticated;

-- ===========================================================================
-- 6. Activity logging (A10) — extend the shared log_activity() with a
--    client_stakeholder branch (linked to the owning client/lead so events
--    surface on that entity's Activity tab). Everything else is unchanged
--    (re-declared in full from 20260719140000 with only the new branch added).
--    NOTE: before/after snapshots capture stakeholder PII — activity_logs is
--    owner-only (RLS) and the F10 POPIA redaction follow-up covers it, same as
--    leads/clients/contacts today.
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
    v_related := jsonb_build_array(coalesce(nv->>'client_id', ov->>'client_id'));
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

drop trigger if exists log_activity_client_stakeholders on public.client_stakeholders;
create trigger log_activity_client_stakeholders
  after insert or update or delete on public.client_stakeholders
  for each row execute function public.log_activity();

-- ===========================================================================
-- 7. Assertions — constraint rejections, a happy-path insert + activity log,
--    and the partner view's PII exclusion. RAISEs (rolls back) on any mismatch.
--    The happy-path row + its activity_logs rows are cleaned up so the migration
--    commits no test data.
-- ===========================================================================
do $$
declare
  v_client uuid;
  v_owner  uuid;
  v_sid    uuid;
  v_cols   int;
begin
  -- Enum values present.
  if (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'stakeholder_role') <> 5 then
    raise exception 'stakeholder assert FAIL: stakeholder_role should have 5 values';
  end if;

  select id into v_owner  from public.profiles where role = 'owner' limit 1;
  select id into v_client from public.clients limit 1;
  if v_owner is null or v_client is null then
    raise notice 'stakeholder assertions skipped (no owner / no client)';
    return;
  end if;

  -- (a) passport without country → rejected.
  begin
    insert into public.client_stakeholders (client_id, full_name, id_type, roles, created_by)
    values (v_client, 'Test', 'passport', array['director']::public.stakeholder_role[], v_owner);
    raise exception 'stakeholder assert FAIL: passport without country accepted';
  exception when check_violation then null; end;

  -- (b) sa_id WITH country → rejected.
  begin
    insert into public.client_stakeholders (client_id, full_name, id_type, passport_country, roles, created_by)
    values (v_client, 'Test', 'sa_id', 'GB', array['director']::public.stakeholder_role[], v_owner);
    raise exception 'stakeholder assert FAIL: sa_id with country accepted';
  exception when check_violation then null; end;

  -- (c) empty roles → rejected.
  begin
    insert into public.client_stakeholders (client_id, full_name, id_type, roles, created_by)
    values (v_client, 'Test', 'sa_id', array[]::public.stakeholder_role[], v_owner);
    raise exception 'stakeholder assert FAIL: empty roles accepted';
  exception when check_violation then null; end;

  -- (d) shareholder without a percentage → rejected.
  begin
    insert into public.client_stakeholders (client_id, full_name, id_type, roles, created_by)
    values (v_client, 'Test', 'sa_id', array['shareholder']::public.stakeholder_role[], v_owner);
    raise exception 'stakeholder assert FAIL: shareholder without percent accepted';
  exception when check_violation then null; end;

  -- (e) shareholding out of range → rejected.
  begin
    insert into public.client_stakeholders (client_id, full_name, id_type, roles, shareholding_percent, created_by)
    values (v_client, 'Test', 'sa_id', array['shareholder']::public.stakeholder_role[], 150, v_owner);
    raise exception 'stakeholder assert FAIL: shareholding 150%% accepted';
  exception when check_violation then null; end;

  -- (f) neither client nor lead (num_nonnulls = 0) → rejected.
  begin
    insert into public.client_stakeholders (full_name, id_type, roles, created_by)
    values ('Test', 'sa_id', array['director']::public.stakeholder_role[], v_owner);
    raise exception 'stakeholder assert FAIL: no owning entity accepted';
  exception when check_violation then null; end;

  -- (g) happy path: a valid multi-role shareholder-director inserts + logs.
  insert into public.client_stakeholders
    (client_id, full_name, id_type, id_number, roles, shareholding_percent, is_beneficial_owner, created_by)
  values
    (v_client, 'B6.1 Assert Person', 'sa_id', '8001015009087',
     array['director','shareholder']::public.stakeholder_role[], 30, true, v_owner)
  returning id into v_sid;

  if not exists (
    select 1 from public.activity_logs
    where entity_type = 'client_stakeholder' and entity_id = v_sid and event_type = 'CREATE'
  ) then
    raise exception 'stakeholder assert FAIL: CREATE not activity-logged';
  end if;

  -- (h) partner view exposes exactly the safe columns (no PII / no beneficial flag).
  select count(*) into v_cols from information_schema.columns
  where table_schema = 'public' and table_name = 'partner_stakeholders_view';
  if v_cols <> 6 then
    raise exception 'stakeholder assert FAIL: partner view should expose 6 columns, has %', v_cols;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'partner_stakeholders_view'
      and column_name in ('id_number','passport_country','cell','email','physical_address','is_beneficial_owner','notes')
  ) then
    raise exception 'stakeholder assert FAIL: partner view leaks a PII/excluded column';
  end if;

  -- cleanup: remove the synthetic row + its activity rows so nothing commits.
  delete from public.client_stakeholders where id = v_sid;
  delete from public.activity_logs where entity_type = 'client_stakeholder' and entity_id = v_sid;

  raise notice 'stakeholder B6.1 assertions passed';
end $$;

notify pgrst, 'reload schema';
