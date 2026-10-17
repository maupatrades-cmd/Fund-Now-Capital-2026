-- Administrator (Second-in-Charge), Batch 2 (2/2): oversight. Owner specification 17 Oct 2026
-- (docs/FNC-ADMINISTRATOR-SPEC-2026-10-17.md, sections 3, 6 and 10). Forward-only.
--
--   1. Staff tasks: the Administrator (and the Founder) give a task to a named Sales Coordinator or
--      Switchboard Assistant. The person accepts it or declines it with a reason from their landing page.
--      A declined task goes back to whoever gave it, to give to someone else. Overdue flags already exist.
--   2. Documents approved while the Director is away: the Administrator records an approval on a file whose
--      required documents are all received. This is an audited record and a notice to the Director ONLY.
--      It does not verify the file (the Director still does that) and it touches no R100, commission or
--      payroll object (Codex owns those; the R100 is keyed on Complete).
--   3. Outbound-lead routing: Sales Coordinator checks whether the lead belongs to a team member; if it
--      does, it is assigned to that person; if not it goes to "New Leads", then to the Administrator, then
--      to the Director. Every step has a status and an append-only history.
--
-- History columns written here hold the REAL role (staff_actor_role), never the mapped 'coordinator'.
-- Nothing below adds a table policy: every read and write is a SECURITY DEFINER function.

