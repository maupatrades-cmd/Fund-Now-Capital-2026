-- =============================================================================
-- Build 15 — End-to-end money lifecycle smoke-test harness
-- Fund Now Capital CRM  ·  Supabase project hvxruwkgmhjoypepffgv
-- =============================================================================
--
-- WHAT THIS IS
--   A single, self-contained, TRANSACTIONAL harness that drives and asserts the
--   entire money lifecycle end-to-end using ONLY the production RPCs and the
--   production trigger cascades:
--
--     deal funded ─► write_commission_record()            (earned)
--       ─► generate_funder_invoice()                       (draft funder invoice)
--       ─► issue_funder_invoice()   ─► cascade             (earned  -> outstanding)
--       ─► mark_funder_invoice_paid()─► cascade            (outstanding -> payable)
--       ─► contractor_generate_invoice()                   (draft contractor invoice)
--       ─► contractor_submit_invoice()                     (submitted)
--       ─► owner_approve_contractor_invoice()              (approved)
--       ─► owner_mark_contractor_invoice_paid()─► settle   (payable -> settled, invoice paid)
--
--   It also asserts DUPLICATE PREVENTION (a second funder invoice / second
--   contractor invoice for the same payable is a no-op) and IDEMPOTENCY
--   (re-calling mark-paid returns changed:false).
--
-- ‼️  RUN ON A SUPABASE PREVIEW BRANCH OR A LOCAL STACK — NEVER ON PROD.
--     It SEEDS fixture rows (client, deal, funder, submission, invoices,
--     commission records, and a synthetic contractor profile) and then ROLLS
--     BACK. Nothing is committed. It must be run by a privileged role
--     (postgres / service_role) because it toggles session_replication_role and
--     uses ALTER TABLE ... ENABLE REPLICA TRIGGER (both transactional & rolled
--     back). Adds NO schema migration — this is a committed TEST ARTIFACT only.
--
-- HOW TO RUN
--     supabase db execute --file supabase/tests/money_lifecycle_smoke.sql   # against a preview/local db
--   or:
--     psql "$PREVIEW_DB_URL" -f supabase/tests/money_lifecycle_smoke.sql
--   Success prints:  NOTICE:  Build 15 money smoke: ALL PASSED
--   Any failed assertion aborts with a RAISE EXCEPTION naming the failing step.
--
-- WHY session_replication_role = replica  (+ selective re-arm)
--   Setting replica quiets the pure side-effect AFTER-triggers (notify_deal_funded,
--   notify_commission_paid, award_commission_badges) and — because pg_net email/PDF
--   dispatch is fired DIRECTLY from the RPC bodies (emit_in_app_notification,
--   invoke_generate_invoice_pdf) and is already guarded by absent vault secrets on
--   a preview branch — keeps the harness free of external HTTP side effects. BUT
--   replica also disables the business-critical cascade triggers on funder_invoices
--   (which are the very thing under test) AND disables FK enforcement. We therefore
--   re-ARM exactly the money-cascade triggers below with ENABLE REPLICA TRIGGER so
--   the real cascade path is genuinely exercised, while the disabled FK checks let
--   us seed a synthetic contractor profile without minting an auth.users row.
--
-- VERIFICATION STATUS
--   Every RPC signature, column, NOT-NULL, enum label, trigger, unique index and
--   FK referenced here was read live from project hvxruwkgmhjoypepffgv on
--   2026-08-10 via read-only catalog queries (pg_get_functiondef,
--   information_schema.columns, pg_trigger, pg_constraint, pg_indexes). The script
--   is verified STRUCTURALLY. It has NOT been executed (no write access to prod);
--   it must be run once on a preview branch to shake out any environment quirks
--   (e.g. role privileges for session_replication_role / ENABLE REPLICA TRIGGER).
--
-- RPCs DRIVEN (exact signatures):
--   public.write_commission_record(p_deal_id uuid) -> jsonb
--   public.generate_funder_invoice(p_submission_id uuid, p_finance_charge numeric,
--                                  p_contract_ref text, p_notes text) -> jsonb
--   public.issue_funder_invoice(p_invoice_id uuid) -> jsonb
--   public.mark_funder_invoice_paid(p_invoice_id uuid, p_paid_amount numeric,
--                                   p_payment_reference text) -> jsonb
--   public.contractor_generate_invoice(p_period_start date, p_period_end date) -> jsonb
--   public.contractor_submit_invoice(p_invoice_id uuid) -> jsonb
--   public.owner_approve_contractor_invoice(p_invoice_id uuid) -> jsonb
--   public.owner_mark_contractor_invoice_paid(p_invoice_id uuid, p_paid_reference text,
--                                             p_paid_proof_path text) -> jsonb
-- =============================================================================

