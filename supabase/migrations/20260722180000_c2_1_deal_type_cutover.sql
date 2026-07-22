-- C2.1 — deals.deal_type + backfill + generate_funder_invoice cutover + shared gross helper
-- ============================================================================
-- Part of Phase C2 (Commission Records Auto-Wire). This migration lays the
-- deal_type substrate the commission ledger needs and removes the last place the
-- codebase *derives* po/non_po from is_purchase_order.
--
-- What it does:
--   1. Adds nullable public.deals.deal_type (enum) — the source of truth going forward.
--   2. Backfills existing deals: is_purchase_order ? 'po' : 'non_po'
--      (all live deals are non_po today, but the general rule is correct for any).
--   3. Extends deals_before_write() to keep deal_type <-> is_purchase_order in
--      lockstep from EITHER entry point, so the boolean stays valid until the
--      /new-deal + /deal-edit dropdowns (New CC, frontend) start sending deal_type.
--   4. Adds public.fnc_gross_commission(...) — the single rate_type-switched gross
--      calculator, so generate_funder_invoice (now) and write_commission_record
--      (C2.2) can never diverge on the FNC gross figure.
--   5. Cuts generate_funder_invoice over to read deals.deal_type (coalesced to the
--      legacy derivation for safety) and to compute gross via the shared helper.
--
-- No FK columns are added (deal_type is an enum), so the NOT VALID / CONCURRENTLY /
-- VALIDATE dance does not apply here; ADD COLUMN of a nullable enum is metadata-only.
-- Money numeric(14,2), percentages numeric(10,4) per standing rules.
-- ============================================================================

-- 1. Column ---------------------------------------------------------------------
alter table public.deals
  add column if not exists deal_type public.deal_type;

comment on column public.deals.deal_type is
  'Deal type driving funder rate lookup + commission tier (C2.1). Source of truth; is_purchase_order is kept in sync by deals_before_write(). Nullable only transitionally — backfilled at migration time and never left null thereafter.';

-- 2. Backfill -------------------------------------------------------------------
update public.deals
   set deal_type = case when is_purchase_order then 'po'::public.deal_type
                        else 'non_po'::public.deal_type end
 where deal_type is null;

-- 3. Bidirectional sync in the existing BEFORE-write trigger ---------------------
create or replace function public.deals_before_write()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    if new.reference is null then
      new.reference := 'DEAL-' || lpad(nextval('public.deals_reference_seq')::text, 3, '0');
    end if;
    new.stage_entered_at := coalesce(new.stage_entered_at, now());
  elsif tg_op = 'UPDATE' then
    if new.stage is distinct from old.stage then
      new.stage_entered_at := now();
    end if;
  end if;

  -- C2.1: keep deal_type and is_purchase_order consistent, deriving from whichever
  -- field the caller actually changed. This matters during the UI transition: the
  -- current deal-edit form still writes ONLY is_purchase_order (no deal_type), and a
  -- naive "deal_type is authoritative when non-null" rule would silently revert that
  -- boolean-only write once every row is backfilled. So:
  --   * no deal_type supplied (null)                    -> derive deal_type from the boolean
  --   * UPDATE that changed the boolean but not deal_type -> derive deal_type from the boolean (legacy path)
  --   * otherwise (deal_type supplied / changed)         -> deal_type authoritative, derive the boolean
  if new.deal_type is null then
    new.deal_type := case when new.is_purchase_order then 'po'::public.deal_type
                          else 'non_po'::public.deal_type end;
  elsif tg_op = 'UPDATE'
        and new.is_purchase_order is distinct from old.is_purchase_order
        and new.deal_type is not distinct from old.deal_type then
    new.deal_type := case when new.is_purchase_order then 'po'::public.deal_type
                          else 'non_po'::public.deal_type end;
  else
    new.is_purchase_order := (new.deal_type = 'po'::public.deal_type);
  end if;

  return new;
end;
$function$;

