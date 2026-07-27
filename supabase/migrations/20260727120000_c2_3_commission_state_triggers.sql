-- C2.3 — commission state-transition triggers (funder-invoice-driven) + settle stubs
-- ============================================================================
-- Builds on C2.2 (the commission ledger). When a funder invoice changes state, the
-- commission(s) for that invoice's submission move through their lifecycle:
--   funder_invoice draft -> issued   : commission earned      -> outstanding (+ link + outstanding_at)
--   funder_invoice issued/overdue -> paid : commission outstanding -> payable (+ payable_at)
--   funder_invoice issued/overdue -> void : commission outstanding -> earned  (revert + unlink)
-- The partner-invoice settle step (payable -> settled) is C4 — left as raising STUBS here.
--
-- Design decisions (owner-locked 2026-07-27):
--   1. Batch-first fan-out over the submission's commissions, with a PER-RECORD advisory
--      lock inside (transition_commission_record) so concurrent transitions on OTHER
--      records never block; idempotent silent skip when already at target.
--   2. Void of a commission that is already SETTLED is NOT reverted (Doctor was paid) —
--      it emits a COMMISSION_MISMATCH_ON_INVOICE_VOID activity_log for reconciliation.
--   3. A repeat transition returns jsonb was_transitioned:false + the current status.
--   4. Settle/unsettle are RAISE-only stubs (SQLSTATE P0002) until C4 builds
--      partner_invoices — one error code = one catch pattern for C4.
--   H. commission_records is EMPTY on live (0 rows, verified) — the "6 draft artifacts"
--      never existed (and this table has no 'draft' status). So there is nothing to
--      delete; instead we ASSERT the empty clean-state as an invariant (money-safe:
--      never blind-DELETE a ledger; fail loudly if unexpected rows appear).
--
-- Link is per deal_funder_submission_id (one invoice <-> one submission <-> one
-- commission). Money numeric(14,2); percentages numeric(10,4). Belt-and-braces on every
-- new money function (DEFINER + search_path='' + is_owner() + grant matrix + assertions).
-- ============================================================================

-- H. Clean-state invariant (verified 0 rows on live; no blind DELETE) -----------
do $$
declare v_n int;
begin
  select count(*) into v_n from public.commission_records;
  if v_n <> 0 then
    raise exception 'C2.3 pre-check: expected 0 commission_records going into C2.3, found % — investigate before proceeding (do NOT blind-delete a money ledger).', v_n;
  end if;
  raise notice 'C2.3 clean-state invariant holds: commission_records is empty.';
end $$;

