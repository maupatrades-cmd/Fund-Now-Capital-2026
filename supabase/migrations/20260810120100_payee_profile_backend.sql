-- Build 3.1 — payee payment-profile backend (part 2 of 2).
--
-- Build 2 created `public.payee_payment_profiles` with sensitive columns as
-- ciphertext-only and *no* API write path (direct table grants are revoked).
-- This migration adds the machinery that makes it usable:
--   1. A Vault-held symmetric key + a private encrypt-key accessor.
--   2. Scoped SECURITY DEFINER RPCs: save / submit (subject-owned), owner
--      verify/reject, a masked self-read, and owner list + decrypted detail.
--   3. A private `payee-proofs` storage bucket + uploader-scoped RLS.
--   4. PAYEE_PROFILE_SUBMITTED / _VERIFIED / _REJECTED notifications + prefs.
--
-- Money/PII rules honoured: bank account / tax / VAT numbers are encrypted
-- server-side and never returned to a subject (masked reads only — last-4 for
-- the account); only the owner can decrypt, and only for verification. Every
-- mutation checks its returned row (RLS fails silently) and writes activity_logs
-- with NON-sensitive values only (booleans + last-4, never the numbers).

-- ===========================================================================
-- 1. Vault key + private accessor. The key is generated once and stored in
--    Vault (never in source). Re-running is a no-op, so existing ciphertext
--    stays decryptable.
-- ===========================================================================
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'payee_profile_enc_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'payee_profile_enc_key',
      'Symmetric key for payee_payment_profiles ciphertext columns (Build 3.1).'
    );
  end if;
end $$;

create or replace function public.payee_enc_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'payee_profile_enc_key';
  if v_key is null then
    raise exception 'payee_profile_enc_key is not configured in Vault';
  end if;
  return v_key;
end; $$;

revoke execute on function public.payee_enc_key() from public, anon, authenticated;