-- 4. Shared gross-commission helper --------------------------------------------
-- Single source of truth for the FNC gross commission, switching on rate_type.
-- Pure (no table access) → IMMUTABLE. Called only from SECURITY DEFINER money
-- functions (generate_funder_invoice, and write_commission_record in C2.2), which
-- execute as the function owner, so it is locked away from anon/authenticated.
create or replace function public.fnc_gross_commission(
  p_rate_type      public.funder_rate_type,
  p_rate_fraction  numeric,
  p_flat_amount    numeric,
  p_amount_funded  numeric,
  p_finance_charge numeric
) returns numeric
 language plpgsql
 immutable
 set search_path to ''
as $function$
declare
  v numeric(14,2);
begin
  if p_rate_type = 'percent_of_gross_funded' then
    if p_amount_funded is null then
      raise exception 'fnc_gross_commission: amount_funded is required for percent_of_gross_funded';
    end if;
    v := round(p_rate_fraction * p_amount_funded, 2);
  elsif p_rate_type = 'percent_of_finance_charge' then
    if p_finance_charge is null then
      raise exception 'This funder charges commission on the finance charge — capture the finance charge amount first';
    end if;
    v := round(p_rate_fraction * p_finance_charge, 2);
  elsif p_rate_type = 'flat_rand_per_deal' then
    v := round(p_flat_amount, 2);
  elsif p_rate_type = 'percent_of_mdr' then
    raise exception 'percent_of_mdr commission is not supported yet (deferred to the first MCA deal)';
  else
    raise exception 'Unknown rate_type %', p_rate_type;
  end if;
  return v;
end;
$function$;

comment on function public.fnc_gross_commission(public.funder_rate_type, numeric, numeric, numeric, numeric) is
  'C2.1 — single rate_type-switched FNC gross-commission calculator. Called by generate_funder_invoice and (C2.2) write_commission_record so the funder invoice and the commission ledger can never diverge on gross. Signature: (rate_type, rate_fraction, flat_amount, amount_funded, finance_charge) -> numeric(14,2). Raises on percent_of_mdr (deferred) and on a null finance charge for percent_of_finance_charge.';

-- Belt-and-braces: lock the helper away from client roles (owner-context callers only).
revoke all on function public.fnc_gross_commission(public.funder_rate_type, numeric, numeric, numeric, numeric) from public;

