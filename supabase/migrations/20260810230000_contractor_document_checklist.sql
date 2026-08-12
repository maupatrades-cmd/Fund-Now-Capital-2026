-- Build 31 — Contractor 17-document onboarding checklist.
--
-- ONBOARDING.md "17 Required Forms & Documents" (Stage-5 document-collection
-- gate). This build CATALOGS the 17 document TYPES and TRACKS their per-contractor
-- verification status; it is NOT the documents themselves and invents no legal
-- wording. The 17 type labels + their verbatim display names come straight from
-- ONBOARDING.md; three are CONDITIONAL (VAT registration, CIPC company
-- registration, shareholding certificate) and may be marked Not Applicable by the
-- owner so they never block activation (ONBOARDING lines 62-66).
--
-- Reconciliation (what already existed vs what this adds):
--   * Contractor identity = public.profiles(id) where role='contractor' (the same
--     auth.uid() key Build 3 / Build 8.1 use as contractor_id). No separate
--     contractors table exists; we key on profiles(id) to match.
--   * The B3 document-management taxonomy (public.document_type, 52 values +
--     public.documents) is for CLIENT/lead/deal documents — a DIFFERENT domain.
--     We do NOT extend it; contractor onboarding docs get their own enum + table.
--   * We REUSE the payee-proofs storage pattern (private, uploader-scoped RLS,
--     owner-reads-all) for the new contractor-documents bucket, and the
--     owner-verifies workflow shape from set_payee_payment_verification /
--     set_document_verification (owner-gated, RETURNING-checked, activity-logged,
--     subject-notified). Notifications default ON when no pref row exists
--     (check_notification_channel_enabled), so no in-tx enum seeding is needed.
--
-- Security: RLS on both new tables from creation; table writes are RPC-only
-- (SECURITY DEFINER); a contractor reads ONLY their own checklist; sensitive
-- files (ID, banking, tax) live in a PRIVATE owner+owning-contractor bucket.
-- Every verification/upload is written to activity_logs.

-- ===========================================================================
-- 1. Enums. Fresh CREATE TYPE (usable immediately in this same transaction,
--    unlike ALTER TYPE ADD VALUE). Type labels are snake_case codes for the 17
--    ONBOARDING documents; the human-verbatim names live in the catalog table.
-- ===========================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'contractor_document_type') then
    create type public.contractor_document_type as enum (
      -- Legal & Identity (5)
      'service_agreement',
      'nda',
      'sa_id_document',
      'proof_of_address',
      'criminal_record_clearance',
      -- Tax & Financial (4)  — vat_registration_certificate is CONDITIONAL
      'sars_provisional_taxpayer_confirmation',
      'sars_tax_reference_certificate',
      'banking_details_confirmation',
      'vat_registration_certificate',
      -- BEE & Compliance (3) — cipc + shareholding are CONDITIONAL
      'bee_affidavit_or_certificate',
      'cipc_company_registration',
      'shareholding_certificate',
      -- Contractor-Specific (5)
      'fica_declaration',
      'popia_consent',
      'emergency_contact_form',
      'payment_mandate',
      'code_of_conduct'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'contractor_document_status') then
    create type public.contractor_document_status as enum (
      'missing',        -- no file yet (ONBOARDING "pending_upload")
      'uploaded',       -- contractor uploaded, awaiting owner review
      'verified',       -- owner approved (ONBOARDING "approved")
      'rejected',       -- owner rejected with reason (needs re-upload)
      'not_applicable'  -- owner-marked N/A — only allowed for CONDITIONAL types
    );
  end if;
end $$;

comment on type public.contractor_document_type is
  'The 17 ONBOARDING.md contractor onboarding document types (Build 31). Distinct from public.document_type (client B3 taxonomy).';

-- Dedicated notification events for the owner-verifies workflow. ADD VALUE to a
-- PRE-EXISTING enum is transaction-safe on PG12+ but the new labels may NOT be
-- USED at apply time — they are referenced only inside deferred plpgsql RPC
-- bodies (parsed at first execution, after commit), never at migration time.
alter type public.notification_event_type add value if not exists 'CONTRACTOR_DOCUMENT_VERIFIED';
alter type public.notification_event_type add value if not exists 'CONTRACTOR_DOCUMENT_REJECTED';

