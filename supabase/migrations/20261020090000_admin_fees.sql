-- Administrator Batch 5b: admin-fee invoices, receipts and daily Yoco / EFT reconciliation. Owner specification
-- 17 Oct 2026 (docs/FNC-ADMINISTRATOR-SPEC-2026-10-17.md, sections 10 and 12) and owner decision 19 Oct 2026: the
-- admin fee varies per file, so staff type the amount on each invoice. Forward-only.
--
--   * The Administrator (and the Founder) issue an admin-fee invoice on a client file, with its own number (ADM-0001).
--   * Card (Yoco) and EFT payments are captured from the Yoco and bank statements, then matched to invoices. When an
--     invoice is fully paid, a receipt (RCT-0001) is issued automatically.
--   * Each day is reconciled once every payment received that day is matched to an invoice or set aside with a reason.
--   * The company and bank details printed on invoices are entered by the Director (nothing is invented here).
-- Admin fees are FNC's own fee income. This never touches success fees, commission, funders or payment routes.
-- No VAT: FNC is not VAT-registered yet (spec section 15). Money is numeric(14,2) and checked by the database.
-- Invoices, payments, matches, receipts and reconciliations are append-only apart from the single void / exclude /
-- reverse step each allows. RLS on, no grants; every read and write is a role-checked SECURITY DEFINER function.

-- 0. Helpers ------------------------------------------------------------------------------------------------------
create or replace function public.admin_fee_require_actor()
returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.staff_is_founder_or_administrator() then
    raise exception 'Only the Administrator or the Director handles admin fees' using errcode = '42501';
  end if;
  return public.staff_actor_role();
end;
$$;
revoke all on function public.admin_fee_require_actor() from public, anon, authenticated;

-- A money amount: positive, at most 2 decimals, below R1,000,000.
create or replace function public.admin_fee_valid_amount(p_amount numeric)
returns boolean
language sql immutable set search_path = '' as $$
  select p_amount is not null and p_amount::text not in ('NaN', 'Infinity', '-Infinity')
     and p_amount > 0 and p_amount < 1000000 and p_amount = round(p_amount, 2);
$$;
revoke all on function public.admin_fee_valid_amount(numeric) from public, anon, authenticated;

create sequence if not exists public.admin_fee_invoice_seq;
create sequence if not exists public.admin_fee_receipt_seq;
revoke all on sequence public.admin_fee_invoice_seq from public, anon, authenticated;
revoke all on sequence public.admin_fee_receipt_seq from public, anon, authenticated;

-- 1. Tables -------------------------------------------------------------------------------------------------------
-- The details printed on every invoice and receipt (one row). Entered by the Director.
create table if not exists public.admin_fee_settings (
  id                  boolean primary key default true check (id),
  legal_name          text check (legal_name is null or length(btrim(legal_name)) between 2 and 160),
  registration_number text check (registration_number is null or length(registration_number) <= 40),
  address             text check (address is null or length(address) <= 400),
  contact_email       text check (contact_email is null or length(contact_email) <= 254),
  contact_phone       text check (contact_phone is null or length(contact_phone) <= 30),
  bank_name           text check (bank_name is null or length(bank_name) <= 80),
  account_holder      text check (account_holder is null or length(account_holder) <= 120),
  account_number      text check (account_number is null or account_number ~ '^[0-9]{6,16}$'),
  branch_code         text check (branch_code is null or branch_code ~ '^[0-9]{4,8}$'),
  yoco_link           text check (yoco_link is null or (length(yoco_link) <= 300 and yoco_link ~ '^https://')),
  payment_note        text check (payment_note is null or length(payment_note) <= 400),
  updated_by          uuid references public.profiles(id) on delete restrict,
  updated_at          timestamptz not null default now()
);

create table if not exists public.admin_fee_invoices (
  id              uuid primary key default gen_random_uuid(),
  invoice_number  text not null unique,
  lead_id         uuid not null references public.leads(id) on delete restrict,
  billed_to       text not null check (length(btrim(billed_to)) between 2 and 160),
  billed_email    text check (billed_email is null or (length(billed_email) <= 254 and billed_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  description     text not null check (length(btrim(description)) between 3 and 300),
  amount          numeric(14,2) not null check (public.admin_fee_valid_amount(amount)),
  issued_at       timestamptz not null default now(),
  due_on          date not null,
  created_by      uuid not null references public.profiles(id) on delete restrict,
  created_role    text not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 100),
  voided_at       timestamptz,
  voided_by       uuid references public.profiles(id) on delete restrict,
  void_reason     text check (void_reason is null or length(void_reason) <= 500),
  constraint admin_fee_invoices_idem_uq unique (created_by, idempotency_key),
  constraint admin_fee_invoices_safe_text_ck check (public.staff_text_is_safe(billed_to) and public.staff_text_is_safe(description)
                                                     and public.staff_text_is_safe(void_reason)),
  constraint admin_fee_invoices_void_ck check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null))
);
create index if not exists admin_fee_invoices_lead_idx on public.admin_fee_invoices (lead_id);
create index if not exists admin_fee_invoices_issued_idx on public.admin_fee_invoices (issued_at desc);

