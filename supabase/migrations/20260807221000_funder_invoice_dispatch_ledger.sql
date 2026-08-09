-- Build 4: append-only funder-invoice dispatch ledger.
-- The email transport is added separately; this migration supplies the
-- auditable queue/result contract it must use.

create table public.funder_invoice_dispatches (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.funder_invoices(id) on delete restrict,
  retry_of uuid references public.funder_invoice_dispatches(id) on delete restrict,
  attempt_number integer not null,
  invoice_version integer not null default 1,
  invoice_number_snapshot text not null,
  invoice_total_snapshot numeric(14,2) not null,
  pdf_storage_path_snapshot text not null,
  recipient_email text not null,
  recipient_name text,
  channel text not null default 'email',
  status text not null default 'queued',
  provider_message_id text,
  failure_code text,
  failure_message text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  constraint funder_invoice_dispatch_attempt_positive check (attempt_number > 0),
  constraint funder_invoice_dispatch_version_positive check (invoice_version > 0),
  constraint funder_invoice_dispatch_total_nonnegative check (invoice_total_snapshot >= 0),
  constraint funder_invoice_dispatch_channel_check check (channel in ('email')),
  constraint funder_invoice_dispatch_status_check
    check (status in ('queued', 'sent', 'delivered', 'failed', 'bounced')),
  constraint funder_invoice_dispatch_recipient_check
    check (recipient_email = lower(btrim(recipient_email)) and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  constraint funder_invoice_dispatch_retry_check check (retry_of is null or retry_of <> id),
  constraint funder_invoice_dispatch_status_timestamp_check check (
    (status = 'queued' and sent_at is null and delivered_at is null and failed_at is null)
    or (status = 'sent' and sent_at is not null and delivered_at is null and failed_at is null)
    or (status = 'delivered' and sent_at is not null and delivered_at is not null and failed_at is null)
    or (status in ('failed', 'bounced') and failed_at is not null and delivered_at is null)
  ),
  constraint funder_invoice_dispatch_failure_detail_check check (
    (status not in ('failed', 'bounced')) or nullif(btrim(failure_message), '') is not null
  ),
  unique (invoice_id, attempt_number)
);

comment on table public.funder_invoice_dispatches is
  'Append-only owner audit of FNC funder-invoice email attempts. Identity and invoice snapshots are immutable; retries link to the prior attempt.';

create index funder_invoice_dispatches_invoice_idx
  on public.funder_invoice_dispatches(invoice_id, attempt_number desc);
create index funder_invoice_dispatches_retry_idx
  on public.funder_invoice_dispatches(retry_of) where retry_of is not null;
create index funder_invoice_dispatches_pending_idx
  on public.funder_invoice_dispatches(status, queued_at)
  where status in ('queued', 'sent');
create unique index funder_invoice_dispatches_provider_message_uq
  on public.funder_invoice_dispatches(provider_message_id)
  where provider_message_id is not null;
create unique index funder_invoice_dispatches_one_active_recipient_uq
  on public.funder_invoice_dispatches(invoice_id, recipient_email)
  where status in ('queued', 'sent');

alter table public.funder_invoice_dispatches enable row level security;

create policy funder_invoice_dispatches_owner_read
  on public.funder_invoice_dispatches
  for select to authenticated
  using (public.is_owner());

-- Direct API writes are intentionally absent. All owner writes enter through
-- queue_funder_invoice_dispatch; delivery updates enter through the service
-- result RPC below.
revoke all on table public.funder_invoice_dispatches from public, anon, authenticated;
grant select on table public.funder_invoice_dispatches to authenticated;

create or replace function public.funder_invoice_dispatches_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Invoice dispatch evidence cannot be deleted';
  end if;

  if current_setting('fnc.allow_dispatch_result_update', true) is distinct from 'on' then
    raise exception 'Invoice dispatch evidence can only be updated by the delivery result function';
  end if;

  if row(
    new.id, new.invoice_id, new.retry_of, new.attempt_number,
    new.invoice_version, new.invoice_number_snapshot,
    new.invoice_total_snapshot, new.pdf_storage_path_snapshot,
    new.recipient_email, new.recipient_name, new.channel,
    new.queued_at, new.created_by
  ) is distinct from row(
    old.id, old.invoice_id, old.retry_of, old.attempt_number,
    old.invoice_version, old.invoice_number_snapshot,
    old.invoice_total_snapshot, old.pdf_storage_path_snapshot,
    old.recipient_email, old.recipient_name, old.channel,
    old.queued_at, old.created_by
  ) then
    raise exception 'Invoice dispatch identity and snapshots are immutable';
  end if;

  return new;
end;
$$;

create trigger funder_invoice_dispatches_immutable
before update or delete on public.funder_invoice_dispatches
for each row execute function public.funder_invoice_dispatches_immutable();

create or replace function public.queue_funder_invoice_dispatch(
  p_invoice_id uuid,
  p_recipient_email text,
  p_recipient_name text default null,
  p_retry_of uuid default null
)
returns public.funder_invoice_dispatches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.funder_invoices;
  v_retry public.funder_invoice_dispatches;
  v_attempt integer;
  v_result public.funder_invoice_dispatches;
  v_email text := lower(btrim(coalesce(p_recipient_email, '')));
  v_actor_email text;
  v_actor_role text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can queue a funder invoice dispatch';
  end if;

  perform pg_advisory_xact_lock(hashtext('funder_invoice_dispatch:' || p_invoice_id::text));

  select * into v_invoice
  from public.funder_invoices
  where id = p_invoice_id;

  if v_invoice.id is null then
    raise exception 'Invoice % not found', p_invoice_id;
  end if;
  if v_invoice.state not in ('issued', 'overdue') then
    raise exception 'Only issued or overdue invoices can be dispatched (current state: %)', v_invoice.state;
  end if;
  if nullif(btrim(v_invoice.pdf_storage_path), '') is null then
    raise exception 'Invoice PDF is not ready yet';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'A valid recipient email is required';
  end if;

  if p_retry_of is not null then
    select * into v_retry
    from public.funder_invoice_dispatches
    where id = p_retry_of;

    if v_retry.id is null or v_retry.invoice_id <> p_invoice_id then
      raise exception 'Retry source must belong to this invoice';
    end if;
    if v_retry.status not in ('failed', 'bounced') then
      raise exception 'Only failed or bounced attempts can be retried';
    end if;
  end if;

  select coalesce(max(d.attempt_number), 0) + 1 into v_attempt
  from public.funder_invoice_dispatches d
  where d.invoice_id = p_invoice_id;

  insert into public.funder_invoice_dispatches (
    invoice_id, retry_of, attempt_number, invoice_version,
    invoice_number_snapshot, invoice_total_snapshot, pdf_storage_path_snapshot,
    recipient_email, recipient_name, created_by
  ) values (
    v_invoice.id, p_retry_of, v_attempt, 1,
    v_invoice.invoice_number, v_invoice.total_amount, v_invoice.pdf_storage_path,
    v_email, nullif(btrim(p_recipient_name), ''), auth.uid()
  ) returning * into v_result;

  select p.email, p.role::text into v_actor_email, v_actor_role
  from public.profiles p where p.id = auth.uid();

  insert into public.activity_logs (
    user_id, user_email, user_role, event_type, entity_type, entity_id,
    description, changed_fields, after_values, related_entity_ids
  ) values (
    auth.uid(), v_actor_email, v_actor_role, 'INSERT',
    'funder_invoice_dispatch', v_result.id,
    'Queued funder invoice dispatch attempt ' || v_attempt::text,
    jsonb_build_array('status'),
    jsonb_build_object('status', 'queued', 'attempt_number', v_attempt, 'channel', 'email'),
    jsonb_build_object('invoice_id', v_invoice.id, 'deal_id', v_invoice.deal_id)
  );

  return v_result;
end;
$$;

create or replace function public.record_funder_invoice_dispatch_result(
  p_dispatch_id uuid,
  p_status text,
  p_provider_message_id text default null,
  p_failure_code text default null,
  p_failure_message text default null
)
returns public.funder_invoice_dispatches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch public.funder_invoice_dispatches;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_previous_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the delivery service can record dispatch results';
  end if;

  perform pg_advisory_xact_lock(hashtext('funder_invoice_dispatch_result:' || p_dispatch_id::text));

  select * into v_dispatch
  from public.funder_invoice_dispatches
  where id = p_dispatch_id;

  if v_dispatch.id is null then
    raise exception 'Invoice dispatch % not found', p_dispatch_id;
  end if;
  v_previous_status := v_dispatch.status;
  if v_status not in ('sent', 'delivered', 'failed', 'bounced') then
    raise exception 'Unsupported dispatch result status: %', v_status;
  end if;
  if v_dispatch.status in ('delivered', 'failed', 'bounced') then
    if v_dispatch.status = v_status then return v_dispatch; end if;
    raise exception 'Dispatch % is already terminal (%)', p_dispatch_id, v_dispatch.status;
  end if;
  if v_dispatch.status = 'queued' and v_status not in ('sent', 'failed') then
    raise exception 'A queued dispatch can only become sent or failed';
  end if;
  if v_dispatch.status = 'sent' and v_status not in ('delivered', 'failed', 'bounced') then
    raise exception 'A sent dispatch can only become delivered, failed, or bounced';
  end if;
  if v_status in ('failed', 'bounced') and nullif(btrim(p_failure_message), '') is null then
    raise exception 'Failure message is required for %', v_status;
  end if;

  perform set_config('fnc.allow_dispatch_result_update', 'on', true);

  update public.funder_invoice_dispatches
  set status = v_status,
      provider_message_id = coalesce(nullif(btrim(p_provider_message_id), ''), provider_message_id),
      failure_code = case when v_status in ('failed', 'bounced') then nullif(btrim(p_failure_code), '') else null end,
      failure_message = case when v_status in ('failed', 'bounced') then btrim(p_failure_message) else null end,
      sent_at = case when v_status in ('sent', 'delivered', 'bounced') then coalesce(sent_at, now()) else sent_at end,
      delivered_at = case when v_status = 'delivered' then now() else null end,
      failed_at = case when v_status in ('failed', 'bounced') then now() else null end
  where id = p_dispatch_id
  returning * into v_dispatch;

  insert into public.activity_logs (
    user_id, user_email, user_role, event_type, entity_type, entity_id,
    description, changed_fields, before_values, after_values, related_entity_ids
  ) values (
    null, null, 'service_role', 'UPDATE',
    'funder_invoice_dispatch', v_dispatch.id,
    'Funder invoice dispatch result recorded as ' || upper(v_status),
    jsonb_build_array('status'),
    jsonb_build_object('status', v_previous_status),
    jsonb_build_object('status', v_status),
    jsonb_build_object('invoice_id', v_dispatch.invoice_id)
  );

  return v_dispatch;
end;
$$;

revoke all on function public.queue_funder_invoice_dispatch(uuid, text, text, uuid)
  from public, anon;
grant execute on function public.queue_funder_invoice_dispatch(uuid, text, text, uuid)
  to authenticated;

revoke all on function public.record_funder_invoice_dispatch_result(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_funder_invoice_dispatch_result(uuid, text, text, text, text)
  to service_role;

revoke all on function public.funder_invoice_dispatches_immutable()
  from public, anon, authenticated;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.funder_invoice_dispatches'::regclass) then
    raise exception 'Dispatch ledger assertion failed: RLS is disabled';
  end if;
  if has_table_privilege('anon', 'public.funder_invoice_dispatches', 'select,insert,update,delete') then
    raise exception 'Dispatch ledger assertion failed: anon has table privileges';
  end if;
  if has_table_privilege('authenticated', 'public.funder_invoice_dispatches', 'insert,update,delete') then
    raise exception 'Dispatch ledger assertion failed: authenticated has direct write privileges';
  end if;
  if not has_table_privilege('authenticated', 'public.funder_invoice_dispatches', 'select') then
    raise exception 'Dispatch ledger assertion failed: authenticated cannot select through owner RLS';
  end if;
  if has_function_privilege('anon', 'public.queue_funder_invoice_dispatch(uuid,text,text,uuid)', 'execute') then
    raise exception 'Dispatch ledger assertion failed: anon can queue sends';
  end if;
  if not has_function_privilege('authenticated', 'public.queue_funder_invoice_dispatch(uuid,text,text,uuid)', 'execute') then
    raise exception 'Dispatch ledger assertion failed: authenticated cannot call owner queue RPC';
  end if;
  if has_function_privilege('authenticated', 'public.record_funder_invoice_dispatch_result(uuid,text,text,text,text)', 'execute') then
    raise exception 'Dispatch ledger assertion failed: authenticated can forge delivery results';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.funder_invoice_dispatches'::regclass
      and tgname = 'funder_invoice_dispatches_immutable'
      and not tgisinternal
  ) then
    raise exception 'Dispatch ledger assertion failed: immutability trigger missing';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'funder_invoice_dispatches'
      and indexname = 'funder_invoice_dispatches_provider_message_uq'
  ) then
    raise exception 'Dispatch ledger assertion failed: provider idempotency index missing';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'funder_invoice_dispatches'
      and indexname = 'funder_invoice_dispatches_one_active_recipient_uq'
  ) then
    raise exception 'Dispatch ledger assertion failed: active-send duplicate guard missing';
  end if;
end;
$$;

notify pgrst, 'reload schema';
