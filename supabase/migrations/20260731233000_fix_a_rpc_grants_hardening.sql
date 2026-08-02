-- FIX-A (AUDIT.md F1 + F2): RPC grants hardening + search_path pin.
--
-- Clears the Supabase security advisor's anon/authenticated
-- *_security_definer_function_executable WARNs and the one
-- function_search_path_mutable WARN, per the 2026-07-31 full-system audit.
--
-- Two invariants this migration enforces:
--   1. No API-callable RPC is executable by `anon` (or via a PUBLIC grant).
--      The frontend was verified (2026-07-31) to have ZERO anon-dependent RPC
--      callers: the single supabase-js client boots with the anon key, but
--      every .rpc() call site sits behind OwnerGate, so requests always carry
--      an authenticated JWT. `authenticated` keeps (or is explicitly granted)
--      EXECUTE on the user-facing RPC surface, so nothing the app does changes.
--   2. Trigger bodies and internal helpers hold EXECUTE for NO API role at
--      all. Postgres checks trigger-function EXECUTE against the table owner
--      at trigger time (and event triggers run as the owner), so revoking
--      anon/authenticated/PUBLIC cannot break trigger firing — it only closes
--      the (inert but flagged) /rest/v1/rpc/<trigger_fn> surface.
--
-- All revokes are idempotent no-ops where the grant is already absent.
-- (No explicit BEGIN/COMMIT — the migration runner wraps this file in its
-- own transaction, so a failed assertion rolls the whole migration back.)

-- --------------------------------------------------------------------------
-- 1. User-facing RPC surface: strip anon + PUBLIC, guarantee authenticated.
--    (Live grants verified 2026-07-31: these ten carried anon and/or PUBLIC.)
-- --------------------------------------------------------------------------
do $$
declare
  fn text;
  api_fns constant text[] := array[
    'mark_notification_read(uuid)',
    'mark_notifications_read(uuid[])',
    'mark_all_notifications_read()',
    'reopen_deal(uuid, public.deal_stage)',
    'find_lead_duplicates(text, text, text, text, uuid)',
    'find_client_duplicates(text, text, uuid)',
    'calculate_commission(numeric, boolean)',
    'commission_tier_pct(numeric, boolean)',
    'is_owner()',
    'current_partner_id()'
  ];
begin
  foreach fn in array api_fns loop
    execute format('revoke execute on function public.%s from public', fn);
    execute format('revoke execute on function public.%s from anon', fn);
    -- keep the app working exactly as before: authenticated stays granted
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 2. Trigger bodies + internal machinery: no API role may hold EXECUTE.
--    (PostgREST refuses to invoke trigger-returning functions anyway; this
--    closes the advisor-flagged surface and matches the belt-and-braces
--    grants-matrix rule. service_role / postgres are untouched.)
-- --------------------------------------------------------------------------
do $$
declare
  fn text;
  internal_fns constant text[] := array[
    -- A10 / stage plumbing
    'log_activity()',
    'set_updated_at()',
    'deals_before_write()',
    'deals_block_declined_reopen()',
    'deals_log_stage()',
    'deals_auto_decline_on_last_submission()',
    -- C2 funded triggers + invoice cascades
    'deals_write_commission_on_funded()',
    'submissions_write_commission_on_funded()',
    'commission_records_recompute()',
    'commission_cascade_on_invoice_state()',
    'bonus_cascade_on_invoice_state()',
    'bonus_records_immutable_when_settled()',
    'funder_invoices_state_guard()',
    -- notification emitters
    'notify_deal_approved()',
    'notify_deal_funded()',
    'notify_commission_paid()',
    'notify_bonus_paid()',
    'notify_lead_created_for_you()',
    'notify_lead_events()',
    'notify_lead_document_rejected()',
    -- documents governance
    'documents_apply_versioning()',
    'documents_prevent_audit_rewrite()',
    -- dedup / integrity guards
    'leads_cipc_block()',
    'clients_cipc_block()',
    'leads_qualification_guard()',
    'enforce_rate_funder_contracted()',
    'client_stakeholders_touch()',
    -- bootstrap / event trigger
    'handle_new_user()',
    'rls_auto_enable()'
  ];
