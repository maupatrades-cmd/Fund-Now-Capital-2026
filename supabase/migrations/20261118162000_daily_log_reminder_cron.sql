-- Staff daily log (owner, 18 Nov 2026), 3/3: run the reminder sweep at 16:30 SAST (14:30 UTC) Monday to Friday.
-- Idempotent: any existing job with this name is removed first.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'daily-log-reminder';
select cron.schedule('daily-log-reminder', '30 14 * * 1-5', $cron$ select public.send_daily_log_reminders(); $cron$);
