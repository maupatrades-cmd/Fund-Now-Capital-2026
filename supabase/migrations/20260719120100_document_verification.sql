-- B3.2 Document verification workflow — part 2 of 3: schema + logic (SPEC S6).
--
-- Adds per-document verification state, an owner-only verification RPC (with its
-- own activity-log write, since documents has no A10 trigger), a qualification
-- gate keyed on required *accepted* documents (owner-overridable), the lead->client
-- document re-pointer at qualify time, and a partner-safe LEAD_DOCUMENT_REJECTED
-- notification. The verified_by FK is added NOT VALID here; its index +
-- VALIDATE live in part 3 (CONCURRENTLY, non-transactional).

-- ===========================================================================
-- 1. Enums: verification status + partner-safe rejection reason (A9.5 pattern).
-- ===========================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'document_verification_status') then
    create type public.document_verification_status as enum ('unverified', 'accepted', 'rejected');
  end if;
  if not exists (select 1 from pg_type where typname = 'document_rejection_reason') then
    create type public.document_rejection_reason as enum
      ('illegible', 'expired', 'wrong_document', 'incomplete', 'mismatch', 'outdated_version', 'other');
  end if;
end $$;

-- ===========================================================================
-- 2. Columns on documents. verified_by/verified_at are audit-truth: they move
--    ONLY alongside a verification_status change (enforced in the immutability
--    trigger below). The CHECK ties a rejection reason to the rejected state.
--    FK is NOT VALID (populated table) — index + VALIDATE in part 3.
-- ===========================================================================
alter table public.documents
  add column if not exists verification_status public.document_verification_status not null default 'unverified',
  add column if not exists rejection_reason    public.document_rejection_reason,
  add column if not exists verification_notes  text,
  add column if not exists verified_by         uuid,
  add column if not exists verified_at         timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'documents_verified_by_fkey') then
    alter table public.documents
      add constraint documents_verified_by_fkey
      foreign key (verified_by) references public.profiles(id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_rejection_reason_scope') then
    -- A rejection reason exists IFF the document is rejected.
    alter table public.documents
      add constraint documents_rejection_reason_scope
      check ((verification_status = 'rejected') = (rejection_reason is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_lead_deal_orthogonal') then
    -- A lead-owned document is never also attached to a deal: deal attachment is
    -- only meaningful once a document is client-side (post-qualification). Sits
    -- alongside the B3.1 num_nonnulls(lead_id, client_id) = 1 XOR CHECK — together
    -- they enforce: exactly one of (lead_id, client_id), AND if lead_id is set,
    -- deal_id must be null. Existing rows all have lead_id null, so this is valid.
    alter table public.documents
      add constraint documents_lead_deal_orthogonal
      check ((lead_id is null) or (deal_id is null));
  end if;
end $$;

-- ===========================================================================
-- 3. Immutability trigger — extend the existing audit-rewrite guard so
--    verified_by / verified_at can change ONLY when verification_status also
--    changes (decision 5). Everything else in the guard is unchanged.
-- ===========================================================================
create or replace function public.documents_prevent_audit_rewrite()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_superseding boolean := coalesce(current_setting('fnc.documents_superseding', true) = 'on', false);
begin
  if new.uploaded_by is distinct from old.uploaded_by then
    raise exception 'documents.uploaded_by is immutable (audit-truth) and cannot be changed'; end if;
  if new.upload_source is distinct from old.upload_source then
    raise exception 'documents.upload_source is immutable (audit-truth) and cannot be changed'; end if;
  if new.version_number is distinct from old.version_number then
    raise exception 'documents.version_number is versioning-managed and cannot be changed directly'; end if;
  -- verified_by / verified_at are audit-truth for a verification decision: they
  -- may move only in lockstep with verification_status (set/cleared together by
  -- set_document_verification), never rewritten on their own.
  if (new.verified_by is distinct from old.verified_by or new.verified_at is distinct from old.verified_at)
     and new.verification_status is not distinct from old.verification_status then
    raise exception 'documents.verified_by / verified_at may change only alongside a verification_status change';
  end if;
  if not v_superseding then
    if new.is_current_version is distinct from old.is_current_version then
      raise exception 'documents.is_current_version is versioning-managed and cannot be changed directly'; end if;
    if new.superseded_by is distinct from old.superseded_by then
      raise exception 'documents.superseded_by is versioning-managed and cannot be changed directly'; end if;
  end if;
  return new;
end; $function$;

-- ===========================================================================
-- 4. lead_required_docs_missing() — the qualification gate rule, single source
--    of truth (called by qualify_lead AND surfaced to the UI as an RPC for the
--    disabled-button tooltip). SECURITY INVOKER so owner RLS scopes the read;
--    returns the human labels of the still-missing required categories (empty
--    array when the lead is ready to qualify).
-- ===========================================================================
create or replace function public.lead_required_docs_missing(p_lead_id uuid)
returns text[]
language sql
stable
set search_path to ''
as $$
  with acc as (
    select document_type
      from public.documents
     where lead_id = p_lead_id
       and is_current_version
       and verification_status = 'accepted'
  )
  select array_remove(array[
    case when (select count(*) from acc where document_type = 'cipc_cert')     = 0
           or (select count(*) from acc where document_type = 'tax_clearance') = 0
         then 'Business (CIPC certificate + tax clearance)' end,
    case when (select count(*) from acc where document_type = 'bank_statement') = 0
         then 'Financial (bank statement)' end,
    case when (select count(*) from acc where document_type = 'id_copy')          = 0
           or (select count(*) from acc where document_type = 'proof_of_address') = 0
         then 'Personal (ID copy + proof of address)' end
  ], null);
$$;

revoke execute on function public.lead_required_docs_missing(uuid) from public, anon;
grant  execute on function public.lead_required_docs_missing(uuid) to authenticated;

-- ===========================================================================
-- 5. set_document_verification() — the owner-only controlled path for accept /
--    reject / reset. Stamps verified_by/at ONLY on a real status change (so a
--    reason-only edit doesn't trip the immutability guard), enforces "reason
--    required on reject", and writes the verification decision to activity_logs
--    with before/after (documents has no A10 trigger).
-- ===========================================================================
create or replace function public.set_document_verification(
  p_document_id uuid,
  p_status      public.document_verification_status,
  p_reason      public.document_rejection_reason default null,
  p_notes       text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_role   text;
  v_old    public.documents;
  v_new    public.documents;
  v_by     uuid;
  v_at     timestamptz;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can verify documents';
  end if;
  if p_status = 'rejected' and p_reason is null then
    raise exception 'A rejection reason is required when rejecting a document';
  end if;

  select * into v_old from public.documents where id = p_document_id;
  if not found then
    raise exception 'Document not found';
  end if;

  -- Stamp verified_by/at only when the status actually changes; a reason/notes
  -- edit that keeps the same status keeps the original stamp (and so never trips
  -- the verified_by/at immutability guard).
  if p_status is distinct from v_old.verification_status then
    if p_status = 'unverified' then
      v_by := null; v_at := null;
    else
      v_by := v_uid; v_at := now();
    end if;
  else
    v_by := v_old.verified_by; v_at := v_old.verified_at;
  end if;

  update public.documents
     set verification_status = p_status,
         rejection_reason    = case when p_status = 'rejected' then p_reason else null end,
         verification_notes  = p_notes,
         verified_by         = v_by,
         verified_at         = v_at
   where id = p_document_id
   returning * into v_new;
  if not found then
    raise exception 'Verification update affected no rows';  -- surfaces a silent RLS/no-op loudly
  end if;

  select email, role into v_email, v_role from public.profiles where id = v_uid;
  insert into public.activity_logs
    (user_id, user_email, user_role, event_type, entity_type, entity_id, description,
     changed_fields, before_values, after_values, related_entity_ids)
  values
    (v_uid, v_email, v_role, 'UPDATE', 'document', p_document_id,
     'Document verification set to ' || p_status,
     jsonb_build_array('verification_status', 'rejection_reason', 'verification_notes', 'verified_by', 'verified_at'),
     jsonb_build_object('verification_status', v_old.verification_status, 'rejection_reason', v_old.rejection_reason,
                        'verification_notes', v_old.verification_notes, 'verified_by', v_old.verified_by,
                        'verified_at', v_old.verified_at),
     jsonb_build_object('verification_status', v_new.verification_status, 'rejection_reason', v_new.rejection_reason,
                        'verification_notes', v_new.verification_notes, 'verified_by', v_new.verified_by,
                        'verified_at', v_new.verified_at),
     to_jsonb(array_remove(array[v_new.client_id, v_new.lead_id, v_new.deal_id], null)));

  return p_document_id;
end; $$;

revoke execute on function public.set_document_verification(uuid, public.document_verification_status, public.document_rejection_reason, text) from public, anon;
grant  execute on function public.set_document_verification(uuid, public.document_verification_status, public.document_rejection_reason, text) to authenticated;

-- ===========================================================================
-- 6. log_qualification_override() — SECURITY DEFINER writer for the audit row
--    when the owner qualifies past the document gate. Internal (qualify_lead
--    only); execute revoked from all API roles.
-- ===========================================================================
create or replace function public.log_qualification_override(p_lead_id uuid, p_missing text[])
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_role  text;
begin
  select email, role into v_email, v_role from public.profiles where id = v_uid;
  insert into public.activity_logs
    (user_id, user_email, user_role, event_type, entity_type, entity_id, description, after_values)
  values
    (v_uid, v_email, v_role, 'QUALIFICATION', 'lead', p_lead_id,
     'Lead qualified with an owner override — missing required accepted document categories: '
       || array_to_string(p_missing, '; '),
     jsonb_build_object('override', true, 'missing_categories', to_jsonb(p_missing)));
end; $$;

revoke execute on function public.log_qualification_override(uuid, text[]) from public, anon, authenticated;

-- ===========================================================================
-- 7. qualify_lead(uuid, boolean) — adds the document gate + lead->client
--    document re-pointer. Drops the 1-arg version first so PostgREST resolution
--    stays unambiguous. Gate blocks by default; p_override proceeds + logs.
-- ===========================================================================
drop function if exists public.qualify_lead(uuid);

create or replace function public.qualify_lead(p_lead_id uuid, p_override boolean default false)
returns uuid
language plpgsql
as $function$
declare
  v_lead      public.leads;
  v_client_id uuid;
  v_deal_id   uuid;
  v_missing   text[];
begin
  if not public.is_owner() then
    raise exception 'Only the owner can qualify leads';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found';
  end if;

  if v_lead.qualification_stage = 'qualified' then
    select id into v_deal_id from public.deals where lead_id = p_lead_id limit 1;
    return v_deal_id;  -- idempotent
  end if;

  -- Document verification gate (B3.2). Required *accepted* current documents by
  -- category. Blocks by default; an explicit owner override proceeds and logs.
  v_missing := public.lead_required_docs_missing(p_lead_id);
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    if not p_override then
      raise exception 'Cannot qualify — missing required accepted documents: %', array_to_string(v_missing, '; ')
        using errcode = 'P0001';
    else
      perform public.log_qualification_override(p_lead_id, v_missing);
    end if;
  end if;

  select id into v_client_id
  from public.clients
  where lower(business_name) = lower(v_lead.business_name)
  limit 1;

  if v_client_id is null then
    insert into public.clients
      (business_name, cipc_number, industry_id, sub_industry_id, sector_notes,
       address, referral_partner_id, created_by)
    values
      (v_lead.business_name, v_lead.cipc_number, v_lead.industry_id, v_lead.sub_industry_id,
       v_lead.sector_notes, v_lead.physical_address, v_lead.referral_partner_id, auth.uid())
    returning id into v_client_id;

    insert into public.client_contacts
      (client_id, full_name, email, phone, position, id_number, is_primary_director)
    values
      (v_client_id, v_lead.contact_name, v_lead.contact_email, v_lead.contact_cell,
       v_lead.contact_role, v_lead.contact_id_number, true);
  end if;

  insert into public.deals
    (client_id, lead_id, referral_partner_id, stage, amount_requested,
     funding_purpose, funding_timeline, created_by)
  values
    (v_client_id, p_lead_id, v_lead.referral_partner_id, 'qualifying', v_lead.funding_amount,
     v_lead.funding_purpose, v_lead.funding_timeline, auth.uid())
  returning id into v_deal_id;

  -- Re-point the lead's documents to the new/matched client. Single UPDATE so the
  -- num_nonnulls(lead_id, client_id) = 1 CHECK holds through the swap; the
  -- physical storage bytes stay at their original leads/{id}/... path (RLS is
  -- keyed on the uploader, not the path) — a physical move is deferred (ROADMAP).
  update public.documents
     set client_id = v_client_id, lead_id = null
   where lead_id = p_lead_id;

  update public.leads set qualification_stage = 'qualified' where id = p_lead_id;

  return v_deal_id;
end;
$function$;

grant execute on function public.qualify_lead(uuid, boolean) to authenticated;

-- ===========================================================================
-- 8. LEAD_DOCUMENT_REJECTED — notify the lead's referring partner (POPIA-safe:
--    business name + document category + rejection reason CATEGORY only; never
--    the free-text notes or any contact PII). Fires only on a transition INTO
--    rejected on a lead-owned document.
-- ===========================================================================
create or replace function public.notify_lead_document_rejected()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_biz     text;
  v_refby   text;
  v_rpid    uuid;
  v_partner uuid;
  v_reason  text;
  v_cat     text;
begin
  if new.verification_status = 'rejected'
     and old.verification_status is distinct from 'rejected'
     and new.lead_id is not null then
    select l.business_name, l.referred_by, l.referral_partner_id
      into v_biz, v_refby, v_rpid
      from public.leads l where l.id = new.lead_id;

    if v_refby is distinct from 'self' and v_rpid is not null then
      v_partner := public.partner_profile_id(v_rpid);
      v_reason  := initcap(replace(coalesce(new.rejection_reason::text, 'other'), '_', ' '));
      v_cat     := initcap(replace(public.document_type_category(new.document_type)::text, '_', ' '));
      perform public.emit_in_app_notification(
        v_partner, 'LEAD_DOCUMENT_REJECTED', 'A document was rejected',
        'A document you referred on ' || v_biz || ' (' || v_cat
          || ') was rejected — reason: ' || v_reason || '. Please re-upload.',
        '/leads/' || new.lead_id::text,
        jsonb_build_object(
          'document_id',       new.id,
          'lead_id',           new.lead_id,
          'document_category', public.document_type_category(new.document_type),
          'rejection_reason',  new.rejection_reason
        ));
    end if;
  end if;
  return null;
end; $$;

drop trigger if exists documents_notify_rejected on public.documents;
create trigger documents_notify_rejected
  after update on public.documents
  for each row
  when (new.verification_status is distinct from old.verification_status)
  execute function public.notify_lead_document_rejected();

-- ===========================================================================
-- 9. Notification preferences — LEAD_DOCUMENT_REJECTED email ON by default for
--    every profile (the partner's only channel until Phase D). Seeds missing
--    rows only; never overwrites an opt-out.
-- ===========================================================================
insert into public.notification_preferences (user_id, event_type, in_app_enabled, email_enabled)
select p.id, 'LEAD_DOCUMENT_REJECTED'::public.notification_event_type, true, true
  from public.profiles p
on conflict (user_id, event_type) do nothing;

-- ===========================================================================
-- 10. In-migration assertions (roll back on failure). Uses a doc-free client +
--     a synthetic lead so real production data is never touched; cleans up all
--     synthetic rows (documents, the lead, and the lead's activity rows).
-- ===========================================================================
do $$
declare
  v_client  uuid;
  v_owner   uuid;
  v_doc     uuid;
  v_lead    uuid;
  v_missing text[];
begin
  select c.id into v_client
    from public.clients c
   where not exists (select 1 from public.documents d where d.client_id = c.id)
   limit 1;
  select id into v_owner from public.profiles where role = 'owner' limit 1;
  if v_client is null or v_owner is null then
    raise notice 'B3.2 verification assertions skipped (no doc-free client / no owner)';
    return;
  end if;

  insert into public.documents (client_id, document_type, filename, storage_path, uploaded_by, upload_source)
  values (v_client, 'tax_clearance', 'vchk.pdf', 'vchk/' || gen_random_uuid(), v_owner, 'owner')
  returning id into v_doc;

  -- (a) rejecting without a reason violates the CHECK
  begin
    update public.documents set verification_status = 'rejected' where id = v_doc;
    raise exception 'B3.2 assert FAIL: rejected-without-reason should violate the CHECK';
  exception when check_violation then null; end;

  -- (b) rejecting with a reason is allowed
  update public.documents set verification_status = 'rejected', rejection_reason = 'expired' where id = v_doc;

  -- (c) immutability: changing verified_by with no status change is blocked
  begin
    update public.documents set verified_by = v_owner where id = v_doc;  -- status stays 'rejected'
    raise exception 'B3.2 assert FAIL: verified_by change without a status change should be blocked';
  exception when others then
    if sqlerrm not like '%verified_by%' then raise; end if;
  end;

  -- (d) status change stamps verified_by and clears the reason on accept
  update public.documents
     set verification_status = 'accepted', rejection_reason = null, verified_by = v_owner, verified_at = now()
   where id = v_doc;
  if (select verified_by from public.documents where id = v_doc) is distinct from v_owner then
    raise exception 'B3.2 assert FAIL: verified_by not stamped on accept'; end if;

  -- (e) an accepted document carrying a reason violates the CHECK
  begin
    update public.documents set rejection_reason = 'expired' where id = v_doc;  -- status = accepted
    raise exception 'B3.2 assert FAIL: accepted-with-reason should violate the CHECK';
  exception when check_violation then null; end;

  delete from public.documents where id = v_doc;

  -- (f) the qualification gate helper
  insert into public.leads (business_name, contact_name, entered_by, referred_by, qualification_stage)
  values ('B3.2 assert lead', 'Assert Contact', v_owner, 'self', 'new_lead')
  returning id into v_lead;

  v_missing := public.lead_required_docs_missing(v_lead);
  if coalesce(array_length(v_missing, 1), 0) <> 3 then
    raise exception 'B3.2 assert FAIL: an empty lead should miss all 3 categories, got %', v_missing; end if;

  insert into public.documents (lead_id, document_type, filename, storage_path, uploaded_by, upload_source,
                                verification_status, verified_by, verified_at)
  values (v_lead, 'cipc_cert',     'c.pdf', 'vchk/' || gen_random_uuid(), v_owner, 'owner', 'accepted', v_owner, now()),
         (v_lead, 'tax_clearance', 't.pdf', 'vchk/' || gen_random_uuid(), v_owner, 'owner', 'accepted', v_owner, now());
  v_missing := public.lead_required_docs_missing(v_lead);
  if 'Business (CIPC certificate + tax clearance)' = any (v_missing) then
    raise exception 'B3.2 assert FAIL: Business category should be satisfied'; end if;
  if coalesce(array_length(v_missing, 1), 0) <> 2 then
    raise exception 'B3.2 assert FAIL: expected Financial + Personal still missing, got %', v_missing; end if;

  -- cleanup (documents first — lead_id FK is ON DELETE RESTRICT)
  delete from public.documents where lead_id = v_lead;
  delete from public.leads where id = v_lead;
  delete from public.activity_logs where entity_type = 'lead' and entity_id = v_lead;

  raise notice 'B3.2 verification assertions passed';
end $$;

notify pgrst, 'reload schema';
