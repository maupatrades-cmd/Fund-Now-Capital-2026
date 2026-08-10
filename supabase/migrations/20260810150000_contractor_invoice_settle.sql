-- Build 10 — owner marks a contractor invoice PAID + atomic settle + EFT proof.
-- ============================================================================
-- The contractor analogue of the C4 partner mark-paid/settle path
-- (owner_mark_invoice_paid + stub_settle_from_partner_invoice). Once FNC has
-- actually paid the contractor by EFT, the owner records the payment (reference
-- + optional proof-of-payment file) and the linked contractor commissions move
-- payable -> settled ATOMICALLY in the same transaction.
--
-- Mirrors the audited partner implementation almost line-for-line:
--   * owner-gated, advisory-locked per invoice, state-guarded (approved -> paid),
--     RETURNING row-count checked, idempotent (a 2nd call on a paid invoice is a
--     no-op), notification + activity-logged.
--   * settle is per-record advisory-locked + idempotent; the BEFORE recompute
--     trigger no-ops on contractor rows (deal_funder_submission_id is null), so
--     the frozen contractor_share is never rewritten.
--
-- Money: contractor_share is already frozen upstream; this lane only flips
-- status -> settled + stamps contractor_invoice_id + settled_at. No amount math.
-- contractor_invoices + commission_records are empty today, so the new column,
-- the reserved FK stamp, and the bucket are metadata-only.
--
-- Depends on #168 (contractor_invoices + line items + CONTRACTOR_INVOICE_PAID
-- enum + log_contractor_invoice_activity) already applied.
-- ============================================================================

-- ===========================================================================
-- 1. EFT proof-of-payment: an optional path column + a PRIVATE owner-only bucket
--    (FNC-internal evidence; contractors never see it). Empty table -> inline.
-- ===========================================================================
alter table public.contractor_invoices add column if not exists paid_proof_path text;

