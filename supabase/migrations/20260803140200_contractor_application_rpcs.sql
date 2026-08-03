-- Public Application Entry Point (Sprint 2, Lane 2a) — part 3 of 3: RPCs.
-- ============================================================================
-- Three SECURITY DEFINER RPCs:
--
--   1. submit_contractor_application(p_payload jsonb, p_ip_hash text,
--        p_max_per_window int, p_window_seconds int) → jsonb
--      The PUBLIC submission path. Called ONLY by the apply-submit-application
--      Edge Function via the service-role key (grant: service_role + postgres,
--      NOT authenticated/anon). Does, atomically in one transaction:
--        (a) IP throttle (records the attempt in the ledger, counts the window,
--            returns {status:'rate_limited'} without creating anything when over),
--        (b) server-side validation (defence-in-depth behind the Edge Function's
--            own validation),
--        (c) insert the contractors row at status 'applicant',
--        (d) write a CREATE activity_logs row (POPIA-minimised — no ID number /
--            address in the audit payload),
--        (e) emit a CONTRACTOR_APPLICATION_RECEIVED in-app notification (+ email
--            via the existing framework) to every active owner.
--      Returns the created id/name/email so the Edge Function can send the
--      applicant confirmation email. The applicant email is deliberately NOT the
--      RPC's job (HTTP/Resend concern) — a send failure never rolls back the
--      captured application.
--
--   2. move_application_to_screening(p_application_id uuid) → jsonb
--   3. reject_application(p_application_id uuid, p_reason text) → jsonb
--      Owner-only status transitions. Every one: DEFINER + search_path='' +
--      is_owner() + advisory xact lock + state guard + activity write
--      (STAGE_CHANGE) + RETURNING/FOUND check (silent-RLS rule) + idempotent
--      no-op where meaningful. Grants: authenticated + postgres + service_role;
--      anon/PUBLIC revoked.
--
-- Behavioural assertions at the end EMIT a CONTRACTOR_APPLICATION_RECEIVED
-- notification, so they need the enum value committed (part 1). They are guarded
-- to run ONLY when that value already exists (present at the owner's real apply;
-- absent in a non-persisting dry-run without part 1) and to unwind via a
-- ROLLBACK_TEST_DATA raise.
-- ============================================================================

