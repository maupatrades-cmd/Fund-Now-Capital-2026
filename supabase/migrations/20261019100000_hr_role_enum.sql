-- Administrator Batch 5a (HR role and commission flow) (1/2): new enum values. Their own migration because a new
-- enum value cannot be used in the transaction that adds it. Owner decision 19 Oct 2026: HR is its own login.
alter type public.user_role add value if not exists 'hr';
alter type public.notification_event_type add value if not exists 'COMMISSION_NOTICE_ROUTED';