-- ===========================================================================
-- 2. save_payee_payment_profile — upsert the CALLER'S OWN draft. Encrypts only
--    the secrets supplied this call (keeps existing ciphertext otherwise), so a
--    subject who is just correcting their branch code need not re-enter their
--    account number. Any edit resets the profile to `incomplete` (a prior
--    verification no longer describes the new details).
-- ===========================================================================
create or replace function public.save_payee_payment_profile(
  p_account_holder_name        text default null,
  p_bank_name                  text default null,
  p_branch_code                text default null,
  p_account_type               public.payee_bank_account_type default null,
  p_account_number             text default null,
  p_tax_number                 text default null,
  p_vat_status                 public.payee_vat_status default null,
  p_vat_number                 text default null,
  p_banking_proof_storage_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_partner   uuid := public.current_partner_id();
  v_is_contr  boolean;
  v_key       text := public.payee_enc_key();
  v_old       public.payee_payment_profiles;
  v_id        uuid;
  v_acct      bytea;
  v_last4     text;
  v_tax       bytea;
  v_vat       bytea;
  v_vstatus   public.payee_vat_status;
  v_email     text;
  v_role      text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.is_owner() then
    raise exception 'The owner (FNC) does not maintain a payee payment profile';
  end if;

  select (role = 'contractor'::public.user_role and is_active) into v_is_contr
    from public.profiles where id = v_uid;

  if v_partner is null and not coalesce(v_is_contr, false) then
    raise exception 'Only an active partner or contractor can save a payment profile';
  end if;

  -- Load the caller's existing row (one per subject, enforced by unique indexes).
  if v_partner is not null then
    select * into v_old from public.payee_payment_profiles where referral_partner_id = v_partner;
  else
    select * into v_old from public.payee_payment_profiles where contractor_id = v_uid;
  end if;

  -- A supplied proof path must live under the caller's own storage folder
  -- (mirrors the payee-proofs storage RLS below).
  if p_banking_proof_storage_path is not null
     and p_banking_proof_storage_path not like 'payee/' || v_uid::text || '/%' then
    raise exception 'Banking proof path must be under your own folder';
  end if;

  -- Encrypt only the secrets provided; otherwise keep what is already stored.
  if nullif(btrim(coalesce(p_account_number, '')), '') is not null then
    if length(regexp_replace(p_account_number, '\D', '', 'g')) < 4 then
      raise exception 'Account number must contain at least 4 digits';
    end if;
    v_acct  := extensions.pgp_sym_encrypt(p_account_number, v_key);
    v_last4 := right(regexp_replace(p_account_number, '\D', '', 'g'), 4);
  else
    v_acct  := v_old.account_number_ciphertext;
    v_last4 := v_old.account_last_four;
  end if;

  if nullif(btrim(coalesce(p_tax_number, '')), '') is not null then
    v_tax := extensions.pgp_sym_encrypt(p_tax_number, v_key);
  else
    v_tax := v_old.tax_number_ciphertext;
  end if;

  v_vstatus := coalesce(p_vat_status, v_old.vat_status, 'not_registered');

  if nullif(btrim(coalesce(p_vat_number, '')), '') is not null then
    v_vat := extensions.pgp_sym_encrypt(p_vat_number, v_key);
  else
    v_vat := v_old.vat_number_ciphertext;
  end if;

  -- VAT consistency (friendly message; the table CHECK enforces it as a backstop).
  if v_vstatus = 'registered' and v_vat is null then
    raise exception 'A VAT number is required when VAT status is registered';
  end if;
  if v_vstatus <> 'registered' then
    v_vat := null;  -- CHECK: vat_number must be null unless registered
  end if;

  if v_old.id is null then
    insert into public.payee_payment_profiles (
      referral_partner_id, contractor_id, account_holder_name, bank_name, branch_code,
      account_type, account_number_ciphertext, account_last_four, tax_number_ciphertext,
      vat_status, vat_number_ciphertext, banking_proof_storage_path, verification_status
    ) values (
      case when v_partner is not null then v_partner end,
      case when v_partner is null then v_uid end,
      p_account_holder_name, p_bank_name, p_branch_code, p_account_type,
      v_acct, v_last4, v_tax, v_vstatus, v_vat, p_banking_proof_storage_path, 'incomplete'
    ) returning id into v_id;
  else
    update public.payee_payment_profiles set
      account_holder_name       = coalesce(p_account_holder_name, account_holder_name),
      bank_name                 = coalesce(p_bank_name, bank_name),
      branch_code               = coalesce(p_branch_code, branch_code),
      account_type              = coalesce(p_account_type, account_type),
      account_number_ciphertext = v_acct,
      account_last_four         = v_last4,
      tax_number_ciphertext     = v_tax,
      vat_status                = v_vstatus,
      vat_number_ciphertext     = v_vat,
      banking_proof_storage_path = coalesce(p_banking_proof_storage_path, banking_proof_storage_path),
      verification_status       = 'incomplete',
      submitted_at              = null,
      verified_at               = null,
      verified_by               = null,
      rejection_reason          = null,
      profile_version           = profile_version + 1
    where id = v_old.id
    returning id into v_id;
  end if;

  if v_id is null then
    raise exception 'Saving the payment profile affected no rows';
  end if;

  select email, role into v_email, v_role from public.profiles where id = v_uid;
  insert into public.activity_logs
    (user_id, user_email, user_role, event_type, entity_type, entity_id, description,
     after_values, related_entity_ids)
  values
    (v_uid, v_email, v_role,
     (case when v_old.id is null then 'CREATE' else 'UPDATE' end)::public.activity_event_type,
     'payee_payment_profile', v_id, 'Payment profile saved (draft)',
     jsonb_build_object(
       'has_account_number', v_acct is not null,
       'account_last_four',  v_last4,
       'has_tax_number',     v_tax is not null,
       'vat_status',         v_vstatus,
       'has_vat_number',     v_vat is not null,
       'has_banking_proof',  coalesce(p_banking_proof_storage_path, v_old.banking_proof_storage_path) is not null),
     to_jsonb(array_remove(array[v_partner, case when v_partner is null then v_uid end], null)));

  return v_id;
end; $$;

-- ===========================================================================
-- 3. submit_payee_payment_profile — the CALLER moves their own complete profile
--    to `pending_verification`. Lists any missing required field rather than
--    tripping the table CHECK. Notifies the owner.
-- ===========================================================================
create or replace function public.submit_payee_payment_profile()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_partner uuid := public.current_partner_id();
  v_row     public.payee_payment_profiles;
  v_owner   uuid;
  v_missing text[] := '{}';
  v_email   text;
  v_role    text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if v_partner is not null then
    select * into v_row from public.payee_payment_profiles where referral_partner_id = v_partner for update;
  else
    select * into v_row from public.payee_payment_profiles where contractor_id = v_uid for update;
  end if;
  if v_row.id is null then
    raise exception 'Save your payment details before submitting';
  end if;

  if nullif(btrim(coalesce(v_row.account_holder_name, '')), '') is null then v_missing := v_missing || 'account holder name'; end if;
  if nullif(btrim(coalesce(v_row.bank_name, '')), '') is null then v_missing := v_missing || 'bank name'; end if;
  if nullif(btrim(coalesce(v_row.branch_code, '')), '') is null then v_missing := v_missing || 'branch code'; end if;
  if v_row.account_type is null then v_missing := v_missing || 'account type'; end if;
  if v_row.account_number_ciphertext is null then v_missing := v_missing || 'account number'; end if;
  if v_row.banking_proof_storage_path is null then v_missing := v_missing || 'proof of banking'; end if;
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception 'Cannot submit — still missing: %', array_to_string(v_missing, ', ');
  end if;

  update public.payee_payment_profiles
     set verification_status = 'pending_verification',
         submitted_at        = now(),
         verified_at         = null,
         verified_by         = null,
         rejection_reason    = null
   where id = v_row.id
   returning * into v_row;
  if not found then
    raise exception 'Submit affected no rows';
  end if;

  for v_owner in select id from public.profiles where role = 'owner'::public.user_role and is_active loop
    perform public.emit_in_app_notification(
      v_owner, 'PAYEE_PROFILE_SUBMITTED', 'A payment profile needs verification',
      'A ' || (case when v_partner is not null then 'partner' else 'contractor' end)
        || ' submitted banking details for verification.',
      '/settings/payees',
      jsonb_build_object('profile_id', v_row.id));
  end loop;

  select email, role into v_email, v_role from public.profiles where id = v_uid;
  insert into public.activity_logs
    (user_id, user_email, user_role, event_type, entity_type, entity_id, description, related_entity_ids)
  values
    (v_uid, v_email, v_role, 'UPDATE'::public.activity_event_type, 'payee_payment_profile', v_row.id,
     'Payment profile submitted for verification',
     to_jsonb(array_remove(array[v_partner, case when v_partner is null then v_uid end], null)));

  return v_row.id;
end; $$;

-- ===========================================================================
-- 4. set_payee_payment_verification — OWNER-only accept / reject of a submitted
--    profile. Reason required on reject. Notifies the subject.
-- ===========================================================================
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
     to_jsonb(array_remove(array[v_row.referral_partner_id, v_row.contractor_id], null)));

  return v_row.id;
