-- B2.3 (part 1 of 3) — new lead notification event types.
--
-- Adds the four lead-lifecycle event types the B2.3 notification triggers emit.
-- MUST be its own migration: Postgres forbids USING a new enum value in the same
-- transaction that ADDs it, and the B2.3 events migration (20260717121000) both
-- references these labels in trigger bodies and seeds preference rows for them.
-- Splitting the ADD VALUEs here (committed first) lets that migration use them.
--
-- LEAD_CREATED_FOR_YOU already exists (declared in the A11 enum, activated here
-- in B2.3); LEAD_QUALIFICATION_UPDATED also pre-exists and is left in place
-- (superseded by the finer-grained LEAD_QUALIFIED / LEAD_NOT_QUALIFIED, but
-- harmless to keep — dropping an enum value is not supported anyway).

alter type public.notification_event_type add value if not exists 'LEAD_QUALIFIED';
alter type public.notification_event_type add value if not exists 'LEAD_NOT_QUALIFIED';
alter type public.notification_event_type add value if not exists 'LEAD_STARTED_QUALIFICATION';
alter type public.notification_event_type add value if not exists 'LEAD_UPDATED';
