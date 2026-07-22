-- C2.2 — commission_records reshape + write_commission_record RPC + funded-transition trigger
-- ============================================================================
-- Part of Phase C2 (Commission Records Auto-Wire). C2.1 laid the deals.deal_type
-- substrate and the shared fnc_gross_commission() helper; this migration turns the
-- (currently empty) commission_records table into the real commission ledger and
-- wires it to fire automatically when a deal is funded.
--
-- WHAT IT DOES
--   1. New commission_state enum {earned, outstanding, payable, settled, void}.
--   2. Reshapes commission_records (0 rows today — verified live):
--        * drops the one-per-DEAL unique (model is now one commission per funded
--          SUBMISSION — DEAL-001 already has 3 submissions);
--        * tier_pct precision (5,4) -> (10,4) per scope decision G6;
--        * adds deal_funder_submission_id (NOT NULL FK, one non-void per submission),
--          funder_invoice_id (FK, C2.3), partner_invoice_id (column only — no FK yet,
--          partner_invoices is C4), earned/outstanding/payable/settled_at, notes;
--        * migrates the status text column to the commission_state enum IN PLACE,
--          keeping the column NAME `status` (owner decision D2) so the existing
--          frontend read (useDashboard.ts) keeps working with zero cross-lane edits.
--   3. write_commission_record(p_deal_id) — the single writer: gross via the shared
--      fnc_gross_commission() helper (G2), split delegated to the partner-aware
--      commission_records_recompute() trigger (single split site, calls
--      calculate_commission()), advisory-locked + idempotent.
--   4. A funded-transition trigger on deals that calls the RPC when a deal enters
--      'funded'. Idempotent — safe if it fires twice.
--   5. Reconciles the two existing triggers with the new state machine.
--
-- EMPTY-TABLE RATIONALE (mirrors the C2.1 header precedent)
--   commission_records has 0 rows, so inline ALTERs / ADD CONSTRAINT / CREATE INDEX
--   are metadata-only or scan-nothing — instant, no write-blocking lock to avoid.
--   The house NOT VALID / CREATE INDEX CONCURRENTLY / VALIDATE dance exists to keep
--   locks off POPULATED tables; it buys nothing on an empty table (NOT VALID does not
--   even avoid the brief SHARE ROW EXCLUSIVE lock the FK takes on the *referenced*
--   populated tables — that is unavoidable and sub-millisecond here). So we add valid
--   FKs and plain indexes directly, exactly as C2.1 reasoned for its enum column.
--
-- Money numeric(14,2); percentages numeric(10,4). Per standing rules.
-- ============================================================================

-- 0. State enum --------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'commission_state') then
    create type public.commission_state as enum
      ('earned', 'outstanding', 'payable', 'settled', 'void');
  end if;
end $$;

-- 1. Reshape commission_records ----------------------------------------------

-- 1a. Drop one-per-deal uniqueness; the model is one commission per funded submission.
alter table public.commission_records drop constraint if exists commission_records_deal_unique;
-- deal_id keeps its FK (CASCADE) but no longer its unique index — add a plain lookup index.
create index if not exists idx_commission_records_deal
  on public.commission_records (deal_id);

-- 1b. Normalise tier_pct precision (5,4) -> (10,4) per G6.
alter table public.commission_records alter column tier_pct type numeric(10,4);

-- 1c. New columns.
alter table public.commission_records
  add column if not exists deal_funder_submission_id uuid,
  add column if not exists funder_invoice_id          uuid,
  add column if not exists partner_invoice_id         uuid,
  add column if not exists earned_at                  timestamptz,
  add column if not exists outstanding_at             timestamptz,
  add column if not exists payable_at                 timestamptz,
  add column if not exists settled_at                 timestamptz,
  add column if not exists notes                      text;

-- deal_funder_submission_id: the funded submission this commission derives from.
-- Table is empty so NOT NULL is safe immediately. CASCADE mirrors deal_id's CASCADE
-- (if the submission is gone, the commission derived from it goes with it).
alter table public.commission_records
  alter column deal_funder_submission_id set not null;
