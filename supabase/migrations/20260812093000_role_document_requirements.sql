-- Spec PR 3 — Role document requirements (activation packages).
-- ============================================================================
-- Canonical spec: FNC-CANONICAL-LEGAL-DOCUMENTS-ESIGN-ONBOARDING-SPEC-2026-08-12
-- (§3 role packages, §6.2 activation gate). Audit map graded this capability
-- MISSING: the existing document_requirement_rules is PRODUCT/FUNDER/DEAL-scoped
-- (which client docs a funding product needs), NOT ROLE-scoped (which agreements
-- a partner/contractor/lead-referrer must EXECUTE to activate). This adds the
-- role-scoped model, reusing that table's required/optional/waived vocabulary.
--
-- What this models: the per-role LEGAL package — the set of agreement TYPES from
-- the Build-41 legal_document_type enum that a role must sign, with an
-- activation_required flag (§6.2: activation blocked until every activation_required
-- document is executed) and a signing order. It is STRUCTURE only — it references
-- document TYPES, never wording, and it does not itself gate anything yet (the
-- e-sign backend / onboarding RPC consume it later).
--
-- NOT here (deliberate scope):
--   * The contractor 17-document KYC upload checklist (ID/proof/SARS/banking) —
--     that is the verification-checklist build (Build 31/32), a different concern.
--   * Client packages (NDA / Mandate / Authority-Consent) — those types are not in
--     the legal_document_type enum yet (it is partner/contractor/lead-referrer
--     oriented); adding them is a separate enum migration in the client-package PR.
--     The table permits applies_to_role='client' structurally; no client rows seed.
--   * The parent-partner id — that is captured per-instance on the agreement /
--     invitation, not on this reusable requirement template. The sub-lead-referrer
--     package is selected here via referrer_path='partner_sub_lead'.
--
-- Security: RLS owner-only on the table (config, owner-managed — mirrors
-- document_requirement_rules). Reads for the onboarding flow go through the
-- DEFINER resolver. Writes are owner-gated DEFINER RPCs; table DML revoked from
-- API roles. New empty table ⇒ inline constraints/indexes are lock-free.
-- ============================================================================

-- ===========================================================================
-- 1. role_document_requirements — one row per (role, referrer-path, doc-type).
-- ===========================================================================
create table if not exists public.role_document_requirements (
  id                  uuid primary key default gen_random_uuid(),
  applies_to_role     public.user_role not null,           -- partner / contractor / lead_referrer / client
  -- Only meaningful for lead_referrer: distinguishes Path A (FNC-direct) from
  -- Path B (Bright Destiny sub-lead). NULL = path-agnostic (applies to both, or a
  -- non-lead-referrer role).
  referrer_path       text,
  document_type       public.legal_document_type not null, -- the agreement TYPE required (structure, not wording)
  requirement         text not null default 'required',    -- required / optional / waived (document_requirement_rules vocabulary)
  activation_required boolean not null default true,       -- §6.2: must be executed before the role activates
  signing_order       integer,                             -- §6.2 presentation/signing order
  countersign_required boolean not null default true,      -- FNC countersigns (§6.2)
  notes               text,
  is_active           boolean not null default true,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint role_document_requirements_requirement_ck
    check (requirement in ('required', 'optional', 'waived')),
  constraint role_document_requirements_referrer_path_ck
    check (referrer_path is null or referrer_path in ('direct', 'partner_sub_lead')),
  -- A referrer_path only makes sense for the lead_referrer role.
  constraint role_document_requirements_path_only_lead_referrer
    check (referrer_path is null or applies_to_role = 'lead_referrer')
);

comment on table public.role_document_requirements is
  'Role-scoped activation package (spec PR 3, §3/§6.2): which agreement TYPES a role must execute to activate. Structure only — references legal_document_type, never wording. Owner-only RLS; onboarding reads via the DEFINER resolver.';
comment on column public.role_document_requirements.referrer_path is
  'lead_referrer only: direct (Path A / FNC-direct) vs partner_sub_lead (Path B / Bright Destiny). NULL = path-agnostic. Parent-partner id is per-instance, not here.';

-- One logical requirement per (role, path, type); NULL path folded to '' so the
-- key is enforced even for path-agnostic rows (Postgres treats NULLs as distinct).
create unique index if not exists role_doc_req_key
  on public.role_document_requirements (applies_to_role, coalesce(referrer_path, ''), document_type);
