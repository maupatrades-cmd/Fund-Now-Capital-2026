-- A10 — Activity Logging foundation (SPEC.md S5).
--
-- A single general-purpose audit layer above the existing deal_stage_history
-- table. DB triggers write CREATE/UPDATE/DELETE (and the domain-specific
-- STAGE_CHANGE / SUBMISSION) entries for the core money-adjacent entities.
--
-- NOTE (deviation from S5, documented in SPEC.md): the timestamp column is named
-- `occurred_at`, not `timestamp` — `timestamp` is a reserved type keyword and a
-- bare column of that name would need quoting everywhere. Same semantics
-- (timestamptz, UTC).

-- ---------------------------------------------------------------------------
-- Event type enum (full S5 list; auth/READ/EXPORT/etc. are written by the app
-- layer later — the DB triggers here only emit the data-change events).
-- ---------------------------------------------------------------------------
create type public.activity_event_type as enum (
  'CREATE', 'UPDATE', 'DELETE', 'READ', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED',
  'STAGE_CHANGE', 'QUALIFICATION', 'COMMISSION_CALC', 'SUBMISSION', 'INVOICE',
  'PAYMENT', 'NOTIFICATION_SENT', 'PERMISSION_CHANGE', 'EXPORT'
);

-- ---------------------------------------------------------------------------
-- activity_logs
-- ---------------------------------------------------------------------------
create table public.activity_logs (
  id                 uuid primary key default gen_random_uuid(),
  occurred_at        timestamptz not null default now(),   -- S5 "timestamp"
  user_id            uuid references public.profiles(id) on delete set null,  -- null = system
  user_email         text,                                 -- denormalised actor email
  user_role          text,
  ip_address         text,                                 -- app-layer only (auth events)
  user_agent         text,                                 -- app-layer only
  event_type         public.activity_event_type not null,
  entity_type        text not null,
  entity_id          uuid,
  description        text,
  changed_fields     jsonb,
  before_values      jsonb,
  after_values       jsonb,
  session_id         text,
  related_entity_ids jsonb,
  notes              text
);

create index idx_activity_occurred on public.activity_logs (occurred_at desc);
create index idx_activity_user     on public.activity_logs (user_id, occurred_at desc);
create index idx_activity_entity   on public.activity_logs (entity_type, entity_id, occurred_at desc);
create index idx_activity_event    on public.activity_logs (event_type, occurred_at desc);

comment on table public.activity_logs is
  'General audit trail (S5). Owner-only reads. Written by SECURITY DEFINER triggers; the general layer above deal_stage_history.';

-- Owner-only reads. No insert/update/delete policy exists, so the audit trail
-- is only ever written by the SECURITY DEFINER trigger below and can never be
-- edited or deleted through the API — even by the owner.
alter table public.activity_logs enable row level security;

create policy "activity_logs_owner_read" on public.activity_logs
  for select to authenticated
  using (public.is_owner());

-- ---------------------------------------------------------------------------
-- Generic logging trigger. AFTER row trigger so it never blocks the write; the
-- insert is a single lightweight row. SECURITY DEFINER so the audit row is
-- written regardless of the caller's RLS (an audit trail, not user data).
--
-- (A true fire-and-forget queue — pg_net / pgmq — is deferred; the AFTER-row
-- insert is sub-millisecond and effectively non-blocking. Documented in SPEC.)
-- ---------------------------------------------------------------------------
create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_email   text;
  v_role    text;
  v_event   public.activity_event_type;
  v_etype   text;
  v_eid     uuid;
  v_verb    text := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  v_desc    text;
  v_changed jsonb;
  v_before  jsonb;
  v_after   jsonb;
  v_related jsonb;
  ov        jsonb;
  nv        jsonb;