alter table public.commission_records
  add constraint commission_records_submission_fkey
  foreign key (deal_funder_submission_id)
  references public.deal_funder_submissions (id) on delete cascade;

-- funder_invoice_id: populated when the commission moves to outstanding/payable (C2.3).
-- SET NULL — voiding/deleting an invoice must not delete the commission ledger row.
alter table public.commission_records
  add constraint commission_records_funder_invoice_fkey
  foreign key (funder_invoice_id)
  references public.funder_invoices (id) on delete set null;

-- partner_invoice_id: NO FK yet. public.partner_invoices does not exist (it is C4).
-- The FK is added by the C4 migration that creates that table. The column is reserved
-- now so the settled step (C4) has its target column already present in the ledger.

-- 1d. status text -> commission_state enum, IN PLACE, keeping the column name.
--   Owner decision D2: keep the column named `status` (not renamed to `state`) so the
--   live frontend read `select gross_commission, status, created_at` in
--   src/hooks/useDashboard.ts keeps resolving — zero cross-lane edits, nothing breaks
--   the moment this lands. Only the TYPE changes. Legacy text maps 'paid'->'settled',
--   everything else -> 'earned' (table is empty, so the USING clause is belt-and-braces).
--   MUST run BEFORE the partial-unique index below: an index predicate `status <> 'void'`
--   built while status is still text binds the text operator and then cannot rebuild
--   against the enum. Convert first, then the predicate resolves 'void' as the enum.
alter table public.commission_records alter column status drop default;
alter table public.commission_records
  alter column status type public.commission_state
  using (
    case status
      when 'paid' then 'settled'::public.commission_state
      else 'earned'::public.commission_state
    end
  );
alter table public.commission_records
  alter column status set default 'earned'::public.commission_state;

-- 1e. Indexes that depend on the enum-typed status column.
-- One non-void commission per funded submission — the idempotency arbiter the RPC
-- targets with ON CONFLICT ... WHERE (status <> 'void').
create unique index if not exists commission_records_submission_unique
  on public.commission_records (deal_funder_submission_id)
  where (status <> 'void');

create index if not exists idx_commission_records_funder_invoice
  on public.commission_records (funder_invoice_id);
create index if not exists idx_commission_records_partner_invoice
  on public.commission_records (partner_invoice_id);

comment on column public.commission_records.status is
  'Commission lifecycle state (commission_state enum: earned/outstanding/payable/settled/void). Kept named "status" for frontend compatibility (useDashboard.ts); semantically this is the C2 commission state machine. C2.3 advances it; the C2.3 COMMISSION_PAID re-point fires on -> settled.';
comment on column public.commission_records.deal_funder_submission_id is
  'The funded deal_funder_submission this commission derives from. Exactly one non-void commission per submission (commission_records_submission_unique).';
comment on column public.commission_records.funder_invoice_id is
  'The funder invoice this commission is billed on. Set when the commission moves to outstanding/payable (C2.3). ON DELETE SET NULL.';
comment on column public.commission_records.partner_invoice_id is
  'The partner (Doctor) invoice this commission settles on. Set at settled (C4). FK added by the C4 migration that creates public.partner_invoices.';
comment on column public.commission_records.notes is
  'Free-text provenance/audit notes (e.g. how the rate was resolved when the record was written).';

-- 2. Reconcile commission_records_recompute() — now partner-aware ------------
--   Still the single site that fills the split columns from calculate_commission()
--   (single source of split math, G2), so a stray direct INSERT can never violate
--   commission_records_sums_ck. New: when the deal has no referral partner (G4), the
--   owner keeps 100% of the pool — partner_share = 0, tier_pct = 0, owner_share = pool.
--   The 40% company_retention still stands (it is FNC-internal); owner_share + retention
--   both accrue to the owner, so "owner keeps 100%" holds and the sums check is exact.
create or replace function public.commission_records_recompute()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare
  b public.commission_breakdown;