create index if not exists idx_role_doc_req_role
  on public.role_document_requirements (applies_to_role) where is_active;

drop trigger if exists role_document_requirements_set_updated_at on public.role_document_requirements;
create trigger role_document_requirements_set_updated_at
  before update on public.role_document_requirements
  for each row execute function public.set_updated_at();

alter table public.role_document_requirements enable row level security;
drop policy if exists role_document_requirements_owner_all on public.role_document_requirements;
create policy role_document_requirements_owner_all on public.role_document_requirements
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

revoke all on table public.role_document_requirements from anon, public, authenticated;
grant select on table public.role_document_requirements to authenticated;

-- ===========================================================================
-- 2. Resolver — the package a role signs. DEFINER so the onboarding flow can read
--    it without owner rights; returns active, non-waived rows, path-filtered for
--    lead_referrer (a NULL-path row applies to both paths).
-- ===========================================================================
create or replace function public.resolve_role_document_package(
  p_role          public.user_role,
  p_referrer_path text default null
) returns table (
  document_type        public.legal_document_type,
  requirement          text,
  activation_required  boolean,
  signing_order        integer,
  countersign_required boolean,
  notes                text
)
language sql stable security definer set search_path = '' as $$
  select r.document_type, r.requirement, r.activation_required, r.signing_order,
         r.countersign_required, r.notes
    from public.role_document_requirements r
   where r.applies_to_role = p_role
     and r.is_active
     and r.requirement <> 'waived'
     and (
       p_role <> 'lead_referrer'
       or r.referrer_path is null
       or r.referrer_path = p_referrer_path
     )
   order by r.signing_order nulls last, r.document_type;
$$;

comment on function public.resolve_role_document_package(public.user_role, text) is
  'Returns the active, non-waived agreement package for a role (spec §3). For lead_referrer, filters by referrer_path (NULL-path rows apply to both paths). DEFINER — readable by the onboarding flow.';

-- ===========================================================================
-- 3. Owner management RPCs. Upsert on the logical key; toggle active.
-- ===========================================================================
create or replace function public.set_role_document_requirement(
  p_applies_to_role     public.user_role,
  p_document_type       public.legal_document_type,
  p_referrer_path       text    default null,
  p_requirement         text    default 'required',
  p_activation_required boolean default true,
  p_signing_order       integer default null,
  p_countersign_required boolean default true,
  p_notes               text    default null
) returns public.role_document_requirements
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_path text := nullif(btrim(coalesce(p_referrer_path,'')),''); v_row public.role_document_requirements;
begin
  if not public.is_owner() then raise exception 'Only the owner can set role document requirements'; end if;
  if p_requirement not in ('required','optional','waived') then
    raise exception 'requirement must be required/optional/waived (got %)', p_requirement; end if;
  if v_path is not null and v_path not in ('direct','partner_sub_lead') then
    raise exception 'referrer_path must be direct/partner_sub_lead (got %)', v_path; end if;
  if v_path is not null and p_applies_to_role <> 'lead_referrer' then
    raise exception 'referrer_path only applies to the lead_referrer role'; end if;

  insert into public.role_document_requirements
    (applies_to_role, referrer_path, document_type, requirement, activation_required,
     signing_order, countersign_required, notes, is_active, created_by)
  values
    (p_applies_to_role, v_path, p_document_type, p_requirement, p_activation_required,
     p_signing_order, p_countersign_required, nullif(btrim(coalesce(p_notes,'')),''), true, v_uid)
  on conflict (applies_to_role, coalesce(referrer_path, ''), document_type) do update
    set requirement = excluded.requirement,
        activation_required = excluded.activation_required,
        signing_order = excluded.signing_order,
        countersign_required = excluded.countersign_required,
        notes = excluded.notes,
        is_active = true,
        updated_at = now()
  returning * into v_row;
  if v_row.id is null then raise exception 'Role document requirement was not written'; end if;

  insert into public.activity_logs
    (occurred_at, user_id, user_role, event_type, entity_type, entity_id, description, after_values)
  values (now(), v_uid, 'owner', 'UPDATE', 'role_document_requirement', v_row.id,
          'Set role document requirement: ' || v_row.applies_to_role::text ||
            coalesce(' / ' || v_row.referrer_path, '') || ' → ' || v_row.document_type::text,
          jsonb_build_object('applies_to_role', v_row.applies_to_role, 'referrer_path', v_row.referrer_path,
                             'document_type', v_row.document_type, 'requirement', v_row.requirement,
                             'activation_required', v_row.activation_required));
  return v_row;
