-- Administrator Batch 3 (Communication) (1/2): new in-app notice types. Their own migration because a new enum
-- value cannot be used in the transaction that adds it. Owner specification 17 Oct 2026, sections 8 and 9.
alter type public.notification_event_type add value if not exists 'STAFF_NOTICE_POSTED';
alter type public.notification_event_type add value if not exists 'INTERNAL_MESSAGE_RECEIVED';
