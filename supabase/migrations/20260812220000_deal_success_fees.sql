-- Spec PR 4 — Client mandate success-fee model (§4.5).
-- ============================================================================
-- Canonical spec: FNC-CANONICAL-LEGAL-DOCUMENTS-ESIGN-ONBOARDING-SPEC-2026-08-12 §4.5.
-- Audit map graded MISSING. Per-mandate (per-deal) success-fee configuration the
-- owner chooses ONE method for: none / percentage / flat_amount, with the §4.5
-- variables (percentage_base, vat_treatment, fee_trigger, payment_due_days,
-- tail_period_months, owner_note). Fills the fee_summary slot the e-sign backend
-- reserved on agreement_variable_snapshots.
--
-- Owner-configured VALUES only — this migration invents NO rate, amount, VAT rate,
-- or tail. The owner enters every commercial value per mandate. The worked example
-- in the summary is arithmetic on an ILLUSTRATIVE base, clearly marked illustrative,
-- and states the VAT TREATMENT without asserting a VAT rate (accountant gate).
--
-- §4.5 locks honoured:
--   * Exactly one method; percentage XOR flat enforced by CHECK (never both on one
--     mandate — a second charge would be a separately-signed addendum, out of scope).
--   * The client sees a plain-language summary + illustrative worked example before
--     signing (success_fee_summary).
--   * After the mandate is sent, the fee + basis are immutable (freeze + trigger);
--     a change means withdrawing/superseding the mandate.
--
-- Security: owner-only RLS on the config table (the client reads the frozen fee via
-- the mandate agreement's variable snapshot, already client-readable); DEFINER RPCs;
-- table DML revoked from API roles. New empty table ⇒ inline constraints lock-free.
-- ============================================================================

-- ===========================================================================
-- 0. Enums.
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname='success_fee_method') then
    create type public.success_fee_method as enum ('none', 'percentage', 'flat_amount');
  end if;
  if not exists (select 1 from pg_type where typname='success_fee_percentage_base') then
    create type public.success_fee_percentage_base as enum ('amount_funded', 'approved_facility');
  end if;
  if not exists (select 1 from pg_type where typname='success_fee_vat_treatment') then
    create type public.success_fee_vat_treatment as enum ('inclusive', 'exclusive', 'not_applicable');
  end if;
end $$;

-- ===========================================================================
-- 1. deal_success_fees — one mandate fee config per deal.
-- ===========================================================================
create table if not exists public.deal_success_fees (
  id                  uuid primary key default gen_random_uuid(),
  deal_id             uuid not null references public.deals(id) on delete cascade,
  fee_method          public.success_fee_method not null,
  percentage_rate     numeric(6,3),                              -- % (percentage method only)
  percentage_base     public.success_fee_percentage_base,        -- amount_funded (default) / approved_facility
  flat_amount_zar     numeric(14,2),                             -- flat_amount method only
  vat_treatment       public.success_fee_vat_treatment,
  fee_trigger         text,                                      -- e.g. 'successful disbursement' (§4.5)
  payment_due_days    integer,                                   -- due period after trigger/invoice
  tail_period_months  integer,                                   -- introduced-funder tail
  owner_note          text,                                      -- optional client-visible explanation
  is_frozen           boolean not null default false,            -- true once the mandate is sent (§4.5 immutable-after-send)
  frozen_at           timestamptz,
  agreement_id        uuid references public.agreement_instances(id),  -- the mandate agreement it froze into
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint deal_success_fees_deal_uniq unique (deal_id),
  -- Method consistency (§4.5): percentage XOR flat; none carries neither.
  constraint deal_success_fees_percentage_shape check (
    fee_method <> 'percentage'
    or (percentage_rate is not null and percentage_base is not null and flat_amount_zar is null)
  ),
  constraint deal_success_fees_flat_shape check (
    fee_method <> 'flat_amount'
    or (flat_amount_zar is not null and percentage_rate is null and percentage_base is null)
  ),
  constraint deal_success_fees_none_shape check (
    fee_method <> 'none'
    or (percentage_rate is null and flat_amount_zar is null and percentage_base is null)
  ),
  constraint deal_success_fees_rate_range check (percentage_rate is null or (percentage_rate > 0 and percentage_rate <= 100)),
  constraint deal_success_fees_flat_nonneg check (flat_amount_zar is null or flat_amount_zar >= 0),
  constraint deal_success_fees_due_nonneg check (payment_due_days is null or payment_due_days >= 0),
  constraint deal_success_fees_tail_nonneg check (tail_period_months is null or tail_period_months >= 0)
);

