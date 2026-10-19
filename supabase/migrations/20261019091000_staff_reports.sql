-- Administrator Batch 4 (Reports) (2/2). Owner specification 17 Oct 2026 (docs/FNC-ADMINISTRATOR-SPEC-2026-10-17.md,
-- sections 11 and 17). Forward-only.
--
--   1. Complaints log: any staff member logs a client or agent complaint. It is escalated to the Director the
--      moment it is logged, must be acknowledged (to the complainant) the same day, and is resolved by the
--      Founder or the Administrator.
--   2. Escalations: anything not resolved within 24 hours goes to the Director with a note. Staff can escalate
--      by hand (with a note); an hourly sweep escalates staff tasks still open 24 hours after they were created.
--      The Founder or the Administrator closes an escalation with a note.
--   3. Reports, read-only, for the Founder and the Administrator:
--        * the Director's daily briefing (today's bookings, open tasks, urgent items);
--        * the end-of-day report (files opened, documents received, leads assigned, tasks outstanding);
--        * the Friday report on progress toward 60 files a month (files opened, admin fees paid, documents
--          complete, deals in progress). No success-fee amounts, no money of any kind, no funders.
-- Complaints, escalations and their events are append-only. All access is through SECURITY DEFINER functions;
-- the tables have RLS on and no grants.

-- 0. Helpers ----------------------------------------------------------------------------------------------------
-- The Director (every active owner profile).
create or replace function public.staff_director_ids()
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.role::text = 'owner' and p.is_active;
$$;
revoke all on function public.staff_director_ids() from public, anon, authenticated;

create or replace function public.staff_require_founder_or_administrator()
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.staff_is_founder_or_administrator() then
    raise exception 'Only the Founder or the Administrator can do this' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.staff_require_founder_or_administrator() from public, anon, authenticated;

-- 1. Tables -----------------------------------------------------------------------------------------------------
create table if not exists public.staff_complaints (
  id               uuid primary key default gen_random_uuid(),
  complainant_kind text not null check (complainant_kind in ('client', 'agent', 'other')),
  complainant_name text not null check (length(btrim(complainant_name)) between 2 and 160),
  lead_id          uuid references public.leads(id) on delete restrict,
  details          text not null check (length(btrim(details)) between 10 and 2000),
  received_at      timestamptz not null,
  logged_by        uuid not null references public.profiles(id) on delete restrict,
  logged_role      text not null,
  created_at       timestamptz not null default now(),
  constraint staff_complaints_safe_text_ck
    check (public.staff_text_is_safe(complainant_name) and public.staff_text_is_safe(details))
);
create index if not exists staff_complaints_received_idx on public.staff_complaints (received_at desc);

create table if not exists public.staff_complaint_events (
  id           bigint generated always as identity primary key,
  complaint_id uuid not null references public.staff_complaints(id) on delete restrict,
  event        text not null check (event in ('acknowledged', 'resolved')),
  method       text check (method is null or method in ('phone', 'email', 'whatsapp', 'in_person')),
  note         text not null check (length(btrim(note)) between 3 and 1000),
  actor_id     uuid not null references public.profiles(id) on delete restrict,
  actor_role   text not null,
  at           timestamptz not null default now(),
  constraint staff_complaint_events_safe_text_ck check (public.staff_text_is_safe(note)),
  constraint staff_complaint_events_method_ck check ((event = 'acknowledged') = (method is not null))
);
create unique index if not exists staff_complaint_events_once_idx on public.staff_complaint_events (complaint_id, event);

create table if not exists public.staff_escalations (
  id          uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('task', 'complaint', 'manual')),
  source_id   uuid,
  lead_id     uuid references public.leads(id) on delete restrict,
  title       text not null check (length(btrim(title)) between 3 and 200),
  note        text not null check (length(btrim(note)) between 3 and 1000),
  automatic   boolean not null default false,
  raised_by   uuid references public.profiles(id) on delete restrict,
  raised_role text,
  created_at  timestamptz not null default now(),
  constraint staff_escalations_safe_text_ck check (public.staff_text_is_safe(title) and public.staff_text_is_safe(note)),
  constraint staff_escalations_source_ck check ((source_kind = 'manual') = (source_id is null)),
  constraint staff_escalations_raiser_ck check (automatic or raised_by is not null)
);
-- One escalation per task or complaint.
create unique index if not exists staff_escalations_source_idx on public.staff_escalations (source_kind, source_id)
  where source_id is not null;
