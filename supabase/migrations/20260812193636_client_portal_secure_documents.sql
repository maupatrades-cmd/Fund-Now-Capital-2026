-- Client portal document workspace: safe checklist resolver, private upload
-- registration, and client-scoped Storage access. Generated into the canonical
-- migrations directory by the publisher via `supabase migration new`.

create or replace function public.client_portal_document_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := public.current_client_id();
  v_deal_id uuid;
  v_stage text;
  v_product_name text;
  v_checklist jsonb := '[]'::jsonb;
  v_documents jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null or v_client_id is null then
    raise exception 'Client portal account is not linked';
  end if;

  select d.id, d.stage::text, p.display_name
    into v_deal_id, v_stage, v_product_name
    from public.deals d
    join public.deal_document_rule_contexts c on c.deal_id = d.id
    join public.funding_product_catalog p on p.code = c.product_code
   where d.client_id = v_client_id
   order by d.updated_at desc, d.created_at desc
   limit 1;

  if v_deal_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'document_type', x.document_type,
      'requirement', x.requirement,
      'reason', x.client_safe_reason
    ) order by x.document_type::text), '[]'::jsonb)
      into v_checklist
      from public.client_document_checklist(v_deal_id) x;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'deal_id', d.deal_id,
    'filename', d.filename,
    'storage_path', d.storage_path,
    'document_type', d.document_type,
    'file_size_bytes', d.file_size_bytes,
    'mime_type', d.mime_type,
    'period_start', d.period_start,
    'period_end', d.period_end,
    'expiry_date', d.expiry_date,
    'version_number', d.version_number,
    'is_current_version', d.is_current_version,
    'verification_status', d.verification_status,
    'rejection_reason', d.rejection_reason,
    'created_at', d.created_at
  ) order by d.created_at desc), '[]'::jsonb)
    into v_documents
    from public.documents d
   where d.client_id = v_client_id
     and d.deal_id = v_deal_id;

  return jsonb_build_object(
    'client_id', v_client_id,
    'deal_id', v_deal_id,
    'stage', v_stage,
    'product_name', v_product_name,
    'checklist', v_checklist,
    'documents', v_documents
  );
end;
$$;

revoke all on function public.client_portal_document_workspace() from public, anon;
grant execute on function public.client_portal_document_workspace() to authenticated;

create or replace function public.register_client_portal_document(
  p_document_id uuid,
  p_deal_id uuid,
  p_document_type public.document_type,
  p_filename text,
  p_storage_path text,
  p_file_size_bytes bigint,
  p_mime_type text,
  p_period_start date default null,
  p_period_end date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := public.current_client_id();
  v_path_prefix text;
  v_id uuid;
begin
  if (select auth.uid()) is null or v_client_id is null then
    raise exception 'Client portal account is not linked';
  end if;
  if p_document_id is null or p_deal_id is null then
    raise exception 'Document and deal are required';
  end if;
  if not exists (
    select 1 from public.deals d where d.id = p_deal_id and d.client_id = v_client_id
  ) then
    raise exception 'Deal does not belong to this client';
  end if;
  if not exists (
    select 1 from public.client_document_checklist(p_deal_id) x
     where x.document_type = p_document_type
  ) then
    raise exception 'Document type is not on the active client checklist';
  end if;

  v_path_prefix := 'clients/' || v_client_id::text || '/' || p_document_id::text || '/';
  if not (p_storage_path like v_path_prefix || '%') or position('..' in p_storage_path) > 0 then
    raise exception 'Storage path is outside the client document workspace';
  end if;
  if nullif(btrim(coalesce(p_filename, '')), '') is null or length(p_filename) > 240 then
    raise exception 'Filename is required and must be 240 characters or fewer';
  end if;
  if p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > 20971520 then
    raise exception 'Document must be between 1 byte and 20 MB';
  end if;
  if coalesce(p_mime_type, '') not in (
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
  ) then
    raise exception 'Only PDF, JPG, PNG, or WebP documents are accepted';
  end if;

  insert into public.documents (
    id, client_id, deal_id, filename, storage_path, file_size_bytes, mime_type,
    uploaded_by, document_type, upload_source, period_start, period_end,
    received_from
  ) values (
    p_document_id, v_client_id, p_deal_id, btrim(p_filename), p_storage_path,
    p_file_size_bytes, p_mime_type, (select auth.uid()), p_document_type,
    'client', p_period_start, p_period_end, 'Client portal'
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.register_client_portal_document(
  uuid, uuid, public.document_type, text, text, bigint, text, date, date
) from public, anon;
grant execute on function public.register_client_portal_document(
  uuid, uuid, public.document_type, text, text, bigint, text, date, date
) to authenticated;

-- The existing documents bucket stays private. Tighten its upload envelope for
-- all clients while preserving Owner and existing lead/partner policies.
update storage.buckets
   set file_size_limit = 20971520,
       allowed_mime_types = array[
         'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
       ]::text[]
 where id = 'documents';

drop policy if exists "documents_bucket_client_select" on storage.objects;
create policy "documents_bucket_client_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and public.current_client_id() is not null
  and (storage.foldername(name))[1] = 'clients'
  and (storage.foldername(name))[2] = public.current_client_id()::text
);

drop policy if exists "documents_bucket_client_insert" on storage.objects;
create policy "documents_bucket_client_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents'
  and public.current_client_id() is not null
  and (storage.foldername(name))[1] = 'clients'
  and (storage.foldername(name))[2] = public.current_client_id()::text
  and (storage.foldername(name))[3] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
);

comment on function public.client_portal_document_workspace() is
  'Returns only client-safe checklist and document metadata for the linked client. Funder identity, internal rule source and verification notes are never returned.';
comment on function public.register_client_portal_document(uuid, uuid, public.document_type, text, text, bigint, text, date, date) is
  'Registers a private client upload only when its deal, checklist type, path, size and MIME type are authorised.';

do $$
begin
  if has_function_privilege('anon', 'public.client_portal_document_workspace()', 'EXECUTE') then
    raise exception 'Anonymous workspace execution must remain revoked';
  end if;
  if has_function_privilege('anon', 'public.register_client_portal_document(uuid,uuid,public.document_type,text,text,bigint,text,date,date)', 'EXECUTE') then
    raise exception 'Anonymous document registration must remain revoked';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'documents_bucket_client_insert'
  ) then
    raise exception 'Client Storage INSERT policy is missing';
  end if;
  if exists (
    select 1 from storage.buckets where id = 'documents' and public
  ) then
    raise exception 'Documents bucket must remain private';
  end if;
end;
$$;
