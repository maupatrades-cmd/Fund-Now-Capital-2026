-- B4 Client Story + Call Logs — part 2 of 2: FOLLOW_UP_DUE cron activation.
--
-- pg_cron is already enabled (B3 expiry sweep). Runs the follow-up sweep DAILY at
-- 04:15 UTC (06:15 SAST) — offset from the 04:00 document-expiry sweep so the two
-- don't overlap. The sweep is SECURITY DEFINER, so it runs with its owner's
-- privileges regardless of the cron job's role. Idempotent: cron.schedule upserts
-- by job name.

create extension if not exists pg_cron;

select cron.schedule(
  'call-followup-sweep',
  '15 4 * * *',
  $$select public.check_followups_due();$$
);
