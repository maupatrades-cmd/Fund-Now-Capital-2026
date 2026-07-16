-- Zero-downtime follow-up to 20260716090000_lead_qualification.
--
-- deals is a POPULATED table, so the lead_id index is built CONCURRENTLY and the
-- FK is VALIDATEd here (statement-only, non-transactional — CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction). The index is UNIQUE + partial
-- (WHERE lead_id is not null) so it doubles as the one-deal-per-lead guarantee
-- backing qualify_lead()'s idempotency; existing deals (lead_id null) are exempt.

create unique index concurrently if not exists deals_lead_id_unique_idx
  on public.deals (lead_id)
  where lead_id is not null;

alter table public.deals validate constraint deals_lead_id_fkey;
