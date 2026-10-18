-- Administrator Batch 2, review fixes (Qodo on PR #305, owner approved 18 Oct 2026). Forward-only.
--   1. A task given to a named person can be completed only by that person after accepting it; it can be
--      cancelled by whoever gave it, the Administrator or the Founder. Desk colleagues cannot close it.
--   2. When an outbound lead is given to an agent, sub-agent or partner, that person gets an in-app notice.
--   4. A task waiting for its person's answer cannot be forwarded the old way; forwarding an answered task
--      turns it back into an ordinary desk task (the give / accept fields are cleared).
--   5. "Tasks waiting for you" sort first on the board.
--   6. A declined task leaves the decliner's board and authority; it waits with whoever gave it.
--   7. Desk visibility hides only tasks from the give-to-a-person flow, so the Coordinator keeps sight of
--      tasks given to named people the old way.
-- (3, 8 and 9 are screen fixes.)

-- 1 + 6: closing ------------------------------------------------------------------------------------------
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
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
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

-- 4 + 6: forwarding ---------------------------------------------------------------------------------------
create or replace function public.staff_route_task(p_task_id uuid, p_route_to text, p_reason text, p_assigned_to uuid default null)
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
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'A reason is required to route a task'; end if;
  if not public.staff_task_can_route(v_role, p_route_to) then
    raise exception 'Your role cannot route a task to %', p_route_to using errcode = '42501';
  end if;
  select * into v_task from public.staff_tasks t where t.id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if v_task.acceptance = 'pending' then
    raise exception 'This task is waiting for its person to accept or decline it';
  end if;
  if v_task.acceptance is not null and v_role <> 'owner' then
    -- Accepted: the person may pass it on. Declined: only whoever gave it (or the Administrator) decides.
    if not ((v_task.acceptance = 'accepted' and v_task.assigned_to = v_uid)
            or v_task.assigned_by = v_uid or public.staff_can_assign_tasks()) then
      raise exception 'You can only route tasks that are with you or that you created' using errcode = '42501';
    end if;
  elsif v_role <> 'owner' and v_task.route_to <> v_role and v_task.created_by <> v_uid then
    raise exception 'You can only route tasks that are with you or that you created' using errcode = '42501';
  end if;
  if v_task.task_kind = 'founder_decision' and p_route_to <> 'owner' then
    raise exception 'A founder decision stays with the Owner';
  end if;
  if p_assigned_to is not null and not exists (
       select 1 from public.staff_access s join public.profiles p on p.id = s.profile_id
        where s.profile_id = p_assigned_to and s.access_enabled and p.is_active and s.staff_role::text = p_route_to) then
    raise exception 'The assignee must be an enabled % user', p_route_to;
  end if;
  perform set_config('fnc.task_transition', 'on', true);
  -- Forwarding the old way makes it an ordinary desk task again.
  update public.staff_tasks
     set route_to = p_route_to, assigned_to = p_assigned_to,
         acceptance = null, assigned_by = null, responded_at = null, decline_reason = null
   where id = p_task_id;
  insert into public.staff_task_events (task_id, actor_id, actor_role, event, from_route, to_route, reason)
  values (p_task_id, v_uid, public.staff_actor_role(), 'routed', v_task.route_to, p_route_to, btrim(p_reason));
  perform public.staff_audit_write('staff_task', p_task_id, 'task_routed', p_reason,
    jsonb_build_object('from', v_task.route_to, 'to', p_route_to));
end;
$$;

-- 5 + 6 + 7: the board ------------------------------------------------------------------------------------
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
            -- A task given through "give to a person" belongs to that person: the rest of the desk does not
            -- see it. Ordinary desk tasks (named the old way or not) stay visible as before.
            or (t.acceptance is null and t.route_to = v_role)
            or (t.acceptance is null and v_role = 'coordinator' and t.route_to = 'switchboard'))
     order by coalesce(t.acceptance = 'pending' and t.assigned_to = v_uid, false) desc, (t.priority = 'high') desc,
              t.due_at nulls last, t.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- 2: the agent, sub-agent or partner is told -----------------------------------------------------------------
create or replace function public.staff_move_outbound_route(
  p_route_id uuid, p_to text, p_note text default null, p_assigned_profile uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.outbound_lead_routes; v_role text := public.staff_actor_role(); v_ok boolean; v_name text; a uuid; v_home text;
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
  if p_to = 'assigned' then
    -- The team member is told the lead is theirs. The staff note is internal and is not shown to them.
    select case p.role::text when 'partner' then '/partner' when 'contractor' then '/contractor' else '/lead-referrer' end
      into v_home from public.profiles p where p.id = p_assigned_profile;
    perform public.staff_notify(p_assigned_profile, 'OUTBOUND_LEAD_ROUTED', 'A lead has been given to you: ' || coalesce(v_name, 'a lead'),
      'Fund Now Capital has noted this lead as yours. The office will contact you with the details.', v_home,
      jsonb_build_object('route_id', p_route_id));
  elsif p_to = 'with_administrator' then
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

notify pgrst, 'reload schema';
