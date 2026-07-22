-- C1.2 (backend slice) — two small RPCs the Invoicing UI needs.
-- Reference: SPEC S7 (Invoicing) + owner-approved C1.2 scope (2026-07-22).
--
-- C1.1 shipped every generation/lifecycle RPC; C1.2 is a pure-frontend build
-- EXCEPT for these two:
--   1. update_draft_invoice — lets the owner edit a DRAFT invoice's narrative
--      (commission_description) + notes before issuing. Draft-only; the state
--      guard trigger already blocks state changes, this adds the edit path.
--   2. void_funder_invoice — extended with an optional p_reason that is appended
--      to notes with a timestamped SAST marker (the void modal captures it).
--
-- Both follow the C1.1 money-RPC pattern exactly: SECURITY DEFINER, search_path
-- pinned to '', is_owner() gate, advisory xact lock on the same key namespace,
-- RETURNING + no-row-written check (silent-RLS rule), idempotent short-circuit,
-- grants matrix {authenticated} only (no public/anon). Structural DO-block
-- assertions at the end roll the migration back on any drift.

-- ===========================================================================
-- 1. update_draft_invoice(invoice_id, description, notes)
--    Edit a DRAFT invoice's narrative + notes only. Everything money-bearing
--    (commission, totals, rate snapshot, payment reference) stays immutable —
--    those come from generation and never change post-draft.
--    Idempotent: a no-op edit (same values) short-circuits with changed=false
--    and writes no activity row.
-- ===========================================================================
create or replace function public.update_draft_invoice(
  p_invoice_id uuid,
  p_description text,
  p_notes text
) returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_inv      public.funder_invoices;
  v_new_desc text;
begin
  if not public.is_owner() then raise exception 'Only the owner can edit invoices'; end if;
  perform pg_advisory_xact_lock(hashtext('funder_invoice_state:' || p_invoice_id::text));

  select * into v_inv from public.funder_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'Invoice % not found', p_invoice_id; end if;
  if v_inv.state <> 'draft' then
    raise exception 'Only a draft invoice can be edited (invoice % is %)', v_inv.invoice_number, v_inv.state;
  end if;

  -- commission_description is NOT NULL — never blank it out; an empty/whitespace
  -- input keeps the existing narrative. notes is nullable and set as given.
  v_new_desc := coalesce(nullif(btrim(p_description), ''), v_inv.commission_description);

  -- No-op short-circuit → idempotent (same call twice = same result, no dup log).
  if v_inv.commission_description is not distinct from v_new_desc
     and v_inv.notes is not distinct from p_notes then
    return jsonb_build_object('invoice_id', v_inv.id, 'state', v_inv.state, 'changed', false);
  end if;

  update public.funder_invoices
     set commission_description = v_new_desc,
         notes                  = p_notes,
         updated_by             = auth.uid()
   where id = p_invoice_id and state = 'draft'
   returning * into v_inv;
  if v_inv.id is null then raise exception 'Invoice % was not updated (no row written)', p_invoice_id; end if;

  perform public.log_invoice_activity('INVOICE', v_inv.id, v_inv.deal_id,
    'Invoice ' || v_inv.invoice_number || ' draft details edited');

  return jsonb_build_object('invoice_id', v_inv.id, 'state', v_inv.state, 'changed', true);
end $function$;

-- ===========================================================================
-- 2. void_funder_invoice(invoice_id, override, reason) — add optional reason.
--    The 2-arg signature is dropped and replaced with a 3-arg one so there is a
--    single canonical function (no overload ambiguity). Behaviour is identical
--    to C1.1 plus: a non-blank reason is appended to notes as
--    "[VOID YYYY-MM-DD HH:MM SAST] {reason}". Idempotent void short-circuit is
--    preserved (already-void → no second append).
-- ===========================================================================
drop function if exists public.void_funder_invoice(uuid, text);

