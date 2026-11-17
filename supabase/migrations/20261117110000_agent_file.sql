-- Agent file (owner, 17 Nov 2026): the Office Administrator, HR and the Director capture an agent's details and
-- bank details on the agent's behalf, for agents (contractor), Team Leaders / Bright Destiny (partner) and sub-agents
-- (lead_referrer). Scanned documents are NOT here: the separate "Scan & upload paper forms" feature owns them.
--
-- Reuses, does not duplicate:
--   * payee_payment_profiles + its Vault key (payee_enc_key) and pgp_sym encryption for bank / tax / VAT numbers, the
--     same validation and the same lifecycle (incomplete -> pending_verification -> Director verifies). The capturer
--     never verifies: set_payee_payment_verification stays Director-only.
--   * The same key encrypts the agent's SA ID number (agent_details.id_number_ciphertext).
--   * staff_role_of / staff_audit_write / staff_text_is_safe / staff_notify / sa_id_normalise.
--
-- POPIA (launch plan section 8): full ID and bank numbers are visible only to HR, the Director and the person. The
-- Administrator may type and replace them but reads back masked (last four of the account, has-ID yes/no).
--
-- Sub-agents had no payee slot (payee profiles keyed partners by brokerage and contractors by profile). This adds
-- lead_referrer_id as a third subject. FKs on the populated table are NOT VALID here; 20261117111000 builds the unique
-- index CONCURRENTLY and validates them (CLAUDE.md FK rule).