begin
  b := public.calculate_commission(new.gross_commission, new.is_purchase_order);
  new.tier_pct          := b.tier_pct;
  new.company_retention := b.company_retention;
  new.partner_pool      := b.partner_pool;

  if new.referral_partner_id is null then
    -- G4: no partner -> owner keeps the whole pool; nothing is owed to a partner.
    new.tier_pct      := 0;
    new.partner_share := 0;
    new.owner_share   := b.partner_pool;
  else
    new.partner_share := b.partner_share;
    new.owner_share   := b.owner_share;
  end if;

  new.computed_at := now();
  return new;
end;
$function$;

-- notify_commission_paid() reconciliation — NO code change.
--   It already fires only when payment_received_date transitions to non-null, and
--   write_commission_record never sets that column, so it is inert on an 'earned'
--   insert (exactly what we want in C2.2). C2.3 (decision G5) re-points COMMISSION_PAID
--   to fire on the status -> 'settled' transition; until then this stays as-is and
--   dormant. payment_received_date is intentionally retained (not dropped) so this
--   trigger keeps compiling until C2.3 rewrites it.

-- 3. write_commission_record(p_deal_id) — the single commission writer --------
--   SECURITY DEFINER + search_path='' + is_owner() guard + granted to authenticated
--   only (belt-and-braces: a definer function bypasses RLS, so the owner check is the
--   real gate). Advisory-locked per deal + idempotent via the partial-unique arbiter.
--   Gross comes ONLY from the shared fnc_gross_commission() helper (G2); the split is
--   left to the partner-aware recompute trigger (single split site).
create or replace function public.write_commission_record(p_deal_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_deal        public.deals;
  v_sub         public.deal_funder_submissions;
  v_rate        public.funder_commission_structures;
  v_deal_type   public.deal_type;
  v_as_of       date;
  v_rate_type   public.funder_rate_type;
  v_rate_frac   numeric;
  v_flat        numeric;
  v_fin_charge  numeric;
  v_gross       numeric(14,2);
  v_source      text;
  v_id          uuid;
  v_existing_id uuid;
  v_created     uuid[] := '{}';
  v_existing    uuid[] := '{}';
begin
  if not public.is_owner() then
    raise exception 'Only the owner can write commission records';
  end if;

  perform pg_advisory_xact_lock(hashtext('write_commission_record:' || p_deal_id::text));

  select * into v_deal from public.deals where id = p_deal_id;
  if v_deal.id is null then
    raise exception 'Deal % not found', p_deal_id;
  end if;

  -- deals.deal_type is the source of truth (C2.1); belt-and-braces fallback to the
  -- legacy is_purchase_order derivation only if a row somehow has a null deal_type.
  v_deal_type := coalesce(
    v_deal.deal_type,
    case when v_deal.is_purchase_order then 'po'::public.deal_type else 'non_po'::public.deal_type end);

  -- Iterate every FUNDED submission on the deal. amount_funded IS NOT NULL is the S7A
  -- "Actual" trigger (money actually landed). Typically one today; the loop is future-
  -- proof for co-funded deals (multiple funders on one deal).
  for v_sub in
    select * from public.deal_funder_submissions
     where deal_id = p_deal_id and amount_funded is not null
     order by funded_at nulls last, created_at
  loop
    -- Idempotency: skip a submission that already has a non-void commission.
    select id into v_existing_id from public.commission_records
      where deal_funder_submission_id = v_sub.id and status <> 'void' limit 1;
    if v_existing_id is not null then
      v_existing := v_existing || v_existing_id;
      continue;
    end if;

    -- Rate resolution (S7A: approval pins the rate). Prefer the submission's
    -- applied_rate_snapshot; else look up funder_rate_at() as-of the approval date.
    if v_sub.applied_rate_snapshot is not null then
      v_rate_type := (v_sub.applied_rate_snapshot->>'rate_type')::public.funder_rate_type;
      v_rate_frac := (v_sub.applied_rate_snapshot->>'rate_fraction')::numeric;
      v_flat      := (v_sub.applied_rate_snapshot->>'flat_amount')::numeric;
      v_source    := 'applied_rate_snapshot';
    else
      v_as_of := coalesce(v_sub.approved_at::date, v_sub.funded_at::date, public.current_sast_date());
      v_rate  := public.funder_rate_at(v_sub.funder_id, v_deal_type, v_as_of);
      if v_rate.id is null then
        raise exception
          'No commission rate structure for funder % as of % — capture it in Settings first',
          v_sub.funder_id, v_as_of;
      end if;
      v_rate_type := v_rate.rate_type;
      v_rate_frac := v_rate.rate_fraction;
      v_flat      := v_rate.flat_amount;
      v_source    := 'funder_rate_at(' || v_as_of || ')';
    end if;

    v_fin_charge := v_sub.finance_charge_amount;

    -- Single source of gross (G2) — the exact helper generate_funder_invoice uses.
    v_gross := public.fnc_gross_commission(v_rate_type, v_rate_frac, v_flat, v_sub.amount_funded, v_fin_charge);

    -- Insert as 'earned'. The BEFORE recompute trigger fills the split columns from
    -- calculate_commission() (single split site) and applies the no-partner rule (G4).
    -- We supply only gross + is_po + partner + state + earned_at + notes.
    insert into public.commission_records (
      deal_id, deal_funder_submission_id, referral_partner_id,
      gross_commission, is_purchase_order, status, earned_at, notes
    ) values (
      p_deal_id, v_sub.id, v_deal.referral_partner_id,
      v_gross, (v_deal_type = 'po'::public.deal_type), 'earned'::public.commission_state, now(),
      'Auto-written on deal funded; gross via ' || v_source || '.'
    )
    on conflict (deal_funder_submission_id) where (status <> 'void') do nothing
    returning id into v_id;

    if v_id is not null then
      v_created := v_created || v_id;
    else
      -- Lost the race (concurrent writer won the arbiter) — report the surviving row.
      select id into v_existing_id from public.commission_records
        where deal_funder_submission_id = v_sub.id and status <> 'void' limit 1;
      if v_existing_id is not null then
        v_existing := v_existing || v_existing_id;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'commission_records_created',  to_jsonb(v_created),
    'commission_records_existing', to_jsonb(v_existing),
    'was_created', coalesce(array_length(v_created, 1), 0) > 0
  );
