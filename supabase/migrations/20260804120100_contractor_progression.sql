-- Contractor Progression system (Sprint 3, Lane 3a) — Base → Level 3.
--
-- Real business truth (CONTRACTOR.md Feature 3): FNC's direct contractors
-- progress through skill levels Base → Level 3, each carrying a higher monthly
-- petrol/airtime/data reimbursement (Base R7,000 → L1 R9,500 → L2 R12,000 →
-- L3 R14,500). Progression is OWNER-CONTROLLED — Thapelo approves each level-up.
-- This migration ships the auto-tracked progression METRICS (leads submitted,
-- deals funded, FNC gross generated) plus the owner-approved level-up RPC. The
-- metrics accumulate automatically; the level only changes via
-- owner_promote_contractor().
--
-- Identity note (verified against live 2026-08-04): there is no `contractors`
-- HR table live yet (that lands with the ONBOARDING/APPLY HR phase). The only
-- contractor identity that exists is `profiles.role = 'contractor'`, and the
-- money engine already keys `commission_records.contractor_id` → `profiles.id`
-- and lead attribution `leads.attributed_to_contractor_id` = auth.uid(). So
-- `contractor_progression.contractor_id` → `profiles.id` to stay aligned with
-- both. When the HR `contractors` table lands, contractor identity remains the
-- profile id, so no data migration is forced.
--
-- POPIA / S7C: a contractor sees only their OWN progression; the owner sees all.
-- `fnc_gross_generated` is an owner-only promotion metric — it is stored here but
-- masked out of get_contractor_progression() for non-owner callers, and never
-- surfaced on any contractor-facing screen (S7C: contractors never see FNC gross).

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.contractor_progression (
  id uuid primary key default gen_random_uuid(),
  -- The contractor's profile id (= auth.uid()). ON DELETE CASCADE: if the
  -- profile is ever removed, its progression row goes with it.
  contractor_id uuid not null references public.profiles (id) on delete cascade,
  current_level text not null default 'Base'
    check (current_level in ('Base', '1', '2', '3')),
  -- Auto-tracked counters. leads_submitted + deals_funded drive the contractor
  -- progress bar; fnc_gross_generated is owner-only (S7C); modules_completed is
  -- owned/populated by the TRAINING lane (kept here as a reference field,
  -- defaults 0 — this lane never writes it from training tables).
  progression_metrics jsonb not null default jsonb_build_object(
    'leads_submitted', 0,
    'deals_funded', 0,
    'fnc_gross_generated', 0,
    'modules_completed', 0
  ),
  activated_at timestamptz not null default now(),
  promoted_at_l1 timestamptz,
  promoted_at_l2 timestamptz,
  promoted_at_l3 timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One progression record per contractor. Also the ON CONFLICT target used by
  -- the get-or-create paths below.
  constraint contractor_progression_contractor_uniq unique (contractor_id)
);

comment on table public.contractor_progression is
  'Contractor skill-level progression (Base→L3). Metrics auto-tracked; level changed only via owner_promote_contractor(). contractor_id = profiles.id.';

-- keep updated_at fresh on any direct update (RPCs also set it explicitly)
create or replace function public.contractor_progression_touch_updated_at()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_contractor_progression_touch on public.contractor_progression;
create trigger trg_contractor_progression_touch
  before update on public.contractor_progression
  for each row execute function public.contractor_progression_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS + grants (belt-and-braces: writes only via DEFINER RPCs/triggers)
-- ---------------------------------------------------------------------------
alter table public.contractor_progression enable row level security;

-- Owner: full access.
drop policy if exists contractor_progression_owner_all on public.contractor_progression;
create policy contractor_progression_owner_all
  on public.contractor_progression
  for all
  using (public.is_owner())
  with check (public.is_owner());

-- Contractor: read own row only (POPIA). No write policy → contractors cannot
-- mutate their own progression; all writes go through DEFINER functions.
drop policy if exists contractor_progression_read_own on public.contractor_progression;
create policy contractor_progression_read_own
  on public.contractor_progression
  for select
  using (contractor_id = (select auth.uid()));

