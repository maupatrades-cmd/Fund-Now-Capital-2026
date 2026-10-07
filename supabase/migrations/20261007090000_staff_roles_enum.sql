-- Staff build, Batch 1 (1/5): the two staff roles.
--
-- Adds `switchboard` (Switchboard Assistant) and `coordinator` (Sales
-- Coordinator) to public.user_role. Holding the role grants NOTHING on its own:
-- every existing RLS policy is keyed on owner / partner / contractor / client /
-- lead_referrer, so a staff profile is denied by default. Access is opened only
-- by the SECURITY DEFINER projections in the later migrations, and only while
-- the owner has enabled the person in staff_access (migration 2/5).
--
-- Kept in its own migration: a new enum value cannot be used in the same
-- transaction that adds it.
alter type public.user_role add value if not exists 'switchboard';
alter type public.user_role add value if not exists 'coordinator';
