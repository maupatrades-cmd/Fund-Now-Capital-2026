-- Commission Picker BACKEND (Sprint 1, Lane 1a) — part 3 of 3: FK discipline.
--
-- Completes the CLAUDE.md FK-on-populated-table rule for deals.commission_locked_by
-- (added NOT VALID in part 2, 20260803120100): build its backing index CONCURRENTLY
-- (lock-free) and then VALIDATE the constraint. This migration is STATEMENT-ONLY and
-- MUST run OUTSIDE any transaction — CREATE INDEX CONCURRENTLY cannot run inside the
-- transaction the migration runner wraps around a file, so each statement is applied
-- one-per-call on the live DB (same discipline as 20260720120200 client_stories and
-- 20260720110200 clients CIPC).
--
-- Interrupted-build guard: an aborted CREATE INDEX CONCURRENTLY leaves an INVALID
-- index that IF NOT EXISTS would then skip on retry. The DROP first is a no-op on a
-- clean first apply and clears any invalid leftover on a retry; then the CREATE
-- rebuilds. The operator VERIFIES pg_index.indisvalid = true post-apply.
drop index concurrently if exists public.idx_deals_commission_locked_by;

create index concurrently if not exists idx_deals_commission_locked_by
  on public.deals (commission_locked_by);

-- All existing deals have commission_locked_by NULL (the column is new), so the FK
-- rows are all valid — validation is a fast metadata flip with no write-blocking lock.
alter table public.deals validate constraint deals_commission_locked_by_fkey;