begin
  -- Actor identity (best-effort; null user_id = system / no session).
  if v_uid is not null then
    select p.email, p.role into v_email, v_role from public.profiles p where p.id = v_uid;
  end if;

  -- Row snapshots + entity id.
  if tg_op = 'DELETE' then
    ov := to_jsonb(old); nv := null;
    v_eid := (ov->>'id')::uuid;
  elsif tg_op = 'INSERT' then
    ov := null; nv := to_jsonb(new);
    v_eid := (nv->>'id')::uuid;
  else
    ov := to_jsonb(old); nv := to_jsonb(new);
    v_eid := (nv->>'id')::uuid;
  end if;

  -- Field-level diff on UPDATE (ignore bookkeeping columns).
  if tg_op = 'UPDATE' then
    select jsonb_agg(k), jsonb_object_agg(k, ov->k), jsonb_object_agg(k, nv->k)
      into v_changed, v_before, v_after
    from jsonb_object_keys(nv) as k
    where (nv->k) is distinct from (ov->k)
      and k not in ('updated_at');
  end if;

  v_event := case tg_op when 'INSERT' then 'CREATE' when 'UPDATE' then 'UPDATE' else 'DELETE' end::public.activity_event_type;

  -- Per-entity type, description, related ids, and domain event overrides.
  if tg_table_name = 'deals' then
    v_etype := 'deal';
    v_related := jsonb_build_array(coalesce(nv->>'client_id', ov->>'client_id'));
    if tg_op = 'UPDATE' and (nv->>'stage') is distinct from (ov->>'stage') then
      v_event := 'STAGE_CHANGE';
      v_desc := 'Deal ' || coalesce(nv->>'reference', '?') || ' moved ' ||
                coalesce(ov->>'stage', '?') || ' → ' || coalesce(nv->>'stage', '?');
    else
      v_desc := 'Deal ' || coalesce(nv->>'reference', ov->>'reference', '?') || ' ' || v_verb;
    end if;

  elsif tg_table_name = 'deal_funder_submissions' then
    v_etype := 'deal_funder_submission';
    v_event := 'SUBMISSION';
    v_related := jsonb_build_array(coalesce(nv->>'deal_id', ov->>'deal_id'));
    if tg_op = 'UPDATE' and (nv->>'status') is distinct from (ov->>'status') then
      v_desc := 'Funder submission status → ' || coalesce(nv->>'status', '?');
    elsif tg_op = 'INSERT' then
      v_desc := 'Funder submission added';
    elsif tg_op = 'DELETE' then
      v_desc := 'Funder submission removed';
    else
      v_desc := 'Funder submission updated';
    end if;

  elsif tg_table_name = 'clients' then
    v_etype := 'client';
    v_desc := 'Client ' || coalesce(nv->>'business_name', ov->>'business_name', '?') || ' ' || v_verb;

  elsif tg_table_name = 'client_contacts' then
    v_etype := 'client_contact';
    v_related := jsonb_build_array(coalesce(nv->>'client_id', ov->>'client_id'));
    v_desc := 'Contact ' || coalesce(nv->>'full_name', ov->>'full_name', '?') || ' ' || v_verb;

  elsif tg_table_name = 'commission_records' then
    v_etype := 'commission_record';
    v_related := jsonb_build_array(coalesce(nv->>'deal_id', ov->>'deal_id'));
    v_desc := 'Commission record ' || v_verb;

  else
    v_etype := tg_table_name;
    v_desc := v_etype || ' ' || v_verb;
  end if;

  insert into public.activity_logs (
    occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id,
    description, changed_fields, before_values, after_values, related_entity_ids
  ) values (
    now(), v_uid, v_email, v_role, v_event, v_etype, v_eid,
    v_desc, v_changed, v_before, v_after, v_related
  );

  return null;
end;
$$;

-- The audit writer is system-internal; no role calls it directly.
revoke execute on function public.log_activity() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Attach to the core entities. (leads gets the same trigger in Phase B, when
-- the table exists.)
-- ---------------------------------------------------------------------------
create trigger log_activity_deals
  after insert or update or delete on public.deals
  for each row execute function public.log_activity();

create trigger log_activity_submissions
  after insert or update or delete on public.deal_funder_submissions
  for each row execute function public.log_activity();

create trigger log_activity_clients
  after insert or update or delete on public.clients
  for each row execute function public.log_activity();

create trigger log_activity_client_contacts
  after insert or update or delete on public.client_contacts
  for each row execute function public.log_activity();

create trigger log_activity_commission_records
  after insert or update or delete on public.commission_records
  for each row execute function public.log_activity();
