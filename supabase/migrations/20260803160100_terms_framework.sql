-- Terms & Conditions Acceptance Framework (Sprint 4, Lane 4d) — part 2 of 2.
-- ============================================================================
-- Real business truth: FNC's referral partners (Doctor / Bright Destiny) and
-- direct contractors must accept the platform Terms & Conditions on first login,
-- and re-accept whenever the owner publishes a new version. POPIA requires the
-- acceptance record to be version-controlled and auditable — WHO accepted WHICH
-- version, WHEN, and from what context — held as immutable legal evidence.
--
-- This migration creates:
--   1. terms_config      — one private row holding a random per-database salt
--                          used to hash client IPs (POPIA: raw IP never stored).
--   2. terms_versions    — version-controlled T&C documents (markdown), each
--                          scoped to the roles that must accept it, with one
--                          "current" flag per publish. PUBLIC read of the current
--                          version (so the un-authenticated /terms/current viewer
--                          and the FNC website footer link can render it); owner
--                          writes only.
--   3. terms_acceptances_ledger — append-only, immutable acceptance evidence.
--                          UNIQUE (user_id, terms_version_id) prevents duplicate
--                          acceptances; writes only via the DEFINER accept_terms
--                          RPC; user reads own rows, owner reads all.
--   4. RPCs: accept_terms / get_current_terms_for_role /
--            check_user_has_accepted_current.
--   5. Trigger terms_versions_notify_updated → emits TERMS_UPDATED (part 1) to
--      every active applicable user when a version becomes current.
--   6. Seed: an initial "v1.0" current version applying to partner + contractor.
--
-- Security posture (project non-negotiables + FIX-A grants hygiene):
--   * RLS on every table from day one.
--   * accept_terms is SECURITY DEFINER: it attributes the acceptance to the
--     CALLER (auth.uid()) — a caller can never record an acceptance for anyone
--     else — hashes the client IP SERVER-SIDE (see below), writes the audit row,
--     and is idempotent (already-accepted ⇒ clean no-op).
--   * ip_hash is derived SERVER-SIDE inside the RPC from the real client IP that
--     PostgREST exposes in request.headers (x-forwarded-for) — the genuine
--     PR #111 technique. Server derivation is preferred over the client-supplied
--     p_ip_hash because a browser value is forgeable and the browser cannot see
--     its own public IP without leaking it to a third party. The client value is
--     kept only as a best-effort fallback for the rare case where no header IP is
--     resolvable. Either way the raw IP is NEVER stored — only a salted SHA-256.
--   * The AUTHORITATIVE evidence is the server-set trio user_id (auth.uid()),
--     accepted_at (now()), and terms_version_id; ip_hash + user_agent are
--     supplementary context.
--   * Grants matrix: authenticated/postgres/service_role on the RPCs (accept /
--     check are not owner-gated — partners + contractors call them; get_current
--     is public info and also granted to anon for the /terms/current viewer).
--     anon/PUBLIC EXECUTE is revoked everywhere it is not needed.
--
-- EMPTY-TABLE RATIONALE (picker / contractor-applications precedent): every
-- table here is created empty, so inline PK/FK/indexes are metadata-only with no
-- write-blocking lock — the NOT VALID / CREATE INDEX CONCURRENTLY discipline is
-- for POPULATED tables and buys nothing here.
-- ============================================================================

-- ===========================================================================
-- 1. terms_config — private single-row salt for the IP hash.
--    RLS on + zero policies + zero API grants → unreachable by anon/authenticated.
--    The DEFINER accept_terms RPC (owned by postgres) reads it, bypassing RLS.
--    A per-database random salt (never in source) keeps the IP hashes from being
--    dictionary-reversible over the ~4-billion IPv4 space — the same POPIA intent
--    the /apply endpoint documents, satisfied here without a deploy-time secret.
-- ===========================================================================
create table if not exists public.terms_config (
  id         boolean primary key default true,
  ip_salt    text not null,
  created_at timestamptz not null default now(),
  -- Single-row guard: the PK is a constant `true`, so a second insert conflicts.
  constraint terms_config_singleton check (id = true)
);

