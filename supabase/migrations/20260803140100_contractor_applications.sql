-- Public Application Entry Point (Sprint 2, Lane 2a) — part 2 of 3: schema.
-- ============================================================================
-- Real business truth (ONBOARDING.md Stage 1 + CONTRACTOR.md Feature 1 +
-- standing rule): a cold applicant fills the PUBLIC /apply form and that
-- creates a `contractors` record with status 'applicant'. This is the ONE
-- explicit exception to "only the owner can create contractors" — every other
-- create/modify/delete is owner-only.
--
-- This migration creates:
--   1. contractor_status enum — the FULL onboarding lifecycle (applicant →
--      screening → interview_scheduled → agreement_pending → document_collection
--      → active → suspended → deactivated, plus rejected as terminal). Stage 1
--      (this lane) only ever uses applicant / screening / rejected; the full set
--      is created now so later HR-module phases (G2+) add columns, never enum
--      values.
--   2. `contractors` — the canonical table (CONTRACTOR.md). This lane populates
--      only the Stage-1 application subset of columns (name/contact/experience/
--      motivation/referral + status + review fields); the tax/banking/BEE/
--      service-agreement/progression columns are additive follow-ups in later
--      phases. Column names follow this lane's brief (full_name/email/phone/
--      status); the future full-HR lane reconciles any aliasing additively.
--   3. `contractor_application_attempts` — a minimal spam-throttle ledger for the
--      public endpoint (hashed IP only; POPIA — never the raw IP). Written only
--      by the DEFINER submit RPC (part 3).
--
-- Security: RLS owner-only on contractors (partners/contractors NEVER see
-- applications — RLS default-deny + no partner/contractor policy). Applicants
-- have no auth at all; the row is created by the service-role submit RPC which
-- bypasses RLS. Direct writes are revoked from authenticated — every mutation
-- goes through the DEFINER RPCs in part 3, so the status machine is enforced at
-- the table boundary (the picker-lane precedent).
--
-- POPIA: application data (name, ID number, address, contact) is sensitive.
-- It is protected by (a) Supabase's at-rest disk encryption, (b) owner-only
-- RLS, and (c) the hashed-IP-only throttle ledger — consistent with how the
-- rest of the CRM stores PII (e.g. client_stakeholders ID numbers): plain
-- columns guarded by owner-only RLS, not column-level crypto (which would break
-- the owner's review surface and diverge from the house pattern).
--
-- EMPTY-TABLE RATIONALE (mirrors the picker/C2.2 precedent): both tables are
-- created empty, so inline PK/FK/indexes are metadata-only with no
-- write-blocking lock — the NOT VALID / CREATE INDEX CONCURRENTLY discipline
-- exists for POPULATED tables and buys nothing here.
-- ============================================================================

-- ===========================================================================
-- 1. contractor_status enum — full onboarding lifecycle.
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'contractor_status' and typnamespace = 'public'::regnamespace) then
    create type public.contractor_status as enum (
      'applicant',
      'screening',
      'interview_scheduled',
      'agreement_pending',
      'document_collection',
      'active',
      'suspended',
      'deactivated',
      'rejected'
    );
  end if;
end $$;

-- ===========================================================================
-- 2. contractors — canonical table; Stage-1 application subset populated now.
-- ===========================================================================
create table if not exists public.contractors (
  id                   uuid primary key default gen_random_uuid(),
  -- Applicant-supplied (public /apply form).
  full_name            text not null,
  email                text not null,
  phone                text not null,
  id_number            text,                       -- optional at Stage 1 (SA ID / passport); PII
  physical_address     text not null,
  experience_years     integer not null,
  motivation_text      text not null,
  referral_source      text,                       -- dropdown token (linkedin/word_of_mouth/website/other)
  referral_source_other text,                      -- free text when referral_source = 'other'
  -- Lifecycle + owner review.
  status               public.contractor_status not null default 'applicant',
  rejected_reason      text,
  screening_notes      text,
  -- Operational metadata.
  source_ip_hash       text,                       -- hashed client IP of the submission (POPIA: never raw)
  submitted_at         timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Sanity bounds on the numeric field (0..80 years of experience).
  constraint contractors_experience_years_ck check (experience_years >= 0 and experience_years <= 80),
  -- A rejected application must always carry a reason (the reject RPC requires
  -- one) — belt-and-braces so no code path can persist a reason-less rejection.
  constraint contractors_rejected_reason_ck check (status <> 'rejected' or rejected_reason is not null)
);

comment on table public.contractors is
  'FNC direct contractors (CONTRACTOR.md). Row is created at status ''applicant'' by the public /apply form (ONBOARDING.md Stage 1) — the ONE non-owner create path — then transitioned owner-only. This lane populates the Stage-1 application subset of columns; tax/banking/BEE/service-agreement/progression columns are additive in later HR phases. Owner-only RLS; partners/contractors never see applications.';
comment on column public.contractors.status is
  'Onboarding lifecycle (contractor_status). Stage-1 lane uses applicant/screening/rejected only; advanced ONLY via the DEFINER RPCs.';
comment on column public.contractors.source_ip_hash is
  'SHA-256 hash of the submitting client IP (POPIA: raw IP never stored). Used for public-endpoint spam throttling / audit only.';

create index if not exists idx_contractors_status on public.contractors (status);
create index if not exists idx_contractors_email_lower on public.contractors (lower(email));
create index if not exists idx_contractors_submitted_at on public.contractors (submitted_at desc);

-- keep updated_at fresh (house set_updated_at() trigger fn).
drop trigger if exists contractors_set_updated_at on public.contractors;
create trigger contractors_set_updated_at
  before update on public.contractors
  for each row execute function public.set_updated_at();