create table if not exists public.admin_fee_payments (
  id             uuid primary key default gen_random_uuid(),
  method         text not null check (method in ('yoco', 'eft')),
  amount         numeric(14,2) not null check (public.admin_fee_valid_amount(amount)),
  received_on    date not null,
  reference      text not null check (length(btrim(reference)) between 3 and 100),
  payer          text check (payer is null or length(payer) <= 160),
  recorded_by    uuid not null references public.profiles(id) on delete restrict,
  recorded_role  text not null,
  created_at     timestamptz not null default now(),
  excluded_at    timestamptz,
  excluded_by    uuid references public.profiles(id) on delete restrict,
  exclude_reason text check (exclude_reason is null or length(exclude_reason) <= 500),
  constraint admin_fee_payments_safe_text_ck check (public.staff_text_is_safe(payer) and public.staff_text_is_safe(exclude_reason)),
  constraint admin_fee_payments_exclude_ck check ((excluded_at is null) = (excluded_by is null) and (excluded_at is null) = (exclude_reason is null))
);
-- The same Yoco transaction or EFT reference is never captured twice.
create unique index if not exists admin_fee_payments_reference_uq on public.admin_fee_payments (method, lower(btrim(reference)));
create index if not exists admin_fee_payments_day_idx on public.admin_fee_payments (received_on);

create table if not exists public.admin_fee_matches (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid not null references public.admin_fee_payments(id) on delete restrict,
  invoice_id     uuid not null references public.admin_fee_invoices(id) on delete restrict,
  matched_by     uuid not null references public.profiles(id) on delete restrict,
  matched_role   text not null,
  matched_at     timestamptz not null default now(),
  reversed_at    timestamptz,
  reversed_by    uuid references public.profiles(id) on delete restrict,
  reverse_reason text check (reverse_reason is null or (length(reverse_reason) <= 500 and public.staff_text_is_safe(reverse_reason))),
  constraint admin_fee_matches_reverse_ck check ((reversed_at is null) = (reversed_by is null) and (reversed_at is null) = (reverse_reason is null))
);
-- A payment pays one invoice at a time.
create unique index if not exists admin_fee_matches_active_uq on public.admin_fee_matches (payment_id) where reversed_at is null;
create index if not exists admin_fee_matches_invoice_idx on public.admin_fee_matches (invoice_id) where reversed_at is null;

create table if not exists public.admin_fee_receipts (
  id             uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  invoice_id     uuid not null unique references public.admin_fee_invoices(id) on delete restrict,
  issued_at      timestamptz not null default now(),
  issued_by      uuid not null references public.profiles(id) on delete restrict
);

create table if not exists public.admin_fee_reconciliations (
  day             date primary key,
  payments        integer not null,
  matched         integer not null,
  excluded        integer not null,
  total_received  numeric(14,2) not null,
  note            text check (note is null or (length(note) <= 500 and public.staff_text_is_safe(note))),
  reconciled_by   uuid not null references public.profiles(id) on delete restrict,
  reconciled_role text not null,
  reconciled_at   timestamptz not null default now()
);

alter table public.admin_fee_settings enable row level security;
alter table public.admin_fee_invoices enable row level security;
alter table public.admin_fee_payments enable row level security;
alter table public.admin_fee_matches enable row level security;
alter table public.admin_fee_receipts enable row level security;
alter table public.admin_fee_reconciliations enable row level security;
revoke all on table public.admin_fee_settings, public.admin_fee_invoices, public.admin_fee_payments, public.admin_fee_matches,
  public.admin_fee_receipts, public.admin_fee_reconciliations from public, anon, authenticated;

create trigger admin_fee_receipts_append_only before update or delete on public.admin_fee_receipts
  for each row execute function public.intake_append_only_guard();
create trigger admin_fee_reconciliations_append_only before update or delete on public.admin_fee_reconciliations
  for each row execute function public.intake_append_only_guard();

