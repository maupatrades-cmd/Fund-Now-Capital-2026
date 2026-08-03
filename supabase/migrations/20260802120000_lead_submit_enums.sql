-- LEAD-SUBMIT lane — partner + contractor lead submission (enum groundwork).
--
-- Two new enum values, added in their OWN migration so they are committed
-- before any later migration (RLS / RPCs) references them. Postgres forbids
-- using a freshly-added enum value in the same transaction that adds it, and
-- each migration here is applied as its own transaction — so this file adds the
-- values and does nothing else with them.
--
-- 1. document_upload_source 'contractor' — provenance for documents a
--    contractor attaches to a lead they submitted. The taxonomy already has
--    'owner' | 'partner' | 'client' | 'funder'; contractors are a distinct role
--    (CONTRACTOR.md), so their uploads deserve their own honest source value
--    rather than being mislabelled 'partner'.
-- 2. notification_event_type 'LEAD_SUBMITTED_BY_CONTRACTOR' — owner-facing
--    notification when a contractor submits a lead. The partner equivalent
--    ('LEAD_SUBMITTED_BY_PARTNER') already exists; this mirrors it for the
--    contractor channel so the owner's notification list categorises the two
--    submission sources distinctly.
--
-- Both are idempotent (IF NOT EXISTS) so a re-run is a no-op.

alter type public.document_upload_source add value if not exists 'contractor';

alter type public.notification_event_type
  add value if not exists 'LEAD_SUBMITTED_BY_CONTRACTOR';