-- 1. Agent details ------------------------------------------------------------------------------------------------------
create table if not exists public.agent_details (
  profile_id            uuid primary key references public.profiles(id) on delete cascade,
  contract_type         text check (contract_type is null or contract_type in ('SAA-01', 'DRA-01')),
  physical_address      text check (physical_address is null or length(physical_address) <= 300),
  id_number_ciphertext  bytea check (id_number_ciphertext is null or octet_length(id_number_ciphertext) >= 16),
  updated_by            uuid references public.profiles(id) on delete set null,
  updated_by_role       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table public.agent_details is
  'Agent file details kept by staff: contract type (SAA-01 sub-agent / DRA-01 direct agent), address and the encrypted SA ID number. RPC-only.';
comment on column public.agent_details.id_number_ciphertext is
  'SA ID number encrypted with payee_profile_enc_key. Decrypted only for HR and the Director (staff_get_agent_sensitive).';
alter table public.agent_details enable row level security;
revoke all on table public.agent_details from public, anon, authenticated;

-- 2. Payee profiles: a sub-agent subject + who captured the details -------------------------------------------------------
alter table public.payee_payment_profiles
  add column if not exists lead_referrer_id uuid,
  add column if not exists captured_by uuid,
  add column if not exists captured_by_role text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payee_payment_profiles_lead_referrer_fk') then
    alter table public.payee_payment_profiles add constraint payee_payment_profiles_lead_referrer_fk
      foreign key (lead_referrer_id) references public.profiles(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payee_payment_profiles_captured_by_fk') then
    alter table public.payee_payment_profiles add constraint payee_payment_profiles_captured_by_fk
      foreign key (captured_by) references public.profiles(id) on delete set null not valid;
  end if;
end $$;
alter table public.payee_payment_profiles drop constraint if exists payee_payment_profiles_one_subject_ck;
alter table public.payee_payment_profiles add constraint payee_payment_profiles_one_subject_ck
  check (num_nonnulls(referral_partner_id, contractor_id, lead_referrer_id) = 1) not valid;
comment on column public.payee_payment_profiles.captured_by is
  'Staff member who typed these details on the payee''s behalf (null when the payee saved them).';

create or replace function public.payee_payment_profiles_validate_subject()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.contractor_id is not null and not exists (
    select 1 from public.profiles p
     where p.id = new.contractor_id and p.role = 'contractor'::public.user_role and p.is_active
  ) then
    raise exception 'Payment profile contractor must be an active contractor profile' using errcode = '23514';
  end if;
  if new.lead_referrer_id is not null and not exists (
    select 1 from public.profiles p
     where p.id = new.lead_referrer_id and p.role = 'lead_referrer'::public.user_role and p.is_active
  ) then
    raise exception 'Payment profile sub-agent must be an active sub-agent profile' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.payee_payment_profiles_validate_subject() from public, anon, authenticated;
drop trigger if exists payee_payment_profiles_validate_subject on public.payee_payment_profiles;
create trigger payee_payment_profiles_validate_subject
  before insert or update of contractor_id, lead_referrer_id on public.payee_payment_profiles
  for each row execute function public.payee_payment_profiles_validate_subject();

-- The sub-agent reads their own masked profile like partners and contractors do.
create or replace function public.get_my_payee_payment_profile()
returns table (
  id uuid, verification_status public.payee_profile_verification_status, account_holder_name text, bank_name text,
  branch_code text, account_type public.payee_bank_account_type, account_last_four text, has_account_number boolean,
  has_tax_number boolean, vat_status public.payee_vat_status, has_vat_number boolean, has_banking_proof boolean,
  banking_proof_storage_path text, rejection_reason text, submitted_at timestamptz, verified_at timestamptz,
  profile_version integer, updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.verification_status, p.account_holder_name, p.bank_name, p.branch_code, p.account_type,
         p.account_last_four, p.account_number_ciphertext is not null, p.tax_number_ciphertext is not null,
         p.vat_status, p.vat_number_ciphertext is not null, p.banking_proof_storage_path is not null,
         p.banking_proof_storage_path, p.rejection_reason, p.submitted_at, p.verified_at, p.profile_version, p.updated_at
    from public.payee_payment_profiles p
   where p.referral_partner_id = public.current_partner_id()
      or p.contractor_id = auth.uid()
      or p.lead_referrer_id = auth.uid();
$$;
revoke execute on function public.get_my_payee_payment_profile() from public, anon;
grant execute on function public.get_my_payee_payment_profile() to authenticated;

-- The Director's payee screens name sub-agent profiles correctly (they used to assume partner when not a contractor).
create or replace function public.list_payee_payment_profiles_owner()
returns table (
  id uuid, subject_kind text, subject_name text, verification_status public.payee_profile_verification_status,
  bank_name text, account_last_four text, submitted_at timestamptz, verified_at timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can list payment profiles'; end if;
  return query
    select p.id,
           case when p.contractor_id is not null then 'contractor' when p.lead_referrer_id is not null then 'sub_agent' else 'partner' end,
           case when p.contractor_id is not null then pr.email when p.lead_referrer_id is not null then lr.email else rp.name end,
           p.verification_status, p.bank_name, p.account_last_four, p.submitted_at, p.verified_at, p.updated_at
      from public.payee_payment_profiles p
      left join public.profiles pr on pr.id = p.contractor_id
      left join public.profiles lr on lr.id = p.lead_referrer_id
      left join public.referral_partners rp on rp.id = p.referral_partner_id
     order by (p.verification_status = 'pending_verification') desc, p.updated_at desc;
end; $$;
revoke execute on function public.list_payee_payment_profiles_owner() from public, anon;
grant execute on function public.list_payee_payment_profiles_owner() to authenticated;

create or replace function public.get_payee_payment_profile_owner(p_profile_id uuid)
returns table (
  id uuid, subject_kind text, subject_name text, verification_status public.payee_profile_verification_status,
  account_holder_name text, bank_name text, branch_code text, account_type public.payee_bank_account_type,
  account_number text, account_last_four text, tax_number text, vat_status public.payee_vat_status, vat_number text,
  banking_proof_storage_path text, rejection_reason text, submitted_at timestamptz, verified_at timestamptz,
  verified_by uuid, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_key text;
begin
  if not public.is_owner() then raise exception 'Only the owner can view payee banking details'; end if;
  v_key := public.payee_enc_key();
  return query
    select p.id,
           case when p.contractor_id is not null then 'contractor' when p.lead_referrer_id is not null then 'sub_agent' else 'partner' end,
           case when p.contractor_id is not null then pr.email when p.lead_referrer_id is not null then lr.email else rp.name end,
           p.verification_status, p.account_holder_name, p.bank_name, p.branch_code, p.account_type,
           case when p.account_number_ciphertext is not null then extensions.pgp_sym_decrypt(p.account_number_ciphertext, v_key) end,
           p.account_last_four,
           case when p.tax_number_ciphertext is not null then extensions.pgp_sym_decrypt(p.tax_number_ciphertext, v_key) end,
           p.vat_status,
           case when p.vat_number_ciphertext is not null then extensions.pgp_sym_decrypt(p.vat_number_ciphertext, v_key) end,
           p.banking_proof_storage_path, p.rejection_reason, p.submitted_at, p.verified_at, p.verified_by, p.updated_at
      from public.payee_payment_profiles p
      left join public.profiles pr on pr.id = p.contractor_id
      left join public.profiles lr on lr.id = p.lead_referrer_id
      left join public.referral_partners rp on rp.id = p.referral_partner_id
     where p.id = p_profile_id;
end; $$;
revoke execute on function public.get_payee_payment_profile_owner(uuid) from public, anon;
grant execute on function public.get_payee_payment_profile_owner(uuid) to authenticated;

-- The Director's verification also notifies a sub-agent (their profile is the subject). Unchanged otherwise.
create or replace function public.set_payee_payment_verification(
  p_profile_id uuid,
  p_approve    boolean,
  p_reason     text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_row    public.payee_payment_profiles;
  v_target uuid;
  v_email  text;
  v_role   text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can verify payment profiles';
  end if;

  select * into v_row from public.payee_payment_profiles where id = p_profile_id for update;
  if v_row.id is null then
    raise exception 'Payment profile not found';
  end if;
  if v_row.verification_status <> 'pending_verification' then
    raise exception 'Only a submitted (pending) profile can be verified or rejected';
  end if;
  if not p_approve and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A rejection reason is required';
  end if;

  if p_approve then
    update public.payee_payment_profiles
       set verification_status = 'verified', verified_by = v_uid, verified_at = now(), rejection_reason = null
     where id = p_profile_id returning * into v_row;
  else
    update public.payee_payment_profiles
       set verification_status = 'rejected', verified_by = null, verified_at = null, rejection_reason = btrim(p_reason)
     where id = p_profile_id returning * into v_row;
  end if;
  if not found then
    raise exception 'Verification affected no rows';
  end if;

  -- Notify the subject: a contractor's profile id is contractor_id; a partner's
  -- is resolved from the referral-partner id.
  v_target := case when v_row.contractor_id is not null then v_row.contractor_id
                   when v_row.lead_referrer_id is not null then v_row.lead_referrer_id
                   else public.partner_profile_id(v_row.referral_partner_id) end;
  if v_target is not null then
    if p_approve then
      perform public.emit_in_app_notification(
        v_target, 'PAYEE_PROFILE_VERIFIED', 'Your payment details are verified',
        'Your banking details have been verified. You are set up to be paid.',
        '/settings/payment', jsonb_build_object('profile_id', v_row.id));
    else
      perform public.emit_in_app_notification(
        v_target, 'PAYEE_PROFILE_REJECTED', 'Your payment details need attention',
        'Your banking details were not verified: ' || v_row.rejection_reason
          || '. Please update and resubmit.',
        '/settings/payment', jsonb_build_object('profile_id', v_row.id));
    end if;
  end if;

  select email, role into v_email, v_role from public.profiles where id = v_uid;
  insert into public.activity_logs
    (user_id, user_email, user_role, event_type, entity_type, entity_id, description,
     after_values, related_entity_ids)
  values
    (v_uid, v_email, v_role, 'UPDATE'::public.activity_event_type, 'payee_payment_profile', v_row.id,
     'Payment profile ' || v_row.verification_status::text,
     jsonb_build_object('verification_status', v_row.verification_status, 'rejection_reason', v_row.rejection_reason),
     to_jsonb(array_remove(array[v_row.referral_partner_id, v_row.contractor_id, v_row.lead_referrer_id], null)));

  return v_row.id;
end; $$;
revoke execute on function public.set_payee_payment_verification(uuid, boolean, text) from public, anon;
grant execute on function public.set_payee_payment_verification(uuid, boolean, text) to authenticated;

-- 3. Who may work on agent files ----------------------------------------------------------------------------------------
-- 'owner', 'hr' or 'administrator' (enabled staff access), else null. NULL-safe.
create or replace function public.agent_file_actor_role()
returns text
language sql stable security definer set search_path = '' as $$
  select case when coalesce(public.is_owner(), false) then 'owner'
              when coalesce(public.staff_role_of() in ('hr', 'administrator'), false) then public.staff_role_of()
         end;
$$;
revoke all on function public.agent_file_actor_role() from public, anon, authenticated;

-- The agent's role, when the profile is an active agent, sub-agent or Team Leader.
create or replace function public.agent_file_subject_role(p_profile uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select p.role::text from public.profiles p
   where p.id = p_profile and p.is_active and p.role::text in ('partner', 'contractor', 'lead_referrer');
$$;
revoke all on function public.agent_file_subject_role(uuid) from public, anon, authenticated;

-- The payee row for an agent profile (partners are keyed by their brokerage), or null.
create or replace function public.agent_file_payee_row(p_profile uuid)
returns public.payee_payment_profiles
language sql stable security definer set search_path = '' as $$
  select pp.* from public.payee_payment_profiles pp
    join public.profiles p on p.id = p_profile
   where (p.role::text = 'contractor' and pp.contractor_id = p.id)
      or (p.role::text = 'lead_referrer' and pp.lead_referrer_id = p.id)
      or (p.role::text = 'partner' and p.referral_partner_id is not null and pp.referral_partner_id = p.referral_partner_id)
   limit 1;
$$;
revoke all on function public.agent_file_payee_row(uuid) from public, anon, authenticated;

-- 4. Read the file (masked) ---------------------------------------------------------------------------------------------
create or replace function public.staff_get_agent_file(p_profile uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor text := public.agent_file_actor_role(); v_p public.profiles; v_d public.agent_details;
  v_pp public.payee_payment_profiles; v_code text; v_capturer text;
begin
  if v_actor is null then
    raise exception 'Only the Director, HR or the Office Administrator opens agent files' using errcode = '42501';
  end if;
  select * into v_p from public.profiles where id = p_profile and role::text in ('partner', 'contractor', 'lead_referrer');
  if v_p.id is null then raise exception 'Agent not found'; end if;
  select * into v_d from public.agent_details where profile_id = p_profile;
  v_pp := public.agent_file_payee_row(p_profile);
  select c.agent_code into v_code from public.agent_onboarding_clearances c where c.profile_id = p_profile;
  select coalesce(nullif(btrim(x.full_name), ''), x.email) into v_capturer from public.profiles x where x.id = v_pp.captured_by;
  return jsonb_build_object(
    'profile_id', v_p.id, 'full_name', v_p.full_name, 'email', v_p.email, 'phone_number', v_p.phone_number,
    'role', v_p.role::text, 'is_active', v_p.is_active, 'agent_code', v_code,
    'partner_linked', (v_p.role::text <> 'partner' or v_p.referral_partner_id is not null),
    'contract_type', v_d.contract_type, 'physical_address', v_d.physical_address,
    'has_id_number', v_d.id_number_ciphertext is not null,
    'details_updated_at', v_d.updated_at,
    'can_view_sensitive', v_actor in ('owner', 'hr'),
    'bank', case when v_pp.id is null then null else jsonb_build_object(
      'verification_status', v_pp.verification_status, 'account_holder_name', v_pp.account_holder_name,
      'bank_name', v_pp.bank_name, 'branch_code', v_pp.branch_code, 'account_type', v_pp.account_type,
      'account_last_four', v_pp.account_last_four, 'has_tax_number', v_pp.tax_number_ciphertext is not null,
      'vat_status', v_pp.vat_status, 'has_vat_number', v_pp.vat_number_ciphertext is not null,
      'has_banking_proof', v_pp.banking_proof_storage_path is not null, 'rejection_reason', v_pp.rejection_reason,
      'captured_by_name', v_capturer, 'captured_by_role', v_pp.captured_by_role, 'updated_at', v_pp.updated_at) end);
end;
$$;
revoke all on function public.staff_get_agent_file(uuid) from public, anon;
grant execute on function public.staff_get_agent_file(uuid) to authenticated;

-- 5. Save details -------------------------------------------------------------------------------------------------------
-- A null argument keeps what is stored. Email is the login and is changed only from the Team page.
create or replace function public.staff_save_agent_details(
  p_profile uuid, p_full_name text default null, p_phone_number text default null,
  p_physical_address text default null, p_contract_type text default null, p_id_number text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor text := public.agent_file_actor_role(); v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone_number, ''), '[\s()-]', '', 'g'), '');
  v_addr text := nullif(btrim(coalesce(p_physical_address, '')), ''); v_ct text := nullif(btrim(coalesce(p_contract_type, '')), '');
  v_id text; v_ct_id bytea; v_changed text[] := '{}'; v_rows int;
begin
  if v_actor is null then
    raise exception 'Only the Director, HR or the Office Administrator edits agent files' using errcode = '42501';
  end if;
  if public.agent_file_subject_role(p_profile) is null then
    raise exception 'Agent files are for active agents, sub-agents and Team Leaders';
  end if;
  if v_name is not null and (length(v_name) not between 2 and 120 or not public.staff_text_is_safe(v_name)) then
    raise exception 'Enter the full name (2 to 120 characters)';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{10,15}$' then
    raise exception 'Enter a cell number of 10 to 15 digits';
  end if;
  if v_addr is not null and (length(v_addr) > 300 or not public.staff_text_is_safe(v_addr)) then
    raise exception 'Keep the address under 300 characters, with no ID or bank numbers';
  end if;
  if v_ct is not null and v_ct not in ('SAA-01', 'DRA-01') then
    raise exception 'Contract type must be SAA-01 (sub-agent) or DRA-01 (direct agent)';
  end if;
  if nullif(btrim(coalesce(p_id_number, '')), '') is not null then
    v_id := public.sa_id_normalise(p_id_number);
    if v_id is null then raise exception 'Enter a valid 13-digit SA ID number'; end if;
    v_ct_id := extensions.pgp_sym_encrypt(v_id, public.payee_enc_key());
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agent_file:' || p_profile::text, 0));
  if v_name is not null or v_phone is not null then
    update public.profiles set full_name = coalesce(v_name, full_name), phone_number = coalesce(v_phone, phone_number)
     where id = p_profile;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'Saving the agent''s name or cell number affected no rows'; end if;
    if v_name is not null then v_changed := array_append(v_changed, 'full_name'); end if;
    if v_phone is not null then v_changed := array_append(v_changed, 'phone_number'); end if;
  end if;
  if v_addr is not null or v_ct is not null or v_ct_id is not null then
    insert into public.agent_details as d (profile_id, contract_type, physical_address, id_number_ciphertext, updated_by, updated_by_role)
    values (p_profile, v_ct, v_addr, v_ct_id, (select auth.uid()), v_actor)
    on conflict (profile_id) do update set
      contract_type = coalesce(excluded.contract_type, d.contract_type),
      physical_address = coalesce(excluded.physical_address, d.physical_address),
      id_number_ciphertext = coalesce(excluded.id_number_ciphertext, d.id_number_ciphertext),
      updated_by = excluded.updated_by, updated_by_role = excluded.updated_by_role, updated_at = now();
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'Saving the agent details affected no rows'; end if;
    if v_addr is not null then v_changed := array_append(v_changed, 'physical_address'); end if;
    if v_ct is not null then v_changed := array_append(v_changed, 'contract_type'); end if;
    if v_ct_id is not null then v_changed := array_append(v_changed, 'id_number'); end if;
  end if;
  if coalesce(array_length(v_changed, 1), 0) = 0 then raise exception 'Nothing to save'; end if;

  -- Field names only: never the values (the ID number is never logged).
  perform public.staff_audit_write('agent_file', p_profile, 'agent_details_saved', null,
    jsonb_build_object('fields', to_jsonb(v_changed), 'contract_type', v_ct));
  return p_profile;
end;
$$;
revoke all on function public.staff_save_agent_details(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.staff_save_agent_details(uuid, text, text, text, text, text) to authenticated;

-- 6. Save bank details on the agent's behalf ----------------------------------------------------------------------------
-- Same encryption and checks as save_payee_payment_profile. A null argument keeps what is stored, so a branch-code fix
-- needs no account number. When the details are complete (proof of banking included) the profile goes straight to
-- pending_verification for the Director, who alone verifies; otherwise it stays incomplete. Any change undoes a previous
-- verification, as on the self-service path.
create or replace function public.staff_save_agent_payee(
  p_profile uuid,
  p_account_holder_name text default null, p_bank_name text default null, p_branch_code text default null,
  p_account_type public.payee_bank_account_type default null, p_account_number text default null,
  p_tax_number text default null, p_vat_status public.payee_vat_status default null, p_vat_number text default null,
  p_banking_proof_storage_path text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor text := public.agent_file_actor_role(); v_uid uuid := (select auth.uid()); v_role text; v_partner uuid;
  v_key text; v_old public.payee_payment_profiles; v_id uuid; v_acct bytea; v_last4 text; v_tax bytea; v_vat bytea;
  v_vstatus public.payee_vat_status; v_proof text := nullif(btrim(coalesce(p_banking_proof_storage_path, '')), '');
  v_complete boolean; v_owner uuid; v_name text;
begin
  if v_actor is null then
    raise exception 'Only the Director, HR or the Office Administrator captures agent bank details' using errcode = '42501';
  end if;
  v_role := public.agent_file_subject_role(p_profile);
  if v_role is null then raise exception 'Bank details are captured for active agents, sub-agents and Team Leaders'; end if;
  select referral_partner_id, coalesce(nullif(btrim(full_name), ''), email) into v_partner, v_name from public.profiles where id = p_profile;
  if v_role = 'partner' and v_partner is null then
    raise exception 'This partner is not linked to a brokerage yet: ask the Director to link them on the Team page first';
  end if;
  if nullif(btrim(coalesce(p_branch_code, '')), '') is not null and p_branch_code !~ '^[0-9]{6}$' then
    raise exception 'Branch code must be exactly 6 digits';
  end if;
  if (p_account_holder_name is not null and length(btrim(p_account_holder_name)) > 120)
     or (p_bank_name is not null and length(btrim(p_bank_name)) > 80) then
    raise exception 'Keep the account holder under 120 and the bank name under 80 characters';
  end if;
  if v_proof is not null and (length(v_proof) > 500 or v_proof like '%..%') then
    raise exception 'Invalid proof of banking file reference';
  end if;
  v_key := public.payee_enc_key();

  perform pg_advisory_xact_lock(hashtext('payee_profile:' || coalesce(case when v_role = 'partner' then v_partner end, p_profile)::text));
  v_old := public.agent_file_payee_row(p_profile);

  if nullif(btrim(coalesce(p_account_number, '')), '') is not null then
    if length(regexp_replace(p_account_number, '\D', '', 'g')) < 4 then
      raise exception 'Account number must contain at least 4 digits';
    end if;
    v_acct := extensions.pgp_sym_encrypt(p_account_number, v_key);
    v_last4 := right(regexp_replace(p_account_number, '\D', '', 'g'), 4);
  else
    v_acct := v_old.account_number_ciphertext; v_last4 := v_old.account_last_four;
  end if;
  v_tax := case when nullif(btrim(coalesce(p_tax_number, '')), '') is not null
                then extensions.pgp_sym_encrypt(p_tax_number, v_key) else v_old.tax_number_ciphertext end;
  v_vstatus := coalesce(p_vat_status, v_old.vat_status, 'not_registered');
  v_vat := case when nullif(btrim(coalesce(p_vat_number, '')), '') is not null
                then extensions.pgp_sym_encrypt(p_vat_number, v_key) else v_old.vat_number_ciphertext end;
  if v_vstatus = 'registered' and v_vat is null then
    raise exception 'A VAT number is required when VAT status is registered';
  end if;
  if v_vstatus <> 'registered' then v_vat := null; end if;

  if v_old.id is null then
    insert into public.payee_payment_profiles (
      referral_partner_id, contractor_id, lead_referrer_id, account_holder_name, bank_name, branch_code, account_type,
      account_number_ciphertext, account_last_four, tax_number_ciphertext, vat_status, vat_number_ciphertext,
      banking_proof_storage_path, verification_status, captured_by, captured_by_role
    ) values (
      case when v_role = 'partner' then v_partner end, case when v_role = 'contractor' then p_profile end,
      case when v_role = 'lead_referrer' then p_profile end,
      nullif(btrim(p_account_holder_name), ''), nullif(btrim(p_bank_name), ''), nullif(btrim(p_branch_code), ''), p_account_type,
      v_acct, v_last4, v_tax, v_vstatus, v_vat, v_proof, 'incomplete', v_uid, v_actor
    ) returning id into v_id;
  else
    update public.payee_payment_profiles set
      account_holder_name = coalesce(nullif(btrim(p_account_holder_name), ''), account_holder_name),
      bank_name = coalesce(nullif(btrim(p_bank_name), ''), bank_name),
      branch_code = coalesce(nullif(btrim(p_branch_code), ''), branch_code),
      account_type = coalesce(p_account_type, account_type),
      account_number_ciphertext = v_acct, account_last_four = v_last4, tax_number_ciphertext = v_tax,
      vat_status = v_vstatus, vat_number_ciphertext = v_vat,
      banking_proof_storage_path = coalesce(v_proof, banking_proof_storage_path),
      verification_status = 'incomplete', submitted_at = null, verified_at = null, verified_by = null,
      rejection_reason = null, profile_version = profile_version + 1, captured_by = v_uid, captured_by_role = v_actor
    where id = v_old.id
    returning id into v_id;
  end if;
  if v_id is null then raise exception 'Saving the bank details affected no rows'; end if;

  select (account_holder_name is not null and bank_name is not null and branch_code is not null and account_type is not null
          and account_number_ciphertext is not null and account_last_four is not null and banking_proof_storage_path is not null)
    into v_complete from public.payee_payment_profiles where id = v_id;
  if v_complete then
    update public.payee_payment_profiles set verification_status = 'pending_verification', submitted_at = now()
     where id = v_id returning id into v_id;
    if v_id is null then raise exception 'Sending the bank details for verification affected no rows'; end if;
    for v_owner in select id from public.profiles where role = 'owner'::public.user_role and is_active loop
      perform public.staff_notify(v_owner, 'PAYEE_PROFILE_SUBMITTED', 'Bank details need verification',
        coalesce(v_name, 'An agent') || '''s bank details were captured by the office and need your verification.',
        '/settings/payees', jsonb_build_object('payee_profile_id', v_id, 'agent_profile_id', p_profile));
    end loop;
  end if;

  -- Booleans and last four only: never the numbers.
  perform public.staff_audit_write('agent_file', p_profile, 'agent_bank_details_captured', null, jsonb_build_object(
    'payee_profile_id', v_id, 'account_last_four', v_last4, 'has_tax_number', v_tax is not null,
    'vat_status', v_vstatus, 'has_banking_proof', coalesce(v_proof, v_old.banking_proof_storage_path) is not null,
    'sent_for_verification', v_complete));
  return v_id;
end;
$$;
revoke all on function public.staff_save_agent_payee(uuid, text, text, text, public.payee_bank_account_type, text, text, public.payee_vat_status, text, text) from public, anon;
grant execute on function public.staff_save_agent_payee(uuid, text, text, text, public.payee_bank_account_type, text, text, public.payee_vat_status, text, text) to authenticated;

-- 7. Full numbers: HR and the Director only ------------------------------------------------------------------------------
create or replace function public.staff_get_agent_sensitive(p_profile uuid)
returns table (id_number text, account_number text, tax_number text, vat_number text)
language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.agent_file_actor_role(); v_key text; v_pp public.payee_payment_profiles; v_d public.agent_details;
begin
  if v_actor is null or v_actor not in ('owner', 'hr') then
    raise exception 'Only HR or the Director can see full ID and bank numbers' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile and role::text in ('partner', 'contractor', 'lead_referrer')) then
    raise exception 'Agent not found';
  end if;
  v_key := public.payee_enc_key();
  select * into v_d from public.agent_details where profile_id = p_profile;
  v_pp := public.agent_file_payee_row(p_profile);
  -- Who looked, never what they saw.
  perform public.staff_audit_write('agent_file', p_profile, 'agent_sensitive_viewed', null, '{}'::jsonb);
  return query select
    case when v_d.id_number_ciphertext is not null then extensions.pgp_sym_decrypt(v_d.id_number_ciphertext, v_key) end,
    case when v_pp.account_number_ciphertext is not null then extensions.pgp_sym_decrypt(v_pp.account_number_ciphertext, v_key) end,
    case when v_pp.tax_number_ciphertext is not null then extensions.pgp_sym_decrypt(v_pp.tax_number_ciphertext, v_key) end,
    case when v_pp.vat_number_ciphertext is not null then extensions.pgp_sym_decrypt(v_pp.vat_number_ciphertext, v_key) end;
end;
$$;
revoke all on function public.staff_get_agent_sensitive(uuid) from public, anon;
grant execute on function public.staff_get_agent_sensitive(uuid) to authenticated;
