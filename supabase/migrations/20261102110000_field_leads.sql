-- Field leads (launch priority 3) (2/2). docs/FNC-LAUNCH-PLAN-2026-11-09.md section 2 item 3, section 6 (lead fees) and
-- section 8 (lead workflow). Field consultants and the Field Supervisor start on 4 November 2026.
--
-- A field lead is a prospect met in the field, before there is a client file. It reuses the existing CRM record:
-- the business is written to public.leads (as the New lead form does), and this migration adds only the field
-- workflow on top of it (who captured it, who owns it, where it is), its append-only history and the lead fees.
-- "Converted to client file" opens the normal submission file (public.submission_intakes) on the same lead, so the
-- Document tracker, Verified and the R100 work exactly as for any other file.
--
-- Workflow, one step at a time, every move logged with the person and their real role:
--   captured -> assigned | new_leads          Sales Coordinator (Administrator, Director)
--   new_leads -> assigned                     Sales Coordinator (Administrator, Director)
--   assigned | contacted -> assigned          Sales Coordinator (Administrator, Director): hand it to someone else
--   assigned -> contacted -> ready_for_sale   the person it is assigned to, or a Field Supervisor (Director)
--   ready_for_sale -> converted               Sales Coordinator (Administrator, Director), through staff_convert_field_lead
--   any open step -> dropped (with a reason)  Sales Coordinator (Administrator, Director), the assignee, a Field Supervisor
--
-- Lead fees (section 6): on Ready for sale, R150 to the field consultant who captured the lead and R100 to the Field
-- Supervisor, at most once each per lead. A line starts pending; the Sales Coordinator confirms it and the
-- Administrator approves it (the Director may do either). Lines carry the date they were earned; the payroll cycle
-- picks approved lines up one month in arrears in a later change. Each earner sees only their own rand amounts.

-- 1. Tables ---------------------------------------------------------------------------------------------------------
create table if not exists public.field_lead_tracks (
  lead_id         uuid primary key references public.leads(id) on delete restrict,
  captured_by     uuid not null references public.profiles(id) on delete restrict,
  captured_role   text not null check (captured_role in ('field_consultant', 'field_supervisor')),
  status          text not null default 'captured' check (status in
                    ('captured', 'new_leads', 'assigned', 'contacted', 'ready_for_sale', 'converted', 'dropped')),
  assigned_to     uuid references public.profiles(id) on delete restrict,
  area            text check (area is null or length(area) <= 120),
  note            text check (note is null or length(note) <= 500),
  ready_at        timestamptz,
  ready_by        uuid references public.profiles(id) on delete restrict,
  closed_at       timestamptz,
  drop_reason     text check (drop_reason is null or length(drop_reason) between 5 and 500),
  idempotency_key text not null check (length(idempotency_key) between 8 and 100),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint field_lead_tracks_idem_uq unique (captured_by, idempotency_key),
  constraint field_lead_tracks_owner_ck check (status not in ('assigned', 'contacted', 'ready_for_sale', 'converted') or assigned_to is not null),
  constraint field_lead_tracks_ready_ck check (status not in ('ready_for_sale', 'converted') or ready_at is not null),
  constraint field_lead_tracks_drop_ck check ((status = 'dropped') = (drop_reason is not null))
);
create index if not exists field_lead_tracks_captured_idx on public.field_lead_tracks (captured_by, created_at desc);
create index if not exists field_lead_tracks_assigned_idx on public.field_lead_tracks (assigned_to, status);
create index if not exists field_lead_tracks_status_idx on public.field_lead_tracks (status, updated_at desc);

create table if not exists public.field_lead_events (
  id          bigint generated always as identity primary key,
  lead_id     uuid not null references public.field_lead_tracks(lead_id) on delete restrict,
  at          timestamptz not null default now(),
  actor_id    uuid not null,
  actor_role  text not null,
  from_status text,
  to_status   text not null,
  assigned_to uuid,
  note        text check (note is null or length(note) <= 500)
);
create index if not exists field_lead_events_lead_idx on public.field_lead_events (lead_id, at);