-- RLS: owner-only. No partner/contractor policy — those roles can never read
-- applications (cross-role isolation acceptance test #10).
alter table public.contractors enable row level security;
drop policy if exists contractors_owner_all on public.contractors;
create policy contractors_owner_all on public.contractors
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Grants matrix: authenticated may SELECT (owner reads, scoped by the owner-only
-- policy; a partner/contractor SELECT returns zero rows) and hold NO other
-- privilege — every write goes through a DEFINER RPC (part 3). `revoke all`
-- first strips the Supabase default grant in full (incl. TRUNCATE, which would
-- bypass RLS), then only SELECT is granted back. anon gets nothing (the public
-- apply path never touches this table directly — it goes through the
-- service-role submit RPC).
revoke all on table public.contractors from anon, public, authenticated;
grant select on table public.contractors to authenticated;

-- ===========================================================================
-- 3. contractor_application_attempts — spam-throttle ledger for /apply.
--    Written only by the DEFINER submit RPC (service-role). Not readable by any
--    API role (RLS on, no policy; grants revoked). Hashed IP only.
-- ===========================================================================
create table if not exists public.contractor_application_attempts (
  id          uuid primary key default gen_random_uuid(),
  ip_hash     text not null,
  created_at  timestamptz not null default now()
);

comment on table public.contractor_application_attempts is
  'Append-only spam-throttle ledger for the public /apply endpoint (Lane 2a). One row per submission attempt, hashed IP only (POPIA). Written + pruned only by the DEFINER submit RPC; no API-role access.';

create index if not exists idx_contractor_app_attempts_ip_time
  on public.contractor_application_attempts (ip_hash, created_at desc);

alter table public.contractor_application_attempts enable row level security;
-- No policy at all → default-deny for authenticated/anon. The DEFINER RPC
-- (owned by postgres) bypasses RLS.
revoke all on table public.contractor_application_attempts from anon, public, authenticated;

-- ===========================================================================
-- 4. Structural assertions — RAISE (roll the migration back) on any drift.
-- ===========================================================================
do $$
declare v_cnt int;
begin
  -- (a) contractor_status enum: 9 values, applicant is the default target.
  if not exists (select 1 from pg_type where typname='contractor_status' and typnamespace='public'::regnamespace) then
    raise exception 'assert: contractor_status enum missing'; end if;
  select count(*) into v_cnt from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='contractor_status';
  if v_cnt <> 9 then raise exception 'assert: contractor_status must have 9 values, found %', v_cnt; end if;

  -- (b) contractors table shape.
  if to_regclass('public.contractors') is null then raise exception 'assert: contractors table missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contractors'
      and column_name='status' and udt_name='contractor_status') then
    raise exception 'assert: contractors.status is not contractor_status'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contractors'
      and column_name='full_name' and is_nullable='NO') then
    raise exception 'assert: contractors.full_name missing/nullable'; end if;
  if not exists (select 1 from pg_constraint where conrelid='public.contractors'::regclass and conname='contractors_rejected_reason_ck') then
    raise exception 'assert: contractors_rejected_reason_ck CHECK missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid='public.contractors'::regclass and conname='contractors_experience_years_ck') then
    raise exception 'assert: contractors_experience_years_ck CHECK missing'; end if;

  -- (c) RLS on, owner-only, exactly 1 policy.
  if not (select relrowsecurity from pg_class where oid='public.contractors'::regclass) then
    raise exception 'assert: RLS not enabled on contractors'; end if;
  select count(*) into v_cnt from pg_policies where schemaname='public' and tablename='contractors';
  if v_cnt <> 1 then raise exception 'assert: contractors must have exactly 1 policy (owner-only), found %', v_cnt; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='contractors' and policyname='contractors_owner_all') then
    raise exception 'assert: contractors_owner_all policy missing'; end if;

  -- (d) contractors grants: authenticated holds EXACTLY SELECT; anon nothing.
  select count(*) into v_cnt from information_schema.role_table_grants
    where table_schema='public' and table_name='contractors' and grantee='authenticated';
  if v_cnt <> 1 then raise exception 'assert: authenticated must hold exactly 1 privilege (SELECT) on contractors, found %', v_cnt; end if;
  if not exists (select 1 from information_schema.role_table_grants
      where table_schema='public' and table_name='contractors' and grantee='authenticated' and privilege_type='SELECT') then
    raise exception 'assert: authenticated must hold SELECT on contractors'; end if;
  if exists (select 1 from information_schema.role_table_grants
      where table_schema='public' and table_name='contractors' and grantee='anon') then
    raise exception 'assert: anon still holds a grant on contractors'; end if;

  -- (e) attempts table: RLS on, zero policies, no authenticated/anon grants.
  if to_regclass('public.contractor_application_attempts') is null then raise exception 'assert: attempts table missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.contractor_application_attempts'::regclass) then
    raise exception 'assert: RLS not enabled on contractor_application_attempts'; end if;
  select count(*) into v_cnt from pg_policies where schemaname='public' and tablename='contractor_application_attempts';
  if v_cnt <> 0 then raise exception 'assert: attempts table must have 0 policies, found %', v_cnt; end if;
  if exists (select 1 from information_schema.role_table_grants
      where table_schema='public' and table_name='contractor_application_attempts' and grantee in ('anon','authenticated')) then
    raise exception 'assert: attempts table must not be granted to anon/authenticated'; end if;

  raise notice 'Contractor applications schema assertions passed (enum, contractors table+RLS+grants, attempts ledger).';
end $$;

notify pgrst, 'reload schema';
