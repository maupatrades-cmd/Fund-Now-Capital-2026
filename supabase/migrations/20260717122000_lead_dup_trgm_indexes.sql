-- B2.3 (part 3 of 3) — trigram indexes backing the duplicate-name lookup.
--
-- GIN trigram indexes on lower(business_name) for leads and clients so
-- find_lead_duplicates()' similarity() name matching stays index-backed as the
-- tables grow. Built CONCURRENTLY (lock-free) and therefore in their own
-- statement-only migration OUTSIDE any transaction — CONCURRENTLY cannot run
-- inside the transaction that apply_migration wraps around a migration, so each
-- statement here is applied one-per-call on the live DB (same discipline as the
-- B2.2 index migration 20260716091000). Both tables are small today, so the
-- lookup already works via seq scan without these; the indexes are forward cover.

create index concurrently if not exists leads_business_name_trgm_idx
  on public.leads using gin (lower(business_name) gin_trgm_ops);

create index concurrently if not exists clients_business_name_trgm_idx
  on public.clients using gin (lower(business_name) gin_trgm_ops);
