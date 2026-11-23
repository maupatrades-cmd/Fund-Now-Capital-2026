-- R100: the Director's choice only (owner decision 20 Nov 2026: "my choice only").
-- Until now an R100 reward lock was created automatically for the agent when a submission was marked Verified
-- (trigger submission_intakes_r100_on_verified) or when the Director approved a missing document
-- (trigger intake_absence_approvals_r100), both calling r100_create_for_verified. With the R100 chooser
-- (20261119121000, file_reward_assignments) the Director now chooses who gets each file's R100, so the automatic
-- path would pay a second R100 on the same file. Both triggers are dropped; r100_create_for_verified and the rest of
-- the R100 engine stay in place (unused by triggers) so the decision can be reversed by recreating the triggers.
-- Live check before this change: complete_document_reward_locks holds 0 rows, so nothing already earned is affected.
drop trigger if exists submission_intakes_r100_on_verified on public.submission_intakes;
drop trigger if exists intake_absence_approvals_r100 on public.intake_absence_approvals;
