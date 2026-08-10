-- Build 13 — append-only payout evidence.
-- ============================================================================
-- Once money has actually moved, its evidence must never be silently edited.
-- After an invoice is PAID, its payment evidence (paid_at / paid_reference /
-- paid_proof_path / total_amount) is frozen; after a commission is SETTLED, its
-- amount + settlement linkage + settled_at are frozen. Corrections are made by a
-- REVERSAL (settle → void), never by rewriting a settled row in place.
--
-- Defense-in-depth: all writes already go through owner-gated DEFINER RPCs and
-- table DML is revoked from API roles, but these BEFORE-UPDATE triggers make the
-- immutability a hard database invariant that even a future RPC bug or a manual
-- owner SQL edit cannot bypass.
--
-- DEPENDS ON: #172 (contractor_invoices.paid_proof_path). Apply AFTER #172.
-- plpgsql resolves NEW/OLD fields at runtime, so this file creates cleanly even
-- before that column exists, but the contractor trigger needs it at fire time.
-- ============================================================================

-- ===========================================================================
-- 1. Partner invoice payment evidence — frozen once state = 'paid'.
--    (state itself is already terminal via the existing state guard.)
-- ===========================================================================
create or replace function public.enforce_partner_invoice_paid_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.state = 'paid' then
    if new.paid_at        is distinct from old.paid_at
       or new.paid_reference is distinct from old.paid_reference
       or new.total_amount   is distinct from old.total_amount
       or new.state          is distinct from old.state then
      raise exception
        'Paid-invoice evidence is immutable (invoice %). Correct via a reversal, not an edit.',
        old.invoice_number using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists enforce_partner_invoice_paid_immutable on public.partner_invoices;
create trigger enforce_partner_invoice_paid_immutable
  before update on public.partner_invoices
  for each row execute function public.enforce_partner_invoice_paid_immutable();

-- ===========================================================================
-- 2. Contractor invoice payment evidence — frozen once state = 'paid'
--    (includes paid_proof_path — the EFT proof file).
-- ===========================================================================
create or replace function public.enforce_contractor_invoice_paid_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.state = 'paid' then
    if new.paid_at         is distinct from old.paid_at
       or new.paid_reference  is distinct from old.paid_reference
       or new.paid_proof_path is distinct from old.paid_proof_path
       or new.total_amount    is distinct from old.total_amount
       or new.state           is distinct from old.state then
      raise exception
        'Paid-invoice evidence is immutable (invoice %). Correct via a reversal, not an edit.',
        old.invoice_number using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists enforce_contractor_invoice_paid_immutable on public.contractor_invoices;
create trigger enforce_contractor_invoice_paid_immutable
  before update on public.contractor_invoices
  for each row execute function public.enforce_contractor_invoice_paid_immutable();

-- ===========================================================================
-- 3. Settled commission — amount + linkage + settled_at frozen. The ONLY
--    permitted change out of 'settled' is a reversal to 'void'; every other
--    edit while settled is blocked. (The settle UPDATE itself has old.status =
--    'payable', so it is never caught here.)
-- ===========================================================================
create or replace function public.enforce_settled_commission_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'settled' then
    if new.status = 'settled' then
      if new.settled_at            is distinct from old.settled_at
         or new.partner_invoice_id    is distinct from old.partner_invoice_id
         or new.contractor_invoice_id is distinct from old.contractor_invoice_id
         or new.partner_share         is distinct from old.partner_share
         or new.contractor_share      is distinct from old.contractor_share
         or new.owner_share           is distinct from old.owner_share
         or new.gross_commission      is distinct from old.gross_commission then
        raise exception
          'Settled commission evidence is immutable (record %). Correct via a reversal (void).',
          old.id using errcode = 'restrict_violation';
      end if;
    elsif new.status <> 'void' then
      raise exception
        'A settled commission can only be reversed to void, not moved to % (record %).',
        new.status, old.id using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists enforce_settled_commission_immutable on public.commission_records;
create trigger enforce_settled_commission_immutable
  before update on public.commission_records
  for each row execute function public.enforce_settled_commission_immutable();

-- ===========================================================================
-- 4. Assertions — structural + a rolled-back behavioural check that a paid
--    partner invoice rejects an evidence edit. (contractor paid_proof_path +
--    settled-commission paths are exercised at the smoke test once real money
--    flows; here we keep the synthetic block to partner_invoices only, which has
--    no cross-table FKs to satisfy.)
-- ===========================================================================
do $$
declare v_partner uuid; v_inv uuid;
begin
  if to_regprocedure('public.enforce_partner_invoice_paid_immutable()') is null
     or to_regprocedure('public.enforce_contractor_invoice_paid_immutable()') is null
     or to_regprocedure('public.enforce_settled_commission_immutable()') is null then
    raise exception 'assert FAIL: an immutability trigger function is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname='enforce_partner_invoice_paid_immutable') then
    raise exception 'assert FAIL: partner immutability trigger not attached'; end if;
  if not exists (select 1 from pg_trigger where tgname='enforce_contractor_invoice_paid_immutable') then
    raise exception 'assert FAIL: contractor immutability trigger not attached'; end if;
  if not exists (select 1 from pg_trigger where tgname='enforce_settled_commission_immutable') then
    raise exception 'assert FAIL: settled-commission immutability trigger not attached'; end if;

  -- Behavioural: a paid partner invoice must reject an evidence edit.
  begin
    select id into v_partner from public.referral_partners limit 1;
    if v_partner is null then
      raise notice 'Build 13: no referral_partner — behavioural immutability check skipped';
      raise exception 'ROLLBACK_TEST_DATA';
    end if;
    insert into public.partner_invoices
      (referral_partner_id, invoice_number, invoice_period_start, invoice_period_end,
       total_amount, state, paid_at, paid_reference)
      values (v_partner, 'PI-IMMUT-TEST', current_date - 30, current_date, 100, 'paid', now(), 'REF-1')
      returning id into v_inv;
    begin
      update public.partner_invoices set paid_reference = 'REF-2' where id = v_inv;
      raise exception 'Build 13 assert FAIL: paid-invoice evidence edit was allowed';
    exception when others then
      if sqlerrm not ilike '%immutable%' then raise; end if;
    end;
    raise notice 'Build 13: paid-invoice immutability behavioural assert passed.';
    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;

  raise notice 'Build 13: payout-evidence immutability triggers created; asserts passed.';
end $$;
