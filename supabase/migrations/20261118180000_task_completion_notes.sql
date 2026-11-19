-- Task completion notes (owner, 18 Nov 2026): "she ticked every task but left no completion notes, and none is linked
-- to a client or lead ... From now on, she shouldn't close a task without a note."
--
--   * staff_close_task: marking a task DONE now needs a note of at least 10 characters from everyone except the
--     Director. Cancelling is unchanged. Two new defaulted parameters link the task to a lead or a client at completion
--     when it is not linked yet. The old 3-argument call keeps working.
--   * staff_add_task_note: a done task that was closed with no note can get its note ONCE, from the person who
--     completed it, the Director or the Office Administrator, optionally with a lead / client link.
--   * staff_tasks.client_id (new, nullable). The table holds rows: the foreign key is added NOT VALID here; its index is
--     built CONCURRENTLY in 20261118181000 and it is validated in 20261118182000.
--   * staff_task_guard (copied from live): a lead / client link may be ADDED (null -> value, never changed or removed),
--     and a closed task may take its missing note through staff_add_task_note only (fnc.task_note_add).

-- 1. Client link column + event value -------------------------------------------------------------------------------------
alter table public.staff_tasks add column if not exists client_id uuid;
alter table public.staff_tasks drop constraint if exists staff_tasks_client_id_fkey;
alter table public.staff_tasks add constraint staff_tasks_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null not valid;

alter table public.staff_task_events drop constraint if exists staff_task_events_event_check;
alter table public.staff_task_events add constraint staff_task_events_event_check check (event in (
  'created', 'routed', 'completed', 'cancelled', 'assigned', 'accepted', 'declined', 'question', 'note_added')) not valid;
alter table public.staff_task_events validate constraint staff_task_events_event_check;

-- 2. Guard (live body; link-adding and the one-time late note allowed) ----------------------------------------------------
create or replace function public.staff_task_guard()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then raise exception 'Tasks cannot be deleted; cancel them'; end if;
  if coalesce(current_setting('fnc.task_transition', true), '') <> 'on' then
    raise exception 'Tasks change only through the task functions';
  end if;
  if (new.id, new.title, new.task_kind, new.created_by, new.created_at)
     is distinct from (old.id, old.title, old.task_kind, old.created_by, old.created_at) then
    raise exception 'Task identity cannot be changed';
  end if;
  -- A lead or client link can be added once; never changed or removed.
  if (old.lead_id is not null and new.lead_id is distinct from old.lead_id)
     or (old.client_id is not null and new.client_id is distinct from old.client_id) then
    raise exception 'Task identity cannot be changed';
  end if;
  if old.status <> 'open' then
    -- The only change to a closed task: its missing completion note (and a link), through staff_add_task_note.
    if coalesce(current_setting('fnc.task_note_add', true), '') <> 'on'
       or nullif(btrim(coalesce(old.completion_note, '')), '') is not null
       or (new.status, new.completed_by, new.completed_at, new.notes, new.priority, new.due_at, new.route_to,
           new.assigned_to, new.assigned_by, new.acceptance, new.responded_at, new.decline_reason, new.call_log_id)
          is distinct from
          (old.status, old.completed_by, old.completed_at, old.notes, old.priority, old.due_at, old.route_to,
           old.assigned_to, old.assigned_by, old.acceptance, old.responded_at, old.decline_reason, old.call_log_id) then
      raise exception 'A % task cannot be changed', old.status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

-- 3. Shared link check: the lead / client must exist. -----------------------------------------------------------------------
create or replace function public.staff_task_check_links(p_lead_id uuid, p_client_id uuid)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_lead_id is not null and not exists (select 1 from public.leads l where l.id = p_lead_id) then
    raise exception 'That lead was not found';
  end if;
  if p_client_id is not null and not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'That client was not found';
  end if;
end;
$$;
revoke all on function public.staff_task_check_links(uuid, uuid) from public, anon, authenticated;

-- 4. Closing a task (live body + required note for done + optional links) ---------------------------------------------------
drop function if exists public.staff_close_task(uuid, text, text);
create or replace function public.staff_close_task(p_task_id uuid, p_outcome text, p_note text default null,
  p_lead_id uuid default null, p_client_id uuid default null)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_role text;
  v_task public.staff_tasks;
  v_uid  uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant']);
  if p_outcome not in ('done', 'cancelled') then raise exception 'Outcome must be done or cancelled'; end if;
  if p_outcome = 'done' and v_role <> 'owner' and coalesce(length(v_note), 0) < 10 then
    raise exception 'Write what happened before you mark this task done (at least 10 characters)';
  end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'Keep the note under 500 characters'; end if;
  perform public.staff_task_check_links(p_lead_id, p_client_id);
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
      if p_outcome = 'cancelled' and v_task.priority = 'important' then
        raise exception 'Only the Director can cancel an Important task' using errcode = '42501';
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
         completion_note = v_note,
         lead_id = coalesce(lead_id, p_lead_id),
         client_id = coalesce(client_id, p_client_id)
   where id = p_task_id;
  insert into public.staff_task_events (task_id, actor_id, actor_role, event, reason)
  values (p_task_id, v_uid, public.staff_actor_role(), case p_outcome when 'done' then 'completed' else 'cancelled' end, v_note);
  perform public.staff_audit_write('staff_task', p_task_id, case p_outcome when 'done' then 'task_completed' else 'task_cancelled' end, p_note,
    jsonb_build_object('lead_id', p_lead_id, 'client_id', p_client_id));
