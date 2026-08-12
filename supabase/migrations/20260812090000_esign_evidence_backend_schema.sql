-- PR A / spec PR 7 — E-Sign Evidence Backend (SCHEMA half).
-- ============================================================================
-- Canonical spec: FNC-CANONICAL-LEGAL-DOCUMENTS-ESIGN-ONBOARDING-SPEC-2026-08-12.
-- Audit map: docs/legal/AUDIT-MAP-LEGAL-ESIGN-WAVE-2026-08-12.md.
--
-- This is the greenfield e-signature / execution / evidence layer identified as
-- entirely MISSING by the §19 audit. It builds the MACHINERY only (spec §3.2 —
-- "document, invitation, signature, storage, gate, audit machinery"): it
-- manufactures NO legal wording (that lives on the Build-41 template registry and
-- is ingested from the approved PDFs in a later content PR).
--
-- Objects (this file = schema; the lifecycle RPCs are the sibling …090100 file):
--   agreement_instances          — one agreement taken through the signing state
--                                  machine; references a published Build-41
--                                  template version; snapshots its subject anchors.
--   agreement_party_snapshots    — FROZEN party details captured at send (§11.2).
--   agreement_variable_snapshots — FROZEN variables + fee jsonb captured at send.
--   signature_requests           — the hash-only MAGIC-LINK carrier, one per signer
--                                  (the missing magic-link primitive; §13).
--   signature_events             — APPEND-ONLY signing audit ledger (§7.4 evidence).
--   signature_artifacts          — private signature vector/raster hash + path (§5.4).
--   executed_document_artifacts  — executed PDF + evidence certificate (§7.4).
--   consent_records              — APPEND-ONLY acknowledgements / POPIA notice (§7.2,§9).
--
-- DELIBERATE DEVIATION FROM SPEC §11 — no organization_id. This CRM is single-org
-- (owner == Fund Now Capital); a repo-wide search finds ZERO organization_id usage.
-- Inventing a multi-org column would fabricate a system that does not exist
-- (CLAUDE.md: never invent). Scoping is owner / subject_profile / client, matching
-- every other table here. Revisit only if the CRM ever becomes multi-tenant.
--
-- Storage: artifact tables carry storage-PATH text columns only. The five private
-- legal-* buckets (legal-executed, legal-signature-artifacts, legal-evidence-
-- certificates, …) are created in the buckets/source-asset PR (spec PR 1); this
-- backend writes no bytes yet, so the columns hold paths that later PRs populate.
--
-- Security posture (CLAUDE.md non-negotiables + FIX-A grants hygiene):
--   * RLS on every table from creation. Owner full; the signing subject reads own;
--     the client reads its own package. No partner cross-visibility of another
--     party's contract (spec §2.5/§12.3 — Doctor never sees a Lead Refer's contract).
--   * All mutation is DEFINER-RPC only (…090100). Table DML is revoked from every
--     API role; there is no anon path.
--   * The evidence ledgers (events/artifacts/consent) are APPEND-ONLY at the DB
--     layer (UPDATE/DELETE/TRUNCATE blocked) — a hard invariant even a future RPC
--     bug cannot bypass. Frozen party/variable snapshots are immutable after send.
--
-- EMPTY-TABLE RATIONALE: every table is created empty, so inline PK/FK/unique/index
-- are metadata-only with no write-blocking lock (the terms_framework / Build-41
-- precedent) — the NOT VALID / CONCURRENTLY discipline is for POPULATED tables.
-- Fresh CREATE TYPE labels are usable in this same transaction (no 55P04 risk).
-- ============================================================================

