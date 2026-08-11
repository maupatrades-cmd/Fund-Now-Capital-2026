-- Build 41 — Legal template registry and versioning.
-- ============================================================================
-- The first two tables of the §10 relational model from
-- docs/FNC-ROLE-AGREEMENTS-AND-E-SIGNING-BUILD-RULES-2026-08-09.md
-- (packs, invitations, executions, signatures, evidence = Builds 42–55).
--
--   1. legal_document_templates          — the LOGICAL template identity:
--        document type, agreement role, legal entity, title, jurisdiction.
--        One row per distinct approved template; its wording lives on versions.
--   2. legal_document_template_versions   — the VERSIONED content per §2:
--        version, effective_date, status, approver, approval_time,
--        source_filename, SHA-256 content hash, self-referencing supersession,
--        is_current flag, and the content (inline markdown AND/OR a private
--        storage path). One published version per template is current.
--
-- Governing spec rules honoured here (this build is pure REGISTRY INFRASTRUCTURE
-- — it manufactures NO legal wording; template content is owner-supplied later):
--   * §2   Only an owner-published template may issue. Guarded status
--          transitions. A published version records document type, role, legal
--          entity, title, version, effective date, jurisdiction, status,
--          approver, approval time, source filename, SHA-256 hash and
--          superseded version.
--   * §2   If approved wording is absent the version stays `draft_blocked` —
--          never fabricate contract text. create_legal_template_version encodes
--          this directly: a version created with NO content is born draft_blocked.
--   * §4.13 Material amendments require a NEW published version and re-signature;
--          historical copies remain immutable. A BEFORE-UPDATE trigger freezes a
--          published version's content + hash + version (append-only spirit).
--   * §8   Templates are owner-only; a private Storage bucket with non-guessable
--          paths backs source uploads; never expose agreement text to partners.
--
-- Security posture (CLAUDE.md non-negotiables + the FIX-A grants hygiene the
-- terms framework established):
--   * RLS on both tables from creation; owner-only (owner full; NO partner/anon).
--   * All mutations go through owner-gated, advisory-locked, RETURNING-checked
--     SECURITY DEFINER RPCs with `set search_path = ''`. Table DML is revoked
--     from every API role — there is no anonymous (or even authenticated-partner)
--     mutation path; the owner writes via the RPCs, or directly as postgres.
--   * Least privilege: execute granted to authenticated (owner-gated in body) +
--     service_role + postgres; revoked from public/anon.
--
-- EMPTY-TABLE RATIONALE: both tables are created empty, so inline PK/FK/unique/
-- index/self-FK are metadata-only with no write-blocking lock — the NOT VALID /
-- CREATE INDEX CONCURRENTLY discipline is for POPULATED tables and buys nothing
-- here (the terms_framework / picker precedent).
-- ============================================================================

-- ===========================================================================
-- 0. Enums. Created fresh in THIS migration, so their labels are usable in the
--    same transaction (the 55P04 same-tx restriction only bites ALTER TYPE ADD
--    VALUE on a pre-existing type — not a freshly CREATEd enum).
--
--    `legal_document_role` is DELIBERATELY separate from the platform
--    `user_role` enum ({owner,partner,contractor}): the agreement packs cover
--    lead_referrer, which is NOT a platform auth role today. These are the three
--    agreement-bearing roles from §3.
--
--    `legal_document_type` labels are drawn straight from the §3 pack item names
--    (owner-approved doc) — structural TYPE labels only, not contract wording.
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'legal_document_role') then
    create type public.legal_document_role as enum ('partner', 'contractor', 'lead_referrer');
  end if;
  if not exists (select 1 from pg_type where typname = 'legal_document_type') then
    create type public.legal_document_type as enum (
      'referral_partner_agreement',
      'introducer_agreement',
      'independent_contractor_agreement',
      'lead_referrer_agreement',
      'nda',
      'popia_agreement',
      'commission_schedule',
      'acceptable_use_policy',
      'code_of_conduct',
      'information_security_acknowledgement',
      'onboarding_verification',
      'training_assessment',
      'annexure'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'legal_template_status') then
    -- Exact §2 lifecycle. draft_blocked = registered but wording absent (never
    -- fabricated); legal_review = with counsel; published = the execution copy;
    -- superseded = replaced by a newer published version.
    create type public.legal_template_status as enum (
      'draft', 'legal_review', 'published', 'superseded', 'draft_blocked'
    );
  end if;
end $$;

