-- Zero-downtime follow-up to 20260717130000_document_management_b3_1.
--
-- Builds the new document indexes CONCURRENTLY, then VALIDATEs the NOT VALID FK
-- constraints. Statement-only (no DO blocks, no BEGIN/COMMIT) so the runner
-- executes it non-transactionally — CREATE INDEX CONCURRENTLY cannot run inside
-- a transaction. Do not fold these statements back into the schema migration.
-- (documents is empty, so these are instant + lock-free; the pattern is applied
-- for consistency with the standing FK-migration policy — see CLAUDE.md.)

-- --- FK support + filter indexes ---
create index concurrently if not exists documents_uploaded_by_idx      on public.documents (uploaded_by);
create index concurrently if not exists documents_lead_id_idx          on public.documents (lead_id);
create index concurrently if not exists documents_superseded_by_idx    on public.documents (superseded_by);
create index concurrently if not exists documents_owning_entity_id_idx on public.documents (owning_entity_id);
create index concurrently if not exists documents_category_idx         on public.documents (category);
create index concurrently if not exists documents_document_type_idx    on public.documents (document_type);
create index concurrently if not exists documents_status_idx           on public.documents (status);

-- Expiry sweep (used by the DOCUMENT_EXPIRING_* cron in the follow-up PR) +
-- expiry-status pills. Partial: only rows that actually expire.
create index concurrently if not exists documents_expiry_date_idx
  on public.documents (expiry_date) where expiry_date is not null;

-- --- Supersede race guard (the hard, DB-layer guarantee) ---
-- Non-period types: at most one current version per (entity, type).
create unique index concurrently if not exists documents_current_nonperiod_uq
  on public.documents (owning_entity_id, document_type)
  where is_current_version and not is_period_scoped;

-- Period-scoped types: at most one current version per (entity, type, period),
-- but many concurrent periods (the 12-month bank-statement pack).
create unique index concurrently if not exists documents_current_period_uq
  on public.documents (owning_entity_id, document_type, period_start, period_end)
  where is_current_version and is_period_scoped;

-- --- Validate the NOT VALID FK constraints from file 1 ---
alter table public.documents validate constraint documents_uploaded_by_fkey;
alter table public.documents validate constraint documents_lead_id_fkey;
alter table public.documents validate constraint documents_superseded_by_fkey;
