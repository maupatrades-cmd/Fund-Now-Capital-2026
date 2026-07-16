-- Zero-downtime follow-up to 20260715210000_leads.
--
-- Builds the leads FK support indexes CONCURRENTLY, then VALIDATEs the NOT VALID
-- FK constraints. Statement-only (no DO blocks, no BEGIN/COMMIT) so the runner
-- executes it non-transactionally — CREATE INDEX CONCURRENTLY cannot run inside
-- a transaction. Do not fold these statements back into the schema migration.
-- (leads starts empty, so these are instant + lock-free; the pattern is applied
-- for consistency with the standing FK-migration policy — see CLAUDE.md.)

create index concurrently if not exists leads_industry_id_idx          on public.leads (industry_id);
create index concurrently if not exists leads_sub_industry_id_idx      on public.leads (sub_industry_id);
create index concurrently if not exists leads_referral_partner_id_idx  on public.leads (referral_partner_id);
create index concurrently if not exists leads_original_referrer_id_idx on public.leads (original_referrer_id);
create index concurrently if not exists leads_entered_by_idx           on public.leads (entered_by);
create index concurrently if not exists leads_qualified_by_idx         on public.leads (qualified_by);
create index concurrently if not exists leads_qualification_stage_idx  on public.leads (qualification_stage);
create index concurrently if not exists leads_created_at_idx           on public.leads (created_at desc);

alter table public.leads validate constraint leads_industry_id_fkey;
alter table public.leads validate constraint leads_sub_industry_id_fkey;
alter table public.leads validate constraint leads_referral_partner_id_fkey;
alter table public.leads validate constraint leads_original_referrer_id_fkey;
alter table public.leads validate constraint leads_entered_by_fkey;
alter table public.leads validate constraint leads_qualified_by_fkey;
