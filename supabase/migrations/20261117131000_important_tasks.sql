-- Important tasks from the Director (owner, 17 Nov 2026), 2/2. Forward-only; reuses the staff task system
-- (staff_tasks / staff_task_events and the give-to-a-person flow of Administrator batch 2).
--
--   1. The Director (and, as before, the Administrator) can give a task to ANY enabled office staff member:
--      Administrator, Sales Coordinator, Switchboard, HR, Field Supervisor or field consultant. Never to yourself.
--   2. A new priority "important", which only the Director can set. It sorts first everywhere, cannot be declined
--      (accept it, or ask the Director a question), notifies in-app AND by email (emit_in_app_notification, the
--      same pipeline as every other emailed notice), and shows as a banner on the person's landing page until done.
--   3. HR and the field roles can open the task board (their own tasks only) and complete what they accepted.
--   4. The Director's daily briefing lists open Important tasks first and counts the overdue ones.
--
-- Every function below is redefined from its latest version; only the parts named in its comment change.

-- 1. Columns: the new priority, the new routes (a task given to a person sits with that person's role), and the
--    new "question" history event. Existing rows already satisfy the wider checks.
alter table public.staff_tasks drop constraint if exists staff_tasks_priority_check;
alter table public.staff_tasks add constraint staff_tasks_priority_check
  check (priority in ('low', 'normal', 'high', 'important'));
alter table public.staff_tasks drop constraint if exists staff_tasks_route_to_check;
alter table public.staff_tasks add constraint staff_tasks_route_to_check
  check (route_to in ('switchboard', 'coordinator', 'owner', 'administrator', 'hr', 'field_supervisor', 'field_consultant'));
alter table public.staff_task_events drop constraint if exists staff_task_events_event_check;
alter table public.staff_task_events add constraint staff_task_events_event_check
  check (event in ('created', 'routed', 'completed', 'cancelled', 'assigned', 'accepted', 'declined', 'question'));

-- Only the Director marks a task Important (the badge reads "from the Director"). Checked on insert: the priority
-- never changes afterwards (no task function updates it).
create or replace function public.staff_tasks_important_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.priority = 'important' and not coalesce(public.is_owner(), false) then
    raise exception 'Only the Director marks a task Important' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.staff_tasks_important_guard() from public, anon, authenticated;
drop trigger if exists staff_tasks_important_guard on public.staff_tasks;
create trigger staff_tasks_important_guard
  before insert on public.staff_tasks
  for each row execute function public.staff_tasks_important_guard();

-- 2. Giving a task to a person: any enabled office staff member (was: Sales Coordinator or Switchboard only).
--    An Important task is announced with its own notice, which is also emailed.
create or replace function public.staff_task_hand_to(p_task_id uuid, p_assignee uuid, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_task public.staff_tasks; v_to text; v_role text := public.staff_actor_role(); v_uid uuid := (select auth.uid());
  v_due text;
begin
  select s.staff_role::text into v_to
    from public.staff_access s join public.profiles p on p.id = s.profile_id
   where s.profile_id = p_assignee and s.access_enabled and p.is_active and p.role = s.staff_role
     and s.staff_role::text in ('administrator', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant');
  if v_to is null then
    raise exception 'Choose an enabled member of the office staff';
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
    jsonb_build_object('assignee', p_assignee, 'to', v_to, 'priority', v_task.priority));
  v_due := case when v_task.due_at is not null
             then ' Due ' || to_char(v_task.due_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI') || '.' else '' end;
  if v_task.priority = 'important' then
    perform public.emit_in_app_notification(p_assignee, 'STAFF_TASK_IMPORTANT',
      'Important task from the Director: ' || v_task.title,
      'The Director has given you an Important task. Open your tasks to accept it.' || v_due,
      '/staff/tasks', jsonb_build_object('task_id', p_task_id));
  else
    perform public.staff_notify(p_assignee, 'STAFF_TASK_ASSIGNED', 'New task for you: ' || v_task.title,
      'Open your tasks to accept or decline it.' || v_due, '/staff/tasks', jsonb_build_object('task_id', p_task_id));
  end if;
end;
$$;
revoke all on function public.staff_task_hand_to(uuid, uuid, text) from public, anon, authenticated;

-- 3. Accept / decline: an Important task cannot be declined. Otherwise unchanged.
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
  if not p_accept and v_task.priority = 'important' then
    raise exception 'An Important task from the Director cannot be declined. Accept it, or ask the Director a question.';
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

-- 4. Ask whoever gave the task a question (new). The person it was given to, while it is open and not declined.
--    The question is kept in the task history and sent to the giver in-app and by email.
create or replace function public.staff_task_ask_question(p_task_id uuid, p_question text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_task public.staff_tasks; v_uid uuid := (select auth.uid()); v_role text := public.staff_actor_role(); v_name text;
begin
  if v_role is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_question, ''))) not between 5 and 500 or not public.staff_text_is_safe(p_question) then
    raise exception 'Write your question (5 to 500 characters, no ID or account numbers)';
  end if;
  select * into v_task from public.staff_tasks t where t.id = p_task_id;
  if not found then raise exception 'Task not found'; end if;
  if v_task.assigned_to is distinct from v_uid or v_task.acceptance is null or v_task.acceptance = 'declined' then
    raise exception 'This task was not given to you' using errcode = '42501';
  end if;
  if v_task.status <> 'open' then raise exception 'This task is already closed'; end if;
  insert into public.staff_task_events (task_id, actor_id, actor_role, event, reason)
  values (p_task_id, v_uid, v_role, 'question', btrim(p_question));
  perform public.staff_audit_write('staff_task', p_task_id, 'task_question', p_question, '{}'::jsonb);
  select coalesce(nullif(btrim(p.full_name), ''), p.email) into v_name from public.profiles p where p.id = v_uid;
  perform public.emit_in_app_notification(coalesce(v_task.assigned_by, v_task.created_by), 'STAFF_TASK_QUESTION',
    'Question about: ' || v_task.title, coalesce(v_name, 'Staff') || ' asks: ' || btrim(p_question),
    '/staff/tasks', jsonb_build_object('task_id', p_task_id));
end;
$$;
revoke all on function public.staff_task_ask_question(uuid, text) from public, anon;
grant execute on function public.staff_task_ask_question(uuid, text) to authenticated;

-- 5. Closing: HR and the field roles may complete (or cancel what they created) too. Otherwise unchanged.
create or replace function public.staff_close_task(p_task_id uuid, p_outcome text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_task public.staff_tasks;
  v_uid  uuid := (select auth.uid());
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant']);
  if p_outcome not in ('done', 'cancelled') then raise exception 'Outcome must be done or cancelled'; end if;
  select * into v_task from public.staff_tasks t where t.id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if v_task.task_kind = 'founder_decision' and v_role <> 'owner' then
    raise exception 'Only the Owner can close a founder decision' using errcode = '42501';
  end if;
  if v_role <> 'owner' then
    if v_task.acceptance is not null then
      -- A task given to a named person (Administrator batch 2).
      if p_outcome = 'done' and not (v_task.assigned_to = v_uid and v_task.acceptance = 'accepted') then
        raise exception 'Only the person this task was given to can complete it, after accepting it' using errcode = '42501';
      end if;
      if p_outcome = 'cancelled' and not (v_task.assigned_by = v_uid or public.staff_can_assign_tasks()) then
        raise exception 'Only whoever gave this task, the Administrator or the Founder can cancel it' using errcode = '42501';
      end if;
    elsif v_task.route_to <> v_role and v_task.assigned_to is distinct from v_uid
          and not (p_outcome = 'cancelled' and v_task.created_by = v_uid) then
      raise exception 'This task is not with you' using errcode = '42501';
    end if;
  end if;
  perform set_config('fnc.task_transition', 'on', true);
  update public.staff_tasks
     set status = p_outcome,
         completed_by = case when p_outcome = 'done' then v_uid end,
         completed_at = case when p_outcome = 'done' then now() end,
         completion_note = nullif(btrim(p_note), '')
   where id = p_task_id;
  insert into public.staff_task_events (task_id, actor_id, actor_role, event, reason)
  values (p_task_id, v_uid, public.staff_actor_role(), case p_outcome when 'done' then 'completed' else 'cancelled' end, nullif(btrim(p_note), ''));
  perform public.staff_audit_write('staff_task', p_task_id, case p_outcome when 'done' then 'task_completed' else 'task_cancelled' end, p_note, '{}'::jsonb);
end;
$$;

-- 6. The board: HR and the field roles see their own tasks; Important first. Return shape unchanged.
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
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant']);
  v_admin := coalesce(public.staff_role_of() = 'administrator', false);
  return query
    select t.id, t.title, t.notes, t.task_kind, t.priority, t.status, t.due_at, t.route_to, t.assigned_to, ap.full_name,
           t.lead_id, l.business_name, cp.full_name, t.created_role, t.created_at,
           (t.status = 'open' and t.due_at is not null and t.due_at < now()),
           t.acceptance, bp.full_name, t.responded_at, t.decline_reason, coalesce(t.assigned_by = v_uid, false)
      from public.staff_tasks t
      join public.profiles cp on cp.id = t.created_by
      left join public.profiles ap on ap.id = t.assigned_to
      left join public.profiles bp on bp.id = t.assigned_by
      left join public.leads l on l.id = t.lead_id
     where (p_status is null or t.status = p_status)
       and (v_role = 'owner'
            or t.created_by = v_uid
            -- Someone who declined a task no longer has it.
            or (t.assigned_to = v_uid and t.acceptance is distinct from 'declined')
            or t.assigned_by = v_uid
            or (v_admin and t.route_to in ('coordinator', 'switchboard'))
            -- Desk tasks (never given to a person) stay with their desk. Only the Coordinator and Switchboard
            -- have desks; a task given to HR or a field role always has a person.
            or (t.acceptance is null and t.route_to = v_role and v_role in ('coordinator', 'switchboard'))
            or (t.acceptance is null and v_role = 'coordinator' and t.route_to = 'switchboard'))
     order by coalesce(t.acceptance = 'pending' and t.assigned_to = v_uid, false) desc,
              (t.priority = 'important') desc, (t.priority = 'high') desc,
              t.due_at nulls last, t.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- 7. Waiting for your answer: Important first. Otherwise unchanged.
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
     order by (t.priority = 'important') desc, t.due_at nulls last, t.created_at
     limit 50;
end;
$$;

-- 8. The landing-page banner (new): the caller's open Important tasks, until they are done.
create or replace function public.staff_my_important_tasks()
returns table (id uuid, title text, notes text, due_at timestamptz, overdue boolean, acceptance text,
               assigned_by_name text, business_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.staff_actor_role() is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  return query
    select t.id, t.title, t.notes, t.due_at, (t.due_at is not null and t.due_at < now()), t.acceptance,
           bp.full_name, l.business_name
      from public.staff_tasks t
      left join public.profiles bp on bp.id = t.assigned_by
      left join public.leads l on l.id = t.lead_id
     where t.assigned_to = (select auth.uid()) and t.status = 'open' and t.priority = 'important'
       and t.acceptance in ('pending', 'accepted')
     order by t.due_at nulls last, t.created_at
     limit 20;
end;
$$;
revoke all on function public.staff_my_important_tasks() from public, anon;
grant execute on function public.staff_my_important_tasks() to authenticated;

-- 9. The Director's daily briefing: open Important tasks come first in the urgent list (with or without a due
--    date), and the overdue Important ones are counted. Otherwise unchanged from 20261019091000.
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
      'important_open', (select count(*)::int from public.staff_tasks t where t.status = 'open' and t.priority = 'important'),
      'important_overdue', (select count(*)::int from public.staff_tasks t
                             where t.status = 'open' and t.priority = 'important' and t.due_at < now()),
      'urgent', coalesce((
        select jsonb_agg(x order by x.important desc, x.due_at nulls last) from (
          select t.title, t.priority, t.due_at, t.route_to, p.full_name as assignee, l.business_name, t.acceptance,
                 (t.priority = 'important') as important
            from public.staff_tasks t left join public.profiles p on p.id = t.assigned_to left join public.leads l on l.id = t.lead_id
           where t.status = 'open' and (t.priority in ('high', 'important') or t.due_at < now() + interval '1 day')
           order by (t.priority = 'important') desc, t.due_at nulls last limit 15) x), '[]'::jsonb)),
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
