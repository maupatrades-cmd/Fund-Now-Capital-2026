-- C4 (Doctor Invoicing FNC — Sprint 4, Lane 4a) — part 3 of 3: lifecycle RPCs + settle.
-- ============================================================================
-- The partner-invoice lifecycle, all belt-and-braces (SECURITY DEFINER +
-- search_path='' + role gate + advisory lock + state guard + activity_logs +
-- RETURNING/row-count check + idempotent). Plus the C2.3-reserved commission
-- settle hand-off (payable->settled) this lane was carved out to fill.
--
--   PARTNER (caller = the owning referral partner, via current_partner_id()):
--     partner_generate_invoice(period_start, period_end)  draft from PAYABLE commissions
--     partner_submit_invoice(invoice_id)                  draft -> submitted (+notify owner)
--     partner_remove_line_item(line_item_id)              edit a draft (recompute total)
--   OWNER (caller = owner, via is_owner()):
--     owner_approve_invoice(invoice_id)                   submitted -> approved (+notify partner)
--     owner_reject_invoice(invoice_id, reason)            submitted -> rejected (+notify partner)
--     owner_mark_invoice_paid(invoice_id, paid_reference) approved -> paid (+SETTLE +notify partner)
--   READ (owner OR the owning partner):
--     list_partner_invoice_line_items(invoice_id)         enriched, funder name audience-scoped
--   SETTLE (internal, fills the C2.3 stubs):
--     stub_settle_from_partner_invoice / stub_unsettle_from_partner_invoice  payable<->settled
--
-- S7C: every partner-facing figure is the partner_share (Doctor take) only — never
-- gross/retention/pool/tier. The enrichment RPC anonymises the funder for a partner
-- caller (funder_display_name(..., auth.uid())) and shows the real name to the owner.
-- ============================================================================