-- 0. A generic in-app notice writer (same shape as diary_notify) --------------------------------------
create or replace function public.staff_notify(
  p_user uuid, p_event public.notification_event_type, p_title text, p_body text, p_link text, p_data jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_on boolean;
begin
  if p_user is null then return; end if;
  v_on := public.check_notification_channel_enabled(p_user, p_event, 'in_app');
  insert into public.notifications (user_id, event_type, title, body_text, link_url, data, read_status, read_at)
  values (p_user, p_event, p_title, p_body, p_link, p_data, not v_on, case when v_on then null else now() end)
  returning id into v_id;
  insert into public.notification_deliveries (notification_id, channel, delivery_status, sent_at, delivered_at)
  values (v_id, 'in_app', (case when v_on then 'delivered' else 'skipped' end)::public.notification_delivery_status,
          case when v_on then now() end, case when v_on then now() end);
end;
$$;
revoke all on function public.staff_notify(uuid, public.notification_event_type, text, text, text, jsonb) from public, anon, authenticated;

-- Enabled Administrators (for notices).
create or replace function public.staff_enabled_administrators()
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
   where p.role::text = 'administrator' and p.is_active and s.access_enabled;
$$;
revoke all on function public.staff_enabled_administrators() from public, anon, authenticated;

-- 1. Staff tasks: assign, accept, decline ----------------------------------------------------------------
alter table public.staff_tasks
  add column if not exists acceptance     text check (acceptance is null or acceptance in ('pending', 'accepted', 'declined')),
  add column if not exists assigned_by    uuid,
  add column if not exists responded_at   timestamptz,
  add column if not exists decline_reason text check (decline_reason is null or length(decline_reason) <= 500);
-- staff_tasks already exists in production: the FK goes on NOT VALID, then is validated (CLAUDE.md).
alter table public.staff_tasks add constraint staff_tasks_assigned_by_fkey
  foreign key (assigned_by) references public.profiles(id) on delete restrict not valid;
alter table public.staff_tasks validate constraint staff_tasks_assigned_by_fkey;

alter table public.staff_task_events drop constraint if exists staff_task_events_event_check;
alter table public.staff_task_events add constraint staff_task_events_event_check
  check (event in ('created', 'routed', 'completed', 'cancelled', 'assigned', 'accepted', 'declined'));

create index if not exists staff_tasks_pending_acceptance_idx
  on public.staff_tasks (assigned_to) where status = 'open' and acceptance = 'pending';

-- Only the Founder and the Administrator give tasks to a named person.
create or replace function public.staff_can_assign_tasks()
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_owner() or public.staff_role_of() = 'administrator';
$$;
revoke all on function public.staff_can_assign_tasks() from public, anon, authenticated;

-- Shared body: hand an open task to a named Coordinator or Switchboard Assistant and ask them to accept.
create or replace function public.staff_task_hand_to(p_task_id uuid, p_assignee uuid, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_task public.staff_tasks; v_to text; v_role text := public.staff_actor_role(); v_uid uuid := (select auth.uid());
begin
  select s.staff_role::text into v_to
    from public.staff_access s join public.profiles p on p.id = s.profile_id
   where s.profile_id = p_assignee and s.access_enabled and p.is_active and p.role = s.staff_role
     and s.staff_role::text in ('coordinator', 'switchboard');
  if v_to is null then
    raise exception 'Choose an enabled Sales Coordinator or Switchboard Assistant';
  end if;
  if p_assignee = v_uid then raise exception 'You cannot give a task to yourself'; end if;
  select * into v_task from public.staff_tasks t where t.id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if v_task.status <> 'open' then raise exception 'Only an open task can be given to someone'; end if;
  if v_task.task_kind = 'founder_decision' then raise exception 'A founder decision stays with the Founder'; end if;
  perform set_config('fnc.task_transition', 'on', true);
  update public.staff_tasks
     set route_to = v_to, assigned_to = p_assignee, assigned_by = v_uid, acceptance = 'pending',
         responded_at = null, decline_reason = null
   where id = p_task_id;
  insert into public.staff_task_events (task_id, actor_id, actor_role, event, from_route, to_route, reason)
  values (p_task_id, v_uid, v_role, 'assigned', v_task.route_to, v_to, nullif(btrim(p_note), ''));
  perform public.staff_audit_write('staff_task', p_task_id, 'task_assigned', p_note,
    jsonb_build_object('assignee', p_assignee, 'to', v_to));
  perform public.staff_notify(p_assignee, 'STAFF_TASK_ASSIGNED', 'New task for you: ' || v_task.title,
    'Open your tasks to accept or decline it.' || case when v_task.due_at is not null
      then ' Due ' || to_char(v_task.due_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI') || '.' else '' end,
    '/staff/tasks', jsonb_build_object('task_id', p_task_id));
end;
$$;
revoke all on function public.staff_task_hand_to(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.staff_create_assigned_task(
  p_title text, p_notes text, p_priority text, p_due_at timestamptz, p_assignee uuid, p_lead_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_role text := public.staff_actor_role();
begin
  if not public.staff_can_assign_tasks() then
    raise exception 'Only the Founder or the Administrator gives tasks to a named person' using errcode = '42501';
  end if;
  if p_lead_id is not null and not exists (select 1 from public.submission_intakes si where si.lead_id = p_lead_id) then
    raise exception 'Submission not found';
  end if;
  perform set_config('fnc.task_transition', 'on', true);
  insert into public.staff_tasks (title, notes, task_kind, priority, due_at, route_to, lead_id, created_by, created_role)
  values (btrim(p_title), nullif(btrim(p_notes), ''), 'general', coalesce(p_priority, 'normal'), p_due_at, 'coordinator',
          p_lead_id, (select auth.uid()), v_role)
  returning id into v_id;
  insert into public.staff_task_events (task_id, actor_id, actor_role, event, to_route)
  values (v_id, (select auth.uid()), v_role, 'created', 'coordinator');
  perform public.staff_audit_write('staff_task', v_id, 'task_created', null, jsonb_build_object('assigned', true));
  perform public.staff_task_hand_to(v_id, p_assignee, null);
  return v_id;
end;
$$;

create or replace function public.staff_assign_task(p_task_id uuid, p_assignee uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.staff_can_assign_tasks() then
    raise exception 'Only the Founder or the Administrator gives tasks to a named person' using errcode = '42501';
  end if;
  if p_note is not null and not public.staff_text_is_safe(p_note) then
    raise exception 'The note cannot contain ID or account-length numbers';
  end if;
  perform public.staff_task_hand_to(p_task_id, p_assignee, p_note);
end;
$$;

-- The person a task was given to accepts it, or declines it with a reason (it goes back to the giver).
create or replace function public.staff_respond_task(p_task_id uuid, p_accept boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_task public.staff_tasks; v_uid uuid := (select auth.uid()); v_role text := public.staff_actor_role();
begin
  if v_role is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  select * into v_task from public.staff_tasks t where t.id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if v_task.assigned_to is distinct from v_uid then raise exception 'This task was not given to you' using errcode = '42501'; end if;
  if v_task.status <> 'open' or v_task.acceptance is distinct from 'pending' then
    raise exception 'This task is not waiting for your answer';
  end if;
  if not p_accept and (length(btrim(coalesce(p_reason, ''))) < 10 or not public.staff_text_is_safe(p_reason)) then
    raise exception 'Say why you are declining (at least 10 characters, no ID or account numbers)';
  end if;
  perform set_config('fnc.task_transition', 'on', true);
  update public.staff_tasks
     set acceptance = case when p_accept then 'accepted' else 'declined' end, responded_at = now(),
         decline_reason = case when p_accept then null else btrim(p_reason) end
   where id = p_task_id;
  insert into public.staff_task_events (task_id, actor_id, actor_role, event, reason)
  values (p_task_id, v_uid, v_role, case when p_accept then 'accepted' else 'declined' end,
          case when p_accept then null else btrim(p_reason) end);
  perform public.staff_audit_write('staff_task', p_task_id, case when p_accept then 'task_accepted' else 'task_declined' end,
    case when p_accept then null else p_reason end, '{}'::jsonb);
  if not p_accept then
    perform public.staff_notify(v_task.assigned_by, 'STAFF_TASK_DECLINED', 'Task declined: ' || v_task.title,
      btrim(p_reason), '/staff/tasks', jsonb_build_object('task_id', p_task_id));
  end if;
end;
$$;

-- The task board: what staff_task_list shows, plus who it was given to and their answer. The Founder and the
-- Administrator see every task with the Coordinator or the desk; others see their own as before.
create or replace function public.staff_task_board(p_status text default 'open', p_limit integer default 50)
returns table (
  id uuid, title text, notes text, task_kind text, priority text, status text, due_at timestamptz,
  route_to text, assigned_to uuid, assigned_name text, lead_id uuid, business_name text, created_by_name text,
  created_role text, created_at timestamptz, overdue boolean,
  acceptance text, assigned_by_name text, responded_at timestamptz, decline_reason text, given_by_me boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare v_role text; v_uid uuid := (select auth.uid()); v_admin boolean;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  v_admin := public.staff_role_of() = 'administrator';
  return query
    select t.id, t.title, t.notes, t.task_kind, t.priority, t.status, t.due_at, t.route_to, t.assigned_to, ap.full_name,
           t.lead_id, l.business_name, cp.full_name, t.created_role, t.created_at,
           (t.status = 'open' and t.due_at is not null and t.due_at < now()),
           t.acceptance, bp.full_name, t.responded_at, t.decline_reason, t.assigned_by = v_uid
      from public.staff_tasks t
      join public.profiles cp on cp.id = t.created_by
      left join public.profiles ap on ap.id = t.assigned_to
      left join public.profiles bp on bp.id = t.assigned_by
      left join public.leads l on l.id = t.lead_id
     where (p_status is null or t.status = p_status)
       and (v_role = 'owner'
            or t.created_by = v_uid
            or t.assigned_to = v_uid
            or t.assigned_by = v_uid
            or (v_admin and t.route_to in ('coordinator', 'switchboard'))
            -- A named task belongs to its person: other staff on the same desk do not see it.
            or (t.assigned_to is null and t.route_to = v_role)
            or (t.assigned_to is null and v_role = 'coordinator' and t.route_to = 'switchboard'))
     order by (t.acceptance = 'pending' and t.assigned_to = v_uid) desc, (t.priority = 'high') desc,
              t.due_at nulls last, t.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- Tasks waiting for the caller's answer, for the landing page.
create or replace function public.staff_my_pending_tasks()
returns table (id uuid, title text, notes text, priority text, due_at timestamptz, overdue boolean,
               assigned_by_name text, business_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.staff_actor_role() is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  return query
    select t.id, t.title, t.notes, t.priority, t.due_at, (t.due_at is not null and t.due_at < now()), bp.full_name, l.business_name
      from public.staff_tasks t
      left join public.profiles bp on bp.id = t.assigned_by
      left join public.leads l on l.id = t.lead_id
     where t.assigned_to = (select auth.uid()) and t.status = 'open' and t.acceptance = 'pending'
     order by t.due_at nulls last, t.created_at
     limit 50;
end;
$$;

-- 2. Documents approved while the Director is away (audited record only) ------------------------------
create table if not exists public.intake_absence_approvals (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.submission_intakes(lead_id) on delete restrict,
  approved_by   uuid not null references public.profiles(id) on delete restrict,
  approved_role text not null,
  away_note     text not null check (length(btrim(away_note)) between 10 and 500),
  docs_snapshot jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists intake_absence_approvals_lead_idx on public.intake_absence_approvals (lead_id, created_at desc);
alter table public.intake_absence_approvals enable row level security;
revoke all on table public.intake_absence_approvals from public, anon, authenticated;
create trigger intake_absence_approvals_append_only before update or delete on public.intake_absence_approvals
  for each row execute function public.intake_append_only_guard();

create or replace function public.staff_approve_documents_in_absence(p_lead_id uuid, p_away_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_status text; v_missing text[]; v_id uuid; v_name text; v_owner uuid; v_docs jsonb;
begin
  if public.staff_role_of() is distinct from 'administrator' then
    raise exception 'Only the Administrator records an approval while the Director is away' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_away_note, ''))) < 10 or not public.staff_text_is_safe(p_away_note) then
    raise exception 'Say why the Director is away (at least 10 characters, no ID or account numbers)';
  end if;
  select si.workflow_status::text, l.business_name into v_status, v_name
    from public.submission_intakes si join public.leads l on l.id = si.lead_id
   where si.lead_id = p_lead_id and si.archived_at is null
   for update of si;
  if not found then raise exception 'Submission not found'; end if;
  if v_status not in ('complete', 'with_founder') then
    raise exception 'Documents can be approved only on a Complete file (this one is %)', replace(v_status, '_', ' ');
  end if;
  v_missing := public.intake_required_docs_missing(p_lead_id);
  if coalesce(cardinality(v_missing), 0) > 0 then
    raise exception 'Required documents are still missing: %', array_to_string(v_missing, ', ');
  end if;
  if exists (select 1 from public.intake_absence_approvals a where a.lead_id = p_lead_id) then
    raise exception 'The documents on this file are already approved';
  end if;
  -- A record of what was on the file when it was approved (titles and dates only, no contents).
  select coalesce(jsonb_agg(jsonb_build_object('doc', coalesce(d.doc_code, d.document_type::text), 'received_at', d.received_at)
                            order by d.received_at), '[]'::jsonb)
    into v_docs from public.intake_document_receipts d where d.lead_id = p_lead_id;
  insert into public.intake_absence_approvals (lead_id, approved_by, approved_role, away_note, docs_snapshot)
  values (p_lead_id, (select auth.uid()), public.staff_actor_role(), btrim(p_away_note), v_docs)
  returning id into v_id;
  perform public.staff_audit_write('submission_intake', p_lead_id, 'documents_approved_in_absence', p_away_note,
    jsonb_build_object('approval_id', v_id));
  for v_owner in select p.id from public.profiles p where p.role::text = 'owner' and p.is_active loop
    perform public.staff_notify(v_owner, 'DOCUMENTS_APPROVED_IN_ABSENCE', 'Documents approved while you were away: ' || v_name,
      btrim(p_away_note), '/staff/queue', jsonb_build_object('lead_id', p_lead_id, 'approval_id', v_id));
  end loop;
  return v_id;
end;
$$;

create or replace function public.staff_absence_approvals(p_lead_id uuid)
returns table (id uuid, approved_by_name text, approved_role text, away_note text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  return query
    select a.id, p.full_name, a.approved_role, a.away_note, a.created_at
      from public.intake_absence_approvals a join public.profiles p on p.id = a.approved_by
     where a.lead_id = p_lead_id order by a.created_at desc;
end;
$$;

-- 3. Outbound-lead routing ----------------------------------------------------------------------------------
create table if not exists public.outbound_lead_routes (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null unique references public.submission_intakes(lead_id) on delete restrict,
  status           text not null default 'with_coordinator' check (status in
                     ('with_coordinator', 'assigned', 'new_leads', 'with_administrator', 'with_director', 'director_received')),
  assigned_profile uuid references public.profiles(id) on delete restrict,
  started_by       uuid not null references public.profiles(id) on delete restrict,
  started_role     text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint outbound_lead_routes_assigned_ck check ((status = 'assigned') = (assigned_profile is not null))
);
create index if not exists outbound_lead_routes_status_idx on public.outbound_lead_routes (status, updated_at desc);

create table if not exists public.outbound_lead_route_events (
  id          bigint generated always as identity primary key,
  route_id    uuid not null references public.outbound_lead_routes(id) on delete restrict,
  at          timestamptz not null default now(),
  actor_id    uuid not null,
  actor_role  text not null,
  from_status text,
  to_status   text not null,
  note        text check (note is null or length(note) <= 500)
);
create index if not exists outbound_lead_route_events_route_idx on public.outbound_lead_route_events (route_id, at);

alter table public.outbound_lead_routes enable row level security;
alter table public.outbound_lead_route_events enable row level security;
revoke all on table public.outbound_lead_routes from public, anon, authenticated;
revoke all on table public.outbound_lead_route_events from public, anon, authenticated;
create trigger outbound_lead_route_events_append_only before update or delete on public.outbound_lead_route_events
  for each row execute function public.intake_append_only_guard();

-- Routes change only through outbound_lead_move (which sets fnc.outbound_route).
create or replace function public.outbound_lead_route_guard()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Outbound lead routes cannot be deleted'; end if;
  if coalesce(current_setting('fnc.outbound_route', true), '') <> 'on' then
    raise exception 'Outbound lead routes change only through the routing functions';
  end if;
  if (new.id, new.lead_id, new.started_by, new.started_role, new.created_at)
     is distinct from (old.id, old.lead_id, old.started_by, old.started_role, old.created_at) then
    raise exception 'Route identity cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger outbound_lead_route_guard before update or delete on public.outbound_lead_routes
  for each row execute function public.outbound_lead_route_guard();

-- Team members a lead can belong to: agents and sub-agents (contractors, lead referrers) and partners.
create or replace function public.staff_outbound_team_members()
returns table (profile_id uuid, full_name text, member_role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  return query
    select p.id, p.full_name, p.role::text from public.profiles p
     where p.is_active and p.role::text in ('partner', 'contractor', 'lead_referrer')
     order by p.full_name limit 500;
end;
$$;

-- Start: anyone in the staff workspace sends an outbound lead to the Sales Coordinator.
create or replace function public.staff_start_outbound_route(p_lead_id uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_role text := public.staff_actor_role(); v_id uuid;
begin
  if v_role is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  if p_note is not null and not public.staff_text_is_safe(p_note) then raise exception 'The note cannot contain ID or account-length numbers'; end if;
  if not exists (select 1 from public.submission_intakes si where si.lead_id = p_lead_id and si.archived_at is null) then
    raise exception 'Submission not found';
  end if;
  if exists (select 1 from public.outbound_lead_routes r where r.lead_id = p_lead_id) then
    raise exception 'This lead is already being routed';
  end if;
  insert into public.outbound_lead_routes (lead_id, started_by, started_role)
  values (p_lead_id, (select auth.uid()), v_role) returning id into v_id;
  insert into public.outbound_lead_route_events (route_id, actor_id, actor_role, to_status, note)
  values (v_id, (select auth.uid()), v_role, 'with_coordinator', nullif(btrim(p_note), ''));
  perform public.staff_audit_write('outbound_lead_route', v_id, 'outbound_route_started', p_note, jsonb_build_object('lead_id', p_lead_id));
  return v_id;
end;
$$;

-- Every later step. Who may make each move:
--   with_coordinator -> assigned | new_leads           Sales Coordinator, Administrator, Founder
--   new_leads        -> assigned | with_administrator  Sales Coordinator, Administrator, Founder
--   with_administrator -> assigned | with_director     Administrator, Founder
--   with_director    -> assigned | director_received   Founder
create or replace function public.staff_move_outbound_route(
  p_route_id uuid, p_to text, p_note text default null, p_assigned_profile uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.outbound_lead_routes; v_role text := public.staff_actor_role(); v_ok boolean; v_name text; a uuid;
begin
  if v_role is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  if p_note is not null and not public.staff_text_is_safe(p_note) then raise exception 'The note cannot contain ID or account-length numbers'; end if;
  select * into r from public.outbound_lead_routes where id = p_route_id for update;
  if not found then raise exception 'Route not found'; end if;
  v_ok := case r.status
    when 'with_coordinator' then p_to in ('assigned', 'new_leads') and v_role in ('coordinator', 'administrator', 'owner')
    when 'new_leads' then p_to in ('assigned', 'with_administrator') and v_role in ('coordinator', 'administrator', 'owner')
    when 'with_administrator' then p_to in ('assigned', 'with_director') and v_role in ('administrator', 'owner')
    when 'with_director' then p_to in ('assigned', 'director_received') and v_role = 'owner'
    else false end;
  if not v_ok then
    raise exception 'You cannot move this lead from % to %', replace(r.status, '_', ' '), replace(p_to, '_', ' ') using errcode = '42501';
  end if;
  if p_to = 'assigned' then
    if not exists (select 1 from public.profiles p where p.id = p_assigned_profile and p.is_active
                     and p.role::text in ('partner', 'contractor', 'lead_referrer')) then
      raise exception 'Choose the agent, sub-agent or partner the lead belongs to';
    end if;
  elsif p_assigned_profile is not null then
    raise exception 'Only an assignment names a person';
  end if;
  if p_to in ('new_leads', 'assigned') and length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say who you checked with';
  end if;
  perform set_config('fnc.outbound_route', 'on', true);
  update public.outbound_lead_routes set status = p_to, assigned_profile = case when p_to = 'assigned' then p_assigned_profile end
   where id = p_route_id;
  insert into public.outbound_lead_route_events (route_id, actor_id, actor_role, from_status, to_status, note)
  values (p_route_id, (select auth.uid()), v_role, r.status, p_to, nullif(btrim(p_note), ''));
  perform public.staff_audit_write('outbound_lead_route', p_route_id, 'outbound_route_moved', p_note,
    jsonb_build_object('from', r.status, 'to', p_to, 'assigned_profile', p_assigned_profile));
  select l.business_name into v_name from public.leads l where l.id = r.lead_id;
  if p_to = 'with_administrator' then
    for a in select * from public.staff_enabled_administrators() loop
      perform public.staff_notify(a, 'OUTBOUND_LEAD_ROUTED', 'New lead for you: ' || coalesce(v_name, 'a lead'),
        coalesce(nullif(btrim(p_note), ''), 'No team member owns this lead.'), '/staff/outbound', jsonb_build_object('route_id', p_route_id));
    end loop;
  elsif p_to = 'with_director' then
    for a in select p.id from public.profiles p where p.role::text = 'owner' and p.is_active loop
      perform public.staff_notify(a, 'OUTBOUND_LEAD_ROUTED', 'New lead for you: ' || coalesce(v_name, 'a lead'),
        coalesce(nullif(btrim(p_note), ''), 'Sent on by the Administrator.'), '/staff/outbound', jsonb_build_object('route_id', p_route_id));
    end loop;
  end if;
end;
$$;

-- The routing board. Coordinator, Administrator and Founder see every route; Switchboard sees the ones they started.
create or replace function public.staff_outbound_routes(p_open_only boolean default true)
returns table (id uuid, lead_id uuid, business_name text, status text, assigned_name text, started_by_name text,
               created_at timestamptz, updated_at timestamptz, history jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := public.staff_actor_role(); v_uid uuid := (select auth.uid());
begin
  if v_role is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  return query
    select r.id, r.lead_id, l.business_name, r.status, ap.full_name, sp.full_name, r.created_at, r.updated_at,
           (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'who', ep.full_name, 'role', e.actor_role,
                                                         'from', e.from_status, 'to', e.to_status, 'note', e.note) order by e.at), '[]'::jsonb)
              from public.outbound_lead_route_events e join public.profiles ep on ep.id = e.actor_id where e.route_id = r.id)
      from public.outbound_lead_routes r
      join public.leads l on l.id = r.lead_id
      join public.profiles sp on sp.id = r.started_by
      left join public.profiles ap on ap.id = r.assigned_profile
     where (v_role <> 'switchboard' or r.started_by = v_uid)
       and (not coalesce(p_open_only, true) or r.status not in ('assigned', 'director_received'))
     order by r.updated_at desc
     limit 200;
end;
$$;

-- Grants ------------------------------------------------------------------------------------------------
revoke all on function public.staff_create_assigned_task(text, text, text, timestamptz, uuid, uuid) from public, anon;
revoke all on function public.staff_assign_task(uuid, uuid, text) from public, anon;
revoke all on function public.staff_respond_task(uuid, boolean, text) from public, anon;
revoke all on function public.staff_task_board(text, integer) from public, anon;
revoke all on function public.staff_my_pending_tasks() from public, anon;
revoke all on function public.staff_approve_documents_in_absence(uuid, text) from public, anon;
revoke all on function public.staff_absence_approvals(uuid) from public, anon;
revoke all on function public.staff_outbound_team_members() from public, anon;
revoke all on function public.staff_start_outbound_route(uuid, text) from public, anon;
revoke all on function public.staff_move_outbound_route(uuid, text, text, uuid) from public, anon;
revoke all on function public.staff_outbound_routes(boolean) from public, anon;
grant execute on function public.staff_create_assigned_task(text, text, text, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.staff_assign_task(uuid, uuid, text) to authenticated;
grant execute on function public.staff_respond_task(uuid, boolean, text) to authenticated;
grant execute on function public.staff_task_board(text, integer) to authenticated;
grant execute on function public.staff_my_pending_tasks() to authenticated;
grant execute on function public.staff_approve_documents_in_absence(uuid, text) to authenticated;
grant execute on function public.staff_absence_approvals(uuid) to authenticated;
grant execute on function public.staff_outbound_team_members() to authenticated;
grant execute on function public.staff_start_outbound_route(uuid, text) to authenticated;
grant execute on function public.staff_move_outbound_route(uuid, text, text, uuid) to authenticated;
grant execute on function public.staff_outbound_routes(boolean) to authenticated;

notify pgrst, 'reload schema';
