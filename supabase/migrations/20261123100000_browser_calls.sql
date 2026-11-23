-- Calls inside the CRM (owner, 23 Nov 2026): "build like a call where I am able to call the consultant using my PC".
-- The Director calls a consultant, agent, client or lead from her browser (headset) through Twilio Voice.
--
-- How a call is placed (the browser never sends a raw phone number):
--   1. prepare_call(profile | client | lead): the Director only (can_place_calls). The number is resolved HERE from
--      existing columns (profiles.phone_number; the client's primary contact phone; the lead's contact cell), normalised
--      to E.164, and stored in call_targets with a 2-minute expiry. The browser gets back the target id and a MASKED
--      number for display.
--   2. The browser asks the twilio-voice-token Edge Function for an access token and connects with
--      params { callTarget: <id> }.
--   3. Twilio calls the twilio-voice-twiml Edge Function (signature-validated), which claims the target through
--      claim_call_target (service role only): it must be unexpired and unused, and is marked used with the call sid.
--      A crm_calls row is opened. The TwiML dials the stored number with record="do-not-record".
--   4. Twilio's status callbacks go to twilio-voice-status (signature-validated), which calls record_call_status
--      (service role only): it updates the crm_calls row and, once, writes the activity log line
--      "Call to <name> — 3 min 12 s, completed".
-- POPIA: no recording; full numbers live only in call_targets (owner/service only); lists show masked numbers.
-- New tables only, so inline foreign keys are fine.

-- 1. Who may place calls (one place to widen later, e.g. to staff) ----------------------------------------------------
create or replace function public.can_place_calls()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.is_owner(), false);
$$;
revoke all on function public.can_place_calls() from public, anon;
grant execute on function public.can_place_calls() to authenticated;

-- 2. Numbers -------------------------------------------------------------------------------------------------------------
-- South African numbers to E.164: 0821234567 -> +27821234567; 27821234567 -> +27821234567; 0027... -> +27...;
-- +<country>... kept. Anything else -> null.
create or replace function public.phone_to_e164(p_raw text)
returns text
language plpgsql immutable set search_path = '' as $$
declare v text := regexp_replace(coalesce(p_raw, ''), '[^0-9+]', '', 'g'); d text;
begin
  if v = '' then return null; end if;
  if left(v, 1) = '+' then d := regexp_replace(substr(v, 2), '[^0-9]', '', 'g');
    return case when d ~ '^[1-9][0-9]{7,14}$' then '+' || d end; end if;
  d := regexp_replace(v, '[^0-9]', '', 'g');
  if left(d, 2) = '00' then d := substr(d, 3); return case when d ~ '^[1-9][0-9]{7,14}$' then '+' || d end; end if;
  if d ~ '^0[1-9][0-9]{8}$' then return '+27' || substr(d, 2); end if;
  if d ~ '^27[1-9][0-9]{8}$' then return '+' || d; end if;
  return null;
end;
$$;

-- +27821234567 -> +27 82 *** **67 (country + first two digits, last two digits).
create or replace function public.phone_mask(p_e164 text)
returns text
language sql immutable set search_path = '' as $$
  select case when p_e164 is null then null
              when p_e164 like '+27%' and length(p_e164) = 12
                then '+27 ' || substr(p_e164, 4, 2) || ' *** **' || right(p_e164, 2)
              else left(p_e164, 4) || repeat('*', greatest(length(p_e164) - 6, 0)) || right(p_e164, 2) end;
$$;