-- ===========================================================================
-- 2. Catalog table — the definition of the checklist: one row per document type
--    with its verbatim ONBOARDING display name, group, conditional flag, and
--    sort order. Reference data (no PII): readable by every authenticated user.
-- ===========================================================================
create table if not exists public.contractor_document_type_catalog (
  document_type   public.contractor_document_type primary key,
  category        text    not null,
  display_label   text    not null,
  is_conditional  boolean not null default false,
  sort_order      integer not null,
  constraint contractor_doc_catalog_sort_unique unique (sort_order)
);

comment on table public.contractor_document_type_catalog is
  'Build 31: definition of the 17 ONBOARDING contractor documents. is_conditional=true means the owner may mark it Not Applicable (VAT / CIPC / shareholding).';

alter table public.contractor_document_type_catalog enable row level security;

drop policy if exists contractor_doc_catalog_read on public.contractor_document_type_catalog;
create policy contractor_doc_catalog_read on public.contractor_document_type_catalog
  for select to authenticated using (true);

revoke all on public.contractor_document_type_catalog from public, anon;
grant select on public.contractor_document_type_catalog to authenticated;

insert into public.contractor_document_type_catalog (document_type, category, display_label, is_conditional, sort_order) values
  ('service_agreement',                      'Legal & Identity',   'Signed Service Agreement',                              false,  1),
  ('nda',                                    'Legal & Identity',   'Signed NDA',                                            false,  2),
  ('sa_id_document',                         'Legal & Identity',   'South African ID document',                             false,  3),
  ('proof_of_address',                       'Legal & Identity',   'Proof of address',                                      false,  4),
  ('criminal_record_clearance',              'Legal & Identity',   'Criminal record clearance',                             false,  5),
  ('sars_provisional_taxpayer_confirmation', 'Tax & Financial',    'SARS provisional taxpayer registration confirmation',   false,  6),
  ('sars_tax_reference_certificate',         'Tax & Financial',    'SARS tax reference number certificate',                 false,  7),
  ('banking_details_confirmation',           'Tax & Financial',    'Banking details confirmation',                          false,  8),
  ('vat_registration_certificate',           'Tax & Financial',    'VAT registration certificate',                          true,   9),
  ('bee_affidavit_or_certificate',           'BEE & Compliance',   'BEE affidavit OR BEE certificate',                      false, 10),
  ('cipc_company_registration',              'BEE & Compliance',   'Company registration (CIPC)',                           true,  11),
  ('shareholding_certificate',               'BEE & Compliance',   'Shareholding certificate',                              true,  12),
  ('fica_declaration',                       'Contractor-Specific','Signed FICA declaration',                               false, 13),
  ('popia_consent',                          'Contractor-Specific','Signed POPIA consent',                                  false, 14),
  ('emergency_contact_form',                 'Contractor-Specific','Emergency contact form',                                false, 15),
  ('payment_mandate',                        'Contractor-Specific','Payment mandate',                                       false, 16),
  ('code_of_conduct',                        'Contractor-Specific','Signed code of conduct',                               false, 17)
on conflict (document_type) do nothing;

-- ===========================================================================
-- 3. Per-contractor checklist table — one row per (contractor, document_type).
-- ===========================================================================
create table if not exists public.contractor_documents (
  id                uuid primary key default gen_random_uuid(),
  contractor_id     uuid not null references public.profiles(id) on delete cascade,
  document_type     public.contractor_document_type not null,
  status            public.contractor_document_status not null default 'missing',
  storage_path      text,               -- path in the private contractor-documents bucket
  original_filename text,
  rejection_reason  text,
  uploaded_at       timestamptz,
  uploaded_by       uuid references public.profiles(id),
  verified_by       uuid references public.profiles(id),
  verified_at       timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint contractor_documents_one_per_type unique (contractor_id, document_type),
  -- a rejection must carry a reason (the contractor sees it on their portal)
  constraint contractor_documents_rejected_has_reason
    check (status <> 'rejected' or nullif(btrim(rejection_reason), '') is not null),
  -- verified rows must record who/when
  constraint contractor_documents_verified_has_actor
    check (status <> 'verified' or (verified_by is not null and verified_at is not null))
);

