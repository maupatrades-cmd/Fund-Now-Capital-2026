-- Reference data seed (idempotent).
--
-- This runs as a migration (not seed.sql) so the data also lands in production
-- on deploy, not just local dev resets.

-- Referral partner (Phase 1 has exactly one).
insert into public.referral_partners (name)
values ('Bright Destiny')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Funders (21) — PENDING DATA.
--
-- Each funder needs a real name (owner-only) AND a fictional first name
-- (display_name_for_partner). These are real business facts and must not be
-- invented, so they are seeded in a follow-up migration once the list is
-- provided. The insert shape will be:
--
--   insert into public.funders (name, display_name_for_partner) values
--     ('<Real Funder Name>', '<Fictional First Name>'),
--     ...
--   on conflict (name) do nothing;
-- ---------------------------------------------------------------------------