-- ===========================================================================
-- 1. legal_document_templates — the logical template identity.
-- ===========================================================================
create table if not exists public.legal_document_templates (
  id            uuid primary key default gen_random_uuid(),
  document_type public.legal_document_type not null,
  role          public.legal_document_role not null,
  legal_entity  text not null,                 -- the FNC contracting entity (owner-supplied legal party name)
  title         text not null,                 -- human title for this template
  jurisdiction  text not null default 'ZA',    -- governing jurisdiction (ISO country / region); ZA = South Africa
  description   text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- One logical template per (role, type, entity, jurisdiction, title). Distinct
  -- annexures under the same role/type differ by title, so title is part of the key.
  constraint legal_document_templates_identity_uniq
    unique (role, document_type, legal_entity, jurisdiction, title),
  constraint legal_document_templates_title_nonblank check (btrim(title) <> ''),
  constraint legal_document_templates_entity_nonblank check (btrim(legal_entity) <> '')
);

comment on table public.legal_document_templates is
  'Logical legal-template identity (Build 41, §10): document type + agreement role + legal entity + title + jurisdiction. Wording is versioned in legal_document_template_versions; this table carries NO contract text. Owner-only RLS.';
comment on column public.legal_document_templates.role is
  'Agreement-bearing role (partner/contractor/lead_referrer) — a dedicated enum, NOT the platform user_role (which has no lead_referrer).';

create index if not exists idx_legal_templates_role_type
  on public.legal_document_templates (role, document_type);

drop trigger if exists legal_document_templates_set_updated_at on public.legal_document_templates;
create trigger legal_document_templates_set_updated_at
  before update on public.legal_document_templates
  for each row execute function public.set_updated_at();

-- RLS: owner-only. No partner/anon access whatsoever.
alter table public.legal_document_templates enable row level security;
drop policy if exists legal_document_templates_owner_all on public.legal_document_templates;
create policy legal_document_templates_owner_all on public.legal_document_templates
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Grants: SELECT to authenticated (RLS narrows to the owner). No write grant —
-- writes are DEFINER-RPC-only (postgres/service_role bypass grants). No anon.
revoke all on table public.legal_document_templates from anon, public, authenticated;
grant select on table public.legal_document_templates to authenticated;

