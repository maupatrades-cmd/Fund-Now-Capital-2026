-- Zero-downtime follow-up to 20260715200000_industry_classification.
--
-- Builds the FK support indexes on `clients` CONCURRENTLY, then VALIDATEs the
-- NOT VALID FK constraints added in the previous migration. Both operations take
-- only a SHARE UPDATE EXCLUSIVE lock, so reads and writes to `clients` continue
-- throughout — no write-blocking locks.
--
-- IMPORTANT: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block,
-- so this migration MUST be applied outside a transaction. It is kept in its own
-- file, statement-only (no DO blocks, no BEGIN/COMMIT), so the migration runner
-- executes it non-transactionally. Do not fold these statements back into the
-- schema migration.
--
-- This is the standing pattern for every future FK-add migration on a populated
-- table (Phases B–F) — see CLAUDE.md working style + Supabase zero-downtime docs.

create index concurrently if not exists clients_industry_id_idx
  on public.clients (industry_id);

create index concurrently if not exists clients_sub_industry_id_idx
  on public.clients (sub_industry_id);

alter table public.clients validate constraint clients_industry_id_fkey;
alter table public.clients validate constraint clients_sub_industry_id_fkey;
