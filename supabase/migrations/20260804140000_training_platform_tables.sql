-- TRAINING lane — Sprint 5 Lane 5a — Product Knowledge Training platform SKELETON.
-- ============================================================================
-- Part 1 of 2: tables + RLS + seed. (Part 2 = the four SECURITY DEFINER RPCs.)
--
-- Scope (infrastructure only — content lands later, owner-authored):
--   * training_modules            — the 6 canonical modules (TRAINING.md), owner-
--                                   owned content, placeholder markdown for now.
--   * contractor_training_progress — one row per (contractor, module) capturing
--                                   started_at / completed_at.
--
-- Explicitly NOT here (other lanes / later sub-lanes): assessment engine,
-- question bank, certification (CERTIFICATION lane), badges/points/levels
-- (GAMIFICATION lane), owner content-admin UI. Training does NOT gate activation
-- or lead submission (owner ruling; TRAINING.md "Progression Gates").
--
-- Identity note (verified against live schema 2026-08-04, NOT guessed): an FNC
-- contractor who logs in is a `profiles` row with role='contractor' (the same
-- identity the LEAD-SUBMIT lane attributes leads to via auth.uid(), and the same
-- one commission_records.contractor_id already FKs to). There is NO separate
-- "contractor account" table — the `contractors` table is the APPLICATION record
-- (onboarding), not the login identity. So contractor_training_progress.
-- contractor_id references profiles(id) = auth.uid(). POPIA: a contractor sees
-- only their own progress (RLS below + auth.uid()-scoped RPCs in part 2).
--
-- `order` is a reserved word, so the column is `module_order`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- training_modules — owner-authored training content (the platform's spine).
-- ---------------------------------------------------------------------------
create table if not exists public.training_modules (
  id               uuid primary key default gen_random_uuid(),
  module_order     int  not null,
  title            text not null,
  description      text not null default '',
  content_markdown text not null default '',
  is_published     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint training_modules_order_positive check (module_order >= 1),
  constraint training_modules_order_unique   unique (module_order),
  constraint training_modules_title_not_blank check (btrim(title) <> '')
);

comment on table public.training_modules is
  'Contractor Product Knowledge training modules (TRAINING.md). Owner-authored content; module_order drives display order. Skeleton ships placeholder content_markdown.';

-- ---------------------------------------------------------------------------
-- contractor_training_progress — per-(contractor, module) progress.
-- One row per pair; started_at set on first open, completed_at on "Mark
-- complete". Both timestamps are write-once via the RPCs (first value wins).
-- ---------------------------------------------------------------------------
create table if not exists public.contractor_training_progress (
  id            uuid primary key default gen_random_uuid(),
  -- The logged-in contractor identity (profiles.id = auth.uid()). ON DELETE
  -- CASCADE: if a contractor profile is ever removed, their progress goes too.
  contractor_id uuid not null references public.profiles(id) on delete cascade,
  module_id     uuid not null references public.training_modules(id) on delete cascade,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint contractor_training_progress_unique_pair unique (contractor_id, module_id)
);

comment on table public.contractor_training_progress is
  'Per-(contractor, module) training progress. contractor_id = profiles.id (auth.uid()). Written only via the DEFINER RPCs mark_module_started / mark_module_completed; contractor reads own via RLS.';

-- Lookup indexes. (Both tables are created empty here, so a plain CREATE INDEX
-- takes no meaningful lock — the CLAUDE.md CONCURRENTLY rule targets FK columns
-- ADDED to already-populated tables, which is not the case for these new tables.)
create index if not exists contractor_training_progress_contractor_idx
  on public.contractor_training_progress (contractor_id);
create index if not exists contractor_training_progress_module_idx
  on public.contractor_training_progress (module_id);

-- updated_at maintenance via the shared trigger helper.
drop trigger if exists trg_training_modules_updated_at on public.training_modules;
create trigger trg_training_modules_updated_at
  before update on public.training_modules
  for each row execute function public.set_updated_at();

drop trigger if exists trg_contractor_training_progress_updated_at on public.contractor_training_progress;
create trigger trg_contractor_training_progress_updated_at
  before update on public.contractor_training_progress
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS. Real POPIA posture: owner full; contractor reads published modules +
-- own progress ONLY. Partners never touch these tables (no policy grants them
-- anything). All progress WRITES go through the DEFINER RPCs (part 2), which run
-- as the table owner and bypass RLS — so there are deliberately NO
-- insert/update/delete policies here (a direct client write silently returns
-- zero rows, exactly as intended).
-- ---------------------------------------------------------------------------
alter table public.training_modules             enable row level security;
alter table public.contractor_training_progress enable row level security;

-- training_modules: owner does everything.
drop policy if exists training_modules_owner_all on public.training_modules;
create policy training_modules_owner_all
  on public.training_modules
  for all
  using (public.is_owner())
  with check (public.is_owner());

-- training_modules: an active contractor may READ published modules.
drop policy if exists training_modules_contractor_read_published on public.training_modules;
create policy training_modules_contractor_read_published
  on public.training_modules
  for select
  to authenticated
  using (
    is_published
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'contractor'
        and p.is_active
    )
  );

