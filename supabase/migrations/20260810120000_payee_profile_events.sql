-- Build 3.1 — payee payment-profile notification events (part 1 of 2: enums).
--
-- Split from the backend migration (part 2) because Postgres forbids referencing
-- a freshly-added enum value in the same transaction that adds it. These three
-- values are consumed by the RPCs and the notification-preference seed in part 2,
-- which run in a later migration (a separate transaction), so this is safe.
--
-- No ADD VALUE is used elsewhere in this migration.

alter type public.notification_event_type add value if not exists 'PAYEE_PROFILE_SUBMITTED';
alter type public.notification_event_type add value if not exists 'PAYEE_PROFILE_VERIFIED';
alter type public.notification_event_type add value if not exists 'PAYEE_PROFILE_REJECTED';
