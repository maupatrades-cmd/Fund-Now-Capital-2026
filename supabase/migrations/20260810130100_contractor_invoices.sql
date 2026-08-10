-- Build 8.1 — contractor invoice lifecycle (part 2 of 2): schema + RPCs.
-- ============================================================================
-- The contractor analogue of the C4 partner-invoice ledger. A contractor
-- invoices FNC for the flat-tier commission FNC owes them once the funder has
-- paid FNC (Build 7 advances the contractor tier row earned -> outstanding ->
-- payable). This lane adds:
--   * contractor_invoices + contractor_invoice_line_items (mirrors partner tables)
--   * the reserved commission_records.contractor_invoice_id FK
--   * generate / submit / remove-line / owner-approve / owner-reject RPCs
--   * an enriched line-item read
-- Mark-paid + settle (payable -> settled, EFT proof) is deliberately Build 10.
--
-- The contractor is identified by contractor_id -> profiles(id) (their user id),
-- matching commission_records.contractor_id and the Build 7 cascade. Money is
-- numeric(14,2), server-computed; contractor surfaces never see FNC gross.
-- Both new tables are empty, so inline FKs/CHECKs are metadata-only, and
-- commission_records is empty (0 rows) so its new FK is instant.
-- ============================================================================

-- ===========================================================================
-- 1. State enum (new type — usable in this same transaction).
-- ===========================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'contractor_invoice_state') then
    create type public.contractor_invoice_state as enum
      ('draft', 'submitted', 'approved', 'paid', 'rejected');
  end if;
end $$;

-- ===========================================================================
-- 2. Global CI-#### sequence. Consumed only when a draft is really created.
-- ===========================================================================
create sequence if not exists public.contractor_invoices_seq as bigint start with 1 minvalue 1;

-- ===========================================================================
-- 3. contractor_invoices — new empty table; inline FKs safe.
-- ===========================================================================
create table if not exists public.contractor_invoices (
  id                    uuid primary key default gen_random_uuid(),
  contractor_id         uuid not null references public.profiles(id) on delete restrict,
  invoice_number        text not null unique,                                  -- CI-NNNN
  generated_at          timestamptz not null default now(),
  invoice_period_start  date not null,
  invoice_period_end    date not null,
  total_amount          numeric(14,2) not null default 0,                      -- server-computed = Σ line amounts
  state                 public.contractor_invoice_state not null default 'draft',
  submitted_at          timestamptz,
  approved_at           timestamptz,
  approved_by           uuid references public.profiles(id),
  paid_at               timestamptz,
  paid_reference        text,
  rejected_at           timestamptz,
  rejected_reason       text,
  notes                 text,
  created_by            uuid default auth.uid() references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint contractor_invoices_period_ck       check (invoice_period_end >= invoice_period_start),
  constraint contractor_invoices_total_nonneg    check (total_amount >= 0),
  constraint contractor_invoices_rejected_reason check (state <> 'rejected' or rejected_reason is not null),
  constraint contractor_invoices_paid_reference  check (state <> 'paid'     or paid_reference  is not null)
);

comment on table public.contractor_invoices is
  'Contractor → FNC commission invoices (Build 8; CONTRACTOR money coexistence). State: draft→submitted→approved→paid, or submitted→rejected. Amount = the contractor tier take; FNC gross is never exposed.';

create index if not exists contractor_invoices_contractor_idx on public.contractor_invoices (contractor_id);
create index if not exists contractor_invoices_state_idx      on public.contractor_invoices (state);

drop trigger if exists set_updated_at on public.contractor_invoices;
create trigger set_updated_at before update on public.contractor_invoices
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 4. contractor_invoice_line_items — one row per invoiced contractor tier
--    commission_record. amount = commission_records.contractor_share.
-- ===========================================================================
create table if not exists public.contractor_invoice_line_items (
  id                    uuid primary key default gen_random_uuid(),
  invoice_id            uuid not null references public.contractor_invoices(id) on delete cascade,
  commission_record_id  uuid not null references public.commission_records(id) on delete restrict,
  deal_id               uuid not null references public.deals(id) on delete restrict,
  amount                numeric(14,2) not null check (amount >= 0),
  added_at              timestamptz not null default now()
);

comment on table public.contractor_invoice_line_items is
  'Line items on a contractor invoice — one per invoiced contractor tier commission_record. amount = contractor_share; no FNC gross is stored or exposed.';

