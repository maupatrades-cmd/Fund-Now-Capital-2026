-- Sales Coordinator uploads client documents (owner, 19 Nov 2026), 2/2.
--
-- OWNER DECISION (19 Nov 2026, "she must upload statements"): the Sales Coordinator may upload and open client documents
-- for any lead or client, INCLUDING bank statements and the other financial documents. This narrows CLAUDE.md security
-- rule 7 from "owner-only" to "owner + Sales Coordinator". Partners, agents, sub-agents and clients are unchanged: none
-- of their policies is touched, and partners still never see bank statements.
--
-- What the Sales Coordinator gets (enabled staff access, role coordinator; staff_role_of() is NULL-safe):
--   * upload: storage INSERT on bucket 'documents' under leads/<uuid>/<uuid>/... or clients/<uuid>/<uuid>/..., then
--     coordinator_add_document registers the row (uploaded_by = her, upload_source = 'staff', audit-truth and
--     immutable as for every document). Every document type is allowed.
--   * list: coordinator_list_documents (lead or client; a lead also shows the documents of a client it became).
--   * open: coordinator_open_document issues a 2-minute ticket for that one file and LOGS the view/download in the staff
--     history (every document, bank statements included); the storage SELECT policy honours only a live ticket.
--   * cleanup: she may remove a file she uploaded only while no document row points at it (a failed registration).
-- She cannot delete documents, change them, or set verification: documents_owner_all and set_document_verification stay
-- owner-only. When the lead is in the submission intake, the upload also records the intake document receipt
-- (received via secure upload, linked to the stored document), so the Document tracker shows it as received.

-- 1. Who may handle client documents ------------------------------------------------------------------------------------
create or replace function public.coordinator_handles_documents()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.staff_role_of() = 'coordinator', false);
$$;
revoke all on function public.coordinator_handles_documents() from public, anon, authenticated;
grant execute on function public.coordinator_handles_documents() to authenticated;

-- 2. Open tickets (server-only) ----------------------------------------------------------------------------------------
create table if not exists public.document_access_tickets (
  id           bigint generated always as identity primary key,
  user_id      uuid not null,
  storage_path text not null,
  purpose      text not null check (purpose in ('view', 'download')),
  expires_at   timestamptz not null
);
create index if not exists document_access_tickets_lookup_idx on public.document_access_tickets (user_id, storage_path);
alter table public.document_access_tickets enable row level security;
revoke all on table public.document_access_tickets from public, anon, authenticated;

create or replace function public.document_has_ticket(p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.document_access_tickets t
                  where t.user_id = (select auth.uid()) and t.storage_path = p_name and t.expires_at > now());
$$;
revoke all on function public.document_has_ticket(text) from public, anon;
grant execute on function public.document_has_ticket(text) to authenticated;

-- A stored file that no document row points at (an upload whose registration failed).
create or replace function public.document_object_unregistered(p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.documents d where d.storage_path = p_name);
$$;
revoke all on function public.document_object_unregistered(text) from public, anon;
grant execute on function public.document_object_unregistered(text) to authenticated;

-- 3. Storage policies (new; every existing policy is left exactly as it is) ----------------------------------------------
drop policy if exists documents_bucket_coordinator_insert on storage.objects;
create policy documents_bucket_coordinator_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.coordinator_handles_documents()
              and (storage.foldername(name))[1] in ('leads', 'clients')
              and (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              and (storage.foldername(name))[3] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

drop policy if exists documents_bucket_ticket_select on storage.objects;
create policy documents_bucket_ticket_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.document_has_ticket(name));

drop policy if exists documents_bucket_coordinator_cleanup on storage.objects;
create policy documents_bucket_coordinator_cleanup on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.coordinator_handles_documents()
         and owner_id = ((select auth.uid()))::text and public.document_object_unregistered(name));

