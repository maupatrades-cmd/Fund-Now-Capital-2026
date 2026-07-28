-- C2.4 (1/2) — add the BONUS_PAID enum value to both event enums.
-- ============================================================================
-- Split from the main C2.4 migration because Postgres will not let a new enum
-- value be USED in the same transaction it is ADDED. This file only ADDS the
-- value; the main file (20260727210100_c2_4_bonus_records.sql) uses it. Apply
-- this one first. Idempotent via IF NOT EXISTS.
-- ============================================================================

alter type public.activity_event_type     add value if not exists 'BONUS_PAID';
alter type public.notification_event_type add value if not exists 'BONUS_PAID';
