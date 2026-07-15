-- Register the WEEKLY_SUMMARY notification event type.
--
-- The email template already has a `weekly_summary` variant (SPEC S16 / A12) with
-- locked Section 7 copy, but there was no matching value in the
-- `notification_event_type` enum, so a weekly-summary notification could never be
-- created (or emailed). The digest itself — the pg_cron sender + trigger that
-- actually populates and fires it — is built in Phase C6; this migration only
-- registers the event type so the variant can be exercised now.
--
-- No preference backfill is needed: the send-notification-email Edge Function
-- treats a missing `notification_preferences` row as "email on" (owner default),
-- and the column default is already `email_enabled = true`. C6 can backfill an
-- explicit row when it wires the trigger.
--
-- `ADD VALUE` is not used elsewhere in this migration (a new enum value cannot be
-- referenced in the same transaction that adds it), so this is safe to apply.

alter type public.notification_event_type add value if not exists 'WEEKLY_SUMMARY';
