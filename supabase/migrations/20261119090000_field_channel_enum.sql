-- Lead agents (owner, 19 Nov 2026), 1/4: a fifth intake channel, 'field' (the Fund Now Capital field team: a field
-- consultant or the Field Supervisor the sale is for). Its own migration because a new enum value cannot be used in the
-- transaction that adds it.
alter type public.submission_channel add value if not exists 'field';