comment on table public.terms_config is
  'Private single-row config for the terms framework. Holds a random per-database salt used to hash client IPs in the acceptance ledger (POPIA: raw IP never stored, salt never in source). RLS on, no policy, no API grants — read only by the DEFINER accept_terms RPC.';

insert into public.terms_config (id, ip_salt)
  values (true, encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (id) do nothing;

alter table public.terms_config enable row level security;
revoke all on table public.terms_config from anon, public, authenticated;

-- ===========================================================================
-- 2. terms_versions — version-controlled T&C documents.
-- ===========================================================================
create table if not exists public.terms_versions (
  id               uuid primary key default gen_random_uuid(),
  version_number   text not null unique,               -- e.g. 'v1.0', 'v1.1'
  effective_date   date not null default current_date,
  content_markdown text not null,
  applies_to_roles public.user_role[] not null,        -- which roles MUST accept
  is_current       boolean not null default false,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- A version must apply to at least one role.
  constraint terms_versions_roles_nonempty check (cardinality(applies_to_roles) > 0)
);

comment on table public.terms_versions is
  'Version-controlled platform Terms & Conditions (markdown). applies_to_roles = the roles that must accept this version. Owner publishes new versions and flips is_current (admin UI deferred — owner edits via SQL/Dashboard for now); becoming current fires TERMS_UPDATED. PUBLIC may read the current version(s) (the /terms/current viewer + website footer); owner writes only.';
comment on column public.terms_versions.is_current is
  'True for the live version. Becoming current fires terms_versions_notify_updated → TERMS_UPDATED to applicable users. Publish discipline: unset the prior current for overlapping roles when setting a new one.';

create index if not exists idx_terms_versions_current on public.terms_versions (is_current) where is_current;

drop trigger if exists terms_versions_set_updated_at on public.terms_versions;
create trigger terms_versions_set_updated_at
  before update on public.terms_versions
  for each row execute function public.set_updated_at();

-- RLS: (a) PUBLIC (anon + authenticated) may read the current version(s); this
-- is deliberate — the T&Cs are public-facing. (b) The owner has full access.
alter table public.terms_versions enable row level security;
drop policy if exists terms_versions_public_read_current on public.terms_versions;
create policy terms_versions_public_read_current on public.terms_versions
  for select to anon, authenticated using (is_current = true);
drop policy if exists terms_versions_owner_all on public.terms_versions;
create policy terms_versions_owner_all on public.terms_versions
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Grants: read for anon + authenticated (RLS narrows anon/non-owner to current
-- rows). No write grant to authenticated — the owner publishes via SQL/Dashboard
-- (postgres/service_role, which bypass grants) until the admin UI lands; the
-- owner_all policy is the belt-and-braces boundary a future admin write PR will
-- pair with a grant.
revoke all on table public.terms_versions from anon, public, authenticated;
grant select on table public.terms_versions to anon, authenticated;

-- ===========================================================================
-- 3. terms_acceptances_ledger — immutable acceptance evidence.
-- ===========================================================================
create table if not exists public.terms_acceptances_ledger (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id),
  terms_version_id uuid not null references public.terms_versions(id),
  accepted_at      timestamptz not null default now(),
  ip_hash          text,                    -- salted SHA-256 of client IP (POPIA)
  user_agent       text,
  created_at       timestamptz not null default now(),
  -- One acceptance per (user, version). Real: prevents duplicate acceptances and
  -- makes accept_terms idempotent via ON CONFLICT DO NOTHING.
  constraint terms_acceptances_ledger_uniq unique (user_id, terms_version_id)
);