comment on table public.deal_success_fees is
  'Per-mandate client success-fee config (spec §4.5): one method (none/percentage/flat) + §4.5 variables. Owner-configured values only. Immutable once frozen (mandate sent). Owner-only RLS; client sees the frozen fee via the mandate agreement snapshot.';

create index if not exists idx_deal_success_fees_deal on public.deal_success_fees (deal_id);

drop trigger if exists deal_success_fees_set_updated_at on public.deal_success_fees;
create trigger deal_success_fees_set_updated_at
  before update on public.deal_success_fees
  for each row execute function public.set_updated_at();

alter table public.deal_success_fees enable row level security;
drop policy if exists deal_success_fees_owner_all on public.deal_success_fees;
create policy deal_success_fees_owner_all on public.deal_success_fees
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
revoke all on table public.deal_success_fees from anon, public, authenticated;
grant select on table public.deal_success_fees to authenticated;

-- ===========================================================================
-- 2. Immutability: once frozen (mandate sent), the fee is immutable (§4.5).
--    The freeze transition itself (false→true) is allowed; any later change is
--    rejected — correct via withdrawing/superseding the mandate.
-- ===========================================================================
create or replace function public.enforce_frozen_success_fee_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Immutable against UPDATE only. A DELETE (including ON DELETE CASCADE from the
  -- parent deal) is allowed so the fee is cleaned up with its deal — blocking it
  -- would contradict the deal_id cascade and abort a deal delete.
  if tg_op = 'UPDATE' and old.is_frozen then
    raise exception
      'A sent mandate''s success fee is immutable (deal %). Withdraw/supersede the mandate to change it (§4.5).',
      old.deal_id using errcode = 'restrict_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists enforce_frozen_success_fee_immutable on public.deal_success_fees;
create trigger enforce_frozen_success_fee_immutable
  before update or delete on public.deal_success_fees
  for each row execute function public.enforce_frozen_success_fee_immutable();

-- ===========================================================================
-- 3. set_deal_success_fee — owner upserts a deal's mandate fee (while not frozen).
--    Validates method-specific shape; normalises none (clears rate/amount/base).
-- ===========================================================================
create or replace function public.set_deal_success_fee(
  p_deal_id            uuid,
  p_fee_method         public.success_fee_method,
  p_percentage_rate    numeric  default null,
  p_percentage_base    public.success_fee_percentage_base default null,
  p_flat_amount_zar    numeric  default null,
  p_vat_treatment      public.success_fee_vat_treatment default null,
  p_fee_trigger        text     default null,
  p_payment_due_days   integer  default null,
  p_tail_period_months integer  default null,
  p_owner_note         text     default null
) returns public.deal_success_fees
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_rate numeric := p_percentage_rate;
  v_base public.success_fee_percentage_base := p_percentage_base;
  v_flat numeric := p_flat_amount_zar;
  v_row public.deal_success_fees;
begin
  if not public.is_owner() then raise exception 'Only the owner can set a mandate success fee'; end if;
  if not exists (select 1 from public.deals where id = p_deal_id) then
    raise exception 'Deal % not found', p_deal_id; end if;

  perform pg_advisory_xact_lock(hashtext('deal_success_fee:' || p_deal_id::text));
  if exists (select 1 from public.deal_success_fees where deal_id = p_deal_id and is_frozen) then
    raise exception 'This mandate''s success fee is frozen (sent) and cannot be changed (§4.5)';
  end if;

  -- Normalise by method so the CHECKs hold and stale fields are cleared.
  if p_fee_method = 'percentage' then
    if v_rate is null then raise exception 'A percentage rate is required for the percentage method'; end if;
    v_base := coalesce(v_base, 'amount_funded');   -- §4.5 default
    v_flat := null;
  elsif p_fee_method = 'flat_amount' then
    if v_flat is null then raise exception 'A flat amount is required for the flat_amount method'; end if;
    v_rate := null; v_base := null;
  else  -- none
    v_rate := null; v_base := null; v_flat := null;
  end if;

  insert into public.deal_success_fees
    (deal_id, fee_method, percentage_rate, percentage_base, flat_amount_zar, vat_treatment,
     fee_trigger, payment_due_days, tail_period_months, owner_note, created_by)
  values
    (p_deal_id, p_fee_method, v_rate, v_base, v_flat,
     case when p_fee_method = 'none' then null else p_vat_treatment end,
     case when p_fee_method = 'none' then null else nullif(btrim(coalesce(p_fee_trigger,'')),'') end,
     case when p_fee_method = 'none' then null else p_payment_due_days end,
     case when p_fee_method = 'none' then null else p_tail_period_months end,
     nullif(btrim(coalesce(p_owner_note,'')),''), v_uid)
  on conflict (deal_id) do update
    set fee_method = excluded.fee_method,
        percentage_rate = excluded.percentage_rate,
        percentage_base = excluded.percentage_base,
        flat_amount_zar = excluded.flat_amount_zar,
        vat_treatment = excluded.vat_treatment,
        fee_trigger = excluded.fee_trigger,
        payment_due_days = excluded.payment_due_days,
        tail_period_months = excluded.tail_period_months,
        owner_note = excluded.owner_note,
        updated_at = now()
  returning * into v_row;
  if v_row.id is null then raise exception 'Success fee was not written'; end if;

  insert into public.activity_logs
    (occurred_at, user_id, user_role, event_type, entity_type, entity_id, description, after_values)
  values (now(), v_uid, 'owner', 'UPDATE', 'deal_success_fee', v_row.id,
          'Set mandate success fee (' || v_row.fee_method::text || ') on deal',
          jsonb_build_object('deal_id', v_row.deal_id, 'fee_method', v_row.fee_method,
                             'percentage_rate', v_row.percentage_rate, 'flat_amount_zar', v_row.flat_amount_zar));
  return v_row;
