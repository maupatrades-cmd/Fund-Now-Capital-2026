-- Launch priority 2 (staff logins) (1/2): the two field roles. Their own migration because a new enum value cannot be
-- used in the transaction that adds it. docs/FNC-LAUNCH-PLAN-2026-11-09.md section 2.
alter type public.user_role add value if not exists 'field_supervisor';
alter type public.user_role add value if not exists 'field_consultant';