create index if not exists contractor_invoice_line_items_invoice_idx on public.contractor_invoice_line_items (invoice_id);
create index if not exists contractor_invoice_line_items_deal_idx    on public.contractor_invoice_line_items (deal_id);
create index if not exists contractor_invoice_line_items_cr_idx      on public.contractor_invoice_line_items (commission_record_id);

-- No-double-invoice guard: a commission_record sits on at most ONE line item whose
-- parent invoice is NOT rejected. Rejecting frees it for re-invoicing. DB backstop;
-- the generate RPC also filters + a per-contractor advisory lock serialises generates.
create or replace function public.contractor_invoice_line_item_no_double()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1
      from public.contractor_invoice_line_items li
      join public.contractor_invoices ci on ci.id = li.invoice_id
     where li.commission_record_id = new.commission_record_id
       and li.id <> new.id
       and ci.state <> 'rejected'
  ) then
    raise exception 'Commission % is already on an active contractor invoice', new.commission_record_id
      using errcode = 'unique_violation';
  end if;
  return new;
end $$;

drop trigger if exists contractor_invoice_line_item_no_double on public.contractor_invoice_line_items;
create trigger contractor_invoice_line_item_no_double
  before insert on public.contractor_invoice_line_items
  for each row execute function public.contractor_invoice_line_item_no_double();

-- ===========================================================================
-- 5. Reserved FK on commission_records (empty table → instant). Discarding an
--    invoice must never delete a commission ledger row: ON DELETE SET NULL.
-- ===========================================================================
alter table public.commission_records add column if not exists contractor_invoice_id uuid;

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'commission_records_contractor_invoice_fkey'
       and conrelid = 'public.commission_records'::regclass
  ) then
    alter table public.commission_records
      add constraint commission_records_contractor_invoice_fkey
      foreign key (contractor_invoice_id)
      references public.contractor_invoices (id) on delete set null;
  end if;
end $$;

-- ===========================================================================
-- 6. State-transition guard (draft→submitted · submitted→{approved,rejected} ·
--    approved→paid; paid/rejected terminal).
-- ===========================================================================
create or replace function public.contractor_invoices_state_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not (
    (old.state = 'draft'     and new.state = 'submitted') or
    (old.state = 'submitted' and new.state in ('approved', 'rejected')) or
    (old.state = 'approved'  and new.state = 'paid')
  ) then
    raise exception 'Invalid contractor-invoice state transition % → % (invoice %)',
      old.state, new.state, old.invoice_number;
  end if;
  return new;
end $$;

drop trigger if exists contractor_invoices_state_guard on public.contractor_invoices;
create trigger contractor_invoices_state_guard before update on public.contractor_invoices
  for each row when (old.state is distinct from new.state)
  execute function public.contractor_invoices_state_guard();

-- ===========================================================================
-- 7. RLS — owner full; contractor reads OWN rows. Writes are RPC-only (DEFINER),
--    so DML is revoked from authenticated and only SELECT granted.
-- ===========================================================================
alter table public.contractor_invoices           enable row level security;
alter table public.contractor_invoice_line_items enable row level security;

drop policy if exists contractor_invoices_owner_all          on public.contractor_invoices;
drop policy if exists contractor_invoices_contractor_read_own on public.contractor_invoices;
create policy contractor_invoices_owner_all on public.contractor_invoices
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy contractor_invoices_contractor_read_own on public.contractor_invoices
  for select to authenticated using (contractor_id = (select auth.uid()));

drop policy if exists contractor_invoice_line_items_owner_all          on public.contractor_invoice_line_items;
drop policy if exists contractor_invoice_line_items_contractor_read_own on public.contractor_invoice_line_items;
create policy contractor_invoice_line_items_owner_all on public.contractor_invoice_line_items
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy contractor_invoice_line_items_contractor_read_own on public.contractor_invoice_line_items
  for select to authenticated using (
    exists (
      select 1 from public.contractor_invoices ci
       where ci.id = invoice_id and ci.contractor_id = (select auth.uid())
    )
  );

revoke all on public.contractor_invoices           from anon, authenticated;
revoke all on public.contractor_invoice_line_items from anon, authenticated;
grant select on public.contractor_invoices           to authenticated;
grant select on public.contractor_invoice_line_items to authenticated;

