-- Field team marketing-materials requests (owner, 17 Nov 2026), part 1 of 2: a new staff task kind. It has its own
-- migration so the wider check is in place before 20261118101000 inserts the first 'materials_request' task. Every
-- existing row already passes the wider check.
alter table public.staff_tasks drop constraint if exists staff_tasks_task_kind_check;
alter table public.staff_tasks add constraint staff_tasks_task_kind_check
  check (task_kind in ('general', 'document_chase', 'callback', 'founder_decision', 'review', 'materials_request'));
