-- Staff daily log (owner, 18 Nov 2026), 1/3: the in-app reminder sent at 16:30 SAST to staff who have not written
-- today's log. Its own migration because a new enum value cannot be used in the transaction that adds it.
alter type public.notification_event_type add value if not exists 'DAILY_LOG_REMINDER';
