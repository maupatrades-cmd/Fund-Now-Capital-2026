-- Spec PR 1 (schema) + PR 2 (clause gap) — Legal source-asset registry, private
-- buckets, and clause→source map.
-- ============================================================================
-- Canonical spec: FNC-CANONICAL-LEGAL-DOCUMENTS-ESIGN-ONBOARDING-SPEC-2026-08-12.
-- Audit map graded MISSING: legal_source_assets (§2 provenance), the five private
-- legal-* buckets (§11.1), and legal_template_clause_sources (§11 #4).
--
-- Machinery only — NO legal wording, NO PDF bytes. This makes the content path
-- READY: the moment the owner uploads an approved source PDF to the private
-- legal-source-approved bucket, register_legal_source_asset hash-verifies it
-- against the approved SHA-256 seeded here (§2: "verify the hash before
-- registering; a mismatch must stop publication and create an owner alert").
--
-- The six approved source hashes from spec §2 are SEEDED as 'pending' — encoding
-- owner-approved provenance (the hashes are given in the approved spec, not
-- invented). No file bytes are stored until the owner uploads them.
--
-- Security posture (Build-41 house style):
--   * Owner-only RLS on both tables; writes via owner-gated DEFINER RPCs; table
--     DML revoked from every API role; no anon path.
--   * All five buckets PRIVATE with owner-only storage.objects RLS. Party-scoped
--     download (executed docs / certificates) is via short-lived signed URLs
--     issued by a later Edge Function (§11.1) — NOT direct bucket access. Owner is
--     the only direct reader for now (least privilege).
-- New empty tables ⇒ inline constraints/indexes are lock-free.
-- ============================================================================

-- ===========================================================================
-- 1. legal_source_assets — SHA-256 provenance registry (§2).
-- ===========================================================================
create table if not exists public.legal_source_assets (
  id                uuid primary key default gen_random_uuid(),
  source_key        text not null,                 -- stable key from spec §2 (e.g. 'client_nda')
  original_filename text not null,                 -- the approved source filename (§2)
  workspace_path    text,                           -- docs/legal/source-approved/... (provenance)
  pages             integer,
  expected_sha256   text not null,                 -- the approved digest (§2) — verify against this
  registered_sha256 text,                           -- digest computed at ingest (null until registered)
  storage_path      text,                           -- path in the private legal-source-approved bucket
  status            text not null default 'pending',-- pending / verified / mismatch
  verified_at       timestamptz,
  verified_by       uuid references public.profiles(id),
  notes             text,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint legal_source_assets_key_uniq unique (source_key),
  constraint legal_source_assets_status_ck check (status in ('pending','verified','mismatch')),
  constraint legal_source_assets_expected_sha_format check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  constraint legal_source_assets_registered_sha_format
    check (registered_sha256 is null or registered_sha256 ~ '^[0-9a-f]{64}$')
);

comment on table public.legal_source_assets is
  'SHA-256 provenance registry for the approved legal source PDFs (spec §2). Seeded with the approved expected hashes; register_legal_source_asset verifies an uploaded file against expected_sha256 before marking it verified. Owner-only RLS.';

create index if not exists idx_legal_source_assets_status on public.legal_source_assets (status);

drop trigger if exists legal_source_assets_set_updated_at on public.legal_source_assets;
create trigger legal_source_assets_set_updated_at
  before update on public.legal_source_assets
  for each row execute function public.set_updated_at();

alter table public.legal_source_assets enable row level security;
drop policy if exists legal_source_assets_owner_all on public.legal_source_assets;
create policy legal_source_assets_owner_all on public.legal_source_assets
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
revoke all on table public.legal_source_assets from anon, public, authenticated;
grant select on table public.legal_source_assets to authenticated;

-- ===========================================================================
-- 2. legal_template_clause_sources — clause→source traceability map (§11 #4).
--    Each rendered template section traces to its source key, page and clause.
-- ===========================================================================
create table if not exists public.legal_template_clause_sources (
  id                  uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.legal_document_template_versions(id) on delete cascade,
  source_asset_id     uuid not null references public.legal_source_assets(id) on delete restrict,
  clause_ref          text not null,                -- e.g. 'clause 4.2'
  source_page         integer,
  rendered_section    text,                          -- the section label in the rendered template
  sort_order          integer,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  constraint legal_template_clause_sources_uniq unique (template_version_id, clause_ref),
  constraint legal_template_clause_sources_clause_nonblank check (btrim(clause_ref) <> '')
);

comment on table public.legal_template_clause_sources is
  'Clause→source map (spec §11 #4): traces each rendered template section back to its approved source asset, page and clause. Owner-only RLS.';

create index if not exists idx_clause_sources_version on public.legal_template_clause_sources (template_version_id);
create index if not exists idx_clause_sources_asset on public.legal_template_clause_sources (source_asset_id);

alter table public.legal_template_clause_sources enable row level security;
drop policy if exists legal_template_clause_sources_owner_all on public.legal_template_clause_sources;
create policy legal_template_clause_sources_owner_all on public.legal_template_clause_sources
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
revoke all on table public.legal_template_clause_sources from anon, public, authenticated;
grant select on table public.legal_template_clause_sources to authenticated;

-- ===========================================================================
-- 3. Seed the six approved source assets from spec §2 (hashes lowercased to the
--    canonical 64-hex form). Idempotent on source_key. Bytes uploaded later.
-- ===========================================================================
insert into public.legal_source_assets (source_key, original_filename, workspace_path, pages, expected_sha256)
values
  ('lead_referrer_service_agreement', 'lead-referrer-service-agreement.pdf',
     'docs/legal/source-approved/lead-referrer-service-agreement.pdf', 7,
     '4b5d0fa2ed438b93b355f48b213c1ce06c54adbf3008e1fe70eee1923ed652a0'),
  ('lead_referrer_nda', 'lead-referrer-nda.pdf',
     'docs/legal/source-approved/lead-referrer-nda.pdf', 5,
     '1fbcd15332f8df21098fe05f7a1a56fef7f65de6b39e5816f39ce59397f4ae2a'),
  ('client_nda', 'FNC_Client_NDA_DRAFT.pdf',
     'docs/legal/source-approved/FNC_Client_NDA_DRAFT.pdf', 5,
     '99d8775cb0400450bae1a21d3870f2c40ef0e32e89ca72316ff0a47a694e9769'),
  ('bright_destiny_referral_partner_agreement', 'FNC_Bright_Destiny_Referral_Agreement_DRAFT_v2.pdf',
     'docs/legal/source-approved/FNC_Bright_Destiny_Referral_Agreement_DRAFT_v2.pdf', 15,
     '2a4ca5649f9377a78d26b982e6741fbcf5e3692a90d3b91b1342835d13a3ac57'),
  ('contractor_service_agreement', 'FNC_Contractor_Service_Agreement_DRAFT (1).pdf',
     'docs/legal/source-approved/FNC_Contractor_Service_Agreement_DRAFT (1).pdf', 11,
     'd94a99da6148a7e3c36a72c1cf945f2f58f39287ca106bc8f61851e3600998d5'),
  ('client_mandate_letter', 'FNC_Client_Mandate_Letter (2).pdf',
     'docs/legal/source-approved/FNC_Client_Mandate_Letter (2).pdf', 4,
     '53b359b1116fdab1410e95d9bd73707fc46a0cc032567777e1b4aa3e0e3198c6')
on conflict (source_key) do nothing;

-- ===========================================================================
-- 4. register_legal_source_asset — owner verifies an uploaded source PDF against
--    its approved hash (§2). Match ⇒ verified. Mismatch ⇒ status 'mismatch' +
--    an activity_logs alert (the mismatch record is the durable owner alert;
--    downstream publication gates on status='verified'). No raise on mismatch so
--    the alert persists.
-- ===========================================================================
create or replace function public.register_legal_source_asset(
  p_source_key      text,
  p_computed_sha256 text,
  p_storage_path    text default null
) returns public.legal_source_assets
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := (select auth.uid());
  v_computed text := lower(nullif(btrim(coalesce(p_computed_sha256,'')),''));
  v_path     text := nullif(btrim(coalesce(p_storage_path,'')),'');
  v_asset    public.legal_source_assets;
begin
  if not public.is_owner() then raise exception 'Only the owner can register legal source assets'; end if;
  if v_computed is null or v_computed !~ '^[0-9a-f]{64}$' then
    raise exception 'A lowercase 64-hex computed SHA-256 is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('legal_source_asset:' || p_source_key));
  select * into v_asset from public.legal_source_assets where source_key = p_source_key;
  if v_asset.id is null then raise exception 'Unknown legal source key %', p_source_key; end if;

  if v_computed = v_asset.expected_sha256 then
    update public.legal_source_assets
       set registered_sha256 = v_computed,
           storage_path = coalesce(v_path, storage_path),
           status = 'verified', verified_at = now(), verified_by = v_uid, updated_at = now()
     where id = v_asset.id returning * into v_asset;
    insert into public.activity_logs
      (occurred_at, user_id, user_role, event_type, entity_type, entity_id, description, after_values)
    values (now(), v_uid, 'owner', 'UPDATE', 'legal_source_asset', v_asset.id,
            'Verified legal source asset: ' || v_asset.source_key,
            jsonb_build_object('source_key', v_asset.source_key, 'status', 'verified'));
  else
    update public.legal_source_assets
       set registered_sha256 = v_computed, status = 'mismatch',
           verified_at = null, verified_by = null, updated_at = now()
     where id = v_asset.id returning * into v_asset;
    insert into public.activity_logs
      (occurred_at, user_id, user_role, event_type, entity_type, entity_id, description, after_values)
    values (now(), v_uid, 'owner', 'UPDATE', 'legal_source_asset', v_asset.id,
            'HASH MISMATCH on legal source asset: ' || v_asset.source_key ||
              ' — upload rejected, publication blocked (§2)',
            jsonb_build_object('source_key', v_asset.source_key, 'status', 'mismatch',
                               'expected', v_asset.expected_sha256, 'computed', v_computed));
  end if;
  return v_asset;
end $$;

comment on function public.register_legal_source_asset(text, text, text) is
  'Owner-only: verify an uploaded source PDF against its approved SHA-256 (§2). Match ⇒ verified; mismatch ⇒ status mismatch + activity_logs alert (durable). Advisory-locked, RETURNING-checked.';

-- ===========================================================================
-- 5. set_template_clause_source — owner upserts a clause→source mapping (§11 #4).
-- ===========================================================================
create or replace function public.set_template_clause_source(
  p_template_version_id uuid,
  p_source_asset_id     uuid,
  p_clause_ref          text,
  p_source_page         integer default null,
  p_rendered_section    text    default null,
  p_sort_order          integer default null
) returns public.legal_template_clause_sources
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_row public.legal_template_clause_sources;
begin
  if not public.is_owner() then raise exception 'Only the owner can map clause sources'; end if;
  if p_clause_ref is null or btrim(p_clause_ref) = '' then raise exception 'A clause reference is required'; end if;
  if not exists (select 1 from public.legal_document_template_versions where id = p_template_version_id) then
    raise exception 'Template version % not found', p_template_version_id; end if;
  if not exists (select 1 from public.legal_source_assets where id = p_source_asset_id) then
    raise exception 'Source asset % not found', p_source_asset_id; end if;

  insert into public.legal_template_clause_sources
    (template_version_id, source_asset_id, clause_ref, source_page, rendered_section, sort_order, created_by)
  values
    (p_template_version_id, p_source_asset_id, btrim(p_clause_ref), p_source_page,
     nullif(btrim(coalesce(p_rendered_section,'')),''), p_sort_order, v_uid)
  on conflict (template_version_id, clause_ref) do update
    set source_asset_id = excluded.source_asset_id,
        source_page = excluded.source_page,
        rendered_section = excluded.rendered_section,
        sort_order = excluded.sort_order
  returning * into v_row;
  if v_row.id is null then raise exception 'Clause source mapping was not written'; end if;
  return v_row;
end $$;

comment on function public.set_template_clause_source(uuid, uuid, text, integer, text, integer) is
  'Owner-only: upsert a clause→source mapping on (template_version, clause_ref). RETURNING-checked.';

-- ===========================================================================
-- 6. The five private legal-* buckets (§11.1). All private; owner-only
--    storage.objects RLS. Party-scoped download comes via signed URLs later.
-- ===========================================================================
do $$
declare b text;
  buckets constant text[] := array[
    'legal-source-approved', 'legal-generated-drafts', 'legal-executed',
    'legal-signature-artifacts', 'legal-evidence-certificates'
  ];
begin
  foreach b in array buckets loop
    insert into storage.buckets (id, name, public)
      values (b, b, false)
      on conflict (id) do update set public = false;
    execute format('drop policy if exists %I on storage.objects', b || '_owner_all');
    execute format(
      'create policy %I on storage.objects for all to authenticated using (bucket_id = %L and public.is_owner()) with check (bucket_id = %L and public.is_owner())',
      b || '_owner_all', b, b);
  end loop;
end $$;

-- ===========================================================================
-- 7. Grants matrix (FIX-A posture).
-- ===========================================================================
do $$
declare fn text;
  fns constant text[] := array[
    'register_legal_source_asset(text, text, text)',
    'set_template_clause_source(uuid, uuid, text, integer, text, integer)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
    execute format('grant execute on function public.%s to postgres', fn);
  end loop;
end $$;

-- ===========================================================================
-- 8. Structural assertions.
-- ===========================================================================
do $$
declare b text; v_cnt int;
  buckets constant text[] := array[
    'legal-source-approved', 'legal-generated-drafts', 'legal-executed',
    'legal-signature-artifacts', 'legal-evidence-certificates'
  ];
begin
  if to_regclass('public.legal_source_assets') is null then raise exception 'assert: legal_source_assets missing'; end if;
  if to_regclass('public.legal_template_clause_sources') is null then raise exception 'assert: legal_template_clause_sources missing'; end if;
  if to_regprocedure('public.register_legal_source_asset(text,text,text)') is null then raise exception 'assert: register RPC missing'; end if;
  if to_regprocedure('public.set_template_clause_source(uuid,uuid,text,integer,text,integer)') is null then raise exception 'assert: clause-source RPC missing'; end if;

  if not (select relrowsecurity from pg_class where oid='public.legal_source_assets'::regclass) then raise exception 'assert: RLS off on legal_source_assets'; end if;
  if not (select relrowsecurity from pg_class where oid='public.legal_template_clause_sources'::regclass) then raise exception 'assert: RLS off on legal_template_clause_sources'; end if;
  if exists (select 1 from information_schema.role_table_grants
      where table_schema='public' and table_name in ('legal_source_assets','legal_template_clause_sources') and grantee='anon') then
    raise exception 'assert: legal source tables must not be granted to anon'; end if;

  -- six seeds present.
  select count(*) into v_cnt from public.legal_source_assets;
  if v_cnt < 6 then raise exception 'assert: expected >=6 seeded source assets, found %', v_cnt; end if;
  -- all seeds carry a well-formed expected hash.
  if exists (select 1 from public.legal_source_assets where expected_sha256 !~ '^[0-9a-f]{64}$') then
    raise exception 'assert: a seeded expected_sha256 is malformed'; end if;

  -- five private buckets + owner policies.
  foreach b in array buckets loop
    if not exists (select 1 from storage.buckets where id=b and public=false) then
      raise exception 'assert: private bucket % missing', b; end if;
    if not exists (select 1 from pg_policy where polrelid='storage.objects'::regclass and polname=b || '_owner_all') then
      raise exception 'assert: owner RLS on bucket % missing', b; end if;
  end loop;

  raise notice 'Legal source assets + buckets: structural assertions passed (2 tables, 2 RPCs, 6 seeds, 5 private buckets).';
end $$;

-- ===========================================================================
-- 9. Behavioural assertions — hash verify (match ⇒ verified, mismatch ⇒ mismatch)
--    + clause-source mapping, all rolled back. Seeds remain 'pending' afterward.
-- ===========================================================================
do $$
declare
  v_owner uuid; v_asset public.legal_source_assets; v_expected text;
  v_tid uuid; v_ver uuid; v_map uuid;
begin
  select id into v_owner from public.profiles where role='owner' limit 1;
  if v_owner is null then
    raise notice 'Legal source assets: behavioural assertions skipped (no owner profile).';
    return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    -- Matching hash → verified.
    select expected_sha256 into v_expected from public.legal_source_assets where source_key='client_nda';
    v_asset := public.register_legal_source_asset('client_nda', v_expected, 'legal-source-approved/client_nda.pdf');
    if v_asset.status <> 'verified' then raise exception 'assert: matching hash should verify (got %)', v_asset.status; end if;

    -- Wrong hash → mismatch (durable, no raise).
    v_asset := public.register_legal_source_asset('client_mandate_letter', repeat('a', 64));
    if v_asset.status <> 'mismatch' then raise exception 'assert: wrong hash should be mismatch (got %)', v_asset.status; end if;

    -- Unknown key → raises.
    begin
      perform public.register_legal_source_asset('no_such_key', repeat('b', 64));
      raise exception 'assert: unknown source key was accepted';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not ilike '%Unknown legal source key%' then raise exception 'assert: wrong unknown-key error: %', sqlerrm; end if;
    end;

    -- Clause-source mapping against a fresh template version.
    v_tid := (public.create_legal_document_template(
      'nda'::public.legal_document_type, 'partner'::public.legal_document_role,
      'Fund Now Capital (Pty) Ltd', 'Source-asset clause-map test', 'ZA', 'test')).id;
    v_ver := (public.create_legal_template_version(v_tid, '1.0', '# Placeholder')).id;
    v_map := (public.set_template_clause_source(
      v_ver, (select id from public.legal_source_assets where source_key='client_nda'),
      'clause 1.1', 1, 'Confidentiality', 1)).id;
    if v_map is null then raise exception 'assert: clause-source mapping not written'; end if;

    raise notice 'Legal source assets: behavioural assertions passed (verify, mismatch, unknown-key guard, clause map).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
