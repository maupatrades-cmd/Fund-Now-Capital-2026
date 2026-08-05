-- TRAINING lane — Sprint 5 Lane 5a — part 2 of 2: the four SECURITY DEFINER RPCs.
-- ============================================================================
-- Belt-and-braces on every function: DEFINER + search_path='' + explicit role/
-- is_active re-check off profiles + auth.uid()-strict scoping + grants matrix +
-- structural & behavioural assertions. All four are the ONLY write/read path the
-- portal uses (RLS is the backstop, these are the front door).
--
--   1. get_training_modules_for_role()        — list modules for the caller.
--        contractor → published modules; owner → all (future admin preview).
--   2. mark_module_started(p_module_id)        — contractor opens a module.
--   3. mark_module_completed(p_module_id)      — contractor marks it complete.
--   4. get_contractor_training_progress()      — caller-contractor's own rows.
--
-- started_at / completed_at are write-once (first value wins) so re-opening or
-- re-completing never rewrites history. mark_module_completed writes an
-- activity_logs row on first completion (TRAINING.md: completions are audited)
-- using existing enum values (event_type UPDATE, free-text entity_type) — no
-- enum migration needed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Small shared guard: resolve the caller and require contractor + active.
-- Inlined per-function (not a helper) to keep each RPC self-contained and its
-- error message specific.
-- ---------------------------------------------------------------------------