create table if not exists public.field_lead_fees (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.field_lead_tracks(lead_id) on delete restrict,
  fee_kind       text not null check (fee_kind in ('consultant_lead_fee', 'supervisor_lead_fee')),
  beneficiary_id uuid not null references public.profiles(id) on delete restrict,
  amount         numeric(14,2) not null check (amount > 0),
  status         text not null default 'pending' check (status in ('pending', 'confirmed', 'approved', 'rejected')),
  earned_on      date not null,
  confirmed_by   uuid references public.profiles(id) on delete restrict,
  confirmed_at   timestamptz,
  approved_by    uuid references public.profiles(id) on delete restrict,
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- At most one fee of each kind per lead, whatever happens to the lead afterwards.
  constraint field_lead_fees_once_uq unique (lead_id, fee_kind)
);
create index if not exists field_lead_fees_beneficiary_idx on public.field_lead_fees (beneficiary_id, earned_on desc);
create index if not exists field_lead_fees_status_idx on public.field_lead_fees (status, earned_on);

create table if not exists public.field_lead_fee_events (
  id          bigint generated always as identity primary key,
  fee_id      uuid not null references public.field_lead_fees(id) on delete restrict,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_role  text,
  from_status text,
  to_status   text not null,
  note        text check (note is null or length(note) <= 500)
);
create index if not exists field_lead_fee_events_fee_idx on public.field_lead_fee_events (fee_id, at);

alter table public.field_lead_tracks enable row level security;
alter table public.field_lead_events enable row level security;
alter table public.field_lead_fees enable row level security;
alter table public.field_lead_fee_events enable row level security;
revoke all on table public.field_lead_tracks, public.field_lead_events, public.field_lead_fees, public.field_lead_fee_events
  from public, anon, authenticated;

create trigger field_lead_events_append_only before update or delete on public.field_lead_events
  for each row execute function public.intake_append_only_guard();
create trigger field_lead_fee_events_append_only before update or delete on public.field_lead_fee_events
  for each row execute function public.intake_append_only_guard();

-- Tracks and fees change only through the functions below (they set fnc.field_lead), never directly, never deleted.
create or replace function public.field_lead_row_guard()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Field leads and lead fees cannot be deleted'; end if;
  if coalesce(current_setting('fnc.field_lead', true), '') <> 'on' then
    raise exception 'Field leads change only through the field-lead functions';
  end if;
  if tg_table_name = 'field_lead_tracks' then
    if (new.lead_id, new.captured_by, new.captured_role, new.idempotency_key, new.created_at)
       is distinct from (old.lead_id, old.captured_by, old.captured_role, old.idempotency_key, old.created_at) then
      raise exception 'Who captured a field lead cannot be changed';
    end if;
  else
    if (new.id, new.lead_id, new.fee_kind, new.beneficiary_id, new.amount, new.earned_on, new.created_at)
       is distinct from (old.id, old.lead_id, old.fee_kind, old.beneficiary_id, old.amount, old.earned_on, old.created_at) then
      raise exception 'A lead fee''s amount, earner and date cannot be changed';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.field_lead_row_guard() from public, anon, authenticated;
create trigger field_lead_tracks_guard before update or delete on public.field_lead_tracks
  for each row execute function public.field_lead_row_guard();
create trigger field_lead_fees_guard before update or delete on public.field_lead_fees
  for each row execute function public.field_lead_row_guard();

-- 2. Helpers --------------------------------------------------------------------------------------------------------
-- Enabled staff of one role (for notices).
create or replace function public.field_enabled_staff(p_role text)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
   where p.role::text = p_role and p.is_active and s.access_enabled;
$$;
revoke all on function public.field_enabled_staff(text) from public, anon, authenticated;

create or replace function public.field_is_manager(p_role text)
returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_role in ('coordinator', 'administrator', 'owner'), false);
$$;
revoke all on function public.field_is_manager(text) from public, anon, authenticated;