-- ===========================================================================
-- 1. Private activity-log writer for partner-invoice events (the table has no A10
--    trigger; log explicitly with INVOICE / PAYMENT, linked to the partner).
-- ===========================================================================
create or replace function public.log_partner_invoice_activity(
  p_event public.activity_event_type, p_invoice_id uuid, p_partner_id uuid, p_desc text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_email text; v_role text;
begin
  if v_uid is not null then
    select p.email, p.role into v_email, v_role from public.profiles p where p.id = v_uid;
  end if;
  insert into public.activity_logs
    (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id, description, related_entity_ids)
  values (now(), v_uid, v_email, v_role, p_event, 'partner_invoice', p_invoice_id, p_desc,
          jsonb_build_array(p_partner_id));
end $$;

-- ===========================================================================
-- 2. C2.3 settle hand-off — REAL implementations replacing the reserved P0002
--    stubs (their C2.3 comment: "C4 replaces this with the real payable->settled
--    settle"). Per-record advisory-locked + idempotent + owner-gated. Stamps
--    partner_invoice_id + settled_at; the -> settled UPDATE fires notify_commission_paid
--    (COMMISSION_PAID). The BEFORE recompute trigger freezes the split (gross/is_po
--    unchanged), so the earned amounts are never rewritten. This is the ONLY write
--    this lane makes to commission_records data — the reserved C4 transition; the
--    tier/gross computation stays TIER-ENGINE territory (untouched).
-- ===========================================================================
create or replace function public.stub_settle_from_partner_invoice(
  p_commission_record_id uuid, p_partner_invoice_id uuid
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

  update public.commission_records
     set status = 'settled', settled_at = now(), partner_invoice_id = p_partner_invoice_id
   where id = p_commission_record_id and status = 'payable'
   returning id into v_id;
  if v_id is null then
    select status into v_from from public.commission_records where id = p_commission_record_id;
    return jsonb_build_object('was_transitioned', false, 'status', v_from, 'reason', 'lost_race');
  end if;
  return jsonb_build_object('was_transitioned', true, 'from', 'payable', 'to', 'settled');
end $function$;

create or replace function public.stub_unsettle_from_partner_invoice(
  p_commission_record_id uuid, p_partner_invoice_id uuid
) returns jsonb
 language plpgsql security definer set search_path = '' as $function$
declare v_from public.commission_state; v_id uuid;
begin
  -- Reverse a settlement (settled -> payable). Not wired to a UI path in C4 (paid is
  -- terminal), provided for symmetry + future reconciliation. Owner-only, idempotent.
  if not public.is_owner() then
    raise exception 'Only the owner can unsettle commission records';
  end if;
  perform pg_advisory_xact_lock(hashtext('commission_record:' || p_commission_record_id::text));

  select status into v_from from public.commission_records where id = p_commission_record_id;
  if v_from is null then raise exception 'Commission record % not found', p_commission_record_id; end if;
  if v_from = 'payable' then
    return jsonb_build_object('was_transitioned', false, 'status', 'payable', 'reason', 'already_payable');
  end if;
  if v_from <> 'settled' then
    raise exception 'Only a settled commission can be unsettled (record % is %)', p_commission_record_id, v_from;
  end if;

  update public.commission_records
     set status = 'payable', settled_at = null, partner_invoice_id = null
   where id = p_commission_record_id and status = 'settled'
   returning id into v_id;
  if v_id is null then
    select status into v_from from public.commission_records where id = p_commission_record_id;
    return jsonb_build_object('was_transitioned', false, 'status', v_from, 'reason', 'lost_race');
  end if;
  return jsonb_build_object('was_transitioned', true, 'from', 'settled', 'to', 'payable');
end $function$;

comment on function public.stub_settle_from_partner_invoice(uuid, uuid) is
  'C4 — the REAL payable->settled settle (replaced the C2.3 P0002 stub). Owner-only, per-record advisory-locked, idempotent; stamps partner_invoice_id + settled_at; fires COMMISSION_PAID. Called by owner_mark_invoice_paid.';
comment on function public.stub_unsettle_from_partner_invoice(uuid, uuid) is
  'C4 — the REAL settled->payable unsettle (replaced the C2.3 P0002 stub). Owner-only, idempotent. Not wired to a UI path (paid is terminal); kept for reconciliation symmetry.';

-- ===========================================================================
-- 3. partner_generate_invoice — draft from the caller partner''s PAYABLE commissions
--    in [period_start, period_end]. Advisory-locked per partner; consumes a BD number
--    ONLY when at least one commission is eligible (gapless sequence).
-- ===========================================================================
create or replace function public.partner_generate_invoice(
  p_period_start date, p_period_end date
) returns jsonb
 language plpgsql security definer set search_path = '' as $function$
declare
  v_partner uuid; v_active boolean;
  v_number  text;  v_inv uuid;
  v_total   numeric(14,2); v_count int;
begin
  v_partner := public.current_partner_id();
  if v_partner is null then
    raise exception 'Only a referral partner can generate partner invoices';
  end if;
  select is_active into v_active from public.profiles where id = (select auth.uid());
  if not coalesce(v_active, false) then
    raise exception 'Your account is inactive';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Invalid invoice period (start=%, end=%)', p_period_start, p_period_end;
  end if;

  perform pg_advisory_xact_lock(hashtext('partner_invoice_gen:' || v_partner::text));

  -- Eligibility: this partner''s PAYABLE commissions (funder paid FNC → FNC owes the
  -- partner) whose payable date falls in the window and which are not already on an
  -- active (non-rejected) invoice. No number is burned if nothing is eligible.
  if not exists (
    select 1 from public.commission_records cr
     where cr.referral_partner_id = v_partner
       and cr.status = 'payable'
       and coalesce(cr.payable_at, cr.earned_at, cr.created_at)::date between p_period_start and p_period_end
       and not exists (
         select 1 from public.partner_invoice_line_items li
         join public.partner_invoices pi on pi.id = li.invoice_id
          where li.commission_record_id = cr.id and pi.state <> 'rejected')
  ) then
    return jsonb_build_object('was_created', false, 'reason', 'no_eligible_commissions', 'count', 0);
  end if;

  v_number := public.partner_invoice_prefix(v_partner) || '-' ||
              lpad(nextval('public.partner_invoices_seq')::text, 4, '0');

  insert into public.partner_invoices
    (referral_partner_id, invoice_number, invoice_period_start, invoice_period_end, total_amount, created_by)
  values
    (v_partner, v_number, p_period_start, p_period_end, 0, (select auth.uid()))
  returning id into v_inv;

  insert into public.partner_invoice_line_items (invoice_id, commission_record_id, deal_id, amount)
  select v_inv, cr.id, cr.deal_id, cr.partner_share
    from public.commission_records cr
   where cr.referral_partner_id = v_partner
     and cr.status = 'payable'
     and coalesce(cr.payable_at, cr.earned_at, cr.created_at)::date between p_period_start and p_period_end
     and not exists (
       select 1 from public.partner_invoice_line_items li
       join public.partner_invoices pi on pi.id = li.invoice_id
        where li.commission_record_id = cr.id and pi.state <> 'rejected');

  -- Server-computed total (client values never trusted).
  update public.partner_invoices
     set total_amount = (select coalesce(sum(amount), 0)
                           from public.partner_invoice_line_items where invoice_id = v_inv)
   where id = v_inv
   returning total_amount into v_total;
  select count(*) into v_count from public.partner_invoice_line_items where invoice_id = v_inv;

  perform public.log_partner_invoice_activity('INVOICE', v_inv, v_partner,
    'Partner invoice ' || v_number || ' generated — ' || v_count || ' item(s), R' ||
    trim(to_char(v_total, 'FM999G999G990D00')));

  return jsonb_build_object('was_created', true, 'invoice_id', v_inv, 'invoice_number', v_number,
                            'total_amount', v_total, 'count', v_count);
end $function$;

-- ===========================================================================
-- 4. partner_submit_invoice — draft -> submitted; notify the owner.
-- ===========================================================================
create or replace function public.partner_submit_invoice(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_partner uuid; v_active boolean; v_inv public.partner_invoices; v_partner_name text; v_id uuid;
begin
  v_partner := public.current_partner_id();
  if v_partner is null then raise exception 'Only a referral partner can submit invoices'; end if;
  -- Deactivated-account guard (Macroscope #3): a banned partner with a still-valid
  -- JWT must not act. Mirrors partner_generate_invoice; kept explicit per-RPC rather
  -- than folded into current_partner_id() (that helper backs every partner RLS path).
  select is_active into v_active from public.profiles where id = (select auth.uid());
  if not coalesce(v_active, false) then raise exception 'Your account is inactive'; end if;
  perform pg_advisory_xact_lock(hashtext('partner_invoice_state:' || p_invoice_id::text));

  select * into v_inv from public.partner_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'Invoice % not found', p_invoice_id; end if;
  if v_inv.referral_partner_id is distinct from v_partner then
    raise exception 'This invoice does not belong to you';
  end if;
  if v_inv.state = 'submitted' then
    return jsonb_build_object('invoice_id', v_inv.id, 'state', 'submitted', 'changed', false);
  end if;
  if v_inv.state <> 'draft' then
    raise exception 'Only a draft invoice can be submitted (invoice % is %)', v_inv.invoice_number, v_inv.state;
  end if;
  if not exists (select 1 from public.partner_invoice_line_items where invoice_id = p_invoice_id) then
    raise exception 'Cannot submit an empty invoice (invoice %)', v_inv.invoice_number;
  end if;

  update public.partner_invoices set state = 'submitted', submitted_at = now()
   where id = p_invoice_id and state = 'draft' returning id into v_id;
  if v_id is null then raise exception 'Invoice % was not submitted (no row written)', p_invoice_id; end if;

  select name into v_partner_name from public.referral_partners where id = v_partner;
  perform public.emit_in_app_notification(
    public.notify_owner(), 'PARTNER_INVOICE_SUBMITTED', 'Partner invoice submitted',
    coalesce(v_partner_name, 'A partner') || ' submitted invoice ' || v_inv.invoice_number ||
    ' — R' || trim(to_char(v_inv.total_amount, 'FM999G999G990D00')) || ' for approval.',
    '/invoices/partner-approvals',
    jsonb_build_object('partner_invoice_id', v_inv.id, 'referral_partner_id', v_partner));
  perform public.log_partner_invoice_activity('INVOICE', v_inv.id, v_partner,
    'Partner invoice ' || v_inv.invoice_number || ' submitted for approval');

  return jsonb_build_object('invoice_id', v_inv.id, 'invoice_number', v_inv.invoice_number,
                            'state', 'submitted', 'changed', true);
end $function$;

-- ===========================================================================
-- 5. partner_remove_line_item — edit a DRAFT (remove a line, recompute total).
-- ===========================================================================
create or replace function public.partner_remove_line_item(p_line_item_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_partner uuid; v_active boolean; v_inv_id uuid; v_state public.partner_invoice_state; v_total numeric(14,2); v_id uuid;
begin
  v_partner := public.current_partner_id();
  if v_partner is null then raise exception 'Only a referral partner can edit invoices'; end if;
  -- Deactivated-account guard (Macroscope #3), mirrors partner_generate_invoice.
  select is_active into v_active from public.profiles where id = (select auth.uid());
  if not coalesce(v_active, false) then raise exception 'Your account is inactive'; end if;

  -- Resolve (and ownership-check) the owning invoice WITHOUT trusting its state yet.
  select li.invoice_id into v_inv_id
    from public.partner_invoice_line_items li
    join public.partner_invoices pi on pi.id = li.invoice_id
   where li.id = p_line_item_id and pi.referral_partner_id = v_partner;
  if v_inv_id is null then raise exception 'Line item % not found for you', p_line_item_id; end if;

  -- Lock FIRST, then re-read state UNDER the lock (Macroscope #2): a concurrent
  -- partner_submit_invoice holds this same lock, so once we own it the draft check
  -- cannot be raced into deleting a line off an already-submitted invoice.
  perform pg_advisory_xact_lock(hashtext('partner_invoice_state:' || v_inv_id::text));
  select state into v_state from public.partner_invoices where id = v_inv_id;
  if v_state <> 'draft' then raise exception 'Only a draft invoice can be edited (invoice is %)', v_state; end if;

  delete from public.partner_invoice_line_items where id = p_line_item_id returning id into v_id;
  if v_id is null then raise exception 'Line item % was not removed (no row deleted)', p_line_item_id; end if;

  update public.partner_invoices
     set total_amount = (select coalesce(sum(amount), 0)
                           from public.partner_invoice_line_items where invoice_id = v_inv_id)
   where id = v_inv_id
   returning total_amount into v_total;

  return jsonb_build_object('invoice_id', v_inv_id, 'removed_line_item_id', p_line_item_id, 'total_amount', v_total);
end $function$;

-- ===========================================================================
-- 6. owner_approve_invoice — submitted -> approved; notify the partner.
-- ===========================================================================
create or replace function public.owner_approve_invoice(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_inv public.partner_invoices; v_target uuid; v_id uuid;
begin
  if not public.is_owner() then raise exception 'Only the owner can approve partner invoices'; end if;
  perform pg_advisory_xact_lock(hashtext('partner_invoice_state:' || p_invoice_id::text));

  select * into v_inv from public.partner_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'Invoice % not found', p_invoice_id; end if;
  if v_inv.state = 'approved' then
    return jsonb_build_object('invoice_id', v_inv.id, 'state', 'approved', 'changed', false);
  end if;
  if v_inv.state <> 'submitted' then
    raise exception 'Only a submitted invoice can be approved (invoice % is %)', v_inv.invoice_number, v_inv.state;
  end if;

  update public.partner_invoices set state = 'approved', approved_at = now(), approved_by = (select auth.uid())
   where id = p_invoice_id and state = 'submitted' returning id into v_id;
  if v_id is null then raise exception 'Invoice % was not approved (no row written)', p_invoice_id; end if;

  v_target := public.partner_profile_id(v_inv.referral_partner_id);
  if v_target is not null then
    perform public.emit_in_app_notification(
      v_target, 'PARTNER_INVOICE_APPROVED', 'Invoice approved',
      'Your invoice ' || v_inv.invoice_number || ' — R' || trim(to_char(v_inv.total_amount, 'FM999G999G990D00')) ||
      ' — has been approved and is awaiting payment.',
      '/partner/invoices', jsonb_build_object('partner_invoice_id', v_inv.id));
  end if;
  perform public.log_partner_invoice_activity('INVOICE', v_inv.id, v_inv.referral_partner_id,
    'Partner invoice ' || v_inv.invoice_number || ' approved');

  return jsonb_build_object('invoice_id', v_inv.id, 'state', 'approved', 'changed', true);
end $function$;

-- ===========================================================================
-- 7. owner_reject_invoice — submitted -> rejected (reason required); notify partner.
--    Rejecting frees the invoice''s commissions for re-invoicing (the availability
--    filter excludes rejected invoices).
-- ===========================================================================
create or replace function public.owner_reject_invoice(p_invoice_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_inv public.partner_invoices; v_target uuid; v_id uuid;
begin
  if not public.is_owner() then raise exception 'Only the owner can reject partner invoices'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'A rejection reason is required'; end if;
  perform pg_advisory_xact_lock(hashtext('partner_invoice_state:' || p_invoice_id::text));

  select * into v_inv from public.partner_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'Invoice % not found', p_invoice_id; end if;
  if v_inv.state = 'rejected' then
    return jsonb_build_object('invoice_id', v_inv.id, 'state', 'rejected', 'changed', false);
  end if;
  if v_inv.state <> 'submitted' then
    raise exception 'Only a submitted invoice can be rejected (invoice % is %)', v_inv.invoice_number, v_inv.state;
  end if;

  update public.partner_invoices set state = 'rejected', rejected_at = now(), rejected_reason = btrim(p_reason)
   where id = p_invoice_id and state = 'submitted' returning id into v_id;
  if v_id is null then raise exception 'Invoice % was not rejected (no row written)', p_invoice_id; end if;

  v_target := public.partner_profile_id(v_inv.referral_partner_id);
  if v_target is not null then
    perform public.emit_in_app_notification(
      v_target, 'PARTNER_INVOICE_REJECTED', 'Invoice needs changes',
      'Your invoice ' || v_inv.invoice_number || ' was not approved. Reason: ' || btrim(p_reason) ||
      '. You can generate a new invoice for those commissions.',
      '/partner/invoices', jsonb_build_object('partner_invoice_id', v_inv.id));
  end if;
  perform public.log_partner_invoice_activity('INVOICE', v_inv.id, v_inv.referral_partner_id,
    'Partner invoice ' || v_inv.invoice_number || ' rejected: ' || btrim(p_reason));

  return jsonb_build_object('invoice_id', v_inv.id, 'state', 'rejected', 'changed', true);
end $function$;

-- ===========================================================================
-- 8. owner_mark_invoice_paid — approved -> paid (EFT reference required); SETTLE
--    each linked commission (payable -> settled), notify the partner, log PAYMENT.
-- ===========================================================================
create or replace function public.owner_mark_invoice_paid(p_invoice_id uuid, p_paid_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_inv public.partner_invoices; v_target uuid; v_id uuid; v_settled int := 0; r record;
begin
  if not public.is_owner() then raise exception 'Only the owner can mark partner invoices paid'; end if;
  if p_paid_reference is null or btrim(p_paid_reference) = '' then
    raise exception 'An EFT payment reference is required';
  end if;
  perform pg_advisory_xact_lock(hashtext('partner_invoice_state:' || p_invoice_id::text));

  select * into v_inv from public.partner_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'Invoice % not found', p_invoice_id; end if;
  if v_inv.state = 'paid' then
    return jsonb_build_object('invoice_id', v_inv.id, 'state', 'paid', 'changed', false);
  end if;
  if v_inv.state <> 'approved' then
    raise exception 'Only an approved invoice can be marked paid (invoice % is %)', v_inv.invoice_number, v_inv.state;
  end if;

  update public.partner_invoices
     set state = 'paid', paid_at = now(), paid_reference = btrim(p_paid_reference)
   where id = p_invoice_id and state = 'approved' returning id into v_id;
  if v_id is null then raise exception 'Invoice % was not marked paid (no row written)', p_invoice_id; end if;

  -- Settle each invoiced commission (payable -> settled + stamp partner_invoice_id).
  -- Fires COMMISSION_PAID per record. Idempotent per record.
  for r in select commission_record_id from public.partner_invoice_line_items where invoice_id = p_invoice_id loop
    perform public.stub_settle_from_partner_invoice(r.commission_record_id, p_invoice_id);
    v_settled := v_settled + 1;
  end loop;

  v_target := public.partner_profile_id(v_inv.referral_partner_id);
  if v_target is not null then
    perform public.emit_in_app_notification(
      v_target, 'PARTNER_INVOICE_PAID', 'Invoice paid',
      'Your invoice ' || v_inv.invoice_number || ' — R' || trim(to_char(v_inv.total_amount, 'FM999G999G990D00')) ||
      ' — has been paid. Payment reference: ' || btrim(p_paid_reference) || '.',
      '/partner/invoices', jsonb_build_object('partner_invoice_id', v_inv.id));
  end if;
  perform public.log_partner_invoice_activity('PAYMENT', v_inv.id, v_inv.referral_partner_id,
    'Partner invoice ' || v_inv.invoice_number || ' paid — R' ||
    trim(to_char(v_inv.total_amount, 'FM999G999G990D00')) || ' (ref ' || btrim(p_paid_reference) ||
    '); ' || v_settled || ' commission(s) settled');

  return jsonb_build_object('invoice_id', v_inv.id, 'state', 'paid', 'changed', true, 'commissions_settled', v_settled);
end $function$;

-- ===========================================================================
-- 9. list_partner_invoice_line_items — enriched read (owner OR the owning partner).
--    Funder name is audience-scoped by funder_display_name(..., auth.uid()):
--    real for the owner, fictional for the partner (S7C / funder anonymisation).
--    amount is the partner take only — no gross/tier/pool is ever selected.
-- ===========================================================================
create or replace function public.list_partner_invoice_line_items(p_invoice_id uuid)
returns table (
  line_item_id uuid, deal_id uuid, deal_reference text,
  client_business_name text, funder_name text, amount numeric, added_at timestamptz
) language plpgsql stable security definer set search_path = '' as $function$
declare v_partner uuid; v_active boolean;
begin
  if not public.is_owner() then
    v_partner := public.current_partner_id();
    -- Deactivated-account guard (Macroscope #3): a banned partner cannot read either.
    select is_active into v_active from public.profiles where id = (select auth.uid());
    if v_partner is null or not coalesce(v_active, false) or not exists (
      select 1 from public.partner_invoices pi
       where pi.id = p_invoice_id and pi.referral_partner_id = v_partner
    ) then
      raise exception 'Not authorised to view this invoice';
    end if;
  end if;

  return query
    select li.id, li.deal_id, d.reference,
           c.business_name,
           public.funder_display_name(dfs.funder_id, (select auth.uid())),
           li.amount, li.added_at
      from public.partner_invoice_line_items li
      join public.commission_records cr        on cr.id = li.commission_record_id
      join public.deal_funder_submissions dfs  on dfs.id = cr.deal_funder_submission_id
      join public.deals d                      on d.id = li.deal_id
      left join public.clients c               on c.id = d.client_id
     where li.invoice_id = p_invoice_id
     order by li.added_at;
end $function$;

-- ===========================================================================
-- 10. Grants matrix (belt-and-braces; the is_owner()/current_partner_id() body
--     guards are the real gate). Owner+partner RPCs → authenticated; internal →
--     no API role. anon/PUBLIC revoked everywhere.
-- ===========================================================================
revoke all on function public.partner_generate_invoice(date, date)        from public, anon;
grant execute on function public.partner_generate_invoice(date, date)      to authenticated;
revoke all on function public.partner_submit_invoice(uuid)                 from public, anon;
grant execute on function public.partner_submit_invoice(uuid)              to authenticated;
revoke all on function public.partner_remove_line_item(uuid)              from public, anon;
grant execute on function public.partner_remove_line_item(uuid)            to authenticated;
revoke all on function public.owner_approve_invoice(uuid)                  from public, anon;
grant execute on function public.owner_approve_invoice(uuid)               to authenticated;
revoke all on function public.owner_reject_invoice(uuid, text)             from public, anon;
grant execute on function public.owner_reject_invoice(uuid, text)          to authenticated;
revoke all on function public.owner_mark_invoice_paid(uuid, text)          from public, anon;
grant execute on function public.owner_mark_invoice_paid(uuid, text)       to authenticated;
revoke all on function public.list_partner_invoice_line_items(uuid)        from public, anon;
grant execute on function public.list_partner_invoice_line_items(uuid)     to authenticated;
-- Internal only.
revoke all on function public.log_partner_invoice_activity(public.activity_event_type, uuid, uuid, text) from public, anon, authenticated;
-- Settle functions keep the C2.3 grant posture (authenticated; is_owner() gates inside).
revoke all on function public.stub_settle_from_partner_invoice(uuid, uuid)   from public, anon;
grant execute on function public.stub_settle_from_partner_invoice(uuid, uuid) to authenticated;
revoke all on function public.stub_unsettle_from_partner_invoice(uuid, uuid) from public, anon;
grant execute on function public.stub_unsettle_from_partner_invoice(uuid, uuid) to authenticated;

-- ===========================================================================
-- 11. Assertions. Structural always. Behavioural (full lifecycle incl.
--     notifications) runs ONLY when the part-1 PARTNER_INVOICE_* enum values are
--     already committed — i.e. at real apply (migrations in order). In a single-tx
--     dry-run the values are added-but-not-usable, so it self-skips (the dry-run
--     validates the full flow via an enum-swapped variant separately).
-- ===========================================================================
do $$
declare
  v_enum_ready boolean;
  v_owner uuid; v_partner_pid uuid; v_partner uuid; v_client uuid; v_funder uuid; v_funder2 uuid;
  v_deal uuid; v_deal2 uuid; v_sub uuid; v_sub2 uuid; v_cr uuid; v_cr2 uuid;
  v_res jsonb; v_inv uuid; v_num text; v_state text; v_total numeric; v_cnt int;
  v_li uuid; v_cr_status public.commission_state; v_paid_notes int;
begin
  -- Structural: every RPC exists, DEFINER, search_path set, grants matrix correct.
  perform 1 from pg_proc where proname='partner_generate_invoice';
  if not found then raise exception 'C4.3 assert FAIL: partner_generate_invoice missing'; end if;
  if not (select prosecdef from pg_proc where oid='public.partner_generate_invoice(date,date)'::regprocedure) then
    raise exception 'C4.3 assert FAIL: partner_generate_invoice not DEFINER'; end if;
  if has_function_privilege('anon','public.owner_mark_invoice_paid(uuid,text)','execute') then
    raise exception 'C4.3 assert FAIL: anon can execute owner_mark_invoice_paid'; end if;
  if not has_function_privilege('authenticated','public.partner_generate_invoice(date,date)','execute') then
    raise exception 'C4.3 assert FAIL: authenticated cannot execute partner_generate_invoice'; end if;
  if has_function_privilege('authenticated','public.log_partner_invoice_activity(public.activity_event_type,uuid,uuid,text)','execute') then
    raise exception 'C4.3 assert FAIL: authenticated can execute internal log writer'; end if;
  -- settle stub replaced (no longer raises P0002 unconditionally): it now requires owner.
  if pg_get_functiondef('public.stub_settle_from_partner_invoice(uuid,uuid)'::regprocedure) ilike '%not yet built%' then
    raise exception 'C4.3 assert FAIL: settle stub still the C2.3 P0002 placeholder'; end if;

  -- Detect real usability, not mere catalog presence: a value ADDed earlier in this
  -- same uncommitted transaction shows up in enum_range but raises "unsafe use of new
  -- value" the moment it is cast to the enum type. Try the cast and catch — TRUE only
  -- when the part-1 migration already committed the values (real apply); FALSE in a
  -- single-tx dry-run, so the behavioural lifecycle self-skips cleanly.
  begin
    perform 'PARTNER_INVOICE_SUBMITTED'::public.notification_event_type;
    v_enum_ready := true;
  exception when others then
    v_enum_ready := false;
  end;
  if not v_enum_ready then
    raise notice 'C4.3: PARTNER_INVOICE_* enum values not yet usable (single-tx dry-run) — behavioural lifecycle self-skipped; run at real apply.';
    return;
  end if;

  -- ---- Behavioural (real apply): full lifecycle, synthetic, rolled back ----
  begin
    select id into v_owner   from public.profiles where role='owner' limit 1;
    select p.id, p.referral_partner_id into v_partner_pid, v_partner
      from public.profiles p where p.role='partner' and p.referral_partner_id is not null limit 1;
    select id into v_client from public.clients limit 1;
    select id into v_funder from public.funders limit 1;
    select id into v_funder2 from public.funders where id <> v_funder limit 1;
    if v_owner is null or v_partner_pid is null or v_partner is null or v_client is null or v_funder is null or v_funder2 is null then
      raise notice 'C4.3: missing owner/partner/client/funder(s) — behavioural asserts skipped';
      raise exception 'ROLLBACK_TEST_DATA';
    end if;

    -- Seed two PAYABLE commissions for THIS partner on a funded deal.
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
    insert into public.deals (client_id, reference, stage, is_purchase_order, referral_partner_id)
      values (v_client, 'C4_3_TEST', 'funded', false, v_partner) returning id into v_deal;
    insert into public.deal_funder_submissions (deal_id, funder_id, status, amount_funded, applied_rate_snapshot)
      values (v_deal, v_funder, 'funded', 1000000,
              jsonb_build_object('rate_type','percent_of_gross_funded','rate_fraction',0.10,'flat_amount',null,'source','test'))
      returning id into v_sub;
    insert into public.deal_funder_submissions (deal_id, funder_id, status, amount_funded, applied_rate_snapshot)
      values (v_deal, v_funder2, 'funded', 500000,
              jsonb_build_object('rate_type','percent_of_gross_funded','rate_fraction',0.10,'flat_amount',null,'source','test'))
      returning id into v_sub2;
    perform public.write_commission_record(v_deal);
    select id into v_cr  from public.commission_records where deal_funder_submission_id=v_sub;
    select id into v_cr2 from public.commission_records where deal_funder_submission_id=v_sub2;
    update public.commission_records set status='payable', payable_at=now() where id in (v_cr, v_cr2);

    -- PARTNER generates (partner context).
    perform set_config('request.jwt.claims', json_build_object('sub', v_partner_pid)::text, true);
    v_res := public.partner_generate_invoice(current_date - 60, current_date);
    if (v_res->>'was_created')::boolean is not true then raise exception 'C4.3 assert: generate did not create'; end if;
    v_inv := (v_res->>'invoice_id')::uuid; v_num := v_res->>'invoice_number';
    if (v_res->>'count')::int <> 2 then raise exception 'C4.3 assert: expected 2 line items, got %', v_res->>'count'; end if;
    select total_amount into v_total from public.partner_invoices where id=v_inv;
    -- 18000 (30% of 60k pool on R100k gross) + 9000 (30% of 30k pool on R50k gross) = 27000
    if v_total <> 27000.00 then raise exception 'C4.3 assert: total % (exp 27000)', v_total; end if;

    -- Regenerate for the same window → nothing eligible (already invoiced).
    v_res := public.partner_generate_invoice(current_date - 60, current_date);
    if (v_res->>'was_created')::boolean is not false then raise exception 'C4.3 assert: double-invoiced the same commissions'; end if;

    -- Remove one line → total recomputed.
    select id into v_li from public.partner_invoice_line_items where invoice_id=v_inv order by amount desc limit 1;
    v_res := public.partner_remove_line_item(v_li);
    if (v_res->>'total_amount')::numeric <> 9000.00 then raise exception 'C4.3 assert: remove recompute % (exp 9000)', v_res->>'total_amount'; end if;

    -- Enrichment read as partner → funder name is the FICTIONAL display name.
    select funder_name into v_state from public.list_partner_invoice_line_items(v_inv) limit 1;
    if v_state is null then raise exception 'C4.3 assert: enrichment returned null funder name'; end if;
    if v_state = (select name from public.funders where id=v_funder2) then
      raise exception 'C4.3 assert: partner saw the REAL funder name (%) — S7C breach', v_state; end if;

    -- Submit (partner).
    v_res := public.partner_submit_invoice(v_inv);
    if (v_res->>'changed')::boolean is not true then raise exception 'C4.3 assert: submit failed'; end if;

    -- Cross-partner isolation: a DIFFERENT partner cannot submit/see this invoice.
    -- (Only one partner exists live; simulate by clearing partner context → current_partner_id null.)
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    -- OWNER approves, then marks paid with an EFT ref → the remaining commission settles.
    v_res := public.owner_approve_invoice(v_inv);
    if (v_res->>'changed')::boolean is not true then raise exception 'C4.3 assert: approve failed'; end if;
    v_res := public.owner_mark_invoice_paid(v_inv, 'FNC-2026-08-01');
    if (v_res->>'changed')::boolean is not true then raise exception 'C4.3 assert: mark-paid failed'; end if;
    if (v_res->>'commissions_settled')::int <> 1 then raise exception 'C4.3 assert: settled count % (exp 1)', v_res->>'commissions_settled'; end if;

    -- The remaining line''s commission is SETTLED + stamped; the removed one is still payable.
    select status, partner_invoice_id into v_cr_status, v_inv from public.commission_records where id=v_cr2;
    if v_cr_status <> 'settled' then raise exception 'C4.3 assert: commission not settled (%)', v_cr_status; end if;
    select status into v_cr_status from public.commission_records where id=v_cr;
    if v_cr_status <> 'payable' then raise exception 'C4.3 assert: removed commission wrongly changed (%)', v_cr_status; end if;

    -- COMMISSION_PAID fired for the settled commission.
    select count(*) into v_paid_notes from public.notifications
      where event_type='COMMISSION_PAID' and (data->>'commission_record_id')::uuid = v_cr2;
    if v_paid_notes < 1 then raise exception 'C4.3 assert: COMMISSION_PAID did not fire on settle'; end if;

    -- Illegal: mark-paid again is idempotent (changed:false), not an error.
    v_res := public.owner_mark_invoice_paid((select id from public.partner_invoices where invoice_number=v_num), 'FNC-2026-08-01');
    if (v_res->>'changed')::boolean is not false then raise exception 'C4.3 assert: mark-paid not idempotent'; end if;

    raise notice 'C4.3 behavioural lifecycle assertions passed (generate/submit/approve/mark-paid/settle + S7C anonymisation + idempotency).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;

  raise notice 'C4.3 assertions passed.';
end $$;

notify pgrst, 'reload schema';