end;
$function$;
revoke all on function public.staff_close_task(uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.staff_close_task(uuid, text, text, uuid, uuid) to authenticated;

-- 5. Adding the missing note to a task already closed as done -----------------------------------------------------------------
create or replace function public.staff_add_task_note(p_task_id uuid, p_note text, p_lead_id uuid default null,
  p_client_id uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_task public.staff_tasks;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_rows int;
begin
  if v_uid is null or not (coalesce(public.is_owner(), false) or public.staff_role_of() is not null) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  if coalesce(length(v_note), 0) < 10 then raise exception 'Write what happened (at least 10 characters)'; end if;
  if length(v_note) > 500 then raise exception 'Keep the note under 500 characters'; end if;
  perform public.staff_task_check_links(p_lead_id, p_client_id);
  select * into v_task from public.staff_tasks t where t.id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if v_task.status <> 'done' then raise exception 'Only a task marked done takes a late note'; end if;
  if nullif(btrim(coalesce(v_task.completion_note, '')), '') is not null then
    raise exception 'This task already has a note';
  end if;
  if not (v_task.completed_by = v_uid or coalesce(public.is_owner(), false) or public.staff_can_assign_tasks()) then
    raise exception 'Only the person who completed this task, the Administrator or the Director can add its note'
      using errcode = '42501';
  end if;
  perform set_config('fnc.task_transition', 'on', true);
  perform set_config('fnc.task_note_add', 'on', true);
  update public.staff_tasks
     set completion_note = v_note, lead_id = coalesce(lead_id, p_lead_id), client_id = coalesce(client_id, p_client_id)
   where id = p_task_id;
  get diagnostics v_rows = row_count;
  perform set_config('fnc.task_note_add', 'off', true);
  if v_rows <> 1 then raise exception 'Adding the note affected no rows'; end if;
  insert into public.staff_task_events (task_id, actor_id, actor_role, event, reason)
  values (p_task_id, v_uid, coalesce(public.staff_actor_role(), 'owner'), 'note_added', v_note);
  perform public.staff_audit_write('staff_task', p_task_id, 'task_note_added', v_note,
    jsonb_build_object('lead_id', p_lead_id, 'client_id', p_client_id));
end;
$$;
revoke all on function public.staff_add_task_note(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.staff_add_task_note(uuid, text, uuid, uuid) to authenticated;

-- 6. The board (live body from 20261117131000) + the completion note, who completed it, the client link, and whether the
--    caller may add a missing note. The return type changes, so the function is dropped and recreated.
drop function if exists public.staff_task_board(text, integer);
create or replace function public.staff_task_board(p_status text default 'open', p_limit integer default 50)
returns table (
  id uuid, title text, notes text, task_kind text, priority text, status text, due_at timestamptz,
  route_to text, assigned_to uuid, assigned_name text, lead_id uuid, business_name text, created_by_name text,
  created_role text, created_at timestamptz, overdue boolean,
  acceptance text, assigned_by_name text, responded_at timestamptz, decline_reason text, given_by_me boolean,
  completion_note text, completed_by_name text, completed_at timestamptz, client_id uuid, client_name text,
  can_add_note boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare v_role text; v_uid uuid := (select auth.uid()); v_admin boolean; v_can_assign boolean;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant']);
  v_admin := coalesce(public.staff_role_of() = 'administrator', false);
  v_can_assign := coalesce(public.is_owner(), false) or coalesce(public.staff_can_assign_tasks(), false);
  return query
    select t.id, t.title, t.notes, t.task_kind, t.priority, t.status, t.due_at, t.route_to, t.assigned_to, ap.full_name,
           t.lead_id, l.business_name, cp.full_name, t.created_role, t.created_at,
           (t.status = 'open' and t.due_at is not null and t.due_at < now()),
           t.acceptance, bp.full_name, t.responded_at, t.decline_reason, coalesce(t.assigned_by = v_uid, false),
           t.completion_note, dp.full_name, t.completed_at, t.client_id, c.business_name,
           (t.status = 'done' and nullif(btrim(coalesce(t.completion_note, '')), '') is null
            and (t.completed_by = v_uid or v_can_assign))
      from public.staff_tasks t
      join public.profiles cp on cp.id = t.created_by
      left join public.profiles ap on ap.id = t.assigned_to
      left join public.profiles bp on bp.id = t.assigned_by
      left join public.profiles dp on dp.id = t.completed_by
      left join public.leads l on l.id = t.lead_id
      left join public.clients c on c.id = t.client_id
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
revoke all on function public.staff_task_board(text, integer) from public, anon;
grant execute on function public.staff_task_board(text, integer) to authenticated;