end;
$function$;

comment on function public.write_commission_record(uuid) is
  'C2.2 — the single commission-ledger writer. For every funded submission on the deal, computes FNC gross via fnc_gross_commission() (G2) and inserts an earned commission_record (split filled by the partner-aware recompute trigger). Advisory-locked per deal, idempotent (one non-void commission per submission). Owner-only. Returns {commission_records_created, commission_records_existing, was_created}.';

-- Belt-and-braces grants: authenticated only (the is_owner() body guard does the rest).
revoke all on function public.write_commission_record(uuid) from public;
grant execute on function public.write_commission_record(uuid) to authenticated;

-- 4. Funded-transition trigger on deals --------------------------------------
--   AFTER UPDATE OF stage (and INSERT, for a deal created straight into 'funded'):
--   when the deal enters 'funded', write its commission ledger. SECURITY DEFINER to
--   match the sibling notify_deal_funded pattern; the RPC's own is_owner() guard still
--   applies (only owners can move deals, per RLS, so the guard passes on the real path).
--   Idempotent: a second firing writes nothing new.
create or replace function public.deals_write_commission_on_funded()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.stage = 'funded'
     and (tg_op = 'INSERT' or old.stage is distinct from new.stage) then
    perform public.write_commission_record(new.id);
  end if;
  return null;
end;
$function$;

drop trigger if exists deals_write_commission_on_funded on public.deals;
create trigger deals_write_commission_on_funded
  after insert or update of stage on public.deals
  for each row execute function public.deals_write_commission_on_funded();