-- 1. Per-record transition worker --------------------------------------------
--   The mechanical unit: locks ONE commission_record, idempotently moves it to the
--   target state, sets the matching timestamp/FK. Called by the cascade (batch) and
--   reusable by C4. is_owner()-guarded (a DEFINER function bypasses RLS).
create or replace function public.transition_commission_record(
  p_commission_record_id uuid,
  p_to                    public.commission_state,
  p_funder_invoice_id     uuid default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_from public.commission_state;
  v_id   uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can transition commission records';
  end if;

  -- Decision 1: per-record advisory lock (not per-deal) so other records never block.
  perform pg_advisory_xact_lock(hashtext('commission_record:' || p_commission_record_id::text));

  select status into v_from from public.commission_records where id = p_commission_record_id;
  if v_from is null then
    raise exception 'Commission record % not found', p_commission_record_id;
  end if;

  -- Decision 3: idempotent — already at target, nothing to do.
  if v_from = p_to then
    return jsonb_build_object('was_transitioned', false, 'status', v_from, 'reason', 'already_at_target');
  end if;

  -- Only the C2.3-driven transitions are legal here (settle/unsettle are C4 stubs).
  if not (
       (p_to = 'outstanding' and v_from = 'earned')
    or (p_to = 'payable'     and v_from = 'outstanding')
    or (p_to = 'earned'      and v_from = 'outstanding')  -- void revert
  ) then
    raise exception 'Illegal commission transition % -> % (record %)', v_from, p_to, p_commission_record_id;
  end if;

  update public.commission_records
     set status = p_to,
         funder_invoice_id = case when p_to = 'outstanding' then p_funder_invoice_id
                                  when p_to = 'earned'      then null
                                  else funder_invoice_id end,
         outstanding_at    = case when p_to = 'outstanding' then now()
                                  when p_to = 'earned'      then null
                                  else outstanding_at end,
         payable_at        = case when p_to = 'payable'     then now()
                                  when p_to = 'earned'      then null
                                  else payable_at end
   where id = p_commission_record_id and status = v_from   -- re-check under lock
   returning id into v_id;

  if v_id is null then
    -- Lost the race (another txn moved it first) — report current state, no double-move.
    select status into v_from from public.commission_records where id = p_commission_record_id;
    return jsonb_build_object('was_transitioned', false, 'status', v_from, 'reason', 'lost_race');
  end if;

  return jsonb_build_object('was_transitioned', true, 'from', v_from, 'to', p_to);
end;
$function$;

comment on function public.transition_commission_record(uuid, public.commission_state, uuid) is
  'C2.3 — per-record commission state mover. Per-record advisory-locked + idempotent (was_transitioned:false when already at target). Legal C2.3 transitions only: earned->outstanding, outstanding->payable, outstanding->earned (void revert). Owner-only. Sets the matching timestamp/FK. The BEFORE recompute trigger freezes the split (gross/is_po unchanged).';

revoke all on function public.transition_commission_record(uuid, public.commission_state, uuid) from public;
revoke all on function public.transition_commission_record(uuid, public.commission_state, uuid) from anon;
grant execute on function public.transition_commission_record(uuid, public.commission_state, uuid) to authenticated;

-- 2. Cascade trigger on funder_invoices state --------------------------------
--   Batch-first (Decision 1): fan out over the submission's commissions, delegating each
--   record to transition_commission_record (per-record lock inside). Decision 2: a settled
--   (or, defensively, payable) commission on a void is a reconciliation event, not a revert.
create or replace function public.commission_cascade_on_invoice_state()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record;
begin
  if new.state is not distinct from old.state then
    return null;
  end if;

  if old.state = 'draft' and new.state = 'issued' then
    -- earned -> outstanding for every earned commission on this submission.
    for r in
      select id from public.commission_records
       where deal_funder_submission_id = new.deal_funder_submission_id and status = 'earned'
    loop
      perform public.transition_commission_record(r.id, 'outstanding', new.id);
    end loop;

  elsif new.state = 'paid' and old.state in ('issued', 'overdue') then
    -- outstanding -> payable for this invoice's commissions.
    for r in
      select id from public.commission_records
       where deal_funder_submission_id = new.deal_funder_submission_id
         and funder_invoice_id = new.id and status = 'outstanding'
    loop
      perform public.transition_commission_record(r.id, 'payable', new.id);
    end loop;

  elsif new.state = 'void' and old.state in ('issued', 'overdue') then
    -- Void post-issue: revert outstanding -> earned (unlink). Settled/payable = mismatch.
    for r in
      select id, status from public.commission_records
       where deal_funder_submission_id = new.deal_funder_submission_id and funder_invoice_id = new.id
    loop
      if r.status = 'outstanding' then
        perform public.transition_commission_record(r.id, 'earned', new.id);
      elsif r.status in ('payable', 'settled') then
        -- Decision 2: do NOT revert an already-paid/settled commission; log a mismatch.
        insert into public.activity_logs
          (occurred_at, user_id, event_type, entity_type, entity_id, description, after_values, related_entity_ids)
        values (
          now(), (select auth.uid()), 'INVOICE'::public.activity_event_type,
          'commission_record', r.id,
          'COMMISSION_MISMATCH_ON_INVOICE_VOID: invoice ' || new.invoice_number ||
            ' voided but commission is ' || r.status || ' — reconciliation needed',
          jsonb_build_object('invoice_id', new.id, 'commission_record_id', r.id,
                             'commission_status', r.status, 'paid_amount', new.paid_amount,
                             'void_reason', new.notes),
          jsonb_build_array(new.deal_id)
        );
      end if;
    end loop;
  end if;

  return null;
end;
$function$;

drop trigger if exists commission_cascade_on_invoice_state on public.funder_invoices;
create trigger commission_cascade_on_invoice_state
  after update of state on public.funder_invoices
  for each row execute function public.commission_cascade_on_invoice_state();

-- 3. Re-point COMMISSION_PAID: fires on status -> settled (not payment_received_date) --
--   Real business truth: Doctor's commission is genuinely paid only when SETTLED (after
--   the partner invoice is paid — C4), never at earned/outstanding/payable.
create or replace function public.notify_commission_paid()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_ref text; v_recipient uuid;
begin
  if new.status = 'settled'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select reference into v_ref from public.deals where id = new.deal_id;
    v_recipient := public.notify_owner();  -- Phase D: also notify the referring partner
    perform public.emit_in_app_notification(
      v_recipient, 'COMMISSION_PAID', 'Commission paid',
      'Partner commission of R' || to_char(new.partner_share, 'FM999,999,990')
        || ' for ' || coalesce(v_ref, 'a deal') || ' has been settled and paid.',
      '/deals/' || new.deal_id::text,
      jsonb_build_object('commission_record_id', new.id, 'deal_id', new.deal_id)
    );
  end if;
  return null;