-- ===========================================================================
-- 1. submit_contractor_application — public path (service-role only).
-- ===========================================================================
create or replace function public.submit_contractor_application(
  p_payload         jsonb,
  p_ip_hash         text default null,
  p_max_per_window  int  default 5,
  p_window_seconds  int  default 60
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_full_name  text := btrim(coalesce(p_payload->>'full_name', ''));
  v_email      text := lower(btrim(coalesce(p_payload->>'email', '')));
  v_phone      text := btrim(coalesce(p_payload->>'phone', ''));
  v_id_number  text := nullif(btrim(coalesce(p_payload->>'id_number', '')), '');
  v_address    text := btrim(coalesce(p_payload->>'physical_address', ''));
  v_exp_raw    text := nullif(btrim(coalesce(p_payload->>'experience_years', '')), '');
  v_exp        int;
  v_motivation text := btrim(coalesce(p_payload->>'motivation_text', ''));
  v_ref_src    text := nullif(btrim(coalesce(p_payload->>'referral_source', '')), '');
  v_ref_other  text := nullif(btrim(coalesce(p_payload->>'referral_source_other', '')), '');
  v_count      int;
  v_id         uuid;
  v_owner      record;
begin
  -- ---- (a) IP throttle -----------------------------------------------------
  -- Only when we have an IP to key on; a missing IP must not block legit users.
  if p_ip_hash is not null and btrim(p_ip_hash) <> '' then
    perform pg_advisory_xact_lock(hashtext('contractor_apply_rl:' || p_ip_hash));
    -- Record this attempt (counts blocked attempts too, so sustained spam keeps
    -- the window hot) and prune this IP's stale rows.
    insert into public.contractor_application_attempts (ip_hash) values (p_ip_hash);
    delete from public.contractor_application_attempts
      where ip_hash = p_ip_hash and created_at < now() - interval '1 hour';
    select count(*) into v_count
      from public.contractor_application_attempts
      where ip_hash = p_ip_hash
        and created_at >= now() - make_interval(secs => greatest(p_window_seconds, 1));
    if v_count > greatest(p_max_per_window, 1) then
      return jsonb_build_object('status', 'rate_limited');
    end if;
  end if;

  -- ---- (b) validation (defence-in-depth) -----------------------------------
  if v_full_name = '' then raise exception 'full_name is required' using errcode = '22023'; end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'a valid email is required' using errcode = '22023'; end if;
  if v_phone = '' then raise exception 'phone is required' using errcode = '22023'; end if;
  if v_address = '' then raise exception 'physical_address is required' using errcode = '22023'; end if;
  if v_exp_raw is null or v_exp_raw !~ '^[0-9]{1,3}$' then
    raise exception 'experience_years must be a whole number' using errcode = '22023'; end if;
  v_exp := v_exp_raw::int;
  if v_exp < 0 or v_exp > 80 then
    raise exception 'experience_years must be between 0 and 80' using errcode = '22023'; end if;
  if length(v_motivation) < 50 then
    raise exception 'motivation_text must be at least 50 characters' using errcode = '22023'; end if;

  -- ---- (c) create the application ------------------------------------------
  insert into public.contractors
    (full_name, email, phone, id_number, physical_address, experience_years,
     motivation_text, referral_source, referral_source_other, source_ip_hash, status)
  values
    (v_full_name, v_email, v_phone, v_id_number, v_address, v_exp,
     v_motivation, v_ref_src, v_ref_other, p_ip_hash, 'applicant')
  returning id into v_id;
  if v_id is null then raise exception 'application not created (no row written)'; end if;

  -- ---- (d) activity log (POPIA-minimised payload) --------------------------
  insert into public.activity_logs
    (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id, description, after_values)
  values
    (now(), null, null, null, 'CREATE', 'contractor', v_id,
     'New contractor application from ' || v_full_name,
     jsonb_build_object('full_name', v_full_name, 'email', v_email,
                        'experience_years', v_exp, 'status', 'applicant',
                        'referral_source', v_ref_src));

  -- ---- (e) notify every active owner ---------------------------------------
  for v_owner in select id from public.profiles where role = 'owner' and is_active loop
    perform public.emit_in_app_notification(
      v_owner.id,
      'CONTRACTOR_APPLICATION_RECEIVED',
      'New contractor application',
      v_full_name || ' applied to become an FNC contractor.',
      '/team?tab=applications',
      jsonb_build_object('contractor_id', v_id, 'full_name', v_full_name));
  end loop;

  return jsonb_build_object('status', 'created', 'id', v_id,
                            'full_name', v_full_name, 'email', v_email);
end $$;

comment on function public.submit_contractor_application(jsonb, text, int, int) is
  'Public /apply submission path (Lane 2a). Service-role only. IP-throttles, validates, creates the contractors row at ''applicant'', writes a CREATE audit row (PII-minimised) and notifies every active owner (CONTRACTOR_APPLICATION_RECEIVED). Returns {status:created|rate_limited, ...}.';

-- ===========================================================================
-- 2. move_application_to_screening — applicant → screening (owner-only).
-- ===========================================================================
create or replace function public.move_application_to_screening(p_application_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text; v_role text;
  v_c public.contractors;
begin
  if not public.is_owner() then raise exception 'Only the owner can move an application to screening'; end if;
  perform pg_advisory_xact_lock(hashtext('contractor_application:' || p_application_id::text));

  select * into v_c from public.contractors where id = p_application_id;
  if not found then raise exception 'Application % not found', p_application_id; end if;

  -- Idempotent: already screening → clean no-op.
  if v_c.status = 'screening' then
    return jsonb_build_object('id', p_application_id, 'status', 'screening', 'changed', false);
  end if;
  if v_c.status <> 'applicant' then
    raise exception 'Only an applicant can be moved to screening (% is %)', p_application_id, v_c.status;
  end if;

  update public.contractors set status = 'screening'
   where id = p_application_id and status = 'applicant'
   returning * into v_c;
  if v_c.id is null then raise exception 'Application % not moved to screening (no row written)', p_application_id; end if;

  if v_uid is not null then select email, role into v_email, v_role from public.profiles where id = v_uid; end if;
  insert into public.activity_logs
    (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id, description, before_values, after_values)
  values
    (now(), v_uid, v_email, v_role, 'STAGE_CHANGE', 'contractor', p_application_id,
     'Application ' || v_c.full_name || ' moved applicant → screening',
     jsonb_build_object('status', 'applicant'), jsonb_build_object('status', 'screening'));

  return jsonb_build_object('id', p_application_id, 'status', 'screening', 'changed', true);
end $$;

comment on function public.move_application_to_screening(uuid) is
  'Owner-only: transition a contractor application applicant → screening (ONBOARDING.md Stage 2). DEFINER + is_owner + advisory lock + STAGE_CHANGE audit + idempotent.';

-- ===========================================================================
-- 3. reject_application — applicant/screening → rejected (owner-only, reason).
-- ===========================================================================
create or replace function public.reject_application(p_application_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text; v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_prev public.contractor_status;
  v_c public.contractors;
begin
  if not public.is_owner() then raise exception 'Only the owner can reject an application'; end if;
  if v_reason = '' then raise exception 'A reason is required to reject an application'; end if;
  perform pg_advisory_xact_lock(hashtext('contractor_application:' || p_application_id::text));

  select * into v_c from public.contractors where id = p_application_id;
  if not found then raise exception 'Application % not found', p_application_id; end if;

  if v_c.status = 'rejected' then raise exception 'Application % is already rejected', p_application_id; end if;
  if v_c.status not in ('applicant', 'screening') then
    raise exception 'Only an applicant or screening application can be rejected (% is %)', p_application_id, v_c.status;
  end if;
  v_prev := v_c.status;

  update public.contractors set status = 'rejected', rejected_reason = v_reason
   where id = p_application_id and status in ('applicant', 'screening')
   returning * into v_c;
  if v_c.id is null then raise exception 'Application % not rejected (no row written)', p_application_id; end if;

  if v_uid is not null then select email, role into v_email, v_role from public.profiles where id = v_uid; end if;
  insert into public.activity_logs
    (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id, description, before_values, after_values)
  values
    (now(), v_uid, v_email, v_role, 'STAGE_CHANGE', 'contractor', p_application_id,
     'Application ' || v_c.full_name || ' rejected (' || v_prev || ' → rejected)',
     jsonb_build_object('status', v_prev),
     jsonb_build_object('status', 'rejected', 'rejected_reason', v_reason));

  return jsonb_build_object('id', p_application_id, 'status', 'rejected', 'changed', true);
end $$;

comment on function public.reject_application(uuid, text) is
  'Owner-only: reject a contractor application (applicant/screening → rejected) with a required reason. DEFINER + is_owner + advisory lock + STAGE_CHANGE audit.';

-- ===========================================================================
-- 4. Grants matrix.
--    submit_*: service_role + postgres ONLY (public path via the Edge Function's
--      service-role key; never callable by anon or a signed-in browser user).
--    move_*/reject_*: authenticated (owner-gated inside) + postgres + service_role.
--    anon / PUBLIC revoked on all three.
-- ===========================================================================
do $$
declare fn text;
  submit_fn constant text := 'submit_contractor_application(jsonb, text, integer, integer)';
  owner_fns constant text[] := array[
    'move_application_to_screening(uuid)',
    'reject_application(uuid, text)'
  ];
begin
  execute format('revoke all on function public.%s from public', submit_fn);
  execute format('revoke all on function public.%s from anon', submit_fn);
  execute format('revoke all on function public.%s from authenticated', submit_fn);
  execute format('grant execute on function public.%s to service_role', submit_fn);
  execute format('grant execute on function public.%s to postgres', submit_fn);

  foreach fn in array owner_fns loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
    execute format('grant execute on function public.%s to postgres', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;

-- ===========================================================================
-- 5. Structural assertions.
-- ===========================================================================
do $$
declare r record; sig text;
  sigs constant text[][] := array[
    ['public.submit_contractor_application(jsonb,text,integer,integer)', 'p_payload jsonb, p_ip_hash text, p_max_per_window integer, p_window_seconds integer'],
    ['public.move_application_to_screening(uuid)',                       'p_application_id uuid'],
    ['public.reject_application(uuid,text)',                             'p_application_id uuid, p_reason text']
  ];
  fn_row text[];
  definer_fns constant text[] := array[
    'public.submit_contractor_application(jsonb,text,integer,integer)',
    'public.move_application_to_screening(uuid)',
    'public.reject_application(uuid,text)'
  ];
begin
  -- signatures.
  foreach fn_row slice 1 in array sigs loop
    sig := fn_row[1];
    if to_regprocedure(sig) is null then raise exception 'assert: function % does not exist', sig; end if;
    if pg_get_function_identity_arguments(sig::regprocedure) <> fn_row[2] then
      raise exception 'assert: % signature drift — got %', sig, pg_get_function_identity_arguments(sig::regprocedure); end if;
  end loop;

  -- all DEFINER + pinned search_path.
  foreach sig in array definer_fns loop
    select p.prosecdef as is_def,
           exists(select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%') as sp
      into r from pg_proc p where p.oid = sig::regprocedure;
    if not r.is_def then raise exception 'assert: % is not SECURITY DEFINER', sig; end if;
    if not r.sp then raise exception 'assert: % search_path not pinned', sig; end if;
  end loop;

  -- grants: submit_* has service_role, NOT anon/authenticated/PUBLIC.
  if not exists (select 1 from information_schema.routine_privileges
      where routine_schema='public' and routine_name='submit_contractor_application' and grantee='service_role' and privilege_type='EXECUTE') then
    raise exception 'assert: submit_contractor_application missing service_role EXECUTE'; end if;
  if exists (select 1 from information_schema.routine_privileges
      where routine_schema='public' and routine_name='submit_contractor_application' and grantee in ('anon','authenticated','PUBLIC') and privilege_type='EXECUTE') then
    raise exception 'assert: submit_contractor_application must NOT be granted to anon/authenticated/PUBLIC'; end if;

  -- grants: owner RPCs have authenticated + service_role, NOT anon/PUBLIC.
  foreach sig in array array['move_application_to_screening','reject_application'] loop
    if not exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=sig and grantee='authenticated' and privilege_type='EXECUTE') then
      raise exception 'assert: % missing authenticated EXECUTE', sig; end if;
    if exists (select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name=sig and grantee in ('anon','PUBLIC') and privilege_type='EXECUTE') then
      raise exception 'assert: % still granted to anon/PUBLIC', sig; end if;
  end loop;

  raise notice 'Contractor application RPC structural assertions passed (3 signatures, definer/search_path, grants matrix).';
end $$;

-- ===========================================================================
-- 6. Behavioural assertions — full flow + rate limit + owner-gating.
--    Emits CONTRACTOR_APPLICATION_RECEIVED, so it needs the enum value (part 1)
--    already committed. Guarded to run only when present (real apply); a
--    dry-run without part 1 skips cleanly. Unwound by ROLLBACK_TEST_DATA.
-- ===========================================================================
do $$
declare
  v_owner uuid; v_nonown uuid;
  v_res jsonb; v_id uuid; v_id2 uuid; i int;
  v_iphash text := 'test_ip_hash_rollback';
  v_payload jsonb;
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
                 where t.typname='notification_event_type' and e.enumlabel='CONTRACTOR_APPLICATION_RECEIVED') then
    raise notice 'Contractor application behavioural assertions skipped (enum value not yet committed — dry-run).';
    return;
  end if;

  select id into v_owner  from public.profiles where role='owner'  limit 1;
  select id into v_nonown from public.profiles where role<>'owner' limit 1;
  if v_owner is null then
    raise notice 'Contractor application behavioural assertions skipped (no owner profile present).';
    return;
  end if;

  v_payload := jsonb_build_object(
    'full_name', 'Test Applicant Rollback',
    'email', 'test.rollback.applicant@example.com',
    'phone', '0821234567',
    'physical_address', '1 Test Street, Testville, 0001',
    'experience_years', '5',
    'motivation_text', 'I have spent many years in SME sales and want to help fund South African businesses grow.',
    'referral_source', 'linkedin');

  begin
    -- Act as the owner for the owner-gated transitions below (submit itself is
    -- the public path and needs no claim).
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    -- (1) submit → created + row at applicant + audit + owner notification.
    v_res := public.submit_contractor_application(v_payload, v_iphash, 5, 60);
    if (v_res->>'status') <> 'created' then raise exception 'assert: submit not created (%)', v_res; end if;
    v_id := (v_res->>'id')::uuid;
    if not exists (select 1 from public.contractors where id=v_id and status='applicant') then raise exception 'assert: row not at applicant'; end if;
    if not exists (select 1 from public.activity_logs where entity_id=v_id and entity_type='contractor' and event_type='CREATE') then raise exception 'assert: submit audit missing'; end if;
    if not exists (select 1 from public.notifications where user_id=v_owner and event_type='CONTRACTOR_APPLICATION_RECEIVED'
        and (data->>'contractor_id')=v_id::text) then raise exception 'assert: owner notification missing'; end if;

    -- (1b) validation: short motivation raises.
    begin
      v_res := public.submit_contractor_application(v_payload || jsonb_build_object('motivation_text','too short'), null, 5, 60);
      raise exception 'assert: short motivation should raise';
    exception when others then if sqlerrm like 'assert:%' then raise; end if; end;

    -- (2) move → screening; idempotent second call.
    v_res := public.move_application_to_screening(v_id);
    if (v_res->>'status') <> 'screening' or (v_res->>'changed') <> 'true' then raise exception 'assert: move'; end if;
    v_res := public.move_application_to_screening(v_id);
    if (v_res->>'changed') <> 'false' then raise exception 'assert: move idempotency'; end if;

    -- (3) reject a second application; blank reason raises; double-reject raises.
    v_res := public.submit_contractor_application(
      v_payload || jsonb_build_object('email','test.rollback.two@example.com'), null, 5, 60);
    v_id2 := (v_res->>'id')::uuid;
    begin v_res := public.reject_application(v_id2, '   '); raise exception 'assert: blank reason should raise';
    exception when others then if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not like '%reason%' then raise exception 'assert: wrong blank-reason error: %', sqlerrm; end if; end;
    v_res := public.reject_application(v_id2, 'Insufficient sales experience for the role.');
    if (v_res->>'status') <> 'rejected' then raise exception 'assert: reject'; end if;
    if not exists (select 1 from public.contractors where id=v_id2 and status='rejected' and rejected_reason is not null) then raise exception 'assert: reject row'; end if;
    begin v_res := public.reject_application(v_id2, 'again'); raise exception 'assert: double reject should raise';
    exception when others then if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not like '%already rejected%' then raise exception 'assert: wrong double-reject error: %', sqlerrm; end if; end;

    -- (4) rate limit: with max=3/60s, the 4th attempt (this same txn keeps now()
    --     constant, so all attempts fall in-window) returns rate_limited.
    for i in 1..3 loop
      v_res := public.submit_contractor_application(
        v_payload || jsonb_build_object('email','rl'||i||'@example.com'), 'rl_ip_rollback', 3, 60);
      if (v_res->>'status') <> 'created' then raise exception 'assert: rate-limit pre-fill % not created', i; end if;
    end loop;
    v_res := public.submit_contractor_application(
      v_payload || jsonb_build_object('email','rl_over@example.com'), 'rl_ip_rollback', 3, 60);
    if (v_res->>'status') <> 'rate_limited' then raise exception 'assert: 4th attempt should be rate_limited (%)', v_res; end if;

    -- (5) non-owner denied on move + reject.
    if v_nonown is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_nonown)::text, true);
      begin v_res := public.move_application_to_screening(v_id); raise exception 'assert: non-owner move should raise';
      exception when others then if sqlerrm like 'assert:%' then raise; end if;
        if sqlerrm not ilike '%owner%' then raise exception 'assert: wrong non-owner move error: %', sqlerrm; end if; end;
      begin v_res := public.reject_application(v_id, 'x'); raise exception 'assert: non-owner reject should raise';
      exception when others then if sqlerrm like 'assert:%' then raise; end if;
        if sqlerrm not ilike '%owner%' then raise exception 'assert: wrong non-owner reject error: %', sqlerrm; end if; end;
    end if;

    raise notice 'Contractor application behavioural assertions passed (submit/validate/move/reject, rate-limit, owner-gating).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception
    when others then if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
