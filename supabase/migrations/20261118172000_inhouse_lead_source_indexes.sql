-- In-house lead source (owner, 18 Nov 2026), 3/4: indexes for the two new foreign keys on submission_intakes.
-- MUST RUN OUTSIDE A TRANSACTION (CREATE INDEX CONCURRENTLY): apply each statement on its own.
create index concurrently if not exists submission_intakes_inhouse_staff_idx
  on public.submission_intakes (inhouse_staff_id) where inhouse_staff_id is not null;
create index concurrently if not exists submission_intakes_inhouse_office_idx
  on public.submission_intakes (inhouse_office_code) where inhouse_office_code is not null;
