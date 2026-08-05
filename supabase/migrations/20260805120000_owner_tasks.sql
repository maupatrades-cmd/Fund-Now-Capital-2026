-- Owner work queue: dated follow-ups linked to CRM records. This is deliberately
-- separate from communications so completing a task never rewrites call history.
create table if not exists public.owner_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 3 and 160),
  notes text,
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  client_id uuid references public.clients(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_tasks_completion_consistent check (
    (status = 'completed' and completed_at is not null and completed_by is not null)
    or (status <> 'completed' and completed_at is null and completed_by is null)
  )
);

create index if not exists owner_tasks_open_due_idx
  on public.owner_tasks (due_at nulls last, created_at desc) where status = 'open';
create index if not exists owner_tasks_deal_idx on public.owner_tasks (deal_id) where deal_id is not null;

alter table public.owner_tasks enable row level security;
drop policy if exists owner_tasks_owner_all on public.owner_tasks;
drop policy if exists owner_tasks_owner_select on public.owner_tasks;
create policy owner_tasks_owner_select on public.owner_tasks for select to authenticated
  using (public.is_owner());

revoke all on table public.owner_tasks from public, anon, authenticated;
grant select on table public.owner_tasks to authenticated;
grant all on table public.owner_tasks to service_role;

drop trigger if exists set_updated_at on public.owner_tasks;
create trigger set_updated_at before update on public.owner_tasks
  for each row execute function public.set_updated_at();
drop trigger if exists log_activity_owner_tasks on public.owner_tasks;
create trigger log_activity_owner_tasks after insert or update or delete on public.owner_tasks
  for each row execute function public.log_activity();

create or replace function public.owner_create_task(
  p_title text,
  p_notes text default null,
  p_due_at timestamptz default null,
  p_priority text default 'normal'
)
returns public.owner_tasks language plpgsql security definer set search_path = '' as $$
declare v_task public.owner_tasks; v_uid uuid := auth.uid();
begin
  if not public.is_owner() then raise exception 'Only the owner can create tasks' using errcode='42501'; end if;
  if length(btrim(coalesce(p_title,''))) not between 3 and 160 then raise exception 'Task title must be 3 to 160 characters'; end if;
  if p_priority not in ('low','normal','high') then raise exception 'Invalid task priority'; end if;
  insert into public.owner_tasks(title,notes,due_at,priority,created_by)
  values(btrim(p_title),nullif(btrim(p_notes),''),p_due_at,p_priority,v_uid)
  returning * into v_task;
  return v_task;
end $$;

create or replace function public.owner_set_task_status(p_task_id uuid, p_status text)
returns public.owner_tasks language plpgsql security definer set search_path = '' as $$
declare v_task public.owner_tasks; v_uid uuid := auth.uid();
begin
  if not public.is_owner() then raise exception 'Only the owner can update tasks' using errcode='42501'; end if;
  if p_status not in ('open','completed','cancelled') then raise exception 'Invalid task status'; end if;
  update public.owner_tasks set status=p_status,
    completed_at=case when p_status='completed' then now() else null end,
    completed_by=case when p_status='completed' then v_uid else null end
  where id=p_task_id returning * into v_task;
  if not found then raise exception 'Task not found'; end if;
  return v_task;
end $$;

revoke all on function public.owner_create_task(text,text,timestamptz,text) from public, anon;
revoke all on function public.owner_set_task_status(uuid,text) from public, anon;
grant execute on function public.owner_create_task(text,text,timestamptz,text) to authenticated, service_role;
grant execute on function public.owner_set_task_status(uuid,text) to authenticated, service_role;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='owner_tasks' and policyname='owner_tasks_owner_select') then raise exception 'assert: owner task policy missing'; end if;
  if has_table_privilege('authenticated','public.owner_tasks','INSERT') or has_table_privilege('authenticated','public.owner_tasks','UPDATE') or has_table_privilege('authenticated','public.owner_tasks','DELETE') then raise exception 'assert: direct task writes must be blocked'; end if;
  if has_function_privilege('anon','public.owner_create_task(text,text,timestamptz,text)','execute') then raise exception 'assert: anon task create execute'; end if;
  if has_function_privilege('anon','public.owner_set_task_status(uuid,text)','execute') then raise exception 'assert: anon task status execute'; end if;
end $$;

notify pgrst, 'reload schema';