-- contractor_training_progress: owner may READ all (owner dashboard, later).
drop policy if exists ctp_owner_read on public.contractor_training_progress;
create policy ctp_owner_read
  on public.contractor_training_progress
  for select
  using (public.is_owner());

-- contractor_training_progress: a contractor may READ their OWN rows only.
drop policy if exists ctp_contractor_read_own on public.contractor_training_progress;
create policy ctp_contractor_read_own
  on public.contractor_training_progress
  for select
  to authenticated
  using (contractor_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Seed the 6 canonical modules (TRAINING.md order). Placeholder content — the
-- owner authors the real material later. Published = true so the skeleton is
-- navigable end-to-end for the acceptance test. Idempotent on module_order.
-- ---------------------------------------------------------------------------
insert into public.training_modules (module_order, title, description, content_markdown, is_published) values
  (1, 'Fund Now Capital Overview',
      'FNC company history, mission and values; our role as a broker (not a lender); how FNC earns; ethics and code of conduct.',
      E'# Fund Now Capital Overview\n\n_Content coming soon — see TRAINING.md (Module 1)._\n\nThis module will cover FNC''s history, mission and values, our role as a broker (not a lender), how FNC earns, and our ethics and code of conduct.',
      true),
  (2, 'Funder Products',
      'The business funding products offered through FNC — MCA, invoice discounting, invoice factoring, PO finance, working capital, asset-backed finance — with real mechanics, documents and typical facility sizes.',
      E'# Funder Products\n\n_Content coming soon — see TRAINING.md (Module 2)._\n\nThis module will cover each funding product FNC offers and how it works. Fictional funder names are used throughout training — a contractor never sees a real funder name.',
      true),
  (3, 'Client Qualification',
      'How to identify a qualified lead — business type, trading history, revenue thresholds, industry and legal-entity requirements — and the warning signs of an unqualified lead.',
      E'# Client Qualification\n\n_Content coming soon — see TRAINING.md (Module 3)._\n\nThis module will cover how to pre-qualify a lead before submitting it to the CRM, and the warning signs to watch for.',
      true),
  (4, 'POPIA & FICA Compliance',
      'POPIA and FICA fundamentals, consent requirements, KYC checks and the fraud warning signs a contractor must escalate. Completion includes POPIA + FICA acknowledgements.',
      E'# POPIA & FICA Compliance\n\n_Content coming soon — see TRAINING.md (Module 4)._\n\nThis module will cover your responsibilities handling client personal data, consent, KYC, and fraud warning signs to escalate.',
      true),
  (5, 'Sales Skills',
      'Real conversation frameworks for approaching business owners, building trust and handling objections — skill-building, not scripts.',
      E'# Sales Skills\n\n_Content coming soon — see TRAINING.md (Module 5)._\n\nThis module will cover conversation frameworks, trust-building and objection handling.',
      true),
  (6, 'FNC CRM System Training',
      'Using the contractor portal — logging in, submitting a lead, uploading documents, tracking status, viewing earnings, training and reimbursement history.',
      E'# FNC CRM System Training\n\n_Content coming soon — see TRAINING.md (Module 6)._\n\nThis module will cover how to use the contractor portal day to day.',
      true)
on conflict (module_order) do nothing;

-- ---------------------------------------------------------------------------
-- Structural assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  -- tables exist
  if to_regclass('public.training_modules') is null then
    raise exception 'assert: training_modules not created'; end if;
  if to_regclass('public.contractor_training_progress') is null then
    raise exception 'assert: contractor_training_progress not created'; end if;

  -- RLS enabled on both
  if not (select relrowsecurity from pg_class where oid = 'public.training_modules'::regclass) then
    raise exception 'assert: RLS not enabled on training_modules'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.contractor_training_progress'::regclass) then
    raise exception 'assert: RLS not enabled on contractor_training_progress'; end if;

  -- unique (contractor_id, module_id)
  if not exists (
    select 1 from pg_constraint
    where conname = 'contractor_training_progress_unique_pair'
      and conrelid = 'public.contractor_training_progress'::regclass) then
    raise exception 'assert: unique(contractor_id, module_id) missing'; end if;

  -- contractor_id FK → profiles
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contractor_training_progress'::regclass
      and contype = 'f' and confrelid = 'public.profiles'::regclass) then
    raise exception 'assert: contractor_id FK to profiles missing'; end if;

  -- exactly 6 published seed modules, orders 1..6
  if (select count(*) from public.training_modules) <> 6 then
    raise exception 'assert: expected 6 seed modules, got %',
      (select count(*) from public.training_modules); end if;
  if (select count(*) from public.training_modules where is_published) <> 6 then
    raise exception 'assert: all 6 seed modules must be published'; end if;
  if exists (
    select 1 from generate_series(1,6) g
    where not exists (select 1 from public.training_modules m where m.module_order = g)) then
    raise exception 'assert: module_order 1..6 not fully seeded'; end if;

  raise notice 'TRAINING part 1 assertions passed (tables, RLS, unique, FK, 6 published modules).';
end $$;

notify pgrst, 'reload schema';
