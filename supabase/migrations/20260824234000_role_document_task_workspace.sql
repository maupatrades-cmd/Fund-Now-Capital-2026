-- Role-facing governed paperwork task workspace.
-- Reuses owner_tasks and deal_document_task_evidence; no parallel task model.

create or replace function public.role_document_task_workspace()
returns table (
  task_id uuid,
  title text,
  task_kind text,
  priority text,
  status text,
  blocker_reason text,
  due_at timestamptz,
  escalation_at timestamptz,
  assigned_to uuid,
  assignee_name text,
  assignee_role text,
  client_id uuid,
  client_business_name text,
  deal_id uuid,
  deal_reference text,
  document_type text,
  document_status text,
  is_submission_blocker boolean,
  submission_blocking_reason text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select p.role::text into v_role
  from public.profiles p
  where p.id = v_uid and p.is_active;

  if v_role not in ('owner','partner','contractor','lead_referrer') then
    raise exception 'Role is not authorized for document tasks' using errcode = '42501';
  end if;

  return query
  select
    t.id,
    t.title,
    t.task_kind,
    t.priority,
    t.status,
    t.blocker_reason,
    t.due_at,
    t.escalation_at,
    t.assigned_to,
    coalesce(nullif(btrim(a.full_name), ''), a.email, 'Unassigned'),
    a.role::text,
    t.client_id,
    coalesce(c.business_name, 'Client'),
    t.deal_id,
    d.reference,
    e.document_type::text,
    e.document_status,
    coalesce(e.is_submission_blocker, false),
    e.blocking_reason,
    t.updated_at
  from public.owner_tasks t
  left join public.deal_document_task_evidence e on e.task_id = t.id
  left join public.profiles a on a.id = t.assigned_to
  left join public.clients c on c.id = t.client_id
  left join public.deals d on d.id = t.deal_id
  where t.task_kind in ('document_request','paperwork_review')
    and e.task_id is not null
    and (v_role = 'owner' or t.assigned_to = v_uid)
  order by
    case t.status when 'blocked' then 0 when 'open' then 1 when 'in_progress' then 2 else 3 end,
    e.is_submission_blocker desc,
    t.due_at nulls last,
    t.created_at desc;
end;
$$;

comment on function public.role_document_task_workspace() is
  'Sanitized governed-document task projection. Owner sees all; supported role users see only tasks assigned to auth.uid(). Internal task notes and unrelated tasks are never returned.';

create or replace function public.owner_reassign_document_task(
  p_task_id uuid,
  p_assigned_to uuid,
  p_due_at timestamptz default null,
  p_priority text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.owner_tasks%rowtype;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can reassign document tasks' using errcode = '42501';
  end if;
  if p_priority is not null and p_priority not in ('low','normal','high') then
    raise exception 'Invalid task priority';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_assigned_to
      and p.is_active
      and p.role::text in ('owner','partner','contractor','lead_referrer')
  ) then
    raise exception 'Assignee is not an active supported role';
  end if;

  select * into v_task
  from public.owner_tasks t
  where t.id = p_task_id
  for update;
  if not found then raise exception 'Task not found'; end if;
  if v_task.task_kind not in ('document_request','paperwork_review')
    or not exists (select 1 from public.deal_document_task_evidence e where e.task_id = p_task_id) then
    raise exception 'Task is not governed document work';
  end if;

  update public.owner_tasks
  set assigned_to = p_assigned_to,
      due_at = coalesce(p_due_at, due_at),
      priority = coalesce(p_priority, priority)
  where id = p_task_id;

  update public.deal_document_task_evidence
  set assigned_to = p_assigned_to,
      synced_at = now()
  where task_id = p_task_id;

  return p_task_id;
end;
$$;

create or replace function public.role_set_document_task_status(
  p_task_id uuid,
  p_status text,
  p_blocker_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.owner_tasks%rowtype;
  v_is_owner boolean;
  v_is_submission_blocker boolean;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_status not in ('open','in_progress','blocked','completed') then
    raise exception 'Unsupported document task status';
  end if;
  if p_status = 'blocked' and nullif(btrim(coalesce(p_blocker_reason,'')), '') is null then
    raise exception 'A blocked task requires a reason';
  end if;

  v_is_owner := public.is_owner();
  select * into v_task from public.owner_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not v_is_owner and v_task.assigned_to is distinct from v_uid then
    raise exception 'Task is not assigned to the current user' using errcode = '42501';
  end if;
  if v_task.task_kind not in ('document_request','paperwork_review') then
    raise exception 'Task is not governed document work';
  end if;

  select e.is_submission_blocker into v_is_submission_blocker
  from public.deal_document_task_evidence e
  where e.task_id = p_task_id;
  if not found then raise exception 'Document task evidence not found'; end if;
  if p_status = 'completed' and v_is_submission_blocker then
    raise exception 'This task cannot be completed until the required document is accepted';
  end if;

  update public.owner_tasks
  set status = p_status,
      blocker_reason = case when p_status = 'blocked' then btrim(p_blocker_reason) else null end,
      completed_at = case when p_status = 'completed' then now() else null end,
      completed_by = case when p_status = 'completed' then v_uid else null end
  where id = p_task_id;
  return p_task_id;
end;
$$;

create or replace function public.owner_document_task_assignees()
returns table (profile_id uuid, display_name text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email, 'Team member'), p.role::text
  from public.profiles p
  where public.is_owner()
    and p.is_active
    and p.role::text in ('owner','partner','contractor','lead_referrer')
  order by p.role::text, 2;
$$;

revoke all on function public.role_document_task_workspace() from public, anon;
revoke all on function public.owner_reassign_document_task(uuid,uuid,timestamptz,text) from public, anon;
revoke all on function public.role_set_document_task_status(uuid,text,text) from public, anon;
revoke all on function public.owner_document_task_assignees() from public, anon;
grant execute on function public.role_document_task_workspace() to authenticated;
grant execute on function public.owner_reassign_document_task(uuid,uuid,timestamptz,text) to authenticated;
grant execute on function public.role_set_document_task_status(uuid,text,text) to authenticated;
grant execute on function public.owner_document_task_assignees() to authenticated;

do $$
begin
  if has_function_privilege('anon','public.role_document_task_workspace()','execute')
    or has_function_privilege('anon','public.role_set_document_task_status(uuid,text,text)','execute')
    or has_function_privilege('anon','public.owner_reassign_document_task(uuid,uuid,timestamptz,text)','execute') then
    raise exception 'anonymous document-task access must remain revoked';
  end if;
  if has_table_privilege('authenticated','public.owner_tasks','UPDATE')
    or has_table_privilege('authenticated','public.deal_document_task_evidence','UPDATE') then
    raise exception 'document task writes must remain RPC-only';
  end if;
end;
$$;

notify pgrst, 'reload schema';