-- 5. Assertions --------------------------------------------------------------
--   Structural checks need no data. Behavioural checks build synthetic rows with
--   EXPLICIT references (never nextval — so the deals reference sequence is not burned,
--   which NEW CC 2's sequence audit cares about) and are unwound by a deliberate
--   ROLLBACK_TEST_DATA exception, so nothing persists.
do $$
declare
  v_col_type text; v_scale int;
  v_enum text;
  v_prosecdef boolean; v_proconfig text[]; v_args text; v_ret text;
  v_grants text;
  v_pred boolean;
  -- behavioural
  v_client uuid; v_partner uuid; v_funder uuid; v_funder2 uuid; v_owner uuid;
  v_deal uuid; v_deal2 uuid; v_deal3 uuid;
  v_sub1 uuid; v_sub2 uuid; v_sub3 uuid; v_sub4 uuid;
  v_rec public.commission_records;
  v_res1 jsonb; v_res2 jsonb;
  v_cnt int; v_g numeric; v_ps numeric;
begin
  -- (a) enum values exactly {earned, outstanding, payable, settled, void}
  select string_agg(enumlabel, ',' order by enumsortorder) into v_enum
    from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'commission_state';
  if v_enum <> 'earned,outstanding,payable,settled,void' then
    raise exception 'assert failed: commission_state values = %', v_enum;
  end if;

  -- (b) status column is now the commission_state enum
  select udt_name into v_col_type from information_schema.columns
    where table_schema='public' and table_name='commission_records' and column_name='status';
  if v_col_type <> 'commission_state' then
    raise exception 'assert failed: commission_records.status type = % (expected commission_state)', v_col_type;
  end if;

  -- (c) tier_pct precision normalised to (10,4)
  select numeric_scale into v_scale from information_schema.columns
    where table_schema='public' and table_name='commission_records' and column_name='tier_pct';
  if v_scale <> 4 then
    raise exception 'assert failed: tier_pct scale = % (expected 4)', v_scale;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='commission_records'
      and column_name='tier_pct' and numeric_precision=10) then
    raise exception 'assert failed: tier_pct precision is not 10';
  end if;

  -- (d) new columns exist
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='commission_records'
      and column_name='deal_funder_submission_id') then
    raise exception 'assert failed: deal_funder_submission_id missing';
  end if;

  -- (e) one-per-deal unique dropped; one-per-submission partial unique present
  if exists (select 1 from pg_constraint where conname='commission_records_deal_unique') then
    raise exception 'assert failed: commission_records_deal_unique still present';
  end if;
  select indpred is not null into v_pred
    from pg_index i join pg_class c on c.oid=i.indexrelid
    where c.relname='commission_records_submission_unique';
  if v_pred is not true then
    raise exception 'assert failed: commission_records_submission_unique missing or not partial';
  end if;

  -- (f) write_commission_record: definer, search_path='', signature, return type, grants
  select p.prosecdef, p.proconfig,
         pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid)
    into v_prosecdef, v_proconfig, v_args, v_ret
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='write_commission_record';
  if v_prosecdef is not true then raise exception 'assert failed: write_commission_record not SECURITY DEFINER'; end if;
  if not (v_proconfig @> array['search_path='] ) then raise exception 'assert failed: search_path not empty on write_commission_record'; end if;
  if v_args <> 'p_deal_id uuid' then raise exception 'assert failed: write_commission_record args = %', v_args; end if;
  if v_ret <> 'jsonb' then raise exception 'assert failed: write_commission_record returns % (expected jsonb)', v_ret; end if;
  select string_agg(grantee||':'||privilege_type, ',') into v_grants
    from information_schema.routine_privileges
    where routine_schema='public' and routine_name='write_commission_record';
  if v_grants ilike '%PUBLIC%' or v_grants ilike '%anon%' then
    raise exception 'assert failed: write_commission_record granted too widely (%).', v_grants;
  end if;
  if v_grants not ilike '%authenticated:EXECUTE%' then
    raise exception 'assert failed: write_commission_record not granted to authenticated (%).', v_grants;
  end if;

  -- (g) single-source wiring: RPC calls fnc_gross_commission; split site calls calculate_commission
  if pg_get_functiondef('public.write_commission_record(uuid)'::regprocedure) not ilike '%fnc_gross_commission%' then
    raise exception 'assert failed: write_commission_record does not call fnc_gross_commission';
  end if;
  if pg_get_functiondef('public.commission_records_recompute()'::regprocedure) not ilike '%calculate_commission%' then
    raise exception 'assert failed: recompute does not call calculate_commission';
  end if;
  if pg_get_functiondef('public.commission_records_recompute()'::regprocedure) not ilike '%referral_partner_id%' then
    raise exception 'assert failed: recompute is not partner-aware (G4)';
  end if;

  -- (h) funded trigger is on deals, AFTER, for stage
  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.deals'::regclass and tgname='deals_write_commission_on_funded' and not tgisinternal) then
    raise exception 'assert failed: deals_write_commission_on_funded trigger missing';
  end if;

  -- (i) RLS policy matrix unchanged and correct (owner full, partner read own)
  if not exists (select 1 from pg_policy where polrelid='public.commission_records'::regclass
      and polname='commission_records_owner_all') then
    raise exception 'assert failed: owner RLS policy missing';
  end if;
  if not exists (select 1 from pg_policy where polrelid='public.commission_records'::regclass
      and polname='commission_records_partner_read_own') then
    raise exception 'assert failed: partner read-own RLS policy missing';
  end if;

  -- ---- Behavioural (synthetic, explicit refs, unwound by ROLLBACK_TEST_DATA) ----
  begin
    select id into v_client  from public.clients            limit 1;
    select id into v_partner from public.referral_partners  limit 1;
    select id into v_funder  from public.funders            limit 1;
    -- a SECOND funder: deal_funder_submissions is unique on (deal_id, funder_id), so the
    -- two submissions on the one synthetic deal must go to different funders.
    select id into v_funder2 from public.funders where id <> v_funder limit 1;
    select id into v_owner   from public.profiles where role='owner' limit 1;

    if v_client is null or v_funder is null or v_funder2 is null then
      raise notice 'C2.2: fewer than 2 funders / no client present — behavioural assertions skipped.';
      raise exception 'ROLLBACK_TEST_DATA';
    end if;

    -- (1) recompute split via direct insert — partner present -> 30%% tier on R100k non-PO
    insert into public.deals (client_id, reference, stage, is_purchase_order)
      values (v_client, 'C2_2_TEST_ROLLBACK', 'document_collection', false)
      returning id into v_deal;
    insert into public.deal_funder_submissions (deal_id, funder_id, status, amount_funded)
      values (v_deal, v_funder, 'funded', 1000000) returning id into v_sub1;
    insert into public.deal_funder_submissions (deal_id, funder_id, status, amount_funded)
      values (v_deal, v_funder2, 'funded', 1000000) returning id into v_sub2;

    insert into public.commission_records
      (deal_id, deal_funder_submission_id, referral_partner_id, gross_commission, is_purchase_order, status, earned_at)
      values (v_deal, v_sub1, v_partner, 100000, false, 'earned', now())
      returning * into v_rec;
    if v_rec.company_retention <> 40000.00 then raise exception 'assert: retention % (exp 40000)', v_rec.company_retention; end if;
    if v_rec.partner_pool      <> 60000.00 then raise exception 'assert: pool % (exp 60000)', v_rec.partner_pool; end if;
    if v_rec.tier_pct          <> 0.3000   then raise exception 'assert: tier_pct % (exp 0.3000)', v_rec.tier_pct; end if;
    if v_rec.partner_share     <> 18000.00 then raise exception 'assert: partner_share % (exp 18000)', v_rec.partner_share; end if;
    if v_rec.owner_share       <> 42000.00 then raise exception 'assert: owner_share % (exp 42000)', v_rec.owner_share; end if;

    -- (2) G4: no partner -> partner_share 0, tier 0, owner keeps the pool, sums exact
    insert into public.commission_records
      (deal_id, deal_funder_submission_id, referral_partner_id, gross_commission, is_purchase_order, status, earned_at)
      values (v_deal, v_sub2, null, 100000, false, 'earned', now())
      returning * into v_rec;
    if v_rec.partner_share <> 0 then raise exception 'assert G4: no-partner partner_share % (exp 0)', v_rec.partner_share; end if;
    if v_rec.tier_pct      <> 0 then raise exception 'assert G4: no-partner tier_pct % (exp 0)', v_rec.tier_pct; end if;
    if v_rec.owner_share   <> 60000.00 then raise exception 'assert G4: no-partner owner_share % (exp 60000)', v_rec.owner_share; end if;
    if (v_rec.company_retention + v_rec.partner_share + v_rec.owner_share) <> v_rec.gross_commission then
      raise exception 'assert: sums check violated for no-partner row';
    end if;

    -- (3) RPC idempotency + gross-via-helper + funded trigger (needs owner context)
    if v_owner is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

      insert into public.deals (client_id, reference, stage, is_purchase_order, referral_partner_id)
        values (v_client, 'C2_2_RPC_ROLLBACK', 'document_collection', false, v_partner)
        returning id into v_deal2;
      insert into public.deal_funder_submissions (deal_id, funder_id, status, amount_funded, applied_rate_snapshot)
        values (v_deal2, v_funder, 'funded', 1000000,
                jsonb_build_object('rate_type','percent_of_gross_funded','rate_fraction',0.10,'flat_amount',null,'source','test'))
        returning id into v_sub3;

      v_res1 := public.write_commission_record(v_deal2);
      v_res2 := public.write_commission_record(v_deal2);
      if (v_res1->>'was_created')::boolean is not true  then raise exception 'assert: 1st RPC call did not create'; end if;
      if (v_res2->>'was_created')::boolean is not false then raise exception 'assert: 2nd RPC call created a duplicate'; end if;
      select count(*) into v_cnt from public.commission_records where deal_funder_submission_id=v_sub3 and status<>'void';
      if v_cnt <> 1 then raise exception 'assert: expected 1 commission for submission, got %', v_cnt; end if;
      select gross_commission, partner_share into v_g, v_ps
        from public.commission_records where deal_funder_submission_id=v_sub3 and status<>'void';
      if v_g  <> 100000.00 then raise exception 'assert: RPC gross % (exp 100000 = 0.10 x 1,000,000)', v_g; end if;
      if v_ps <> 18000.00  then raise exception 'assert: RPC partner_share % (exp 18000)', v_ps; end if;

      -- funded trigger fires only on the -> funded transition
      insert into public.deals (client_id, reference, stage, is_purchase_order, referral_partner_id)
        values (v_client, 'C2_2_TRG_ROLLBACK', 'document_collection', false, v_partner)
        returning id into v_deal3;
      insert into public.deal_funder_submissions (deal_id, funder_id, status, amount_funded, applied_rate_snapshot)
        values (v_deal3, v_funder, 'funded', 500000,
                jsonb_build_object('rate_type','percent_of_gross_funded','rate_fraction',0.10,'flat_amount',null,'source','test'))
        returning id into v_sub4;
      update public.deals set stage='deal_review' where id=v_deal3;   -- non-funded change
      select count(*) into v_cnt from public.commission_records where deal_id=v_deal3;
      if v_cnt <> 0 then raise exception 'assert: trigger fired on a non-funded stage change'; end if;
      update public.deals set stage='funded' where id=v_deal3;        -- funded transition
      select count(*) into v_cnt from public.commission_records where deal_id=v_deal3 and status<>'void';
      if v_cnt <> 1 then raise exception 'assert: funded trigger did not write commission (got %)', v_cnt; end if;
    end if;

    raise notice 'C2.2 behavioural assertions passed (recompute split + G4 no-partner + RPC idempotency + funded trigger).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;

  raise notice 'C2.2 assertions passed: reshape + state enum + partner-aware recompute + write_commission_record + funded trigger.';
end $$;