-- 5. Cut generate_funder_invoice over to deals.deal_type + the shared helper -----
create or replace function public.generate_funder_invoice(p_submission_id uuid, p_finance_charge numeric DEFAULT NULL::numeric, p_contract_ref text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_sub        public.deal_funder_submissions;
  v_deal       public.deals;
  v_client     public.clients;
  v_funder     public.funders;
  v_existing   public.funder_invoices;
  v_rate       public.funder_commission_structures;
  v_deal_type  public.deal_type;
  v_as_of      date;
  v_rate_type  public.funder_rate_type;
  v_rate_frac  numeric;
  v_flat       numeric;
  v_fin_charge numeric;
  v_commission numeric(14,2);
  v_snapshot   jsonb;
  v_number     text;
  v_terms_days int;
  v_terms_text text;
  v_due        date;
  v_ref        text;
  v_funder_short text;
  v_client_short text;
  v_desc       text;
  v_contract   text;
  v_rate_disp  text;
  v_basis      text;
  v_id         uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can generate funder invoices';
  end if;

  perform pg_advisory_xact_lock(hashtext('funder_invoice:' || p_submission_id::text));

  select * into v_sub from public.deal_funder_submissions where id = p_submission_id;
  if v_sub.id is null then
    raise exception 'Submission % not found', p_submission_id;
  end if;

  select * into v_existing from public.funder_invoices
   where deal_funder_submission_id = p_submission_id and state <> 'void' limit 1;
  if v_existing.id is not null then
    return jsonb_build_object(
      'invoice_id', v_existing.id, 'invoice_number', v_existing.invoice_number,
      'commission_amount', v_existing.commission_amount, 'total_amount', v_existing.total_amount,
      'payment_reference_expected', v_existing.payment_reference_expected, 'was_created', false);
  end if;

  if v_sub.amount_funded is null then
    raise exception 'Cannot invoice: submission % has no amount_funded (the deal must be funded first)', p_submission_id;
  end if;

  select * into v_deal   from public.deals   where id = v_sub.deal_id;
  select * into v_client from public.clients where id = v_deal.client_id;
  select * into v_funder from public.funders where id = v_sub.funder_id;

  -- C2.1: deals.deal_type is the source of truth; fall back to the legacy
  -- is_purchase_order derivation only if a row somehow has a null deal_type
  -- (backfilled + kept in sync by deals_before_write(), so this is belt-and-braces).
  v_deal_type := coalesce(
    v_deal.deal_type,
    case when v_deal.is_purchase_order then 'po'::public.deal_type else 'non_po'::public.deal_type end);

  if v_sub.applied_rate_snapshot is not null then
    v_snapshot   := v_sub.applied_rate_snapshot;
    v_rate_type  := (v_snapshot->>'rate_type')::public.funder_rate_type;
    v_rate_frac  := (v_snapshot->>'rate_fraction')::numeric;
    v_flat       := (v_snapshot->>'flat_amount')::numeric;
    v_contract   := coalesce(p_contract_ref, v_snapshot->>'contract_reference');
    v_terms_days := coalesce((v_snapshot->>'payment_terms_days')::int, 0);
  else
    v_as_of := coalesce(v_sub.approved_at::date, v_sub.funded_at::date, public.current_sast_date());
    v_rate  := public.funder_rate_at(v_sub.funder_id, v_deal_type, v_as_of);
    if v_rate.id is null then
      raise exception 'No commission rate structure for this funder as of % — capture it in Settings first', v_as_of;
    end if;
    v_rate_type  := v_rate.rate_type;
    v_rate_frac  := v_rate.rate_fraction;
    v_flat       := v_rate.flat_amount;
    v_contract   := coalesce(p_contract_ref, v_rate.contract_reference);
    v_terms_days := coalesce(v_rate.payment_terms_days, 0);
    v_snapshot   := jsonb_build_object(
      'rate_type', v_rate.rate_type, 'rate_fraction', v_rate.rate_fraction,
      'flat_amount', v_rate.flat_amount, 'deal_type', v_deal_type,
      'effective_from', v_rate.effective_from, 'effective_to', v_rate.effective_to,
      'contract_reference', v_rate.contract_reference, 'payment_terms_days', v_rate.payment_terms_days,
      'as_of', v_as_of, 'source', 'funder_rate_at');
  end if;

  v_fin_charge := coalesce(p_finance_charge, v_sub.finance_charge_amount);

  -- C2.1: gross via the shared helper (single source of truth). It raises on a
  -- null finance charge for percent_of_finance_charge, on percent_of_mdr, and on
  -- an unknown rate_type — identical to the previous inline behaviour.
  v_commission := public.fnc_gross_commission(v_rate_type, v_rate_frac, v_flat, v_sub.amount_funded, v_fin_charge);

  -- Presentation-only bits for the funder-facing description.
  if v_rate_type = 'percent_of_gross_funded' then
    v_rate_disp := trim(trailing '.' from to_char(v_rate_frac * 100, 'FM999990.99')) || '%';
    v_basis     := 'funded amount';
  elsif v_rate_type = 'percent_of_finance_charge' then
    v_rate_disp := trim(trailing '.' from to_char(v_rate_frac * 100, 'FM999990.99')) || '%';
    v_basis     := 'finance charge on the facility';
  elsif v_rate_type = 'flat_rand_per_deal' then
    v_rate_disp := 'R' || trim(to_char(v_flat, 'FM999G999G990D00'));
    v_basis     := 'deal (flat fee)';
  end if;

  v_funder_short := public.funder_shortcode(v_sub.funder_id);
  v_client_short := public.client_shortcode(v_deal.client_id);
  if v_funder_short is null or v_client_short is null then
    raise exception 'Cannot generate invoice: funder short_code=%, client short_code=%. Both must be set before invoicing.',
      v_funder_short, v_client_short
      using hint = 'Set the missing short_code(s) in /settings/funders (funder) or on the client detail page.';
  end if;

  v_number     := 'INV-' || lpad(nextval('public.funder_invoices_seq')::text, 4, '0');

  if v_terms_days = 0 then
    v_terms_text := 'Due on receipt';
    v_due        := public.current_sast_date();
  else
    v_terms_text := v_terms_days || ' days from invoice date';
    v_due        := public.current_sast_date() + v_terms_days;
  end if;

  v_ref := v_funder_short || '-INV' || split_part(v_number, '-', 2) || '-' || v_client_short;

  v_desc := 'Lead Provider Commission — commission earned per the ' ||
            coalesce(v_contract, 'Lead Provider Agreement') || ', calculated as ' ||
            v_rate_disp || ' of the ' || v_basis || ' advanced by ' || v_funder.name ||
            ' to the client ' || coalesce(v_client.business_name, '?') || '.';

  insert into public.funder_invoices (
    invoice_number, deal_id, deal_funder_submission_id, funder_id, client_reference,
    facility_advanced, finance_charge_amount, commission_amount, vat_amount, total_amount,
    rate_snapshot, commission_description, contract_reference, payment_reference_expected,
    payment_terms, due_date, notes
  ) values (
    v_number, v_sub.deal_id, p_submission_id, v_sub.funder_id, coalesce(v_client.business_name, '?'),
    v_sub.amount_funded, v_fin_charge, v_commission, null, v_commission,
    v_snapshot, v_desc, v_contract, v_ref, v_terms_text, v_due, p_notes
  )
  on conflict (deal_funder_submission_id) where (state <> 'void') do nothing
  returning id into v_id;

  if v_id is null then
    select * into v_existing from public.funder_invoices
     where deal_funder_submission_id = p_submission_id and state <> 'void' limit 1;
    return jsonb_build_object(
      'invoice_id', v_existing.id, 'invoice_number', v_existing.invoice_number,
      'commission_amount', v_existing.commission_amount, 'total_amount', v_existing.total_amount,
      'payment_reference_expected', v_existing.payment_reference_expected, 'was_created', false);
  end if;

  perform public.log_invoice_activity('INVOICE', v_id, v_sub.deal_id,
    'Invoice ' || v_number || ' drafted for ' || v_funder.name || ' (' ||
    coalesce(v_client.business_name, '?') || ') — R' || trim(to_char(v_commission, 'FM999G999G990D00')));

  return jsonb_build_object(
    'invoice_id', v_id, 'invoice_number', v_number, 'commission_amount', v_commission,
    'total_amount', v_commission, 'payment_reference_expected', v_ref, 'was_created', true);
end $function$;

-- 6. Assertions -----------------------------------------------------------------
do $$
declare
  v_null_types int;
  v_out_of_sync int;
  v_g1 numeric;
  v_g2 numeric;
begin
  -- column exists
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='deals' and column_name='deal_type') then
    raise exception 'assert failed: deals.deal_type column missing';
  end if;

  -- every deal backfilled
  select count(*) into v_null_types from public.deals where deal_type is null;
  if v_null_types <> 0 then
    raise exception 'assert failed: % deals still have null deal_type', v_null_types;
  end if;

  -- deal_type and is_purchase_order agree everywhere
  select count(*) into v_out_of_sync
    from public.deals where is_purchase_order <> (deal_type = 'po'::public.deal_type);
  if v_out_of_sync <> 0 then
    raise exception 'assert failed: % deals have is_purchase_order out of sync with deal_type', v_out_of_sync;
  end if;

  -- shared helper computes the two happy paths correctly
  v_g1 := public.fnc_gross_commission('percent_of_gross_funded'::public.funder_rate_type, 0.1000, null, 1000000, null);
  if v_g1 <> 100000.00 then
    raise exception 'assert failed: fnc_gross_commission gross_funded got % (expected 100000.00)', v_g1;
  end if;
  v_g2 := public.fnc_gross_commission('flat_rand_per_deal'::public.funder_rate_type, null, 7500, 999999, null);
  if v_g2 <> 7500.00 then
    raise exception 'assert failed: fnc_gross_commission flat got % (expected 7500.00)', v_g2;
  end if;

  -- generate_funder_invoice still resolves with its expected signature
  perform 'public.generate_funder_invoice(uuid,numeric,text,text)'::regprocedure;

  raise notice 'C2.1 assertions passed: deal_type backfilled + synced, shared gross helper live, generate_funder_invoice cut over.';
end $$;
