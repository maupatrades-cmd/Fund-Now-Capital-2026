-- Build 3 — Authority & Consent Form: 7th approved source registry key + doc type.
-- ============================================================================
-- Extends two LIVE, already-applied objects (do NOT rebuild them):
--   * the legal source-asset registry  (public.legal_source_assets, #218)
--   * the legal_document_type enum       (Build 41 template registry)
-- with the 7th owner-approved legal source document: the client Authority &
-- Consent Form (the POPIA / multi-funder authority the client signs).
--
-- MACHINERY + PROVENANCE ONLY — no legal wording, no PDF bytes, no template.
--   * The approved SHA-256 is the OWNER-VERIFIED digest recorded in the
--     2026-08-12b legal-lane handover (§5, PR #229):
--       c013c5d129f44d637c785924fef13ef737ccb25d2869590df9c6157642f306df
--     It is NOT invented — it is copied from the owner's hash-verification record.
--   * register_legal_source_asset() verifies an uploaded PDF against this digest
--     before flipping the row to 'verified'. Until the owner uploads the bytes to
--     the private legal-source-approved bucket, the row stays 'pending' — exactly
--     like the other six seeds.
--
-- PROVISIONAL fields (owner may correct before merge — the HASH, not these, is the
-- authoritative verifier, and register_legal_source_asset matches on source_key +
-- hash, never on filename): original_filename, workspace_path, pages. The exact
-- approved filename/page-count were not in the workspace at authoring time, so
-- pages is left NULL (not guessed) and the filename follows the existing naming
-- convention.
--
-- NAMING (stable identifiers — flagged for owner confirmation in the PR):
--   source_key         = 'client_authority_and_consent'  (client-doc family, cf.
--                        client_nda / client_mandate_letter)
--   legal_document_type = 'authority_and_consent'         (distinct from the
--                        existing 'popia_agreement' — that is the operator/data
--                        processing agreement; this is the client's funding
--                        authority + consent form)
--
-- New empty enum label + idempotent seed ⇒ lock-free. Nothing in this migration
-- USES the new enum label, so ADD VALUE is safe in the same transaction (a new
-- enum value may not be referenced in the txn that adds it — we only read the
-- catalog by text, never cast to it).
-- ============================================================================

-- ===========================================================================
-- 1. New legal_document_type value for the Authority & Consent Form.
-- ===========================================================================
alter type public.legal_document_type add value if not exists 'authority_and_consent';

-- ===========================================================================
-- 2. Seed the 7th approved source asset (idempotent on source_key).
-- ===========================================================================
insert into public.legal_source_assets
  (source_key, original_filename, workspace_path, pages, expected_sha256)
values (
  'client_authority_and_consent',
  'FNC_Authority_and_Consent_Form.pdf',
  'docs/legal/source-approved/FNC_Authority_and_Consent_Form.pdf',
  null,
  'c013c5d129f44d637c785924fef13ef737ccb25d2869590df9c6157642f306df'
)
on conflict (source_key) do nothing;

-- ===========================================================================
-- 3. Assertions — structural only. The new enum label is read from the catalog
--    by TEXT (never cast) so it is visible in this same transaction. The seed is
--    idempotent, so there is no test DML to unwind.
-- ===========================================================================
do $$
declare
  v_hash   text;
  v_status text;
  v_count  int;
begin
  -- (a) enum label present (catalog read — safe in the adding txn)
  if not exists (
    select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'legal_document_type'
       and e.enumlabel = 'authority_and_consent'
  ) then
    raise exception 'assert FAIL: legal_document_type is missing value authority_and_consent';
  end if;

  -- (b) 7th source asset seeded with the owner-verified digest, status pending
  select expected_sha256, status
    into v_hash, v_status
    from public.legal_source_assets
   where source_key = 'client_authority_and_consent';
  if v_hash is null then
    raise exception 'assert FAIL: client_authority_and_consent source asset was not seeded';
  end if;
  if v_hash <> 'c013c5d129f44d637c785924fef13ef737ccb25d2869590df9c6157642f306df' then
    raise exception 'assert FAIL: A&C expected_sha256 mismatch (got %)', v_hash;
  end if;
  if v_status <> 'pending' then
    raise exception 'assert FAIL: A&C asset should seed as pending (got %)', v_status;
  end if;

  -- (c) registry now holds all seven approved keys
  select count(*) into v_count from public.legal_source_assets;
  if v_count < 7 then
    raise exception 'assert FAIL: expected >= 7 seeded source assets, found %', v_count;
  end if;

  raise notice 'Build 3 (Authority & Consent): enum value + 7th source asset seeded (pending, owner-verified digest). Registry now has % keys.', v_count;
end $$;

notify pgrst, 'reload schema';
