-- Public Application Entry Point (Sprint 2, Lane 2a) — part 1 of 3: enum value.
-- ============================================================================
-- Adds the notification_event_type value the owner receives when a cold
-- applicant submits the public /apply form (ONBOARDING.md Stage 1).
--
-- WHY ITS OWN MIGRATION: a new enum value cannot be USED in the same
-- transaction that adds it. Emitting a CONTRACTOR_APPLICATION_RECEIVED
-- notification (part 3's submit RPC / behavioural assertions) requires the
-- value to be already committed, so it must land in a separate, earlier
-- migration — the same discipline the picker/lead-submit lanes used.
--
-- No dedicated activity_event_type value is added: the application create is
-- logged as CREATE and the status transitions (applicant→screening,
-- applicant→rejected) as STAGE_CHANGE, both of which already exist. This keeps
-- enum churn to the single value the notification framework genuinely needs.
-- ============================================================================

alter type public.notification_event_type add value if not exists 'CONTRACTOR_APPLICATION_RECEIVED';