end $$;

comment on function public.set_deal_success_fee(uuid, public.success_fee_method, numeric, public.success_fee_percentage_base, numeric, public.success_fee_vat_treatment, text, integer, integer, text) is
  'Owner-only: upsert a deal''s mandate success fee (§4.5) while not frozen. Normalises by method; percentage default base amount_funded. Activity-logged.';

-- ===========================================================================
-- 4. freeze_deal_success_fee — completeness gate + freeze at mandate send (§4.5).
--    Requires the full §4.5 variable set for a chargeable method, then locks it
--    and (when given) records the mandate agreement it froze into + mirrors the
--    summary onto that agreement's variable snapshot fee_summary.
-- ===========================================================================
create or replace function public.freeze_deal_success_fee(
  p_deal_id uuid,
  p_agreement_id uuid default null
) returns public.deal_success_fees
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_row public.deal_success_fees;
begin
  if not public.is_owner() then raise exception 'Only the owner can freeze a mandate success fee'; end if;
  perform pg_advisory_xact_lock(hashtext('deal_success_fee:' || p_deal_id::text));
  select * into v_row from public.deal_success_fees where deal_id = p_deal_id;
  if v_row.id is null then raise exception 'No success fee configured for deal %', p_deal_id; end if;
  if v_row.is_frozen then
    return v_row;  -- idempotent
  end if;

  -- §4.5 completeness for a chargeable method.
  if v_row.fee_method <> 'none' then
    if v_row.vat_treatment is null then raise exception 'VAT treatment is required before freezing a chargeable fee'; end if;
    if v_row.fee_trigger is null then raise exception 'A fee trigger is required before freezing'; end if;
    if v_row.payment_due_days is null then raise exception 'A payment-due period is required before freezing'; end if;
    if v_row.tail_period_months is null then raise exception 'A tail period is required before freezing'; end if;
  end if;

  update public.deal_success_fees
     set is_frozen = true, frozen_at = now(), agreement_id = coalesce(p_agreement_id, agreement_id)
   where deal_id = p_deal_id and not is_frozen
   returning * into v_row;
  if v_row.id is null then raise exception 'Success fee freeze wrote no row'; end if;

  -- Mirror the frozen summary onto the mandate agreement's variable snapshot, if any.
  if p_agreement_id is not null then
    update public.agreement_variable_snapshots
       set fee_summary = public.success_fee_summary(p_deal_id, 1000000)
     where agreement_id = p_agreement_id;
  end if;

  insert into public.activity_logs
    (occurred_at, user_id, user_role, event_type, entity_type, entity_id, description, after_values)
  values (now(), v_uid, 'owner', 'UPDATE', 'deal_success_fee', v_row.id,
          'Froze mandate success fee on deal',
          jsonb_build_object('deal_id', v_row.deal_id, 'agreement_id', v_row.agreement_id));
  return v_row;
end $$;

comment on function public.freeze_deal_success_fee(uuid, uuid) is
  'Owner-only: validate §4.5 completeness for a chargeable method, freeze the fee (immutable thereafter), and mirror the summary onto the mandate agreement snapshot. Idempotent.';