-- ===========================================================================
-- 0. Enums.
-- ===========================================================================
do $$
begin
  -- The §7.3 signing state machine plus its exceptional terminal/branch states.
  if not exists (select 1 from pg_type where typname = 'agreement_state') then
    create type public.agreement_state as enum (
      'draft',              -- owner is assembling the package
      'approved_for_send',  -- owner approved; not yet dispatched
      'sent',               -- dispatched; snapshots frozen; magic link live
      'viewed',             -- a signer opened the link
      'in_progress',        -- a signer began completing fields
      'signer_signed',      -- the signing party has signed
      'countersign_pending',-- awaiting FNC countersignature
      'executed',           -- fully executed (terminal-success)
      'expired',            -- link/period lapsed
      'declined',           -- a party declined
      'withdrawn',          -- owner withdrew
      'superseded',         -- replaced by a corrected instance
      'delivery_failed',    -- dispatch failed
      'identity_failed'     -- identity/auth check failed
    );
  end if;

  -- Who a snapshot party is in the signing (§6.2 signing order + §9 data subject).
  if not exists (select 1 from pg_type where typname = 'agreement_party_role') then
    create type public.agreement_party_role as enum (
      'signer', 'countersignatory', 'data_subject', 'witness'
    );
  end if;

  -- §7.1 signature methods. system_applied is the owner-policy auto-countersign.
  if not exists (select 1 from pg_type where typname = 'signature_method') then
    create type public.signature_method as enum (
      'drawn', 'typed', 'uploaded', 'system_applied'
    );
  end if;

  -- Append-only ledger event vocabulary (§7.4). Covers every lifecycle transition
  -- plus delivery/access events for the evidence certificate.
  if not exists (select 1 from pg_type where typname = 'signature_event_type') then
    create type public.signature_event_type as enum (
      'created', 'approved_for_send', 'sent', 'viewed', 'in_progress',
      'progress_saved', 'consent_recorded', 'signer_signed', 'countersign_pending',
      'countersigned', 'executed', 'expired', 'declined', 'withdrawn', 'superseded',
      'delivery_failed', 'identity_failed', 'downloaded', 'accessed'
    );
  end if;
end $$;

-- Human-facing reference sequence (AGR-1000, AGR-1001, …). Owner-only visibility
-- via the parent table's RLS; the sequence itself carries no PII.
create sequence if not exists public.agreement_ref_seq start with 1000;

