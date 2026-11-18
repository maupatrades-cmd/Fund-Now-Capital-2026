-- Field diary (owner, 17 Nov 2026) (1/2): the in-app notice sent when someone books, moves or cancels a meeting on a
-- field person's diary. Its own migration because a new enum value cannot be used in the transaction that adds it.
alter type public.notification_event_type add value if not exists 'FIELD_MEETING_UPDATED';