-- 4. Register an uploaded file -----------------------------------------------------------------------------------------
create or replace function public.coordinator_add_document(
  p_document_id uuid, p_kind text, p_entity_id uuid, p_filename text, p_storage_path text,
  p_document_type public.document_type, p_file_size_bytes bigint, p_mime_type text,
  p_period_start date default null, p_period_end date default null, p_notes text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_partner uuid;
  v_intake public.submission_intakes;
  v_name text := nullif(btrim(coalesce(p_filename, '')), '');
begin
  if not public.coordinator_handles_documents() then
    raise exception 'Only the Sales Coordinator uploads client documents here' using errcode = '42501';
  end if;
  if p_kind not in ('lead', 'client') then raise exception 'Choose a lead or a client'; end if;
  if p_document_id is null or p_entity_id is null then raise exception 'The document and its lead or client are required'; end if;
  if v_name is null or length(v_name) > 255 then raise exception 'The file needs a name (up to 255 characters)'; end if;
  if p_mime_type is null or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'Only PDF, JPG and PNG files can be uploaded';
  end if;
  if p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > 20 * 1024 * 1024 then
    raise exception 'A file must be larger than 0 and at most 20 MB';
  end if;
  if public.document_type_is_period_scoped(p_document_type) then
    if p_period_start is null or p_period_end is null then
      raise exception 'Say which month or period this document covers';
    end if;
  end if;
  if p_period_start is not null and p_period_end is not null and p_period_end < p_period_start then
    raise exception 'The period must end on or after it starts';
  end if;
  if p_notes is not null and length(p_notes) > 1000 then raise exception 'Keep the note under 1000 characters'; end if;
  if p_storage_path is distinct from p_kind || 's/' || p_entity_id::text || '/' || p_document_id::text || '/'
                                    || split_part(p_storage_path, '/', 4)
     or split_part(p_storage_path, '/', 4) = '' then
    raise exception 'The stored file is not where this document belongs';
  end if;
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'documents' and o.name = p_storage_path and o.owner_id = v_uid::text) then
    raise exception 'Upload the file first';
  end if;

  if p_kind = 'lead' then
    select l.referral_partner_id into v_partner from public.leads l where l.id = p_entity_id;
    if not found then raise exception 'Lead not found'; end if;
  else
    select c.referral_partner_id into v_partner from public.clients c where c.id = p_entity_id;
    if not found then raise exception 'Client not found'; end if;
  end if;

  insert into public.documents (id, client_id, lead_id, referral_partner_id, filename, storage_path, document_type,
                                upload_source, file_size_bytes, mime_type, uploaded_by, period_start, period_end, notes)
  values (p_document_id, case when p_kind = 'client' then p_entity_id end, case when p_kind = 'lead' then p_entity_id end,
          v_partner, v_name, p_storage_path, p_document_type, 'staff', p_file_size_bytes, p_mime_type, v_uid,
          p_period_start, p_period_end, nullif(btrim(coalesce(p_notes, '')), ''));

  -- The intake receipt (the Document tracker) when the lead is a live submission.
  if p_kind = 'lead' then
    select * into v_intake from public.submission_intakes si where si.lead_id = p_entity_id;
    if found and v_intake.archived_at is null then
      insert into public.intake_document_receipts
        (lead_id, document_type, received_via, file_label, original_filename, document_id, received_by, received_by_role)
      values (p_entity_id, p_document_type, 'secure_upload', left(v_name, 200), left(v_name, 255), p_document_id, v_uid,
              'coordinator');
    end if;
  end if;

  perform public.staff_audit_write('document', p_document_id, 'document_uploaded', null,
    jsonb_build_object('kind', p_kind, 'entity_id', p_entity_id, 'document_type', p_document_type,
                       'period_start', p_period_start, 'period_end', p_period_end));
  return p_document_id;
end;
$$;
revoke all on function public.coordinator_add_document(uuid, text, uuid, text, text, public.document_type, bigint, text, date, date, text) from public, anon;
grant execute on function public.coordinator_add_document(uuid, text, uuid, text, text, public.document_type, bigint, text, date, date, text) to authenticated;

-- 5. List a lead's or client's documents (a lead also shows the documents of a client it became through a deal) -------
create or replace function public.coordinator_list_documents(p_kind text, p_entity_id uuid)
returns table (id uuid, client_id uuid, lead_id uuid, filename text, document_type public.document_type,
               category public.document_category, upload_source public.document_upload_source, period_start date,
               period_end date, expiry_date date, version_number integer, is_current_version boolean,
               status public.document_status, verification_status public.document_verification_status,
               mime_type text, file_size_bytes bigint, uploaded_by_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.coordinator_handles_documents() then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  if p_kind not in ('lead', 'client') or p_entity_id is null then raise exception 'Choose a lead or a client'; end if;
  return query
    select d.id, d.client_id, d.lead_id, d.filename, d.document_type, d.category, d.upload_source, d.period_start,
           d.period_end, d.expiry_date, d.version_number, d.is_current_version, d.status, d.verification_status,
           d.mime_type, d.file_size_bytes::bigint, coalesce(nullif(btrim(p.full_name), ''), p.email), d.created_at
      from public.documents d
      left join public.profiles p on p.id = d.uploaded_by
     where (p_kind = 'lead' and (d.lead_id = p_entity_id
                                 or d.client_id in (select dl.client_id from public.deals dl where dl.lead_id = p_entity_id)))
        or (p_kind = 'client' and d.client_id = p_entity_id)
     order by d.document_type, d.period_start desc nulls last, d.version_number desc;
end;
$$;
revoke all on function public.coordinator_list_documents(text, uuid) from public, anon;
grant execute on function public.coordinator_list_documents(text, uuid) to authenticated;

-- 6. Open (view / download): ticket + log. Every open is written to the staff history. ---------------------------------
create or replace function public.coordinator_open_document(p_document_id uuid, p_purpose text)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_doc public.documents;
begin
  if not public.coordinator_handles_documents() then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  if p_purpose not in ('view', 'download') then raise exception 'Say whether to view or download'; end if;
  select * into v_doc from public.documents d where d.id = p_document_id;
  if not found then raise exception 'Document not found'; end if;
  delete from public.document_access_tickets where expires_at < now() - interval '1 day';
  insert into public.document_access_tickets (user_id, storage_path, purpose, expires_at)
  values ((select auth.uid()), v_doc.storage_path, p_purpose, now() + interval '2 minutes');
  perform public.staff_audit_write('document', p_document_id,
    case when p_purpose = 'view' then 'document_viewed' else 'document_downloaded' end, null,
    jsonb_build_object('document_type', v_doc.document_type, 'lead_id', v_doc.lead_id, 'client_id', v_doc.client_id,
                       'financial', v_doc.document_type in ('bank_statement', 'mgmt_accounts', 'debtors_ageing',
                         'creditors_ageing', 'financial_statements', 'personal_financials', 'source_of_funds')));
  return v_doc.storage_path;
end;
$$;
revoke all on function public.coordinator_open_document(uuid, text) from public, anon;
grant execute on function public.coordinator_open_document(uuid, text) to authenticated;
