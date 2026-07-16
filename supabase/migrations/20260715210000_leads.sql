-- B2.1 Lead Entry — foundation (SPEC S2 / Roadmap B2). Schema only.
--
-- Builds the `leads` table, its enums, and RLS. Qualification workflow (B2.2),
-- activity logging + notifications (B2.3), and the partner submission portal
-- (Phase D) are deliberately NOT built here — `not_qualified_reason` values are
-- registered but no qualification logic is wired.
--
-- Zero-downtime FK pattern (CLAUDE.md): FK columns are constrained NOT VALID and
-- their indexes are built CONCURRENTLY + VALIDATEd in the follow-up migration
-- 20260715211000. `leads` is a brand-new empty table, so the write-locks that
-- pattern avoids don't exist yet — it's applied here for consistency with the
-- standing policy (every FK-add migration follows the same shape).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_entity_type') then
    create type public.lead_entity_type as enum
      ('pty_ltd','cc','sole_prop','trust','partnership','ngo','other');
  end if;
  if not exists (select 1 from pg_type where typname = 'lead_employee_range') then
    create type public.lead_employee_range as enum
      ('1-5','6-20','21-50','51-200','200+');
  end if;
  if not exists (select 1 from pg_type where typname = 'lead_turnover_range') then
    create type public.lead_turnover_range as enum
      ('<50k','50-100k','100-250k','250-500k','500k-1m','1-2.5m','2.5-5m','5m+');
  end if;
  if not exists (select 1 from pg_type where typname = 'lead_funding_timeline') then
    create type public.lead_funding_timeline as enum
      ('urgent_7d','30d','90d','flexible');
  end if;
  if not exists (select 1 from pg_type where typname = 'lead_referred_by') then
    create type public.lead_referred_by as enum
      ('self','bright_destiny','other');
  end if;
  if not exists (select 1 from pg_type where typname = 'lead_qualification_stage') then
    create type public.lead_qualification_stage as enum
      ('new_lead','under_qualification','qualified','not_qualified');
  end if;
  if not exists (select 1 from pg_type where typname = 'lead_not_qualified_reason') then
    create type public.lead_not_qualified_reason as enum (
      'no_cipc','trading_history_too_short','turnover_too_low','sector_not_serviced',
      'over_leveraged','bank_statement_issues','client_unresponsive','unrealistic_expectations',
      'already_declined_by_likely_funders','no_security_for_asset_needs','timing_not_right',
      'sector_risk_too_high','documentation_impossible','compliance_concern','other'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- leads table (FK columns plain here; constraints added NOT VALID below)
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id                      uuid primary key default gen_random_uuid(),
  business_name           text not null,
  entity_type             public.lead_entity_type,
  cipc_number             text,
  industry_id             uuid,
  sub_industry_id         uuid,
  sector_notes            text,
  website                 text,
  trading_history_months  integer,
  employee_range          public.lead_employee_range,
  monthly_turnover_range  public.lead_turnover_range,
  annual_turnover         numeric(14,2),
  contact_name            text not null,
  contact_role            text,
  contact_cell            text,
  contact_email           text,
  contact_id_number       text,
  physical_address        text,
  registered_address      text,
  region                  text,
  funding_amount          numeric(14,2),
  funding_purpose         jsonb not null default '[]'::jsonb,
  funding_timeline        public.lead_funding_timeline,
  has_existing_debt       boolean not null default false,
  existing_debt_details   jsonb,
  security_available       jsonb not null default '[]'::jsonb,
  referred_by             public.lead_referred_by not null default 'self',
  -- Free-text name captured when referred_by = 'other' (the S2 "other + name"
  -- case). Not in the original column list, but the form requires somewhere to
  -- persist the typed name — flagged for owner review.
  referred_by_other       text,
  referral_partner_id     uuid,
  -- Audit field: defaults to the caller and is pinned to auth.uid() by the
  -- restrictive INSERT policy below, so a client can't spoof it.
  entered_by              uuid default auth.uid(),
  loaded_on_behalf        boolean not null default false,
  original_referrer_id    uuid,
  initial_notes           text,
  qualification_stage     public.lead_qualification_stage not null default 'new_lead',
  not_qualified_reason    public.lead_not_qualified_reason,
  not_qualified_notes     text,
  follow_up_date          date,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  qualified_at            timestamptz,
  qualified_by            uuid
);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- FK constraints added NOT VALID (validated in the follow-up migration).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_industry_id_fkey') then
    alter table public.leads add constraint leads_industry_id_fkey
      foreign key (industry_id) references public.industries(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_sub_industry_id_fkey') then
    alter table public.leads add constraint leads_sub_industry_id_fkey
      foreign key (sub_industry_id) references public.sub_industries(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_referral_partner_id_fkey') then
    alter table public.leads add constraint leads_referral_partner_id_fkey
      foreign key (referral_partner_id) references public.referral_partners(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_original_referrer_id_fkey') then
    alter table public.leads add constraint leads_original_referrer_id_fkey
      foreign key (original_referrer_id) references public.referral_partners(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_entered_by_fkey') then
    alter table public.leads add constraint leads_entered_by_fkey
      foreign key (entered_by) references auth.users(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_qualified_by_fkey') then
    alter table public.leads add constraint leads_qualified_by_fkey
      foreign key (qualified_by) references auth.users(id) on delete set null not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS. Owner has full access to the base table. Partners get NO direct access
-- to `leads` — it holds POPIA-relevant PII (national ID, cell, email, physical
-- addresses) that a referring partner must not see. Partners instead read a
-- PII-safe projection of their own referred leads via public.partner_leads_view
-- (below). Partner writes are Phase D (portal).
-- ---------------------------------------------------------------------------
alter table public.leads enable row level security;

create policy "leads_owner_all" on public.leads
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Pin entered_by to the caller on INSERT. RESTRICTIVE so it AND-composes with
-- leads_owner_all: the owner can only insert rows whose entered_by is their own
-- auth.uid() (the column default fills it; a spoofed value is rejected).
create policy "leads_entered_by_is_caller" on public.leads
  as restrictive for insert to authenticated
  with check (entered_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Partner-safe lead projection (POPIA): a referring partner sees only non-PII
-- business/funding fields for their OWN referred leads — never contact_name /
-- contact_role / contact_id_number / contact_email / contact_cell / addresses /
-- entered_by / initial_notes / turnover detail. Runs with the view owner's
-- privileges (security_invoker off) to read the owner-only base table;
-- security_barrier blocks predicate push-down leaks; the WHERE enforces scope.
-- ---------------------------------------------------------------------------
create view public.partner_leads_view
with (security_barrier = true) as
  select
    l.id,
    l.business_name,
    l.industry_id,
    l.sub_industry_id,
    l.sector_notes,
    l.funding_amount,
    l.funding_purpose,
    l.funding_timeline,
    l.qualification_stage,
    l.referred_by,
    l.referral_partner_id,
    l.original_referrer_id,
    l.created_at,
    l.updated_at
  from public.leads l
  where public.is_owner()
     or l.referral_partner_id = public.current_partner_id()
     or l.original_referrer_id = public.current_partner_id();

comment on view public.partner_leads_view is
  'Partner-safe projection of leads: non-PII business/funding fields for the partner''s own referred leads only. Excludes all contact PII (name, ID number, email, cell), addresses, entered_by, initial_notes, and turnover detail beyond funding_amount. Owner reads the base table directly.';

grant select on public.partner_leads_view to authenticated;
