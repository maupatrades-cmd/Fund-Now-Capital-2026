-- Build 8.1 — contractor invoice lifecycle: notification events (part 1 of 2).
--
-- Mirrors the C4 partner-invoice enum split: a new enum value cannot be USED in
-- the transaction that adds it, and the part-2 RPCs + preference seed reference
-- these, so they must be committed by this earlier migration first.
--
--   CONTRACTOR_INVOICE_SUBMITTED -> owner      (contractor submits a draft)
--   CONTRACTOR_INVOICE_APPROVED  -> contractor (owner approves)
--   CONTRACTOR_INVOICE_REJECTED  -> contractor (owner rejects, with a reason)
--   CONTRACTOR_INVOICE_PAID      -> contractor (owner marks paid — wired in Build 10)
--
-- PAID is added now for parity so Build 10 (owner EFT + settle) needs no further
-- enum migration. The activity trail reuses the existing INVOICE / PAYMENT events.

alter type public.notification_event_type add value if not exists 'CONTRACTOR_INVOICE_SUBMITTED';
alter type public.notification_event_type add value if not exists 'CONTRACTOR_INVOICE_APPROVED';
alter type public.notification_event_type add value if not exists 'CONTRACTOR_INVOICE_REJECTED';
alter type public.notification_event_type add value if not exists 'CONTRACTOR_INVOICE_PAID';
