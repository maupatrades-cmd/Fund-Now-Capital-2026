-- Administrator Batch 4 (Reports) (1/2): new in-app notice types. Their own migration because a new enum value
-- cannot be used in the transaction that adds it. Owner specification 17 Oct 2026, sections 11 and 17.
alter type public.notification_event_type add value if not exists 'STAFF_ESCALATION_RAISED';
alter type public.notification_event_type add value if not exists 'STAFF_COMPLAINT_LOGGED';