comment on table public.contractor_documents is
  'Build 31: per-contractor status of each of the 17 ONBOARDING onboarding documents. Writes are RPC-only; a contractor reads only their own rows.';

-- Composite (contractor_id, status) also serves single-column contractor_id
-- lookups (leftmost prefix), so no standalone contractor_id index is needed (Gitar).
create index if not exists contractor_documents_status_idx
  on public.contractor_documents (contractor_id, status);

alter table public.contractor_documents enable row level security;

-- Owner: full access. Contractor: read-only OWN rows. No write policies — all
-- writes go through the SECURITY DEFINER RPCs below (RLS-silent-failure rule).
drop policy if exists contractor_documents_owner_all on public.contractor_documents;
create policy contractor_documents_owner_all on public.contractor_documents
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists contractor_documents_self_select on public.contractor_documents;
create policy contractor_documents_self_select on public.contractor_documents
  for select to authenticated using (contractor_id = (select auth.uid()));

revoke all on public.contractor_documents from public, anon;
grant select on public.contractor_documents to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers: touch updated_at, and enforce that Not Applicable is reserved for
-- CONDITIONAL document types (the gate depends on this being structural, not
-- just RPC-enforced).
-- ---------------------------------------------------------------------------
create or replace function public.contractor_documents_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists contractor_documents_touch_updated_at on public.contractor_documents;
create trigger contractor_documents_touch_updated_at
  before update on public.contractor_documents
  for each row execute function public.contractor_documents_touch_updated_at();

create or replace function public.contractor_documents_na_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_conditional boolean;
begin
  if new.status = 'not_applicable' then
    select is_conditional into v_conditional
      from public.contractor_document_type_catalog
     where document_type = new.document_type;
    if not coalesce(v_conditional, false) then
      raise exception 'Document type % is required and cannot be marked Not Applicable', new.document_type;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists contractor_documents_na_guard on public.contractor_documents;
create trigger contractor_documents_na_guard
  before insert or update on public.contractor_documents
  for each row execute function public.contractor_documents_na_guard();

