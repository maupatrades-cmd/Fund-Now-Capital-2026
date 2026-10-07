-- Staff build, Batch 3 (2/2): schedule the Team Leader / organisation check-in
-- reminder generator. Kept in its own file (same pattern as the other sweeps) so
-- the integrator can apply the calendar schema first and schedule separately.
--
-- Weekdays 04:30 UTC (06:30 SAST). The function is idempotent per period, so a
-- repeat run creates nothing. It only creates in-app reminders for the
-- Coordinator; it sends no message to anyone. Idempotent: cron.schedule upserts
-- by job name.

create extension if not exists pg_cron;

select cron.schedule(
  'staff-checkin-reminders',
  '30 4 * * 1-5',
  $$select public.generate_staff_checkin_reminders(null);$$
);
