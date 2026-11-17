-- Important tasks (owner, 17 Nov 2026): only the Director can cancel an Important task. Same function as
-- 20261117131000 section 5; the only change is the new check before the existing cancel rule. Important tasks always
-- go to a named person (acceptance is set), so the check sits in that branch; the Director's own path is unchanged.
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
         completion_note = nullif(btrim(p_note), '')
   where id = p_task_id;
  insert into public.staff_task_events (task_id, actor_id, actor_role, event, reason)
  values (p_task_id, v_uid, public.staff_actor_role(), case p_outcome when 'done' then 'completed' else 'cancelled' end, nullif(btrim(p_note), ''));
  perform public.staff_audit_write('staff_task', p_task_id, case p_outcome when 'done' then 'task_completed' else 'task_cancelled' end, p_note, '{}'::jsonb);
end;
$$;
