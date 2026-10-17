-- Team diaries (Administrator spec §18, Batch 1b) (1/2): new notification event. Its own migration because
-- a new enum value cannot be used in the transaction that adds it. Owner decisions 17 Oct 2026.
-- In-app notice to a team member (and to the staff member who booked) when an appointment on the team
-- member's diary is booked, moved or cancelled.
alter type public.notification_event_type add value if not exists 'TEAM_APPOINTMENT_CHANGED';