-- ===========================================================================
-- 5. success_fee_summary — the plain-language client summary + illustrative
--    worked example (§4.5). VAT treatment is stated, never a VAT rate asserted.
--    Authz: owner or the deal's client.
-- ===========================================================================
create or replace function public.success_fee_summary(
  p_deal_id uuid,
  p_illustrative_base numeric default 1000000
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_fee public.deal_success_fees; v_deal_client uuid; v_vat text; v_sentence text;
  v_example jsonb := null; v_fee_amount numeric;
begin
  select client_id into v_deal_client from public.deals where id = p_deal_id;
  if not (public.is_owner() or (v_deal_client is not null and v_deal_client = public.current_client_id())) then
    raise exception 'Not authorised to view this mandate fee';
  end if;

  select * into v_fee from public.deal_success_fees where deal_id = p_deal_id;
  if v_fee.id is null then
    return jsonb_build_object('configured', false, 'plain_language', 'No success fee has been set for this mandate yet.');
  end if;

  v_vat := case v_fee.vat_treatment
             when 'inclusive' then 'VAT inclusive'
             when 'exclusive' then 'VAT exclusive (VAT added at the prevailing rate)'
             when 'not_applicable' then 'VAT not applicable'
             else 'VAT treatment to be confirmed' end;

  if v_fee.fee_method = 'none' then
    v_sentence := 'No success fee applies to this mandate.';
  elsif v_fee.fee_method = 'percentage' then
    v_fee_amount := round(p_illustrative_base * v_fee.percentage_rate / 100.0, 2);
    v_sentence := 'A success fee of ' || trim(to_char(v_fee.percentage_rate, 'FM990.###')) || '% of the '
      || replace(v_fee.percentage_base::text, '_', ' ')
      || ' applies, payable within ' || coalesce(v_fee.payment_due_days::text, '—') || ' days of '
      || coalesce(v_fee.fee_trigger, 'the agreed trigger') || '. ' || v_vat || '. Introduced-funder tail: '
      || coalesce(v_fee.tail_period_months::text, '—') || ' months.';
    v_example := jsonb_build_object(
      'illustrative', true,
      'base', p_illustrative_base, 'base_kind', v_fee.percentage_base,
      'fee', v_fee_amount,
      'note', 'Illustrative only, on a sample ' || replace(v_fee.percentage_base::text,'_',' ')
                || ' of R' || to_char(p_illustrative_base, 'FM999,999,999,990') || '. '
                || case v_fee.vat_treatment
                     when 'exclusive' then 'The figure excludes VAT (VAT added at the prevailing rate).'
                     when 'inclusive' then 'The figure is VAT inclusive.'
                     when 'not_applicable' then 'VAT is not applicable.'
                     else 'VAT treatment to be confirmed.' end);
  else  -- flat_amount
    v_sentence := 'A success fee of R' || to_char(v_fee.flat_amount_zar, 'FM999,999,999,990.00')
      || ' applies, payable within ' || coalesce(v_fee.payment_due_days::text, '—') || ' days of '
      || coalesce(v_fee.fee_trigger, 'the agreed trigger') || '. ' || v_vat || '. Introduced-funder tail: '
      || coalesce(v_fee.tail_period_months::text, '—') || ' months.';
  end if;

  return jsonb_build_object(
    'configured', true,
    'fee_method', v_fee.fee_method,
    'percentage_rate', v_fee.percentage_rate,
    'percentage_base', v_fee.percentage_base,
    'flat_amount_zar', v_fee.flat_amount_zar,
    'vat_treatment', v_fee.vat_treatment,
    'fee_trigger', v_fee.fee_trigger,
    'payment_due_days', v_fee.payment_due_days,
    'tail_period_months', v_fee.tail_period_months,
    'owner_note', v_fee.owner_note,
    'is_frozen', v_fee.is_frozen,
    'plain_language', v_sentence,
    'illustrative_example', v_example
  );
end $$;

comment on function public.success_fee_summary(uuid, numeric) is
  'Plain-language mandate fee summary + illustrative worked example (§4.5). States VAT treatment, never asserts a VAT rate. Owner or the deal''s client may read.';

-- ===========================================================================
-- 6. Grants matrix.
-- ===========================================================================
do $$
declare fn text;
  fns constant text[] := array[
    'set_deal_success_fee(uuid, public.success_fee_method, numeric, public.success_fee_percentage_base, numeric, public.success_fee_vat_treatment, text, integer, integer, text)',
    'freeze_deal_success_fee(uuid, uuid)',
    'success_fee_summary(uuid, numeric)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
    execute format('grant execute on function public.%s to postgres', fn);
  end loop;
end $$;

-- ===========================================================================
-- 7. Structural assertions.
-- ===========================================================================
do $$
declare sig text;
  fns constant text[] := array[
    'public.set_deal_success_fee(uuid,public.success_fee_method,numeric,public.success_fee_percentage_base,numeric,public.success_fee_vat_treatment,text,integer,integer,text)',
    'public.freeze_deal_success_fee(uuid,uuid)',
    'public.success_fee_summary(uuid,numeric)'
  ];
begin
  if to_regclass('public.deal_success_fees') is null then raise exception 'assert: deal_success_fees missing'; end if;
  foreach sig in array array['success_fee_method','success_fee_percentage_base','success_fee_vat_treatment'] loop
    if not exists (select 1 from pg_type where typname=sig) then raise exception 'assert: enum % missing', sig; end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid='public.deal_success_fees'::regclass) then raise exception 'assert: RLS off'; end if;
  if exists (select 1 from information_schema.role_table_grants
      where table_schema='public' and table_name='deal_success_fees' and grantee='anon') then
    raise exception 'assert: must not be granted to anon'; end if;
  if not exists (select 1 from pg_trigger where tgname='enforce_frozen_success_fee_immutable') then raise exception 'assert: frozen-immutability trigger missing'; end if;
  if not exists (select 1 from pg_constraint where conname='deal_success_fees_percentage_shape') then raise exception 'assert: percentage-shape check missing'; end if;
  if not exists (select 1 from pg_constraint where conname='deal_success_fees_flat_shape') then raise exception 'assert: flat-shape check missing'; end if;
  foreach sig in array fns loop
    if to_regprocedure(sig) is null then raise exception 'assert: % missing', sig; end if;
    if not (select prosecdef from pg_proc where oid=sig::regprocedure) then raise exception 'assert: % not DEFINER', sig; end if;
  end loop;
  raise notice 'Spec PR 4 deal_success_fees: structural assertions passed (table, 3 enums, immutability, checks, 3 RPCs).';
end $$;

-- ===========================================================================
-- 8. Behavioural assertions — rolled back. Uses a temporary test deal.
-- ===========================================================================
do $$
declare
  v_owner uuid; v_client uuid; v_deal uuid; v_fee public.deal_success_fees; v_sum jsonb;
begin
  select id into v_owner from public.profiles where role='owner' limit 1;
  if v_owner is null then
    raise notice 'Spec PR 4 deal_success_fees: behavioural assertions skipped (no owner profile).';
    return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    -- Temp client + deal to attach a fee to.
    insert into public.clients (business_name) values ('SF Test Client') returning id into v_client;
    insert into public.deals (client_id, stage) values (v_client, 'qualifying') returning id into v_deal;

    -- Percentage fee (base defaults to amount_funded).
    v_fee := public.set_deal_success_fee(v_deal, 'percentage'::public.success_fee_method,
               2.5, null, null, 'exclusive'::public.success_fee_vat_treatment,
               'successful disbursement', 14, 12, 'Standard brokerage success fee');
    if v_fee.percentage_base <> 'amount_funded' then raise exception 'assert: default base not amount_funded'; end if;

    -- Summary carries the illustrative worked example.
    v_sum := public.success_fee_summary(v_deal, 1000000);
    if (v_sum->'illustrative_example'->>'fee')::numeric <> 25000.00 then
      raise exception 'assert: illustrative fee should be 25000 (got %)', v_sum->'illustrative_example'->>'fee'; end if;

    -- Switching to flat clears the percentage fields (CHECK holds).
    v_fee := public.set_deal_success_fee(v_deal, 'flat_amount'::public.success_fee_method,
               null, null, 50000, 'inclusive'::public.success_fee_vat_treatment,
               'successful disbursement', 7, 6, null);
    if v_fee.percentage_rate is not null then raise exception 'assert: percentage_rate not cleared on flat switch'; end if;

    -- Freeze → immutable.
    perform public.freeze_deal_success_fee(v_deal, null);
    begin
      perform public.set_deal_success_fee(v_deal, 'none'::public.success_fee_method);
      raise exception 'assert: frozen fee was editable';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not ilike '%frozen%' then raise exception 'assert: wrong frozen error: %', sqlerrm; end if;
    end;

    raise notice 'Spec PR 4 deal_success_fees: behavioural assertions passed (percentage default, illustrative example, method switch, freeze immutability).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