-- Private bucket with a server-side 10 MB size bound + PDF/image MIME allow-list
-- (defense-in-depth alongside the client-side check in the upload UI).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('contractor-invoice-proofs', 'contractor-invoice-proofs', false, 10485760,
          array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

-- Owner-only ALL (mirrors invoices_owner_all). No contractor policy: EFT proof
-- is FNC's own payment evidence, not contractor-facing.
drop policy if exists contractor_invoice_proofs_owner_all on storage.objects;
create policy contractor_invoice_proofs_owner_all on storage.objects
  for all to authenticated
  using (bucket_id = 'contractor-invoice-proofs' and public.is_owner())
  with check (bucket_id = 'contractor-invoice-proofs' and public.is_owner());

-- ===========================================================================
-- 2. notify_commission_paid — make it attribution-aware. The existing trigger
--    hard-codes "Partner commission of R{partner_share}", which is wrong (and
--    R0) for a settled CONTRACTOR commission. Add a contractor branch using
--    contractor_share + "Contractor commission"; partner wording is unchanged.
--    (award_commission_badges is already contractor-aware — untouched.)
-- ===========================================================================
create or replace function public.notify_commission_paid()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_ref text; v_recipient uuid;
begin
  if new.status = 'settled' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select reference into v_ref from public.deals where id = new.deal_id;
    v_recipient := public.notify_owner();
    if new.contractor_id is not null and new.attribution_type = 'FNC_Contractor' then
      perform public.emit_in_app_notification(v_recipient, 'COMMISSION_PAID', 'Commission paid',
        'Contractor commission of R' || trim(to_char(new.contractor_share, 'FM999G999G990D00')) ||
        ' for ' || coalesce(v_ref, 'a deal') || ' has been settled and paid.',
        '/deals/' || new.deal_id::text,
        jsonb_build_object('commission_record_id', new.id, 'deal_id', new.deal_id));
    else
      perform public.emit_in_app_notification(v_recipient, 'COMMISSION_PAID', 'Commission paid',
        'Partner commission of R' || trim(to_char(new.partner_share, 'FM999G999G990D00')) ||
        ' for ' || coalesce(v_ref, 'a deal') || ' has been settled and paid.',
        '/deals/' || new.deal_id::text,
        jsonb_build_object('commission_record_id', new.id, 'deal_id', new.deal_id));
    end if;
  end if;
  return null;
end $function$;

-- ===========================================================================
-- 3. settle_from_contractor_invoice — payable -> settled + stamp
--    contractor_invoice_id + settled_at. Owner-gated, per-record advisory-locked,
--    idempotent. INTERNAL: only owner_mark_contractor_invoice_paid calls it
--    (a DEFINER function, so the inner call runs with the definer's rights) —
--    execute is revoked from every API role.
-- ===========================================================================
create or replace function public.settle_from_contractor_invoice(
  p_commission_record_id uuid, p_contractor_invoice_id uuid
) returns jsonb
 language plpgsql security definer set search_path = '' as $function$
declare v_from public.commission_state; v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can settle commission records';
  end if;
  perform pg_advisory_xact_lock(hashtext('commission_record:' || p_commission_record_id::text));

  select status into v_from from public.commission_records where id = p_commission_record_id;
  if v_from is null then raise exception 'Commission record % not found', p_commission_record_id; end if;
  if v_from = 'settled' then
    return jsonb_build_object('was_transitioned', false, 'status', 'settled', 'reason', 'already_settled');
  end if;
  if v_from <> 'payable' then
    raise exception 'Only a payable commission can be settled (record % is %)', p_commission_record_id, v_from;
  end if;

  -- Defense-in-depth: never settle a commission across contractors. Line items
  -- are RPC-scoped to the invoice's contractor at generation, so this can only
  -- fail on a corrupt/mis-inserted line — in which case fail closed rather than
  -- stamping one contractor's payable onto another contractor's invoice.
  if (select cr.contractor_id from public.commission_records cr where cr.id = p_commission_record_id)
     is distinct from
     (select ci.contractor_id from public.contractor_invoices ci where ci.id = p_contractor_invoice_id) then
    raise exception 'Commission % does not belong to the contractor on invoice %',
      p_commission_record_id, p_contractor_invoice_id;
  end if;

  update public.commission_records
     set status = 'settled', settled_at = now(), contractor_invoice_id = p_contractor_invoice_id
   where id = p_commission_record_id and status = 'payable'
   returning id into v_id;
  if v_id is null then
    select status into v_from from public.commission_records where id = p_commission_record_id;
    return jsonb_build_object('was_transitioned', false, 'status', v_from, 'reason', 'lost_race');
  end if;
  return jsonb_build_object('was_transitioned', true, 'from', 'payable', 'to', 'settled');
end $function$;

-- ===========================================================================
-- 4. owner_mark_contractor_invoice_paid — approved -> paid (+ reference + optional
--    proof), settle each invoiced commission, notify the contractor, log PAYMENT.
-- ===========================================================================
create or replace function public.owner_mark_contractor_invoice_paid(
  p_invoice_id uuid, p_paid_reference text, p_paid_proof_path text default null
) returns jsonb
 language plpgsql security definer set search_path = '' as $function$
declare v_inv public.contractor_invoices; v_id uuid; v_settled int := 0; r record; v_res jsonb;
begin
  if not public.is_owner() then raise exception 'Only the owner can mark contractor invoices paid'; end if;
  if p_paid_reference is null or btrim(p_paid_reference) = '' then
    raise exception 'An EFT payment reference is required';
  end if;
  perform pg_advisory_xact_lock(hashtext('contractor_invoice_state:' || p_invoice_id::text));

  select * into v_inv from public.contractor_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'Invoice % not found', p_invoice_id; end if;
  if v_inv.state = 'paid' then
    return jsonb_build_object('invoice_id', v_inv.id, 'state', 'paid', 'changed', false);
  end if;
  if v_inv.state <> 'approved' then
    raise exception 'Only an approved invoice can be marked paid (invoice % is %)', v_inv.invoice_number, v_inv.state;
  end if;

  update public.contractor_invoices
     set state = 'paid', paid_at = now(), paid_reference = btrim(p_paid_reference),
         paid_proof_path = coalesce(nullif(btrim(p_paid_proof_path), ''), paid_proof_path)
   where id = p_invoice_id and state = 'approved' returning id into v_id;
  if v_id is null then raise exception 'Invoice % was not marked paid (no row written)', p_invoice_id; end if;

  -- Settle each invoiced commission (payable -> settled + stamp contractor_invoice_id).
  -- The -> settled UPDATE fires notify_commission_paid (COMMISSION_PAID to owner).
  -- Idempotent per record.
  for r in select commission_record_id from public.contractor_invoice_line_items where invoice_id = p_invoice_id loop
    v_res := public.settle_from_contractor_invoice(r.commission_record_id, p_invoice_id);
    -- Count only rows that ACTUALLY transitioned payable -> settled, so the
    -- activity log reflects real settlements, not the line-item count.
    if coalesce((v_res->>'was_transitioned')::boolean, false) then
      v_settled := v_settled + 1;
    end if;
  end loop;

  perform public.emit_in_app_notification(
    v_inv.contractor_id, 'CONTRACTOR_INVOICE_PAID', 'Invoice paid',
    'Your invoice ' || v_inv.invoice_number || ' — R' || trim(to_char(v_inv.total_amount, 'FM999G999G990D00')) ||
    ' — has been paid. Payment reference: ' || btrim(p_paid_reference) || '.',
    '/contractor/invoices', jsonb_build_object('contractor_invoice_id', v_inv.id));
  perform public.log_contractor_invoice_activity('PAYMENT', v_inv.id, v_inv.contractor_id,
    'Contractor invoice ' || v_inv.invoice_number || ' paid — R' ||
    trim(to_char(v_inv.total_amount, 'FM999G999G990D00')) || ' (ref ' || btrim(p_paid_reference) ||
    '); ' || v_settled || ' commission(s) settled');

  return jsonb_build_object('invoice_id', v_inv.id, 'state', 'paid', 'changed', true, 'commissions_settled', v_settled);
end $function$;

-- ===========================================================================
-- 5. Grants. owner_mark_* -> authenticated (owner-gated in body); settle helper
--    is internal-only (no API role).
-- ===========================================================================
revoke all on function public.owner_mark_contractor_invoice_paid(uuid, text, text) from public, anon;
grant  execute on function public.owner_mark_contractor_invoice_paid(uuid, text, text) to authenticated;
revoke all on function public.settle_from_contractor_invoice(uuid, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 6. Assertions (structural + grant matrix). The full approved->paid->settle
--    path needs owner auth context + a real payable commission (0 live), so it
--    is verified at the owner smoke test; the RPCs mirror the audited partner
--    implementation. Synthetic-free asserts here, consistent with #168.
-- ===========================================================================
do $$
begin
  -- functions present
  if to_regprocedure('public.owner_mark_contractor_invoice_paid(uuid,text,text)') is null then
    raise exception 'assert FAIL: owner_mark_contractor_invoice_paid missing'; end if;
  if to_regprocedure('public.settle_from_contractor_invoice(uuid,uuid)') is null then
    raise exception 'assert FAIL: settle_from_contractor_invoice missing'; end if;

  -- proof column + bucket present
  if not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='contractor_invoices' and column_name='paid_proof_path') then
    raise exception 'assert FAIL: contractor_invoices.paid_proof_path missing'; end if;
  if not exists (select 1 from storage.buckets where id='contractor-invoice-proofs' and public = false) then
    raise exception 'assert FAIL: private contractor-invoice-proofs bucket missing'; end if;
  if not exists (select 1 from pg_policy where polrelid='storage.objects'::regclass
      and polname='contractor_invoice_proofs_owner_all') then
    raise exception 'assert FAIL: contractor-invoice-proofs owner RLS missing'; end if;

  -- grant matrix
  if not has_function_privilege('authenticated',
       'public.owner_mark_contractor_invoice_paid(uuid,text,text)', 'execute') then
    raise exception 'assert FAIL: authenticated cannot execute owner_mark_contractor_invoice_paid'; end if;
  if has_function_privilege('anon',
       'public.owner_mark_contractor_invoice_paid(uuid,text,text)', 'execute') then
    raise exception 'assert FAIL: anon can execute owner_mark_contractor_invoice_paid'; end if;
  if has_function_privilege('authenticated',
       'public.settle_from_contractor_invoice(uuid,uuid)', 'execute') then
    raise exception 'assert FAIL: authenticated can execute the internal settle helper'; end if;

  raise notice 'Build 10: contractor-invoice mark-paid + settle + proof bucket created; asserts passed.';
end $$;