end;
$function$;

drop trigger if exists notify_commission_paid on public.commission_records;
create trigger notify_commission_paid
  after insert or update of status on public.commission_records
  for each row execute function public.notify_commission_paid();

-- 4. Retire payment_received_date (only consumer was the old notify trigger) ---
alter table public.commission_records drop column if exists payment_received_date;

-- 5. C4 settle/unsettle stubs — raise until partner_invoices exists ------------
create or replace function public.stub_settle_from_partner_invoice(
  p_commission_record_id uuid, p_partner_invoice_id uuid
) returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  raise exception 'C4 partner_invoices table not yet built — cannot settle commission_record via stub'
    using errcode = 'P0002';
end;
$function$;

create or replace function public.stub_unsettle_from_partner_invoice(
  p_commission_record_id uuid, p_partner_invoice_id uuid
) returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  raise exception 'C4 partner_invoices table not yet built — cannot unsettle commission_record via stub'
    using errcode = 'P0002';
end;
$function$;

comment on function public.stub_settle_from_partner_invoice(uuid, uuid) is
  'C2.3 stub — C4 replaces this with the real payable->settled settle when partner_invoices exists. Raises SQLSTATE P0002 so C4 has a single catch pattern.';
comment on function public.stub_unsettle_from_partner_invoice(uuid, uuid) is
  'C2.3 stub — C4 replaces this with the real settled->payable unsettle when partner_invoices exists. Raises SQLSTATE P0002 so C4 has a single catch pattern.';

revoke all on function public.stub_settle_from_partner_invoice(uuid, uuid) from public;
revoke all on function public.stub_settle_from_partner_invoice(uuid, uuid) from anon;
grant execute on function public.stub_settle_from_partner_invoice(uuid, uuid) to authenticated;
revoke all on function public.stub_unsettle_from_partner_invoice(uuid, uuid) from public;
revoke all on function public.stub_unsettle_from_partner_invoice(uuid, uuid) from anon;
grant execute on function public.stub_unsettle_from_partner_invoice(uuid, uuid) to authenticated;

-- 6. Assertions --------------------------------------------------------------
do $$
declare
  v_prosecdef boolean; v_proconfig text[]; v_args text; v_ret text; v_grants text;
  v_client uuid; v_funder uuid; v_owner uuid;
  v_deal uuid; v_sub uuid; v_cr uuid; v_inv uuid;
  v_deal2 uuid; v_sub2 uuid; v_cr2 uuid; v_inv2 uuid;
  v_deal3 uuid; v_sub3 uuid; v_cr3 uuid; v_inv3 uuid;
  v_status public.commission_state; v_res jsonb; v_cnt int; v_fk uuid; v_ts timestamptz;
  v_sqlstate text; v_msg text;
