-- Agent Code onboarding (1/2): new in-app notice types. Their own migration because a new enum value cannot be used in
-- the transaction that adds it. Owner decision 30 Oct 2026 (docs/FNC-LAUNCH-PLAN-2026-11-09.md section 3).
alter type public.notification_event_type add value if not exists 'AGENT_ONBOARDING_READY';
alter type public.notification_event_type add value if not exists 'AGENT_CODE_ISSUED';
