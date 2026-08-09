-- Build 2/40 — shared partner + contractor payment-profile foundation.
--
-- This migration creates the private money-destination record used by later
-- partner/contractor invoicing builds. It deliberately exposes no direct Data
-- API table grant. Build 3 adds narrowly-scoped read/write RPCs and the UI.
--
-- Sensitive identifiers are ciphertext-only. The encryption key is never kept
-- in source or in this table; the Build-3 RPCs will obtain it from Supabase
-- Vault. The final four account digits are retained separately for safe display.

do $$ begin
  create type public.payee_profile_verification_status as enum (
    'incomplete', 'pending_verification', 'verified', 'rejected'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payee_bank_account_type as enum (
    'cheque', 'savings', 'transmission', 'business', 'other'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payee_vat_status as enum (
    'not_registered', 'registered', 'pending'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.payee_payment_profiles (
  id                         uuid primary key default gen_random_uuid(),

  -- Exactly one subject. Partners use the brokerage entity id; contractors use
  -- their authenticated profiles.id, matching the existing money engine.
  referral_partner_id        uuid references public.referral_partners(id) on delete cascade,
  contractor_id              uuid references public.profiles(id) on delete cascade,

  account_holder_name        text,
  bank_name                  text,
  branch_code                text,
  account_type               public.payee_bank_account_type,
  account_number_ciphertext  bytea,
  account_last_four          text,
  tax_number_ciphertext      bytea,
  vat_status                 public.payee_vat_status not null default 'not_registered',
  vat_number_ciphertext      bytea,

  -- The proof file lives in a private bucket introduced by Build 3. Only its
  -- opaque storage path belongs in the row.
  banking_proof_storage_path text,

  verification_status        public.payee_profile_verification_status not null default 'incomplete',
  submitted_at               timestamptz,
  verified_at                timestamptz,
  verified_by                uuid references public.profiles(id) on delete set null,
  rejection_reason           text,
  profile_version            integer not null default 1,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint payee_payment_profiles_one_subject_ck check (
    num_nonnulls(referral_partner_id, contractor_id) = 1
  ),
  constraint payee_payment_profiles_account_last_four_ck check (
    account_last_four is null or account_last_four ~ '^[0-9]{4}$'
  ),
  constraint payee_payment_profiles_branch_code_ck check (
    branch_code is null or branch_code ~ '^[0-9]{6}$'
  ),
  constraint payee_payment_profiles_ciphertext_ck check (
    (account_number_ciphertext is null or octet_length(account_number_ciphertext) >= 16)
    and (tax_number_ciphertext is null or octet_length(tax_number_ciphertext) >= 16)
    and (vat_number_ciphertext is null or octet_length(vat_number_ciphertext) >= 16)
  ),
  constraint payee_payment_profiles_vat_ck check (
    (vat_status = 'registered' and vat_number_ciphertext is not null)
    or (vat_status <> 'registered' and vat_number_ciphertext is null)
  ),
  constraint payee_payment_profiles_submission_ck check (
    verification_status not in ('pending_verification', 'verified')
    or (
      account_holder_name is not null
      and bank_name is not null
      and branch_code is not null
      and account_type is not null
      and account_number_ciphertext is not null
      and account_last_four is not null
      and banking_proof_storage_path is not null
      and submitted_at is not null
    )
  ),
  constraint payee_payment_profiles_verification_ck check (
    (verification_status = 'verified'
      and verified_at is not null
      and verified_by is not null
      and rejection_reason is null)
    or (verification_status = 'rejected'
      and verified_at is null
      and verified_by is null
      and nullif(btrim(rejection_reason), '') is not null)
    or (verification_status in ('incomplete', 'pending_verification')
      and verified_at is null
      and verified_by is null
      and rejection_reason is null)
  ),
  constraint payee_payment_profiles_version_ck check (profile_version > 0)
);

comment on table public.payee_payment_profiles is
  'Private partner/contractor payment destination and tax profile. Sensitive identifiers are ciphertext-only; no direct API table grants. Read/write occurs through scoped RPCs introduced in Build 3.';
comment on column public.payee_payment_profiles.account_number_ciphertext is
  'Encrypted bank account number. The encryption key is held in Supabase Vault and never stored in source.';
comment on column public.payee_payment_profiles.tax_number_ciphertext is
  'Encrypted SARS tax number. Never expose in list views or activity-log snapshots.';
comment on column public.payee_payment_profiles.vat_number_ciphertext is
  'Encrypted VAT registration number; required only when vat_status=registered.';
comment on column public.payee_payment_profiles.account_last_four is
  'Non-sensitive display suffix derived server-side from the account number.';

create unique index if not exists payee_payment_profiles_partner_uniq
  on public.payee_payment_profiles(referral_partner_id)
  where referral_partner_id is not null;
create unique index if not exists payee_payment_profiles_contractor_uniq
  on public.payee_payment_profiles(contractor_id)
  where contractor_id is not null;
create index if not exists payee_payment_profiles_verification_idx
  on public.payee_payment_profiles(verification_status, updated_at desc);
create index if not exists payee_payment_profiles_verified_by_idx
  on public.payee_payment_profiles(verified_by)
  where verified_by is not null;

drop trigger if exists payee_payment_profiles_set_updated_at on public.payee_payment_profiles;
create trigger payee_payment_profiles_set_updated_at
  before update on public.payee_payment_profiles
  for each row execute function public.set_updated_at();

-- Prevent a non-contractor profile from being installed in the contractor slot.
-- The partner branch already has a typed FK to referral_partners.
create or replace function public.payee_payment_profiles_validate_subject()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.contractor_id is not null and not exists (
    select 1
      from public.profiles p
     where p.id = new.contractor_id
       and p.role = 'contractor'::public.user_role
       and p.is_active
  ) then
    raise exception 'Payment profile contractor must be an active contractor profile'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists payee_payment_profiles_validate_subject on public.payee_payment_profiles;
create trigger payee_payment_profiles_validate_subject
  before insert or update of contractor_id on public.payee_payment_profiles
  for each row execute function public.payee_payment_profiles_validate_subject();

-- RLS is defense in depth. Direct table access remains revoked; Build 3 grants
-- EXECUTE only on safe RPCs. Policies document and enforce the intended row
-- scope if an internal authenticated database client is used later.
alter table public.payee_payment_profiles enable row level security;

drop policy if exists payee_payment_profiles_owner_all on public.payee_payment_profiles;
create policy payee_payment_profiles_owner_all on public.payee_payment_profiles
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));

drop policy if exists payee_payment_profiles_partner_read_own on public.payee_payment_profiles;
create policy payee_payment_profiles_partner_read_own on public.payee_payment_profiles
  for select to authenticated
  using (
    referral_partner_id is not null
    and referral_partner_id = (select public.current_partner_id())
  );

drop policy if exists payee_payment_profiles_contractor_read_own on public.payee_payment_profiles;
create policy payee_payment_profiles_contractor_read_own on public.payee_payment_profiles
  for select to authenticated
  using (
    contractor_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
       where p.id = (select auth.uid())
         and p.role = 'contractor'::public.user_role
         and p.is_active
    )
  );

