-- B2.3 (part 3 of 3) — indexes backing duplicate detection.
--
-- (a) GIN trigram indexes on lower(business_name) for leads and clients so
--     find_lead_duplicates()' similarity() name matching stays index-backed as
--     the tables grow.
-- (b) A partial UNIQUE index on btrim(cipc_number) for non-blank leads — the
--     race-proof guarantee behind the CIPC hard block. The leads_cipc_block
--     trigger (20260717121000) only SELECT-then-checks, so two concurrent inserts
--     of the same CIPC could both pass it; this unique index rejects the second
--     at write time. The trigger stays for its friendly message; both normalise
--     with btrim() so they agree. Whitespace variants collapse to one identity.
--
-- All built CONCURRENTLY (lock-free) and therefore in their own statement-only
-- migration OUTSIDE any transaction — CONCURRENTLY cannot run inside the
-- transaction that apply_migration wraps around a migration, so each statement
-- here is applied one-per-call on the live DB (same discipline as the B2.2 index
-- migration 20260716091000). PRECONDITION for (b): no two live leads may already
-- share a btrim(cipc_number) — verified before applying (only 3 leads live).

create index concurrently if not exists leads_business_name_trgm_idx
  on public.leads using gin (lower(business_name) gin_trgm_ops);

create index concurrently if not exists clients_business_name_trgm_idx
  on public.clients using gin (lower(business_name) gin_trgm_ops);

create unique index concurrently if not exists leads_cipc_number_unique_idx
  on public.leads (btrim(cipc_number))
  where cipc_number is not null and btrim(cipc_number) <> '';