-- ===========================================================================
-- 2. legal_document_template_versions — versioned content per §2.
--    superseded_by_version_id is a nullable self-FK: inline REFERENCES is fine
--    on this empty table (task note). Content may be inline markdown, a private
--    storage path, or both; a published version needs a non-null SHA-256 hash.
-- ===========================================================================
create table if not exists public.legal_document_template_versions (
  id                       uuid primary key default gen_random_uuid(),
  template_id              uuid not null references public.legal_document_templates(id) on delete restrict,
  version                  text not null,      -- semver text, e.g. '1.0', '1.1', '2.0'
  status                   public.legal_template_status not null default 'draft',
  effective_date           date,               -- stamped at publish (nullable while draft)
  -- Content: inline execution-copy markdown AND/OR a path in the private
  -- legal-template-sources bucket (the uploaded source file). Both nullable so a
  -- version can be registered as draft_blocked before wording exists.
  content_markdown         text,
  source_storage_path      text,               -- path in the private legal-template-sources bucket
  source_filename          text,               -- original filename of the uploaded source (§2)
  content_sha256           text,               -- 64-hex SHA-256 of the canonical content; required at publish (§2)
  approver                 uuid references public.profiles(id),   -- who published (auth.uid() at publish) (§2)
  approval_time            timestamptz,         -- when published (§2)
  superseded_by_version_id uuid references public.legal_document_template_versions(id),  -- self-FK (§2)
  is_current               boolean not null default false,
  created_by               uuid references public.profiles(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint legal_template_versions_version_uniq unique (template_id, version),
  constraint legal_template_versions_version_nonblank check (btrim(version) <> ''),
  -- SHA-256 must be a well-formed lowercase 64-hex digest when present.
  constraint legal_template_versions_sha256_format
    check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  -- A row cannot supersede itself.
  constraint legal_template_versions_no_self_supersede
    check (superseded_by_version_id is null or superseded_by_version_id <> id),
  -- Only a PUBLISHED version may be current.
  constraint legal_template_versions_current_only_published
    check (is_current is not true or status = 'published'),
  -- A PUBLISHED version must carry its full approval evidence (§2 belt-and-braces,
  -- alongside the publish RPC's friendly guards).
  constraint legal_template_versions_published_requires_approval
    check (
      status <> 'published'
      or (content_sha256 is not null
          and approver is not null
          and approval_time is not null
          and effective_date is not null
          and (content_markdown is not null or source_storage_path is not null))
    )
);

comment on table public.legal_document_template_versions is
  'Versioned legal-template content (Build 41, §2). One published version per template is current. A published version is IMMUTABLE (content/hash/version frozen — §4.13): amendments are a NEW version. draft_blocked = registered but wording absent (never fabricated). Owner-only RLS; writes via DEFINER RPCs only.';
comment on column public.legal_document_template_versions.content_sha256 is
  'Lowercase 64-hex SHA-256 of the canonical content (§2). Computed server-side from content_markdown when inline; supplied by the uploader for a storage-backed source. Required (non-null) to publish.';
comment on column public.legal_document_template_versions.is_current is
  'True for the single live published version of a template (enforced by a partial unique index). Publish sets it and supersedes the prior current version.';

create index if not exists idx_legal_template_versions_template
  on public.legal_document_template_versions (template_id);
create index if not exists idx_legal_template_versions_status
  on public.legal_document_template_versions (status);
-- At most one current version per template.
create unique index if not exists uniq_legal_template_current_per_template
  on public.legal_document_template_versions (template_id) where is_current;

drop trigger if exists legal_document_template_versions_set_updated_at on public.legal_document_template_versions;
create trigger legal_document_template_versions_set_updated_at
  before update on public.legal_document_template_versions
  for each row execute function public.set_updated_at();

-- RLS: owner-only.
alter table public.legal_document_template_versions enable row level security;
drop policy if exists legal_template_versions_owner_all on public.legal_document_template_versions;
create policy legal_template_versions_owner_all on public.legal_document_template_versions
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

revoke all on table public.legal_document_template_versions from anon, public, authenticated;
grant select on table public.legal_document_template_versions to authenticated;

-- ===========================================================================
-- 3. Immutability (§4.13). Once status = 'published', the content, hash, version,
--    source pointers, effective_date and approval evidence are FROZEN. The only
--    permitted change out of published is the guarded published -> superseded
--    transition (a withdrawal or a supersede-by-newer), plus flipping is_current
--    off and stamping superseded_by_version_id. Every other edit to a published
--    row is rejected — material amendments are a NEW version.
--
--    Defense-in-depth: all writes already go through owner-gated DEFINER RPCs and
--    table DML is revoked from API roles, but this BEFORE-UPDATE trigger makes
--    the immutability a hard invariant even a future RPC bug or a manual owner
--    SQL edit cannot bypass.
-- ===========================================================================
create or replace function public.enforce_published_legal_version_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'published' then
    if new.template_id         is distinct from old.template_id
       or new.version             is distinct from old.version
       or new.content_markdown    is distinct from old.content_markdown
       or new.source_storage_path is distinct from old.source_storage_path
       or new.source_filename     is distinct from old.source_filename
       or new.content_sha256      is distinct from old.content_sha256
       or new.effective_date      is distinct from old.effective_date
       or new.approver            is distinct from old.approver
       or new.approval_time       is distinct from old.approval_time then
      raise exception
        'A published legal template version is immutable (version %). Publish a NEW version for any amendment (§4.13).',
        old.id using errcode = 'restrict_violation';
    end if;
    -- The ONLY status move allowed out of published is -> superseded.
    if new.status is distinct from old.status and new.status <> 'superseded' then
      raise exception
        'A published version can only transition to superseded, not to % (version %).',
        new.status, old.id using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists enforce_published_legal_version_immutable on public.legal_document_template_versions;
create trigger enforce_published_legal_version_immutable
  before update on public.legal_document_template_versions
  for each row execute function public.enforce_published_legal_version_immutable();

-- Append-only: a published or superseded version can never be deleted (that would
-- destroy the very history §4.13 preserves). Drafts / draft_blocked / legal_review
-- rows may still be deleted (nothing has issued off them).
create or replace function public.block_issued_legal_version_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('published', 'superseded') then
    raise exception
      'A published/superseded legal template version cannot be deleted (version %). Supersede it, do not delete.',
      old.id using errcode = 'restrict_violation';
  end if;
  return old;
end $$;

drop trigger if exists block_issued_legal_version_delete on public.legal_document_template_versions;
create trigger block_issued_legal_version_delete
  before delete on public.legal_document_template_versions
  for each row execute function public.block_issued_legal_version_delete();

-- Row-level DELETE triggers do NOT fire on TRUNCATE; close that manual-edit gap.
create or replace function public.block_legal_registry_truncate()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Table %.% is a legal registry and cannot be truncated. Supersede versions instead.',
    tg_table_schema, tg_table_name using errcode = 'restrict_violation';
end $$;

drop trigger if exists block_legal_registry_truncate on public.legal_document_template_versions;
create trigger block_legal_registry_truncate before truncate on public.legal_document_template_versions
  for each statement execute function public.block_legal_registry_truncate();
drop trigger if exists block_legal_registry_truncate on public.legal_document_templates;
create trigger block_legal_registry_truncate before truncate on public.legal_document_templates
  for each statement execute function public.block_legal_registry_truncate();

-- ===========================================================================
-- 4. RPC: create_legal_document_template(...) — owner inserts a logical template.
--    Owner-gated, RETURNING-checked. Attribution recorded via created_by.
-- ===========================================================================
create or replace function public.create_legal_document_template(
  p_document_type public.legal_document_type,
  p_role          public.legal_document_role,
  p_legal_entity  text,
  p_title         text,
  p_jurisdiction  text default 'ZA',
  p_description   text default null
) returns public.legal_document_templates
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_row public.legal_document_templates;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can create legal templates';
  end if;
  if p_legal_entity is null or btrim(p_legal_entity) = '' then
    raise exception 'A legal entity is required';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'A template title is required';
  end if;

  insert into public.legal_document_templates
    (document_type, role, legal_entity, title, jurisdiction, description, created_by)
  values
    (p_document_type, p_role, btrim(p_legal_entity), btrim(p_title),
     coalesce(nullif(btrim(p_jurisdiction), ''), 'ZA'), nullif(btrim(p_description), ''), v_uid)
  returning * into v_row;
  if v_row.id is null then
    raise exception 'Template was not created (no row written)';
  end if;

  insert into public.activity_logs
    (occurred_at, user_id, user_role, event_type, entity_type, entity_id, description, after_values)
  values
    (now(), v_uid, 'owner', 'CREATE', 'legal_document_template', v_row.id,
     'Created legal template: ' || v_row.title || ' (' || v_row.role::text || '/' || v_row.document_type::text || ')',
     jsonb_build_object('document_type', v_row.document_type, 'role', v_row.role,
                        'legal_entity', v_row.legal_entity, 'jurisdiction', v_row.jurisdiction));
  return v_row;
end $$;

comment on function public.create_legal_document_template(public.legal_document_type, public.legal_document_role, text, text, text, text) is
  'Owner-only: insert a logical legal template (identity only, no wording). RETURNING-checked, activity-logged.';

-- ===========================================================================
-- 5. RPC: create_legal_template_version(...) — owner inserts a DRAFT version.
--    Governing rule: a version created with NO content (no markdown, no storage
--    path) is born `draft_blocked` — the registry records the gap without ever
--    fabricating wording (§2). When inline markdown IS supplied and no hash is
--    given, the SHA-256 is computed server-side for integrity.
--    Advisory-locked per template so concurrent version inserts serialize.
-- ===========================================================================
create or replace function public.create_legal_template_version(
  p_template_id         uuid,
  p_version             text,
  p_content_markdown    text default null,
  p_source_storage_path text default null,
  p_source_filename     text default null,
  p_content_sha256      text default null,
  p_effective_date      date default null
) returns public.legal_document_template_versions
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_md      text := nullif(btrim(coalesce(p_content_markdown, '')), '');
  v_path    text := nullif(btrim(coalesce(p_source_storage_path, '')), '');
  v_fname   text := nullif(btrim(coalesce(p_source_filename, '')), '');
  v_ver     text := nullif(btrim(coalesce(p_version, '')), '');
  v_hash    text := lower(nullif(btrim(coalesce(p_content_sha256, '')), ''));
  v_status  public.legal_template_status;
  v_row     public.legal_document_template_versions;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can create legal template versions';
  end if;
  if v_ver is null then
    raise exception 'A version label is required';
  end if;
  perform pg_advisory_xact_lock(hashtext('legal_template:' || p_template_id::text));
  if not exists (select 1 from public.legal_document_templates where id = p_template_id) then
    raise exception 'Template % not found', p_template_id;
  end if;

  -- Reject a malformed client-supplied hash (never persist a non-digest).
  if v_hash is not null and v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'content_sha256 must be a lowercase 64-hex SHA-256 digest';
  end if;
  -- Inline markdown with no supplied hash → compute it server-side (integrity).
  if v_md is not null and v_hash is null then
    v_hash := encode(extensions.digest(convert_to(v_md, 'UTF8'), 'sha256'), 'hex');
  end if;

  -- §2: no content ⇒ born draft_blocked (wording absent, never fabricated).
  v_status := case when v_md is null and v_path is null
                   then 'draft_blocked'::public.legal_template_status
                   else 'draft'::public.legal_template_status end;

  insert into public.legal_document_template_versions
    (template_id, version, status, effective_date, content_markdown,
     source_storage_path, source_filename, content_sha256, created_by)
  values
    (p_template_id, v_ver, v_status, p_effective_date, v_md, v_path, v_fname, v_hash, v_uid)
  returning * into v_row;
  if v_row.id is null then
    raise exception 'Version was not created (no row written)';
  end if;

  insert into public.activity_logs
    (occurred_at, user_id, user_role, event_type, entity_type, entity_id, description, after_values)
  values
    (now(), v_uid, 'owner', 'CREATE', 'legal_document_template_version', v_row.id,
     'Created legal template version ' || v_row.version || ' (' || v_row.status::text || ')',
     jsonb_build_object('template_id', v_row.template_id, 'version', v_row.version, 'status', v_row.status));
  return v_row;
end $$;

comment on function public.create_legal_template_version(uuid, text, text, text, text, text, date) is
  'Owner-only: insert a DRAFT version of a template. No content ⇒ born draft_blocked (§2 — wording never fabricated). Inline markdown without a hash ⇒ SHA-256 computed server-side. Advisory-locked per template, RETURNING-checked, activity-logged.';

-- ===========================================================================
-- 6. RPC: submit_legal_template_version_for_review(version_id) — draft -> legal_review.
--    Guarded transition (only a draft can go to review). Owner-only, locked.
-- ===========================================================================
create or replace function public.submit_legal_template_version_for_review(p_version_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_from public.legal_template_status; v_tid uuid; v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can move legal template versions to review';
  end if;

  select status, template_id into v_from, v_tid
    from public.legal_document_template_versions where id = p_version_id;
  if v_from is null then raise exception 'Version % not found', p_version_id; end if;
  perform pg_advisory_xact_lock(hashtext('legal_template:' || v_tid::text));

  if v_from = 'legal_review' then
    return jsonb_build_object('was_transitioned', false, 'status', 'legal_review', 'reason', 'already_in_review');
  end if;
  if v_from <> 'draft' then
    raise exception 'Only a draft version can be sent to legal review (version % is %)', p_version_id, v_from;
  end if;

  update public.legal_document_template_versions
     set status = 'legal_review'
   where id = p_version_id and status = 'draft'
   returning id into v_id;
  if v_id is null then raise exception 'Version % was not moved to review (no row written)', p_version_id; end if;

  return jsonb_build_object('was_transitioned', true, 'from', 'draft', 'to', 'legal_review');
end $$;

comment on function public.submit_legal_template_version_for_review(uuid) is
  'Owner-only: draft -> legal_review guarded transition. Advisory-locked, RETURNING-checked, idempotent.';

-- ===========================================================================
-- 7. RPC: publish_legal_template_version(version_id) — draft/legal_review ->
--    published. Requires a non-null SHA-256 hash and present content (§2). Stamps
--    approver = auth.uid() + approval_time, effective_date (defaults to today),
--    sets is_current, and SUPERSEDES the prior current version of the same
--    template (prior -> superseded, is_current off, superseded_by = this version).
--    Owner-only, advisory-locked per template, RETURNING-checked, idempotent.
-- ===========================================================================
create or replace function public.publish_legal_template_version(p_version_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_row   public.legal_document_template_versions;
  v_id    uuid;
  v_prior uuid;
  v_recompute text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can publish legal template versions';
  end if;

  select * into v_row from public.legal_document_template_versions where id = p_version_id;
  if v_row.id is null then raise exception 'Version % not found', p_version_id; end if;
  perform pg_advisory_xact_lock(hashtext('legal_template:' || v_row.template_id::text));

  -- Idempotent: already the published current version → clean no-op.
  if v_row.status = 'published' then
    return jsonb_build_object('was_transitioned', false, 'status', 'published',
                              'reason', 'already_published', 'version_id', p_version_id);
  end if;
  -- Guarded: only draft / legal_review may publish. draft_blocked cannot (no
  -- approved wording — never fabricate; §2).
  if v_row.status not in ('draft', 'legal_review') then
    raise exception 'Only a draft or legal_review version can be published (version % is %)',
      p_version_id, v_row.status;
  end if;

  -- Content must be present (§2: never publish an empty execution copy).
  if v_row.content_markdown is null and v_row.source_storage_path is null then
    raise exception 'Cannot publish version % — no approved content (markdown or source file) is attached', p_version_id;
  end if;
  -- SHA-256 must be present; when inline markdown exists, verify integrity.
  if v_row.content_markdown is not null then
    v_recompute := encode(extensions.digest(convert_to(v_row.content_markdown, 'UTF8'), 'sha256'), 'hex');
    if v_row.content_sha256 is null then
      v_row.content_sha256 := v_recompute;
    elsif v_row.content_sha256 <> v_recompute then
      raise exception 'content_sha256 does not match content_markdown for version % — refusing to publish', p_version_id;
    end if;
  elsif v_row.content_sha256 is null then
    raise exception 'Cannot publish version % — a SHA-256 content hash is required (§2)', p_version_id;
  end if;

  -- Supersede the prior current version FIRST (clears the partial-unique current
  -- slot). published -> superseded is the immutability trigger's allowed move.
  select id into v_prior
    from public.legal_document_template_versions
   where template_id = v_row.template_id and is_current and id <> p_version_id;
  if v_prior is not null then
    update public.legal_document_template_versions
       set status = 'superseded', is_current = false, superseded_by_version_id = p_version_id
     where id = v_prior and is_current
     returning id into v_id;
    if v_id is null then raise exception 'Failed to supersede prior current version % (lost race)', v_prior; end if;
  end if;

  -- Publish this version.
  update public.legal_document_template_versions
     set status         = 'published',
         is_current     = true,
         approver       = v_uid,
         approval_time  = now(),
         effective_date = coalesce(effective_date, current_date),
         content_sha256 = v_row.content_sha256
   where id = p_version_id and status in ('draft', 'legal_review')
   returning id into v_id;
  if v_id is null then raise exception 'Version % was not published (no row written / lost race)', p_version_id; end if;

  insert into public.activity_logs
    (occurred_at, user_id, user_role, event_type, entity_type, entity_id, description, after_values)
  values
    (now(), v_uid, 'owner', 'UPDATE', 'legal_document_template_version', p_version_id,
     'Published legal template version ' || v_row.version,
     jsonb_build_object('template_id', v_row.template_id, 'version', v_row.version,
                        'superseded_version_id', v_prior, 'content_sha256', v_row.content_sha256));

  return jsonb_build_object('was_transitioned', true, 'from', v_row.status, 'to', 'published',
                            'version_id', p_version_id, 'superseded_version_id', v_prior,
                            'content_sha256', v_row.content_sha256);
end $$;

comment on function public.publish_legal_template_version(uuid) is
  'Owner-only: draft/legal_review -> published. Requires a non-null SHA-256 + present content (§2); verifies the hash against inline markdown. Stamps approver/approval_time/effective_date, sets is_current, supersedes the prior current version. Advisory-locked per template, RETURNING-checked, idempotent.';

-- ===========================================================================
-- 8. RPC: supersede_legal_template_version(version_id) — withdraw a published
--    current version WITHOUT a replacement (published -> superseded, is_current
--    off). Use publish for supersede-by-newer; use this to retire a template's
--    live version. Owner-only, advisory-locked, RETURNING-checked, idempotent.
-- ===========================================================================
create or replace function public.supersede_legal_template_version(p_version_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_from public.legal_template_status; v_tid uuid; v_ver text; v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can supersede legal template versions';
  end if;

  select status, template_id, version into v_from, v_tid, v_ver
    from public.legal_document_template_versions where id = p_version_id;
  if v_from is null then raise exception 'Version % not found', p_version_id; end if;
  perform pg_advisory_xact_lock(hashtext('legal_template:' || v_tid::text));

  if v_from = 'superseded' then
    return jsonb_build_object('was_transitioned', false, 'status', 'superseded', 'reason', 'already_superseded');
  end if;
  if v_from <> 'published' then
    raise exception 'Only a published version can be superseded (version % is %)', p_version_id, v_from;
  end if;

  update public.legal_document_template_versions
     set status = 'superseded', is_current = false
   where id = p_version_id and status = 'published'
   returning id into v_id;
  if v_id is null then raise exception 'Version % was not superseded (no row written)', p_version_id; end if;

  insert into public.activity_logs
    (occurred_at, user_id, user_role, event_type, entity_type, entity_id, description, after_values)
  values
    (now(), v_uid, 'owner', 'UPDATE', 'legal_document_template_version', p_version_id,
     'Superseded (withdrew) legal template version ' || v_ver,
     jsonb_build_object('template_id', v_tid, 'version', v_ver));

  return jsonb_build_object('was_transitioned', true, 'from', 'published', 'to', 'superseded');
end $$;

comment on function public.supersede_legal_template_version(uuid) is
  'Owner-only: withdraw a published current version (published -> superseded, is_current off) with no replacement. Advisory-locked, RETURNING-checked, idempotent.';

-- ===========================================================================
-- 9. Private Storage bucket for uploaded template SOURCE files (§8: private
--    bucket, non-guessable paths, owner-only). Backs source_storage_path.
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('legal-template-sources', 'legal-template-sources', false, 26214400,
          array['application/pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'text/markdown', 'text/plain'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists legal_template_sources_owner_all on storage.objects;
create policy legal_template_sources_owner_all on storage.objects
  for all to authenticated
  using (bucket_id = 'legal-template-sources' and public.is_owner())
  with check (bucket_id = 'legal-template-sources' and public.is_owner());

-- ===========================================================================
-- 10. Grants matrix (FIX-A posture). All four RPCs are owner-gated in-body, so
--     they are granted to authenticated (+ service_role + postgres) and revoked
--     from public/anon.
-- ===========================================================================
do $$
declare fn text;
  auth_fns constant text[] := array[
    'create_legal_document_template(public.legal_document_type, public.legal_document_role, text, text, text, text)',
    'create_legal_template_version(uuid, text, text, text, text, text, date)',
    'submit_legal_template_version_for_review(uuid)',
    'publish_legal_template_version(uuid)',
    'supersede_legal_template_version(uuid)'
  ];
begin
  foreach fn in array auth_fns loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
    execute format('grant execute on function public.%s to postgres', fn);
  end loop;
end $$;

-- ===========================================================================
-- 11. Structural assertions — RAISE (roll back) on any drift.
-- ===========================================================================
do $$
declare v_cnt int; sig text; r record;
  definer_fns constant text[] := array[
    'public.create_legal_document_template(public.legal_document_type,public.legal_document_role,text,text,text,text)',
    'public.create_legal_template_version(uuid,text,text,text,text,text,date)',
    'public.submit_legal_template_version_for_review(uuid)',
    'public.publish_legal_template_version(uuid)',
    'public.supersede_legal_template_version(uuid)'
  ];
begin
  -- tables exist.
  if to_regclass('public.legal_document_templates') is null then raise exception 'assert: legal_document_templates missing'; end if;
  if to_regclass('public.legal_document_template_versions') is null then raise exception 'assert: legal_document_template_versions missing'; end if;

  -- enums present with expected labels.
  if not exists (select 1 from pg_type where typname='legal_document_role') then raise exception 'assert: legal_document_role enum missing'; end if;
  if not exists (select 1 from pg_type where typname='legal_document_type') then raise exception 'assert: legal_document_type enum missing'; end if;
  if not exists (select 1 from pg_type where typname='legal_template_status') then raise exception 'assert: legal_template_status enum missing'; end if;
  foreach sig in array array['draft','legal_review','published','superseded','draft_blocked'] loop
    if not exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='legal_template_status' and e.enumlabel=sig) then
      raise exception 'assert: legal_template_status missing label %', sig; end if;
  end loop;
  foreach sig in array array['partner','contractor','lead_referrer'] loop
    if not exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='legal_document_role' and e.enumlabel=sig) then
      raise exception 'assert: legal_document_role missing label %', sig; end if;
  end loop;

  -- RLS enabled on both.
  if not (select relrowsecurity from pg_class where oid='public.legal_document_templates'::regclass) then raise exception 'assert: RLS off on legal_document_templates'; end if;
  if not (select relrowsecurity from pg_class where oid='public.legal_document_template_versions'::regclass) then raise exception 'assert: RLS off on legal_document_template_versions'; end if;

  -- owner-only policies; no anon grant; SELECT to authenticated.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='legal_document_templates' and policyname='legal_document_templates_owner_all') then
    raise exception 'assert: legal_document_templates owner policy missing'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='legal_document_template_versions' and policyname='legal_template_versions_owner_all') then
    raise exception 'assert: legal_template_versions owner policy missing'; end if;
  if exists (select 1 from information_schema.role_table_grants
      where table_schema='public' and table_name in ('legal_document_templates','legal_document_template_versions') and grantee='anon') then
    raise exception 'assert: legal registry must not be granted to anon'; end if;

  -- key constraints + partial-unique current index.
  if not exists (select 1 from pg_constraint where conname='legal_document_templates_identity_uniq') then raise exception 'assert: template identity unique missing'; end if;
  if not exists (select 1 from pg_constraint where conname='legal_template_versions_version_uniq') then raise exception 'assert: version unique missing'; end if;
  if not exists (select 1 from pg_constraint where conname='legal_template_versions_published_requires_approval') then raise exception 'assert: published-requires-approval check missing'; end if;
  if not exists (select 1 from pg_constraint where conname='legal_template_versions_current_only_published') then raise exception 'assert: current-only-published check missing'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='uniq_legal_template_current_per_template') then raise exception 'assert: one-current-per-template partial index missing'; end if;

  -- immutability + delete + truncate guards attached.
  if not exists (select 1 from pg_trigger where tgname='enforce_published_legal_version_immutable') then raise exception 'assert: published-immutability trigger missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='block_issued_legal_version_delete') then raise exception 'assert: issued-version DELETE guard missing'; end if;
  if (select count(*) from pg_trigger where tgname='block_legal_registry_truncate') <> 2 then raise exception 'assert: expected 2 TRUNCATE guards'; end if;

  -- storage bucket + policy.
  if not exists (select 1 from storage.buckets where id='legal-template-sources' and public=false) then raise exception 'assert: private legal-template-sources bucket missing'; end if;
  if not exists (select 1 from pg_policy where polrelid='storage.objects'::regclass and polname='legal_template_sources_owner_all') then raise exception 'assert: legal-template-sources owner RLS missing'; end if;

  -- functions: DEFINER + pinned search_path; grant matrix.
  foreach sig in array definer_fns loop
    if to_regprocedure(sig) is null then raise exception 'assert: % missing', sig; end if;
    select p.prosecdef as is_def,
           exists(select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%') as sp
      into r from pg_proc p where p.oid = sig::regprocedure;
    if not r.is_def then raise exception 'assert: % not SECURITY DEFINER', sig; end if;
    if not r.sp then raise exception 'assert: % search_path not pinned', sig; end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.publish_legal_template_version(uuid)', 'execute') then
    raise exception 'assert: authenticated cannot execute publish_legal_template_version'; end if;
  if has_function_privilege('anon', 'public.publish_legal_template_version(uuid)', 'execute') then
    raise exception 'assert: anon can execute publish_legal_template_version'; end if;

  raise notice 'Build 41: legal template registry structural assertions passed (2 tables, 3 enums, RLS/policies, constraints, guards, bucket, 5 RPCs, grant matrix).';
end $$;

-- ===========================================================================
-- 12. Behavioural assertions — a rolled-back publish → immutability → supersede
--     exercise under the owner's auth context. Skips cleanly if no owner profile
--     is resolvable (structural asserts still stand). All test rows are rolled
--     back via the ROLLBACK_TEST_DATA sentinel. (The freshly-CREATEd enums are
--     usable in this same transaction — no 55P04 dry-run guard needed.)
-- ===========================================================================
do $$
declare
  v_owner uuid; v_tid uuid; v_v1 uuid; v_v2 uuid; v_res jsonb; v_hash text; v_cur int;
begin
  select id into v_owner from public.profiles where role='owner' limit 1;
  if v_owner is null then
    raise notice 'Build 41: behavioural assertions skipped (no owner profile).';
    return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    -- create a logical template.
    v_tid := (public.create_legal_document_template(
      'nda'::public.legal_document_type, 'partner'::public.legal_document_role,
      'Fund Now Capital (Pty) Ltd', 'Build 41 Rollback NDA', 'ZA', 'behavioural test')).id;

    -- a version with NO content is born draft_blocked (§2 — never fabricated).
    if (public.create_legal_template_version(v_tid, '0.1')).status <> 'draft_blocked' then
      raise exception 'assert: empty version should be draft_blocked'; end if;

    -- v1.0 with inline markdown → draft, hash auto-computed.
    v_v1 := (public.create_legal_template_version(v_tid, '1.0', '# Placeholder execution copy (test)')).id;
    select content_sha256 into v_hash
      from public.legal_document_template_versions where id=v_v1;
    if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then raise exception 'assert: markdown hash not auto-computed'; end if;

    -- publish v1.0 → published + current + approver stamped.
    v_res := public.publish_legal_template_version(v_v1);
    if (v_res->>'to') <> 'published' then raise exception 'assert: v1.0 publish (%)', v_res; end if;
    if not exists (select 1 from public.legal_document_template_versions
        where id=v_v1 and status='published' and is_current and approver=v_owner
          and approval_time is not null and effective_date is not null and content_sha256 is not null) then
      raise exception 'assert: v1.0 not fully published/current/stamped'; end if;

    -- a published version rejects a content edit (§4.13 immutability).
    begin
      update public.legal_document_template_versions set content_markdown='# tampered' where id=v_v1;
      raise exception 'assert: published content edit was allowed';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not ilike '%immutable%' then raise exception 'assert: wrong immutability error: %', sqlerrm; end if;
    end;

    -- publish v2.0 → supersedes v1.0; exactly one current remains.
    v_v2 := (public.create_legal_template_version(v_tid, '2.0', '# Placeholder execution copy v2 (test)')).id;
    v_res := public.publish_legal_template_version(v_v2);
    if (v_res->>'superseded_version_id') is distinct from v_v1::text then
      raise exception 'assert: v2.0 publish did not supersede v1.0 (%)', v_res; end if;
    if not exists (select 1 from public.legal_document_template_versions
        where id=v_v1 and status='superseded' and not is_current and superseded_by_version_id=v_v2) then
      raise exception 'assert: v1.0 not superseded/linked'; end if;
    select count(*) into v_cur from public.legal_document_template_versions where template_id=v_tid and is_current;
    if v_cur <> 1 then raise exception 'assert: expected exactly 1 current version, found %', v_cur; end if;

    -- draft_blocked cannot be published (no approved wording — §2).
    declare v_blocked uuid;
    begin
      v_blocked := (public.create_legal_template_version(v_tid, '3.0-blocked')).id;
      begin
        perform public.publish_legal_template_version(v_blocked);
        raise exception 'assert: publishing draft_blocked should fail';
      exception when others then
        if sqlerrm like 'assert:%' then raise; end if;
        if sqlerrm not ilike '%draft_blocked%' and sqlerrm not ilike '%no approved content%' then
          raise exception 'assert: wrong draft_blocked publish error: %', sqlerrm; end if;
      end;
    end;

    raise notice 'Build 41: behavioural assertions passed (draft_blocked, publish/current, immutability, supersede).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
