-- Build 13.1 — settled-commission reversal (settled -> void).
-- ============================================================================
-- Completes the Build 13 immutability doctrine. Build 13 shipped the trigger
-- (enforce_settled_commission_immutable) that FREEZES a settled commission and
-- permits exactly one change out of 'settled' — a reversal to 'void' — but no
-- RPC ever performed that reversal, and the legacy settled->payable unsettle
-- (stub_unsettle_from_partner_invoice) is now hard-blocked by that trigger. So a
-- settled commission had no working correction path. This adds the sanctioned
-- owner-only reversal RPC and redirects the dead unsettle to it.
--
-- A void is an ACCOUNTING REVERSAL, not an edit: the settled figures + invoice
-- linkage + settled_at stay FROZEN on the row (the audit trail is preserved);
-- only `status` flips to 'void' and voided_at/void_reason are stamped. The paid
-- invoice itself stays paid + immutable (its EFT evidence is real) — the reversal
-- is recorded at the commission level. 'void' is already the status excluded from
-- the one-per-submission unique index, so a voided commission also frees the
-- submission for a corrected commission if one is ever legitimately re-derived.
--
-- commission_records is empty (0 rows), so the new columns are metadata-only.
-- Depends on 20260810170000 (the settled->void immutability trigger).
-- ============================================================================

-- ===========================================================================
-- 1. Reversal audit columns. Mirror the lifecycle-timestamp pattern
--    (earned_at/outstanding_at/payable_at/settled_at). The 'void' branch of
--    enforce_settled_commission_immutable does NOT freeze these, so stamping
--    them during the settled->void UPDATE is permitted.
-- ===========================================================================
alter table public.commission_records add column if not exists voided_at   timestamptz;
alter table public.commission_records add column if not exists void_reason text;

comment on column public.commission_records.voided_at is
  'When a settled commission was reversed to void (Build 13.1). Null unless status=void via owner_void_settled_commission.';
comment on column public.commission_records.void_reason is
  'Owner-supplied reason for a settled->void reversal (Build 13.1). Required by owner_void_settled_commission.';

-- ===========================================================================
-- 2. owner_void_settled_commission — the sanctioned settled -> void reversal.
--    Owner-gated, per-record advisory-locked, idempotent, state-guarded, its
--    RETURNING row-count checked (RLS/guard fails silently otherwise). Evidence
--    stays frozen; only status + the reversal stamps change.
-- ===========================================================================
create or replace function public.owner_void_settled_commission(
  p_commission_record_id uuid, p_reason text
) returns jsonb
 language plpgsql security definer set search_path = '' as $function$
declare v_from public.commission_state; v_deal uuid; v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can reverse a settled commission';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reversal reason is required';
  end if;
  perform pg_advisory_xact_lock(hashtext('commission_record:' || p_commission_record_id::text));

  select status, deal_id into v_from, v_deal
    from public.commission_records where id = p_commission_record_id;
  if v_from is null then raise exception 'Commission record % not found', p_commission_record_id; end if;
  if v_from = 'void' then
    return jsonb_build_object('was_transitioned', false, 'status', 'void', 'reason', 'already_void');
  end if;
  if v_from <> 'settled' then
    raise exception 'Only a settled commission can be reversed to void (record % is %)', p_commission_record_id, v_from;
  end if;

  -- Evidence (settled_at, invoice linkage, the three shares, gross) stays frozen;
  -- enforce_settled_commission_immutable permits exactly this settled->void with
  -- those fields unchanged. The BEFORE recompute trigger no-ops (gross/is_po
  -- unchanged), so the split is never rewritten.
  update public.commission_records
     set status = 'void', voided_at = now(), void_reason = btrim(p_reason)
   where id = p_commission_record_id and status = 'settled'
   returning id into v_id;
  if v_id is null then
    select status into v_from from public.commission_records where id = p_commission_record_id;
    return jsonb_build_object('was_transitioned', false, 'status', v_from, 'reason', 'lost_race');
  end if;

  -- Audit trail (the row also carries voided_at/void_reason). Reuses the existing
  -- COMMISSION_STATE_TRANSITION event; no new enum value needed.
  insert into public.activity_logs
    (occurred_at, user_id, event_type, entity_type, entity_id, description, after_values, related_entity_ids)
  values (
    now(), (select auth.uid()), 'COMMISSION_STATE_TRANSITION'::public.activity_event_type,
    'commission_record', p_commission_record_id,
    'Settled commission reversed to void: ' || btrim(p_reason),
    jsonb_build_object('from', 'settled', 'to', 'void', 'void_reason', btrim(p_reason)),
    jsonb_build_array(v_deal));

  return jsonb_build_object('was_transitioned', true, 'from', 'settled', 'to', 'void');
end $function$;

revoke all on function public.owner_void_settled_commission(uuid, text) from public, anon;
grant  execute on function public.owner_void_settled_commission(uuid, text) to authenticated;

-- ===========================================================================
-- 3. Retire the dead settled->payable unsettle. Build 13's immutability trigger
--    now blocks it (settled may only go to void), so it can only raise a raw
--    restrict_violation. Redirect it to a clear, actionable error pointing at
--    the sanctioned reversal, so any caller fails loudly with guidance. (Shim
--    kept — not dropped — so the C4 signature stays resolvable.)
-- ===========================================================================
create or replace function public.stub_unsettle_from_partner_invoice(
  p_commission_record_id uuid, p_partner_invoice_id uuid
) returns jsonb
 language plpgsql security definer set search_path = '' as $function$
begin
  raise exception
    'Unsettle (settled->payable) is retired: a settled commission is immutable (Build 13). Reverse it with owner_void_settled_commission(commission_record_id, reason) instead.'
    using errcode = 'restrict_violation';
end $function$;

-- ===========================================================================
-- 4. Assertions (structural + grant matrix). The full settled->void behaviour
--    runs through the immutability trigger and needs owner auth context + a real
--    settled commission (0 live) — verified at the owner smoke test, consistent
--    with Build 10's mark-paid/settle asserts.
-- ===========================================================================
do $$
begin
  if to_regprocedure('public.owner_void_settled_commission(uuid,text)') is null then
    raise exception 'assert FAIL: owner_void_settled_commission missing'; end if;
  if not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='commission_records' and column_name='voided_at') then
    raise exception 'assert FAIL: commission_records.voided_at missing'; end if;
  if not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='commission_records' and column_name='void_reason') then
    raise exception 'assert FAIL: commission_records.void_reason missing'; end if;
  -- grant matrix: owner-gated in-body but callable by authenticated; never anon.
  if not has_function_privilege('authenticated', 'public.owner_void_settled_commission(uuid,text)', 'execute') then
    raise exception 'assert FAIL: authenticated cannot execute owner_void_settled_commission'; end if;
  if has_function_privilege('anon', 'public.owner_void_settled_commission(uuid,text)', 'execute') then
    raise exception 'assert FAIL: anon can execute owner_void_settled_commission'; end if;
  -- the retired unsettle must still resolve (shim present), now raising guidance.
  if to_regprocedure('public.stub_unsettle_from_partner_invoice(uuid,uuid)') is null then
    raise exception 'assert FAIL: stub_unsettle_from_partner_invoice shim missing'; end if;
  raise notice 'Build 13.1: settled-commission reversal RPC created; asserts passed.';
end $$;