-- No direct DML from API roles. SELECT is scoped by RLS above; INSERT/UPDATE/
-- DELETE happen only inside SECURITY DEFINER functions owned by postgres.
revoke all on public.contractor_progression from anon, authenticated;
grant select on public.contractor_progression to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Metric triggers
-- ---------------------------------------------------------------------------

-- 3a. Bootstrap: when a profile becomes a contractor, ensure a Base progression
-- row exists (acceptance test #1 — activation creates the row at Base). Runs on
-- INSERT of a contractor profile and on UPDATE into the contractor role. Silent
-- get-or-create; never overwrites an existing row.
create or replace function public.contractor_progression_bootstrap()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.role = 'contractor'
     and (tg_op = 'INSERT' or old.role is distinct from new.role) then
    insert into public.contractor_progression (contractor_id)
    values (new.id)
    on conflict (contractor_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contractor_progression_bootstrap on public.profiles;
create trigger trg_contractor_progression_bootstrap
  after insert or update of role on public.profiles
  for each row execute function public.contractor_progression_bootstrap();

-- 3b. Lead attribution: each lead submitted by a contractor increments their
-- leads_submitted counter (acceptance test #2). Only counts attributed leads;
-- owner-created leads (attributed_to_contractor_id null) are ignored.
create or replace function public.contractor_progression_on_lead_insert()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.attributed_to_contractor_id is not null then
    -- get-or-create (a lead could arrive before the bootstrap row on legacy data)
    insert into public.contractor_progression (contractor_id)
    values (new.attributed_to_contractor_id)
    on conflict (contractor_id) do nothing;

    update public.contractor_progression
    set progression_metrics = jsonb_set(
          progression_metrics,
          '{leads_submitted}',
          to_jsonb(coalesce((progression_metrics ->> 'leads_submitted')::int, 0) + 1)
        )
    where contractor_id = new.attributed_to_contractor_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contractor_progression_lead_insert on public.leads;
create trigger trg_contractor_progression_lead_insert
  after insert on public.leads
  for each row execute function public.contractor_progression_on_lead_insert();

-- 3c. Commission settled: when a contractor's commission record reaches the
-- terminal `settled` state (FNC has received and paid out), count one funded
-- deal and add the deal's FNC gross to the running total. Fires only on the
-- transition INTO settled (INSERT already-settled, or UPDATE old<>settled) so a
-- later no-op update never double-counts. Guarded on contractor_id present and
-- a positive contractor_share.
create or replace function public.contractor_progression_on_commission_settled()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.status = 'settled'
     and new.contractor_id is not null
     and coalesce(new.contractor_share, 0) > 0
     and (tg_op = 'INSERT' or old.status is distinct from 'settled') then
    insert into public.contractor_progression (contractor_id)
    values (new.contractor_id)
    on conflict (contractor_id) do nothing;

    update public.contractor_progression
    set progression_metrics = jsonb_set(
          jsonb_set(
            progression_metrics,
            '{deals_funded}',
            to_jsonb(coalesce((progression_metrics ->> 'deals_funded')::int, 0) + 1)
          ),
          '{fnc_gross_generated}',
          to_jsonb(
            coalesce((progression_metrics ->> 'fnc_gross_generated')::numeric, 0)
            + coalesce(new.gross_commission, 0)
          )
        )
    where contractor_id = new.contractor_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contractor_progression_commission_settled on public.commission_records;
create trigger trg_contractor_progression_commission_settled
  after insert or update on public.commission_records
  for each row execute function public.contractor_progression_on_commission_settled();

-- ---------------------------------------------------------------------------
-- 4. Read RPC — get_contractor_progression(p_contractor_id)
-- ---------------------------------------------------------------------------
-- Authz: owner (any contractor) or the contractor themselves (own row only).
-- Get-or-create so the UI never 404s. S7C: fnc_gross_generated is stripped from
-- the metrics for non-owner callers.
create or replace function public.get_contractor_progression(p_contractor_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_is_owner boolean := public.is_owner();
  v_uid uuid := (select auth.uid());
  v_target_role public.user_role;
  v_row public.contractor_progression;
  v_metrics jsonb;
begin
  if p_contractor_id is null then
    raise exception 'contractor id is required' using errcode = '22004';
  end if;

  if not v_is_owner and v_uid is distinct from p_contractor_id then
    raise exception 'not authorized to view this progression' using errcode = '42501';
  end if;

  select role into v_target_role from public.profiles where id = p_contractor_id;
  if v_target_role is null then
    raise exception 'contractor not found' using errcode = 'P0002';
  end if;
  if v_target_role <> 'contractor' then
    raise exception 'user is not a contractor' using errcode = 'P0002';
  end if;

  insert into public.contractor_progression (contractor_id)
  values (p_contractor_id)
  on conflict (contractor_id) do nothing;

  select * into v_row from public.contractor_progression where contractor_id = p_contractor_id;

  v_metrics := v_row.progression_metrics;
  if not v_is_owner then
    -- S7C: contractors never see FNC gross.
    v_metrics := v_metrics - 'fnc_gross_generated';
  end if;

  return jsonb_build_object(
    'contractor_id', v_row.contractor_id,
    'current_level', v_row.current_level,
    'metrics', v_metrics,
    'activated_at', v_row.activated_at,
    'promoted_at_l1', v_row.promoted_at_l1,
    'promoted_at_l2', v_row.promoted_at_l2,
    'promoted_at_l3', v_row.promoted_at_l3,
    'is_owner_view', v_is_owner,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_contractor_progression(uuid) from public, anon;
grant execute on function public.get_contractor_progression(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Owner-approved level-up — owner_promote_contractor(id, level, reason)
-- ---------------------------------------------------------------------------
-- Owner-only. Advisory-locked per contractor. Stamps the target level's
-- promoted_at_l{n}. Writes a CONTRACTOR_PROMOTED audit row (CONTRACTOR.md: every
-- status transition writes to the audit log).
create or replace function public.owner_promote_contractor(
  p_contractor_id uuid,
  p_new_level text,
  p_reason text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_actor_email text;
  v_actor_role text;
  v_target_role public.user_role;
  v_old_level text;
  v_row public.contractor_progression;
begin
  if not public.is_owner() then
    raise exception 'only the owner can promote contractors' using errcode = '42501';
  end if;
  if p_new_level is null or p_new_level not in ('Base', '1', '2', '3') then
    raise exception 'invalid level: %', p_new_level using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to change a contractor''s level' using errcode = '22023';
  end if;

  -- Serialize concurrent promotions of the same contractor.
  perform pg_advisory_xact_lock(hashtextextended(p_contractor_id::text, 0));

  select role into v_target_role from public.profiles where id = p_contractor_id;
  if v_target_role is distinct from 'contractor' then
    raise exception 'user is not a contractor' using errcode = 'P0002';
  end if;

  insert into public.contractor_progression (contractor_id)
  values (p_contractor_id)
  on conflict (contractor_id) do nothing;

  select * into v_row from public.contractor_progression where contractor_id = p_contractor_id;
  v_old_level := v_row.current_level;

  if v_old_level = p_new_level then
    raise exception 'contractor is already at level %', p_new_level using errcode = '22023';
  end if;

  update public.contractor_progression
  set current_level = p_new_level,
      promoted_at_l1 = case when p_new_level = '1' then now() else promoted_at_l1 end,
      promoted_at_l2 = case when p_new_level = '2' then now() else promoted_at_l2 end,
      promoted_at_l3 = case when p_new_level = '3' then now() else promoted_at_l3 end
  where contractor_id = p_contractor_id
  returning * into v_row;

  -- Silent RLS/row-count failsafe (standing rule): the row must have updated.
  if v_row.contractor_id is null then
    raise exception 'promotion failed to update the progression row' using errcode = 'P0001';
  end if;

  -- Audit (owner identity). A logging failure must not silently swallow the
  -- promotion, so this is a plain insert inside the same transaction.
  select email, role::text into v_actor_email, v_actor_role
  from public.profiles where id = v_uid;

  insert into public.activity_logs (
    user_id, user_email, user_role, event_type, entity_type, entity_id,
    description, before_values, after_values, notes
  )
  values (
    v_uid, v_actor_email, v_actor_role, 'CONTRACTOR_PROMOTED',
    'contractor_progression', v_row.id,
    format('Contractor level changed from %s to %s', v_old_level, p_new_level),
    jsonb_build_object('current_level', v_old_level),
    jsonb_build_object('current_level', p_new_level),
    p_reason
  );

  return jsonb_build_object(
    'contractor_id', v_row.contractor_id,
    'current_level', v_row.current_level,
    'previous_level', v_old_level,
    'promoted_at_l1', v_row.promoted_at_l1,
    'promoted_at_l2', v_row.promoted_at_l2,
    'promoted_at_l3', v_row.promoted_at_l3,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.owner_promote_contractor(uuid, text, text) from public, anon;
grant execute on function public.owner_promote_contractor(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Backfill existing contractors at Base
-- ---------------------------------------------------------------------------
insert into public.contractor_progression (contractor_id)
select id from public.profiles where role = 'contractor'
on conflict (contractor_id) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Structural assertions
-- ---------------------------------------------------------------------------
do $$
declare
  v_contractors int;
  v_rows int;
begin
  -- table + unique constraint
  if to_regclass('public.contractor_progression') is null then
    raise exception 'assert: contractor_progression table missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'contractor_progression_contractor_uniq'
      and conrelid = 'public.contractor_progression'::regclass
  ) then
    raise exception 'assert: unique(contractor_id) missing';
  end if;

  -- RLS on + exactly the two expected policies
  if not (select relrowsecurity from pg_class where oid = 'public.contractor_progression'::regclass) then
    raise exception 'assert: RLS not enabled on contractor_progression';
  end if;
  select count(*) into v_rows from pg_policies
  where schemaname = 'public' and tablename = 'contractor_progression';
  if v_rows <> 2 then
    raise exception 'assert: expected 2 policies on contractor_progression, found %', v_rows;
  end if;

  -- triggers present
  if not exists (select 1 from pg_trigger where tgname = 'trg_contractor_progression_bootstrap'
                 and tgrelid = 'public.profiles'::regclass) then
    raise exception 'assert: bootstrap trigger missing on profiles';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_contractor_progression_lead_insert'
                 and tgrelid = 'public.leads'::regclass) then
    raise exception 'assert: lead-insert trigger missing on leads';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_contractor_progression_commission_settled'
                 and tgrelid = 'public.commission_records'::regclass) then
    raise exception 'assert: commission trigger missing on commission_records';
  end if;

  -- RPCs are SECURITY DEFINER
  if not exists (select 1 from pg_proc p join pg_namespace n on p.pronamespace = n.oid
                 where n.nspname = 'public' and p.proname = 'get_contractor_progression' and p.prosecdef) then
    raise exception 'assert: get_contractor_progression missing or not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on p.pronamespace = n.oid
                 where n.nspname = 'public' and p.proname = 'owner_promote_contractor' and p.prosecdef) then
    raise exception 'assert: owner_promote_contractor missing or not SECURITY DEFINER';
  end if;

  -- authenticated has SELECT but no write on the table
  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'contractor_progression'
      and grantee = 'authenticated' and privilege_type = 'SELECT'
  ) then
    raise exception 'assert: authenticated missing SELECT on contractor_progression';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'contractor_progression'
      and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'assert: authenticated must not have write grants on contractor_progression';
  end if;

  -- backfill: one Base row per contractor profile
  select count(*) into v_contractors from public.profiles where role = 'contractor';
  select count(*) into v_rows from public.contractor_progression;
  if v_rows < v_contractors then
    raise exception 'assert: backfill incomplete — % contractor rows for % contractors', v_rows, v_contractors;
  end if;
  if exists (select 1 from public.contractor_progression where current_level <> 'Base') then
    raise exception 'assert: backfilled rows must start at Base';
  end if;

  raise notice 'contractor_progression assertions passed (% contractors, % rows)', v_contractors, v_rows;
end;
$$;
