-- Fund Now Capital CRM — core schema
-- Phase 1 is a single-owner internal tool. The referral-partner portal comes
-- later, so partner-facing columns exist now (RLS is added in a later
-- migration) even though partner screens are not built yet.
--
-- Conventions:
--   * All money is numeric(14,2) — never floats (security rule #6).
--   * gen_random_uuid() is a core function in PostgreSQL 13+.
--   * updated_at is maintained by the set_updated_at() trigger below.

-- ---------------------------------------------------------------------------
-- Utility: keep updated_at fresh on every UPDATE
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('owner', 'partner');

-- The 15 deal stages, in order. 'declined' is terminal and reachable from any
-- stage. Values are snake_case; the UI maps them to display labels
-- (e.g. approved_quote_received -> "Approved/Quote Received").
create type public.deal_stage as enum (
  'new_lead',
  'qualifying',
  'document_collection',
  'deal_review',
  'submitted',
  'in_credit',
  'approved_quote_received',
  'client_deciding',
  'verification_kyc',
  'contract_signed',
  'advance_pending',
  'funded',
  'invoiced',
  'commission_paid',
  'declined'
);

-- ---------------------------------------------------------------------------
-- referral_partners — brokerage referral partners (Phase 2 portal users map
-- to these). Bright Destiny is seeded in the reference-data migration.
-- ---------------------------------------------------------------------------
create table public.referral_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_email text,
  contact_phone text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user, holds role + (for partners) their partner
-- link. Created automatically by the handle_new_user() trigger.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role public.user_role not null default 'partner',
  referral_partner_id uuid references public.referral_partners(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An owner is never scoped to a single partner. (Partners may be temporarily
  -- unlinked until an owner assigns them, so only the owner side is enforced.)
  constraint profiles_owner_no_partner_ck
    check (role <> 'owner' or referral_partner_id is null)
);

-- ---------------------------------------------------------------------------
-- clients — the SMEs seeking funding
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  registration_number text,
  industry text,
  -- Which partner referred this client. NULL = the owner's own client.
  referral_partner_id uuid references public.referral_partners(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- client_contacts — people at a client business
-- ---------------------------------------------------------------------------
create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  position text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- funders — capital providers. Real name is owner-only; display_name_for_partner
-- is the fictional first name the future partner portal shows so partners can't
-- bypass Fund Now Capital to reach funders directly (funder anonymisation).
-- ---------------------------------------------------------------------------
create table public.funders (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                       -- real name (owner only)
  display_name_for_partner text not null unique,   -- fictional first name (partner-facing)
  funder_type text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.funders.name is 'Real funder name. Owner-only — never exposed to referral partners.';
comment on column public.funders.display_name_for_partner is 'Fictional first name shown to referral partners in the future portal.';

-- ---------------------------------------------------------------------------
-- funder_contacts — people at a funder (owner-only, sensitive)
-- ---------------------------------------------------------------------------
create table public.funder_contacts (
  id uuid primary key default gen_random_uuid(),
  funder_id uuid not null references public.funders(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  position text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- deals — a funding opportunity for a client
-- ---------------------------------------------------------------------------
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  reference text,
  client_id uuid not null references public.clients(id) on delete restrict,
  -- Denormalised from the client for fast partner RLS + reporting.
  referral_partner_id uuid references public.referral_partners(id) on delete set null,
  stage public.deal_stage not null default 'new_lead',
  -- Purchase Order deals take a flat 40% pool tier regardless of band.
  is_purchase_order boolean not null default false,
  amount_requested numeric(14,2),
  gross_commission numeric(14,2),                  -- X, the gross commission from the funder
  awarded_funder_id uuid references public.funders(id) on delete set null,
  declined_reason text,
  stage_changed_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deals_amount_requested_nonneg_ck
    check (amount_requested is null or amount_requested >= 0),
  constraint deals_gross_commission_nonneg_ck
    check (gross_commission is null or gross_commission >= 0)
);

-- ---------------------------------------------------------------------------
-- deal_funder_submissions — a deal can be submitted to several funders; each
-- funder responds independently. Owner-only (exposes funder identity).
-- ---------------------------------------------------------------------------
create table public.deal_funder_submissions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  funder_id uuid not null references public.funders(id) on delete restrict,
  status text not null default 'submitted',        -- submitted, in_credit, approved, quote_received, declined
  submitted_at timestamptz,
  responded_at timestamptz,
  quote_amount numeric(14,2),
  offered_commission numeric(14,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deal_funder_submissions_unique unique (deal_id, funder_id)
);

-- ---------------------------------------------------------------------------
-- documents — files (bank statements, IDs, contracts) stored in Supabase
-- Storage; this table holds metadata + the storage path.
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  -- Denormalised for partner RLS.
  referral_partner_id uuid references public.referral_partners(id) on delete set null,
  file_name text not null,
  storage_path text not null,
  doc_type text not null default 'other',          -- bank_statement, id_document, financials, contract, invoice, other
  file_size_bytes bigint,
  mime_type text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint documents_link_ck check (client_id is not null or deal_id is not null)
);

-- ---------------------------------------------------------------------------
-- communications — log of interactions (notes, calls, emails, meetings)
-- ---------------------------------------------------------------------------
create table public.communications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  -- Denormalised for partner RLS.
  referral_partner_id uuid references public.referral_partners(id) on delete set null,
  channel text not null default 'note',            -- note, call, email, whatsapp, meeting
  direction text,                                  -- inbound, outbound (null for notes)
  subject text,
  body text,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- commission_records — the commission ledger. One record per deal. The split
-- columns are ALWAYS recomputed server-side (security rule #5) by the trigger
-- added in the commission-engine migration.
-- ---------------------------------------------------------------------------
create table public.commission_records (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  referral_partner_id uuid references public.referral_partners(id) on delete set null,
  gross_commission numeric(14,2) not null,         -- X
  is_purchase_order boolean not null default false,
  tier_pct numeric(5,4) not null default 0,        -- partner share of the pool, e.g. 0.4000
  company_retention numeric(14,2) not null default 0,
  partner_pool numeric(14,2) not null default 0,
  partner_share numeric(14,2) not null default 0,
  owner_share numeric(14,2) not null default 0,
  status text not null default 'pending',          -- pending, invoiced, paid
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_records_deal_unique unique (deal_id),
  constraint commission_records_gross_nonneg_ck check (gross_commission >= 0),
  -- The three outputs must always sum to X (commission-engine invariant).
  constraint commission_records_sums_ck
    check (company_retention + partner_share + owner_share = gross_commission)
);

-- ---------------------------------------------------------------------------
-- Indexes (foreign keys used by RLS / reporting)
-- ---------------------------------------------------------------------------
create index idx_profiles_referral_partner on public.profiles (referral_partner_id);
create index idx_clients_referral_partner on public.clients (referral_partner_id);
create index idx_client_contacts_client on public.client_contacts (client_id);
create index idx_funder_contacts_funder on public.funder_contacts (funder_id);
create index idx_deals_client on public.deals (client_id);
create index idx_deals_referral_partner on public.deals (referral_partner_id);
create index idx_deals_awarded_funder on public.deals (awarded_funder_id);
create index idx_deals_stage on public.deals (stage);
create index idx_dfs_deal on public.deal_funder_submissions (deal_id);
create index idx_dfs_funder on public.deal_funder_submissions (funder_id);
create index idx_documents_client on public.documents (client_id);
create index idx_documents_deal on public.documents (deal_id);
create index idx_documents_referral_partner on public.documents (referral_partner_id);
create index idx_communications_client on public.communications (client_id);
create index idx_communications_deal on public.communications (deal_id);
create index idx_communications_referral_partner on public.communications (referral_partner_id);
create index idx_commission_records_referral_partner on public.commission_records (referral_partner_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.referral_partners
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.client_contacts
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.funders
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.funder_contacts
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.deals
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.deal_funder_submissions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.commission_records
  for each row execute function public.set_updated_at();
