-- Administrator (Second-in-Charge), Batch 1 (1/2): new enum values. Their own migration because a new
-- enum value cannot be used in the transaction that adds it. Owner specification 17 Oct 2026
-- (docs/FNC-ADMINISTRATOR-SPEC-2026-10-17.md).
alter type public.user_role add value if not exists 'administrator';
-- In-app notice to the Founder (and the Administrator CC) for every diary booking created, moved or cancelled.
alter type public.notification_event_type add value if not exists 'DIARY_BOOKING_CHANGED';