-- 3. Tables --------------------------------------------------------------------------------------------------------------
create table if not exists public.call_targets (
  id          uuid primary key default gen_random_uuid(),
  caller_id   uuid not null references public.profiles(id) on delete restrict,
  target_kind text not null check (target_kind in ('profile', 'client', 'lead')),
  target_id   uuid not null,
  target_name text not null,
  e164        text not null check (e164 ~ '^\+[1-9][0-9]{7,14}$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  call_sid    text unique
);
create index if not exists call_targets_target_idx on public.call_targets (target_kind, target_id);
alter table public.call_targets enable row level security;
revoke all on table public.call_targets from public, anon, authenticated;

create table if not exists public.crm_calls (
  id               uuid primary key default gen_random_uuid(),
  call_target_id   uuid not null unique references public.call_targets(id) on delete restrict,
  caller_id        uuid not null references public.profiles(id) on delete restrict,
  target_kind      text not null check (target_kind in ('profile', 'client', 'lead')),
  target_id        uuid not null,
  target_name      text not null,
  to_masked        text not null,
  twilio_call_sid  text not null unique,
  status           text not null default 'initiated'
                   check (status in ('initiated', 'ringing', 'in-progress', 'answered', 'completed', 'busy', 'no-answer',
                                     'failed', 'canceled')),
  direction        text not null default 'outbound' check (direction = 'outbound'),
  started_at       timestamptz not null default now(),
  answered_at      timestamptz,
  ended_at         timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  logged_at        timestamptz,
  note             text check (note is null or length(note) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists crm_calls_target_idx on public.crm_calls (target_kind, target_id, started_at desc);
alter table public.crm_calls enable row level security;
revoke all on table public.crm_calls from public, anon, authenticated;
grant select on table public.crm_calls to authenticated;
drop policy if exists crm_calls_owner_select on public.crm_calls;
create policy crm_calls_owner_select on public.crm_calls for select to authenticated
  using (coalesce(public.is_owner(), false));

-- 4. Prepare a call (the Director, just before dialling) ----------------------------------------------------------------
create or replace function public.prepare_call(p_profile_id uuid default null, p_client_id uuid default null,
                                               p_lead_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_kind text; v_id uuid; v_name text; v_raw text; v_e164 text; v_target uuid;
begin
  if v_uid is null or not public.can_place_calls() then
    raise exception 'Only the Director can place calls from the CRM' using errcode = '42501';
  end if;
  if num_nonnulls(p_profile_id, p_client_id, p_lead_id) <> 1 then
    raise exception 'Choose one person, client or lead to call';
  end if;

  if p_profile_id is not null then
    v_kind := 'profile'; v_id := p_profile_id;
    select coalesce(nullif(btrim(p.full_name), ''), p.email), p.phone_number into v_name, v_raw
      from public.profiles p where p.id = p_profile_id;
    if v_name is null then raise exception 'Person not found'; end if;
  elsif p_client_id is not null then
    v_kind := 'client'; v_id := p_client_id;
    select c.business_name into v_name from public.clients c where c.id = p_client_id;
    if v_name is null then raise exception 'Client not found'; end if;
    -- The primary director's phone, else any contact's phone, else the newest linked lead's contact cell.
    select cc.phone into v_raw from public.client_contacts cc
     where cc.client_id = p_client_id and nullif(btrim(cc.phone), '') is not null
     order by cc.is_primary_director desc nulls last, cc.created_at limit 1;
    if v_raw is null then
      select l.contact_cell into v_raw from public.deals d join public.leads l on l.id = d.lead_id
       where d.client_id = p_client_id and nullif(btrim(l.contact_cell), '') is not null
       order by d.created_at desc limit 1;
    end if;
  else
    v_kind := 'lead'; v_id := p_lead_id;
    select l.business_name, l.contact_cell into v_name, v_raw from public.leads l where l.id = p_lead_id;
    if v_name is null then raise exception 'Lead not found'; end if;
  end if;

  if nullif(btrim(coalesce(v_raw, '')), '') is null then
    raise exception 'There is no phone number on file for %', v_name;
  end if;
  v_e164 := public.phone_to_e164(v_raw);
  if v_e164 is null then
    raise exception 'The phone number on file for % is not a valid number', v_name;
  end if;

  insert into public.call_targets (caller_id, target_kind, target_id, target_name, e164, expires_at)
  values (v_uid, v_kind, v_id, v_name, v_e164, now() + interval '2 minutes')
  returning id into v_target;
  return jsonb_build_object('call_target_id', v_target, 'display_name', v_name, 'masked_number', public.phone_mask(v_e164));
end;
$$;
revoke all on function public.prepare_call(uuid, uuid, uuid) from public, anon;
grant execute on function public.prepare_call(uuid, uuid, uuid) to authenticated;

-- 5. Twilio side (service role only; the Edge Functions validate Twilio's signature first) -------------------------------
-- Claims an unexpired, unused target for a call and opens the crm_calls row. Returns the number to dial, or null.
create or replace function public.claim_call_target(p_target_id uuid, p_call_sid text, p_caller_identity uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_t public.call_targets;
begin
  if p_target_id is null or nullif(btrim(coalesce(p_call_sid, '')), '') is null then return null; end if;
  update public.call_targets
     set used_at = now(), call_sid = p_call_sid
   where id = p_target_id and used_at is null and expires_at > now()
     and (p_caller_identity is null or caller_id = p_caller_identity)
  returning * into v_t;
  if v_t.id is null then return null; end if;
  insert into public.crm_calls (call_target_id, caller_id, target_kind, target_id, target_name, to_masked, twilio_call_sid)
  values (v_t.id, v_t.caller_id, v_t.target_kind, v_t.target_id, v_t.target_name, public.phone_mask(v_t.e164), p_call_sid)
  on conflict (twilio_call_sid) do nothing;
  return v_t.e164;
end;
$$;
revoke all on function public.claim_call_target(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_call_target(uuid, text, uuid) to service_role;

-- "3 min 12 s" / "45 s".
create or replace function public.format_call_duration(p_seconds integer)
returns text
language sql immutable set search_path = '' as $$
  select case when p_seconds is null then '0 s'
              when p_seconds >= 60 then (p_seconds / 60) || ' min ' || (p_seconds % 60) || ' s'
              else p_seconds || ' s' end;
$$;

-- Records a status callback for the call (keyed on the parent call sid). Idempotent; never moves a finished call back;
-- writes the activity log line once, when the call first reaches a final status.
create or replace function public.record_call_status(p_call_sid text, p_status text, p_duration_seconds integer default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.crm_calls; v_final boolean; v_status text := lower(btrim(coalesce(p_status, '')));
  v_email text;
begin
  if v_status = 'in_progress' then v_status := 'in-progress'; end if;
  if v_status not in ('initiated', 'ringing', 'in-progress', 'answered', 'completed', 'busy', 'no-answer', 'failed', 'canceled') then
    return 'ignored';
  end if;
  select * into v_c from public.crm_calls c where c.twilio_call_sid = p_call_sid for update;
  if not found then return 'unknown_call'; end if;
  if v_c.ended_at is not null then return 'already_final'; end if;
  v_final := v_status in ('completed', 'busy', 'no-answer', 'failed', 'canceled');
  update public.crm_calls
     set status = v_status,
         answered_at = case when v_status in ('in-progress', 'answered') then coalesce(answered_at, now()) else answered_at end,
         ended_at = case when v_final then now() else ended_at end,
         duration_seconds = case when v_final then coalesce(p_duration_seconds, duration_seconds, 0) else duration_seconds end,
         updated_at = now()
   where id = v_c.id
  returning * into v_c;
  if v_final and v_c.logged_at is null then
    select p.email into v_email from public.profiles p where p.id = v_c.caller_id;
    insert into public.activity_logs (user_id, user_email, user_role, event_type, entity_type, entity_id, description)
    values (v_c.caller_id, v_email, 'owner', 'CREATE', 'call', v_c.target_id,
            'Call to ' || v_c.target_name || ' — ' || public.format_call_duration(v_c.duration_seconds) || ', '
              || replace(v_c.status, '-', ' '));
    update public.crm_calls set logged_at = now() where id = v_c.id;
  end if;
  return v_status;
end;
$$;
revoke all on function public.record_call_status(text, text, integer) from public, anon, authenticated;
grant execute on function public.record_call_status(text, text, integer) to service_role;

-- 6. Reading and noting calls (the Director) -------------------------------------------------------------------------------
create or replace function public.list_calls(p_target_kind text default null, p_target_id uuid default null,
                                             p_limit integer default 20)
returns table (id uuid, target_kind text, target_id uuid, target_name text, to_masked text, status text,
               started_at timestamptz, answered_at timestamptz, ended_at timestamptz, duration_seconds integer, note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_place_calls() then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query
    select c.id, c.target_kind, c.target_id, c.target_name, c.to_masked, c.status, c.started_at, c.answered_at,
           c.ended_at, c.duration_seconds, c.note
      from public.crm_calls c
     where (p_target_kind is null or c.target_kind = p_target_kind)
       and (p_target_id is null or c.target_id = p_target_id)
     order by c.started_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;
revoke all on function public.list_calls(text, uuid, integer) from public, anon;
grant execute on function public.list_calls(text, uuid, integer) to authenticated;

-- The browser knows the call target it prepared, so the note is keyed on it.
create or replace function public.set_call_note(p_call_target_id uuid, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_rows int;
begin
  if not public.can_place_calls() then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  if v_note is not null and length(v_note) > 1000 then raise exception 'Keep the note under 1000 characters'; end if;
  update public.crm_calls set note = v_note, updated_at = now() where call_target_id = p_call_target_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'Call not found (it may not have connected)'; end if;
  return p_call_target_id;
end;
$$;
revoke all on function public.set_call_note(uuid, text) from public, anon;
grant execute on function public.set_call_note(uuid, text) to authenticated;
