-- B1 Industry Classification (SPEC S1 / Roadmap B1).
--
-- ZERO-DOWNTIME FK PATTERN: the FK columns on `clients` are added NOT VALID and
-- their indexes are built CONCURRENTLY (in the follow-up migration
-- 20260715201000) to avoid write-blocking locks on the clients table. This
-- pattern applies to every future FK-add migration on tables with existing data
-- — see Supabase docs on zero-downtime migrations.
--
-- Adds the taxonomy every later feature assumes: industries + sub_industries
-- reference tables, an owner-editable funder appetite matrix, and nullable
-- industry FKs on clients. RLS from day one (CLAUDE.md rule #3).
--
-- Access model:
--   * industries / sub_industries: owner full read/write; all app users read
--     (reference data). No sensitive columns.
--   * funder_industry_preferences: OWNER-ONLY at the table level — it carries
--     funder_id (funder identity) and owner-only `notes`. Partners reach an
--     anonymised projection via public.partner_funder_industry_appetite, which
--     exposes display_name_for_partner + industry + appetite_level ONLY (never
--     funder_id, never the real name, never notes). Honours the non-negotiable
--     funder-anonymisation rule while giving partners read access to appetite.
--
-- Seeds: 25 industries + sub-industries (exact S1 wording/order) and the
-- baseline appetite matrix. Appetite rows only seed for funders actually on the
-- panel; missing funders are skipped and reported via RAISE NOTICE.
--
-- clients.sector (legacy free text) is intentionally LEFT IN PLACE for manual
-- reconciliation; a new sector_notes column captures anything the taxonomy
-- doesn't cover. Auto-migration of sector -> taxonomy is deferred to B2.

-- ---------------------------------------------------------------------------
-- Enum: funder appetite level
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'appetite_level') then
    create type public.appetite_level as enum ('high','medium','low','avoid');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- industries
