-- The Office Administrator adds agents (owner, 18 Nov 2026), 1/2: the notice the Director gets when the Administrator adds
-- an agent. Its own migration because a new enum value cannot be used in the transaction that adds it.
alter type public.notification_event_type add value if not exists 'AGENT_ADDED';
