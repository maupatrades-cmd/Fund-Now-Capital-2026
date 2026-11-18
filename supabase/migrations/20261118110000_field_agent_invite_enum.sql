-- Field Supervisor adds field agents (owner, 17 Nov 2026), 1/2: the notice the Director and the Administrators get when
-- a field agent is added. Its own migration because a new enum value cannot be used in the transaction that adds it.
alter type public.notification_event_type add value if not exists 'FIELD_AGENT_ADDED';
