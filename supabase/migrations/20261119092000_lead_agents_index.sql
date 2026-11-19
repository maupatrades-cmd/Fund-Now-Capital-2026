-- Lead agents (owner, 19 Nov 2026), 3/4: index for the new foreign key submission_intakes.field_agent_id.
-- MUST RUN OUTSIDE A TRANSACTION (CREATE INDEX CONCURRENTLY).
create index concurrently if not exists submission_intakes_field_agent_idx
  on public.submission_intakes (field_agent_id) where field_agent_id is not null;