-- 1. get_training_modules_for_role -------------------------------------------
create or replace function public.get_training_modules_for_role()
returns table (
  module_id        uuid,
  module_order     int,
  title            text,
  description      text,
  content_markdown text,
  is_published     boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_role   text;
  v_active boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select p.role, p.is_active into v_role, v_active
  from public.profiles p where p.id = v_uid;

  if v_role is null then
    raise exception 'No profile for caller' using errcode = '42501';
  end if;
  if v_role not in ('contractor', 'owner') then
    raise exception 'Training modules are for contractors' using errcode = '42501';
  end if;
  -- A suspended/deactivated contractor cannot pull training content.
  if v_role = 'contractor' and not coalesce(v_active, false) then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;

  return query
  select m.id, m.module_order, m.title, m.description, m.content_markdown, m.is_published
  from public.training_modules m
  -- Owner previews everything; a contractor sees only published modules.
  where v_role = 'owner' or m.is_published
  order by m.module_order;
end;
$$;

comment on function public.get_training_modules_for_role() is
  'List training modules for the caller. Contractor → published modules; owner → all (preview). DEFINER + role/active-gated. Read-only.';

-- 2. mark_module_started ------------------------------------------------------
create or replace function public.mark_module_started(p_module_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_role   text;
  v_active boolean;
  v_pub    boolean;
  v_row    public.contractor_training_progress;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select p.role, p.is_active into v_role, v_active
  from public.profiles p where p.id = v_uid;
  if v_role is distinct from 'contractor' then
    raise exception 'Only contractors have training progress' using errcode = '42501';
  end if;
  if not coalesce(v_active, false) then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;

  select m.is_published into v_pub from public.training_modules m where m.id = p_module_id;
  if v_pub is null then
    raise exception 'Module % not found', p_module_id using errcode = 'P0002';
  end if;
  if not v_pub then
    raise exception 'Module % is not published', p_module_id using errcode = '42501';
  end if;

  -- Upsert. started_at is write-once (coalesce keeps the original), so this is
  -- idempotent: re-opening a module never resets the first-open timestamp.
  insert into public.contractor_training_progress (contractor_id, module_id, started_at)
  values (v_uid, p_module_id, now())
  on conflict (contractor_id, module_id)
  do update set started_at = coalesce(public.contractor_training_progress.started_at, excluded.started_at)
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Progress row not written (silent RLS?)' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'module_id', v_row.module_id,
    'started_at', v_row.started_at,
    'completed_at', v_row.completed_at);
end;
$$;

comment on function public.mark_module_started(uuid) is
  'Contractor opens a module: upsert progress with a write-once started_at (auth.uid()-scoped). DEFINER + role/active-gated + published-module check. Idempotent.';

-- 3. mark_module_completed ----------------------------------------------------
create or replace function public.mark_module_completed(p_module_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_role      text;
  v_active    boolean;
  v_email     text;
  v_pub       boolean;
  v_title     text;
  v_row       public.contractor_training_progress;
  v_prev_done timestamptz;
  v_newly     boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select p.role, p.is_active, p.email into v_role, v_active, v_email
  from public.profiles p where p.id = v_uid;
  if v_role is distinct from 'contractor' then
    raise exception 'Only contractors have training progress' using errcode = '42501';
  end if;
  if not coalesce(v_active, false) then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;

  select m.is_published, m.title into v_pub, v_title
  from public.training_modules m where m.id = p_module_id;
  if v_pub is null then
    raise exception 'Module % not found', p_module_id using errcode = 'P0002';
  end if;
  if not v_pub then
    raise exception 'Module % is not published', p_module_id using errcode = '42501';
  end if;

  -- Serialise concurrent completions of the SAME (contractor, module) so the
  -- "first completion" detection + its single audit write can't race (a
  -- double-click / two tabs). Cheap xact-scoped advisory lock.
  perform pg_advisory_xact_lock(hashtext('training_complete:' || v_uid::text || ':' || p_module_id::text));

  -- Capture the prior completion state BEFORE the upsert. This — not a now()
  -- comparison — is what makes "newly completed" correct: now() is frozen
  -- within a transaction, so it can't tell first from repeat; the prior stored
  -- value can.
  select completed_at into v_prev_done
  from public.contractor_training_progress
  where contractor_id = v_uid and module_id = p_module_id;

  -- Upsert. completed_at + started_at are write-once (coalesce), so a repeat
  -- call is a clean no-op on the timestamps.
  insert into public.contractor_training_progress (contractor_id, module_id, started_at, completed_at)
  values (v_uid, p_module_id, now(), now())
  on conflict (contractor_id, module_id)
  do update set
    started_at   = coalesce(public.contractor_training_progress.started_at, excluded.started_at),
    completed_at = coalesce(public.contractor_training_progress.completed_at, excluded.completed_at)
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Progress row not written (silent RLS?)' using errcode = 'P0001';
  end if;

  -- Newly completed = it had no completion before this call but does now.
  v_newly := (v_prev_done is null and v_row.completed_at is not null);

  if v_newly then
    -- Audit the completion (TRAINING.md: every completion written to audit_log).
    -- Existing enum values only: event_type UPDATE, free-text entity_type.
    insert into public.activity_logs
      (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id, description, after_values)
    values
      (now(), v_uid, v_email, v_role, 'UPDATE', 'training_module', p_module_id,
       'Completed training module: ' || v_title,
       jsonb_build_object('module_id', p_module_id, 'title', v_title, 'completed_at', v_row.completed_at));
  end if;

  return jsonb_build_object(
    'module_id', v_row.module_id,
    'started_at', v_row.started_at,
    'completed_at', v_row.completed_at,
    'newly_completed', v_newly);
end;
$$;

comment on function public.mark_module_completed(uuid) is
  'Contractor marks a module complete: upsert progress with write-once completed_at (auth.uid()-scoped), audit on first completion. DEFINER + role/active-gated + published-module check. Idempotent.';

-- 4. get_contractor_training_progress ----------------------------------------
create or replace function public.get_contractor_training_progress()
returns table (
  module_id    uuid,
  started_at   timestamptz,
  completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_role   text;
  v_active boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select p.role, p.is_active into v_role, v_active
  from public.profiles p where p.id = v_uid;
  if v_role is distinct from 'contractor' then
    raise exception 'Only contractors have training progress' using errcode = '42501';
  end if;
  if not coalesce(v_active, false) then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;

  return query
  select t.module_id, t.started_at, t.completed_at
  from public.contractor_training_progress t
  where t.contractor_id = v_uid;
end;
$$;

comment on function public.get_contractor_training_progress() is
  'Return the calling contractor''s own training progress rows (auth.uid()-scoped). DEFINER + role/active-gated. Read-only.';

-- ---------------------------------------------------------------------------
-- Grants matrix. All four: authenticated (role-gated inside) + postgres +
-- service_role. anon / PUBLIC revoked (audit FIX-A posture).
-- ---------------------------------------------------------------------------
do $$
declare fn text;
  fns constant text[] := array[
    'get_training_modules_for_role()',
    'mark_module_started(uuid)',
    'mark_module_completed(uuid)',
    'get_contractor_training_progress()'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
    execute format('grant execute on function public.%s to postgres', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Structural assertions — existence, DEFINER, pinned search_path, grants.
-- ---------------------------------------------------------------------------
do $$
declare sig text; r record;
  sigs constant text[] := array[
    'public.get_training_modules_for_role()',
    'public.mark_module_started(uuid)',
    'public.mark_module_completed(uuid)',
    'public.get_contractor_training_progress()'
  ];
  names constant text[] := array[
    'get_training_modules_for_role',
    'mark_module_started',
    'mark_module_completed',
    'get_contractor_training_progress'
  ];
  nm text;
begin
  foreach sig in array sigs loop
    if to_regprocedure(sig) is null then
      raise exception 'assert: % does not exist', sig; end if;
    select p.prosecdef as is_def,
           exists(select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%') as sp
      into r from pg_proc p where p.oid = sig::regprocedure;
    if not r.is_def then raise exception 'assert: % is not SECURITY DEFINER', sig; end if;
    if not r.sp then raise exception 'assert: % search_path not pinned', sig; end if;
  end loop;

  foreach nm in array names loop
    if not exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=nm and grantee='authenticated' and privilege_type='EXECUTE') then
      raise exception 'assert: % missing authenticated EXECUTE', nm; end if;
    if exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=nm and grantee in ('anon','PUBLIC') and privilege_type='EXECUTE') then
      raise exception 'assert: % still granted to anon/PUBLIC', nm; end if;
  end loop;

  raise notice 'TRAINING part 2 structural assertions passed (4 RPCs: definer/search_path/grants).';
end $$;

-- ---------------------------------------------------------------------------
-- Behavioural assertions — full contractor flow + role gating, unwound via a
-- ROLLBACK_TEST_DATA raise so nothing persists. Runs only when a contractor +
-- a published module exist (they do on live: 2 contractors + 6 seed modules);
-- skips cleanly otherwise (e.g. a bare dry-run without part 1 seeded).
-- ---------------------------------------------------------------------------
do $$
declare
  v_contractor uuid;
  v_other      uuid;   -- a non-contractor (owner/partner) for the gating check
  v_module     uuid;
  v_res        jsonb;
  v_prog_count int;
begin
  select id into v_contractor from public.profiles where role='contractor' and is_active limit 1;
  select id into v_module from public.training_modules where is_published order by module_order limit 1;
  if v_contractor is null or v_module is null then
    raise notice 'TRAINING behavioural assertions skipped (no active contractor or no published module).';
    return;
  end if;
  select id into v_other from public.profiles where role <> 'contractor' limit 1;

  begin
    -- Act as the contractor.
    perform set_config('request.jwt.claims', json_build_object('sub', v_contractor)::text, true);

    -- (1) modules list returns the 6 published modules.
    if (select count(*) from public.get_training_modules_for_role()) <> 6 then
      raise exception 'assert: contractor should see 6 published modules'; end if;

    -- (2) started → row with started_at, completed_at null.
    v_res := public.mark_module_started(v_module);
    if (v_res->>'started_at') is null then raise exception 'assert: started_at not set'; end if;
    if (v_res->>'completed_at') is not null then raise exception 'assert: completed_at should be null after start'; end if;

    -- (2b) started is idempotent (second call keeps the same row, still 1 progress row).
    perform public.mark_module_started(v_module);
    select count(*) into v_prog_count from public.get_contractor_training_progress();
    if v_prog_count <> 1 then raise exception 'assert: start should be idempotent (1 row), got %', v_prog_count; end if;

    -- (3) completed → completed_at set, newly_completed true, audit row written.
    v_res := public.mark_module_completed(v_module);
    if (v_res->>'completed_at') is null then raise exception 'assert: completed_at not set'; end if;
    if (v_res->>'newly_completed') <> 'true' then raise exception 'assert: first completion should be newly_completed'; end if;
    if not exists (select 1 from public.activity_logs
        where entity_type='training_module' and entity_id=v_module and event_type='UPDATE' and user_id=v_contractor) then
      raise exception 'assert: completion audit row missing'; end if;

    -- (3b) completion is idempotent (second call → newly_completed false, timestamp unchanged).
    v_res := public.mark_module_completed(v_module);
    if (v_res->>'newly_completed') <> 'false' then raise exception 'assert: repeat completion should be newly_completed=false'; end if;

    -- (4) progress reflects exactly one completed module.
    if (select count(*) from public.get_contractor_training_progress() where completed_at is not null) <> 1 then
      raise exception 'assert: should have exactly 1 completed module'; end if;

    -- (5) role gating: a non-contractor cannot call the contractor RPCs.
    if v_other is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
      begin
        perform public.mark_module_started(v_module);
        raise exception 'assert: non-contractor mark_module_started should raise';
      exception when others then
        if sqlerrm like 'assert:%' then raise; end if;
        if sqlerrm not ilike '%contractor%' then raise exception 'assert: wrong gating error: %', sqlerrm; end if;
      end;
      begin
        perform public.get_contractor_training_progress();
        raise exception 'assert: non-contractor get_contractor_training_progress should raise';
      exception when others then
        if sqlerrm like 'assert:%' then raise; end if;
        if sqlerrm not ilike '%contractor%' then raise exception 'assert: wrong gating error: %', sqlerrm; end if;
      end;
    end if;

    raise notice 'TRAINING behavioural assertions passed (list/start/complete idempotent + audit + role gating).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception
    when others then if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
