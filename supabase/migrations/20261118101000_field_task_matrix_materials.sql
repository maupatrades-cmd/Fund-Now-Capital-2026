-- Field team tasks (owner, 17 Nov 2026), part 2 of 2.
--
--   1. Who may give a task to whom (giver -> the staff role of the person receiving it):
--        Director (owner) and Office Administrator -> any enabled member of the office staff (unchanged);
--        Sales Coordinator -> the Field Supervisor and field consultants;
--        Field Supervisor  -> field consultants.
--      Important tasks stay Director-only (the staff_tasks_important_guard trigger is unchanged). Re-giving an
--      existing task to someone else (staff_assign_task) and cancelling a task somebody else gave stay with the
--      Director and the Administrator (staff_can_assign_tasks is unchanged): the new givers only create tasks, and
--      cancel the ones they gave (staff_close_task already allows that).
--   2. Marketing-materials request: the Field Supervisor and field consultants ask the office for flyers, banners,
--      forms and so on. The request is a staff task (task_kind 'materials_request') given straight to the Office
--      Administrator, who accepts it and marks it done with the normal task flow. The requester sees where it stands
--      on their task board, because they created it.
--
-- staff_task_hand_to is copied from 20261117131000; the only change is the matrix check. staff_create_assigned_task is
-- copied from 20261018121000; the only change is who may call it.

