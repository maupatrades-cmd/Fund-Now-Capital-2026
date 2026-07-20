-- B5.2 (part 3 of 3) — race-proof CIPC uniqueness on clients.
--
-- A partial UNIQUE index on btrim(cipc_number) for non-blank clients — the
-- guarantee behind the clients_cipc_block trigger (part 2), which only
-- SELECT-then-checks (two concurrent inserts of the same CIPC could both pass
-- it; this index rejects the second at write time). Both normalise with btrim()
-- so they agree; whitespace variants collapse to one identity. Nulls/blanks are
-- excluded, so many clients may legitimately have no CIPC.
--
-- Built CONCURRENTLY (lock-free) and therefore in its own statement-only
-- migration OUTSIDE any transaction — CONCURRENTLY cannot run inside the
-- transaction apply_migration wraps around a migration, so each statement is
-- applied one-per-call on the live DB (same discipline as the B2.3 leads index
-- 20260717122000). PRECONDITION: no two live clients share a btrim(cipc_number)
-- — verified 0 collisions before applying.
--
-- Interrupted-build guard: an aborted CREATE INDEX CONCURRENTLY leaves an
-- INVALID index behind, which `IF NOT EXISTS` would then skip on retry — leaving
-- CIPC uniqueness silently unenforced (only the SELECT-based clients_cipc_block
-- trigger would remain, which is race-prone). The DROP first is a no-op on a
-- clean first apply and clears any invalid leftover on a retry, then the CREATE
-- rebuilds. The operator VERIFIES pg_index.indisvalid = true post-apply.
drop index concurrently if exists public.clients_cipc_number_unique_idx;

create unique index concurrently if not exists clients_cipc_number_unique_idx
  on public.clients (btrim(cipc_number))
  where cipc_number is not null and btrim(cipc_number) <> '';
