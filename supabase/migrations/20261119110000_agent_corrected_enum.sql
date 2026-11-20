-- Staff correct capture mistakes (owner, 19 Nov 2026), 1/2: the notice the Director gets when the Office Administrator
-- corrects an agent's type or details. Its own migration because a new enum value cannot be used in the transaction that
-- adds it.
alter type public.notification_event_type add value if not exists 'AGENT_DETAILS_CORRECTED';
