-- B4.1 (part 3 of 4) — lead_id unique index (CONCURRENTLY) + validate the FK.
--
-- Completes the FK-on-populated-table discipline (CLAUDE.md): the lead_id FK was
-- added NOT VALID in part 2; here its backing UNIQUE index is built CONCURRENTLY
-- (lock-free) and then the constraint is VALIDATEd. This migration is
-- STATEMENT-ONLY and runs OUTSIDE any transaction — CONCURRENTLY cannot run
-- inside the transaction apply_migration wraps around a migration, so each
-- statement is applied one-per-call on the live DB (same discipline as the B5.2
-- clients CIPC index 20260720110200).
--
-- Why a FULL unique index (not partial): Postgres treats NULLs as distinct, so a
-- plain UNIQUE(lead_id) still permits unlimited client-owned rows (lead_id NULL)
-- while enforcing one-story-per-lead — and, unlike a partial index, it backs
-- ON CONFLICT (lead_id) upsert from the Story form. The XOR CHECK (part 2) is
-- what stops a row from setting both sides.
--
-- Interrupted-build guard: an aborted CREATE INDEX CONCURRENTLY leaves an INVALID
-- index that IF NOT EXISTS would then skip on retry — leaving one-story-per-lead
-- silently unenforced. The DROP first is a no-op on a clean first apply and
-- clears any invalid leftover on a retry, then the CREATE rebuilds. The operator
-- VERIFIES pg_index.indisvalid = true post-apply.
drop index concurrently if exists public.client_stories_lead_id_key;

create unique index concurrently if not exists client_stories_lead_id_key
  on public.client_stories (lead_id);

-- FK rows are all valid (the table is empty / all existing rows are client-owned
-- with lead_id NULL), so validation is a fast metadata flip that takes no
-- write-blocking lock.
alter table public.client_stories validate constraint client_stories_lead_id_fkey;
