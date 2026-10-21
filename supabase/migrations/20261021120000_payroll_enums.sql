-- Administrator Batch 5c (payslips and the payroll cycle) (1/2): new in-app notice types. Their own migration because
-- a new enum value cannot be used in the transaction that adds it. docs/FNC-LAUNCH-PLAN-2026-11-09.md sections 3 and 5.
alter type public.notification_event_type add value if not exists 'PAYROLL_CYCLE_CHANGED';
alter type public.notification_event_type add value if not exists 'PAYSLIP_STATUS_CHANGED';
