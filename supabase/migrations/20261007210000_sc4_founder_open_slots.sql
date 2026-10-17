-- Sales Coordinator build SC4: the Coordinator books the Founder only into Founder-opened slots,
-- and asks for any other time through a request the Founder decides. Nothing is sent to anyone;
-- the confirmation sender is still the Owner's decision.

create or replace function public.calendar_require_open_slot(
  p_calendar_owner uuid, p_category text, p_starts_at timestamptz, p_ends_at timestamptz)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.owner_availability_slots s
     where s.owner_id = p_calendar_owner and s.is_open
       and s.starts_at <= p_starts_at and s.ends_at >= p_ends_at
       and p_category = any (s.allowed_booking_types)) then
    raise exception 'That time is not open. Pick a slot the Founder has opened, or request another time';
  end if;
end;
$$;
revoke all on function public.calendar_require_open_slot(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.staff_create_calendar_event(
  p_calendar_owner uuid, p_title text, p_category text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_visibility text, p_public_title text, p_agenda text, p_lead_id uuid,
  p_attendee_email text, p_attendee_name text, p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role     text;
  v_actor    uuid := (select auth.uid());
  v_event_id uuid;
  v_conf_id  uuid;
  v_short    boolean;
  v_existing uuid;
begin
  v_role := public.calendar_require_permission(p_calendar_owner, 'create');
  if length(coalesce(p_idempotency_key, '')) not between 8 and 120 then raise exception 'An idempotency key of 8 to 120 characters is required'; end if;
  if length(btrim(coalesce(p_title, ''))) not between 3 and 160 then raise exception 'Title must be 3 to 160 characters'; end if;
  if not public.staff_text_is_safe(p_title) or not public.staff_text_is_safe(p_agenda) or not public.staff_text_is_safe(p_public_title) then
    raise exception 'Title, agenda and public title cannot contain ID or account-length numbers';
  end if;
  if p_visibility not in ('private', 'busy', 'public') then raise exception 'Unsupported visibility'; end if;
  if p_visibility = 'public' and length(btrim(coalesce(p_public_title, ''))) not between 3 and 120 then
    raise exception 'A public event requires a safe public title';
  end if;
  if p_attendee_email is not null and p_attendee_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Attendee email is not valid'; end if;
  if p_lead_id is not null and not exists (select 1 from public.submission_intakes si where si.lead_id = p_lead_id) then
    raise exception 'Submission not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('owner-calendar:' || p_calendar_owner::text));

  select r.event_id into v_existing from public.calendar_delegated_requests r
   where r.actor_id = v_actor and r.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', 'existing', 'event_id', v_existing);
  end if;

  perform public.calendar_validate_slot(p_calendar_owner, p_category, p_starts_at, p_ends_at, null, v_role <> 'owner');
  -- SC4: anyone but the Founder books only into time the Founder has opened.
  if v_role <> 'owner' then perform public.calendar_require_open_slot(p_calendar_owner, p_category, p_starts_at, p_ends_at); end if;

  insert into public.owner_calendar_events
    (owner_id, title, category, starts_at, ends_at, visibility, public_title, private_notes, lead_id, created_by)
  values (p_calendar_owner, btrim(p_title), p_category, p_starts_at, p_ends_at, p_visibility,
          case when p_visibility = 'public' then btrim(p_public_title) end, nullif(btrim(p_agenda), ''), p_lead_id, v_actor)
  returning id into v_event_id;

  -- Close open availability this booking now occupies (same as the Owner path).
  update public.owner_availability_slots s set is_open = false
   where s.owner_id = p_calendar_owner and s.is_open
     and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

  insert into public.calendar_delegated_requests (actor_id, idempotency_key, event_id) values (v_actor, p_idempotency_key, v_event_id);
  insert into public.calendar_event_changes (event_id, actor_id, actor_role, kind, to_starts, to_ends)
  values (v_event_id, v_actor, v_role, 'created', p_starts_at, p_ends_at);

  v_short := p_starts_at - now() < interval '24 hours';
  if p_attendee_email is not null then
    insert into public.calendar_confirmation_outbox (event_id, revision, kind, recipient_email, recipient_name, due_by, short_notice)
    values (v_event_id, 1, 'confirmation', lower(btrim(p_attendee_email)), nullif(btrim(p_attendee_name), ''),
            p_starts_at - interval '24 hours', v_short)
    returning id into v_conf_id;
  end if;

  perform public.staff_audit_write('calendar_event', v_event_id, 'booking_created', null,
    jsonb_build_object('calendar_owner', p_calendar_owner, 'short_notice', v_short, 'has_attendee', p_attendee_email is not null));
  return jsonb_build_object('status', 'created', 'event_id', v_event_id, 'confirmation_id', v_conf_id,
                            'short_notice', v_short and v_conf_id is not null);
end;
$$;


create table if not exists public.calendar_time_requests (
  id                uuid primary key default gen_random_uuid(),
  requester_id      uuid not null references public.profiles(id) on delete restrict,
  calendar_owner_id uuid not null references public.profiles(id) on delete restrict,
  category          text not null check (category in ('consultation', 'presentation', 'call', 'paperwork_review')),
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  reason            text not null check (length(btrim(reason)) between 10 and 300),
  lead_id           uuid references public.submission_intakes(lead_id) on delete set null,
  status            text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  owner_note        text check (owner_note is null or length(owner_note) <= 300),
  decided_by        uuid references public.profiles(id) on delete set null,
  decided_at        timestamptz,
  event_id          uuid references public.owner_calendar_events(id) on delete set null,
  created_at        timestamptz not null default now(),
  check (ends_at > starts_at),
  check (public.staff_text_is_safe(reason) and public.staff_text_is_safe(owner_note))
);
create index if not exists calendar_time_requests_status_idx on public.calendar_time_requests (status, created_at desc);
alter table public.calendar_time_requests enable row level security;
revoke all on table public.calendar_time_requests from public, anon, authenticated;

create or replace function public.staff_request_founder_time(
  p_calendar_owner uuid, p_category text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_reason text, p_lead_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  perform public.calendar_require_permission(p_calendar_owner, 'create');
  if p_category not in ('consultation', 'presentation', 'call', 'paperwork_review') then raise exception 'Unsupported booking category'; end if;
  if p_ends_at <= p_starts_at or p_starts_at <= now() or p_ends_at - p_starts_at > interval '12 hours' then
    raise exception 'A request must be a future interval no longer than twelve hours';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 or not public.staff_text_is_safe(p_reason) then
    raise exception 'Give a reason of at least 10 characters, without ID or account numbers';
  end if;
  if (select count(*) from public.calendar_time_requests r where r.requester_id = v_uid and r.status = 'pending') >= 5 then
    raise exception 'You already have 5 requests waiting for the Founder';
  end if;
  insert into public.calendar_time_requests (requester_id, calendar_owner_id, category, starts_at, ends_at, reason, lead_id)
  values (v_uid, p_calendar_owner, p_category, p_starts_at, p_ends_at, btrim(p_reason), p_lead_id) returning id into v_id;
  perform public.staff_audit_write('calendar_time_request', v_id, 'time_requested', null,
    jsonb_build_object('calendar_owner', p_calendar_owner, 'category', p_category));
  return v_id;
end;
$$;

-- Staff see their own requests; the Owner sees all of them.
create or replace function public.staff_time_requests(p_status text default null)
returns table (id uuid, category text, starts_at timestamptz, ends_at timestamptz, reason text, status text,
               owner_note text, requester_name text, created_at timestamptz, decided_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_role text; v_uid uuid := (select auth.uid());
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator']);
  return query
    select r.id, r.category, r.starts_at, r.ends_at, r.reason, r.status, r.owner_note, p.full_name, r.created_at, r.decided_at
      from public.calendar_time_requests r join public.profiles p on p.id = r.requester_id
     where (v_role = 'owner' or r.requester_id = v_uid) and (p_status is null or r.status = p_status)
     order by r.created_at desc limit 100;
end;
$$;

create or replace function public.owner_decide_time_request(p_request_id uuid, p_accept boolean, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.calendar_time_requests; v_uid uuid := (select auth.uid()); v_event uuid;
begin
  if not public.is_owner() then raise exception 'Only the owner can decide' using errcode = '42501'; end if;
  select * into r from public.calendar_time_requests where id = p_request_id for update;
  if not found or r.status <> 'pending' then raise exception 'That request is not waiting'; end if;
  if p_note is not null and not public.staff_text_is_safe(p_note) then raise exception 'The note looks like it holds an ID or account number'; end if;
  if not p_accept and length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'Say why (at least 10 characters)'; end if;
  if p_accept then
    perform pg_advisory_xact_lock(hashtext('owner-calendar:' || r.calendar_owner_id::text));
    perform public.calendar_validate_slot(r.calendar_owner_id, r.category, r.starts_at, r.ends_at, null, false);
    insert into public.owner_calendar_events (owner_id, title, category, starts_at, ends_at, visibility, private_notes, lead_id, created_by)
    values (r.calendar_owner_id, 'Booked on request', r.category, r.starts_at, r.ends_at, 'busy', r.reason, r.lead_id, v_uid)
    returning id into v_event;
    update public.owner_availability_slots s set is_open = false
     where s.owner_id = r.calendar_owner_id and s.is_open
       and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(r.starts_at, r.ends_at, '[)');
  end if;
  update public.calendar_time_requests
     set status = case when p_accept then 'accepted' else 'declined' end, owner_note = nullif(btrim(p_note), ''),
         decided_by = v_uid, decided_at = now(), event_id = v_event
   where id = p_request_id;
  perform public.staff_audit_write('calendar_time_request', p_request_id, case when p_accept then 'time_accepted' else 'time_declined' end,
    null, jsonb_build_object('event_id', v_event));
  return v_event;
end;
$$;

revoke all on function public.staff_request_founder_time(uuid, text, timestamptz, timestamptz, text, uuid) from public, anon;
revoke all on function public.staff_time_requests(text) from public, anon;
revoke all on function public.owner_decide_time_request(uuid, boolean, text) from public, anon;
grant execute on function public.staff_request_founder_time(uuid, text, timestamptz, timestamptz, text, uuid) to authenticated;
grant execute on function public.staff_time_requests(text) to authenticated;
grant execute on function public.owner_decide_time_request(uuid, boolean, text) to authenticated;
