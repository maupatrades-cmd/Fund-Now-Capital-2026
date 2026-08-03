-- C4 (Doctor Invoicing FNC — Sprint 4, Lane 4a) — part 1 of 3: notification enum values.
-- ============================================================================
-- Adds the four notification_event_type values the partner-invoice lifecycle
-- emits (SPEC S8 / S11 "Invoicing" + the C4 brief):
--   PARTNER_INVOICE_SUBMITTED  -> owner   (Doctor submits a draft for approval)
--   PARTNER_INVOICE_APPROVED   -> partner (owner approves the submitted invoice)
--   PARTNER_INVOICE_REJECTED   -> partner (owner rejects, with a reason)
--   PARTNER_INVOICE_PAID       -> partner (owner marks paid, with an EFT reference)
--
-- WHY ITS OWN MIGRATION: a new enum value cannot be USED in the same transaction
-- that adds it. The lifecycle RPCs (part 3) emit these via emit_in_app_notification
-- and the part-3 behavioural assertions exercise the full flow, so the values must
-- be committed by an earlier migration first — the same discipline every recent
-- lane used (contractor-application / picker-backend / lead-submit enums).
--
-- No dedicated activity_event_type value is added: the partner-invoice audit trail
-- reuses the existing INVOICE (generate/submit/approve/reject) and PAYMENT (mark-paid)
-- events, plus STAGE_CHANGE where a state transition is logged — all already present.
-- This keeps enum churn to exactly the notification values the framework needs.
-- ============================================================================

alter type public.notification_event_type add value if not exists 'PARTNER_INVOICE_SUBMITTED';
alter type public.notification_event_type add value if not exists 'PARTNER_INVOICE_APPROVED';
alter type public.notification_event_type add value if not exists 'PARTNER_INVOICE_REJECTED';
alter type public.notification_event_type add value if not exists 'PARTNER_INVOICE_PAID';
