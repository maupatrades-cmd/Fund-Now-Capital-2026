-- Task completion notes (owner, 18 Nov 2026), 3/3: validate the client link added NOT VALID in 20261118180000, after its
-- index exists (20261118181000). Every existing row has client_id null, so it passes.
alter table public.staff_tasks validate constraint staff_tasks_client_id_fkey;
