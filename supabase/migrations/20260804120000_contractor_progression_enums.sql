-- Contractor Progression (Sprint 3, Lane 3a) — enum prerequisites.
--
-- Adds the activity-log event type used by the owner-approved promotion RPC.
-- Kept in its own migration because Postgres will not let a newly-added enum
-- value be USED in the same transaction that adds it — the main migration
-- (…_contractor_progression.sql) references 'CONTRACTOR_PROMOTED' in
-- owner_promote_contractor(), so the value must be committed first.
--
-- Idempotent: safe to re-run.
alter type public.activity_event_type add value if not exists 'CONTRACTOR_PROMOTED';