-- Invoices: only the one void step; payments: only the one set-aside step; matches: only the one reversal.
create or replace function public.admin_fee_row_guard()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception '% rows cannot be deleted', tg_table_name; end if;
  if tg_table_name = 'admin_fee_invoices' then
    if old.voided_at is not null or new.voided_at is null
       or (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason']) <> (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
      raise exception 'An issued invoice cannot be changed; void it and issue a new one';
    end if;
  elsif tg_table_name = 'admin_fee_payments' then
    if old.excluded_at is not null or new.excluded_at is null
       or (to_jsonb(new) - array['excluded_at', 'excluded_by', 'exclude_reason']) <> (to_jsonb(old) - array['excluded_at', 'excluded_by', 'exclude_reason']) then
      raise exception 'A captured payment cannot be changed; set it aside with a reason';
    end if;
  elsif tg_table_name = 'admin_fee_matches' then
    if old.reversed_at is not null or new.reversed_at is null
       or (to_jsonb(new) - array['reversed_at', 'reversed_by', 'reverse_reason']) <> (to_jsonb(old) - array['reversed_at', 'reversed_by', 'reverse_reason']) then
      raise exception 'A match can only be reversed, once';
    end if;
  end if;
  return new;
end;
$$;
create trigger admin_fee_invoices_guard before update or delete on public.admin_fee_invoices
  for each row execute function public.admin_fee_row_guard();
create trigger admin_fee_payments_guard before update or delete on public.admin_fee_payments
  for each row execute function public.admin_fee_row_guard();
create trigger admin_fee_matches_guard before update or delete on public.admin_fee_matches
  for each row execute function public.admin_fee_row_guard();

-- Amount paid against an invoice (active matches).
create or replace function public.admin_fee_paid(p_invoice uuid)
returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(p.amount), 0)::numeric(14,2)
    from public.admin_fee_matches m join public.admin_fee_payments p on p.id = m.payment_id
   where m.invoice_id = p_invoice and m.reversed_at is null;
$$;
revoke all on function public.admin_fee_paid(uuid) from public, anon, authenticated;

-- 2. Settings -----------------------------------------------------------------------------------------------------
create or replace function public.admin_fee_settings_get()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_fee_require_actor();
  return coalesce((select to_jsonb(s) - 'id' - 'updated_by' from public.admin_fee_settings s), '{}'::jsonb);
end;
$$;
revoke all on function public.admin_fee_settings_get() from public, anon;
grant execute on function public.admin_fee_settings_get() to authenticated;

create or replace function public.owner_save_admin_fee_settings(p jsonb)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  if not coalesce(public.is_owner(), false) then
    raise exception 'Only the Director changes the invoice details' using errcode = '42501';
  end if;
  insert into public.admin_fee_settings (id, legal_name, registration_number, address, contact_email, contact_phone, bank_name,
                                         account_holder, account_number, branch_code, yoco_link, payment_note, updated_by, updated_at)
  values (true, nullif(btrim(p ->> 'legal_name'), ''), nullif(btrim(p ->> 'registration_number'), ''), nullif(btrim(p ->> 'address'), ''),
          nullif(btrim(p ->> 'contact_email'), ''), nullif(btrim(p ->> 'contact_phone'), ''), nullif(btrim(p ->> 'bank_name'), ''),
          nullif(btrim(p ->> 'account_holder'), ''), nullif(regexp_replace(coalesce(p ->> 'account_number', ''), '\s', '', 'g'), ''),
          nullif(regexp_replace(coalesce(p ->> 'branch_code', ''), '\s', '', 'g'), ''), nullif(btrim(p ->> 'yoco_link'), ''),
          nullif(btrim(p ->> 'payment_note'), ''), (select auth.uid()), now())
  on conflict (id) do update set
    legal_name = excluded.legal_name, registration_number = excluded.registration_number, address = excluded.address,
    contact_email = excluded.contact_email, contact_phone = excluded.contact_phone, bank_name = excluded.bank_name,
    account_holder = excluded.account_holder, account_number = excluded.account_number, branch_code = excluded.branch_code,
    yoco_link = excluded.yoco_link, payment_note = excluded.payment_note, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning updated_at into v_at;
  perform public.staff_audit_write('admin_fee_settings', null, 'admin_fee_settings_saved', null, '{}'::jsonb);
  return v_at;
end;
$$;
revoke all on function public.owner_save_admin_fee_settings(jsonb) from public, anon;
grant execute on function public.owner_save_admin_fee_settings(jsonb) to authenticated;

