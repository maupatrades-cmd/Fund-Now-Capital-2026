-- B3.2 Document verification — part 1 of 3: notification event type.
--
-- MUST be its own migration: Postgres forbids USING a new enum value in the same
-- transaction that ADDs it. Committing the ADD VALUE here lets the sweep/trigger
-- migration (20260719120100) reference it in function bodies and preference
-- seeds. `if not exists` keeps it idempotent/replay-safe (house pattern).

alter type public.notification_event_type add value if not exists 'LEAD_DOCUMENT_REJECTED';