-- ---------------------------------------------------------------------------
create table if not exists public.industries (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger industries_set_updated_at
  before update on public.industries
  for each row execute function public.set_updated_at();

alter table public.industries enable row level security;

create policy "industries_owner_all" on public.industries
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy "industries_read_all" on public.industries
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- sub_industries
-- ---------------------------------------------------------------------------
create table if not exists public.sub_industries (
  id           uuid primary key default gen_random_uuid(),
  industry_id  uuid not null references public.industries(id) on delete cascade,
  name         text not null,
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (industry_id, name)
);

create index if not exists sub_industries_industry_id_idx on public.sub_industries(industry_id);

create trigger sub_industries_set_updated_at
  before update on public.sub_industries
  for each row execute function public.set_updated_at();

alter table public.sub_industries enable row level security;

create policy "sub_industries_owner_all" on public.sub_industries
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy "sub_industries_read_all" on public.sub_industries
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- funder_industry_preferences (OWNER-ONLY: carries funder identity + notes)
-- ---------------------------------------------------------------------------
create table if not exists public.funder_industry_preferences (
  id             uuid primary key default gen_random_uuid(),
  funder_id      uuid not null references public.funders(id) on delete cascade,
  industry_id    uuid not null references public.industries(id) on delete cascade,
  appetite_level public.appetite_level not null,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (funder_id, industry_id)
);

create index if not exists fip_funder_id_idx   on public.funder_industry_preferences(funder_id);
create index if not exists fip_industry_id_idx on public.funder_industry_preferences(industry_id);

create trigger fip_set_updated_at
  before update on public.funder_industry_preferences
  for each row execute function public.set_updated_at();

alter table public.funder_industry_preferences enable row level security;

create policy "fip_owner_all" on public.funder_industry_preferences
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- Partner-safe appetite view (anonymised): fictional funder name + industry +
-- appetite only. Never funder_id, real name, or notes. Runs with the view
-- owner's privileges (security_invoker off) to read the owner-only base table;
-- security_barrier blocks predicate push-down leaks; the WHERE limits it to
-- real app users (owner or a partner profile).
-- ---------------------------------------------------------------------------
create view public.partner_funder_industry_appetite
with (security_barrier = true) as
  select
    p.industry_id,
    i.name                     as industry_name,
    f.display_name_for_partner as funder_display_name,
    p.appetite_level
  from public.funder_industry_preferences p
  join public.funders    f on f.id = p.funder_id
  join public.industries i on i.id = p.industry_id
  where public.is_owner() or public.current_partner_id() is not null;

comment on view public.partner_funder_industry_appetite is
  'Partner-safe projection of funder_industry_preferences: fictional funder name (display_name_for_partner) + industry + appetite_level ONLY. Excludes funder_id, real funder name, and owner-only notes. Enforces the funder-anonymisation rule for the future partner portal.';

grant select on public.partner_funder_industry_appetite to authenticated;

-- ---------------------------------------------------------------------------
-- clients: add taxonomy FKs + sector_notes. Legacy `sector` kept as-is.
--
-- Zero-downtime: columns are added nullable (metadata-only, no table rewrite)
-- and the FK constraints are added NOT VALID so the ADD does not scan or lock
-- existing rows. The supporting indexes are built CONCURRENTLY and the
-- constraints VALIDATEd in the follow-up migration 20260715201000 (CREATE INDEX
-- CONCURRENTLY cannot run inside this transaction).
-- ---------------------------------------------------------------------------
alter table public.clients add column if not exists industry_id     uuid;
alter table public.clients add column if not exists sub_industry_id uuid;
alter table public.clients add column if not exists sector_notes    text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_industry_id_fkey') then
    alter table public.clients
      add constraint clients_industry_id_fkey
      foreign key (industry_id) references public.industries(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clients_sub_industry_id_fkey') then
    alter table public.clients
      add constraint clients_sub_industry_id_fkey
      foreign key (sub_industry_id) references public.sub_industries(id) on delete set null not valid;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- Seed: 25 industries (exact S1 wording + order)
-- ---------------------------------------------------------------------------
insert into public.industries (name, sort_order) values
  ('Agriculture, Forestry & Farming', 1),
  ('Mining & Quarrying', 2),
  ('Manufacturing', 3),
  ('Construction & Built Environment', 4),
  ('Retail & Wholesale', 5),
  ('Food & Beverage / Hospitality', 6),
  ('Transport & Logistics', 7),
  ('Professional Services', 8),
  ('Technology & IT', 9),
  ('Marketing & Media', 10),
  ('Health & Medical', 11),
  ('Education & Training', 12),
  ('Personal Services', 13),
  ('Auto & Motoring', 14),
  ('Real Estate', 15),
  ('Security & Safety', 16),
  ('Waste & Environmental', 17),
  ('Energy & Utilities', 18),
  ('Sport, Recreation & Entertainment', 19),
  ('Non-Profit & Community', 20),
  ('Fashion & Design', 21),
  ('Financial Services', 22),
  ('Agriculture Value Chain', 23),
  ('Import/Export & Trading', 24),
  ('Other / Emerging', 25)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Seed: sub-industries (exact S1 wording + order, per parent)
-- ---------------------------------------------------------------------------
insert into public.sub_industries (industry_id, name, sort_order)
select i.id, s.sub_name, s.sort_order
from (values
  ('Agriculture, Forestry & Farming', 'Crop farming', 1),
  ('Agriculture, Forestry & Farming', 'Livestock', 2),
  ('Agriculture, Forestry & Farming', 'Poultry', 3),
  ('Agriculture, Forestry & Farming', 'Dairy', 4),
  ('Agriculture, Forestry & Farming', 'Game farming', 5),
  ('Agriculture, Forestry & Farming', 'Aquaculture', 6),
  ('Agriculture, Forestry & Farming', 'Forestry', 7),
  ('Agriculture, Forestry & Farming', 'Horticulture/floriculture', 8),
  ('Agriculture, Forestry & Farming', 'Agri-processing', 9),
  ('Agriculture, Forestry & Farming', 'Farm equipment', 10),
  ('Mining & Quarrying', 'Gold', 1),
  ('Mining & Quarrying', 'Platinum', 2),
  ('Mining & Quarrying', 'Chrome', 3),
  ('Mining & Quarrying', 'Coal', 4),
  ('Mining & Quarrying', 'Diamond', 5),
  ('Mining & Quarrying', 'Manganese', 6),
  ('Mining & Quarrying', 'Iron ore', 7),
  ('Mining & Quarrying', 'Copper', 8),
  ('Mining & Quarrying', 'Quarrying', 9),
  ('Mining & Quarrying', 'Mining services/contract mining', 10),
  ('Mining & Quarrying', 'Mining supply', 11),
  ('Mining & Quarrying', 'Mining logistics', 12),
  ('Mining & Quarrying', 'Tailings/waste', 13),
  ('Manufacturing', 'Food & beverage', 1),
  ('Manufacturing', 'Textile & clothing', 2),
  ('Manufacturing', 'Furniture', 3),
  ('Manufacturing', 'Metal fabrication', 4),
  ('Manufacturing', 'Plastic', 5),
  ('Manufacturing', 'Chemical', 6),
  ('Manufacturing', 'Pharmaceutical', 7),
  ('Manufacturing', 'Automotive parts', 8),
  ('Manufacturing', 'Building materials', 9),
  ('Manufacturing', 'Packaging', 10),
  ('Manufacturing', 'Electrical/electronic', 11),
  ('Construction & Built Environment', 'General building', 1),
  ('Construction & Built Environment', 'Civil/infrastructure', 2),
  ('Construction & Built Environment', 'Roads', 3),
  ('Construction & Built Environment', 'Plumbing & electrical', 4),
  ('Construction & Built Environment', 'HVAC', 5),
  ('Construction & Built Environment', 'Painting & finishing', 6),
  ('Construction & Built Environment', 'Roofing', 7),
  ('Construction & Built Environment', 'Landscaping', 8),
  ('Construction & Built Environment', 'Property development', 9),
  ('Construction & Built Environment', 'Interior', 10),
  ('Construction & Built Environment', 'Architectural', 11),
  ('Construction & Built Environment', 'Quantity surveying', 12),
  ('Construction & Built Environment', 'Construction supplies', 13),
  ('Retail & Wholesale', 'General FMCG', 1),
  ('Retail & Wholesale', 'Clothing & footwear', 2),
  ('Retail & Wholesale', 'Electronics', 3),
  ('Retail & Wholesale', 'Furniture & appliance', 4),
  ('Retail & Wholesale', 'Automotive retail', 5),
  ('Retail & Wholesale', 'Building supplies', 6),
  ('Retail & Wholesale', 'Pharmacy', 7),
  ('Retail & Wholesale', 'Convenience/spaza', 8),
  ('Retail & Wholesale', 'Wholesale distribution', 9),
  ('Retail & Wholesale', 'E-commerce', 10),
  ('Retail & Wholesale', 'Franchise', 11),
  ('Retail & Wholesale', 'Specialty', 12),
  ('Food & Beverage / Hospitality', 'Restaurants', 1),
  ('Food & Beverage / Hospitality', 'QSR/takeaway', 2),
  ('Food & Beverage / Hospitality', 'Bakeries', 3),
  ('Food & Beverage / Hospitality', 'Butcheries', 4),
  ('Food & Beverage / Hospitality', 'Catering', 5),
  ('Food & Beverage / Hospitality', 'Coffee shops', 6),
  ('Food & Beverage / Hospitality', 'Bars & taverns', 7),
  ('Food & Beverage / Hospitality', 'Hotels', 8),
  ('Food & Beverage / Hospitality', 'Guest houses/B&Bs', 9),
  ('Food & Beverage / Hospitality', 'Lodges', 10),
  ('Food & Beverage / Hospitality', 'Event venues', 11),
  ('Food & Beverage / Hospitality', 'Food trucks', 12),
  ('Transport & Logistics', 'Road freight/trucking', 1),
  ('Transport & Logistics', 'Courier', 2),
  ('Transport & Logistics', 'Passenger transport', 3),
  ('Transport & Logistics', 'Taxi/e-hailing', 4),
  ('Transport & Logistics', 'Bus', 5),
  ('Transport & Logistics', 'Vehicle rental/fleet leasing', 6),
  ('Transport & Logistics', 'Warehousing', 7),
  ('Transport & Logistics', 'Cold storage', 8),
  ('Transport & Logistics', 'Container logistics', 9),
  ('Transport & Logistics', 'Import/export', 10),
  ('Transport & Logistics', '3PL', 11),
  ('Professional Services', 'Legal', 1),
  ('Professional Services', 'Accounting/tax', 2),
  ('Professional Services', 'Financial advisory', 3),
  ('Professional Services', 'Management consulting', 4),
  ('Professional Services', 'HR consulting', 5),
  ('Professional Services', 'Recruitment', 6),
  ('Professional Services', 'Auditing', 7),
  ('Professional Services', 'Business coaching', 8),
  ('Professional Services', 'Compliance', 9),
  ('Professional Services', 'Insurance broking', 10),
  ('Professional Services', 'Real estate services', 11),
  ('Technology & IT', 'Software dev', 1),
  ('Technology & IT', 'IT services', 2),
  ('Technology & IT', 'Cybersecurity', 3),
  ('Technology & IT', 'Web dev', 4),
  ('Technology & IT', 'Digital agencies', 5),
  ('Technology & IT', 'Cloud', 6),
  ('Technology & IT', 'Telecoms', 7),
  ('Technology & IT', 'Fintech', 8),
  ('Technology & IT', 'E-learning', 9),
  ('Technology & IT', 'SaaS', 10),
  ('Marketing & Media', 'Advertising', 1),
  ('Marketing & Media', 'Marketing consultancies', 2),
  ('Marketing & Media', 'Digital marketing', 3),
  ('Marketing & Media', 'Media production', 4),
  ('Marketing & Media', 'Photography/videography', 5),
  ('Marketing & Media', 'Graphic design', 6),
  ('Marketing & Media', 'Publishing', 7),
  ('Marketing & Media', 'Printing', 8),
  ('Marketing & Media', 'Signage & branding', 9),
  ('Health & Medical', 'GPs', 1),
  ('Health & Medical', 'Specialists', 2),
  ('Health & Medical', 'Dental', 3),
  ('Health & Medical', 'Physio/rehab', 4),
  ('Health & Medical', 'Chiropractic', 5),
  ('Health & Medical', 'Optometry', 6),
  ('Health & Medical', 'Veterinary', 7),
  ('Health & Medical', 'Medical labs', 8),
  ('Health & Medical', 'Pharmacies', 9),
  ('Health & Medical', 'Hospitals/clinics', 10),
  ('Health & Medical', 'Medical supplies', 11),
  ('Health & Medical', 'Mental health', 12),
  ('Health & Medical', 'Traditional medicine', 13),
  ('Education & Training', 'Private schools', 1),
  ('Education & Training', 'Preschools', 2),
  ('Education & Training', 'Private tertiary', 3),
  ('Education & Training', 'Vocational', 4),
  ('Education & Training', 'Corporate training', 5),
  ('Education & Training', 'Tutoring', 6),
  ('Education & Training', 'Online education', 7),
  ('Education & Training', 'Language schools', 8),
  ('Education & Training', 'Skills development', 9),
  ('Education & Training', 'SETA-accredited', 10),
  ('Personal Services', 'Hair salons', 1),
  ('Personal Services', 'Barbers', 2),
  ('Personal Services', 'Beauty spas', 3),
  ('Personal Services', 'Nail bars', 4),
  ('Personal Services', 'Gyms', 5),
  ('Personal Services', 'Personal training', 6),
  ('Personal Services', 'Massage', 7),
  ('Personal Services', 'Cleaning services', 8),
  ('Personal Services', 'Laundry', 9),
  ('Personal Services', 'Domestic services', 10),
  ('Personal Services', 'Pet grooming', 11),
  ('Personal Services', 'Wellness', 12),
  ('Auto & Motoring', 'New dealerships', 1),
  ('Auto & Motoring', 'Used dealerships', 2),
  ('Auto & Motoring', 'Repair/mechanics', 3),
  ('Auto & Motoring', 'Panel beating', 4),
  ('Auto & Motoring', 'Auto electrical', 5),
  ('Auto & Motoring', 'Tyres & wheels', 6),
  ('Auto & Motoring', 'Detailing/car wash', 7),
  ('Auto & Motoring', 'Auto parts', 8),
  ('Auto & Motoring', 'Vehicle finance intermediaries', 9),
  ('Auto & Motoring', 'Trucking/commercial vehicles', 10),
  ('Real Estate', 'Estate agencies', 1),
  ('Real Estate', 'Property management', 2),
  ('Real Estate', 'Rental agencies', 3),
  ('Real Estate', 'Developers', 4),
  ('Real Estate', 'Commercial', 5),
  ('Real Estate', 'Residential', 6),
  ('Real Estate', 'Valuations', 7),
  ('Real Estate', 'Body corporate', 8),
  ('Security & Safety', 'Guarding', 1),
  ('Security & Safety', 'Armed response', 2),
  ('Security & Safety', 'CCTV & alarms', 3),
  ('Security & Safety', 'Cybersecurity services', 4),
  ('Security & Safety', 'Health & safety consulting', 5),
  ('Security & Safety', 'Emergency response', 6),
  ('Waste & Environmental', 'Waste collection', 1),
  ('Waste & Environmental', 'Recycling', 2),
  ('Waste & Environmental', 'Waste-to-energy', 3),
  ('Waste & Environmental', 'Environmental consulting', 4),
  ('Waste & Environmental', 'Cleaning contractors', 5),
  ('Energy & Utilities', 'Solar installation', 1),
  ('Energy & Utilities', 'Solar supply', 2),
  ('Energy & Utilities', 'Electrical contracting', 3),
  ('Energy & Utilities', 'Energy consulting', 4),
  ('Energy & Utilities', 'Water/boreholes', 5),
  ('Energy & Utilities', 'Backup power', 6),
  ('Sport, Recreation & Entertainment', 'Gyms/studios', 1),
  ('Sport, Recreation & Entertainment', 'Sports clubs', 2),
  ('Sport, Recreation & Entertainment', 'Recreation centres', 3),
  ('Sport, Recreation & Entertainment', 'Nightclubs/venues', 4),
  ('Sport, Recreation & Entertainment', 'Event management', 5),
  ('Sport, Recreation & Entertainment', 'Music/performing arts', 6),
  ('Sport, Recreation & Entertainment', 'Regulated gambling', 7),
  ('Non-Profit & Community', 'NGOs', 1),
  ('Non-Profit & Community', 'Faith-based', 2),
  ('Non-Profit & Community', 'Community development', 3),
  ('Non-Profit & Community', 'Social enterprise', 4),
  ('Non-Profit & Community', 'Co-ops', 5),
  ('Non-Profit & Community', 'Foundations', 6),
  ('Fashion & Design', 'Fashion design/boutique', 1),
  ('Fashion & Design', 'Tailoring', 2),
  ('Fashion & Design', 'Custom clothing', 3),
  ('Fashion & Design', 'Accessories/jewellery', 4),
  ('Fashion & Design', 'Beauty & cosmetics', 5),
  ('Fashion & Design', 'Traditional wear', 6),
  ('Financial Services', 'Micro-lenders', 1),
  ('Financial Services', 'Insurance underwriting', 2),
  ('Financial Services', 'Investment management', 3),
  ('Financial Services', 'Brokers', 4),
  ('Financial Services', 'Debt collection', 5),
  ('Financial Services', 'Fintech', 6),
  ('Financial Services', 'Payments', 7),
  ('Agriculture Value Chain', 'Fresh produce distribution', 1),
  ('Agriculture Value Chain', 'Meat processing', 2),
  ('Agriculture Value Chain', 'Dairy processing', 3),
  ('Agriculture Value Chain', 'Beverage bottling', 4),
  ('Agriculture Value Chain', 'Grain milling', 5),
  ('Agriculture Value Chain', 'Feed manufacturing', 6),
  ('Import/Export & Trading', 'General trading', 1),
  ('Import/Export & Trading', 'Import distributors', 2),
  ('Import/Export & Trading', 'Export merchants', 3),
  ('Import/Export & Trading', 'Freight forwarding', 4),
  ('Import/Export & Trading', 'Customs clearing', 5),
  ('Other / Emerging', 'Legal medicinal cannabis', 1),
  ('Other / Emerging', 'Renewable energy tech', 2),
  ('Other / Emerging', 'E-commerce marketplaces', 3),
  ('Other / Emerging', 'Gig platforms', 4),
  ('Other / Emerging', 'Subscription services', 5),
  ('Other / Emerging', 'Other — mandatory free-text', 6)
) as s(industry_name, sub_name, sort_order)
join public.industries i on i.name = s.industry_name
on conflict (industry_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- Seed: baseline funder appetite matrix. Only funders on the panel are seeded;
-- missing funders are skipped and the totals reported via RAISE NOTICE.
-- ---------------------------------------------------------------------------
do $$
declare
  v_intended int;
  v_seeded   int;
begin
  create temporary table _fip_seed (industry_name text, funder_name text, level text) on commit drop;
  insert into _fip_seed (industry_name, funder_name, level) values
  ('Mining & Quarrying', 'PrefCap', 'high'),
  ('Mining & Quarrying', 'Sourcefin', 'high'),
  ('Mining & Quarrying', 'Business Partners', 'high'),
  ('Mining & Quarrying', 'Paragon Finance', 'high'),
  ('Mining & Quarrying', 'RM Capital', 'medium'),
  ('Mining & Quarrying', 'Merchant Capital', 'avoid'),
  ('Food & Beverage / Hospitality', 'Merchant Capital', 'high'),
  ('Food & Beverage / Hospitality', 'Pollen Finance', 'high'),
  ('Food & Beverage / Hospitality', 'Bridgement', 'high'),
  ('Food & Beverage / Hospitality', 'Growise Capital', 'medium'),
  ('Food & Beverage / Hospitality', 'Better Banc', 'medium'),
  ('Food & Beverage / Hospitality', 'Lula', 'medium'),
  ('Food & Beverage / Hospitality', 'PrefCap', 'avoid'),
  ('Food & Beverage / Hospitality', 'Paragon Finance', 'avoid'),
  ('Manufacturing', 'Business Partners', 'high'),
  ('Manufacturing', 'Bridgement', 'high'),
  ('Manufacturing', 'RM Capital', 'high'),
  ('Manufacturing', 'PrefCap', 'medium'),
  ('Manufacturing', 'Sourcefin', 'medium'),
  ('Retail & Wholesale', 'Merchant Capital', 'high'),
  ('Retail & Wholesale', 'Growise Capital', 'high'),
  ('Retail & Wholesale', 'Better Banc', 'high'),
  ('Retail & Wholesale', 'Pollen Finance', 'medium'),
  ('Retail & Wholesale', 'Bridgement', 'medium'),
  ('Transport & Logistics', 'Sourcefin', 'high'),
  ('Transport & Logistics', 'Bridgement', 'high'),
  ('Transport & Logistics', 'PrefCap', 'high'),
  ('Transport & Logistics', 'Business Partners', 'medium'),
  ('Construction & Built Environment', 'Paragon Finance', 'high'),
  ('Construction & Built Environment', 'Business Partners', 'high'),
  ('Construction & Built Environment', 'PrefCap', 'high'),
  ('Construction & Built Environment', 'Bridgement', 'medium'),
  ('Professional Services', 'Bridgement', 'high'),
  ('Professional Services', 'Better Banc', 'high'),
  ('Professional Services', 'Lula', 'high'),
  ('Professional Services', 'Growise Capital', 'medium'),
  ('Agriculture, Forestry & Farming', 'Business Partners', 'high'),
  ('Agriculture, Forestry & Farming', 'PrefCap', 'high'),
  ('Agriculture, Forestry & Farming', 'Growise Capital', 'high'),
  ('Agriculture, Forestry & Farming', 'Sourcefin', 'medium'),
  ('Technology & IT', 'Bridgement', 'high'),
  ('Technology & IT', 'Better Banc', 'high'),
  ('Technology & IT', 'Business Partners', 'high'),
  ('Health & Medical', 'Business Partners', 'high'),
  ('Health & Medical', 'Bridgement', 'high'),
  ('Health & Medical', 'Better Banc', 'high'),
  ('Auto & Motoring', 'Centrafin', 'high'),
  ('Auto & Motoring', 'Sourcefin', 'high'),
  ('Auto & Motoring', 'PrefCap', 'high'),
  ('Education & Training', 'Business Partners', 'high'),
  ('Education & Training', 'Bridgement', 'high');

  select count(*) into v_intended from _fip_seed;

  with ins as (
    insert into public.funder_industry_preferences (funder_id, industry_id, appetite_level)
    select f.id, i.id, s.level::public.appetite_level
    from _fip_seed s
    join public.funders    f on f.name = s.funder_name
    join public.industries i on i.name = s.industry_name
    on conflict (funder_id, industry_id) do nothing
    returning 1
  )
  select count(*) into v_seeded from ins;

  raise notice 'funder_industry_preferences: seeded % preference rows, skipped % for funders not on panel', v_seeded, v_intended - v_seeded;
end $$;
