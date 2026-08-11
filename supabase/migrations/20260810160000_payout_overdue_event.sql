-- Build 12 (part 1 of 2) — the PAYOUT_OVERDUE notification event value.
-- Split into its own migration per the repo rule (enum ADD VALUE must be
-- committed before it can be referenced by later DDL/DML in another migration).
alter type public.notification_event_type add value if not exists 'PAYOUT_OVERDUE';
