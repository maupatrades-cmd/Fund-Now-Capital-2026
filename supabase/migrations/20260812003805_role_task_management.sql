-- C5: Extend owner_tasks into an assignable role-scoped CRM task workflow.

alter table public.owner_tasks
  add column if not exists task_kind text not null default 'follow_up',
  add column if not exists blocker_reason text,
  add column if not exists escalation_at timestamptz;

alter table public.owner_tasks drop constraint if exists owner_tasks_status_check;
alter table public.owner_tasks
  add constraint owner_tasks_status_check
  check (status in ('open','in_progress','blocked','completed','cancelled')) not valid;
alter table public.owner_tasks validate constraint owner_tasks_status_check;

alter table public.owner_tasks drop constraint if exists owner_tasks_task_kind_check;
alter table public.owner_tasks
  add constraint owner_tasks_task_kind_check
  check (task_kind in ('follow_up','document_request','paperwork_review','client_contact','funder_follow_up','meeting','payment')) not valid;
alter table public.owner_tasks validate constraint owner_tasks_task_kind_check;

alter table public.owner_tasks drop constraint if exists owner_tasks_blocker_consistent;
alter table public.owner_tasks
  add constraint owner_tasks_blocker_consistent
  check (
    (status = 'blocked' and nullif(btrim(coalesce(blocker_reason,'')), '') is not null)
    or (status <> 'blocked' and blocker_reason is null)
  ) not valid;
alter table public.owner_tasks validate constraint owner_tasks_blocker_consistent;

create index if not exists owner_tasks_assignee_open_idx
  on public.owner_tasks (assigned_to, due_at nulls last)
  where status in ('open','in_progress','blocked');
create index if not exists owner_tasks_escalation_idx
  on public.owner_tasks (escalation_at)
  where escalation_at is not null and status in ('open','in_progress','blocked');

drop policy if exists owner_tasks_assignee_select on public.owner_tasks;
create policy owner_tasks_assignee_select
on public.owner_tasks for select to authenticated
using (assigned_to = (select auth.uid()));

create or replace function public.owner_assign_crm_task(
  p_title text,
  p_task_kind text,
  p_assigned_to uuid,
  p_notes text default null,
  p_due_at timestamptz default null,
  p_escalation_at timestamptz default null,
  p_priority text default 'normal',
  p_client_id uuid default null,
  p_lead_id uuid default null,
  p_deal_id uuid default null
)
returns public.owner_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.owner_tasks%rowtype;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can assign CRM tasks' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_assigned_to and p.is_active
      and p.role::text in ('owner','partner','contractor','lead_referrer')
  ) then
    raise exception 'Assignee is not an active supported role';
  end if;
  if length(btrim(coalesce(p_title,''))) not between 3 and 160 then
    raise exception 'Task title must be 3 to 160 characters';
  end if;
  if p_task_kind not in ('follow_up','document_request','paperwork_review','client_contact','funder_follow_up','meeting','payment') then
    raise exception 'Unsupported task kind';
  end if;
  if p_priority not in ('low','normal','high') then raise exception 'Invalid priority'; end if;
  if p_escalation_at is not null and p_due_at is not null and p_escalation_at < p_due_at then
    raise exception 'Escalation cannot be earlier than the due date';
  end if;
  insert into public.owner_tasks (
    title, task_kind, assigned_to, notes, due_at, escalation_at, priority,
    client_id, lead_id, deal_id, created_by
  ) values (
    btrim(p_title), p_task_kind, p_assigned_to, nullif(btrim(p_notes),''),
    p_due_at, p_escalation_at, p_priority,
    p_client_id, p_lead_id, p_deal_id, auth.uid()
  )
  returning * into v_task;
  return v_task;
end;
$$;

create or replace function public.task_assignee_set_status(
  p_task_id uuid,
  p_status text,
  p_blocker_reason text default null
)
returns public.owner_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.owner_tasks%rowtype;
  v_uid uuid := auth.uid();
begin
  if p_status not in ('open','in_progress','blocked','completed') then
    raise exception 'Unsupported assignee task status';
  end if;
  select * into v_task from public.owner_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not public.is_owner() and v_task.assigned_to is distinct from v_uid then
    raise exception 'Task is not assigned to the current user' using errcode = '42501';
  end if;
  if p_status = 'blocked' and nullif(btrim(coalesce(p_blocker_reason,'')), '') is null then
    raise exception 'A blocked task requires a reason';
  end if;
  update public.owner_tasks
  set status = p_status,
      blocker_reason = case when p_status = 'blocked' then btrim(p_blocker_reason) else null end,
      completed_at = case when p_status = 'completed' then now() else null end,
      completed_by = case when p_status = 'completed' then v_uid else null end
  where id = p_task_id
  returning * into v_task;
  return v_task;
end;
$$;

revoke all on function public.owner_assign_crm_task(text,text,uuid,text,timestamptz,timestamptz,text,uuid,uuid,uuid)
  from public, anon;
grant execute on function public.owner_assign_crm_task(text,text,uuid,text,timestamptz,timestamptz,text,uuid,uuid,uuid)
  to authenticated;
revoke all on function public.task_assignee_set_status(uuid,text,text)
  from public, anon;
grant execute on function public.task_assignee_set_status(uuid,text,text)
  to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'owner_tasks'
      and policyname = 'owner_tasks_assignee_select'
  ) then raise exception 'C5: assignee RLS missing'; end if;
  if has_table_privilege('authenticated','public.owner_tasks','UPDATE') then
    raise exception 'C5: authenticated direct task update must remain blocked';
  end if;
end;
$$;

notify pgrst, 'reload schema';