comment on table public.terms_acceptances_ledger is
  'Append-only, immutable POPIA acceptance evidence: WHO (user_id = auth.uid()) accepted WHICH version, WHEN (accepted_at), with supplementary ip_hash (salted SHA-256, raw IP never stored) + user_agent context. Written ONLY by the DEFINER accept_terms RPC. UPDATE/DELETE blocked by a trigger (immutable except via an explicit owner support action that disables the trigger). User reads own rows; owner reads all.';

create index if not exists idx_terms_acceptances_user on public.terms_acceptances_ledger (user_id);
create index if not exists idx_terms_acceptances_version on public.terms_acceptances_ledger (terms_version_id);

-- Immutability: block every UPDATE and DELETE. accept_terms only ever INSERTs,
-- so nothing legitimate is affected. A genuine owner correction (a "support
-- case") is done by temporarily disabling this trigger — deliberate, auditable,
-- never a routine path.
create or replace function public.terms_acceptances_immutable()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  raise exception 'terms_acceptances_ledger is immutable (POPIA legal evidence); % is not permitted', tg_op;
end $$;
revoke all on function public.terms_acceptances_immutable() from public, anon, authenticated;

drop trigger if exists terms_acceptances_ledger_immutable on public.terms_acceptances_ledger;
create trigger terms_acceptances_ledger_immutable
  before update or delete on public.terms_acceptances_ledger
  for each row execute function public.terms_acceptances_immutable();

-- RLS: user reads own; owner reads all. NO insert/update/delete policy — writes
-- go through the DEFINER RPC only (service-role/definer bypass RLS).
alter table public.terms_acceptances_ledger enable row level security;
drop policy if exists terms_acceptances_read_own on public.terms_acceptances_ledger;
create policy terms_acceptances_read_own on public.terms_acceptances_ledger
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists terms_acceptances_owner_read on public.terms_acceptances_ledger;
create policy terms_acceptances_owner_read on public.terms_acceptances_ledger
  for select to authenticated using (public.is_owner());

revoke all on table public.terms_acceptances_ledger from anon, public, authenticated;
grant select on table public.terms_acceptances_ledger to authenticated;

-- ===========================================================================
-- 4. RPC: get_current_terms_for_role(p_role) → the current terms_versions row.
--    Public info (used by the modal AND, indirectly, the public viewer). No auth
--    gate. Returns the newest current version that applies to the role.
-- ===========================================================================
create or replace function public.get_current_terms_for_role(p_role public.user_role)
returns public.terms_versions
language sql
stable
security definer
set search_path to ''
as $$
  select tv.*
  from public.terms_versions tv
  where tv.is_current = true
    and p_role = any(tv.applies_to_roles)
  order by tv.effective_date desc, tv.created_at desc
  limit 1
$$;

comment on function public.get_current_terms_for_role(public.user_role) is
  'Returns the current terms_versions row applicable to p_role (newest effective_date). Public info — granted to anon + authenticated.';

-- ===========================================================================
-- 5. RPC: check_user_has_accepted_current(p_user_id, p_role) → boolean.
--    True when the user has accepted the current version for that role, OR there
--    is no current version to accept (nothing should block them). Authz: the
--    caller must be that user, or the owner.
-- ===========================================================================
create or replace function public.check_user_has_accepted_current(p_user_id uuid, p_role public.user_role)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_version_id uuid;
begin
  if (select auth.uid()) is distinct from p_user_id and not public.is_owner() then
    raise exception 'Not authorized to read another user''s acceptance status';
  end if;

  select id into v_version_id from public.get_current_terms_for_role(p_role);
  if v_version_id is null then
    -- No current terms for this role ⇒ nothing to accept ⇒ do not block.
    return true;
  end if;

  return exists (
    select 1 from public.terms_acceptances_ledger
    where user_id = p_user_id and terms_version_id = v_version_id
  );
end $$;

comment on function public.check_user_has_accepted_current(uuid, public.user_role) is
  'True if p_user_id has accepted the current terms version for p_role, or if there is no current version (nothing to accept). Caller must be that user or the owner.';

-- ===========================================================================
-- 6. RPC: accept_terms(p_version_id, p_ip_hash, p_user_agent) → jsonb.
--    Records the CALLER's acceptance of a specific version. Idempotent.
-- ===========================================================================
create or replace function public.accept_terms(
  p_version_id  uuid,
  p_ip_hash     text default null,
  p_user_agent  text default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_salt       text;
  v_headers    text;
  v_ip         text;
  v_ip_hash    text;
  v_ua         text := nullif(btrim(left(coalesce(p_user_agent, ''), 1024)), '');
  v_new_id     uuid;
  v_email      text;
  v_role       text;
  v_version    text;
  v_is_current boolean;
  v_roles      public.user_role[];
begin
  -- Must be a signed-in user; the acceptance is always attributed to THEM.
  if v_uid is null then
    raise exception 'You must be signed in to accept the terms';
  end if;

  -- The version must exist, be CURRENT, and apply to the caller's role. Without
  -- these guards an authenticated user could call the RPC directly with any known
  -- version id (a superseded version, or one scoped to a different role) and
  -- write a misleading immutable ledger + audit row (Macroscope High).
  select version_number, is_current, applies_to_roles
    into v_version, v_is_current, v_roles
    from public.terms_versions where id = p_version_id;
  if v_version is null then
    raise exception 'Unknown terms version %', p_version_id;
  end if;
  if not v_is_current then
    raise exception 'Terms version % is not the current version', p_version_id;
  end if;

  -- Caller's role (also used in the audit row below).
  select email, role into v_email, v_role from public.profiles where id = v_uid;
  if v_role is null or not (v_role::public.user_role = any(v_roles)) then
    raise exception 'These terms do not apply to your role';
  end if;

  -- Serialize a user's concurrent double-clicks (UI useRef guard + unique index
  -- also cover this; this is the DB-layer belt).
  perform pg_advisory_xact_lock(hashtext('accept_terms:' || v_uid::text));

  -- ---- server-side IP hash (preferred) -------------------------------------
  -- Derive from the real client IP PostgREST exposes; fall back to the client
  -- best-effort hash only when no header IP is resolvable. Wrapped so a malformed
  -- header can NEVER break acceptance.
  begin
    select ip_salt into v_salt from public.terms_config limit 1;
    v_headers := current_setting('request.headers', true);
    if v_salt is not null and v_headers is not null and v_headers <> '' then
      v_ip := btrim(split_part(coalesce(
                nullif(v_headers::jsonb ->> 'x-forwarded-for', ''),
                v_headers::jsonb ->> 'x-real-ip', ''), ',', 1));
      if v_ip <> '' then
        v_ip_hash := encode(extensions.digest(v_salt || ':' || v_ip, 'sha256'), 'hex');
      end if;
    end if;
  exception when others then
    v_ip_hash := null;  -- never fail acceptance over IP hashing
  end;
  v_ip_hash := coalesce(v_ip_hash, nullif(btrim(coalesce(p_ip_hash, '')), ''));

  -- ---- idempotent insert ---------------------------------------------------
  insert into public.terms_acceptances_ledger (user_id, terms_version_id, ip_hash, user_agent)
  values (v_uid, p_version_id, v_ip_hash, v_ua)
  on conflict (user_id, terms_version_id) do nothing
  returning id into v_new_id;

  if v_new_id is null then
    -- Already accepted → clean no-op (no second audit row).
    return jsonb_build_object('status', 'already_accepted', 'version_id', p_version_id);
  end if;

  -- Audit only on a genuinely new acceptance (v_email/v_role fetched above).
  insert into public.activity_logs
    (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id, description, after_values)
  values
    (now(), v_uid, v_email, v_role, 'CREATE', 'terms_acceptance', v_new_id,
     'Accepted Terms & Conditions ' || v_version,
     jsonb_build_object('terms_version_id', p_version_id, 'version_number', v_version));

  return jsonb_build_object('status', 'accepted', 'version_id', p_version_id);
end $$;

comment on function public.accept_terms(uuid, text, text) is
  'Records the caller''s (auth.uid()) acceptance of terms version p_version_id. SECURITY DEFINER + advisory lock + server-side salted IP hash (client value = fallback) + activity_logs write. Idempotent: already-accepted returns {status:already_accepted} with no second row.';

-- ===========================================================================
-- 7. Trigger: terms_versions_notify_updated — fire TERMS_UPDATED on publish.
--    Created AFTER the seed insert below, so the initial seed is silent (first
--    login's modal handles first-ever acceptance). Fires only when a version
--    BECOMES current (INSERT current, or UPDATE flipping is_current false→true).
-- ===========================================================================
create or replace function public.terms_versions_notify_updated()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_user record;
begin
  if new.is_current = true
     and (tg_op = 'INSERT' or coalesce(old.is_current, false) = false) then
    for v_user in
      select p.id from public.profiles p
      where p.is_active = true and p.role = any(new.applies_to_roles)
    loop
      perform public.emit_in_app_notification(
        v_user.id,
        'TERMS_UPDATED',
        'Updated Terms & Conditions',
        'Fund Now Capital has published updated Terms & Conditions. Please review and accept them next time you sign in.',
        '/terms/current',
        jsonb_build_object('terms_version_id', new.id, 'version_number', new.version_number));
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.terms_versions_notify_updated() from public, anon, authenticated;

-- ===========================================================================
-- 8. Seed the initial v1.0 (current, applies to partner + contractor). Inserted
--    BEFORE the notify trigger exists → silent. Owner-editable content later.
-- ===========================================================================
insert into public.terms_versions (version_number, effective_date, content_markdown, applies_to_roles, is_current)
select
  'v1.0',
  current_date,
  $md$# Fund Now Capital — Platform Terms & Conditions

**Version 1.0**

_These Terms & Conditions are a starting version to be reviewed and finalised by Fund Now Capital's legal advisor. They govern your use of the Fund Now Capital platform as a referral partner or independent contractor._

## 1. Who these terms apply to

These terms apply to referral partners and independent contractors who are given access to the Fund Now Capital platform. By accepting them you confirm that you have read, understood, and agree to be bound by them.

## 2. Your role

You act as an independent referral partner or contractor. Nothing in these terms creates an employment relationship, partnership, or agency beyond what is expressly agreed in your signed agreement with Fund Now Capital.

## 3. Confidentiality

Information you access through the platform — including client details, funder information, and commercial terms — is confidential. You may use it only to perform your role and must not disclose it to any third party.

## 4. Protection of personal information (POPIA)

You will handle all personal information in accordance with the Protection of Personal Information Act, 2013 (POPIA). You will collect, use, and share personal information only as necessary for your role and only with the consent required by law.

## 5. Fair dealing and compliance

You will act honestly and in good faith, will not misrepresent Fund Now Capital, its funders, or any funding product, and will comply with all applicable South African laws and regulations, including the National Credit Act and FAIS where relevant.

## 6. Commissions and reimbursements

Any commissions, reimbursements, or bonuses are governed by your signed agreement with Fund Now Capital. These platform terms do not vary the financial terms of that agreement.

## 7. Acceptable use

You will keep your login credentials secure, will not share access, and will use the platform only for its intended purpose. Fund Now Capital may suspend or withdraw access for any breach of these terms.

## 8. Changes to these terms

Fund Now Capital may publish updated terms from time to time. When a new version is published you will be asked to review and accept it before continuing to use the platform.

## 9. Acceptance

Clicking "I Accept" records your acceptance of this version, together with the date and time of acceptance, as an auditable record.

_Questions about these terms can be directed to Fund Now Capital._
$md$,
  array['partner', 'contractor']::public.user_role[],
  true
where not exists (select 1 from public.terms_versions where version_number = 'v1.0');

-- Now create the publish-notification trigger (future publishes fire it).
drop trigger if exists terms_versions_notify_updated on public.terms_versions;
create trigger terms_versions_notify_updated
  after insert or update on public.terms_versions
  for each row execute function public.terms_versions_notify_updated();

-- ===========================================================================
-- 9. Grants matrix (FIX-A posture — anon/PUBLIC revoked where not needed).
--    get_current_terms_for_role: anon + authenticated (public info).
--    accept_terms / check_user_has_accepted_current: authenticated + service_role
--      + postgres (NOT anon — you must be signed in).
-- ===========================================================================
do $$
declare fn text;
  public_fns constant text[] := array['get_current_terms_for_role(public.user_role)'];
  auth_fns   constant text[] := array[
    'accept_terms(uuid, text, text)',
    'check_user_has_accepted_current(uuid, public.user_role)'
  ];
begin
  foreach fn in array public_fns loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
    execute format('grant execute on function public.%s to postgres', fn);
  end loop;

  foreach fn in array auth_fns loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
    execute format('grant execute on function public.%s to postgres', fn);
  end loop;
end $$;

-- ===========================================================================
-- 10. Structural assertions — RAISE (roll back) on any drift.
-- ===========================================================================
do $$
declare v_cnt int; sig text;
  definer_fns constant text[] := array[
    'public.accept_terms(uuid,text,text)',
    'public.get_current_terms_for_role(public.user_role)',
    'public.check_user_has_accepted_current(uuid,public.user_role)'
  ];
  r record;
begin
  -- tables exist.
  if to_regclass('public.terms_versions') is null then raise exception 'assert: terms_versions missing'; end if;
  if to_regclass('public.terms_acceptances_ledger') is null then raise exception 'assert: terms_acceptances_ledger missing'; end if;
  if to_regclass('public.terms_config') is null then raise exception 'assert: terms_config missing'; end if;

  -- terms_config seeded with exactly one salt row.
  select count(*) into v_cnt from public.terms_config;
  if v_cnt <> 1 then raise exception 'assert: terms_config must hold exactly 1 row, found %', v_cnt; end if;

  -- version_number unique + acceptance uniqueness constraints present.
  if not exists (select 1 from pg_constraint where conrelid='public.terms_versions'::regclass and contype='u') then
    raise exception 'assert: terms_versions unique(version_number) missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid='public.terms_acceptances_ledger'::regclass and conname='terms_acceptances_ledger_uniq') then
    raise exception 'assert: terms_acceptances_ledger_uniq missing'; end if;

  -- RLS enabled on all three.
  if not (select relrowsecurity from pg_class where oid='public.terms_versions'::regclass) then raise exception 'assert: RLS off on terms_versions'; end if;
  if not (select relrowsecurity from pg_class where oid='public.terms_acceptances_ledger'::regclass) then raise exception 'assert: RLS off on terms_acceptances_ledger'; end if;
  if not (select relrowsecurity from pg_class where oid='public.terms_config'::regclass) then raise exception 'assert: RLS off on terms_config'; end if;

  -- terms_config has zero policies and no anon/authenticated grants.
  select count(*) into v_cnt from pg_policies where schemaname='public' and tablename='terms_config';
  if v_cnt <> 0 then raise exception 'assert: terms_config must have 0 policies, found %', v_cnt; end if;
  if exists (select 1 from information_schema.role_table_grants
      where table_schema='public' and table_name='terms_config' and grantee in ('anon','authenticated')) then
    raise exception 'assert: terms_config must not be granted to anon/authenticated'; end if;

  -- terms_versions public-read + owner policies present; anon has SELECT grant.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='terms_versions' and policyname='terms_versions_public_read_current') then
    raise exception 'assert: terms_versions public-read policy missing'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='terms_versions' and policyname='terms_versions_owner_all') then
    raise exception 'assert: terms_versions owner policy missing'; end if;
  if not exists (select 1 from information_schema.role_table_grants
      where table_schema='public' and table_name='terms_versions' and grantee='anon' and privilege_type='SELECT') then
    raise exception 'assert: anon SELECT grant on terms_versions missing'; end if;

  -- ledger: read-own + owner-read policies; no write policy; immutability trigger.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='terms_acceptances_ledger' and policyname='terms_acceptances_read_own') then
    raise exception 'assert: ledger read-own policy missing'; end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='terms_acceptances_ledger' and cmd in ('INSERT','UPDATE','DELETE')) then
    raise exception 'assert: ledger must have NO write policy (DEFINER-only writes)'; end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.terms_acceptances_ledger'::regclass and tgname='terms_acceptances_ledger_immutable') then
    raise exception 'assert: ledger immutability trigger missing'; end if;

  -- seed: exactly one current v1.0 applying to partner + contractor.
  if not exists (select 1 from public.terms_versions where version_number='v1.0' and is_current=true
      and 'partner'::public.user_role = any(applies_to_roles) and 'contractor'::public.user_role = any(applies_to_roles)) then
    raise exception 'assert: v1.0 seed missing/incorrect'; end if;

  -- functions: DEFINER + pinned search_path.
  foreach sig in array definer_fns loop
    if to_regprocedure(sig) is null then raise exception 'assert: % missing', sig; end if;
    select p.prosecdef as is_def,
           exists(select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%') as sp
      into r from pg_proc p where p.oid = sig::regprocedure;
    if not r.is_def then raise exception 'assert: % not SECURITY DEFINER', sig; end if;
    if not r.sp then raise exception 'assert: % search_path not pinned', sig; end if;
  end loop;

  -- grants: accept_terms NOT granted to anon/PUBLIC; get_current IS granted to anon.
  if exists (select 1 from information_schema.routine_privileges
      where routine_schema='public' and routine_name='accept_terms' and grantee in ('anon','PUBLIC') and privilege_type='EXECUTE') then
    raise exception 'assert: accept_terms must not be granted to anon/PUBLIC'; end if;
  if not exists (select 1 from information_schema.routine_privileges
      where routine_schema='public' and routine_name='accept_terms' and grantee='authenticated' and privilege_type='EXECUTE') then
    raise exception 'assert: accept_terms missing authenticated EXECUTE'; end if;
  if not exists (select 1 from information_schema.routine_privileges
      where routine_schema='public' and routine_name='get_current_terms_for_role' and grantee='anon' and privilege_type='EXECUTE') then
    raise exception 'assert: get_current_terms_for_role missing anon EXECUTE'; end if;

  raise notice 'Terms framework structural assertions passed (3 tables, RLS/policies, grants matrix, seed, RPCs).';
end $$;

-- ===========================================================================
-- 11. Behavioural assertions — accept flow + idempotency + authz.
--     The TERMS_UPDATED trigger test is guarded to skip in a same-transaction
--     dry-run (the enum value from part 1 is unusable in the same tx it was
--     added → SQLSTATE 55P04) and to run at real apply (parts applied in order).
--     All test rows are rolled back to the block savepoint via ROLLBACK_TEST_DATA.
-- ===========================================================================
do $$
declare
  v_user uuid; v_other uuid; v_ver uuid; v_res jsonb;
begin
  select id into v_user from public.profiles where role in ('partner','contractor') and is_active limit 1;
  if v_user is null then
    raise notice 'Terms framework behavioural assertions skipped (no partner/contractor profile).';
    return;
  end if;
  select id into v_other from public.profiles where id <> v_user and role <> 'owner' limit 1;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

    -- current version for the user's role (test the partner path if available).
    select id into v_ver from public.get_current_terms_for_role(
      (select role from public.profiles where id = v_user));
    if v_ver is null then raise exception 'assert: no current terms for the test user role'; end if;

    -- not yet accepted.
    if public.check_user_has_accepted_current(v_user, (select role from public.profiles where id=v_user)) then
      raise exception 'assert: user should not have accepted yet'; end if;

    -- accept → recorded + audited.
    v_res := public.accept_terms(v_ver, 'client_fallback_hash', 'Mozilla/5.0 (Test)');
    if (v_res->>'status') <> 'accepted' then raise exception 'assert: first accept not accepted (%)', v_res; end if;
    if not exists (select 1 from public.terms_acceptances_ledger where user_id=v_user and terms_version_id=v_ver) then
      raise exception 'assert: acceptance row missing'; end if;
    if not exists (select 1 from public.activity_logs where entity_type='terms_acceptance' and event_type='CREATE'
        and (after_values->>'terms_version_id')=v_ver::text and user_id=v_user) then
      raise exception 'assert: acceptance audit row missing'; end if;

    -- idempotent second accept → no-op.
    v_res := public.accept_terms(v_ver, null, null);
    if (v_res->>'status') <> 'already_accepted' then raise exception 'assert: second accept not idempotent (%)', v_res; end if;
    if (select count(*) from public.terms_acceptances_ledger where user_id=v_user and terms_version_id=v_ver) <> 1 then
      raise exception 'assert: duplicate acceptance row written'; end if;

    -- now reports accepted.
    if not public.check_user_has_accepted_current(v_user, (select role from public.profiles where id=v_user)) then
      raise exception 'assert: user should now report accepted'; end if;

    -- accept_terms rejects a non-current version (is_current=false → no notify
    -- trigger fires, so this is dry-run safe).
    declare v_old uuid;
    begin
      insert into public.terms_versions (version_number, effective_date, content_markdown, applies_to_roles, is_current)
      values ('v-superseded-rollback', current_date, '# old', array['partner','contractor']::public.user_role[], false)
      returning id into v_old;
      begin
        perform public.accept_terms(v_old, null, null);
        raise exception 'assert: accepting a non-current version should raise';
      exception when others then if sqlerrm like 'assert:%' then raise; end if;
        if sqlerrm not ilike '%not the current version%' then raise exception 'assert: wrong non-current error: %', sqlerrm; end if; end;
    end;

    -- ledger is immutable: UPDATE + DELETE both raise.
    begin
      update public.terms_acceptances_ledger set user_agent='tamper' where user_id=v_user and terms_version_id=v_ver;
      raise exception 'assert: ledger UPDATE should be blocked';
    exception when others then if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not ilike '%immutable%' then raise exception 'assert: wrong immutability error: %', sqlerrm; end if; end;

    -- authz: a non-owner other user cannot probe this user's status.
    if v_other is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
      begin
        perform public.check_user_has_accepted_current(v_user, 'partner'::public.user_role);
        raise exception 'assert: cross-user probe should be denied';
      exception when others then if sqlerrm like 'assert:%' then raise; end if;
        if sqlerrm not ilike '%authorized%' then raise exception 'assert: wrong authz error: %', sqlerrm; end if; end;
      perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
    end if;

    -- publish-notification trigger: fire only if TERMS_UPDATED is usable
    -- (real apply). In a same-tx dry-run this raises 55P04 → treat as skip.
    begin
      insert into public.terms_versions (version_number, effective_date, content_markdown, applies_to_roles, is_current)
      values ('v-test-rollback', current_date, '# test', array['partner','contractor']::public.user_role[], true);
      if not exists (select 1 from public.notifications where event_type='TERMS_UPDATED') then
        raise exception 'assert: TERMS_UPDATED notification not emitted on publish'; end if;
      raise notice 'Terms framework publish-notification test passed (TERMS_UPDATED emitted).';
    exception
      when others then
        if sqlstate = '55P04' then
          raise notice 'Terms framework publish-notification test skipped (TERMS_UPDATED unusable in same-tx dry-run).';
        elsif sqlerrm like 'assert:%' then raise;
        else raise;
        end if;
    end;

    raise notice 'Terms framework behavioural assertions passed (accept, idempotency, immutability, authz).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception
    when others then if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