end $$;

comment on function public.set_role_document_requirement(public.user_role, public.legal_document_type, text, text, boolean, integer, boolean, text) is
  'Owner-only: upsert a role''s required agreement type on the (role, path, type) key. Activity-logged, RETURNING-checked.';

create or replace function public.set_role_document_requirement_active(p_id uuid, p_active boolean)
returns public.role_document_requirements
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_row public.role_document_requirements;
begin
  if not public.is_owner() then raise exception 'Only the owner can change role document requirements'; end if;
  if p_active is null then raise exception 'active flag is required'; end if;
  update public.role_document_requirements set is_active = p_active, updated_at = now()
   where id = p_id returning * into v_row;
  if v_row.id is null then raise exception 'Role document requirement % not found', p_id; end if;

  insert into public.activity_logs
    (occurred_at, user_id, user_role, event_type, entity_type, entity_id, description, after_values)
  values (now(), v_uid, 'owner', 'UPDATE', 'role_document_requirement', v_row.id,
          (case when p_active then 'Activated' else 'Deactivated' end) || ' role document requirement',
          jsonb_build_object('is_active', v_row.is_active));
  return v_row;
end $$;

comment on function public.set_role_document_requirement_active(uuid, boolean) is
  'Owner-only: activate/deactivate a role document requirement. Activity-logged, RETURNING-checked.';

-- ===========================================================================
-- 4. Grants matrix (FIX-A posture).
-- ===========================================================================
do $$
declare fn text;
  fns constant text[] := array[
    'resolve_role_document_package(public.user_role, text)',
    'set_role_document_requirement(public.user_role, public.legal_document_type, text, text, boolean, integer, boolean, text)',
    'set_role_document_requirement_active(uuid, boolean)'
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
-- 5. Seed the core role packages from spec §3 (owner-approved package structure —
--    agreement TYPE labels only, never wording). Core activation-gating agreements
--    per role; the optional extras (acceptable_use_policy, annexure, code_of_conduct,
--    information_security_acknowledgement) are owner-added later via the RPC.
--    Idempotent on the logical key.
-- ===========================================================================
insert into public.role_document_requirements
  (applies_to_role, referrer_path, document_type, requirement, activation_required, signing_order, countersign_required)
values
  -- Referral partner (§3.4)
  ('partner', null, 'referral_partner_agreement', 'required', true, 1, true),
  ('partner', null, 'nda',                        'required', true, 2, true),
  ('partner', null, 'popia_agreement',            'required', true, 3, true),
  ('partner', null, 'commission_schedule',        'required', true, 4, true),
  -- Contractor (§3.3)
  ('contractor', null, 'independent_contractor_agreement', 'required', true, 1, true),
  ('contractor', null, 'nda',                              'required', true, 2, true),
  ('contractor', null, 'popia_agreement',                  'required', true, 3, true),
  ('contractor', null, 'commission_schedule',              'required', true, 4, true),
  -- Direct lead referrer (§3.2, Path A)
  ('lead_referrer', 'direct', 'lead_referrer_agreement', 'required', true, 1, true),
  ('lead_referrer', 'direct', 'nda',                     'required', true, 2, true),
  ('lead_referrer', 'direct', 'popia_agreement',         'required', true, 3, true),
  ('lead_referrer', 'direct', 'commission_schedule',     'required', true, 4, true),
  -- Partner sub-lead referrer (§3.5, Path B)
  ('lead_referrer', 'partner_sub_lead', 'lead_referrer_agreement', 'required', true, 1, true),
  ('lead_referrer', 'partner_sub_lead', 'nda',                     'required', true, 2, true),
  ('lead_referrer', 'partner_sub_lead', 'popia_agreement',         'required', true, 3, true),
  ('lead_referrer', 'partner_sub_lead', 'commission_schedule',     'required', true, 4, true)
on conflict (applies_to_role, coalesce(referrer_path, ''), document_type) do nothing;

-- ===========================================================================
-- 6. Structural assertions.
-- ===========================================================================
do $$
declare sig text; v_cnt int;
  fns constant text[] := array[
    'public.resolve_role_document_package(public.user_role,text)',
    'public.set_role_document_requirement(public.user_role,public.legal_document_type,text,text,boolean,integer,boolean,text)',
    'public.set_role_document_requirement_active(uuid,boolean)'
  ];
begin
  if to_regclass('public.role_document_requirements') is null then raise exception 'assert: table missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.role_document_requirements'::regclass) then
    raise exception 'assert: RLS off'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='role_document_requirements' and policyname='role_document_requirements_owner_all') then
    raise exception 'assert: owner policy missing'; end if;
  if exists (select 1 from information_schema.role_table_grants
      where table_schema='public' and table_name='role_document_requirements' and grantee='anon') then
    raise exception 'assert: must not be granted to anon'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='role_doc_req_key') then
    raise exception 'assert: logical-key unique index missing'; end if;
  if not exists (select 1 from pg_constraint where conname='role_document_requirements_path_only_lead_referrer') then
    raise exception 'assert: path-only-lead-referrer check missing'; end if;

  foreach sig in array fns loop
    if to_regprocedure(sig) is null then raise exception 'assert: % missing', sig; end if;
    if not (select prosecdef from pg_proc where oid = sig::regprocedure) then
      raise exception 'assert: % not SECURITY DEFINER', sig; end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.resolve_role_document_package(public.user_role,text)', 'execute') then
    raise exception 'assert: authenticated cannot execute the resolver'; end if;

  -- seeds present: 16 core rows (4 roles/paths × 4 agreements).
  select count(*) into v_cnt from public.role_document_requirements where requirement='required' and activation_required;
  if v_cnt < 16 then raise exception 'assert: expected >=16 seeded package rows, found %', v_cnt; end if;

  raise notice 'Spec PR 3 role_document_requirements: structural assertions passed (table, RLS, resolver + 2 owner RPCs, 16 seeded package rows).';