end; $$;

-- ===========================================================================
-- 5. get_my_payee_payment_profile — the caller's OWN profile, MASKED. Never
--    decrypts: returns last-4 of the account and has_* booleans only (chosen
--    "masked + re-enter to change" policy). RLS-equivalent scope is enforced by
--    the WHERE clause (this is DEFINER because table grants are revoked).
-- ===========================================================================
create or replace function public.get_my_payee_payment_profile()
returns table (
  id                    uuid,
  verification_status   public.payee_profile_verification_status,
  account_holder_name   text,
  bank_name             text,
  branch_code           text,
  account_type          public.payee_bank_account_type,
  account_last_four     text,
  has_account_number    boolean,
  has_tax_number        boolean,
  vat_status            public.payee_vat_status,
  has_vat_number        boolean,
  has_banking_proof     boolean,
  banking_proof_storage_path text,
  rejection_reason      text,
  submitted_at          timestamptz,
  verified_at           timestamptz,
  profile_version       integer,
  updated_at            timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.verification_status, p.account_holder_name, p.bank_name, p.branch_code, p.account_type,
         p.account_last_four,
         p.account_number_ciphertext is not null,
         p.tax_number_ciphertext is not null,
         p.vat_status,
         p.vat_number_ciphertext is not null,
         p.banking_proof_storage_path is not null,
         p.banking_proof_storage_path,
         p.rejection_reason, p.submitted_at, p.verified_at, p.profile_version, p.updated_at
    from public.payee_payment_profiles p
   where p.referral_partner_id = public.current_partner_id()
      or p.contractor_id = auth.uid();
$$;

-- ===========================================================================
-- 6. Owner surfaces. list_* returns a MASKED summary (no numbers); get_*_owner
--    decrypts for the verification screen. Both are owner-gated.
-- ===========================================================================
create or replace function public.list_payee_payment_profiles_owner()
returns table (
  id                  uuid,
  subject_kind        text,
  subject_name        text,
  verification_status public.payee_profile_verification_status,
  bank_name           text,
  account_last_four   text,
  submitted_at        timestamptz,
  verified_at         timestamptz,
  updated_at          timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can list payment profiles';
  end if;
  return query
    select p.id,
           case when p.contractor_id is not null then 'contractor' else 'partner' end,
           case when p.contractor_id is not null then pr.email else rp.name end,
           p.verification_status, p.bank_name, p.account_last_four, p.submitted_at, p.verified_at, p.updated_at
      from public.payee_payment_profiles p
      left join public.profiles pr on pr.id = p.contractor_id
      left join public.referral_partners rp on rp.id = p.referral_partner_id
     order by (p.verification_status = 'pending_verification') desc, p.updated_at desc;
end; $$;

create or replace function public.get_payee_payment_profile_owner(p_profile_id uuid)
returns table (
  id                  uuid,
  subject_kind        text,
  subject_name        text,
  verification_status public.payee_profile_verification_status,
  account_holder_name text,
  bank_name           text,
  branch_code         text,
  account_type        public.payee_bank_account_type,
  account_number      text,
  account_last_four   text,
  tax_number          text,
  vat_status          public.payee_vat_status,
  vat_number          text,
  banking_proof_storage_path text,
  rejection_reason    text,
  submitted_at        timestamptz,
  verified_at         timestamptz,
  verified_by         uuid,
  updated_at          timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_key text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can view payee banking details';
  end if;
  v_key := public.payee_enc_key();
  return query
    select p.id,
           case when p.contractor_id is not null then 'contractor' else 'partner' end,
           case when p.contractor_id is not null then pr.email else rp.name end,
           p.verification_status, p.account_holder_name, p.bank_name, p.branch_code, p.account_type,
           case when p.account_number_ciphertext is not null then extensions.pgp_sym_decrypt(p.account_number_ciphertext, v_key) end,
           p.account_last_four,
           case when p.tax_number_ciphertext is not null then extensions.pgp_sym_decrypt(p.tax_number_ciphertext, v_key) end,
           p.vat_status,
           case when p.vat_number_ciphertext is not null then extensions.pgp_sym_decrypt(p.vat_number_ciphertext, v_key) end,
           p.banking_proof_storage_path, p.rejection_reason, p.submitted_at, p.verified_at, p.verified_by, p.updated_at
      from public.payee_payment_profiles p
      left join public.profiles pr on pr.id = p.contractor_id
      left join public.referral_partners rp on rp.id = p.referral_partner_id
     where p.id = p_profile_id;
end; $$;

-- ===========================================================================
-- 7. Grants. Callers reach the table only through these RPCs; the key accessor
--    stays internal. Owner-only RPCs enforce is_owner() in-body.
-- ===========================================================================
revoke execute on function public.save_payee_payment_profile(text, text, text, public.payee_bank_account_type, text, text, public.payee_vat_status, text, text) from public, anon;
grant  execute on function public.save_payee_payment_profile(text, text, text, public.payee_bank_account_type, text, text, public.payee_vat_status, text, text) to authenticated;

revoke execute on function public.submit_payee_payment_profile() from public, anon;
grant  execute on function public.submit_payee_payment_profile() to authenticated;

revoke execute on function public.set_payee_payment_verification(uuid, boolean, text) from public, anon;
grant  execute on function public.set_payee_payment_verification(uuid, boolean, text) to authenticated;

revoke execute on function public.get_my_payee_payment_profile() from public, anon;
grant  execute on function public.get_my_payee_payment_profile() to authenticated;

revoke execute on function public.list_payee_payment_profiles_owner() from public, anon;
grant  execute on function public.list_payee_payment_profiles_owner() to authenticated;

revoke execute on function public.get_payee_payment_profile_owner(uuid) from public, anon;
grant  execute on function public.get_payee_payment_profile_owner(uuid) to authenticated;

-- ===========================================================================
-- 8. Private banking-proof storage bucket + uploader-scoped RLS. Path convention
--    `payee/{auth.uid()}/{uuid}/{filename}` — segment 2 is the uploader, so a
--    subject reads/writes only their own folder; the owner reads all. Bank proof
--    is the payee's own document (unlike client bank statements, which stay
--    owner-only in the `documents` bucket).
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('payee-proofs', 'payee-proofs', false)
on conflict (id) do nothing;

drop policy if exists "payee_proofs_owner_select" on storage.objects;
create policy "payee_proofs_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'payee-proofs' and public.is_owner());

drop policy if exists "payee_proofs_subject_select" on storage.objects;
create policy "payee_proofs_subject_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payee-proofs'
    and (storage.foldername(name))[1] = 'payee'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists "payee_proofs_subject_insert" on storage.objects;
create policy "payee_proofs_subject_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payee-proofs'
    and (storage.foldername(name))[1] = 'payee'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists "payee_proofs_subject_update" on storage.objects;
create policy "payee_proofs_subject_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'payee-proofs'
    and (storage.foldername(name))[1] = 'payee'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'payee-proofs'
    and (storage.foldername(name))[1] = 'payee'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists "payee_proofs_subject_delete" on storage.objects;
create policy "payee_proofs_subject_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'payee-proofs'
    and (storage.foldername(name))[1] = 'payee'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- ===========================================================================
-- 9. Notification preferences — seed the three payee events ON for every profile
--    (in-app + email). Never overwrites an existing opt-out.
-- ===========================================================================
insert into public.notification_preferences (user_id, event_type, in_app_enabled, email_enabled)
select p.id, ev.evt, true, true
  from public.profiles p
  cross join (values
    ('PAYEE_PROFILE_SUBMITTED'::public.notification_event_type),
    ('PAYEE_PROFILE_VERIFIED'::public.notification_event_type),
    ('PAYEE_PROFILE_REJECTED'::public.notification_event_type)
  ) as ev(evt)
on conflict (user_id, event_type) do nothing;

-- ===========================================================================
-- 10. Structural + crypto assertions (roll back on failure). Behavioural RPC
--     tests need an authenticated caller (auth.uid()) which a migration lacks,
--     so they run in the post-merge smoke test; here we prove the key works, the
--     ciphertext satisfies the table CHECK, and every object exists.
-- ===========================================================================
do $$
declare
  v_key text;
  v_ct  bytea;
  v_fn  text;
begin
  -- key present + round-trips + ciphertext long enough for the >= 16 CHECK
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'payee_profile_enc_key';
  if v_key is null then raise exception 'assert: payee enc key missing from Vault'; end if;
  v_ct := extensions.pgp_sym_encrypt('123456789', v_key);
  if extensions.pgp_sym_decrypt(v_ct, v_key) <> '123456789' then
    raise exception 'assert: enc/dec round-trip failed';
  end if;
  if octet_length(v_ct) < 16 then
    raise exception 'assert: ciphertext shorter than the table CHECK minimum';
  end if;

  -- all RPCs exist
  foreach v_fn in array array[
    'save_payee_payment_profile', 'submit_payee_payment_profile',
    'set_payee_payment_verification', 'get_my_payee_payment_profile',
    'list_payee_payment_profiles_owner', 'get_payee_payment_profile_owner', 'payee_enc_key'
  ] loop
    if not exists (
      select 1 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
       where n.nspname = 'public' and pr.proname = v_fn
    ) then
      raise exception 'assert: function public.% missing', v_fn;
    end if;
  end loop;

  -- the internal key accessor is NOT API-callable
  if exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'payee_enc_key'
       and grantee in ('PUBLIC', 'anon', 'authenticated') and privilege_type = 'EXECUTE'
  ) then
    raise exception 'assert: payee_enc_key is API-callable';
  end if;

  -- private bucket exists and is not public
  if not exists (select 1 from storage.buckets where id = 'payee-proofs' and public = false) then
    raise exception 'assert: private payee-proofs bucket missing';
  end if;

  -- all four subject storage policies + owner select present (5 total)
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname in (
           'payee_proofs_owner_select', 'payee_proofs_subject_select',
           'payee_proofs_subject_insert', 'payee_proofs_subject_update', 'payee_proofs_subject_delete'
         )) <> 5 then
    raise exception 'assert: payee-proofs storage policy set incomplete';
  end if;

  raise notice 'Build 3.1 payee-profile backend assertions passed';
end $$;

notify pgrst, 'reload schema';
