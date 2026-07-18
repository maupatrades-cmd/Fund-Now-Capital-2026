-- Document expiry alerts — part 3 of 3: activation.
--
-- Isolated from the asserted logic (20260718100100) so the novel pg_cron enable
-- (first use of pg_cron in this repo; v1.6.4 confirmed available on the project)
-- can be applied and, if needed, retried on its own without disturbing the
-- committed functions.
--
-- Runs the sweep DAILY at 04:00 UTC = 06:00 Africa/Johannesburg (owner-timezone
-- morning) so the day starts with any expiry alerts already delivered. pg_cron
-- schedules in UTC. The sweep is SECURITY DEFINER, so it runs with its owner's
-- privileges regardless of the cron job's role.

create extension if not exists pg_cron;

-- Idempotent: cron.schedule upserts by job name (pg_cron >= 1.4).
select cron.schedule(
  'document-expiry-sweep',
  '0 4 * * *',
  $$select public.check_document_expiries();$$
);