revoke all on table public.payee_payment_profiles from public, anon, authenticated;
revoke all on function public.payee_payment_profiles_validate_subject() from public, anon, authenticated;

-- Structural assertions: abort the whole migration if privacy or identity
-- guarantees drift. Behavioural/RPC tests land with Build 3, where writes exist.
do $$
declare
  v_rls boolean;
begin
  select c.relrowsecurity into v_rls
    from pg_class c
   where c.oid = 'public.payee_payment_profiles'::regclass;
  if not coalesce(v_rls, false) then
    raise exception 'assert: payee_payment_profiles RLS is not enabled';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'payee_payment_profiles'
       and grantee in ('PUBLIC', 'anon', 'authenticated')
  ) then
    raise exception 'assert: payee_payment_profiles has a direct API grant';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'payee_payment_profiles'
       and column_name in ('account_number', 'tax_number', 'vat_number')
  ) then
    raise exception 'assert: plaintext sensitive payment column exists';
  end if;

  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and table_name = 'payee_payment_profiles'
         and column_name in (
           'account_number_ciphertext', 'tax_number_ciphertext', 'vat_number_ciphertext'
         )
         and data_type = 'bytea') <> 3 then
    raise exception 'assert: ciphertext columns are missing or not bytea';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename = 'payee_payment_profiles'
         and policyname in (
           'payee_payment_profiles_owner_all',
           'payee_payment_profiles_partner_read_own',
           'payee_payment_profiles_contractor_read_own'
         )) <> 3 then
    raise exception 'assert: payment-profile RLS policy matrix incomplete';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.payee_payment_profiles'::regclass
       and tgname = 'payee_payment_profiles_validate_subject'
       and not tgisinternal
  ) then
    raise exception 'assert: contractor subject validation trigger missing';
  end if;

  if exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public'
       and routine_name = 'payee_payment_profiles_validate_subject'
       and grantee in ('PUBLIC', 'anon', 'authenticated')
       and privilege_type = 'EXECUTE'
  ) then
    raise exception 'assert: validation trigger function is API-callable';
  end if;
end;
$$;
