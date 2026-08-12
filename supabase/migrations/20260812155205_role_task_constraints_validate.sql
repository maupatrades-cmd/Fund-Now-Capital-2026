-- Zero-downtime follow-up for role task management.
-- Statement-only and applied outside a transaction because concurrent indexes
-- cannot run inside a transaction block.

create index concurrently if not exists owner_tasks_assignee_open_idx
  on public.owner_tasks (assigned_to, due_at nulls last)
  where status in ('open','in_progress','blocked');

create index concurrently if not exists owner_tasks_escalation_idx
  on public.owner_tasks (escalation_at)
  where escalation_at is not null and status in ('open','in_progress','blocked');

alter table public.owner_tasks validate constraint owner_tasks_status_check;
alter table public.owner_tasks validate constraint owner_tasks_task_kind_check;
alter table public.owner_tasks validate constraint owner_tasks_blocker_consistent;
