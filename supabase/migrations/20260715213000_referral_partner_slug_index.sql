-- Zero-downtime follow-up to 20260715212000_referral_partner_slug.
--
-- Enforces slug uniqueness so a future partner can't reuse 'bright_destiny' and
-- make the stable lookup ambiguous. referral_partners is a POPULATED table, so
-- the index is built CONCURRENTLY (statement-only, non-transactional) per the
-- CLAUDE.md policy — no write-blocking lock. Partial (WHERE slug is not null) so
-- multiple partners may keep a null slug while non-null slugs stay unique.

create unique index concurrently if not exists referral_partners_slug_unique_idx
  on public.referral_partners (slug)
  where slug is not null;
