-- Build 14 — invoice rejection & resubmission trail.
-- ============================================================================
-- Rejection already keeps the rejected invoice + its reason (auditable) and
-- frees its commissions so the payee can raise a corrected invoice (the no-
-- double-invoice guard ignores rejected invoices). What was missing is the
-- VISIBLE LINK between a new invoice and the rejected one(s) it replaces.
--
-- This lane adds that link as a READ-ONLY reconstruction — NO schema change to
-- the money tables, NO edit to the audited generate/reject RPCs. A new invoice
-- "supersedes" any REJECTED invoice that shares ≥1 of the same commission line
-- items. Two DEFINER read RPCs (partner + contractor), each authorised to the
-- owner or the owning payee, return that chain for a given invoice.
--
-- Money-safe by construction: reads only; the rejected invoice stays exactly as
-- it was (Build 13 also freezes any paid evidence).
-- ============================================================================

-- ===========================================================================
-- 1. Partner — rejected invoices this invoice re-bills.
-- ===========================================================================
create or replace function public.list_partner_invoice_supersessions(p_invoice_id uuid)
returns table (
  invoice_id       uuid,
  invoice_number   text,
  rejected_at      timestamptz,
  rejected_reason  text,
  shared_line_count int
) language plpgsql stable security definer set search_path = '' as $$
declare v_gen timestamptz;
begin
  if not public.is_owner() then
    if not exists (
      select 1 from public.partner_invoices pi
       where pi.id = p_invoice_id
         and pi.referral_partner_id = public.current_partner_id()
    ) then
      raise exception 'Not authorised to view this invoice';
    end if;
  end if;

  -- Trail points STRICTLY BACKWARD: only rejected invoices generated before this
  -- one. Prevents two rejected invoices sharing commissions from mutually listing
  -- each other as "replaced".
  select generated_at into v_gen from public.partner_invoices where id = p_invoice_id;

  return query
    select other.id, other.invoice_number, other.rejected_at, other.rejected_reason,
           count(*)::int as shared_line_count
      from public.partner_invoice_line_items li
      join public.partner_invoice_line_items oli
        on oli.commission_record_id = li.commission_record_id
      join public.partner_invoices other
        on other.id = oli.invoice_id
     where li.invoice_id = p_invoice_id
       and other.id <> p_invoice_id
       and other.state = 'rejected'
       and other.generated_at < v_gen
     group by other.id, other.invoice_number, other.rejected_at, other.rejected_reason
     order by other.rejected_at desc nulls last;
end $$;

-- ===========================================================================
-- 2. Contractor — rejected invoices this invoice re-bills.
-- ===========================================================================
create or replace function public.list_contractor_invoice_supersessions(p_invoice_id uuid)
returns table (
  invoice_id       uuid,
  invoice_number   text,
  rejected_at      timestamptz,
  rejected_reason  text,
  shared_line_count int
) language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_gen timestamptz;
begin
  if not public.is_owner() then
    if not exists (
      select 1 from public.contractor_invoices ci
       where ci.id = p_invoice_id and ci.contractor_id = v_uid
    ) then
      raise exception 'Not authorised to view this invoice';
    end if;
  end if;

  -- Trail points STRICTLY BACKWARD (see the partner RPC).
  select generated_at into v_gen from public.contractor_invoices where id = p_invoice_id;

  return query
    select other.id, other.invoice_number, other.rejected_at, other.rejected_reason,
           count(*)::int as shared_line_count
      from public.contractor_invoice_line_items li
      join public.contractor_invoice_line_items oli
        on oli.commission_record_id = li.commission_record_id
      join public.contractor_invoices other
        on other.id = oli.invoice_id
     where li.invoice_id = p_invoice_id
       and other.id <> p_invoice_id
       and other.state = 'rejected'
       and other.generated_at < v_gen
     group by other.id, other.invoice_number, other.rejected_at, other.rejected_reason
     order by other.rejected_at desc nulls last;
end $$;

-- ===========================================================================
-- 3. Grants — owner-or-owning-payee gated in-body; grant execute to authenticated.
-- ===========================================================================
revoke all on function public.list_partner_invoice_supersessions(uuid)    from public, anon;
grant  execute on function public.list_partner_invoice_supersessions(uuid)  to authenticated;
revoke all on function public.list_contractor_invoice_supersessions(uuid)  from public, anon;
grant  execute on function public.list_contractor_invoice_supersessions(uuid) to authenticated;

-- ===========================================================================
-- 4. Assertions.
-- ===========================================================================
do $$
begin
  if to_regprocedure('public.list_partner_invoice_supersessions(uuid)') is null then
    raise exception 'assert FAIL: list_partner_invoice_supersessions missing'; end if;
  if to_regprocedure('public.list_contractor_invoice_supersessions(uuid)') is null then
    raise exception 'assert FAIL: list_contractor_invoice_supersessions missing'; end if;
  if not has_function_privilege('authenticated','public.list_partner_invoice_supersessions(uuid)','execute') then
    raise exception 'assert FAIL: authenticated cannot execute partner supersessions'; end if;
  if not has_function_privilege('authenticated','public.list_contractor_invoice_supersessions(uuid)','execute') then
    raise exception 'assert FAIL: authenticated cannot execute contractor supersessions'; end if;
  if has_function_privilege('anon','public.list_partner_invoice_supersessions(uuid)','execute') then
    raise exception 'assert FAIL: anon can execute partner supersessions'; end if;
  raise notice 'Build 14: invoice resubmission-trail read RPCs created; asserts passed.';
end $$;
