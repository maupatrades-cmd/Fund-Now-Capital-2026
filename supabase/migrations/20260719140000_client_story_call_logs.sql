-- B4 Client Story + Call Logs — part 1 of 2: schema + logic (SPEC S3).
--
-- Adds the client narrative record (client_stories, 1:1 with clients), an
-- append-only "ongoing impressions" stream (client_story_notes, enforced
-- append-only by RLS: SELECT + INSERT policies only), a communications log
-- (call_logs), and a FOLLOW_UP_DUE sweep (owner notification when a logged
-- follow-up comes due, deduped via a once-per-call_log ledger).
--
-- All four tables are OWNER-ONLY (they hold personal/family narrative — POPIA
-- sensitive; partners never see client stories or call logs, now or in Phase D).
-- New empty tables, so FKs + indexes are inline (the NOT VALID + CONCURRENTLY
-- dance is only for adding FK COLUMNS to populated tables). The pg_cron schedule
-- lives in part 2 (20260719140100).

-- ===========================================================================
-- 1. call_medium enum (S3).
-- ===========================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'call_medium') then
    create type public.call_medium as enum ('call', 'whatsapp', 'meeting', 'email', 'message');
  end if;
end $$;

-- ===========================================================================
-- 2. client_stories — 1:1 narrative record. Fields are editable markdown text;
--    the never-overwritten "ongoing impressions" live in client_story_notes.
-- ===========================================================================
create table if not exists public.client_stories (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null unique references public.clients(id) on delete cascade,
  business_story       text,
  founder_background   text,
  business_origin      text,
  competitive_edge     text,
  aspirations          text,
  contact_story        text,
  family_context       text,
  personal_interests   text,
  language_preference  text,
  communication_style  text,
  assets_narrative     text,
  initial_assessment   text,
  concerns_flagged     text,
  opportunities_seen   text,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ===========================================================================
-- 3. client_story_notes — append-only "ongoing impressions" (S3: never
--    overwritten). Append-only is enforced by RLS below (SELECT + INSERT
--    policies only — no UPDATE/DELETE path through the API).
-- ===========================================================================
create table if not exists public.client_story_notes (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null references public.client_stories(id) on delete cascade,
  text       text not null,
  author_id  uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists client_story_notes_story_idx on public.client_story_notes (story_id, created_at);

-- ===========================================================================
-- 4. call_logs — communications log. A follow-up must carry a date so the sweep
--    can fire.
-- ===========================================================================
create table if not exists public.call_logs (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  call_date        date not null,
  call_time        time,
  medium           public.call_medium not null,
  duration_minutes integer,
  discussed_topics text,
  client_promises  text,
  thapelo_promises text,
  follow_up_needed boolean not null default false,
  follow_up_date   date,
  next_action      text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint call_logs_followup_needs_date check (not follow_up_needed or follow_up_date is not null)
);
create index if not exists call_logs_client_idx   on public.call_logs (client_id, call_date desc);
create index if not exists call_logs_followup_idx on public.call_logs (follow_up_date) where follow_up_needed;

-- ===========================================================================
-- 5. call_log_followup_alerts — once-per-call_log FOLLOW_UP_DUE dedup ledger
--    (mirrors the B3 document_expiry_alerts pattern; owner-read only, written by
--    the SECURITY DEFINER sweep).
-- ===========================================================================
create table if not exists public.call_log_followup_alerts (
  id          uuid primary key default gen_random_uuid(),
  call_log_id uuid not null unique references public.call_logs(id) on delete cascade,
  sent_at     timestamptz not null default now()
);

-- ===========================================================================
-- 6. RLS — owner-only everywhere. Stories + call logs are full CRUD; impressions
--    are SELECT + INSERT only (append-only); the alert ledger is SELECT only.
-- ===========================================================================
alter table public.client_stories           enable row level security;
alter table public.client_story_notes        enable row level security;
alter table public.call_logs                 enable row level security;
alter table public.call_log_followup_alerts  enable row level security;

drop policy if exists client_stories_owner_all on public.client_stories;
create policy client_stories_owner_all on public.client_stories
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists call_logs_owner_all on public.call_logs;
create policy call_logs_owner_all on public.call_logs
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Append-only impressions: SELECT + INSERT only, no UPDATE/DELETE policy, so a
-- recorded impression can never be edited or removed through the API (S3).
drop policy if exists client_story_notes_owner_read on public.client_story_notes;
create policy client_story_notes_owner_read on public.client_story_notes
  for select to authenticated using (public.is_owner());
drop policy if exists client_story_notes_owner_insert on public.client_story_notes;
create policy client_story_notes_owner_insert on public.client_story_notes
  for insert to authenticated with check (public.is_owner());

-- Owner-read audit ledger (written only by the SECURITY DEFINER sweep).
drop policy if exists call_log_followup_alerts_owner_read on public.call_log_followup_alerts;
create policy call_log_followup_alerts_owner_read on public.call_log_followup_alerts
  for select to authenticated using (public.is_owner());

-- ===========================================================================
-- 7. updated_at triggers (reuse the existing set_updated_at()).
-- ===========================================================================
drop trigger if exists set_updated_at on public.client_stories;
create trigger set_updated_at before update on public.client_stories
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.call_logs;
create trigger set_updated_at before update on public.call_logs
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 8. Activity logging (A10) — extend the shared log_activity() with branches for
--    client_stories + call_logs (singular entity_type + client linkage so events
--    surface on the client Activity tab). client_story_notes is deliberately NOT
--    logged here — the impressions stream is its own append-only audit trail.
--    Everything else in log_activity() is unchanged.
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

drop trigger if exists log_activity_client_stories on public.client_stories;
create trigger log_activity_client_stories after insert or update or delete on public.client_stories
  for each row execute function public.log_activity();
drop trigger if exists log_activity_call_logs on public.call_logs;
create trigger log_activity_call_logs after insert or update or delete on public.call_logs
  for each row execute function public.log_activity();

-- ===========================================================================
-- 9. followups_due() — detection (read-only, no emit — safe to call in the
--    assertions). Returns overdue follow-ups not yet alerted.
-- ===========================================================================
create or replace function public.followups_due(p_as_of date default current_date)
returns table (
  call_log_id    uuid,
  client_id      uuid,
  client_name    text,
  medium         public.call_medium,
  call_date      date,
  follow_up_date date,
  next_action    text
)
language sql
stable
security definer
set search_path to ''
as $$
  select cl.id, cl.client_id, coalesce(c.business_name, 'the client'),
         cl.medium, cl.call_date, cl.follow_up_date, cl.next_action
  from public.call_logs cl
  left join public.clients c on c.id = cl.client_id
  where cl.follow_up_needed
    and cl.follow_up_date is not null
    and cl.follow_up_date <= p_as_of
    and not exists (select 1 from public.call_log_followup_alerts a where a.call_log_id = cl.id);
$$;

-- ===========================================================================
-- 10. check_followups_due() — cron entry point. Claims each due follow-up in the
--     ledger BEFORE emitting (claim-then-act, so concurrent sweeps can't
--     double-send), then fires one owner FOLLOW_UP_DUE notification per claim.
-- ===========================================================================
create or replace function public.check_followups_due()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_owner   uuid := public.notify_owner();
  r         record;
  v_claimed boolean;
  v_body    text;
  v_medium  text;
  v_count   integer := 0;
begin
  if v_owner is null then
    return 0;
  end if;

  for r in select * from public.followups_due(current_date) loop
    insert into public.call_log_followup_alerts (call_log_id)
    values (r.call_log_id)
    on conflict (call_log_id) do nothing
    returning true into v_claimed;

    if not coalesce(v_claimed, false) then
      continue;  -- another sweep already claimed this follow-up
    end if;

    v_medium := replace(r.medium::text, '_', ' ');
    v_body := r.client_name || ' — ' || coalesce(nullif(btrim(r.next_action), ''), 'follow-up needed')
      || ' (from your ' || v_medium || ' on ' || to_char(r.call_date, 'DD Mon YYYY') || ').';

    perform public.emit_in_app_notification(
      v_owner, 'FOLLOW_UP_DUE', 'Follow-up due', v_body, '/clients/' || r.client_id::text,
      jsonb_build_object(
        'call_log_id',    r.call_log_id,
        'client_id',      r.client_id,
        'follow_up_date', r.follow_up_date
      ));
    v_count := v_count + 1;
  end loop;

  return v_count;
end; $$;

revoke execute on function public.followups_due(date)   from public, anon, authenticated;
revoke execute on function public.check_followups_due() from public, anon, authenticated;

-- ===========================================================================
-- 11. Owner FOLLOW_UP_DUE notification preference (email on by default, mutable).
-- ===========================================================================
insert into public.notification_preferences (user_id, event_type, in_app_enabled, email_enabled)
select p.id, 'FOLLOW_UP_DUE'::public.notification_event_type, true, true
  from public.profiles p
 where p.role = 'owner'
on conflict (user_id, event_type) do nothing;

-- ===========================================================================
-- 12. In-migration assertions (roll back on failure). Uses a synthetic client
--     and cleans up all synthetic rows (cascade + the client's activity rows).
--     Never calls check_followups_due() (which would emit a real email) — tests
--     the read-only followups_due() detection instead.
-- ===========================================================================
do $$
declare
  v_owner  uuid;
  v_client uuid;
  v_story  uuid;
  v_note   uuid;
  v_call   uuid;
begin
  select id into v_owner from public.profiles where role = 'owner' limit 1;
  if v_owner is null then
    raise notice 'B4 assertions skipped (no owner)';
    return;
  end if;

  insert into public.clients (business_name, created_by) values ('B4 assert client', v_owner) returning id into v_client;

  insert into public.client_stories (client_id) values (v_client) returning id into v_story;

  -- (a) one story per client
  begin
    insert into public.client_stories (client_id) values (v_client);
    raise exception 'B4 assert FAIL: client_stories must be unique per client';
  exception when unique_violation then null; end;

  insert into public.client_story_notes (story_id, text, author_id)
  values (v_story, 'first impression', v_owner) returning id into v_note;

  insert into public.call_logs (client_id, call_date, medium, follow_up_needed, follow_up_date, next_action, created_by)
  values (v_client, current_date - 1, 'call', true, current_date - 1, 'Send term sheet', v_owner) returning id into v_call;

  -- (b) an overdue follow-up is detected
  if not exists (select 1 from public.followups_due(current_date) where call_log_id = v_call) then
    raise exception 'B4 assert FAIL: overdue follow-up not detected'; end if;

  -- (c) dedup — once recorded, the same follow-up is no longer due
  insert into public.call_log_followup_alerts (call_log_id) values (v_call);
  if exists (select 1 from public.followups_due(current_date) where call_log_id = v_call) then
    raise exception 'B4 assert FAIL: dedup — recorded follow-up still due'; end if;

  -- (d) follow_up_needed requires a date
  begin
    insert into public.call_logs (client_id, call_date, medium, follow_up_needed)
    values (v_client, current_date, 'email', true);
    raise exception 'B4 assert FAIL: follow_up_needed without a date should violate the CHECK';
  exception when check_violation then null; end;

  -- cleanup (cascade from the client clears story/notes/call_logs/alerts)
  delete from public.clients where id = v_client;
  delete from public.activity_logs
   where entity_id in (v_client, v_story, v_call, v_note)
      or related_entity_ids @> to_jsonb(v_client::text);

  raise notice 'B4 client-story / call-log assertions passed';
end $$;

notify pgrst, 'reload schema';
