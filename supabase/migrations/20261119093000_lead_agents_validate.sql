-- Lead agents (owner, 19 Nov 2026), 4/4: validate the constraints added NOT VALID in 20261119091000, after the index
-- exists (20261119092000). Every existing row passes: none is a field lead and none carries a field person.
alter table public.submission_intakes validate constraint submission_intakes_field_agent_fk;
alter table public.submission_intakes validate constraint submission_intakes_channel_shape_ck;
alter table public.submission_intakes validate constraint submission_intakes_field_shape_ck;