-- ===========================================================================
-- 1. agreement_instances — the signing state machine row.
-- ===========================================================================
create table if not exists public.agreement_instances (
  id                   uuid primary key default gen_random_uuid(),
  reference            text not null default ('AGR-' || lpad(nextval('public.agreement_ref_seq')::text, 4, '0')),
  -- The published Build-41 template version being executed. RESTRICT: a template
  -- version that has agreements against it can never be hard-deleted.
  template_version_id  uuid not null references public.legal_document_template_versions(id) on delete restrict,
  document_type        public.legal_document_type not null,   -- snapshot from the template at create
  title_snapshot       text not null,                          -- human title captured at create
  -- Subject anchors — who/what this agreement is for. At least one must be set.
  -- subject_profile_id is the NON-OWNER signing party (partner/contractor/
  -- lead_referrer/client user). client_id/deal_id/lead_id anchor client packages.
  client_id            uuid references public.clients(id) on delete restrict,
  deal_id              uuid references public.deals(id) on delete restrict,
  lead_id              uuid references public.leads(id) on delete restrict,
  subject_profile_id   uuid references public.profiles(id) on delete restrict,
  referral_partner_id  uuid references public.referral_partners(id) on delete set null,  -- attribution / parent partner
  state                public.agreement_state not null default 'draft',
  -- Evidence hashes (lowercase 64-hex). unsigned = the frozen pre-execution
  -- snapshot; executed = the flattened final PDF. Both stamped by RPCs.
  unsigned_sha256      text,
  executed_sha256      text,
  -- Lifecycle timestamps (each stamped once by the owning transition).
  frozen_at            timestamptz,   -- snapshots frozen at send
  sent_at              timestamptz,
  first_viewed_at      timestamptz,
  signer_signed_at     timestamptz,
  countersign_pending_at timestamptz,
  executed_at          timestamptz,
  terminal_at          timestamptz,   -- expired/declined/withdrawn/superseded/*_failed
  expires_at           timestamptz,   -- magic-link / signing window (default 7 days at send)
  decline_reason       text,
  withdraw_reason      text,
  -- Correction chain (strictly backward — enforced by trigger below).
  supersedes_agreement_id   uuid references public.agreement_instances(id),
  superseded_by_agreement_id uuid references public.agreement_instances(id),
  -- §13 idempotency: a retried create with the same key returns the same instance.
  idempotency_key      text,
  created_by           uuid references public.profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint agreement_instances_reference_uniq unique (reference),
  constraint agreement_instances_subject_present
    check (num_nonnulls(client_id, subject_profile_id, lead_id) >= 1),
  constraint agreement_instances_no_self_supersede
    check (supersedes_agreement_id is null or supersedes_agreement_id <> id),
  constraint agreement_instances_no_self_superseded_by
    check (superseded_by_agreement_id is null or superseded_by_agreement_id <> id),
  constraint agreement_instances_unsigned_sha_format
    check (unsigned_sha256 is null or unsigned_sha256 ~ '^[0-9a-f]{64}$'),
  constraint agreement_instances_executed_sha_format
    check (executed_sha256 is null or executed_sha256 ~ '^[0-9a-f]{64}$'),
  -- An executed agreement must carry its full execution evidence (belt-and-braces
  -- alongside the countersign RPC's guards).
  constraint agreement_instances_executed_requires_evidence
    check (
      state <> 'executed'
      or (executed_at is not null and unsigned_sha256 is not null and executed_sha256 is not null)
    )
);

comment on table public.agreement_instances is
  'One agreement taken through the §7.3 signing state machine (PR A / spec PR 7). References a published Build-41 template version; snapshots its subject anchors. NO legal wording. Owner-full RLS; signing subject + client read own; writes via DEFINER RPCs only. Single-org: no organization_id by design.';
comment on column public.agreement_instances.subject_profile_id is
  'The non-owner signing party (partner/contractor/lead_referrer/client user). A partner never gains read on another party''s agreement — no cross-visibility (spec §2.5/§12.3).';
comment on column public.agreement_instances.idempotency_key is
  'Optional §13 idempotency key: a retried create_agreement_instance with the same key returns the existing row instead of a duplicate.';

create index if not exists idx_agreement_instances_state on public.agreement_instances (state);
create index if not exists idx_agreement_instances_client on public.agreement_instances (client_id) where client_id is not null;
create index if not exists idx_agreement_instances_subject on public.agreement_instances (subject_profile_id) where subject_profile_id is not null;
create index if not exists idx_agreement_instances_deal on public.agreement_instances (deal_id) where deal_id is not null;
create index if not exists idx_agreement_instances_template_version on public.agreement_instances (template_version_id);
-- §13 idempotency: at most one instance per non-null key.
create unique index if not exists uniq_agreement_idempotency_key
  on public.agreement_instances (idempotency_key) where idempotency_key is not null;

drop trigger if exists agreement_instances_set_updated_at on public.agreement_instances;
create trigger agreement_instances_set_updated_at
  before update on public.agreement_instances
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2. agreement_party_snapshots — frozen party details (§11.2).
-- ===========================================================================
create table if not exists public.agreement_party_snapshots (
  id                uuid primary key default gen_random_uuid(),
  agreement_id      uuid not null references public.agreement_instances(id) on delete cascade,
  party_role        public.agreement_party_role not null,
  party_order       integer not null default 1,   -- signing order (§6.2)
  legal_name        text not null,
  represented_party text,                          -- the entity the person signs for
  capacity          text,                          -- title / authority to bind
  email             text,
  mobile            text,
  profile_id        uuid references public.profiles(id),  -- the platform user, if any
  is_fnc            boolean not null default false,       -- true for the FNC countersignatory
  frozen            boolean not null default false,       -- set true at send; immutable thereafter
  created_at        timestamptz not null default now(),
  constraint agreement_party_snapshots_order_uniq unique (agreement_id, party_order),
  constraint agreement_party_snapshots_name_nonblank check (btrim(legal_name) <> '')
);

comment on table public.agreement_party_snapshots is
  'Party details FROZEN at send (§11.2). Immutable once frozen=true (trigger). Owner + any readable-agreement party may read.';

create index if not exists idx_agreement_party_agreement on public.agreement_party_snapshots (agreement_id);

-- ===========================================================================
-- 3. agreement_variable_snapshots — frozen variables + fee (§11.2, §5.3).
--    One row per agreement; the fee jsonb is populated by the success-fee PR.
-- ===========================================================================
create table if not exists public.agreement_variable_snapshots (
  id             uuid primary key default gen_random_uuid(),
  agreement_id   uuid not null references public.agreement_instances(id) on delete cascade,
  variables      jsonb not null default '{}'::jsonb,  -- frozen variable map (§5.3)
  fee_summary    jsonb,                                -- frozen success-fee (spec PR 4 fills this)
  snapshot_sha256 text,                                -- 64-hex hash of the frozen variables
  frozen         boolean not null default false,       -- set true at send; immutable thereafter
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint agreement_variable_snapshots_agreement_uniq unique (agreement_id),
  constraint agreement_variable_snapshots_sha_format
    check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$')
);

comment on table public.agreement_variable_snapshots is
  'Variables + fee FROZEN at send (§11.2). Immutable once frozen=true. The fee_summary jsonb is filled by the client mandate success-fee PR (spec PR 4); this backend only freezes whatever it holds.';

create index if not exists idx_agreement_variable_agreement on public.agreement_variable_snapshots (agreement_id);

drop trigger if exists agreement_variable_snapshots_set_updated_at on public.agreement_variable_snapshots;
create trigger agreement_variable_snapshots_set_updated_at
  before update on public.agreement_variable_snapshots
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 4. signature_requests — the hash-only MAGIC-LINK carrier (§13), one per signer.
--    Mirrors the client_invitation_tokens primitive: only the SHA-256 of the raw
--    token is ever stored; the raw token is returned once by send_agreement and
--    lives only in the delivery email.
-- ===========================================================================
create table if not exists public.signature_requests (
  id                uuid primary key default gen_random_uuid(),
  agreement_id      uuid not null references public.agreement_instances(id) on delete cascade,
  party_snapshot_id uuid not null references public.agreement_party_snapshots(id) on delete cascade,
  token_hash        text not null,   -- SHA-256 of the raw magic-link token (never the raw token)
  recipient_email_hash text,         -- hashed recipient email (abuse control; not the address)
  issued_at         timestamptz not null default now(),
  expires_at        timestamptz not null,
  revoked_at        timestamptz,
  revoked_by        uuid references public.profiles(id),
  last_opened_at    timestamptz,
  consumed_at       timestamptz,     -- set when the party signs (single-consume)
  delivery_status   text not null default 'pending',
  auth_method       text,            -- how the signer was authenticated (magic_link/session)
  created_at        timestamptz not null default now(),
  constraint signature_requests_token_hash_uniq unique (token_hash),
  constraint signature_requests_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint signature_requests_delivery_status_ck
    check (delivery_status in ('pending','sent','delivered','failed','bounced'))
);

comment on table public.signature_requests is
  'Hash-only magic-link carrier (§13), one per signer party. Stores only the SHA-256 of the raw token. Owner + the subject party read; consumed once at signing.';

create index if not exists idx_signature_requests_agreement on public.signature_requests (agreement_id);
create index if not exists idx_signature_requests_party on public.signature_requests (party_snapshot_id);

-- ===========================================================================
-- 5. signature_events — APPEND-ONLY signing audit ledger (§7.4 evidence).
-- ===========================================================================
create table if not exists public.signature_events (
  id                uuid primary key default gen_random_uuid(),
  agreement_id      uuid not null references public.agreement_instances(id) on delete cascade,
  event_type        public.signature_event_type not null,
  party_snapshot_id uuid references public.agreement_party_snapshots(id),  -- null for system events
  actor_profile_id  uuid references public.profiles(id),                   -- null = party-via-link/system
  occurred_at       timestamptz not null default now(),
  ip_hash           text,                 -- hashed network evidence (kept private; §7.4)
  user_agent_hash   text,
  signature_method  public.signature_method,   -- set on signer_signed / countersigned
  consent_text_version text,                    -- set on consent_recorded
  detail            jsonb,
  created_at        timestamptz not null default now()
);

comment on table public.signature_events is
  'Append-only signing audit ledger (§7.4). UPDATE/DELETE/TRUNCATE blocked at the DB layer. Owner + any readable-agreement party may read (audit transparency).';

create index if not exists idx_signature_events_agreement on public.signature_events (agreement_id, occurred_at desc);
create index if not exists idx_signature_events_type on public.signature_events (event_type, occurred_at desc);

-- ===========================================================================
-- 6. signature_artifacts — private signature vector/raster hash + path (§5.4).
--    "Do not store a reusable raw signature in a public bucket" — we store a hash
--    and a path into the (later-created) private legal-signature-artifacts bucket.
-- ===========================================================================
create table if not exists public.signature_artifacts (
  id                uuid primary key default gen_random_uuid(),
  agreement_id      uuid not null references public.agreement_instances(id) on delete cascade,
  party_snapshot_id uuid not null references public.agreement_party_snapshots(id) on delete cascade,
  method            public.signature_method not null,
  artifact_sha256   text,                 -- 64-hex hash of the signature vector/raster
  storage_path      text,                 -- path in the private legal-signature-artifacts bucket
  adopted_text      text,                 -- for typed signatures: the adopted name
  created_at        timestamptz not null default now(),
  constraint signature_artifacts_sha_format
    check (artifact_sha256 is null or artifact_sha256 ~ '^[0-9a-f]{64}$')
);

comment on table public.signature_artifacts is
  'Private signature vector/raster hash + storage path (§5.4). Append-only. Owner + the signing party read; never exposed to other parties.';

create index if not exists idx_signature_artifacts_agreement on public.signature_artifacts (agreement_id);

-- ===========================================================================
-- 7. executed_document_artifacts — executed PDF + evidence certificate (§7.4).
--    One row per agreement, written at countersign/execute.
-- ===========================================================================
create table if not exists public.executed_document_artifacts (
  id                   uuid primary key default gen_random_uuid(),
  agreement_id         uuid not null references public.agreement_instances(id) on delete cascade,
  executed_pdf_path    text,
  executed_pdf_sha256  text,   -- 64-hex of the flattened executed PDF
  certificate_path     text,
  certificate_sha256   text,   -- 64-hex of the evidence certificate
  unsigned_sha256      text,   -- links the pre-execution snapshot to the executed copy
  certificate_reference text,  -- human verification reference
  executed_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  constraint executed_document_artifacts_agreement_uniq unique (agreement_id),
  constraint executed_document_artifacts_certref_uniq unique (certificate_reference),
  constraint executed_document_artifacts_pdf_sha_format
    check (executed_pdf_sha256 is null or executed_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  constraint executed_document_artifacts_cert_sha_format
    check (certificate_sha256 is null or certificate_sha256 ~ '^[0-9a-f]{64}$'),
  constraint executed_document_artifacts_unsigned_sha_format
    check (unsigned_sha256 is null or unsigned_sha256 ~ '^[0-9a-f]{64}$')
);

comment on table public.executed_document_artifacts is
  'Executed PDF + evidence certificate (§7.4), one per agreement. Append-only. Owner + subject + client read.';

create index if not exists idx_executed_artifacts_agreement on public.executed_document_artifacts (agreement_id);

-- ===========================================================================
-- 8. consent_records — APPEND-ONLY acknowledgements / POPIA notice (§7.2, §9).
--    §9: "record the exact notice version presented." No pre-ticked boxes — the
--    accepted flag is whatever the party actually chose (marketing may be false).
-- ===========================================================================
create table if not exists public.consent_records (
  id                uuid primary key default gen_random_uuid(),
  agreement_id      uuid not null references public.agreement_instances(id) on delete cascade,
  party_snapshot_id uuid references public.agreement_party_snapshots(id),
  consent_kind      text not null,
  notice_version    text,          -- the exact notice/consent text version presented (§9)
  accepted          boolean not null,
  ip_hash           text,
  user_agent_hash   text,
  recorded_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint consent_records_kind_ck check (consent_kind in (
    'signer_identity',      -- §7.2.1 named signatory / authorised representative
    'reviewed_document',    -- §7.2.2 reviewed the full document + schedules
    'intent_to_bind',       -- §7.2.3 intends the e-signature to bind
    'electronic_delivery',  -- §7.2.4 consents to electronic delivery/retention
    'popia_processing',     -- §7.2.5 / §9 POPIA purpose, recipients, rights, retention
    'marketing_optional'    -- §9 separate optional marketing consent (never bundled)
  )),
  constraint consent_records_unique_kind unique (agreement_id, party_snapshot_id, consent_kind)
);

comment on table public.consent_records is
  'Append-only consent/acknowledgement ledger (§7.2, §9). Records the exact notice version presented; marketing consent is separate and never pre-ticked. Owner + subject + client read.';

create index if not exists idx_consent_records_agreement on public.consent_records (agreement_id);

-- ===========================================================================
-- 9. Read-authorisation helper. SECURITY DEFINER so it bypasses RLS to evaluate
--    the parent agreement's read scope once, reused by every child table's RLS.
--    Scope: owner OR the signing subject OR the owning client. NO partner cross-
--    visibility (spec §2.5/§12.3).
-- ===========================================================================
create or replace function public.can_read_agreement(p_agreement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.agreement_instances ai
    where ai.id = p_agreement_id
      and (
        public.is_owner()
        or ai.subject_profile_id = (select auth.uid())
        or (ai.client_id is not null and ai.client_id = public.current_client_id())
      )
  );
$$;

comment on function public.can_read_agreement(uuid) is
  'True if the caller may read the given agreement: owner, the signing subject, or the owning client. No partner cross-visibility (spec §2.5/§12.3). Used by child-table RLS.';

revoke all on function public.can_read_agreement(uuid) from public, anon;
grant execute on function public.can_read_agreement(uuid) to authenticated, service_role, postgres;

-- ===========================================================================
-- 10. RLS + grants. Every table: RLS on, writes revoked from all API roles
--     (DEFINER-RPC-only), SELECT granted to authenticated and narrowed by policy.
-- ===========================================================================

-- agreement_instances: owner full; subject reads own; client reads own package.
alter table public.agreement_instances enable row level security;
drop policy if exists agreement_instances_owner_all on public.agreement_instances;
create policy agreement_instances_owner_all on public.agreement_instances
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists agreement_instances_subject_read on public.agreement_instances;
create policy agreement_instances_subject_read on public.agreement_instances
  for select to authenticated using (subject_profile_id = (select auth.uid()));
drop policy if exists agreement_instances_client_read on public.agreement_instances;
create policy agreement_instances_client_read on public.agreement_instances
  for select to authenticated using (client_id is not null and client_id = public.current_client_id());
revoke all on table public.agreement_instances from anon, public, authenticated;
grant select on table public.agreement_instances to authenticated;

-- Child tables: owner full + can_read_agreement(parent) for SELECT.
do $$
declare t text;
  child_tables constant text[] := array[
    'agreement_party_snapshots', 'agreement_variable_snapshots', 'signature_requests',
    'signature_events', 'signature_artifacts', 'executed_document_artifacts', 'consent_records'
  ];
begin
  foreach t in array child_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())',
      t || '_owner_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_party_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read_agreement(agreement_id))',
      t || '_party_read', t);
    execute format('revoke all on table public.%I from anon, public, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- signature_requests + signature_artifacts hold the most sensitive rows (token
-- hashes, signature images). Tighten their party_read from "any readable-agreement
-- party" down to "the SUBJECT signer only" — a client on a multi-party package has
-- no need to see another signer's token/signature.
drop policy if exists signature_requests_party_read on public.signature_requests;
create policy signature_requests_party_read on public.signature_requests
  for select to authenticated using (
    exists (
      select 1 from public.agreement_instances ai
      where ai.id = signature_requests.agreement_id
        and ai.subject_profile_id = (select auth.uid())
    )
  );
drop policy if exists signature_artifacts_party_read on public.signature_artifacts;
create policy signature_artifacts_party_read on public.signature_artifacts
  for select to authenticated using (
    exists (
      select 1 from public.agreement_instances ai
      where ai.id = signature_artifacts.agreement_id
        and ai.subject_profile_id = (select auth.uid())
    )
  );

-- ===========================================================================
-- 11. Immutability guards.
-- ===========================================================================

-- 11a. Frozen party/variable snapshots are immutable once frozen=true (§11.2).
create or replace function public.enforce_frozen_snapshot_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.frozen then
    raise exception
      'A frozen agreement snapshot (%.% id %) is immutable — supersede the agreement to correct it (§11.2).',
      tg_table_schema, tg_table_name, old.id using errcode = 'restrict_violation';
  end if;
  -- Allowed path: unfrozen row. Return OLD on DELETE (NEW is NULL there and would
  -- silently cancel the delete), NEW on UPDATE.
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists enforce_frozen_party_immutable on public.agreement_party_snapshots;
create trigger enforce_frozen_party_immutable
  before update or delete on public.agreement_party_snapshots
  for each row execute function public.enforce_frozen_snapshot_immutable();
drop trigger if exists enforce_frozen_variable_immutable on public.agreement_variable_snapshots;
create trigger enforce_frozen_variable_immutable
  before update or delete on public.agreement_variable_snapshots
  for each row execute function public.enforce_frozen_snapshot_immutable();

-- 11b. Append-only ledgers: UPDATE/DELETE blocked entirely (§11.2 insert-only).
create or replace function public.block_agreement_ledger_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception
    'Table %.% is an append-only agreement evidence ledger; % is not permitted. Record a compensating event instead (§11.2).',
    tg_table_schema, tg_table_name, tg_op using errcode = 'restrict_violation';
end $$;

do $$
declare t text;
  ledger_tables constant text[] := array[
    'signature_events', 'signature_artifacts', 'executed_document_artifacts', 'consent_records'
  ];
begin
  foreach t in array ledger_tables loop
    execute format('drop trigger if exists %I on public.%I', 'block_' || t || '_mutate', t);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.block_agreement_ledger_write()',
      'block_' || t || '_mutate', t);
  end loop;
end $$;

-- 11c. TRUNCATE guard on every table in the backend (row triggers do not fire on
--      TRUNCATE). Closes the manual-edit gap for the whole evidence set.
create or replace function public.block_agreement_backend_truncate()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Table %.% is agreement evidence and cannot be truncated.',
    tg_table_schema, tg_table_name using errcode = 'restrict_violation';
end $$;

do $$
declare t text;
  all_tables constant text[] := array[
    'agreement_instances', 'agreement_party_snapshots', 'agreement_variable_snapshots',
    'signature_requests', 'signature_events', 'signature_artifacts',
    'executed_document_artifacts', 'consent_records'
  ];
begin
  foreach t in array all_tables loop
    execute format('drop trigger if exists %I on public.%I', 'block_truncate_' || t, t);
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function public.block_agreement_backend_truncate()',
      'block_truncate_' || t, t);
  end loop;
end $$;

-- 11d. Executed/terminal agreement immutability. Once executed, evidence columns
--      freeze and the only onward move is executed -> superseded (a correction).
--      Dead-end terminals (expired/declined/withdrawn/delivery_failed/identity_failed)
--      accept no further change. State-forward legality is enforced by the RPCs;
--      this is the hard backstop.
create or replace function public.enforce_agreement_state_immutability()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.state = 'executed' then
    if new.template_version_id is distinct from old.template_version_id
       or new.unsigned_sha256   is distinct from old.unsigned_sha256
       or new.executed_sha256   is distinct from old.executed_sha256
       or new.executed_at       is distinct from old.executed_at
       or new.client_id         is distinct from old.client_id
       or new.subject_profile_id is distinct from old.subject_profile_id then
      raise exception
        'An executed agreement (%) is immutable; supersede it to issue a correction.',
        old.id using errcode = 'restrict_violation';
    end if;
    if new.state is distinct from old.state and new.state <> 'superseded' then
      raise exception
        'An executed agreement (%) can only transition to superseded, not to %.',
        old.id, new.state using errcode = 'restrict_violation';
    end if;
  elsif old.state in ('expired','declined','withdrawn','superseded','delivery_failed','identity_failed') then
    if new.state is distinct from old.state then
      raise exception
        'Agreement % is in terminal state % and cannot transition to %.',
        old.id, old.state, new.state using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists enforce_agreement_state_immutability on public.agreement_instances;
create trigger enforce_agreement_state_immutability
  before update on public.agreement_instances
  for each row execute function public.enforce_agreement_state_immutability();

-- 11e. Supersession points strictly BACKWARD (a correction replaces an OLDER
--      instance), mirroring the invoice-resubmission trail. Prevents cycles.
create or replace function public.enforce_agreement_supersession_backward()
returns trigger language plpgsql set search_path = '' as $$
declare v_prior_created timestamptz;
begin
  if new.supersedes_agreement_id is not null then
    select created_at into v_prior_created
      from public.agreement_instances where id = new.supersedes_agreement_id;
    if v_prior_created is null then
      raise exception 'supersedes_agreement_id % does not exist', new.supersedes_agreement_id;
    end if;
    if v_prior_created > new.created_at then
      raise exception
        'Supersession must point backward: agreement % cannot supersede newer agreement %.',
        new.id, new.supersedes_agreement_id using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists enforce_agreement_supersession_backward on public.agreement_instances;
create trigger enforce_agreement_supersession_backward
  before insert or update on public.agreement_instances
  for each row execute function public.enforce_agreement_supersession_backward();

-- ===========================================================================
-- 12. Structural assertions — RAISE (roll back) on any drift.
-- ===========================================================================
do $$
declare t text;
  all_tables constant text[] := array[
    'agreement_instances', 'agreement_party_snapshots', 'agreement_variable_snapshots',
    'signature_requests', 'signature_events', 'signature_artifacts',
    'executed_document_artifacts', 'consent_records'
  ];
  enums constant text[] := array[
    'agreement_state', 'agreement_party_role', 'signature_method', 'signature_event_type'
  ];
begin
  foreach t in array all_tables loop
    if to_regclass('public.' || t) is null then raise exception 'assert: table % missing', t; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'assert: RLS off on %', t; end if;
    if exists (select 1 from information_schema.role_table_grants
        where table_schema='public' and table_name=t and grantee='anon') then
      raise exception 'assert: % must not be granted to anon', t; end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname = t || '_owner_all') then
      raise exception 'assert: % owner policy missing', t; end if;
    if not exists (select 1 from pg_trigger where tgname = 'block_truncate_' || t) then
      raise exception 'assert: % TRUNCATE guard missing', t; end if;
  end loop;

  foreach t in array enums loop
    if not exists (select 1 from pg_type where typname = t) then raise exception 'assert: enum % missing', t; end if;
  end loop;
  -- state machine label spot-checks.
  foreach t in array array['draft','sent','signer_signed','countersign_pending','executed','superseded','withdrawn'] loop
    if not exists (select 1 from pg_enum e join pg_type ty on ty.oid=e.enumtypid
        where ty.typname='agreement_state' and e.enumlabel=t) then
      raise exception 'assert: agreement_state missing label %', t; end if;
  end loop;

  -- append-only guards on the four ledgers.
  foreach t in array array['signature_events','signature_artifacts','executed_document_artifacts','consent_records'] loop
    if not exists (select 1 from pg_trigger where tgname = 'block_' || t || '_mutate') then
      raise exception 'assert: append-only guard missing on %', t; end if;
  end loop;

  -- frozen-snapshot + executed-immutability + backward-supersession guards.
  if not exists (select 1 from pg_trigger where tgname='enforce_frozen_party_immutable') then raise exception 'assert: frozen party guard missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='enforce_frozen_variable_immutable') then raise exception 'assert: frozen variable guard missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='enforce_agreement_state_immutability') then raise exception 'assert: executed-immutability guard missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='enforce_agreement_supersession_backward') then raise exception 'assert: backward-supersession guard missing'; end if;

  -- key constraints + idempotency index.
  if not exists (select 1 from pg_constraint where conname='agreement_instances_subject_present') then raise exception 'assert: subject-present check missing'; end if;
  if not exists (select 1 from pg_constraint where conname='agreement_instances_executed_requires_evidence') then raise exception 'assert: executed-evidence check missing'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='uniq_agreement_idempotency_key') then raise exception 'assert: idempotency unique index missing'; end if;
  if not exists (select 1 from pg_constraint where conname='executed_document_artifacts_agreement_uniq') then raise exception 'assert: one-executed-per-agreement unique missing'; end if;

  -- read helper present + DEFINER + pinned.
  if to_regprocedure('public.can_read_agreement(uuid)') is null then raise exception 'assert: can_read_agreement missing'; end if;
  if not (select prosecdef from pg_proc where oid='public.can_read_agreement(uuid)'::regprocedure) then raise exception 'assert: can_read_agreement not DEFINER'; end if;

  raise notice 'PR A e-sign schema: structural assertions passed (8 tables, 4 enums, RLS/policies, append-only + immutability guards, constraints, read helper).';
end $$;

notify pgrst, 'reload schema';
