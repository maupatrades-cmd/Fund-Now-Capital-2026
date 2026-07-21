-- C1.1 (part 1 of 2) — new notification_event_type values for FNC→funder invoicing.
-- Reference: SPEC S7 (Invoicing) + owner-approved C1.1 scope (2026-07-21).
--
-- WHY ITS OWN FILE: Postgres forbids USING a new enum value in the same
-- transaction that adds it. Part 2 (20260721100100) references these in the
-- invoice RPCs + overdue sweep, so they must be committed here first.
-- IF NOT EXISTS makes each add idempotent / replay-safe.

alter type public.notification_event_type add value if not exists 'FUNDER_INVOICE_ISSUED';
alter type public.notification_event_type add value if not exists 'INVOICE_OVERDUE';
alter type public.notification_event_type add value if not exists 'INVOICE_MARKED_PAID';