BEGIN;

-- --- Global transaction settings -------------------------------------------------
-- Quiet the pg_net / notification AFTER-triggers (see header). Requires a
-- privileged role; this is transaction-local and reverts on ROLLBACK.
SET LOCAL session_replication_role = replica;

-- Re-arm ONLY the money-cascade + state-guard triggers on funder_invoices so the
-- lifecycle under test still fires while replica keeps the noisy notify triggers
-- off. ALTER TABLE is transactional in Postgres, so ROLLBACK restores everything.
ALTER TABLE public.funder_invoices ENABLE REPLICA TRIGGER commission_cascade_on_invoice_state;
ALTER TABLE public.funder_invoices ENABLE REPLICA TRIGGER contractor_commission_cascade_on_invoice_state;
ALTER TABLE public.funder_invoices ENABLE REPLICA TRIGGER funder_invoices_state_guard;

DO $do$
DECLARE
  -- Actors
  v_owner       uuid;
  v_contractor  uuid := gen_random_uuid();   -- synthetic contractor (seeded below)

  -- Fixtures
  v_client      uuid;
  v_funder      uuid;
  v_deal        uuid;
  v_submission  uuid;

  -- Amounts
  c_amount_funded  numeric := 1000000;        -- R1,000,000 advanced
  c_finance_charge numeric := 50000;          -- R50,000 finance charge (unused for % of gross)
  c_rate_fraction  numeric := 0.03;           -- 3% of gross funded -> R30,000 commission
  c_expected_comm  numeric := 30000;          -- 0.03 * 1,000,000
  c_contractor_cut numeric := 5000;           -- contractor tier share

  -- Commission record ids
  v_pool_comm   uuid;   -- partner-pool commission (deal_funder_submission_id set)
  v_tier_comm   uuid;   -- contractor tier commission (deal_funder_submission_id null)

  -- Invoice ids
  v_funder_inv  uuid;
  v_contr_inv   uuid;

  -- Scratch
  v_res         jsonb;
  v_status      public.commission_state;
  v_state       text;
  v_today       date := (select public.current_sast_date());
  v_period_start date := (select public.current_sast_date()) - 1;
  v_period_end   date := (select public.current_sast_date()) + 1;
