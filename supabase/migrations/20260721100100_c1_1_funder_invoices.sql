-- C1.1 (part 2 of 2) — FNC → funder invoicing (schema + generation RPC + lifecycle).
-- Reference: SPEC S7 (Invoicing) + S7A + owner-approved C1.1 scope (2026-07-21).
--
-- Backend only (no UI — that is C1.2). Builds on the C0.3 substrate
-- (funders.short_code/is_contracted, funder_commission_structures.payment_terms_days/
-- contract_reference, deal_funder_submissions.finance_charge_amount, the
-- percent_of_finance_charge rate_type). The generate RPC is self-sufficient today
-- (computes the rate via funder_rate_at at generation, snapshots it onto the
-- invoice) and forward-compatible once C2 writes applied_rate_snapshot.
--
-- Money-state transitions are idempotent + advisory-lock-protected at the DB layer
-- (standing rule, 2026-07-20). The full generation/idempotency/lifecycle test is
-- the owner's post-merge smoke test with fresh data (Decision F/G); the in-migration
-- assertions here are structural (they don't burn the invoice sequence).

-- ===========================================================================
-- 1. funders — billing columns for the PDF "INVOICE TO" block (owner-populated;
--    the PDF renders null-safe). Nullable metadata adds on the populated table.
-- ===========================================================================
alter table public.funders
  add column if not exists legal_name           text,
  add column if not exists billing_address      text,
  add column if not exists company_registration text,
  add column if not exists vat_registration     text,
  add column if not exists accounts_email        text;

comment on column public.funders.legal_name is
  'Funder legal entity name for the invoice INVOICE-TO block (e.g. "Pollen Finance (Pty) Ltd"). Owner-set; falls back to name if null.';

-- ===========================================================================
-- 2. clients — short_code (payment-reference segment). Auto-suggested at
--    creation, owner-overridable. Case-insensitive partial uniqueness (mirrors
--    funders.short_code, PR #70) so payment references stay unambiguous.
-- ===========================================================================
alter table public.clients add column if not exists short_code text;

comment on column public.clients.short_code is
  'Uppercase short code used in the invoice payment reference (…-CHICKANOS). Auto-suggested from business_name at creation (first alphanumeric word, ≤12 chars), owner-overridable. Case-insensitive unique.';

create unique index if not exists clients_short_code_unique
  on public.clients (upper(short_code)) where short_code is not null;

-- Pure helper: uppercase first alphanumeric word of a business name, ≤12 chars.
create or replace function public.suggest_client_short_code(p_business_name text)
returns text language sql immutable set search_path = '' as $$
  select upper(substring((regexp_match(coalesce(p_business_name, ''), '[A-Za-z0-9]+'))[1] from 1 for 12));
$$;

-- ===========================================================================
-- 3. invoice_state enum (new type — usable in this same transaction).
-- ===========================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'invoice_state') then
    create type public.invoice_state as enum ('draft', 'issued', 'paid', 'overdue', 'void');
  end if;
end $$;

-- ===========================================================================
-- 4. Sequence — first CRM invoice is INV-0032 (31 legacy manual invoices exist
--    outside the CRM; forward-only cut-off). START WITH 32.
-- ===========================================================================
create sequence if not exists public.funder_invoices_seq as bigint start with 32 minvalue 1;

-- ===========================================================================
-- 5. funder_invoices — new empty table, so inline FKs are safe (the NOT VALID /
--    CONCURRENTLY dance is only for FK COLUMNS added to populated tables).
-- ===========================================================================
create table if not exists public.funder_invoices (
  id                          uuid primary key default gen_random_uuid(),
  invoice_number              text not null unique,                                   -- INV-NNNN
  deal_id                     uuid not null references public.deals(id) on delete restrict,
  deal_funder_submission_id   uuid not null references public.deal_funder_submissions(id) on delete restrict,
  funder_id                   uuid not null references public.funders(id) on delete restrict,
  client_reference            text not null,                                          -- client business_name at issue (immutable)
  facility_advanced           numeric(14,2) not null,                                 -- = amount_funded
  finance_charge_amount       numeric(14,2),                                          -- only for percent_of_finance_charge
  commission_amount           numeric(14,2) not null,
  vat_amount                  numeric(14,2),                                          -- null: FNC not VAT-registered
  total_amount                numeric(14,2) not null,
  rate_snapshot               jsonb not null,                                         -- immutable rate applied at generation
  commission_description      text not null,                                          -- on-PDF narrative
  contract_reference          text,
  payment_reference_expected  text not null,                                          -- {FUNDER}-INV{NNNN}-{CLIENT}
  issued_date                 date not null default public.current_sast_date(),
  payment_terms               text not null default 'Due on receipt',
  due_date                    date not null,
  state                       public.invoice_state not null default 'draft',
  paid_at                     timestamptz,
  paid_amount                 numeric(14,2),
  payment_reference_received  text,
  pdf_storage_path            text,
  notes                       text,                                                   -- owner-internal; never on the PDF
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  created_by                  uuid default auth.uid() references public.profiles(id),
  updated_by                  uuid references public.profiles(id),
  constraint funder_invoices_amounts_nonneg
    check (facility_advanced >= 0 and commission_amount >= 0 and total_amount >= 0
           and (finance_charge_amount is null or finance_charge_amount >= 0)
           and (paid_amount is null or paid_amount >= 0))
);

comment on table public.funder_invoices is
  'FNC → funder commission invoices (Lead Provider Commission). Owner-only. C1.1 / SPEC S7. State: draft→issued→paid|overdue|void.';

-- One non-void invoice per submission (idempotency backstop for generate_funder_invoice).
create unique index if not exists funder_invoices_one_active_uq
  on public.funder_invoices (deal_funder_submission_id) where (state <> 'void');
create index if not exists funder_invoices_deal_idx    on public.funder_invoices (deal_id);
create index if not exists funder_invoices_funder_idx  on public.funder_invoices (funder_id);
create index if not exists funder_invoices_state_idx   on public.funder_invoices (state);

drop trigger if exists set_updated_at on public.funder_invoices;
create trigger set_updated_at before update on public.funder_invoices
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 6. State-transition guard (Postgres CHECK can't compare OLD/NEW → trigger).
--    draft→{issued,void} · issued→{paid,overdue,void} · overdue→{paid,void}.
--    paid/void terminal. The typed-OVERRIDE for issued→void is enforced in the
--    void RPC; this trigger enforces the graph.
-- ===========================================================================
create or replace function public.funder_invoices_state_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not (
    (old.state = 'draft'   and new.state in ('issued', 'void')) or
    (old.state = 'issued'  and new.state in ('paid', 'overdue', 'void')) or
    (old.state = 'overdue' and new.state in ('paid', 'void'))
  ) then
    raise exception 'Invalid invoice state transition % → % (invoice %)', old.state, new.state, old.invoice_number;
  end if;
  return new;
end $$;

drop trigger if exists funder_invoices_state_guard on public.funder_invoices;
create trigger funder_invoices_state_guard before update on public.funder_invoices
  for each row when (old.state is distinct from new.state)
  execute function public.funder_invoices_state_guard();

-- ===========================================================================
-- 7. Short-code helpers (payment reference). Funder short from funders.short_code
--    (fallback: name-derived); client short from clients.short_code (fallback:
--    the auto-suggestion). SECURITY DEFINER so they read past owner-only RLS from
--    inside the generate RPC; they expose short codes only, never funder identity.
-- ===========================================================================
create or replace function public.funder_shortcode(p_funder_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(f.short_code, public.suggest_client_short_code(f.name))
  from public.funders f where f.id = p_funder_id;
$$;

create or replace function public.client_shortcode(p_client_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(c.short_code, public.suggest_client_short_code(c.business_name))
  from public.clients c where c.id = p_client_id;
$$;

-- ===========================================================================
-- 8. pg_net invoker for the PDF Edge Function (mirrors invoke_send_notification_email).
--    Internal only — EXECUTE revoked from every API role.
-- ===========================================================================
create or replace function public.invoke_generate_invoice_pdf(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_base_url text;
  v_secret   text;
begin
  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'edge_base_url';
  select decrypted_secret into v_secret   from vault.decrypted_secrets where name = 'webhook_secret';
  if v_base_url is null or v_secret is null then
    return;
  end if;
  begin
    perform net.http_post(
      url     := v_base_url || '/functions/v1/generate-invoice-pdf',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', v_secret),
      body    := jsonb_build_object('invoice_id', p_invoice_id)
    );
  exception when others then
    raise warning 'invoke_generate_invoice_pdf failed for %: %', p_invoice_id, sqlerrm;
  end;
end $$;

-- Private activity-log writer for invoice events (funder_invoices has no A10
-- trigger; log explicitly with the INVOICE / PAYMENT event types, deal-linked).
create or replace function public.log_invoice_activity(
  p_event public.activity_event_type, p_invoice_id uuid, p_deal_id uuid, p_desc text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_email text; v_role text;
begin
  if v_uid is not null then
    select p.email, p.role into v_email, v_role from public.profiles p where p.id = v_uid;
  end if;
  insert into public.activity_logs
    (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id, description, related_entity_ids)
  values (now(), v_uid, v_email, v_role, p_event, 'funder_invoice', p_invoice_id, p_desc,
          jsonb_build_array(p_deal_id));
end $$;

-- ===========================================================================
-- 9. generate_funder_invoice — idempotent, advisory-lock-protected creation of a
--    DRAFT invoice from a FUNDED submission. Cites the money-state standing rule.
-- ===========================================================================
create or replace function public.generate_funder_invoice(
  p_submission_id uuid,
  p_finance_charge numeric default null,
  p_contract_ref   text    default null,
  p_notes          text    default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  v_desc       text;
  v_contract   text;
  v_rate_disp  text;
  v_basis      text;
  v_id         uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can generate funder invoices';
  end if;

  -- Money-state transition: idempotent + lock-protected at the DB layer
  -- (standing rule 2026-07-20). Serialize per submission.
  perform pg_advisory_xact_lock(hashtext('funder_invoice:' || p_submission_id::text));

  select * into v_sub from public.deal_funder_submissions where id = p_submission_id;
  if v_sub.id is null then
    raise exception 'Submission % not found', p_submission_id;
  end if;

  -- Idempotency: one non-void invoice per submission. Return the existing one
  -- WITHOUT consuming a sequence number (invoice numbers must never gap).
  select * into v_existing from public.funder_invoices
   where deal_funder_submission_id = p_submission_id and state <> 'void' limit 1;
  if v_existing.id is not null then
    return jsonb_build_object(
      'invoice_id', v_existing.id, 'invoice_number', v_existing.invoice_number,
      'commission_amount', v_existing.commission_amount, 'total_amount', v_existing.total_amount,
      'payment_reference_expected', v_existing.payment_reference_expected, 'was_created', false);
  end if;

  -- Funding must have happened (S7A "Actual" state).
  if v_sub.amount_funded is null then
    raise exception 'Cannot invoice: submission % has no amount_funded (the deal must be funded first)', p_submission_id;
  end if;

  select * into v_deal   from public.deals   where id = v_sub.deal_id;
  select * into v_client from public.clients where id = v_deal.client_id;
  select * into v_funder from public.funders where id = v_sub.funder_id;

  v_deal_type := case when v_deal.is_purchase_order then 'po'::public.deal_type else 'non_po'::public.deal_type end;

  -- Rate: prefer the approval-time snapshot (written by C2) if present; else
  -- compute now via the approval-pinned lookup and snapshot it (Confirm 1).
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

  if v_rate_type = 'percent_of_gross_funded' then
    v_commission := round(v_rate_frac * v_sub.amount_funded, 2);
    v_rate_disp  := trim(to_char(v_rate_frac * 100, 'FM999990.####')) || '%';
    v_basis      := 'funded amount';
  elsif v_rate_type = 'percent_of_finance_charge' then
    if v_fin_charge is null then
      raise exception 'This funder charges commission on the finance charge — capture the finance charge amount first';
    end if;
    v_commission := round(v_rate_frac * v_fin_charge, 2);
    v_rate_disp  := trim(to_char(v_rate_frac * 100, 'FM999990.####')) || '%';
    v_basis      := 'finance charge on the facility';
  elsif v_rate_type = 'flat_rand_per_deal' then
    v_commission := round(v_flat, 2);
    v_rate_disp  := 'R' || trim(to_char(v_flat, 'FM999G999G990D00'));
    v_basis      := 'deal (flat fee)';
  elsif v_rate_type = 'percent_of_mdr' then
    raise exception 'percent_of_mdr commission is not supported yet (deferred to the first MCA deal)';
  else
    raise exception 'Unknown rate_type %', v_rate_type;
  end if;

  -- Consume a number only now that we are certainly creating one (no gaps).
  v_number     := 'INV-' || lpad(nextval('public.funder_invoices_seq')::text, 4, '0');

  if v_terms_days = 0 then
    v_terms_text := 'Due on receipt';
    v_due        := public.current_sast_date();
  else
    v_terms_text := v_terms_days || ' days from invoice date';
    v_due        := public.current_sast_date() + v_terms_days;
  end if;

  -- Payment reference: {FUNDER-SHORT}-INV{NNNN}-{CLIENT-SHORT}.
  v_ref := public.funder_shortcode(v_sub.funder_id) || '-INV' ||
           split_part(v_number, '-', 2) || '-' || public.client_shortcode(v_deal.client_id);

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
    -- Lost a concurrent race — return the winner.
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
end $$;

-- ===========================================================================
-- 10. Lifecycle transitions — each idempotent + lock-protected + row-count-checked.
-- ===========================================================================

-- draft → issued: fire the PDF, notify the owner, advance the deal Funded → Invoiced.
create or replace function public.issue_funder_invoice(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inv public.funder_invoices; v_funder_name text;
begin
  if not public.is_owner() then raise exception 'Only the owner can issue invoices'; end if;
  perform pg_advisory_xact_lock(hashtext('funder_invoice_state:' || p_invoice_id::text));

  select * into v_inv from public.funder_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'Invoice % not found', p_invoice_id; end if;
  if v_inv.state = 'issued' then
    return jsonb_build_object('invoice_id', v_inv.id, 'state', 'issued', 'changed', false);
  end if;
  if v_inv.state <> 'draft' then
    raise exception 'Only a draft invoice can be issued (invoice % is %)', v_inv.invoice_number, v_inv.state;
  end if;

  update public.funder_invoices set state = 'issued', updated_by = auth.uid()
   where id = p_invoice_id and state = 'draft' returning * into v_inv;
  if v_inv.id is null then raise exception 'Invoice % was not issued (no row written)', p_invoice_id; end if;

  -- Advance the deal Funded → Invoiced (Confirm 2). Only from funded.
  update public.deals set stage = 'invoiced' where id = v_inv.deal_id and stage = 'funded';

  select name into v_funder_name from public.funders where id = v_inv.funder_id;

  perform public.emit_in_app_notification(
    public.notify_owner(), 'FUNDER_INVOICE_ISSUED', 'Invoice issued',
    'Invoice ' || v_inv.invoice_number || ' to ' || coalesce(v_funder_name, 'funder') || ' for ' ||
    v_inv.client_reference || ' — R' || trim(to_char(v_inv.total_amount, 'FM999G999G990D00')) ||
    ' issued, due ' || to_char(v_inv.due_date, 'DD Mon YYYY') || '.',
    '/invoices', jsonb_build_object('invoice_id', v_inv.id, 'deal_id', v_inv.deal_id));

  perform public.log_invoice_activity('INVOICE', v_inv.id, v_inv.deal_id,
    'Invoice ' || v_inv.invoice_number || ' issued to ' || coalesce(v_funder_name, 'funder'));

  -- Generate + store the branded PDF (async via pg_net).
  perform public.invoke_generate_invoice_pdf(v_inv.id);

  return jsonb_build_object('invoice_id', v_inv.id, 'invoice_number', v_inv.invoice_number,
                            'state', 'issued', 'changed', true);
end $$;

-- issued|overdue → paid.
create or replace function public.mark_funder_invoice_paid(
  p_invoice_id uuid, p_paid_amount numeric default null, p_payment_reference text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inv public.funder_invoices; v_funder_name text; v_amount numeric(14,2);
begin
  if not public.is_owner() then raise exception 'Only the owner can mark invoices paid'; end if;
  perform pg_advisory_xact_lock(hashtext('funder_invoice_state:' || p_invoice_id::text));

  select * into v_inv from public.funder_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'Invoice % not found', p_invoice_id; end if;
  if v_inv.state = 'paid' then
    return jsonb_build_object('invoice_id', v_inv.id, 'state', 'paid', 'changed', false);
  end if;
  if v_inv.state not in ('issued', 'overdue') then
    raise exception 'Only an issued/overdue invoice can be marked paid (invoice % is %)', v_inv.invoice_number, v_inv.state;
  end if;

  v_amount := coalesce(p_paid_amount, v_inv.total_amount);
  update public.funder_invoices
     set state = 'paid', paid_at = now(), paid_amount = v_amount,
         payment_reference_received = p_payment_reference, updated_by = auth.uid()
   where id = p_invoice_id and state in ('issued', 'overdue') returning * into v_inv;
  if v_inv.id is null then raise exception 'Invoice % was not marked paid (no row written)', p_invoice_id; end if;

  select name into v_funder_name from public.funders where id = v_inv.funder_id;
  perform public.emit_in_app_notification(
    public.notify_owner(), 'INVOICE_MARKED_PAID', 'Invoice paid',
    'Invoice ' || v_inv.invoice_number || ' from ' || coalesce(v_funder_name, 'funder') ||
    ' marked paid — R' || trim(to_char(v_amount, 'FM999G999G990D00')) || ' received.',
    '/invoices', jsonb_build_object('invoice_id', v_inv.id, 'deal_id', v_inv.deal_id));
  perform public.log_invoice_activity('PAYMENT', v_inv.id, v_inv.deal_id,
    'Invoice ' || v_inv.invoice_number || ' paid — R' || trim(to_char(v_amount, 'FM999G999G990D00')) || ' received');

  return jsonb_build_object('invoice_id', v_inv.id, 'state', 'paid', 'changed', true);
end $$;

-- draft → void (free) · issued → void (requires typed OVERRIDE). overdue → void allowed with OVERRIDE too.
create or replace function public.void_funder_invoice(p_invoice_id uuid, p_override text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inv public.funder_invoices;
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
  -- Voiding an already-issued invoice needs an explicit typed confirmation.
  if v_inv.state in ('issued', 'overdue') and coalesce(p_override, '') <> 'OVERRIDE' then
    raise exception 'Voiding an issued invoice requires typing OVERRIDE to confirm (invoice %)', v_inv.invoice_number;
  end if;

  update public.funder_invoices set state = 'void', updated_by = auth.uid()
   where id = p_invoice_id and state <> 'void' returning * into v_inv;
  if v_inv.id is null then raise exception 'Invoice % was not voided (no row written)', p_invoice_id; end if;

  perform public.log_invoice_activity('INVOICE', v_inv.id, v_inv.deal_id,
    'Invoice ' || v_inv.invoice_number || ' voided');
  return jsonb_build_object('invoice_id', v_inv.id, 'state', 'void', 'changed', true);
end $$;

-- ===========================================================================
-- 11. Overdue sweep (pg_cron 04:30 UTC / 06:30 SAST — after the follow-up sweep).
--     Skips "Due on receipt" (no due-date concept). Idempotent (issued → overdue).
-- ===========================================================================
create or replace function public.check_overdue_invoices()
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select fi.id, fi.invoice_number, fi.deal_id, fi.client_reference, fi.due_date, f.name as funder_name
      from public.funder_invoices fi
      join public.funders f on f.id = fi.funder_id
     where fi.state = 'issued'
       and fi.payment_terms <> 'Due on receipt'
       and fi.due_date < public.current_sast_date()
  loop
    update public.funder_invoices set state = 'overdue' where id = r.id and state = 'issued';
    perform public.emit_in_app_notification(
      public.notify_owner(), 'INVOICE_OVERDUE', 'Invoice overdue',
      'Invoice ' || r.invoice_number || ' to ' || coalesce(r.funder_name, 'funder') || ' (' ||
      r.client_reference || ') is overdue — was due ' || to_char(r.due_date, 'DD Mon YYYY') || '.',
      '/invoices', jsonb_build_object('invoice_id', r.id, 'deal_id', r.deal_id));
    perform public.log_invoice_activity('INVOICE', r.id, r.deal_id,
      'Invoice ' || r.invoice_number || ' marked overdue');
  end loop;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'invoice-overdue-sweep';
select cron.schedule('invoice-overdue-sweep', '30 4 * * *', $cron$ select public.check_overdue_invoices(); $cron$);

-- ===========================================================================
-- 12. RLS — owner full CRUD; partner NO visibility (FNC→funder invoices are
--     FNC-internal commercial data). Mutations go through the RPCs above.
-- ===========================================================================
alter table public.funder_invoices enable row level security;
drop policy if exists funder_invoices_owner_all on public.funder_invoices;
create policy funder_invoices_owner_all on public.funder_invoices
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- ===========================================================================
-- 13. Storage bucket 'invoices' (private) + owner-only RLS mirror.
-- ===========================================================================
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false)
  on conflict (id) do nothing;

drop policy if exists invoices_owner_all on storage.objects;
create policy invoices_owner_all on storage.objects
  for all to authenticated
  using (bucket_id = 'invoices' and public.is_owner())
  with check (bucket_id = 'invoices' and public.is_owner());

-- ===========================================================================
-- 14. Grants matrix — {authenticated} only on the owner-callable RPCs (belt-and-
--     braces; is_owner() gates inside). Internal helpers revoked from API roles.
-- ===========================================================================
revoke all on function public.generate_funder_invoice(uuid, numeric, text, text) from public, anon;
grant execute on function public.generate_funder_invoice(uuid, numeric, text, text) to authenticated;
revoke all on function public.issue_funder_invoice(uuid) from public, anon;
grant execute on function public.issue_funder_invoice(uuid) to authenticated;
revoke all on function public.mark_funder_invoice_paid(uuid, numeric, text) from public, anon;
grant execute on function public.mark_funder_invoice_paid(uuid, numeric, text) to authenticated;
revoke all on function public.void_funder_invoice(uuid, text) from public, anon;
grant execute on function public.void_funder_invoice(uuid, text) to authenticated;
revoke all on function public.suggest_client_short_code(text) from public, anon;
grant execute on function public.suggest_client_short_code(text) to authenticated;
revoke all on function public.funder_shortcode(uuid) from public, anon;
grant execute on function public.funder_shortcode(uuid) to authenticated;
revoke all on function public.client_shortcode(uuid) from public, anon;
grant execute on function public.client_shortcode(uuid) to authenticated;
-- Internal only (pg_net / vault / activity writer): no API role.
revoke all on function public.invoke_generate_invoice_pdf(uuid) from public, anon, authenticated;
revoke all on function public.log_invoice_activity(public.activity_event_type, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.check_overdue_invoices() from public, anon, authenticated;

-- ===========================================================================
-- 15. Structural assertions (RAISE → roll the migration back). The full
--     generate/idempotency/lifecycle test is the owner's post-merge smoke test
--     with fresh data (Decision F/G) — these do NOT burn the invoice sequence.
-- ===========================================================================
do $$
declare
  v_last  bigint;
  v_called boolean;
  v_nullable text;
begin
  -- (a) invoice_state enum values.
  if (select array_agg(enumlabel::text order by enumsortorder) from pg_enum where enumtypid = 'public.invoice_state'::regtype)
     is distinct from array['draft','issued','paid','overdue','void'] then
    raise exception 'C1.1 assert FAIL: invoice_state enum values wrong';
  end if;

  -- (b) notification enum has the 3 new values (committed in part 1).
  if not (select 'FUNDER_INVOICE_ISSUED' = any(enum_range(null::public.notification_event_type)::text[])
              and 'INVOICE_OVERDUE'       = any(enum_range(null::public.notification_event_type)::text[])
              and 'INVOICE_MARKED_PAID'   = any(enum_range(null::public.notification_event_type)::text[])) then
    raise exception 'C1.1 assert FAIL: invoice notification event values missing';
  end if;

  -- (c) sequence starts at 32 without consuming it.
  select last_value, is_called into v_last, v_called from public.funder_invoices_seq;
  if not (v_last = 32 and v_called = false) then
    raise exception 'C1.1 assert FAIL: funder_invoices_seq not primed to 32 (last=%, called=%)', v_last, v_called;
  end if;

  -- (d) table + idempotency index + state-guard trigger exist.
  if to_regclass('public.funder_invoices') is null then raise exception 'C1.1 assert FAIL: funder_invoices missing'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='funder_invoices_one_active_uq') then
    raise exception 'C1.1 assert FAIL: funder_invoices_one_active_uq missing'; end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.funder_invoices'::regclass and tgname='funder_invoices_state_guard') then
    raise exception 'C1.1 assert FAIL: state guard trigger missing'; end if;

  -- (e) client short-code auto-suggestion.
  if public.suggest_client_short_code('Jane Furse Chickanos Chicken (Pty) Ltd') <> 'JANE' then
    raise exception 'C1.1 assert FAIL: suggest_client_short_code did not return JANE';
  end if;
  if public.suggest_client_short_code('Supercalifragilistic Traders') <> 'SUPERCALIFRA' then
    raise exception 'C1.1 assert FAIL: suggest_client_short_code truncation wrong (got %)',
      public.suggest_client_short_code('Supercalifragilistic Traders');
  end if;

  -- (f) clients.short_code unique index + funders billing columns exist/nullable.
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='clients_short_code_unique') then
    raise exception 'C1.1 assert FAIL: clients_short_code_unique missing'; end if;
  select is_nullable into v_nullable from information_schema.columns
    where table_schema='public' and table_name='funders' and column_name='legal_name';
  if v_nullable is distinct from 'YES' then raise exception 'C1.1 assert FAIL: funders.legal_name missing/not nullable'; end if;

  -- (g) DEFINER + grants matrix {authenticated} only (no anon/public) on the RPCs.
  if not (select prosecdef from pg_proc where oid='public.generate_funder_invoice(uuid,numeric,text,text)'::regprocedure) then
    raise exception 'C1.1 assert FAIL: generate_funder_invoice not SECURITY DEFINER'; end if;
  if not has_function_privilege('authenticated','public.generate_funder_invoice(uuid,numeric,text,text)','execute') then
    raise exception 'C1.1 assert FAIL: authenticated cannot execute generate_funder_invoice'; end if;
  if has_function_privilege('anon','public.generate_funder_invoice(uuid,numeric,text,text)','execute') then
    raise exception 'C1.1 assert FAIL: anon can execute generate_funder_invoice'; end if;
  if has_function_privilege('authenticated','public.invoke_generate_invoice_pdf(uuid)','execute') then
    raise exception 'C1.1 assert FAIL: authenticated can execute internal invoke_generate_invoice_pdf'; end if;

  -- (h) RLS policy present + storage bucket created.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='funder_invoices' and policyname='funder_invoices_owner_all') then
    raise exception 'C1.1 assert FAIL: funder_invoices RLS policy missing'; end if;
  if not exists (select 1 from storage.buckets where id='invoices') then
    raise exception 'C1.1 assert FAIL: invoices storage bucket missing'; end if;

  raise notice 'C1.1 structural assertions passed (enums, seq=32, table/index/trigger, shortcode, grants matrix, RLS, bucket)';
end $$;

notify pgrst, 'reload schema';
