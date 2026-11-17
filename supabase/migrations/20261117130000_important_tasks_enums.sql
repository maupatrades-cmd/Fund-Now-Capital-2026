-- Important tasks from the Director (owner, 17 Nov 2026), 1/2: new notice types. Their own migration because a new
-- enum value cannot be used in the transaction that adds it.
alter type public.notification_event_type add value if not exists 'STAFF_TASK_IMPORTANT';
alter type public.notification_event_type add value if not exists 'STAFF_TASK_QUESTION';