begin
  foreach fn in array internal_fns loop
    execute format('revoke execute on function public.%s from public', fn);
    execute format('revoke execute on function public.%s from anon', fn);
    execute format('revoke execute on function public.%s from authenticated', fn);
  end loop;
end $$;

-- Belt-and-braces: trigger firing never rechecks EXECUTE at runtime, but a
-- future re-CREATE of the auth.users trigger WOULD check it against that
-- table's owner — make sure the auth machinery explicitly keeps EXECUTE on
-- the profile-bootstrap function now that its PUBLIC grant is gone.
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- --------------------------------------------------------------------------
-- 3. F2: pin search_path on the one unpinned function. Body verified against
--    live prosrc (2026-07-31): only pg_catalog builtins (now()) and the
--    schema-qualified auth.uid(); enum literals resolve via the column type —
--    nothing depends on the search path.
-- --------------------------------------------------------------------------
alter function public.leads_qualification_guard() set search_path = '';

-- --------------------------------------------------------------------------
-- 4. Self-check assertions — RAISE (rolling the migration back) on failure.
-- --------------------------------------------------------------------------
do $$
declare
  bad int;
begin
  -- 4a. anon must hold EXECUTE on nothing we touched (spot-check the API set
  --     plus one representative trigger fn from each group).
  select count(*) into bad
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and grantee = 'anon'
    and privilege_type = 'EXECUTE'
    and routine_name in (
      'mark_notification_read','mark_notifications_read','mark_all_notifications_read',
      'reopen_deal','find_lead_duplicates','find_client_duplicates',
      'calculate_commission','commission_tier_pct','is_owner','current_partner_id',
      'log_activity','notify_deal_approved','documents_apply_versioning',
      'leads_cipc_block','clients_cipc_block','rls_auto_enable',
      'deals_write_commission_on_funded','commission_cascade_on_invoice_state'
    );
  if bad > 0 then
    raise exception 'FIX-A self-check: anon still holds EXECUTE on % hardened function(s)', bad;
  end if;

  -- 4b. authenticated must still hold EXECUTE on the full user-facing surface.
  select count(*) into bad
  from (values
    ('mark_notification_read'),('mark_notifications_read'),('mark_all_notifications_read'),
    ('reopen_deal'),('find_lead_duplicates'),('find_client_duplicates'),
    ('calculate_commission'),('commission_tier_pct'),('is_owner'),('current_partner_id')
  ) v(fn)
  where not exists (
    select 1 from information_schema.routine_privileges rp
    where rp.routine_schema = 'public' and rp.routine_name = v.fn
      and rp.grantee = 'authenticated' and rp.privilege_type = 'EXECUTE'
  );
  if bad > 0 then
    raise exception 'FIX-A self-check: authenticated lost EXECUTE on % API function(s)', bad;
  end if;

  -- 4c. authenticated must hold EXECUTE on NO trigger/internal function.
  select count(*) into bad
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and grantee in ('anon','authenticated')
    and privilege_type = 'EXECUTE'
    and routine_name in (
      'log_activity','set_updated_at','deals_before_write','deals_block_declined_reopen',
      'deals_log_stage','deals_auto_decline_on_last_submission',
      'deals_write_commission_on_funded','submissions_write_commission_on_funded',
      'commission_records_recompute','commission_cascade_on_invoice_state',
      'bonus_cascade_on_invoice_state','bonus_records_immutable_when_settled',
      'funder_invoices_state_guard','notify_deal_approved','notify_deal_funded',
      'notify_commission_paid','notify_bonus_paid','notify_lead_created_for_you',
      'notify_lead_events','notify_lead_document_rejected','documents_apply_versioning',
      'documents_prevent_audit_rewrite','leads_cipc_block','clients_cipc_block',
      'leads_qualification_guard','enforce_rate_funder_contracted',
      'client_stakeholders_touch','handle_new_user','rls_auto_enable'
    );
  if bad > 0 then
    raise exception 'FIX-A self-check: an API role still holds EXECUTE on % internal function(s)', bad;
  end if;

  -- 4d. leads_qualification_guard search_path is pinned.
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'leads_qualification_guard'
      and p.proconfig::text like '%search_path=%'
  ) then
    raise exception 'FIX-A self-check: leads_qualification_guard search_path is not pinned';
  end if;
end $$;
