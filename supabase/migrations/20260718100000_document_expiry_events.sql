-- Document expiry alerts — part 1 of 3: notification event types.
--
-- MUST be its own migration: Postgres forbids USING a new enum value in the same
-- transaction that ADDs it. Committing the ADD VALUEs here lets the sweep
-- migration (20260718100100) reference them in function bodies and preference
-- seeds. `if not exists` keeps it idempotent/replay-safe (house pattern —
-- 20260715180000, 20260717120000).

alter type public.notification_event_type add value if not exists 'DOCUMENT_EXPIRING_30D';
alter type public.notification_event_type add value if not exists 'DOCUMENT_EXPIRING_7D';
alter type public.notification_event_type add value if not exists 'DOCUMENT_EXPIRED';