-- Writes the lead fees on Ready for sale. R150 to the field consultant who captured it; R100 to the Field
-- Supervisor: the supervisor who marked it, else the supervisor who captured it, else the only enabled Field
-- Supervisor. With no (or more than one) supervisor to choose from, no supervisor line is written and the gap is
-- recorded in the audit trail for the Director.
create or replace function public.field_lead_write_fees(p_lead_id uuid, p_actor uuid, p_actor_role text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.field_lead_tracks; v_today date := public.current_sast_date(); v_sup uuid; v_n integer; v_fee uuid;
  v_name text; f record;
begin
  select * into t from public.field_lead_tracks where lead_id = p_lead_id;
  select l.business_name into v_name from public.leads l where l.id = p_lead_id;
  if t.captured_role = 'field_consultant' then
    insert into public.field_lead_fees (lead_id, fee_kind, beneficiary_id, amount, earned_on)
    values (p_lead_id, 'consultant_lead_fee', t.captured_by, 150.00, v_today)
    on conflict (lead_id, fee_kind) do nothing;
  end if;
  if p_actor_role = 'field_supervisor' then v_sup := p_actor;
  elsif t.captured_role = 'field_supervisor' then v_sup := t.captured_by;
  else
    select count(*), min(x::text)::uuid into v_n, v_sup from public.field_enabled_staff('field_supervisor') x;
    if v_n <> 1 then v_sup := null; end if;
  end if;
  if v_sup is not null then
    insert into public.field_lead_fees (lead_id, fee_kind, beneficiary_id, amount, earned_on)
    values (p_lead_id, 'supervisor_lead_fee', v_sup, 100.00, v_today)
    on conflict (lead_id, fee_kind) do nothing;
  elsif not exists (select 1 from public.field_lead_fees x where x.lead_id = p_lead_id and x.fee_kind = 'supervisor_lead_fee') then
    perform public.staff_audit_write('field_lead', p_lead_id, 'supervisor_lead_fee_not_created',
      'No single Field Supervisor to pay', jsonb_build_object('enabled_supervisors', v_n));
  end if;
  for f in select x.* from public.field_lead_fees x
            where x.lead_id = p_lead_id and not exists (select 1 from public.field_lead_fee_events e where e.fee_id = x.id) loop
    insert into public.field_lead_fee_events (fee_id, actor_id, actor_role, to_status) values (f.id, p_actor, p_actor_role, 'pending');
    perform public.staff_audit_write('field_lead_fee', f.id, 'lead_fee_created', null,
      jsonb_build_object('lead_id', p_lead_id, 'fee_kind', f.fee_kind, 'beneficiary_id', f.beneficiary_id, 'amount', f.amount));
    perform public.staff_notify(f.beneficiary_id, 'LEAD_FEE_STATUS_CHANGED',
      'Lead fee pending: R' || to_char(f.amount, 'FM999G999G990'), coalesce(v_name, 'A lead') || ' is ready for sale. The fee is checked by the Sales Coordinator and approved by the Administrator.',
      '/staff/me', jsonb_build_object('fee_id', f.id));
  end loop;
end;
$$;
revoke all on function public.field_lead_write_fees(uuid, uuid, text) from public, anon, authenticated;

-- 3. Capture (field consultants and the Field Supervisor) -------------------------------------------------------------
create or replace function public.staff_capture_field_lead(
  p_business_name text, p_contact_name text, p_contact_cell text, p_contact_email text, p_cipc_number text,
  p_area text, p_note text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_role text := public.staff_actor_role(); v_existing public.field_lead_tracks;
  v_cipc text := nullif(btrim(p_cipc_number), ''); v_norm text; v_lead uuid; v_dup boolean; a uuid;
begin
  if v_role is null or v_role not in ('field_consultant', 'field_supervisor') then
    raise exception 'Only field consultants and the Field Supervisor capture field leads' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 100 then
    raise exception 'A client-generated idempotency key (8-100 characters) is required';
  end if;
  select * into v_existing from public.field_lead_tracks t where t.captured_by = v_uid and t.idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('status', 'existing', 'lead_id', v_existing.lead_id); end if;

  if nullif(btrim(p_business_name), '') is null or length(btrim(p_business_name)) > 160 then raise exception 'Enter the business name'; end if;
  if nullif(btrim(p_contact_name), '') is null or length(btrim(p_contact_name)) > 120 then raise exception 'Enter the contact person'; end if;
  if nullif(btrim(p_contact_cell), '') is null and nullif(btrim(p_contact_email), '') is null then
    raise exception 'Enter a cell number or an email address so the client can be contacted';
  end if;
  if length(coalesce(p_contact_cell, '')) > 30 or length(coalesce(p_contact_email, '')) > 160 or length(coalesce(v_cipc, '')) > 40 then
    raise exception 'A contact detail is too long';
  end if;
  if length(coalesce(p_area, '')) > 120 or length(coalesce(p_note, '')) > 500 then raise exception 'The area or the note is too long'; end if;
  if not public.staff_text_is_safe(p_area) or not public.staff_text_is_safe(p_note) then
    raise exception 'The area and the note cannot contain ID or account-length numbers';
  end if;

  -- A business already registered with FNC (same CIPC number, written any way) is never captured twice: it belongs to
  -- whoever registered it first. The capturer is told only that it is already registered.
  if v_cipc is not null then
    v_norm := upper(regexp_replace(v_cipc, '[^A-Za-z0-9]', '', 'g'));
    select exists (select 1 from public.leads l where upper(regexp_replace(coalesce(l.cipc_number, ''), '[^A-Za-z0-9]', '', 'g')) = v_norm)
        or exists (select 1 from public.clients c where upper(regexp_replace(coalesce(c.cipc_number, ''), '[^A-Za-z0-9]', '', 'g')) = v_norm)
      into v_dup;
    if v_dup then
      perform public.staff_audit_write('field_lead', null, 'field_lead_already_registered', null, jsonb_build_object('captured_role', v_role));
      return jsonb_build_object('status', 'already_registered', 'lead_id', null);
    end if;
  end if;

  insert into public.leads (business_name, contact_name, contact_cell, contact_email, cipc_number, entered_by)
  values (btrim(p_business_name), btrim(p_contact_name), nullif(btrim(p_contact_cell), ''), nullif(btrim(p_contact_email), ''), v_cipc, v_uid)
  returning id into v_lead;
  insert into public.field_lead_tracks (lead_id, captured_by, captured_role, area, note, idempotency_key)
  values (v_lead, v_uid, v_role, nullif(btrim(p_area), ''), nullif(btrim(p_note), ''), p_idempotency_key);
  insert into public.field_lead_events (lead_id, actor_id, actor_role, to_status, note)
  values (v_lead, v_uid, v_role, 'captured', nullif(btrim(p_note), ''));
  perform public.staff_audit_write('field_lead', v_lead, 'field_lead_captured', null, jsonb_build_object('captured_role', v_role));
  for a in select * from public.field_enabled_staff('coordinator') loop
    perform public.staff_notify(a, 'FIELD_LEAD_UPDATED', 'New field lead: ' || btrim(p_business_name),
      'Captured in the field. Assign it to its owner or move it to New Leads.', '/staff/field-leads', jsonb_build_object('lead_id', v_lead));
  end loop;
  -- A possible repeat (same business name in the last 6 months, or the same contact) is shown to the capturer, not blocked.
  return jsonb_build_object('status', 'created', 'lead_id', v_lead, 'possible_duplicate',
    exists (select 1 from public.intake_duplicate_matches(p_business_name, null, p_contact_email, p_contact_cell) m
             where m.existing_lead_id is distinct from v_lead));
end;
$$;

-- 4. Moves ------------------------------------------------------------------------------------------------------------
create or replace function public.staff_move_field_lead(p_lead_id uuid, p_to text, p_note text default null, p_assigned_to uuid default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_role text := public.staff_actor_role(); t public.field_lead_tracks;
  v_mgr boolean; v_mine boolean; v_ok boolean; v_name text; a uuid;
begin
  if v_role is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  if p_note is not null and (length(p_note) > 500 or not public.staff_text_is_safe(p_note)) then
    raise exception 'The note cannot contain ID or account-length numbers (500 characters at most)';
  end if;
  select * into t from public.field_lead_tracks where lead_id = p_lead_id for update;
  if not found then raise exception 'Field lead not found'; end if;
  v_mgr := public.field_is_manager(v_role);
  v_mine := t.assigned_to = v_uid or v_role in ('field_supervisor', 'owner');
  v_ok := case
    when p_to = 'assigned' then v_mgr and t.status in ('captured', 'new_leads', 'assigned', 'contacted')
    when p_to = 'new_leads' then v_mgr and t.status = 'captured'
    when p_to = 'contacted' then v_mine and t.status = 'assigned'
    when p_to = 'ready_for_sale' then v_mine and t.status = 'contacted'
    when p_to = 'dropped' then (v_mgr or v_mine) and t.status in ('captured', 'new_leads', 'assigned', 'contacted', 'ready_for_sale')
    else false end;
  if not v_ok then
    raise exception 'You cannot move this lead from % to %', replace(t.status, '_', ' '), replace(coalesce(p_to, '?'), '_', ' ')
      using errcode = '42501';
  end if;
  if p_to = 'assigned' then
    if not exists (select 1 from public.profiles p join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
                    where p.id = p_assigned_to and p.is_active and s.access_enabled
                      and p.role::text in ('field_consultant', 'field_supervisor', 'coordinator', 'administrator')) then
      raise exception 'Choose an active field consultant, Field Supervisor, Sales Coordinator or Administrator';
    end if;
    if p_assigned_to = t.assigned_to and t.status <> 'new_leads' then raise exception 'The lead is already with that person'; end if;
  elsif p_assigned_to is not null then
    raise exception 'Only an assignment names a person';
  end if;
  if p_to = 'dropped' and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Give the reason the lead is dropped'; end if;

  perform set_config('fnc.field_lead', 'on', true);
  update public.field_lead_tracks
     set status = p_to,
         assigned_to = case when p_to = 'assigned' then p_assigned_to else assigned_to end,
         ready_at = case when p_to = 'ready_for_sale' then now() else ready_at end,
         ready_by = case when p_to = 'ready_for_sale' then v_uid else ready_by end,
         drop_reason = case when p_to = 'dropped' then btrim(p_note) else drop_reason end,
         closed_at = case when p_to = 'dropped' then now() else closed_at end
   where lead_id = p_lead_id;
  insert into public.field_lead_events (lead_id, actor_id, actor_role, from_status, to_status, assigned_to, note)
  values (p_lead_id, v_uid, v_role, t.status, p_to, case when p_to = 'assigned' then p_assigned_to end, nullif(btrim(p_note), ''));
  perform public.staff_audit_write('field_lead', p_lead_id, 'field_lead_moved', p_note,
    jsonb_build_object('from', t.status, 'to', p_to, 'assigned_to', p_assigned_to));

  select l.business_name into v_name from public.leads l where l.id = p_lead_id;
  if p_to = 'assigned' and p_assigned_to <> v_uid then
    perform public.staff_notify(p_assigned_to, 'FIELD_LEAD_UPDATED', 'Lead given to you: ' || coalesce(v_name, 'a lead'),
      coalesce(nullif(btrim(p_note), ''), 'Contact the client and update the lead.'), '/staff/field-leads', jsonb_build_object('lead_id', p_lead_id));
  elsif p_to = 'ready_for_sale' then
    perform public.field_lead_write_fees(p_lead_id, v_uid, v_role);
    for a in select * from public.field_enabled_staff('coordinator') loop
      perform public.staff_notify(a, 'FIELD_LEAD_UPDATED', 'Ready for sale: ' || coalesce(v_name, 'a lead'),
        'Open a client file for it.', '/staff/field-leads', jsonb_build_object('lead_id', p_lead_id));
    end loop;
  end if;
  return p_to;
end;
$$;

-- Ready for sale -> Converted: opens the client file (the normal submission file) on the same lead. FNC's own field
-- team brought it in, so the file is direct with no agent, and therefore no agent R100 (the field team earns the lead
-- fees instead).
create or replace function public.staff_convert_field_lead(p_lead_id uuid, p_funding_type text, p_funding_amount numeric default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_role text := public.staff_actor_role(); t public.field_lead_tracks; v_snapshot jsonb;
begin
  if not public.field_is_manager(v_role) then
    raise exception 'Only the Sales Coordinator opens the client file' using errcode = '42501';
  end if;
  if p_note is not null and (length(p_note) > 500 or not public.staff_text_is_safe(p_note)) then
    raise exception 'The note cannot contain ID or account-length numbers (500 characters at most)';
  end if;
  select * into t from public.field_lead_tracks where lead_id = p_lead_id for update;
  if not found then raise exception 'Field lead not found'; end if;
  if t.status <> 'ready_for_sale' then raise exception 'Only a lead that is ready for sale becomes a client file'; end if;
  if not exists (select 1 from public.funding_product_catalog f where f.code = p_funding_type and f.is_active) then
    raise exception 'Choose the funding type';
  end if;
  if p_funding_amount is not null and p_funding_amount < 0 then raise exception 'Requested amount cannot be negative'; end if;
  if exists (select 1 from public.submission_intakes si where si.lead_id = p_lead_id) then
    raise exception 'This lead already has a client file';
  end if;

  if p_funding_amount is not null then
    update public.leads set funding_amount = round(p_funding_amount, 2) where id = p_lead_id;
  end if;
  v_snapshot := public.intake_validate_channel('direct_agent', null, null, null)
    || jsonb_build_object('source', 'field_lead', 'field_captured_by', t.captured_by, 'field_captured_role', t.captured_role);
  insert into public.submission_intakes (lead_id, channel, funding_type, affiliation_snapshot, created_by, idempotency_key)
  values (p_lead_id, 'direct_agent', p_funding_type, v_snapshot, v_uid, 'field-lead-' || p_lead_id::text);

  perform set_config('fnc.field_lead', 'on', true);
  update public.field_lead_tracks set status = 'converted', closed_at = now() where lead_id = p_lead_id;
  insert into public.field_lead_events (lead_id, actor_id, actor_role, from_status, to_status, note)
  values (p_lead_id, v_uid, v_role, t.status, 'converted', nullif(btrim(p_note), ''));
  perform public.staff_audit_write('field_lead', p_lead_id, 'field_lead_converted', p_note, jsonb_build_object('funding_type', p_funding_type));
  perform public.staff_audit_write('submission_intake', p_lead_id, 'registered', null,
    jsonb_build_object('channel', 'direct_agent', 'source', 'field_lead', 'funding_type', p_funding_type));
  return p_lead_id;
end;
$$;

-- 5. Lead fees: the Sales Coordinator confirms, the Administrator approves -------------------------------------------
create or replace function public.staff_decide_lead_fee(p_fee_id uuid, p_decision text, p_note text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_role text := public.staff_actor_role(); f public.field_lead_fees; v_to text; v_ok boolean;
begin
  if v_role is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  if p_note is not null and (length(p_note) > 500 or not public.staff_text_is_safe(p_note)) then
    raise exception 'The note cannot contain ID or account-length numbers (500 characters at most)';
  end if;
  select * into f from public.field_lead_fees where id = p_fee_id for update;
  if not found then raise exception 'Lead fee not found'; end if;
  if f.beneficiary_id = v_uid then raise exception 'You cannot decide your own lead fee' using errcode = '42501'; end if;
  v_to := case p_decision when 'confirm' then 'confirmed' when 'approve' then 'approved' when 'reject' then 'rejected' end;
  v_ok := case p_decision
    when 'confirm' then f.status = 'pending' and v_role in ('coordinator', 'owner')
    when 'approve' then f.status = 'confirmed' and v_role in ('administrator', 'owner')
    when 'reject' then (f.status = 'pending' and v_role in ('coordinator', 'administrator', 'owner'))
                    or (f.status = 'confirmed' and v_role in ('administrator', 'owner'))
    else false end;
  if not v_ok then
    raise exception 'You cannot % a lead fee that is %', coalesce(p_decision, '?'), f.status using errcode = '42501';
  end if;
  if p_decision = 'reject' and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Give the reason the fee is rejected'; end if;

  perform set_config('fnc.field_lead', 'on', true);
  update public.field_lead_fees
     set status = v_to,
         confirmed_by = case when v_to = 'confirmed' then v_uid else confirmed_by end,
         confirmed_at = case when v_to = 'confirmed' then now() else confirmed_at end,
         approved_by = case when v_to = 'approved' then v_uid else approved_by end,
         approved_at = case when v_to = 'approved' then now() else approved_at end
   where id = p_fee_id;
  insert into public.field_lead_fee_events (fee_id, actor_id, actor_role, from_status, to_status, note)
  values (p_fee_id, v_uid, v_role, f.status, v_to, nullif(btrim(p_note), ''));
  perform public.staff_audit_write('field_lead_fee', p_fee_id, 'lead_fee_' || v_to, p_note, jsonb_build_object('from', f.status));
  if v_to in ('approved', 'rejected') then
    perform public.staff_notify(f.beneficiary_id, 'LEAD_FEE_STATUS_CHANGED',
      'Lead fee ' || v_to || ': R' || to_char(f.amount, 'FM999G999G990'),
      case when v_to = 'approved' then 'It is paid with the payroll one month after it was earned.' else btrim(p_note) end,
      '/staff/me', jsonb_build_object('fee_id', p_fee_id));
  end if;
  return v_to;
end;
$$;

-- 6. Reads ------------------------------------------------------------------------------------------------------------
-- The field-lead board. Field consultants see the leads they captured or that were given to them; the Field
-- Supervisor sees every field lead (there are no field teams in the CRM yet); the Sales Coordinator, the
-- Administrator and the Director see all.
create or replace function public.staff_field_leads(p_open_only boolean default true)
returns table (lead_id uuid, business_name text, contact_name text, contact_cell text, contact_email text, area text,
               status text, captured_by uuid, captured_by_name text, captured_role text, assigned_to uuid, assigned_name text,
               drop_reason text, ready_at timestamptz, created_at timestamptz, updated_at timestamptz, history jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := public.staff_actor_role(); v_uid uuid := (select auth.uid());
begin
  if v_role is null or v_role not in ('field_consultant', 'field_supervisor', 'coordinator', 'administrator', 'owner') then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query
    select t.lead_id, l.business_name, l.contact_name, l.contact_cell, l.contact_email, t.area, t.status,
           t.captured_by, cp.full_name, t.captured_role, t.assigned_to, ap.full_name, t.drop_reason, t.ready_at, t.created_at, t.updated_at,
           (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'who', ep.full_name, 'role', e.actor_role,
                                                         'from', e.from_status, 'to', e.to_status, 'note', e.note) order by e.at, e.id), '[]'::jsonb)
              from public.field_lead_events e left join public.profiles ep on ep.id = e.actor_id where e.lead_id = t.lead_id)
      from public.field_lead_tracks t
      join public.leads l on l.id = t.lead_id
      join public.profiles cp on cp.id = t.captured_by
      left join public.profiles ap on ap.id = t.assigned_to
     where (v_role <> 'field_consultant' or t.captured_by = v_uid or t.assigned_to = v_uid)
       and (not coalesce(p_open_only, true) or t.status not in ('converted', 'dropped'))
     order by t.updated_at desc
     limit 300;
end;
$$;

-- Who a field lead can be given to.
create or replace function public.staff_field_lead_assignees()
returns table (profile_id uuid, full_name text, staff_role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.field_is_manager(public.staff_actor_role()) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.role::text from public.profiles p
      join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role and s.access_enabled
     where p.is_active and p.role::text in ('field_consultant', 'field_supervisor', 'coordinator', 'administrator')
     order by p.role::text, p.full_name;
end;
$$;

-- Lead fees waiting for a decision (and recent ones), for the Sales Coordinator, the Administrator and the Director.
create or replace function public.staff_lead_fees(p_status text default null)
returns table (id uuid, lead_id uuid, business_name text, fee_kind text, beneficiary_name text, amount numeric,
               status text, earned_on date, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.field_is_manager(public.staff_actor_role()) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query
    select f.id, f.lead_id, l.business_name, f.fee_kind, p.full_name, f.amount, f.status, f.earned_on, f.updated_at
      from public.field_lead_fees f
      join public.leads l on l.id = f.lead_id
      join public.profiles p on p.id = f.beneficiary_id
     where p_status is null or f.status = p_status
     order by f.earned_on desc, f.created_at desc
     limit 300;
end;
$$;

-- The caller's own lead fees: own rand amounts only.
create or replace function public.my_lead_fees()
returns table (id uuid, business_name text, fee_kind text, amount numeric, status text, earned_on date)
language sql stable security definer set search_path = '' as $$
  select f.id, l.business_name, f.fee_kind, f.amount, f.status, f.earned_on
    from public.field_lead_fees f join public.leads l on l.id = f.lead_id
   where f.beneficiary_id = (select auth.uid())
   order by f.earned_on desc, f.created_at desc
   limit 200;
$$;

-- Month-to-date counts for the field landing page. The Field Supervisor's are the whole field team's.
create or replace function public.my_field_lead_summary()
returns table (captured_mtd integer, ready_mtd integer, open_leads integer, fees_pending numeric, fees_approved numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := public.staff_actor_role(); v_uid uuid := (select auth.uid());
  v_m tstzrange := tstzrange((date_trunc('month', public.current_sast_date())::timestamp at time zone 'Africa/Johannesburg'), null, '[)');
  v_from date := date_trunc('month', public.current_sast_date())::date;
begin
  if v_role is null or v_role not in ('field_consultant', 'field_supervisor') then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query
    select (select count(*)::int from public.field_lead_tracks t where t.created_at <@ v_m and (v_role = 'field_supervisor' or t.captured_by = v_uid)),
           (select count(*)::int from public.field_lead_tracks t where t.ready_at <@ v_m and (v_role = 'field_supervisor' or t.captured_by = v_uid)),
           (select count(*)::int from public.field_lead_tracks t where t.status not in ('converted', 'dropped')
              and (v_role = 'field_supervisor' or t.captured_by = v_uid or t.assigned_to = v_uid)),
           (select coalesce(sum(f.amount), 0) from public.field_lead_fees f where f.beneficiary_id = v_uid and f.status in ('pending', 'confirmed') and f.earned_on >= v_from),
           (select coalesce(sum(f.amount), 0) from public.field_lead_fees f where f.beneficiary_id = v_uid and f.status = 'approved' and f.earned_on >= v_from);
end;
$$;

-- 7. Targets: field measures now count real numbers ------------------------------------------------------------------
create or replace function public.role_target_actual(p_metric text, p_profile uuid, p_scope text)
returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare v_m tstzrange := tstzrange((date_trunc('month', public.current_sast_date())::timestamp at time zone 'Africa/Johannesburg'), null, '[)');
begin
  return case p_metric
    when 'files_opened' then (select count(*) from public.submission_intakes si where si.registered_at <@ v_m)
    when 'docs_complete_7d_pct' then (
      select case when count(*) > 0 then round(100.0 * count(*) filter (where si.first_complete_at <= si.registered_at + interval '7 days') / count(*), 1) end
        from public.submission_intakes si where si.first_complete_at <@ v_m)
    -- Switchboard: files registered; field consultants: field leads captured.
    when 'leads_captured' then (select count(*) from public.submission_intakes si where si.registered_at <@ v_m and si.created_by = p_profile)
                             + (select count(*) from public.field_lead_tracks t where t.created_at <@ v_m and t.captured_by = p_profile)
    when 'ready_for_sale' then (select count(*) from public.field_lead_tracks t where t.ready_at <@ v_m and t.captured_by = p_profile)
    -- Field Supervisor: the whole field team (there are no field teams in the CRM yet).
    when 'active_consultants' then (
      select count(distinct t.captured_by) from public.field_lead_tracks t
       where t.created_at <@ v_m and t.captured_role = 'field_consultant')
    when 'team_leads' then (select count(*) from public.field_lead_tracks t where t.created_at <@ v_m)
    when 'team_ready_for_sale' then (select count(*) from public.field_lead_tracks t where t.ready_at <@ v_m)
    when 'admin_fee_collected_7d_pct' then (
      select case when count(*) > 0 then round(100.0 * count(*) filter (where r.issued_at <= i.issued_at + interval '7 days') / count(*), 1) end
        from public.admin_fee_invoices i left join public.admin_fee_receipts r on r.invoice_id = i.id
       where i.voided_at is null and i.issued_at <@ v_m and i.issued_at < now() - interval '7 days')
    else null
  end;
end;
$$;
revoke all on function public.role_target_actual(text, uuid, text) from public, anon, authenticated;

-- 8. Grants -----------------------------------------------------------------------------------------------------------
revoke all on function public.staff_capture_field_lead(text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.staff_move_field_lead(uuid, text, text, uuid) from public, anon;
revoke all on function public.staff_convert_field_lead(uuid, text, numeric, text) from public, anon;
revoke all on function public.staff_decide_lead_fee(uuid, text, text) from public, anon;
revoke all on function public.staff_field_leads(boolean) from public, anon;
revoke all on function public.staff_field_lead_assignees() from public, anon;
revoke all on function public.staff_lead_fees(text) from public, anon;
revoke all on function public.my_lead_fees() from public, anon;
revoke all on function public.my_field_lead_summary() from public, anon;
grant execute on function public.staff_capture_field_lead(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.staff_move_field_lead(uuid, text, text, uuid) to authenticated;
grant execute on function public.staff_convert_field_lead(uuid, text, numeric, text) to authenticated;
grant execute on function public.staff_decide_lead_fee(uuid, text, text) to authenticated;
grant execute on function public.staff_field_leads(boolean) to authenticated;
grant execute on function public.staff_field_lead_assignees() to authenticated;
grant execute on function public.staff_lead_fees(text) to authenticated;
grant execute on function public.my_lead_fees() to authenticated;
grant execute on function public.my_field_lead_summary() to authenticated;

notify pgrst, 'reload schema';