BEGIN
  -- ===========================================================================
  -- 0. ACTORS
  --    Owner is looked up from profiles (real owner). If the target branch has
  --    no owner profile at all we self-seed one (FK to auth.users is disabled by
  --    replica). The contractor is ALWAYS synthetic so the harness is
  --    self-contained and deterministic.
  -- ===========================================================================
  select id into v_owner from public.profiles where role = 'owner' order by created_at limit 1;
  if v_owner is null then
    v_owner := gen_random_uuid();
    insert into public.profiles (id, role, is_active, email)
    values (v_owner, 'owner', true, 'smoke+owner@fnc.invalid');
  end if;

  insert into public.profiles (id, role, is_active, email)
  values (v_contractor, 'contractor', true, 'smoke+contractor@fnc.invalid');

  -- Helper convention: switch the impersonated caller via request.jwt.claims.
  -- auth.uid() (used by is_owner()/assert_active_contractor()) reads sub from here.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- ===========================================================================
  -- 1. FIXTURES + FUNDED DEAL -> commission_records (earned)
  -- ===========================================================================
  insert into public.funders (name, display_name_for_partner, short_code, is_active)
  values ('SMOKE Funder', 'A Funder', 'SMK', true)
  returning id into v_funder;

  insert into public.clients (business_name, short_code)
  values ('SMOKE Client (Pty) Ltd', 'SMKCLI')
  returning id into v_client;

  -- Deal starts pre-funding, then advances to 'funded'. The C2 funded trigger
  -- (deals_write_commission_on_funded) is replica-disabled, so — exactly as the
  -- build brief permits — we call write_commission_record() explicitly.
  insert into public.deals (reference, client_id, stage, deal_type, is_purchase_order, amount_requested)
  values ('SMOKE-DEAL-' || substr(gen_random_uuid()::text, 1, 8),
          v_client, 'advance_pending', 'non_po', false, c_amount_funded)
  returning id into v_deal;

  -- A funded submission carrying an applied_rate_snapshot so no funder rate
  -- structure needs to exist on the branch (both write_commission_record and
  -- generate_funder_invoice prefer the snapshot).
  insert into public.deal_funder_submissions
    (deal_id, funder_id, status, amount_funded, finance_charge_amount,
     approved_at, funded_at, applied_rate_snapshot)
  values
    (v_deal, v_funder, 'funded', c_amount_funded, c_finance_charge,
     now(), now(),
     jsonb_build_object(
       'rate_type', 'percent_of_gross_funded',
       'rate_fraction', c_rate_fraction,
       'flat_amount', null,
       'deal_type', 'non_po',
       'contract_reference', 'SMOKE-LPA-001',
       'payment_terms_days', 0,
       'source', 'build15_smoke'))
  returning id into v_submission;

  update public.deals set stage = 'funded' where id = v_deal;

  v_res := public.write_commission_record(v_deal);
  if not coalesce((v_res->>'was_created')::boolean, false) then
    raise exception 'ASSERT FAILED [1]: write_commission_record did not create a record (%).', v_res;
  end if;

  select id, status into v_pool_comm, v_status
    from public.commission_records
   where deal_funder_submission_id = v_submission and status <> 'void';
  if v_pool_comm is null then
    raise exception 'ASSERT FAILED [1]: no partner-pool commission_record for submission %.', v_submission;
  end if;
  if v_status <> 'earned' then
    raise exception 'ASSERT FAILED [1]: partner-pool commission is % (expected earned).', v_status;
  end if;

  -- Seed the contractor tier commission row (deal-level, no submission). In prod
  -- this is written by the tier attribution engine; here we insert it directly so
  -- the funder-invoice cascade has a contractor row to carry to payable. The
  -- commission_records_recompute BEFORE-trigger is a no-op for tier rows
  -- (deal_funder_submission_id is null), so contractor_share stands as set.
  insert into public.commission_records
    (deal_id, deal_funder_submission_id, contractor_id, attribution_type,
     gross_commission, contractor_share, is_purchase_order, status, earned_at, notes)
  values
    (v_deal, null, v_contractor, 'FNC_Contractor',
     c_expected_comm, c_contractor_cut, false, 'earned', now(),
     'Build15 smoke: synthetic contractor tier row')
  returning id into v_tier_comm;

  -- ===========================================================================
  -- 2. FUNDER INVOICE: generate -> issue -> paid, asserting the commission
  --    cascade earned -> outstanding -> payable (via the real triggers).
  -- ===========================================================================
  v_res := public.generate_funder_invoice(v_submission, c_finance_charge, 'SMOKE-LPA-001', 'build15 smoke');
  if not coalesce((v_res->>'was_created')::boolean, false) then
    raise exception 'ASSERT FAILED [2]: generate_funder_invoice was_created not true (%).', v_res;
  end if;
  v_funder_inv := (v_res->>'invoice_id')::uuid;
  if (v_res->>'commission_amount')::numeric <> c_expected_comm then
    raise exception 'ASSERT FAILED [2]: commission_amount % (expected %).',
      v_res->>'commission_amount', c_expected_comm;
  end if;

  -- Issue -> cascade both commission rows earned -> outstanding.
  v_res := public.issue_funder_invoice(v_funder_inv);
  if not coalesce((v_res->>'changed')::boolean, false) then
    raise exception 'ASSERT FAILED [2]: issue_funder_invoice changed not true (%).', v_res;
  end if;

  select status into v_status from public.commission_records where id = v_pool_comm;
  if v_status <> 'outstanding' then
    raise exception 'ASSERT FAILED [2]: partner-pool commission is % after issue (expected outstanding).', v_status;
  end if;
  select status into v_status from public.commission_records where id = v_tier_comm;
  if v_status <> 'outstanding' then
    raise exception 'ASSERT FAILED [2]: contractor tier commission is % after issue (expected outstanding).', v_status;
  end if;

  -- Mark paid -> cascade both commission rows outstanding -> payable.
  v_res := public.mark_funder_invoice_paid(v_funder_inv, c_expected_comm, 'SMOKE-PAY-REF-001');
  if not coalesce((v_res->>'changed')::boolean, false) then
    raise exception 'ASSERT FAILED [2]: mark_funder_invoice_paid changed not true (%).', v_res;
  end if;

  select status into v_status from public.commission_records where id = v_pool_comm;
  if v_status <> 'payable' then
    raise exception 'ASSERT FAILED [2]: partner-pool commission is % after paid (expected payable).', v_status;
  end if;
  select status into v_status from public.commission_records where id = v_tier_comm;
  if v_status <> 'payable' then
    raise exception 'ASSERT FAILED [2]: contractor tier commission is % after paid (expected payable).', v_status;
  end if;

  -- ---- 2b. DUPLICATE PREVENTION + IDEMPOTENCY on the funder side -------------
  -- Second funder invoice for the same submission must be a no-op.
  v_res := public.generate_funder_invoice(v_submission, c_finance_charge, 'SMOKE-LPA-001', 'dup attempt');
  if coalesce((v_res->>'was_created')::boolean, true) then
    raise exception 'ASSERT FAILED [2b]: duplicate funder invoice was created (%).', v_res;
  end if;
  if (v_res->>'invoice_id')::uuid <> v_funder_inv then
    raise exception 'ASSERT FAILED [2b]: duplicate returned a different invoice id (%).', v_res;
  end if;

  -- Re-marking an already-paid invoice must be idempotent (changed:false).
  v_res := public.mark_funder_invoice_paid(v_funder_inv, c_expected_comm, 'SMOKE-PAY-REF-001');
  if coalesce((v_res->>'changed')::boolean, true) then
    raise exception 'ASSERT FAILED [2b]: re-marking paid was not idempotent (%).', v_res;
  end if;

  -- ===========================================================================
  -- 3. CONTRACTOR INVOICE: generate -> submit (as contractor) -> approve ->
  --    mark paid (as owner). Assert the tier commission becomes 'settled' and
  --    the contractor invoice becomes 'paid'.
  -- ===========================================================================
  -- Switch to the contractor for generate + submit.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_contractor, 'role', 'authenticated')::text, true);

  v_res := public.contractor_generate_invoice(v_period_start, v_period_end);
  if not coalesce((v_res->>'was_created')::boolean, false) then
    raise exception 'ASSERT FAILED [3]: contractor_generate_invoice was_created not true (%).', v_res;
  end if;
  v_contr_inv := (v_res->>'invoice_id')::uuid;
  if coalesce((v_res->>'count')::int, 0) < 1 then
    raise exception 'ASSERT FAILED [3]: contractor invoice has no line items (%).', v_res;
  end if;

  v_res := public.contractor_submit_invoice(v_contr_inv);
  if (v_res->>'state') <> 'submitted' then
    raise exception 'ASSERT FAILED [3]: contractor invoice state % after submit (expected submitted).', v_res->>'state';
  end if;

  -- Switch back to the owner for approve + pay.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  v_res := public.owner_approve_contractor_invoice(v_contr_inv);
  if (v_res->>'state') <> 'approved' then
    raise exception 'ASSERT FAILED [3]: contractor invoice state % after approve (expected approved).', v_res->>'state';
  end if;

  v_res := public.owner_mark_contractor_invoice_paid(v_contr_inv, 'SMOKE-CI-EFT-001', null);
  if not coalesce((v_res->>'changed')::boolean, false) then
    raise exception 'ASSERT FAILED [3]: owner_mark_contractor_invoice_paid changed not true (%).', v_res;
  end if;
  if coalesce((v_res->>'commissions_settled')::int, 0) < 1 then
    raise exception 'ASSERT FAILED [3]: no commissions settled by contractor invoice (%).', v_res;
  end if;

  select status into v_status from public.commission_records where id = v_tier_comm;
  if v_status <> 'settled' then
    raise exception 'ASSERT FAILED [3]: contractor tier commission is % after invoice paid (expected settled).', v_status;
  end if;

  select state::text into v_state from public.contractor_invoices where id = v_contr_inv;
  if v_state <> 'paid' then
    raise exception 'ASSERT FAILED [3]: contractor invoice is % (expected paid).', v_state;
  end if;

  -- Confirm the settled tier row is now linked to the contractor invoice.
  if not exists (select 1 from public.commission_records
                  where id = v_tier_comm and contractor_invoice_id = v_contr_inv) then
    raise exception 'ASSERT FAILED [3]: settled tier commission not linked to contractor invoice %.', v_contr_inv;
  end if;

  -- ===========================================================================
  -- 4. DUPLICATE PREVENTION + IDEMPOTENCY on the contractor side
  -- ===========================================================================
  -- Re-marking the paid contractor invoice must be idempotent (changed:false).
  v_res := public.owner_mark_contractor_invoice_paid(v_contr_inv, 'SMOKE-CI-EFT-001', null);
  if coalesce((v_res->>'changed')::boolean, true) then
    raise exception 'ASSERT FAILED [4]: re-marking contractor invoice paid was not idempotent (%).', v_res;
  end if;

  -- A second contractor invoice for the same (now settled + already invoiced)
  -- payable must find nothing eligible -> was_created:false.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_contractor, 'role', 'authenticated')::text, true);
  v_res := public.contractor_generate_invoice(v_period_start, v_period_end);
  if coalesce((v_res->>'was_created')::boolean, true) then
    raise exception 'ASSERT FAILED [4]: a duplicate contractor invoice was created (%).', v_res;
  end if;

  -- ===========================================================================
  -- ALL ASSERTIONS PASSED
  -- ===========================================================================
  raise notice 'Build 15 money smoke: ALL PASSED';
END
$do$;

-- Nothing is committed. Everything above (fixtures, invoices, commission state,
-- the synthetic contractor profile, and the ENABLE REPLICA TRIGGER toggles) is
-- discarded here.
ROLLBACK;
