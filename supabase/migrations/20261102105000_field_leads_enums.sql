-- Field leads (launch priority 3) (1/2): new in-app notice types. Their own migration because a new enum value cannot
-- be used in the transaction that adds it. docs/FNC-LAUNCH-PLAN-2026-11-09.md sections 6 and 8.
alter type public.notification_event_type add value if not exists 'FIELD_LEAD_UPDATED';
alter type public.notification_event_type add value if not exists 'LEAD_FEE_STATUS_CHANGED';