-- 3. Invoices -----------------------------------------------------------------------------------------------------
create or replace function public.admin_fee_issue_invoice(
  p_lead_id uuid, p_billed_to text, p_billed_email text, p_description text, p_amount numeric, p_due_on date,
  p_idempotency_key text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_role text := public.admin_fee_require_actor(); v_uid uuid := (select auth.uid()); v_id uuid;
begin
  select i.id into v_id from public.admin_fee_invoices i where i.created_by = v_uid and i.idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;
  if not exists (select 1 from public.submission_intakes si where si.lead_id = p_lead_id) then raise exception 'Client file not found'; end if;
  if not public.admin_fee_valid_amount(p_amount) then
    raise exception 'Enter the admin fee in Rands (more than R0, at most 2 decimals)';
  end if;
  if length(btrim(coalesce(p_billed_to, ''))) not between 2 and 160 then raise exception 'Say who the invoice is for'; end if;
  if length(btrim(coalesce(p_description, ''))) not between 3 and 300 then raise exception 'Describe what the fee is for'; end if;
  if not public.staff_text_is_safe(p_billed_to) or not public.staff_text_is_safe(p_description) then
    raise exception 'Invoices cannot contain ID or account-length numbers';
  end if;
  if p_due_on is null or p_due_on < public.current_sast_date() or p_due_on > public.current_sast_date() + 90 then
    raise exception 'Choose a due date between today and 90 days from now';
  end if;
  insert into public.admin_fee_invoices (invoice_number, lead_id, billed_to, billed_email, description, amount, due_on,
                                         created_by, created_role, idempotency_key)
  values ('ADM-' || lpad(nextval('public.admin_fee_invoice_seq')::text, 4, '0'), p_lead_id, btrim(p_billed_to),
          nullif(lower(btrim(p_billed_email)), ''), btrim(p_description), p_amount, p_due_on, v_uid, v_role, p_idempotency_key)
  returning id into v_id;
  perform public.staff_audit_write('admin_fee_invoice', v_id, 'admin_fee_invoice_issued', null,
    jsonb_build_object('lead_id', p_lead_id, 'amount', p_amount));
  return v_id;
end;
$$;
revoke all on function public.admin_fee_issue_invoice(uuid, text, text, text, numeric, date, text) from public, anon;
grant execute on function public.admin_fee_issue_invoice(uuid, text, text, text, numeric, date, text) to authenticated;

create or replace function public.admin_fee_void_invoice(p_invoice uuid, p_reason text)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  perform public.admin_fee_require_actor();
  if length(btrim(coalesce(p_reason, ''))) not between 5 and 500 or not public.staff_text_is_safe(p_reason) then
    raise exception 'Give a reason for voiding (5 to 500 characters)';
  end if;
  perform 1 from public.admin_fee_invoices i where i.id = p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  if exists (select 1 from public.admin_fee_matches m where m.invoice_id = p_invoice and m.reversed_at is null) then
    raise exception 'This invoice has payments matched to it; reverse them first';
  end if;
  update public.admin_fee_invoices set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
   where id = p_invoice and voided_at is null returning voided_at into v_at;
  if v_at is null then raise exception 'This invoice is already void'; end if;
  perform public.staff_audit_write('admin_fee_invoice', p_invoice, 'admin_fee_invoice_voided', btrim(p_reason), '{}'::jsonb);
  return v_at;
end;
$$;
revoke all on function public.admin_fee_void_invoice(uuid, text) from public, anon;
grant execute on function public.admin_fee_void_invoice(uuid, text) to authenticated;

create or replace function public.admin_fee_invoices_list(p_open_only boolean default false)
returns table (invoice_id uuid, invoice_number text, lead_id uuid, business_name text, billed_to text, billed_email text,
               description text, amount numeric, paid numeric, balance numeric, status text, issued_at timestamptz,
               due_on date, overdue boolean, receipt_number text, void_reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_fee_require_actor();
  return query
    select x.* from (
      select i.id as invoice_id, i.invoice_number, i.lead_id, l.business_name, i.billed_to, i.billed_email, i.description, i.amount,
             pd.paid, (i.amount - pd.paid)::numeric(14,2) as balance,
             case when i.voided_at is not null then 'void' when pd.paid >= i.amount then 'paid'
                  when pd.paid > 0 then 'part_paid' else 'unpaid' end as status,
             i.issued_at, i.due_on,
             (i.voided_at is null and pd.paid < i.amount and i.due_on < public.current_sast_date()) as overdue,
             r.receipt_number, i.void_reason
        from public.admin_fee_invoices i
        join public.leads l on l.id = i.lead_id
        cross join lateral (select public.admin_fee_paid(i.id) as paid) pd
        left join public.admin_fee_receipts r on r.invoice_id = i.id
    ) x
    where not coalesce(p_open_only, false) or x.status in ('unpaid', 'part_paid')
    order by x.issued_at desc
    limit 300;
end;
$$;
revoke all on function public.admin_fee_invoices_list(boolean) from public, anon;
grant execute on function public.admin_fee_invoices_list(boolean) to authenticated;

-- Everything needed to print an invoice (and its receipt once paid).
create or replace function public.admin_fee_document(p_invoice uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.admin_fee_require_actor();
  select jsonb_build_object(
           'invoice', (select jsonb_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number, 'business_name', l.business_name,
                          'billed_to', i.billed_to, 'billed_email', i.billed_email, 'description', i.description, 'amount', i.amount,
                          'paid', public.admin_fee_paid(i.id), 'balance', i.amount - public.admin_fee_paid(i.id),
                          'status', case when i.voided_at is not null then 'void' when public.admin_fee_paid(i.id) >= i.amount then 'paid'
                                         when public.admin_fee_paid(i.id) > 0 then 'part_paid' else 'unpaid' end,
                          'issued_at', i.issued_at, 'due_on', i.due_on, 'void_reason', i.void_reason)
                         from public.admin_fee_invoices i join public.leads l on l.id = i.lead_id where i.id = p_invoice),
           'receipt', (select jsonb_build_object('receipt_number', r.receipt_number, 'issued_at', r.issued_at)
                         from public.admin_fee_receipts r where r.invoice_id = p_invoice),
           'payments', coalesce((select jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amount,
                                   'received_on', p.received_on, 'reference', p.reference) order by p.received_on)
                                   from public.admin_fee_matches m join public.admin_fee_payments p on p.id = m.payment_id
                                  where m.invoice_id = p_invoice and m.reversed_at is null), '[]'::jsonb),
           'settings', public.admin_fee_settings_get())
    into v;
  if v -> 'invoice' is null or v -> 'invoice' = 'null'::jsonb then raise exception 'Invoice not found'; end if;
  return v;
