-- Task completion notes (owner, 18 Nov 2026), 2/3: index for staff_tasks.client_id.
-- MUST RUN OUTSIDE A TRANSACTION (CREATE INDEX CONCURRENTLY).
create index concurrently if not exists staff_tasks_client_id_idx on public.staff_tasks (client_id) where client_id is not null;
