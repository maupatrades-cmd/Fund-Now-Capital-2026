-- In-house lead source (owner, 18 Nov 2026), 4/4: validate the constraints added NOT VALID in 20261118171000, after the
-- indexes exist (20261118172000). Every existing row passes: none is in-house and none carries in-house details.
alter table public.submission_intakes validate constraint submission_intakes_inhouse_staff_fk;
alter table public.submission_intakes validate constraint submission_intakes_inhouse_office_fk;
alter table public.submission_intakes validate constraint submission_intakes_channel_shape_ck;
alter table public.submission_intakes validate constraint submission_intakes_inhouse_shape_ck;