end;
$$;
revoke all on function public.admin_fee_document(uuid) from public, anon;
grant execute on function public.admin_fee_document(uuid) to authenticated;

-- 4. Payments and matching ----------------------------------------------------------------------------------------
create or replace function public.admin_fee_record_payment(
  p_method text, p_amount numeric, p_received_on date, p_reference text, p_payer text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_role text := public.admin_fee_require_actor(); v_id uuid;
begin
  if p_method is null or p_method not in ('yoco', 'eft') then raise exception 'Choose Yoco (card) or EFT'; end if;
  if not public.admin_fee_valid_amount(p_amount) then raise exception 'Enter the amount received in Rands'; end if;
  if p_received_on is null or p_received_on > public.current_sast_date() or p_received_on < public.current_sast_date() - 90 then
    raise exception 'The payment date must be within the last 90 days';
  end if;
  if length(btrim(coalesce(p_reference, ''))) not between 3 and 100 then
    raise exception 'Enter the Yoco transaction ID or the EFT reference from the statement';
  end if;
  if not public.staff_text_is_safe(p_payer) then raise exception 'The payer name cannot contain ID or account-length numbers'; end if;
  begin
    insert into public.admin_fee_payments (method, amount, received_on, reference, payer, recorded_by, recorded_role)
    values (p_method, p_amount, p_received_on, btrim(p_reference), nullif(btrim(p_payer), ''), (select auth.uid()), v_role)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This % reference has already been captured', case p_method when 'yoco' then 'Yoco' else 'EFT' end;
  end;
  perform public.staff_audit_write('admin_fee_payment', v_id, 'admin_fee_payment_recorded', null,
    jsonb_build_object('method', p_method, 'amount', p_amount, 'received_on', p_received_on));
  return v_id;
end;
$$;
revoke all on function public.admin_fee_record_payment(text, numeric, date, text, text) from public, anon;
grant execute on function public.admin_fee_record_payment(text, numeric, date, text, text) to authenticated;

-- Match a payment to an invoice. Issues the receipt when the invoice becomes fully paid. Returns the invoice status.
create or replace function public.admin_fee_match(p_payment uuid, p_invoice uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_role text := public.admin_fee_require_actor(); v_uid uuid := (select auth.uid()); pay record; inv record; v_paid numeric;
begin
  -- One invoice at a time, so two people matching to the same invoice cannot overpay it.
  select * into inv from public.admin_fee_invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if inv.voided_at is not null then raise exception 'This invoice is void'; end if;
  select * into pay from public.admin_fee_payments where id = p_payment for update;
  if pay.id is null then raise exception 'Payment not found'; end if;
  if pay.excluded_at is not null then raise exception 'This payment was set aside as not an admin fee'; end if;
  if exists (select 1 from public.admin_fee_matches m where m.payment_id = p_payment and m.reversed_at is null) then
    raise exception 'This payment is already matched to an invoice';
  end if;
  v_paid := public.admin_fee_paid(p_invoice);
  if v_paid + pay.amount > inv.amount then
    raise exception 'This payment (R%) is more than the balance on % (R%)', pay.amount, inv.invoice_number, inv.amount - v_paid;
  end if;
  insert into public.admin_fee_matches (payment_id, invoice_id, matched_by, matched_role) values (p_payment, p_invoice, v_uid, v_role);
  perform public.staff_audit_write('admin_fee_invoice', p_invoice, 'admin_fee_payment_matched', null, jsonb_build_object('payment_id', p_payment));
  if v_paid + pay.amount = inv.amount then
    insert into public.admin_fee_receipts (receipt_number, invoice_id, issued_by)
    values ('RCT-' || lpad(nextval('public.admin_fee_receipt_seq')::text, 4, '0'), p_invoice, v_uid)
    on conflict (invoice_id) do nothing;
    return 'paid';
  end if;
  return 'part_paid';
end;
$$;
revoke all on function public.admin_fee_match(uuid, uuid) from public, anon;
grant execute on function public.admin_fee_match(uuid, uuid) to authenticated;

create or replace function public.admin_fee_unmatch(p_payment uuid, p_reason text)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz; m record;
begin
  perform public.admin_fee_require_actor();
  if length(btrim(coalesce(p_reason, ''))) not between 5 and 500 or not public.staff_text_is_safe(p_reason) then
    raise exception 'Give a reason (5 to 500 characters)';
  end if;
  select * into m from public.admin_fee_matches where payment_id = p_payment and reversed_at is null for update;
  if m.id is null then raise exception 'This payment is not matched'; end if;
  -- A receipt is a document the client may already hold; it is not taken back here.
  if exists (select 1 from public.admin_fee_receipts r where r.invoice_id = m.invoice_id) then
    raise exception 'A receipt has been issued for this invoice; ask the Director before changing it';
  end if;
  if exists (select 1 from public.admin_fee_reconciliations c join public.admin_fee_payments p on p.received_on = c.day where p.id = p_payment) then
    raise exception 'That day is already reconciled';
  end if;
  update public.admin_fee_matches set reversed_at = now(), reversed_by = (select auth.uid()), reverse_reason = btrim(p_reason)
   where id = m.id returning reversed_at into v_at;
  perform public.staff_audit_write('admin_fee_invoice', m.invoice_id, 'admin_fee_payment_unmatched', btrim(p_reason), jsonb_build_object('payment_id', p_payment));
  return v_at;
end;
$$;
revoke all on function public.admin_fee_unmatch(uuid, text) from public, anon;
grant execute on function public.admin_fee_unmatch(uuid, text) to authenticated;

-- A payment that is not an admin fee (for example a success-fee deposit or a refund) is set aside with a reason.
create or replace function public.admin_fee_exclude_payment(p_payment uuid, p_reason text)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  perform public.admin_fee_require_actor();
  if length(btrim(coalesce(p_reason, ''))) not between 5 and 500 or not public.staff_text_is_safe(p_reason) then
    raise exception 'Give a reason (5 to 500 characters)';
  end if;
  if exists (select 1 from public.admin_fee_matches m where m.payment_id = p_payment and m.reversed_at is null) then
    raise exception 'This payment is matched to an invoice; reverse the match first';
  end if;
  update public.admin_fee_payments set excluded_at = now(), excluded_by = (select auth.uid()), exclude_reason = btrim(p_reason)
   where id = p_payment and excluded_at is null returning excluded_at into v_at;
  if v_at is null then raise exception 'Payment not found, or already set aside'; end if;
  perform public.staff_audit_write('admin_fee_payment', p_payment, 'admin_fee_payment_excluded', btrim(p_reason), '{}'::jsonb);
  return v_at;
end;
$$;
revoke all on function public.admin_fee_exclude_payment(uuid, text) from public, anon;
grant execute on function public.admin_fee_exclude_payment(uuid, text) to authenticated;

-- Payments, newest day first. A suggestion is offered when the reference names an open invoice, or when exactly one
-- open invoice has a balance equal to the payment.
create or replace function public.admin_fee_payments_list(p_day date default null, p_open_only boolean default false)
returns table (payment_id uuid, method text, amount numeric, received_on date, reference text, payer text, status text,
               invoice_id uuid, invoice_number text, business_name text, exclude_reason text,
               suggested_invoice_id uuid, suggested_invoice_number text, day_reconciled boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_fee_require_actor();
  return query
    with open_inv as (
      select x.invoice_id, x.invoice_number, x.balance from public.admin_fee_invoices_list(true) x
    )
    select p.id, p.method, p.amount, p.received_on, p.reference, p.payer,
           case when p.excluded_at is not null then 'set_aside' when m.id is not null then 'matched' else 'unmatched' end,
           m.invoice_id, i.invoice_number, l.business_name, p.exclude_reason,
           s.invoice_id, s.invoice_number,
           exists (select 1 from public.admin_fee_reconciliations c where c.day = p.received_on)
      from public.admin_fee_payments p
      left join public.admin_fee_matches m on m.payment_id = p.id and m.reversed_at is null
      left join public.admin_fee_invoices i on i.id = m.invoice_id
      left join public.leads l on l.id = i.lead_id
      left join lateral (
        select o.invoice_id, o.invoice_number from open_inv o
         where m.id is null and p.excluded_at is null
           and (p.reference ilike '%' || o.invoice_number || '%'
                or (o.balance = p.amount and (select count(*) from open_inv o2 where o2.balance = p.amount) = 1))
         order by (p.reference ilike '%' || o.invoice_number || '%') desc limit 1) s on true
     where (p_day is null or p.received_on = p_day)
       and (not coalesce(p_open_only, false) or (m.id is null and p.excluded_at is null))
     order by p.received_on desc, p.created_at desc
     limit 500;
end;
$$;
revoke all on function public.admin_fee_payments_list(date, boolean) from public, anon;
grant execute on function public.admin_fee_payments_list(date, boolean) to authenticated;

-- 5. Daily reconciliation -----------------------------------------------------------------------------------------
create or replace function public.admin_fee_reconcile_day(p_day date, p_note text default null)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_role text := public.admin_fee_require_actor(); v_n int; v_open int; v_matched int; v_excl int; v_total numeric; v_at timestamptz;
begin
  if p_day is null or p_day > public.current_sast_date() then raise exception 'Choose a day up to today'; end if;
  if p_note is not null and (length(p_note) > 500 or not public.staff_text_is_safe(p_note)) then
    raise exception 'Keep the note under 500 characters, without ID or account-length numbers';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('admin_fee_day:' || p_day::text, 0));
  select count(*)::int,
         count(*) filter (where p.excluded_at is null and not exists (select 1 from public.admin_fee_matches m where m.payment_id = p.id and m.reversed_at is null))::int,
         count(*) filter (where exists (select 1 from public.admin_fee_matches m where m.payment_id = p.id and m.reversed_at is null))::int,
         count(*) filter (where p.excluded_at is not null)::int,
         coalesce(sum(p.amount) filter (where p.excluded_at is null), 0)
    into v_n, v_open, v_matched, v_excl, v_total
    from public.admin_fee_payments p where p.received_on = p_day;
  if v_open > 0 then
    raise exception '% payment(s) on that day still need matching to an invoice or setting aside', v_open;
  end if;
  insert into public.admin_fee_reconciliations (day, payments, matched, excluded, total_received, note, reconciled_by, reconciled_role)
  values (p_day, v_n, v_matched, v_excl, v_total, nullif(btrim(p_note), ''), (select auth.uid()), v_role)
  on conflict (day) do nothing returning reconciled_at into v_at;
  if v_at is null then raise exception 'That day is already reconciled'; end if;
  perform public.staff_audit_write('admin_fee_reconciliation', null, 'admin_fee_day_reconciled', null,
    jsonb_build_object('day', p_day, 'payments', v_n, 'total', v_total));
  return v_at;
end;
$$;
revoke all on function public.admin_fee_reconcile_day(date, text) from public, anon;
grant execute on function public.admin_fee_reconcile_day(date, text) to authenticated;

-- The last p_days days. A payment may still be captured for a day already reconciled (statements arrive late); that
-- day then shows as changed after reconciliation so it is checked again.
create or replace function public.admin_fee_days(p_days integer default 14)
returns table (day date, payments integer, unmatched integer, total_received numeric, reconciled_at timestamptz,
               reconciled_by text, changed_after boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_fee_require_actor();
  p_days := least(greatest(coalesce(p_days, 14), 1), 90);
  return query
    select g.d::date,
           (select count(*)::int from public.admin_fee_payments p where p.received_on = g.d::date),
           (select count(*)::int from public.admin_fee_payments p where p.received_on = g.d::date and p.excluded_at is null
               and not exists (select 1 from public.admin_fee_matches m where m.payment_id = p.id and m.reversed_at is null)),
           (select coalesce(sum(p.amount), 0)::numeric(14,2) from public.admin_fee_payments p where p.received_on = g.d::date and p.excluded_at is null),
           c.reconciled_at, rp.full_name,
           (c.day is not null and (select count(*) from public.admin_fee_payments p where p.received_on = g.d::date) <> c.payments)
      from generate_series(public.current_sast_date() - (p_days - 1), public.current_sast_date(), interval '1 day') g(d)
      left join public.admin_fee_reconciliations c on c.day = g.d::date
      left join public.profiles rp on rp.id = c.reconciled_by
     where extract(isodow from g.d) < 6 or exists (select 1 from public.admin_fee_payments p where p.received_on = g.d::date)
     order by 1 desc;
end;
$$;
revoke all on function public.admin_fee_days(integer) from public, anon;
grant execute on function public.admin_fee_days(integer) to authenticated;

-- 6. The Friday report now counts admin fees paid (Batch 4 reported it as not tracked) ---------------------------------
create or replace function public.staff_files_progress_report(p_day date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_day date := coalesce(p_day, public.current_sast_date());
  v_month date := date_trunc('month', v_day)::date;
  v_week date := v_day - (extract(isodow from v_day)::int - 1);
  v_m tstzrange; v_w tstzrange; v_opened int; v_left int;
  v_target constant int := 60;
begin
  perform public.staff_require_founder_or_administrator();
  v_m := tstzrange((v_month::timestamp at time zone 'Africa/Johannesburg'),
                   (((v_month + interval '1 month')::date)::timestamp at time zone 'Africa/Johannesburg'), '[)');
  v_w := tstzrange((v_week::timestamp at time zone 'Africa/Johannesburg'),
                   ((v_week + 7)::timestamp at time zone 'Africa/Johannesburg'), '[)');
  select count(*)::int into v_opened from public.submission_intakes si where si.registered_at <@ v_m;
  -- Working days left in the month after today (weekdays, less the public holidays the owner entered).
  select count(*)::int into v_left
    from generate_series(v_day + 1, ((v_month + interval '1 month')::date - 1), interval '1 day') g(d)
   where extract(isodow from g.d) < 6
     and not exists (select 1 from public.business_holidays h where h.holiday_date = g.d::date);
  return jsonb_build_object(
    'day', v_day, 'month', v_month, 'week_start', v_week, 'target', v_target,
    'files_opened_month', v_opened,
    'files_opened_week', (select count(*)::int from public.submission_intakes si where si.registered_at <@ v_w),
    'working_days_left', v_left,
    'files_needed_per_day', case when v_opened >= v_target then 0 when v_left > 0 then ceil((v_target - v_opened)::numeric / v_left)::int end,
    'documents_complete_month', (select count(*)::int from public.submission_intakes si where si.first_complete_at <@ v_m),
    'documents_complete_week', (select count(*)::int from public.submission_intakes si where si.first_complete_at <@ v_w),
    -- Counts of admin-fee invoices fully paid (receipt issued), not amounts.
    'admin_fees_paid', jsonb_build_object('not_tracked', false,
      'month', (select count(*)::int from public.admin_fee_receipts r where r.issued_at <@ v_m),
      'week', (select count(*)::int from public.admin_fee_receipts r where r.issued_at <@ v_w)),
    'files_in_progress', coalesce((
      select jsonb_object_agg(s.workflow_status, s.n) from (
        select si.workflow_status::text as workflow_status, count(*)::int as n
          from public.submission_intakes si where si.archived_at is null group by 1) s), '{}'::jsonb),
    'deals_in_progress', coalesce((
      select jsonb_object_agg(s.stage, s.n) from (
        select d.stage::text as stage, count(*)::int as n from public.deals d
         where d.archived_at is null and d.stage::text not in ('funded', 'invoiced', 'commission_paid', 'declined')
         group by 1) s), '{}'::jsonb));
end;
$$;
revoke all on function public.staff_files_progress_report(date) from public, anon;
grant execute on function public.staff_files_progress_report(date) to authenticated;