-- ===========================================================================
-- 8. Private activity-log writer (contractor_invoices has no A10 trigger).
-- ===========================================================================
create or replace function public.log_contractor_invoice_activity(
  p_event public.activity_event_type, p_invoice_id uuid, p_contractor_id uuid, p_desc text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_email text; v_role text;
begin
  if v_uid is not null then
    select p.email, p.role into v_email, v_role from public.profiles p where p.id = v_uid;
  end if;
  insert into public.activity_logs
    (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id, description, related_entity_ids)
  values (now(), v_uid, v_email, v_role, p_event, 'contractor_invoice', p_invoice_id, p_desc,
          jsonb_build_array(p_contractor_id));
end $$;

-- Shared active-contractor gate for the write RPCs.
create or replace function public.assert_active_contractor()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_ok boolean;
begin
  select (role = 'contractor'::public.user_role and is_active) into v_ok
    from public.profiles where id = v_uid;
  if not coalesce(v_ok, false) then
    raise exception 'Only an active contractor can perform this action';
  end if;
  return v_uid;
end $$;

-- ===========================================================================
-- 8b. contractor_invoiceable_commissions — the SINGLE source of truth for "which
--    of a contractor''s commissions are invoiceable in this window". Used by BOTH
--    the eligibility guard and the line-item insert in the generate RPC, so the
--    two can never desync (a future edit to one copy but not the other could burn
--    a CI number on an empty invoice, or invoice commissions the gate didn''t
--    sanction). Internal — the generate RPC holds the per-contractor advisory
--    lock; execute is revoked from every API role.
-- ===========================================================================
create or replace function public.contractor_invoiceable_commissions(
  p_contractor_id uuid, p_start date, p_end date
) returns table (commission_record_id uuid, deal_id uuid, amount numeric(14,2))
 language sql stable security definer set search_path = '' as $$
  select cr.id, cr.deal_id, cr.contractor_share
    from public.commission_records cr
   where cr.contractor_id = p_contractor_id
     and cr.deal_funder_submission_id is null
     and cr.attribution_type = 'FNC_Contractor'
     and cr.contractor_share > 0
     and cr.status = 'payable'
     and coalesce(cr.payable_at, cr.earned_at, cr.created_at)::date between p_start and p_end
     and not exists (
       select 1 from public.contractor_invoice_line_items li
       join public.contractor_invoices ci on ci.id = li.invoice_id
        where li.commission_record_id = cr.id and ci.state <> 'rejected');
$$;

-- ===========================================================================
-- 9. contractor_generate_invoice — draft from the caller''s PAYABLE contractor
--    tier commissions in [start, end]. Advisory-locked per contractor; consumes
--    a CI number only when at least one commission is eligible.
-- ===========================================================================
create or replace function public.contractor_generate_invoice(
  p_period_start date, p_period_end date
) returns jsonb
 language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := public.assert_active_contractor();
  v_number text; v_inv uuid; v_total numeric(14,2); v_count int;
begin
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Invalid invoice period (start=%, end=%)', p_period_start, p_period_end;
  end if;

  perform pg_advisory_xact_lock(hashtext('contractor_invoice_gen:' || v_uid::text));

  if not exists (
    select 1 from public.contractor_invoiceable_commissions(v_uid, p_period_start, p_period_end)
  ) then
    return jsonb_build_object('was_created', false, 'reason', 'no_eligible_commissions', 'count', 0);
  end if;

  v_number := 'CI-' || lpad(nextval('public.contractor_invoices_seq')::text, 4, '0');

  insert into public.contractor_invoices
    (contractor_id, invoice_number, invoice_period_start, invoice_period_end, total_amount, created_by)
  values
    (v_uid, v_number, p_period_start, p_period_end, 0, v_uid)
  returning id into v_inv;

  insert into public.contractor_invoice_line_items (invoice_id, commission_record_id, deal_id, amount)
  select v_inv, e.commission_record_id, e.deal_id, e.amount
    from public.contractor_invoiceable_commissions(v_uid, p_period_start, p_period_end) e;

  update public.contractor_invoices
     set total_amount = (select coalesce(sum(amount), 0)
                           from public.contractor_invoice_line_items where invoice_id = v_inv)
   where id = v_inv
   returning total_amount into v_total;
  select count(*) into v_count from public.contractor_invoice_line_items where invoice_id = v_inv;

  perform public.log_contractor_invoice_activity('INVOICE', v_inv, v_uid,
    'Contractor invoice ' || v_number || ' generated — ' || v_count || ' item(s), R' ||
    trim(to_char(v_total, 'FM999G999G990D00')));

  return jsonb_build_object('was_created', true, 'invoice_id', v_inv, 'invoice_number', v_number,
                            'total_amount', v_total, 'count', v_count);
end $function$;

-- ===========================================================================
-- 10. contractor_submit_invoice — draft -> submitted; notify the owner.
-- ===========================================================================
create or replace function public.contractor_submit_invoice(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := public.assert_active_contractor(); v_inv public.contractor_invoices; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('contractor_invoice_state:' || p_invoice_id::text));

  select * into v_inv from public.contractor_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'Invoice % not found', p_invoice_id; end if;
  if v_inv.contractor_id is distinct from v_uid then raise exception 'This invoice does not belong to you'; end if;
  if v_inv.state = 'submitted' then
    return jsonb_build_object('invoice_id', v_inv.id, 'state', 'submitted', 'changed', false);
  end if;
  if v_inv.state <> 'draft' then
    raise exception 'Only a draft invoice can be submitted (invoice % is %)', v_inv.invoice_number, v_inv.state;
  end if;
  if not exists (select 1 from public.contractor_invoice_line_items where invoice_id = p_invoice_id) then
    raise exception 'Cannot submit an empty invoice (invoice %)', v_inv.invoice_number;
  end if;

  update public.contractor_invoices set state = 'submitted', submitted_at = now()
   where id = p_invoice_id and state = 'draft' returning id into v_id;
  if v_id is null then raise exception 'Invoice % was not submitted (no row written)', p_invoice_id; end if;

  perform public.emit_in_app_notification(
    public.notify_owner(), 'CONTRACTOR_INVOICE_SUBMITTED', 'Contractor invoice submitted',
    'A contractor submitted invoice ' || v_inv.invoice_number ||
    ' — R' || trim(to_char(v_inv.total_amount, 'FM999G999G990D00')) || ' for approval.',
    '/invoices/contractor-approvals',
    jsonb_build_object('contractor_invoice_id', v_inv.id, 'contractor_id', v_uid));
  perform public.log_contractor_invoice_activity('INVOICE', v_inv.id, v_uid,
    'Contractor invoice ' || v_inv.invoice_number || ' submitted for approval');

  return jsonb_build_object('invoice_id', v_inv.id, 'invoice_number', v_inv.invoice_number,
                            'state', 'submitted', 'changed', true);
end $function$;

-- ===========================================================================
-- 11. contractor_remove_line_item — edit a DRAFT (remove a line, recompute).
-- ===========================================================================
create or replace function public.contractor_remove_line_item(p_line_item_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := public.assert_active_contractor(); v_inv_id uuid; v_state public.contractor_invoice_state; v_total numeric(14,2); v_id uuid;
begin
  select li.invoice_id into v_inv_id
    from public.contractor_invoice_line_items li
    join public.contractor_invoices ci on ci.id = li.invoice_id
   where li.id = p_line_item_id and ci.contractor_id = v_uid;
  if v_inv_id is null then raise exception 'Line item % not found for you', p_line_item_id; end if;

  perform pg_advisory_xact_lock(hashtext('contractor_invoice_state:' || v_inv_id::text));
  select state into v_state from public.contractor_invoices where id = v_inv_id;
  if v_state <> 'draft' then raise exception 'Only a draft invoice can be edited (invoice is %)', v_state; end if;

  delete from public.contractor_invoice_line_items where id = p_line_item_id returning id into v_id;
  if v_id is null then raise exception 'Line item % was not removed (no row deleted)', p_line_item_id; end if;

  update public.contractor_invoices
     set total_amount = (select coalesce(sum(amount), 0)
                           from public.contractor_invoice_line_items where invoice_id = v_inv_id)
   where id = v_inv_id
   returning total_amount into v_total;

  return jsonb_build_object('invoice_id', v_inv_id, 'removed_line_item_id', p_line_item_id, 'total_amount', v_total);
end $function$;

-- ===========================================================================
-- 12. owner_approve_contractor_invoice — submitted -> approved; notify contractor.
-- ===========================================================================
create or replace function public.owner_approve_contractor_invoice(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_inv public.contractor_invoices; v_id uuid;
begin
  if not public.is_owner() then raise exception 'Only the owner can approve contractor invoices'; end if;
  perform pg_advisory_xact_lock(hashtext('contractor_invoice_state:' || p_invoice_id::text));

  select * into v_inv from public.contractor_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'Invoice % not found', p_invoice_id; end if;
  if v_inv.state = 'approved' then
    return jsonb_build_object('invoice_id', v_inv.id, 'state', 'approved', 'changed', false);
  end if;
  if v_inv.state <> 'submitted' then
    raise exception 'Only a submitted invoice can be approved (invoice % is %)', v_inv.invoice_number, v_inv.state;
  end if;

  update public.contractor_invoices set state = 'approved', approved_at = now(), approved_by = (select auth.uid())
   where id = p_invoice_id and state = 'submitted' returning id into v_id;
  if v_id is null then raise exception 'Invoice % was not approved (no row written)', p_invoice_id; end if;

  perform public.emit_in_app_notification(
    v_inv.contractor_id, 'CONTRACTOR_INVOICE_APPROVED', 'Invoice approved',
    'Your invoice ' || v_inv.invoice_number || ' — R' || trim(to_char(v_inv.total_amount, 'FM999G999G990D00')) ||
    ' — has been approved and is awaiting payment.',
    '/contractor/invoices', jsonb_build_object('contractor_invoice_id', v_inv.id));
  perform public.log_contractor_invoice_activity('INVOICE', v_inv.id, v_inv.contractor_id,
    'Contractor invoice ' || v_inv.invoice_number || ' approved');

  return jsonb_build_object('invoice_id', v_inv.id, 'state', 'approved', 'changed', true);
end $function$;

-- ===========================================================================
-- 13. owner_reject_contractor_invoice — submitted -> rejected (reason required);
--     notify contractor. Rejecting frees the commissions for re-invoicing.
-- ===========================================================================
create or replace function public.owner_reject_contractor_invoice(p_invoice_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_inv public.contractor_invoices; v_id uuid;
begin
  if not public.is_owner() then raise exception 'Only the owner can reject contractor invoices'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'A rejection reason is required'; end if;
  perform pg_advisory_xact_lock(hashtext('contractor_invoice_state:' || p_invoice_id::text));

  select * into v_inv from public.contractor_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'Invoice % not found', p_invoice_id; end if;
  if v_inv.state = 'rejected' then
    return jsonb_build_object('invoice_id', v_inv.id, 'state', 'rejected', 'changed', false);
  end if;
  if v_inv.state <> 'submitted' then
    raise exception 'Only a submitted invoice can be rejected (invoice % is %)', v_inv.invoice_number, v_inv.state;
  end if;

  update public.contractor_invoices set state = 'rejected', rejected_at = now(), rejected_reason = btrim(p_reason)
   where id = p_invoice_id and state = 'submitted' returning id into v_id;
  if v_id is null then raise exception 'Invoice % was not rejected (no row written)', p_invoice_id; end if;

  perform public.emit_in_app_notification(
    v_inv.contractor_id, 'CONTRACTOR_INVOICE_REJECTED', 'Invoice needs changes',
    'Your invoice ' || v_inv.invoice_number || ' was not approved. Reason: ' || btrim(p_reason) ||
    '. You can generate a new invoice for those commissions.',
    '/contractor/invoices', jsonb_build_object('contractor_invoice_id', v_inv.id));
  perform public.log_contractor_invoice_activity('INVOICE', v_inv.id, v_inv.contractor_id,
    'Contractor invoice ' || v_inv.invoice_number || ' rejected: ' || btrim(p_reason));

  return jsonb_build_object('invoice_id', v_inv.id, 'state', 'rejected', 'changed', true);
end $function$;

-- ===========================================================================
-- 14. list_contractor_invoice_line_items — enriched read (owner OR the owning
--     contractor). Contractor tier rows carry no funder submission, so no funder
--     name is shown; amount is the contractor take only.
-- ===========================================================================
create or replace function public.list_contractor_invoice_line_items(p_invoice_id uuid)
returns table (
  line_item_id uuid, deal_id uuid, deal_reference text,
  client_business_name text, amount numeric, added_at timestamptz
) language plpgsql stable security definer set search_path = '' as $function$
declare v_uid uuid := (select auth.uid());
begin
  if not public.is_owner() then
    if not exists (
      select 1 from public.contractor_invoices ci
       where ci.id = p_invoice_id and ci.contractor_id = v_uid
    ) then
      raise exception 'Not authorised to view this invoice';
    end if;
  end if;

  return query
    select li.id, li.deal_id, d.reference, c.business_name, li.amount, li.added_at
      from public.contractor_invoice_line_items li
      join public.deals d          on d.id = li.deal_id
      left join public.clients c   on c.id = d.client_id
     where li.invoice_id = p_invoice_id
     order by li.added_at;
end $function$;

-- ===========================================================================
-- 15. Grants matrix (body guards are the real gate). Contractor/owner RPCs →
--     authenticated; internal writers → no API role.
-- ===========================================================================
revoke all on function public.contractor_generate_invoice(date, date)     from public, anon;
grant  execute on function public.contractor_generate_invoice(date, date)   to authenticated;
revoke all on function public.contractor_submit_invoice(uuid)              from public, anon;
grant  execute on function public.contractor_submit_invoice(uuid)           to authenticated;
revoke all on function public.contractor_remove_line_item(uuid)            from public, anon;
grant  execute on function public.contractor_remove_line_item(uuid)         to authenticated;
revoke all on function public.owner_approve_contractor_invoice(uuid)       from public, anon;
grant  execute on function public.owner_approve_contractor_invoice(uuid)     to authenticated;
revoke all on function public.owner_reject_contractor_invoice(uuid, text)  from public, anon;
grant  execute on function public.owner_reject_contractor_invoice(uuid, text) to authenticated;
revoke all on function public.list_contractor_invoice_line_items(uuid)     from public, anon;
grant  execute on function public.list_contractor_invoice_line_items(uuid)   to authenticated;
revoke all on function public.assert_active_contractor()                   from public, anon;
grant  execute on function public.assert_active_contractor()                to authenticated;
-- Internal only.
revoke all on function public.log_contractor_invoice_activity(public.activity_event_type, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.contractor_invoiceable_commissions(uuid, date, date)
  from public, anon, authenticated;

-- ===========================================================================
-- 16. Notification preferences — seed the contractor-invoice events ON for every
--     profile (in-app + email). Never overwrites an existing opt-out.
-- ===========================================================================
insert into public.notification_preferences (user_id, event_type, in_app_enabled, email_enabled)
select p.id, ev.evt, true, true
  from public.profiles p
  cross join (values
    ('CONTRACTOR_INVOICE_SUBMITTED'::public.notification_event_type),
    ('CONTRACTOR_INVOICE_APPROVED'::public.notification_event_type),
    ('CONTRACTOR_INVOICE_REJECTED'::public.notification_event_type),
    ('CONTRACTOR_INVOICE_PAID'::public.notification_event_type)
  ) as ev(evt)
on conflict (user_id, event_type) do nothing;

-- ===========================================================================
-- 17. Assertions. Structural always; a direct-insert behavioural block exercises
--     the no-double trigger, state guard, and CHECKs (the full generate→approve
--     lifecycle needs a payable contractor commission + auth context, verified at
--     the post-merge smoke test). All synthetic rows roll back.
-- ===========================================================================
do $$
declare
  v_owner uuid; v_contractor uuid; v_inv uuid; v_state text; v_fn text;
begin
  -- (a) enum values exactly right.
  if (select array_agg(enumlabel::text order by enumsortorder)
        from pg_enum where enumtypid = 'public.contractor_invoice_state'::regtype)
     is distinct from array['draft','submitted','approved','paid','rejected'] then
    raise exception 'Build 8.1 assert FAIL: contractor_invoice_state enum values wrong';
  end if;

  -- (b) tables + sequence + reserved FK + triggers + RLS present.
  if to_regclass('public.contractor_invoices') is null then raise exception 'assert FAIL: contractor_invoices missing'; end if;
  if to_regclass('public.contractor_invoice_line_items') is null then raise exception 'assert FAIL: line_items missing'; end if;
  if to_regclass('public.contractor_invoices_seq') is null then raise exception 'assert FAIL: sequence missing'; end if;
  if not exists (select 1 from pg_constraint where conname='commission_records_contractor_invoice_fkey'
      and conrelid='public.commission_records'::regclass) then
    raise exception 'assert FAIL: reserved commission_records.contractor_invoice_id FK not added'; end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.contractor_invoices'::regclass and tgname='contractor_invoices_state_guard') then
    raise exception 'assert FAIL: state guard trigger missing'; end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.contractor_invoice_line_items'::regclass and tgname='contractor_invoice_line_item_no_double') then
    raise exception 'assert FAIL: no-double trigger missing'; end if;

  -- (c) grants: authenticated SELECT only (no INSERT), anon nothing; RPC grants.
  if has_table_privilege('authenticated','public.contractor_invoices','insert') then
    raise exception 'assert FAIL: authenticated can INSERT contractor_invoices (should be RPC-only)'; end if;
  if has_table_privilege('anon','public.contractor_invoices','select') then
    raise exception 'assert FAIL: anon can SELECT contractor_invoices'; end if;
  foreach v_fn in array array[
    'contractor_invoiceable_commissions','contractor_generate_invoice','contractor_submit_invoice',
    'contractor_remove_line_item','owner_approve_contractor_invoice','owner_reject_contractor_invoice',
    'list_contractor_invoice_line_items'
  ] loop
    if not exists (select 1 from pg_proc pr join pg_namespace n on n.oid=pr.pronamespace
                    where n.nspname='public' and pr.proname=v_fn) then
      raise exception 'assert FAIL: function public.% missing', v_fn;
    end if;
  end loop;
  if has_function_privilege('authenticated',
       'public.log_contractor_invoice_activity(public.activity_event_type,uuid,uuid,text)','execute') then
    raise exception 'assert FAIL: authenticated can execute the internal log writer';
  end if;
  if has_function_privilege('authenticated',
       'public.contractor_invoiceable_commissions(uuid,date,date)','execute') then
    raise exception 'assert FAIL: authenticated can execute the internal eligibility helper';
  end if;

  -- ---- Direct-insert behavioural (synthetic, rolled back) ----
  -- Deliberately touches ONLY contractor_invoices (no commission_records / deals),
  -- so it never depends on the tier-engine row shape. The no-double trigger is
  -- asserted structurally above; its behaviour is covered at the smoke test with a
  -- real payable contractor commission (there are 0 live today).
  begin
    select id into v_owner      from public.profiles where role='owner' limit 1;
    select id into v_contractor from public.profiles where role='contractor' limit 1;
    if v_owner is null or v_contractor is null then
      raise notice 'Build 8.1: missing owner/contractor — direct-insert asserts skipped';
      raise exception 'ROLLBACK_TEST_DATA';
    end if;

    insert into public.contractor_invoices (contractor_id, invoice_number, invoice_period_start, invoice_period_end)
      values (v_contractor, 'CI-TEST-1', current_date - 30, current_date) returning id into v_inv;

    -- state guard: illegal draft -> paid.
    begin
      update public.contractor_invoices set state='paid' where id=v_inv;
      raise exception 'Build 8.1 assert FAIL: state guard allowed draft->paid';
    exception when others then
      if sqlerrm not ilike '%Invalid contractor-invoice state transition%' then raise; end if;
    end;

    -- legal draft -> submitted -> approved.
    update public.contractor_invoices set state='submitted', submitted_at=now() where id=v_inv;
    update public.contractor_invoices set state='approved', approved_at=now(), approved_by=v_owner where id=v_inv;
    select state into v_state from public.contractor_invoices where id=v_inv;
    if v_state <> 'approved' then raise exception 'Build 8.1 assert FAIL: lifecycle did not reach approved (%)', v_state; end if;

    -- paid-needs-reference CHECK.
    begin
      insert into public.contractor_invoices (contractor_id, invoice_number, invoice_period_start, invoice_period_end, state, paid_at)
        values (v_contractor, 'CI-TEST-3', current_date-30, current_date, 'paid', now());
      raise exception 'Build 8.1 assert FAIL: paid without reference accepted';
    exception when check_violation then null; end;

    raise notice 'Build 8.1 direct-insert behavioural assertions passed (state guard, checks).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;

  raise notice 'Build 8.1 assertions passed: schema + reserved FK + triggers + RLS + grants.';
end $$;

notify pgrst, 'reload schema';
