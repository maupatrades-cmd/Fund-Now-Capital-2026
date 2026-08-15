-- ===========================================================================
-- Build 8.3 — signer-scoped storage for drawn / uploaded signature images.
--
-- WHY THIS EXISTS
-- `legal-signature-artifacts` was created in #218 with a single owner-only
-- policy, so the only person who could put a signature image into it was the
-- owner. That left `submit_agreement_signature`'s `drawn` and `uploaded`
-- methods unreachable: a signer could adopt a TYPED name (no artifact) but had
-- nowhere to put a drawn one. Build 8.1 shipped typed-only for exactly this
-- reason. This opens the narrowest possible lane for the signer's own image.
--
-- AUTHORISATION MODEL (two independent gates, both must hold)
--   1. STORAGE — this policy. Path is `signature/{auth.uid()}/{agreement_id}/
--      {uuid}.{ext}`; segment 2 must be the caller. A signer can only ever write
--      inside their own folder. That is all storage knows or needs to know.
--   2. ATTACHMENT — `submit_agreement_signature`. Recording the uploaded path
--      against an agreement still requires a valid, unconsumed signing token and
--      the four §7.2 acknowledgements. Storage proves "this is your folder";
--      the token proves "you may sign this document".
-- Neither gate alone lets anyone attach an image to someone else's agreement.
--
-- INSERT ONLY — deliberately stricter than the payee-proofs bucket, which grants
-- the subject update + delete. A signature artifact is evidence of a legal act:
-- once written it must not be replaced or removed by the person it incriminates.
-- A signer who draws badly simply uploads a new object (fresh uuid); the one
-- referenced by `signature_artifacts.storage_path` is the one that counts.
-- ===========================================================================

-- The bucket already exists (#218). Re-assert private, and add server-side
-- content guards so an oversized or non-image upload is refused by storage
-- itself rather than only by client-side validation.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('legal-signature-artifacts', 'legal-signature-artifacts', false, 2097152,
        array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/png', 'image/jpeg'];

comment on table storage.buckets is
  'Supabase storage buckets. legal-signature-artifacts is private, image-only, 2MB max (Build 8.3).';

drop policy if exists "legal_signature_artifacts_signer_insert" on storage.objects;
create policy "legal_signature_artifacts_signer_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'legal-signature-artifacts'
    and (storage.foldername(name))[1] = 'signature'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- The signer may re-read their own image (e.g. the confirmation screen renders
-- it back). Still no UPDATE and no DELETE — see the immutability note above.
drop policy if exists "legal_signature_artifacts_signer_select" on storage.objects;
create policy "legal_signature_artifacts_signer_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'legal-signature-artifacts'
    and (storage.foldername(name))[1] = 'signature'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- ===========================================================================
-- Structural assertions.
-- ===========================================================================
do $$
declare v_bucket record;
begin
  select * into v_bucket from storage.buckets where id = 'legal-signature-artifacts';
  if v_bucket.id is null then
    raise exception 'assert: legal-signature-artifacts bucket missing';
  end if;
  if v_bucket.public then
    raise exception 'assert: legal-signature-artifacts must stay private';
  end if;
  if coalesce(v_bucket.file_size_limit, 0) <> 2097152 then
    raise exception 'assert: signature bucket size limit not applied (got %)', v_bucket.file_size_limit;
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'legal_signature_artifacts_signer_insert' and cmd = 'INSERT'
  ) then
    raise exception 'assert: signer insert policy missing';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'legal_signature_artifacts_signer_select' and cmd = 'SELECT'
  ) then
    raise exception 'assert: signer select policy missing';
  end if;

  -- The signer must NOT be able to mutate or remove a written artifact.
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like 'legal_signature_artifacts_signer_%'
       and cmd in ('UPDATE', 'DELETE')
  ) then
    raise exception 'assert: signature artifacts must not be signer-mutable';
  end if;

  -- anon must never reach this bucket.
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like 'legal_signature_artifacts%'
       and 'anon' = any(roles)
  ) then
    raise exception 'assert: signature artifact policies must not be granted to anon';
  end if;

  raise notice 'Build 8.3 signature storage: assertions passed (private image-only bucket, signer insert+select, no signer update/delete, no anon).';
end $$;