-- ===========================================================================
-- 4. ensure_contractor_document_checklist — materialise the 17 rows (status
--    'missing') for a contractor. Owner-only; idempotent. Called when a
--    contractor enters document collection (and used by the backfill below).
-- ===========================================================================
create or replace function public.ensure_contractor_document_checklist(p_contractor_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_added integer;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can initialise a contractor document checklist';
  end if;
  if not exists (select 1 from public.profiles where id = p_contractor_id and role = 'contractor') then
    raise exception 'Target is not a contractor';
  end if;

  insert into public.contractor_documents (contractor_id, document_type, status)
  select p_contractor_id, c.document_type, 'missing'
    from public.contractor_document_type_catalog c
  on conflict (contractor_id, document_type) do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end; $$;

-- ===========================================================================
-- 5. get_contractor_document_checklist — the full 17-row checklist for a
--    contractor, joined to the catalog (verbatim label + group + conditional).
--    Owner sees any contractor; a contractor sees ONLY themselves. Rows not yet
--    materialised surface as 'missing' via the LEFT JOIN.
-- ===========================================================================
create or replace function public.get_contractor_document_checklist(p_contractor_id uuid)
returns table (
  document_type    public.contractor_document_type,
  category         text,
  display_label    text,
  is_conditional   boolean,
  sort_order       integer,
  status           public.contractor_document_status,
  storage_path     text,
  original_filename text,
  rejection_reason text,
  uploaded_at      timestamptz,
  verified_at      timestamptz,
  updated_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_owner() or p_contractor_id = auth.uid()) then
    raise exception 'Not authorised to view this contractor document checklist';
  end if;

  return query
    select c.document_type, c.category, c.display_label, c.is_conditional, c.sort_order,
           coalesce(d.status, 'missing'::public.contractor_document_status),
           d.storage_path, d.original_filename, d.rejection_reason,
           d.uploaded_at, d.verified_at, d.updated_at
      from public.contractor_document_type_catalog c
      left join public.contractor_documents d
        on d.contractor_id = p_contractor_id and d.document_type = c.document_type
     order by c.sort_order;
end; $$;

-- ===========================================================================
-- 6. contractor_upload_document — the CALLER (a contractor) records that they
--    uploaded a file for one of their document types. Sets status 'uploaded'.
--    An already-verified document is immutable (ONBOARDING line 119): the owner
--    must reject it first. Path must live under the caller's own bucket folder.
-- ===========================================================================
create or replace function public.contractor_upload_document(
  p_document_type     public.contractor_document_type,
  p_storage_path      text,
  p_original_filename text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_active boolean;
  v_id     uuid;
  v_email  text;
  v_role   text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select is_active, role into v_active, v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'contractor' then
    raise exception 'Only a contractor can upload their onboarding documents';
  end if;
  if not coalesce(v_active, false) then
    raise exception 'Your account is not active';
  end if;

  if nullif(btrim(coalesce(p_storage_path, '')), '') is null then
    raise exception 'A storage path is required';
  end if;
  -- path convention: contractor/{auth.uid()}/{document_type}/{filename}
  if p_storage_path not like 'contractor/' || v_uid::text || '/%' then
    raise exception 'Upload path must be under your own folder';
  end if;

  insert into public.contractor_documents
    (contractor_id, document_type, status, storage_path, original_filename, uploaded_at, uploaded_by,
     rejection_reason, verified_by, verified_at)
  values
    (v_uid, p_document_type, 'uploaded', p_storage_path, p_original_filename, now(), v_uid,
     null, null, null)
  on conflict (contractor_id, document_type) do update
    set status            = 'uploaded',
        storage_path      = excluded.storage_path,
        original_filename = excluded.original_filename,
        uploaded_at       = now(),
        uploaded_by       = v_uid,
        rejection_reason  = null,
        verified_by       = null,
        verified_at       = null
    where public.contractor_documents.status not in ('verified', 'not_applicable')
  returning id into v_id;

  if v_id is null then
    raise exception 'This document is already verified or marked Not Applicable by the owner and cannot be replaced — ask the owner to reject/reset it first';
  end if;

  select email into v_email from public.profiles where id = v_uid;
  insert into public.activity_logs
    (user_id, user_email, user_role, event_type, entity_type, entity_id, description, after_values, related_entity_ids)
  values
    (v_uid, v_email, v_role, 'UPDATE'::public.activity_event_type, 'contractor_document', v_id,
     'Contractor onboarding document uploaded',
     jsonb_build_object('document_type', p_document_type, 'status', 'uploaded'),
     to_jsonb(array[v_uid]));

  return v_id;
end; $$;

-- ===========================================================================
-- 7. set_contractor_document_verification — OWNER-only. p_action is one of
--    'verified' | 'rejected' | 'not_applicable'. Reason required on reject;
--    Not Applicable allowed only for conditional types (trigger backstops).
--    Creates the row if it does not exist yet. Notifies the contractor.
-- ===========================================================================
create or replace function public.set_contractor_document_verification(
  p_contractor_id uuid,
  p_document_type public.contractor_document_type,
  p_action        text,
  p_reason        text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_status public.contractor_document_status;
  v_label  text;
  v_email  text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can verify contractor documents';
  end if;
  if not exists (select 1 from public.profiles where id = p_contractor_id and role = 'contractor') then
    raise exception 'Target is not a contractor';
  end if;

  if p_action not in ('verified', 'rejected', 'not_applicable') then
    raise exception 'Invalid action % (expected verified / rejected / not_applicable)', p_action;
  end if;
  if p_action = 'rejected' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A rejection reason is required';
  end if;
  if p_action = 'not_applicable'
     and not exists (select 1 from public.contractor_document_type_catalog
                      where document_type = p_document_type and is_conditional) then
    raise exception 'Only conditional documents (VAT / CIPC / shareholding) may be marked Not Applicable';
  end if;

  v_status := p_action::public.contractor_document_status;

  insert into public.contractor_documents
    (contractor_id, document_type, status, rejection_reason, verified_by, verified_at)
  values
    (p_contractor_id, p_document_type, v_status,
     case when p_action = 'rejected' then btrim(p_reason) end,
     case when p_action = 'verified' then v_uid end,
     case when p_action = 'verified' then now() end)
  on conflict (contractor_id, document_type) do update
    set status           = v_status,
        rejection_reason = case when p_action = 'rejected' then btrim(p_reason) end,
        verified_by      = case when p_action = 'verified' then v_uid end,
        verified_at      = case when p_action = 'verified' then now() end
  returning id into v_id;

  if v_id is null then
    raise exception 'Verification affected no rows';
  end if;

  select display_label into v_label from public.contractor_document_type_catalog where document_type = p_document_type;
  select email into v_email from public.profiles where id = v_uid;

  insert into public.activity_logs
    (user_id, user_email, user_role, event_type, entity_type, entity_id, description, after_values, related_entity_ids)
  values
    (v_uid, v_email, 'owner', 'UPDATE'::public.activity_event_type, 'contractor_document', v_id,
     'Contractor document ' || v_status::text || ': ' || coalesce(v_label, p_document_type::text),
     jsonb_build_object('document_type', p_document_type, 'status', v_status, 'rejection_reason',
                        case when p_action = 'rejected' then btrim(p_reason) end),
     to_jsonb(array[p_contractor_id]));

  -- Notify the contractor (only on verified/rejected — the two dedicated events).
  if p_action = 'verified' then
    perform public.emit_in_app_notification(
      p_contractor_id, 'CONTRACTOR_DOCUMENT_VERIFIED', 'A document was verified',
      'Your "' || coalesce(v_label, p_document_type::text) || '" has been verified.',
      '/onboarding/documents', jsonb_build_object('document_type', p_document_type));
  elsif p_action = 'rejected' then
    perform public.emit_in_app_notification(
      p_contractor_id, 'CONTRACTOR_DOCUMENT_REJECTED', 'A document needs attention',
      'Your "' || coalesce(v_label, p_document_type::text) || '" was not accepted: ' || btrim(p_reason)
        || '. Please re-upload.',
      '/onboarding/documents', jsonb_build_object('document_type', p_document_type));
  end if;

  return v_id;
end; $$;

-- ===========================================================================
-- 8. Completeness / gate helpers (Build 32 consumes these; Build 31 only exposes
--    them). COMPLETE = every APPLICABLE required document is 'verified'. A
--    document is "applicable" unless it is marked Not Applicable (allowed only
--    for the three conditional types). Computed against the catalog LEFT JOIN so
--    an un-materialised type correctly reads as 'missing'.
-- ===========================================================================
create or replace function public.contractor_document_checklist_status(p_contractor_id uuid)
returns table (
  total_documents     integer,
  verified_count      integer,
  not_applicable_count integer,
  uploaded_count      integer,
  rejected_count      integer,
  missing_count       integer,
  applicable_required integer,
  is_complete         boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_owner() or p_contractor_id = auth.uid()) then
    raise exception 'Not authorised to view this contractor checklist status';
  end if;

  return query
    with eff as (
      select c.document_type,
             coalesce(d.status, 'missing'::public.contractor_document_status) as status
        from public.contractor_document_type_catalog c
        left join public.contractor_documents d
          on d.contractor_id = p_contractor_id and d.document_type = c.document_type
    )
    select count(*)::int,
           count(*) filter (where status = 'verified')::int,
           count(*) filter (where status = 'not_applicable')::int,
           count(*) filter (where status = 'uploaded')::int,
           count(*) filter (where status = 'rejected')::int,
           count(*) filter (where status = 'missing')::int,
           count(*) filter (where status <> 'not_applicable')::int,
           -- complete when NO applicable document is left in a non-verified state
           not exists (select 1 from eff where status not in ('verified', 'not_applicable'))
      from eff;
end; $$;

-- Thin boolean the activation gate (Build 32) reads directly.
create or replace function public.contractor_checklist_is_complete(p_contractor_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_complete boolean;
begin
  if not (public.is_owner() or p_contractor_id = auth.uid()) then
    raise exception 'Not authorised';
  end if;
  select is_complete into v_complete
    from public.contractor_document_checklist_status(p_contractor_id);
  return coalesce(v_complete, false);
end; $$;

-- ===========================================================================
-- 9. Grants — least privilege. Contractor self-scoped + owner-gated RPCs to
--    authenticated; nothing to public/anon. Owner-only RPCs enforce is_owner()
--    in-body (defence in depth alongside the grant).
-- ===========================================================================
revoke execute on function public.ensure_contractor_document_checklist(uuid) from public, anon;
grant  execute on function public.ensure_contractor_document_checklist(uuid) to authenticated;

revoke execute on function public.get_contractor_document_checklist(uuid) from public, anon;
grant  execute on function public.get_contractor_document_checklist(uuid) to authenticated;

revoke execute on function public.contractor_upload_document(public.contractor_document_type, text, text) from public, anon;
grant  execute on function public.contractor_upload_document(public.contractor_document_type, text, text) to authenticated;

revoke execute on function public.set_contractor_document_verification(uuid, public.contractor_document_type, text, text) from public, anon;
grant  execute on function public.set_contractor_document_verification(uuid, public.contractor_document_type, text, text) to authenticated;

revoke execute on function public.contractor_document_checklist_status(uuid) from public, anon;
grant  execute on function public.contractor_document_checklist_status(uuid) to authenticated;

revoke execute on function public.contractor_checklist_is_complete(uuid) from public, anon;
grant  execute on function public.contractor_checklist_is_complete(uuid) to authenticated;

-- ===========================================================================
-- 10. Private storage bucket for the sensitive files (ID, banking, tax, etc.).
--     Path convention: contractor/{auth.uid()}/{document_type}/{filename} — so
--     folder segment 2 is the owning contractor. Mirrors the payee-proofs
--     uploader-scoped RLS: the owner reads all; a contractor reads/writes ONLY
--     their own folder. Access to these files is limited to owner + owning
--     contractor; uploads/verifications are activity-logged (POPIA).
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('contractor-documents', 'contractor-documents', false)
on conflict (id) do nothing;

-- Owner: FULL control incl. delete — POPIA erasure/right-to-be-forgotten (Gitar).
drop policy if exists contractor_documents_bucket_owner_select on storage.objects;
drop policy if exists contractor_documents_bucket_owner_all on storage.objects;
create policy contractor_documents_bucket_owner_all on storage.objects
  for all to authenticated
  using (bucket_id = 'contractor-documents' and public.is_owner())
  with check (bucket_id = 'contractor-documents' and public.is_owner());

drop policy if exists contractor_documents_bucket_self_select on storage.objects;
create policy contractor_documents_bucket_self_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contractor-documents'
    and (storage.foldername(name))[1] = 'contractor'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists contractor_documents_bucket_self_insert on storage.objects;
create policy contractor_documents_bucket_self_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'contractor-documents'
    and (storage.foldername(name))[1] = 'contractor'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- Contractor may replace/delete their OWN file ONLY while it is not yet verified
-- (Gitar): once the owner has verified a file, it is immutable to the contractor
-- so it can never be swapped or deleted out from under the owner's approval,
-- leaving an orphaned DB row. Non-verified files stay freely re-uploadable.
drop policy if exists contractor_documents_bucket_self_update on storage.objects;
create policy contractor_documents_bucket_self_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'contractor-documents'
    and (storage.foldername(name))[1] = 'contractor'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and not exists (select 1 from public.contractor_documents cd
                     where cd.storage_path = name and cd.status = 'verified')
  )
  with check (
    bucket_id = 'contractor-documents'
    and (storage.foldername(name))[1] = 'contractor'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists contractor_documents_bucket_self_delete on storage.objects;
create policy contractor_documents_bucket_self_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'contractor-documents'
    and (storage.foldername(name))[1] = 'contractor'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and not exists (select 1 from public.contractor_documents cd
                     where cd.storage_path = name and cd.status = 'verified')
  );

-- ===========================================================================
-- 11. Backfill: materialise the 17-row checklist for every existing contractor
--     (status 'missing'). Idempotent — inserts only the rows that are absent.
-- ===========================================================================
insert into public.contractor_documents (contractor_id, document_type, status)
select p.id, c.document_type, 'missing'
  from public.profiles p
  cross join public.contractor_document_type_catalog c
 where p.role = 'contractor'
on conflict (contractor_id, document_type) do nothing;

-- ===========================================================================
-- 12. Assertions (roll back on failure). Structural (enum/table/RPC/RLS/bucket/
--     grant matrix) always; a behavioural block exercises the complete/incomplete
--     gate against a real contractor's rows and rolls those changes back with the
--     ROLLBACK_TEST_DATA sentinel (Build 10 precedent). If no contractor exists
--     the behavioural block is skipped with a notice.
-- ===========================================================================
do $$
declare
  v_labels    text[];
  v_fn        text;
  v_contractor uuid;
  v_owner     uuid;
  v_complete  boolean;
begin
  -- (a) document-type enum: exactly the 17 ONBOARDING labels.
  select array_agg(enumlabel order by enumsortorder) into v_labels
    from pg_enum where enumtypid = 'public.contractor_document_type'::regtype;
  if array_length(v_labels, 1) <> 17 then
    raise exception 'assert FAIL: contractor_document_type has % values, expected 17', array_length(v_labels, 1);
  end if;

  -- (b) status enum: the 5 values.
  if (select array_agg(enumlabel order by enumsortorder) from pg_enum
        where enumtypid = 'public.contractor_document_status'::regtype)
     is distinct from array['missing','uploaded','verified','rejected','not_applicable'] then
    raise exception 'assert FAIL: contractor_document_status enum values wrong';
  end if;

  -- (c) catalog has 17 rows and exactly 3 conditional (VAT / CIPC / shareholding).
  if (select count(*) from public.contractor_document_type_catalog) <> 17 then
    raise exception 'assert FAIL: catalog does not have 17 rows';
  end if;
  if (select count(*) from public.contractor_document_type_catalog where is_conditional) <> 3 then
    raise exception 'assert FAIL: expected exactly 3 conditional documents';
  end if;
  if not exists (select 1 from public.contractor_document_type_catalog
                  where is_conditional
                    and document_type in ('vat_registration_certificate','cipc_company_registration','shareholding_certificate')
                  having count(*) = 3) then
    raise exception 'assert FAIL: conditional set is not exactly VAT/CIPC/shareholding';
  end if;

  -- (d) tables + RLS enabled.
  if to_regclass('public.contractor_documents') is null then raise exception 'assert FAIL: contractor_documents missing'; end if;
  if to_regclass('public.contractor_document_type_catalog') is null then raise exception 'assert FAIL: catalog missing'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.contractor_documents'::regclass) then
    raise exception 'assert FAIL: RLS not enabled on contractor_documents';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.contractor_document_type_catalog'::regclass) then
    raise exception 'assert FAIL: RLS not enabled on catalog';
  end if;

  -- (e) RLS policies present (owner all + self select on the data table).
  if not exists (select 1 from pg_policies where tablename='contractor_documents' and policyname='contractor_documents_owner_all') then
    raise exception 'assert FAIL: owner policy missing'; end if;
  if not exists (select 1 from pg_policies where tablename='contractor_documents' and policyname='contractor_documents_self_select') then
    raise exception 'assert FAIL: contractor self-select policy missing'; end if;

  -- (f) all six RPCs exist.
  foreach v_fn in array array[
    'ensure_contractor_document_checklist','get_contractor_document_checklist','contractor_upload_document',
    'set_contractor_document_verification','contractor_document_checklist_status','contractor_checklist_is_complete'
  ] loop
    if not exists (select 1 from pg_proc pr join pg_namespace n on n.oid=pr.pronamespace
                    where n.nspname='public' and pr.proname=v_fn) then
      raise exception 'assert FAIL: function public.% missing', v_fn;
    end if;
  end loop;

  -- (g) grant matrix: authenticated can SELECT (RLS-scoped) but NOT write the
  --     data table directly; anon can do nothing; RPCs execute to authenticated.
  if has_table_privilege('authenticated','public.contractor_documents','insert')
     or has_table_privilege('authenticated','public.contractor_documents','update')
     or has_table_privilege('authenticated','public.contractor_documents','delete') then
    raise exception 'assert FAIL: authenticated can write contractor_documents directly (must be RPC-only)';
  end if;
  if has_table_privilege('anon','public.contractor_documents','select') then
    raise exception 'assert FAIL: anon can SELECT contractor_documents';
  end if;
  if not has_function_privilege('authenticated','public.set_contractor_document_verification(uuid,public.contractor_document_type,text,text)','execute') then
    raise exception 'assert FAIL: authenticated cannot execute the verification RPC';
  end if;
  if has_function_privilege('anon','public.contractor_checklist_is_complete(uuid)','execute') then
    raise exception 'assert FAIL: anon can execute the gate RPC';
  end if;

  -- (h) private bucket + its five storage policies present.
  if not exists (select 1 from storage.buckets where id='contractor-documents' and public=false) then
    raise exception 'assert FAIL: private contractor-documents bucket missing';
  end if;
  if (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
        and policyname in (
          'contractor_documents_bucket_owner_all','contractor_documents_bucket_self_select',
          'contractor_documents_bucket_self_insert','contractor_documents_bucket_self_update',
          'contractor_documents_bucket_self_delete')) <> 5 then
    raise exception 'assert FAIL: contractor-documents storage policy set incomplete';
  end if;

  -- ---- Behavioural gate test (synthetic statuses on a real contractor's
  --      backfilled rows, rolled back). Proves Not-Applicable is excluded from
  --      the requirement and that a missing/rejected applicable doc blocks. ----
  select id into v_owner      from public.profiles where role='owner' limit 1;
  select id into v_contractor from public.profiles where role='contractor' limit 1;

  if v_contractor is null or v_owner is null then
    raise notice 'Build 31: no contractor/owner profile — behavioural gate test skipped (structural asserts passed).';
  else
    begin
      -- Verify every NON-conditional doc; mark the 3 conditional docs N/A.
      update public.contractor_documents d
         set status='verified', verified_by=v_owner, verified_at=now(), rejection_reason=null
       where d.contractor_id=v_contractor
         and d.document_type in (select document_type from public.contractor_document_type_catalog where not is_conditional);
      update public.contractor_documents d
         set status='not_applicable', verified_by=null, verified_at=null, rejection_reason=null
       where d.contractor_id=v_contractor
         and d.document_type in (select document_type from public.contractor_document_type_catalog where is_conditional);

      select public.contractor_checklist_is_complete(v_contractor) into v_complete;
      if v_complete is not true then
        raise exception 'Build 31 assert FAIL: all-applicable-verified (3 N/A) should be COMPLETE, got %', v_complete;
      end if;

      -- A conditional doc verified instead of N/A is still complete.
      update public.contractor_documents d set status='verified', verified_by=v_owner, verified_at=now()
       where d.contractor_id=v_contractor and d.document_type='vat_registration_certificate';
      select public.contractor_checklist_is_complete(v_contractor) into v_complete;
      if v_complete is not true then
        raise exception 'Build 31 assert FAIL: conditional verified should remain COMPLETE';
      end if;

      -- Knock one required doc back to missing -> INCOMPLETE.
      update public.contractor_documents d set status='missing', verified_by=null, verified_at=null
       where d.contractor_id=v_contractor and d.document_type='service_agreement';
      select public.contractor_checklist_is_complete(v_contractor) into v_complete;
      if v_complete is not false then
        raise exception 'Build 31 assert FAIL: a missing required doc must be INCOMPLETE, got %', v_complete;
      end if;

      -- The NA guard rejects Not Applicable on a non-conditional type.
      begin
        update public.contractor_documents d set status='not_applicable'
         where d.contractor_id=v_contractor and d.document_type='service_agreement';
        raise exception 'Build 31 assert FAIL: NA allowed on a required (non-conditional) document';
      exception when others then
        if sqlerrm not ilike '%cannot be marked Not Applicable%' then raise; end if;
      end;

      raise notice 'Build 31 behavioural gate assertions passed (complete / incomplete / N/A-excluded / NA-guard).';
      raise exception 'ROLLBACK_TEST_DATA';
    exception when others then
      if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
    end;
  end if;

  raise notice 'Build 31 assertions passed: enum(17) + status(5) + catalog(3 conditional) + tables + RLS + 6 RPCs + grants + bucket.';
end $$;

notify pgrst, 'reload schema';