-- 1. The matrix --------------------------------------------------------------------------------------------------------
create or replace function public.staff_task_may_assign(p_to_role text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select case
           when public.staff_is_founder_or_administrator() then
             coalesce(p_to_role in ('administrator', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant'), false)
           when public.staff_role_of() = 'coordinator' then coalesce(p_to_role in ('field_supervisor', 'field_consultant'), false)
           when public.staff_role_of() = 'field_supervisor' then coalesce(p_to_role = 'field_consultant', false)
           else false
         end;
$$;
revoke all on function public.staff_task_may_assign(text) from public, anon, authenticated;

-- Whether the caller gives tasks to named people at all (has any row in the matrix).
create or replace function public.staff_task_can_give()
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.staff_is_founder_or_administrator()
      or coalesce(public.staff_role_of() in ('coordinator', 'field_supervisor'), false);
$$;
revoke all on function public.staff_task_can_give() from public, anon, authenticated;

-- The people the caller may give a task to (the Give task picker). Never the caller.
create or replace function public.staff_task_assignable_people()
returns table (profile_id uuid, full_name text, staff_role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.staff_task_can_give() then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query
    select s.profile_id, p.full_name, s.staff_role::text
      from public.staff_access s join public.profiles p on p.id = s.profile_id
     where s.access_enabled and p.is_active and p.role = s.staff_role
       and s.profile_id <> (select auth.uid())
       and public.staff_task_may_assign(s.staff_role::text)
     order by p.full_name;
end;
$$;
revoke all on function public.staff_task_assignable_people() from public, anon;
grant execute on function public.staff_task_assignable_people() to authenticated;

-- 2. Giving a task: the Sales Coordinator and the Field Supervisor may now create one; the matrix is checked when it
--    is handed over, so the same rule covers every way a task reaches a person.
create or replace function public.staff_create_assigned_task(
  p_title text, p_notes text, p_priority text, p_due_at timestamptz, p_assignee uuid, p_lead_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_role text := public.staff_actor_role();
begin
  if not public.staff_task_can_give() then
    raise exception 'Only the Director, the Administrator, the Sales Coordinator or the Field Supervisor gives tasks to a named person' using errcode = '42501';
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

-- 3. Handing a task to a person: unchanged except that the giver must be allowed to give to that person's role.
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
  if not public.staff_task_may_assign(v_to) then
    raise exception 'You cannot give a task to that person' using errcode = '42501';
  end if;
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

-- 4. Marketing-materials request -------------------------------------------------------------------------------------
-- Given to the first enabled Office Administrator (by when their staff access was set up); every enabled Administrator
-- is told. With no enabled Administrator it waits on the Director's desk (route_to 'owner') and the Director is told.
-- Due at 17:00 SAST on the needed-by date. The requester may cancel it (staff_close_task: whoever gave it).
create or replace function public.staff_request_materials(
  p_items text, p_quantity text, p_needed_by date, p_area text default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := public.staff_role_of(); v_uid uuid := (select auth.uid()); v_admin uuid; v_id uuid; v_name text;
  v_items text := btrim(coalesce(p_items, '')); v_qty text := btrim(coalesce(p_quantity, ''));
  v_area text := nullif(btrim(coalesce(p_area, '')), ''); v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_route text; v_notes text; v_r uuid;
begin
  if v_role is null or v_role not in ('field_supervisor', 'field_consultant') then
    raise exception 'Only the Field Supervisor and field consultants request marketing materials' using errcode = '42501';
  end if;
  if length(v_items) not between 2 and 120 then raise exception 'Say what you need (2 to 120 characters)'; end if;
  if length(v_qty) not between 1 and 60 then raise exception 'Say how many you need (up to 60 characters)'; end if;
  if p_needed_by is null or p_needed_by < public.current_sast_date() then
    raise exception 'Choose the date you need them by (today or later)';
  end if;
  if v_area is not null and length(v_area) > 160 then raise exception 'Keep the area under 160 characters'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'Keep the note under 500 characters'; end if;
  v_notes := 'Quantity: ' || v_qty || E'\nNeeded by: ' || to_char(p_needed_by, 'Dy DD Mon YYYY')
             || coalesce(E'\nDeliver to / area: ' || v_area, '') || coalesce(E'\nNote: ' || v_note, '');

  select s.profile_id into v_admin
    from public.staff_access s join public.profiles p on p.id = s.profile_id
   where s.access_enabled and p.is_active and s.staff_role::text = 'administrator' and p.role = s.staff_role
   order by s.created_at, s.profile_id
   limit 1;
  v_route := case when v_admin is null then 'owner' else 'administrator' end;

  perform set_config('fnc.task_transition', 'on', true);
  insert into public.staff_tasks (title, notes, task_kind, priority, due_at, route_to, assigned_to, assigned_by, acceptance,
                                  created_by, created_role)
  values (left('Marketing materials: ' || v_items, 160), v_notes, 'materials_request', 'normal',
          (p_needed_by + time '17:00') at time zone 'Africa/Johannesburg', v_route, v_admin,
          case when v_admin is not null then v_uid end, case when v_admin is not null then 'pending' end,
          v_uid, v_role)
  returning id into v_id;
  insert into public.staff_task_events (task_id, actor_id, actor_role, event, to_route)
  values (v_id, v_uid, v_role, 'created', v_route);
  if v_admin is not null then
    insert into public.staff_task_events (task_id, actor_id, actor_role, event, to_route)
    values (v_id, v_uid, v_role, 'assigned', 'administrator');
  end if;
  perform public.staff_audit_write('staff_task', v_id, 'materials_requested', null,
    jsonb_build_object('items', v_items, 'needed_by', p_needed_by, 'assignee', v_admin));

  select coalesce(nullif(btrim(p.full_name), ''), p.email) into v_name from public.profiles p where p.id = v_uid;
  for v_r in
    select s.profile_id from public.staff_access s join public.profiles p on p.id = s.profile_id
     where s.access_enabled and p.is_active and s.staff_role::text = 'administrator' and p.role = s.staff_role
    union
    select p.id from public.profiles p where v_admin is null and p.role::text = 'owner' and p.is_active
  loop
    perform public.staff_notify(v_r, 'STAFF_TASK_ASSIGNED', 'Marketing materials request: ' || v_items,
      coalesce(v_name, 'The field team') || ' needs ' || v_qty || ' by ' || to_char(p_needed_by, 'Dy DD Mon') || '.'
        || case when v_r = v_admin then ' Open your tasks to accept it.' else '' end,
      '/staff/tasks', jsonb_build_object('task_id', v_id));
  end loop;
  return v_id;
end;
$$;
revoke all on function public.staff_request_materials(text, text, date, text, text) from public, anon;
grant execute on function public.staff_request_materials(text, text, date, text, text) to authenticated;