create index if not exists staff_escalations_created_idx on public.staff_escalations (created_at desc);

create table if not exists public.staff_escalation_resolutions (
  escalation_id uuid primary key references public.staff_escalations(id) on delete restrict,
  note          text not null check (length(btrim(note)) between 3 and 1000),
  resolved_by   uuid not null references public.profiles(id) on delete restrict,
  resolved_role text not null,
  resolved_at   timestamptz not null default now(),
  constraint staff_escalation_resolutions_safe_text_ck check (public.staff_text_is_safe(note))
);

alter table public.staff_complaints enable row level security;
alter table public.staff_complaint_events enable row level security;
alter table public.staff_escalations enable row level security;
alter table public.staff_escalation_resolutions enable row level security;
revoke all on table public.staff_complaints from public, anon, authenticated;
revoke all on table public.staff_complaint_events from public, anon, authenticated;
revoke all on table public.staff_escalations from public, anon, authenticated;
revoke all on table public.staff_escalation_resolutions from public, anon, authenticated;
create trigger staff_complaints_append_only before update or delete on public.staff_complaints
  for each row execute function public.intake_append_only_guard();
create trigger staff_complaint_events_append_only before update or delete on public.staff_complaint_events
  for each row execute function public.intake_append_only_guard();
create trigger staff_escalations_append_only before update or delete on public.staff_escalations
  for each row execute function public.intake_append_only_guard();
create trigger staff_escalation_resolutions_append_only before update or delete on public.staff_escalation_resolutions
  for each row execute function public.intake_append_only_guard();

