-- Stable slug for referral_partners so code can reference a partner by an
-- identifier that survives renames (B2.1: the lead form auto-links the
-- Bright Destiny partner when referred_by = 'bright_destiny', previously matched
-- on the display name — brittle).
--
-- `slug` is a plain nullable text column (no FK), so the CLAUDE.md NOT VALID /
-- CONCURRENTLY FK pattern does not apply. No index is added — matches are on a
-- single seeded row; a unique index can be added later if partner management
-- grows and needs it.

alter table public.referral_partners add column if not exists slug text;

update public.referral_partners
  set slug = 'bright_destiny'
  where name = 'Bright Destiny' and slug is null;