end $$;

-- ===========================================================================
-- 7. Behavioural assertions — owner upsert + resolver + active toggle, rolled
--    back. Uses code_of_conduct (NOT seeded) so it never collides with a seed.
-- ===========================================================================
do $$
declare v_owner uuid; v_id uuid; v_cnt int;
begin
  select id into v_owner from public.profiles where role='owner' limit 1;
  if v_owner is null then
    raise notice 'Spec PR 3 role_document_requirements: behavioural assertions skipped (no owner profile).';
    return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    -- Upsert a new requirement for the contractor package.
    v_id := (public.set_role_document_requirement(
      'contractor'::public.user_role, 'code_of_conduct'::public.legal_document_type,
      null, 'required', true, 5, true, 'behavioural test')).id;

    -- Resolver returns it (active).
    select count(*) into v_cnt from public.resolve_role_document_package('contractor'::public.user_role)
     where document_type = 'code_of_conduct';
    if v_cnt <> 1 then raise exception 'assert: resolver did not return the new requirement'; end if;

    -- Deactivate → resolver excludes it.
    perform public.set_role_document_requirement_active(v_id, false);
    select count(*) into v_cnt from public.resolve_role_document_package('contractor'::public.user_role)
     where document_type = 'code_of_conduct';
    if v_cnt <> 0 then raise exception 'assert: resolver returned a deactivated requirement'; end if;

    -- Path filter: a partner_sub_lead package row must not leak into the direct path.
    perform public.set_role_document_requirement(
      'lead_referrer'::public.user_role, 'annexure'::public.legal_document_type,
      'partner_sub_lead', 'required', false, 9, false, 'sub-lead only');
    select count(*) into v_cnt from public.resolve_role_document_package('lead_referrer'::public.user_role, 'direct')
     where document_type = 'annexure';
    if v_cnt <> 0 then raise exception 'assert: sub-lead-only requirement leaked into the direct path'; end if;
    select count(*) into v_cnt from public.resolve_role_document_package('lead_referrer'::public.user_role, 'partner_sub_lead')
     where document_type = 'annexure';
    if v_cnt <> 1 then raise exception 'assert: sub-lead requirement not returned for its own path'; end if;

    -- referrer_path on a non-lead-referrer role is rejected.
    begin
      perform public.set_role_document_requirement(
        'contractor'::public.user_role, 'annexure'::public.legal_document_type, 'direct');
      raise exception 'assert: referrer_path on contractor was allowed';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not ilike '%only applies to the lead_referrer%' then
        raise exception 'assert: wrong path-role error: %', sqlerrm; end if;
    end;

    raise notice 'Spec PR 3 role_document_requirements: behavioural assertions passed (upsert, resolve, active toggle, path filter, role guard).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