-- 2. Escalations ------------------------------------------------------------------------------------------------
-- Writes one escalation and tells the Director, copying the Administrators (never the person who raised it).
-- Returns null when that task or complaint is already escalated.
create or replace function public.staff_escalation_write(
  p_source_kind text, p_source_id uuid, p_lead_id uuid, p_title text, p_note text, p_automatic boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_uid uuid := (select auth.uid()); r record;
begin
  insert into public.staff_escalations (source_kind, source_id, lead_id, title, note, automatic, raised_by, raised_role)
  values (p_source_kind, p_source_id, p_lead_id, left(btrim(p_title), 200), btrim(p_note), p_automatic,
          case when p_automatic then null else v_uid end, case when p_automatic then null else public.staff_actor_role() end)
  on conflict (source_kind, source_id) where source_id is not null do nothing
  returning id into v_id;
  if v_id is null then return null; end if;
  if not p_automatic then
    for r in select x.id, x.cc from (
               select d as id, false as cc from public.staff_director_ids() d
               union select a, true from public.staff_enabled_administrators() a) x
              where x.id is distinct from v_uid loop
      perform public.staff_notify(r.id, 'STAFF_ESCALATION_RAISED',
        case when r.cc then 'Escalated to the Director (copy): ' else 'Escalated to you: ' end || left(btrim(p_title), 120),
        left(btrim(p_note), 160), '/staff/reports', jsonb_build_object('escalation_id', v_id));
    end loop;
  end if;
  perform public.staff_audit_write('staff_escalation', v_id, 'escalation_raised', null,
    jsonb_build_object('source_kind', p_source_kind, 'source_id', p_source_id, 'automatic', p_automatic));
  return v_id;
end;
$$;
revoke all on function public.staff_escalation_write(text, uuid, uuid, text, text, boolean) from public, anon, authenticated;

-- Any staff member escalates to the Director with a note, optionally about a file or one of the open staff tasks.
create or replace function public.staff_escalate(p_note text, p_lead_id uuid default null, p_task_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_title text; v_lead uuid := p_lead_id; t record;
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard', 'administrator']);
  if length(btrim(coalesce(p_note, ''))) not between 10 and 1000 then
    raise exception 'Write a note for the Director (10 to 1000 characters)';
  end if;
  if not public.staff_text_is_safe(p_note) then raise exception 'Notes cannot contain ID or account-length numbers'; end if;
  if p_task_id is not null then
    select st.id, st.title, st.lead_id, st.status into t from public.staff_tasks st where st.id = p_task_id;
    if t.id is null then raise exception 'Task not found'; end if;
    if t.status <> 'open' then raise exception 'That task is already closed'; end if;
    v_title := 'Task: ' || t.title;
    v_lead := coalesce(v_lead, t.lead_id);
  elsif v_lead is not null then
    select 'File: ' || l.business_name into v_title from public.leads l where l.id = v_lead;
    if v_title is null then raise exception 'File not found'; end if;
  else
    v_title := 'Escalated by ' || coalesce((select p.full_name from public.profiles p where p.id = (select auth.uid())), 'staff');
  end if;
  v_id := public.staff_escalation_write(case when p_task_id is null then 'manual' else 'task' end, p_task_id, v_lead,
                                        v_title, p_note, false);
  if v_id is null then raise exception 'That task is already escalated to the Director'; end if;
  return v_id;
end;
$$;
revoke all on function public.staff_escalate(text, uuid, uuid) from public, anon;
grant execute on function public.staff_escalate(text, uuid, uuid) to authenticated;

-- Hourly sweep: staff tasks still open 24 hours after they were created go to the Director. The Founder's own
-- decision tasks are already with the Director and are skipped. One summary notice per sweep, not one per task.
create or replace function public.staff_escalate_overdue()
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer := 0; t record; r uuid;
begin
  for t in select st.id, st.title, st.lead_id, st.created_at, st.route_to, st.acceptance, p.full_name as assignee
             from public.staff_tasks st left join public.profiles p on p.id = st.assigned_to
            where st.status = 'open' and st.task_kind <> 'founder_decision' and st.created_at < now() - interval '24 hours'
              and not exists (select 1 from public.staff_escalations e where e.source_kind = 'task' and e.source_id = st.id)
            order by st.created_at limit 200 loop
    if public.staff_escalation_write('task', t.id, t.lead_id, 'Task: ' || t.title,
         'Not resolved within 24 hours. ' ||
         case when t.assignee is not null then 'With ' || t.assignee
              else 'With the ' || case t.route_to when 'coordinator' then 'Sales Coordinator' when 'switchboard' then 'Switchboard' else 'Founder' end
         end || case when t.acceptance = 'pending' then ' (not yet accepted)' else '' end || '.', true) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then
    for r in select x.id from (select d as id from public.staff_director_ids() d
                               union select a from public.staff_enabled_administrators() a) x loop
      perform public.staff_notify(r, 'STAFF_ESCALATION_RAISED',
        v_n || case when v_n = 1 then ' task' else ' tasks' end || ' not resolved within 24 hours',
        'Escalated to the Director. Open Reports to see them.', '/staff/reports', jsonb_build_object('count', v_n));
    end loop;
  end if;
  return v_n;
end;
$$;
revoke all on function public.staff_escalate_overdue() from public, anon, authenticated;

create or replace function public.staff_resolve_escalation(p_escalation_id uuid, p_note text)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  perform public.staff_require_founder_or_administrator();
  if not exists (select 1 from public.staff_escalations e where e.id = p_escalation_id) then raise exception 'Escalation not found'; end if;
  if length(btrim(coalesce(p_note, ''))) not between 3 and 1000 then raise exception 'Write what was done (3 to 1000 characters)'; end if;
  if not public.staff_text_is_safe(p_note) then raise exception 'Notes cannot contain ID or account-length numbers'; end if;
  insert into public.staff_escalation_resolutions (escalation_id, note, resolved_by, resolved_role)
  values (p_escalation_id, btrim(p_note), (select auth.uid()), public.staff_actor_role())
  on conflict (escalation_id) do nothing
  returning resolved_at into v_at;
  if v_at is null then raise exception 'That escalation is already closed'; end if;
  perform public.staff_audit_write('staff_escalation', p_escalation_id, 'escalation_resolved', null, '{}'::jsonb);
  return v_at;
end;
$$;
revoke all on function public.staff_resolve_escalation(uuid, text) from public, anon;
grant execute on function public.staff_resolve_escalation(uuid, text) to authenticated;

create or replace function public.staff_escalation_board(p_open_only boolean default true)
returns table (escalation_id uuid, source_kind text, title text, note text, automatic boolean, raised_by text,
               business_name text, created_at timestamptz, hours_open integer, resolved_at timestamptz,
               resolved_by text, resolution_note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.staff_require_founder_or_administrator();
  return query
    select e.id, e.source_kind, e.title, e.note, e.automatic, rp.full_name, l.business_name, e.created_at,
           (extract(epoch from (coalesce(x.resolved_at, now()) - e.created_at)) / 3600)::integer,
           x.resolved_at, xp.full_name, x.note
      from public.staff_escalations e
      left join public.staff_escalation_resolutions x on x.escalation_id = e.id
      left join public.profiles rp on rp.id = e.raised_by
      left join public.profiles xp on xp.id = x.resolved_by
      left join public.leads l on l.id = e.lead_id
     where not coalesce(p_open_only, true) or x.escalation_id is null
     order by (x.escalation_id is null) desc, e.created_at desc
     limit 200;
end;
$$;
revoke all on function public.staff_escalation_board(boolean) from public, anon;
grant execute on function public.staff_escalation_board(boolean) to authenticated;

-- 3. Complaints -------------------------------------------------------------------------------------------------
create or replace function public.staff_log_complaint(
  p_kind text, p_name text, p_details text, p_lead_id uuid default null, p_received_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_received timestamptz := coalesce(p_received_at, now()); v_who text;
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard', 'administrator']);
  if p_kind is null or p_kind not in ('client', 'agent', 'other') then raise exception 'Say who complained: a client, an agent or someone else'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 2 and 160 then raise exception 'Give the name of the person who complained'; end if;
  if length(btrim(coalesce(p_details, ''))) not between 10 and 2000 then raise exception 'Describe the complaint (10 to 2000 characters)'; end if;
  if not public.staff_text_is_safe(p_name) or not public.staff_text_is_safe(p_details) then
    raise exception 'Complaints cannot contain ID or account-length numbers';
  end if;
  if v_received > now() + interval '5 minutes' or v_received < now() - interval '14 days' then
    raise exception 'The complaint must have been received in the last 14 days';
  end if;
  if p_lead_id is not null and not exists (select 1 from public.leads l where l.id = p_lead_id) then raise exception 'File not found'; end if;
  insert into public.staff_complaints (complainant_kind, complainant_name, lead_id, details, received_at, logged_by, logged_role)
  values (p_kind, btrim(p_name), p_lead_id, btrim(p_details), v_received, (select auth.uid()), public.staff_actor_role())
  returning id into v_id;
  perform public.staff_audit_write('staff_complaint', v_id, 'complaint_logged', null, jsonb_build_object('kind', p_kind));
  v_who := case p_kind when 'client' then 'client' when 'agent' then 'agent' else 'caller' end;
  -- Complaints go to the Director straight away (spec section 17).
  perform public.staff_escalation_write('complaint', v_id, p_lead_id,
    'Complaint from ' || v_who || ' ' || btrim(p_name), left(btrim(p_details), 1000), false);
  return v_id;
end;
$$;
revoke all on function public.staff_log_complaint(text, text, text, uuid, timestamptz) from public, anon;
grant execute on function public.staff_log_complaint(text, text, text, uuid, timestamptz) to authenticated;

-- Acknowledging is telling the complainant the complaint was received; any staff member may record it.
-- Resolving is for the Founder or the Administrator.
create or replace function public.staff_complaint_step(p_complaint_id uuid, p_event text, p_note text, p_method text default null)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard', 'administrator']);
  if p_event = 'resolved' then perform public.staff_require_founder_or_administrator();
  elsif p_event is distinct from 'acknowledged' then raise exception 'Unknown step';
  end if;
  if not exists (select 1 from public.staff_complaints c where c.id = p_complaint_id) then raise exception 'Complaint not found'; end if;
  if p_event = 'acknowledged' and (p_method is null or p_method not in ('phone', 'email', 'whatsapp', 'in_person')) then
    raise exception 'Say how the complainant was told: phone, email, WhatsApp or in person';
  end if;
  if length(btrim(coalesce(p_note, ''))) not between 3 and 1000 then raise exception 'Write a short note (3 to 1000 characters)'; end if;
  if not public.staff_text_is_safe(p_note) then raise exception 'Notes cannot contain ID or account-length numbers'; end if;
  if p_event = 'resolved' and not exists (select 1 from public.staff_complaint_events e
                                           where e.complaint_id = p_complaint_id and e.event = 'acknowledged') then
    raise exception 'Acknowledge the complaint before resolving it';
  end if;
  insert into public.staff_complaint_events (complaint_id, event, method, note, actor_id, actor_role)
  values (p_complaint_id, p_event, case when p_event = 'acknowledged' then p_method end, btrim(p_note),
          (select auth.uid()), public.staff_actor_role())
  on conflict (complaint_id, event) do nothing
  returning at into v_at;
  if v_at is null then raise exception 'That complaint is already %', p_event; end if;
  perform public.staff_audit_write('staff_complaint', p_complaint_id, 'complaint_' || p_event, null, '{}'::jsonb);
  return v_at;
end;
$$;
revoke all on function public.staff_complaint_step(uuid, text, text, text) from public, anon;
grant execute on function public.staff_complaint_step(uuid, text, text, text) to authenticated;

-- The Founder and the Administrator see every complaint; other staff see the ones they logged.
create or replace function public.staff_complaints_list(p_open_only boolean default true)
returns table (complaint_id uuid, complainant_kind text, complainant_name text, business_name text, details text,
               received_at timestamptz, logged_by text, acknowledged_at timestamptz, acknowledged_method text,
               acknowledged_late boolean, resolved_at timestamptz, resolution_note text, can_resolve boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_all boolean; v_uid uuid := (select auth.uid());
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard', 'administrator']);
  v_all := public.staff_is_founder_or_administrator();
  return query
    select c.id, c.complainant_kind, c.complainant_name, l.business_name, c.details, c.received_at, lp.full_name,
           a.at, a.method,
           -- Same day, Johannesburg time; a complaint still waiting after its day is late too.
           (coalesce(a.at, now()) at time zone 'Africa/Johannesburg')::date > (c.received_at at time zone 'Africa/Johannesburg')::date,
           r.at, r.note, v_all
      from public.staff_complaints c
      left join public.staff_complaint_events a on a.complaint_id = c.id and a.event = 'acknowledged'
      left join public.staff_complaint_events r on r.complaint_id = c.id and r.event = 'resolved'
      left join public.profiles lp on lp.id = c.logged_by
      left join public.leads l on l.id = c.lead_id
     where (v_all or c.logged_by = v_uid)
       and (not coalesce(p_open_only, true) or r.id is null)
     order by (r.id is null) desc, c.received_at desc
     limit 200;
end;
$$;
revoke all on function public.staff_complaints_list(boolean) from public, anon;
grant execute on function public.staff_complaints_list(boolean) to authenticated;

-- 4. Reports ----------------------------------------------------------------------------------------------------
-- Day boundaries are Johannesburg days. None of these reads funder, funder-stage, commission, fee or bank data.
create or replace function public.staff_sast_day_bounds(p_day date)
returns tstzrange
language sql stable set search_path = '' as $$
  select tstzrange((p_day::timestamp at time zone 'Africa/Johannesburg'),
                   ((p_day + 1)::timestamp at time zone 'Africa/Johannesburg'), '[)');
$$;
revoke all on function public.staff_sast_day_bounds(date) from public, anon, authenticated;

-- Director's daily briefing (07:30–08:00): today's bookings, open tasks, urgent items.
create or replace function public.staff_director_briefing(p_day date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_day date := coalesce(p_day, public.current_sast_date()); v_r tstzrange;
begin
  perform public.staff_require_founder_or_administrator();
  v_r := public.staff_sast_day_bounds(v_day);
  return jsonb_build_object(
    'day', v_day,
    -- The Founder's diary. Private entries show as "Private" (the same rule as the Administrator's diary view).
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object('starts_at', e.starts_at, 'ends_at', e.ends_at, 'category', e.category,
               'title', case when public.is_owner() or e.visibility <> 'private' then e.title else 'Private' end,
               'business_name', l.business_name) order by e.starts_at)
        from public.owner_calendar_events e
        join public.profiles o on o.id = e.owner_id and o.role::text = 'owner'
        left join public.leads l on l.id = e.lead_id
       where e.status = 'scheduled' and tstzrange(e.starts_at, e.ends_at, '[)') && v_r), '[]'::jsonb),
    'time_requests_pending', (select count(*)::int from public.calendar_time_requests r where r.status = 'pending'),
    'tasks', jsonb_build_object(
      'open', (select count(*)::int from public.staff_tasks t where t.status = 'open'),
      'overdue', (select count(*)::int from public.staff_tasks t where t.status = 'open' and t.due_at < now()),
      'awaiting_acceptance', (select count(*)::int from public.staff_tasks t where t.status = 'open' and t.acceptance = 'pending'),
      'founder_decisions', (select count(*)::int from public.staff_tasks t where t.status = 'open' and t.task_kind = 'founder_decision'),
      'urgent', coalesce((
        select jsonb_agg(x order by x.due_at nulls last) from (
          select t.title, t.priority, t.due_at, t.route_to, p.full_name as assignee, l.business_name
            from public.staff_tasks t left join public.profiles p on p.id = t.assigned_to left join public.leads l on l.id = t.lead_id
           where t.status = 'open' and (t.priority = 'high' or t.due_at < now() + interval '1 day')
           order by t.due_at nulls last limit 15) x), '[]'::jsonb)),
    'urgent', jsonb_build_object(
      'escalations_open', (select count(*)::int from public.staff_escalations e
                            where not exists (select 1 from public.staff_escalation_resolutions x where x.escalation_id = e.id)),
      'escalations', coalesce((
        select jsonb_agg(x order by x.created_at) from (
          select e.title, e.note, e.created_at from public.staff_escalations e
           where not exists (select 1 from public.staff_escalation_resolutions x where x.escalation_id = e.id)
           order by e.created_at limit 10) x), '[]'::jsonb),
      'complaints_unacknowledged', (select count(*)::int from public.staff_complaints c
                                     where not exists (select 1 from public.staff_complaint_events a where a.complaint_id = c.id and a.event = 'acknowledged')),
      'complaints_open', (select count(*)::int from public.staff_complaints c
                           where not exists (select 1 from public.staff_complaint_events a where a.complaint_id = c.id and a.event = 'resolved')),
      'callbacks_due_today', (select count(*)::int from public.switchboard_call_logs c
                               where c.callback_due_at <@ v_r and c.corrects_id is null),
      'files_with_founder', (select count(*)::int from public.submission_intakes si
                              where si.archived_at is null and si.workflow_status = 'with_founder')));
end;
$$;
revoke all on function public.staff_director_briefing(date) from public, anon;
grant execute on function public.staff_director_briefing(date) to authenticated;

-- End-of-day report: files opened, documents received, leads assigned, tasks outstanding.
create or replace function public.staff_end_of_day_report(p_day date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_day date := coalesce(p_day, public.current_sast_date()); v_r tstzrange;
begin
  perform public.staff_require_founder_or_administrator();
  v_r := public.staff_sast_day_bounds(v_day);
  return jsonb_build_object(
    'day', v_day,
    'files_opened', coalesce((
      select jsonb_agg(jsonb_build_object('business_name', l.business_name, 'channel', si.channel::text,
               'handler', p.full_name, 'opened_at', si.registered_at) order by si.registered_at)
        from public.submission_intakes si join public.leads l on l.id = si.lead_id
        left join public.profiles p on p.id = si.operational_assignee_id
       where si.registered_at <@ v_r), '[]'::jsonb),
    'documents_received', jsonb_build_object(
      'count', (select count(*)::int from public.intake_document_receipts d where d.received_at <@ v_r),
      'by_file', coalesce((
        select jsonb_agg(x order by x.received desc) from (
          select l.business_name, count(*)::int as received
            from public.intake_document_receipts d join public.leads l on l.id = d.lead_id
           where d.received_at <@ v_r group by l.business_name) x), '[]'::jsonb)),
    'files_completed', (select count(*)::int from public.submission_intakes si where si.first_complete_at <@ v_r),
    'leads_assigned', coalesce((
      select jsonb_agg(jsonb_build_object('business_name', l.business_name, 'assigned_to', p.full_name,
               'by_role', a.actor_role, 'at', a.occurred_at) order by a.occurred_at)
        from public.staff_audit_events a
        join public.leads l on l.id = a.entity_id
        left join public.profiles p on p.id = nullif(a.detail ->> 'to', '')::uuid
       where a.entity_type = 'submission_intake' and a.event_type = 'assignee_changed'
         and nullif(a.detail ->> 'to', '') is not null and a.occurred_at <@ v_r), '[]'::jsonb),
    'outbound_assigned', (select count(*)::int from public.outbound_lead_route_events ev
                           where ev.to_status = 'assigned' and ev.at <@ v_r),
    'tasks', jsonb_build_object(
      'created', (select count(*)::int from public.staff_tasks t where t.created_at <@ v_r),
      'completed', (select count(*)::int from public.staff_tasks t where t.completed_at <@ v_r),
      'outstanding', (select count(*)::int from public.staff_tasks t where t.status = 'open'),
      'overdue', (select count(*)::int from public.staff_tasks t where t.status = 'open' and t.due_at < now()),
      'outstanding_by_person', coalesce((
        select jsonb_agg(x order by x.open desc) from (
          select coalesce(p.full_name, case t.route_to when 'coordinator' then 'Sales Coordinator (unassigned)'
                   when 'switchboard' then 'Switchboard (unassigned)' else 'Founder' end) as person,
                 count(*)::int as open, count(*) filter (where t.due_at < now())::int as overdue
            from public.staff_tasks t left join public.profiles p on p.id = t.assigned_to
           where t.status = 'open' group by 1) x), '[]'::jsonb)),
    'complaints_logged', (select count(*)::int from public.staff_complaints c where c.received_at <@ v_r),
    'escalations_raised', (select count(*)::int from public.staff_escalations e where e.created_at <@ v_r));
end;
$$;
revoke all on function public.staff_end_of_day_report(date) from public, anon;
grant execute on function public.staff_end_of_day_report(date) to authenticated;

-- Friday report: progress toward 60 files a month. Counts only: no success-fee amounts, no money, no funders.
-- Admin-fee invoices are not built yet (Batch 5), so "admin fees paid" is reported as not tracked.
create or replace function public.staff_files_progress_report(p_day date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_day date := coalesce(p_day, public.current_sast_date());
  v_month date := date_trunc('month', v_day)::date;
  v_week date := v_day - (extract(isodow from v_day)::int - 1);
  v_m tstzrange; v_w tstzrange; v_opened int; v_left int;
  v_target constant int := 60;
begin
  perform public.staff_require_founder_or_administrator();
  v_m := tstzrange((v_month::timestamp at time zone 'Africa/Johannesburg'),
                   (((v_month + interval '1 month')::date)::timestamp at time zone 'Africa/Johannesburg'), '[)');
  v_w := tstzrange((v_week::timestamp at time zone 'Africa/Johannesburg'),
                   ((v_week + 7)::timestamp at time zone 'Africa/Johannesburg'), '[)');
  select count(*)::int into v_opened from public.submission_intakes si where si.registered_at <@ v_m;
  -- Working days left in the month after today (weekdays, less the public holidays the owner entered).
  select count(*)::int into v_left
    from generate_series(v_day + 1, ((v_month + interval '1 month')::date - 1), interval '1 day') g(d)
   where extract(isodow from g.d) < 6
     and not exists (select 1 from public.business_holidays h where h.holiday_date = g.d::date);
  return jsonb_build_object(
    'day', v_day, 'month', v_month, 'week_start', v_week, 'target', v_target,
    'files_opened_month', v_opened,
    'files_opened_week', (select count(*)::int from public.submission_intakes si where si.registered_at <@ v_w),
    'working_days_left', v_left,
    'files_needed_per_day', case when v_opened >= v_target then 0 when v_left > 0 then ceil((v_target - v_opened)::numeric / v_left)::int end,
    'documents_complete_month', (select count(*)::int from public.submission_intakes si where si.first_complete_at <@ v_m),
    'documents_complete_week', (select count(*)::int from public.submission_intakes si where si.first_complete_at <@ v_w),
    'admin_fees_paid', jsonb_build_object('not_tracked', true, 'note', 'Admin-fee invoices arrive with Batch 5.'),
    'files_in_progress', coalesce((
      select jsonb_object_agg(s.workflow_status, s.n) from (
        select si.workflow_status::text as workflow_status, count(*)::int as n
          from public.submission_intakes si where si.archived_at is null group by 1) s), '{}'::jsonb),
    'deals_in_progress', coalesce((
      select jsonb_object_agg(s.stage, s.n) from (
        select d.stage::text as stage, count(*)::int as n from public.deals d
         where d.archived_at is null and d.stage::text not in ('funded', 'invoiced', 'commission_paid', 'declined')
         group by 1) s), '{}'::jsonb));
end;
$$;
revoke all on function public.staff_files_progress_report(date) from public, anon;
grant execute on function public.staff_files_progress_report(date) to authenticated;

-- 5. Schedule the 24-hour sweep (hourly) -------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('staff-escalate-overdue', '7 * * * *', 'select public.staff_escalate_overdue();');
  end if;
end;
$$;