create or replace function public.void_funder_invoice(
  p_invoice_id uuid,
  p_override text default null,
  p_reason text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_inv    public.funder_invoices;
  v_marker text;
begin
  if not public.is_owner() then raise exception 'Only the owner can void invoices'; end if;
  perform pg_advisory_xact_lock(hashtext('funder_invoice_state:' || p_invoice_id::text));

  select * into v_inv from public.funder_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'Invoice % not found', p_invoice_id; end if;
  if v_inv.state = 'void' then
    return jsonb_build_object('invoice_id', v_inv.id, 'state', 'void', 'changed', false);
  end if;
  if v_inv.state = 'paid' then
    raise exception 'A paid invoice cannot be voided (invoice %)', v_inv.invoice_number;
  end if;
  if v_inv.state in ('issued', 'overdue') and coalesce(p_override, '') <> 'OVERRIDE' then
    raise exception 'Voiding an issued invoice requires typing OVERRIDE to confirm (invoice %)', v_inv.invoice_number;
  end if;

  -- Timestamped SAST marker; null when no reason given (notes left untouched).
  v_marker := case
    when coalesce(btrim(p_reason), '') = '' then null
    else '[VOID ' || to_char((now() at time zone 'Africa/Johannesburg'), 'YYYY-MM-DD HH24:MI') ||
         ' SAST] ' || btrim(p_reason)
  end;

  update public.funder_invoices
     set state = 'void',
         notes = case
           when v_marker is null then notes
           when notes is null or btrim(notes) = '' then v_marker
           else notes || E'\n' || v_marker
         end,
         updated_by = auth.uid()
   where id = p_invoice_id and state <> 'void'
   returning * into v_inv;
  if v_inv.id is null then raise exception 'Invoice % was not voided (no row written)', p_invoice_id; end if;

  perform public.log_invoice_activity('INVOICE', v_inv.id, v_inv.deal_id,
    'Invoice ' || v_inv.invoice_number || ' voided' ||
    case when v_marker is null then '' else ' — reason recorded' end);
  return jsonb_build_object('invoice_id', v_inv.id, 'state', 'void', 'changed', true);
end $function$;

-- ---------------------------------------------------------------------------
-- Grants matrix — {authenticated} only (is_owner() gates inside; no public/anon).
-- ---------------------------------------------------------------------------
revoke all on function public.update_draft_invoice(uuid, text, text) from public, anon;
grant execute on function public.update_draft_invoice(uuid, text, text) to authenticated;
revoke all on function public.void_funder_invoice(uuid, text, text) from public, anon;
grant execute on function public.void_funder_invoice(uuid, text, text) to authenticated;

-- ===========================================================================
-- 3. Structural assertions (RAISE → roll the migration back). No production
--    rows are touched — the full edit/void behaviour is the owner's post-merge
--    smoke test with a real draft invoice.
-- ===========================================================================
do $$
begin
  -- (a) both functions are SECURITY DEFINER with search_path pinned to ''.
  if not (select prosecdef from pg_proc where oid='public.update_draft_invoice(uuid,text,text)'::regprocedure) then
    raise exception 'C1.2 assert FAIL: update_draft_invoice not SECURITY DEFINER'; end if;
  if not (select prosecdef from pg_proc where oid='public.void_funder_invoice(uuid,text,text)'::regprocedure) then
    raise exception 'C1.2 assert FAIL: void_funder_invoice not SECURITY DEFINER'; end if;
  -- proconfig stores this as search_path="" (quoted), so match on the prefix.
  if not exists (select 1 from pg_proc,
                   lateral unnest(coalesce(proconfig, array[]::text[])) c
                 where oid='public.update_draft_invoice(uuid,text,text)'::regprocedure
                   and c like 'search_path=%') then
    raise exception 'C1.2 assert FAIL: update_draft_invoice search_path not pinned'; end if;
  if not exists (select 1 from pg_proc,
                   lateral unnest(coalesce(proconfig, array[]::text[])) c
                 where oid='public.void_funder_invoice(uuid,text,text)'::regprocedure
                   and c like 'search_path=%') then
    raise exception 'C1.2 assert FAIL: void_funder_invoice search_path not pinned'; end if;

  -- (b) grants matrix — authenticated yes, anon/public no.
  if not has_function_privilege('authenticated','public.update_draft_invoice(uuid,text,text)','execute') then
    raise exception 'C1.2 assert FAIL: authenticated cannot execute update_draft_invoice'; end if;
  if has_function_privilege('anon','public.update_draft_invoice(uuid,text,text)','execute') then
    raise exception 'C1.2 assert FAIL: anon can execute update_draft_invoice'; end if;
  if not has_function_privilege('authenticated','public.void_funder_invoice(uuid,text,text)','execute') then
    raise exception 'C1.2 assert FAIL: authenticated cannot execute void_funder_invoice(3-arg)'; end if;
  if has_function_privilege('anon','public.void_funder_invoice(uuid,text,text)','execute') then
    raise exception 'C1.2 assert FAIL: anon can execute void_funder_invoice(3-arg)'; end if;

  -- (c) the old 2-arg void signature is gone (single canonical function).
  --     to_regprocedure returns NULL (not an error) for a missing signature.
  if to_regprocedure('public.void_funder_invoice(uuid,text)') is not null then
    raise exception 'C1.2 assert FAIL: legacy 2-arg void_funder_invoice still present';
  end if;

  -- (d) signatures are exactly as specified (uuid,text,text on both).
  if pg_get_function_identity_arguments('public.update_draft_invoice(uuid,text,text)'::regprocedure)
     <> 'p_invoice_id uuid, p_description text, p_notes text' then
    raise exception 'C1.2 assert FAIL: update_draft_invoice signature drift (%)',
      pg_get_function_identity_arguments('public.update_draft_invoice(uuid,text,text)'::regprocedure);
  end if;
  if pg_get_function_identity_arguments('public.void_funder_invoice(uuid,text,text)'::regprocedure)
     <> 'p_invoice_id uuid, p_override text, p_reason text' then
    raise exception 'C1.2 assert FAIL: void_funder_invoice signature drift (%)',
      pg_get_function_identity_arguments('public.void_funder_invoice(uuid,text,text)'::regprocedure);
  end if;

  raise notice 'C1.2 structural assertions passed (definer, search_path, grants matrix, single-canonical void, signatures)';
end $$;

notify pgrst, 'reload schema';
