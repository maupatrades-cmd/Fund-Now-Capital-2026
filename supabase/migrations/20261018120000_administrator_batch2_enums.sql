-- Administrator (Second-in-Charge), Batch 2 (1/2): new in-app notice types. Their own migration because a new
-- enum value cannot be used in the transaction that adds it. Owner specification 17 Oct 2026
-- (docs/FNC-ADMINISTRATOR-SPEC-2026-10-17.md, sections 3, 6 and 10).
alter type public.notification_event_type add value if not exists 'STAFF_TASK_ASSIGNED';
alter type public.notification_event_type add value if not exists 'STAFF_TASK_DECLINED';
alter type public.notification_event_type add value if not exists 'OUTBOUND_LEAD_ROUTED';
alter type public.notification_event_type add value if not exists 'DOCUMENTS_APPROVED_IN_ABSENCE';
