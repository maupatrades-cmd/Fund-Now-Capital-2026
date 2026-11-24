-- In-CRM calls and meetings (owner, 24 Nov 2026), 1/2: the two in-app notices (missed call, meeting invite). Their own
-- migration because a new enum value cannot be used in the transaction that adds it.
alter type public.notification_event_type add value if not exists 'MEET_MISSED_CALL';
alter type public.notification_event_type add value if not exists 'MEET_INVITE';
