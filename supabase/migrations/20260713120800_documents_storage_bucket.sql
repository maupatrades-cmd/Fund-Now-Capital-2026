-- Private storage bucket for client documents (bank statements, IDs, contracts).
-- Bucket is NOT public — files are only reachable through RLS-checked signed URLs.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Phase 1 is owner-only: only owners can read/write objects in this bucket.
-- Partner file access (respecting the bank_statement rule, which lives on the
-- public.documents metadata table) comes with the partner portal.
drop policy if exists "documents_bucket_owner_select" on storage.objects;
drop policy if exists "documents_bucket_owner_insert" on storage.objects;
drop policy if exists "documents_bucket_owner_update" on storage.objects;
drop policy if exists "documents_bucket_owner_delete" on storage.objects;

create policy "documents_bucket_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and public.is_owner());

create policy "documents_bucket_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and public.is_owner());

create policy "documents_bucket_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'documents' and public.is_owner())
  with check (bucket_id = 'documents' and public.is_owner());

create policy "documents_bucket_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and public.is_owner());