begin
  -- (a) structural: transition_commission_record definer/search_path/grants/sig/ret
  select p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid)
    into v_prosecdef, v_proconfig, v_args, v_ret
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='transition_commission_record';
  if v_prosecdef is not true then raise exception 'assert: transition_commission_record not DEFINER'; end if;
  if not exists (select 1 from unnest(v_proconfig) e where e like 'search_path=%') then raise exception 'assert: search_path not set on transition_commission_record'; end if;
  if v_args <> 'p_commission_record_id uuid, p_to commission_state, p_funder_invoice_id uuid' then raise exception 'assert: transition_commission_record args = %', v_args; end if;
  if v_ret <> 'jsonb' then raise exception 'assert: transition_commission_record ret = %', v_ret; end if;
  select string_agg(grantee||':'||privilege_type, ',') into v_grants from information_schema.routine_privileges where routine_schema='public' and routine_name='transition_commission_record';
  if v_grants ilike '%PUBLIC%' or v_grants ilike '%anon%' then raise exception 'assert: transition_commission_record grants too wide %', v_grants; end if;
  if v_grants not ilike '%authenticated:EXECUTE%' then raise exception 'assert: transition_commission_record not granted authenticated'; end if;

  -- (b) triggers present; payment_received_date dropped; notify fires on status
  if not exists (select 1 from pg_trigger where tgrelid='public.funder_invoices'::regclass and tgname='commission_cascade_on_invoice_state' and not tgisinternal) then raise exception 'assert: cascade trigger missing'; end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='commission_records' and column_name='payment_received_date') then raise exception 'assert: payment_received_date not dropped'; end if;
  if pg_get_triggerdef((select oid from pg_trigger where tgname='notify_commission_paid' and not tgisinternal)) not ilike '%UPDATE OF status%' then raise exception 'assert: notify_commission_paid not re-pointed to status'; end if;
  if pg_get_functiondef('public.notify_commission_paid()'::regprocedure) not ilike '%settled%' then raise exception 'assert: notify_commission_paid does not gate on settled'; end if;

  -- (c) stubs raise P0002
  begin
    perform public.stub_settle_from_partner_invoice(gen_random_uuid(), gen_random_uuid());
    raise exception 'assert: stub_settle did not raise';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_msg = message_text;
    if v_sqlstate <> 'P0002' then raise exception 'assert: stub_settle sqlstate % (expected P0002)', v_sqlstate; end if;
    if v_msg not ilike '%cannot settle%' then raise exception 'assert: stub_settle msg %', v_msg; end if;
  end;
  begin
    perform public.stub_unsettle_from_partner_invoice(gen_random_uuid(), gen_random_uuid());
    raise exception 'assert: stub_unsettle did not raise';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_msg = message_text;
    if v_sqlstate <> 'P0002' then raise exception 'assert: stub_unsettle sqlstate %', v_sqlstate; end if;
    if v_msg not ilike '%cannot unsettle%' then raise exception 'assert: stub_unsettle msg %', v_msg; end if;
  end;

  -- (d) RLS matrix unchanged
  if not exists (select 1 from pg_policy where polrelid='public.commission_records'::regclass and polname='commission_records_owner_all') then raise exception 'assert: owner RLS gone'; end if;
  if not exists (select 1 from pg_policy where polrelid='public.commission_records'::regclass and polname='commission_records_partner_read_own') then raise exception 'assert: partner RLS gone'; end if;

  -- (e) H invariant: still empty
  select count(*) into v_cnt from public.commission_records;
  if v_cnt <> 0 then raise exception 'assert H: commission_records not empty (%)', v_cnt; end if;

  -- ---- Behavioural (synthetic, explicit refs, owner ctx, rolled back) ----
  begin
    select id into v_client from public.clients limit 1;
    select id into v_funder from public.funders limit 1;
    select id into v_owner  from public.profiles where role='owner' limit 1;
    if v_client is null or v_funder is null or v_owner is null then
      raise notice 'C2.3: missing client/funder/owner — behavioural asserts skipped';
      raise exception 'ROLLBACK_TEST_DATA';
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    -- helper deal+submission+earned commission
    insert into public.deals (client_id, reference, stage, is_purchase_order)
      values (v_client, 'C2_3_A', 'funded', false) returning id into v_deal;
    insert into public.deal_funder_submissions (deal_id, funder_id, status, amount_funded, applied_rate_snapshot)
      values (v_deal, v_funder, 'funded', 1000000,
              jsonb_build_object('rate_type','percent_of_gross_funded','rate_fraction',0.10,'flat_amount',null,'source','test'))
      returning id into v_sub;
    perform public.write_commission_record(v_deal);
    select id, status into v_cr, v_status from public.commission_records where deal_funder_submission_id=v_sub;
    if v_status <> 'earned' then raise exception 'assert: seed commission not earned (%)', v_status; end if;

    -- synthetic invoice for the submission
    insert into public.funder_invoices (invoice_number, deal_id, deal_funder_submission_id, funder_id,
        client_reference, facility_advanced, commission_amount, total_amount, rate_snapshot,
        commission_description, payment_reference_expected, issued_date, payment_terms, due_date, state)
      values ('INV-C23-A', v_deal, v_sub, v_funder, 'test', 1000000, 100000, 100000, '{}'::jsonb,
              'test', 'REF-A', public.current_sast_date(), 'Due on receipt', public.current_sast_date(), 'draft')
      returning id into v_inv;

    -- issue: earned -> outstanding (+ link + outstanding_at)
    update public.funder_invoices set state='issued' where id=v_inv;
    select status, funder_invoice_id, outstanding_at into v_status, v_fk, v_ts from public.commission_records where id=v_cr;
    if v_status <> 'outstanding' then raise exception 'assert issue: status % (exp outstanding)', v_status; end if;
    if v_fk <> v_inv then raise exception 'assert issue: funder_invoice_id not linked'; end if;
    if v_ts is null then raise exception 'assert issue: outstanding_at null'; end if;

    -- COMMISSION_PAID must NOT have fired yet
    select count(*) into v_cnt from public.notifications where event_type='COMMISSION_PAID' and (data->>'commission_record_id')::uuid = v_cr;
    if v_cnt <> 0 then raise exception 'assert: COMMISSION_PAID fired before settle (%)', v_cnt; end if;

    -- paid: outstanding -> payable (+ payable_at)
    update public.funder_invoices set state='paid', paid_at=now(), paid_amount=100000 where id=v_inv;
    select status, payable_at into v_status, v_ts from public.commission_records where id=v_cr;
    if v_status <> 'payable' then raise exception 'assert paid: status % (exp payable)', v_status; end if;
    if v_ts is null then raise exception 'assert paid: payable_at null'; end if;

    -- idempotency: transition again to payable -> was_transitioned:false
    v_res := public.transition_commission_record(v_cr, 'payable', v_inv);
    if (v_res->>'was_transitioned')::boolean is not false then raise exception 'assert idempotent: re-transition changed'; end if;

    -- settle (simulating C4) directly -> COMMISSION_PAID fires exactly once
    update public.commission_records set status='settled', settled_at=now(), partner_invoice_id=gen_random_uuid() where id=v_cr;
    select count(*) into v_cnt from public.notifications where event_type='COMMISSION_PAID' and (data->>'commission_record_id')::uuid = v_cr;
    if v_cnt <> 1 then raise exception 'assert: COMMISSION_PAID fired % times on settle (exp 1)', v_cnt; end if;

    -- VOID cascade: fresh deal, revert outstanding -> earned + unlink
    insert into public.deals (client_id, reference, stage, is_purchase_order) values (v_client,'C2_3_B','funded',false) returning id into v_deal2;
    insert into public.deal_funder_submissions (deal_id, funder_id, status, amount_funded, applied_rate_snapshot)
      values (v_deal2, v_funder, 'funded', 500000, jsonb_build_object('rate_type','percent_of_gross_funded','rate_fraction',0.10,'flat_amount',null,'source','test')) returning id into v_sub2;
    perform public.write_commission_record(v_deal2);
    select id into v_cr2 from public.commission_records where deal_funder_submission_id=v_sub2;
    insert into public.funder_invoices (invoice_number, deal_id, deal_funder_submission_id, funder_id,
        client_reference, facility_advanced, commission_amount, total_amount, rate_snapshot,
        commission_description, payment_reference_expected, issued_date, payment_terms, due_date, state)
      values ('INV-C23-B', v_deal2, v_sub2, v_funder, 'test', 500000, 50000, 50000, '{}'::jsonb, 'test', 'REF-B',
              public.current_sast_date(), 'Due on receipt', public.current_sast_date(), 'draft') returning id into v_inv2;
    update public.funder_invoices set state='issued' where id=v_inv2;   -- earned -> outstanding
    update public.funder_invoices set state='void' where id=v_inv2;     -- void revert
    select status, funder_invoice_id into v_status, v_fk from public.commission_records where id=v_cr2;
    if v_status <> 'earned' then raise exception 'assert void: status % (exp earned)', v_status; end if;
    if v_fk is not null then raise exception 'assert void: funder_invoice_id not nulled'; end if;

    -- MISMATCH: a settled commission whose (artificially issued) invoice is voided -> no revert + mismatch log
    insert into public.deals (client_id, reference, stage, is_purchase_order) values (v_client,'C2_3_C','funded',false) returning id into v_deal3;
    insert into public.deal_funder_submissions (deal_id, funder_id, status, amount_funded, applied_rate_snapshot)
      values (v_deal3, v_funder, 'funded', 300000, jsonb_build_object('rate_type','percent_of_gross_funded','rate_fraction',0.10,'flat_amount',null,'source','test')) returning id into v_sub3;
    perform public.write_commission_record(v_deal3);
    select id into v_cr3 from public.commission_records where deal_funder_submission_id=v_sub3;
    insert into public.funder_invoices (invoice_number, deal_id, deal_funder_submission_id, funder_id,
        client_reference, facility_advanced, commission_amount, total_amount, rate_snapshot,
        commission_description, payment_reference_expected, issued_date, payment_terms, due_date, state)
      values ('INV-C23-C', v_deal3, v_sub3, v_funder, 'test', 300000, 30000, 30000, '{}'::jsonb, 'test', 'REF-C',
              public.current_sast_date(), 'Due on receipt', public.current_sast_date(), 'draft') returning id into v_inv3;
    update public.funder_invoices set state='issued' where id=v_inv3;
    -- artificially force settled + link (a real path can't reach this — paid is void-terminal)
    update public.commission_records set status='settled', settled_at=now(), funder_invoice_id=v_inv3 where id=v_cr3;
    update public.funder_invoices set state='void' where id=v_inv3;     -- void with a settled linked commission
    select status into v_status from public.commission_records where id=v_cr3;
    if v_status <> 'settled' then raise exception 'assert mismatch: settled was reverted (%)', v_status; end if;
    select count(*) into v_cnt from public.activity_logs where entity_id=v_cr3 and description ilike 'COMMISSION_MISMATCH_ON_INVOICE_VOID%';
    if v_cnt < 1 then raise exception 'assert mismatch: no COMMISSION_MISMATCH activity_log'; end if;

    raise notice 'C2.3 behavioural assertions passed.';
    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;

  raise notice 'C2.3 assertions passed: cascade + per-record transition + COMMISSION_PAID re-point + stubs.';
end $$;
