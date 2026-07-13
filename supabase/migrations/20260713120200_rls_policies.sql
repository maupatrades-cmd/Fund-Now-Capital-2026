-- Row Level Security — enabled on every table, day one.
--
-- Model:
--   * Owners: full read/write on everything.
--   * Partners: READ-ONLY, and only rows tied to their own referral_partner_id.
--     Partner screens don't exist yet, but these policies are written now.
--   * Funder identity (funders, funder_contacts, deal_funder_submissions) is
--     NEVER exposed to partners — this is the anonymisation rule. A partner-safe
--     view over display_name_for_partner will come with the portal.
--
-- Helper functions are SECURITY DEFINER so they can read profiles without
-- tripping profiles' own RLS (avoids recursion).

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'owner' from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

create or replace function public.current_partner_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.referral_partner_id from public.profiles p where p.id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles_owner_all" on public.profiles
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- referral_partners
-- ---------------------------------------------------------------------------
alter table public.referral_partners enable row level security;

create policy "referral_partners_owner_all" on public.referral_partners
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy "referral_partners_partner_read_own" on public.referral_partners
  for select to authenticated
  using (id = public.current_partner_id());

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
alter table public.clients enable row level security;

create policy "clients_owner_all" on public.clients
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy "clients_partner_read_own" on public.clients
  for select to authenticated
  using (referral_partner_id = public.current_partner_id());

-- ---------------------------------------------------------------------------
-- client_contacts (partner access via the parent client)
-- ---------------------------------------------------------------------------
alter table public.client_contacts enable row level security;

create policy "client_contacts_owner_all" on public.client_contacts
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy "client_contacts_partner_read_own" on public.client_contacts
  for select to authenticated
  using (
    exists (
      select 1 from public.clients c
      where c.id = client_contacts.client_id
        and c.referral_partner_id = public.current_partner_id()
    )
  );

-- ---------------------------------------------------------------------------
-- funders — OWNER ONLY (real names must never reach partners)
-- ---------------------------------------------------------------------------
alter table public.funders enable row level security;

create policy "funders_owner_all" on public.funders
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- funder_contacts — OWNER ONLY (sensitive)
-- ---------------------------------------------------------------------------
alter table public.funder_contacts enable row level security;

create policy "funder_contacts_owner_all" on public.funder_contacts
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- deals
-- ---------------------------------------------------------------------------
alter table public.deals enable row level security;

create policy "deals_owner_all" on public.deals
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy "deals_partner_read_own" on public.deals
  for select to authenticated
  using (referral_partner_id = public.current_partner_id());

-- ---------------------------------------------------------------------------
-- deal_funder_submissions — OWNER ONLY (exposes funder identity)
-- ---------------------------------------------------------------------------
alter table public.deal_funder_submissions enable row level security;

create policy "deal_funder_submissions_owner_all" on public.deal_funder_submissions
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
alter table public.documents enable row level security;

create policy "documents_owner_all" on public.documents
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Partners may read their own clients' documents EXCEPT bank statements, which
-- are owner-only (highly sensitive financial data).
create policy "documents_partner_read_own" on public.documents
  for select to authenticated
  using (
    referral_partner_id = public.current_partner_id()
    and doc_type <> 'bank_statement'
  );

-- ---------------------------------------------------------------------------
-- communications
-- ---------------------------------------------------------------------------
alter table public.communications enable row level security;

create policy "communications_owner_all" on public.communications
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy "communications_partner_read_own" on public.communications
  for select to authenticated
  using (referral_partner_id = public.current_partner_id());

-- ---------------------------------------------------------------------------
-- commission_records
-- ---------------------------------------------------------------------------
alter table public.commission_records enable row level security;

create policy "commission_records_owner_all" on public.commission_records
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy "commission_records_partner_read_own" on public.commission_records
  for select to authenticated
  using (referral_partner_id = public.current_partner_id());
