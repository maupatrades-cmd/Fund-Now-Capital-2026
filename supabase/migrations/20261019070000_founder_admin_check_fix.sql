-- Security fix (found 19 Oct 2026 while testing Batch 3). Several Founder-or-Administrator checks were written as
--   if not (public.is_owner() or public.staff_role_of() = 'administrator') then raise ...
-- For anyone who is not staff (a partner, an agent, a client) staff_role_of() is NULL, so the test is NULL and
-- the "raise" is skipped: the check let them through. Affected: deciding diary time requests, writing and reading
-- meeting notes, and giving tasks to a named person (staff_can_assign_tasks). Every check now uses a helper that
-- is never NULL. Forward-only; the bodies are otherwise unchanged.

create or replace function public.staff_is_founder_or_administrator()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.is_owner(), false) or coalesce(public.staff_role_of() = 'administrator', false);
$$;
revoke all on function public.staff_is_founder_or_administrator() from public, anon, authenticated;

create or replace function public.staff_can_assign_tasks()
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.staff_is_founder_or_administrator();
$$;
revoke all on function public.staff_can_assign_tasks() from public, anon, authenticated;

create or replace function public.owner_decide_time_request(p_request_id uuid, p_accept boolean, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.calendar_time_requests; v_uid uuid := (select auth.uid()); v_event uuid;
begin
  if not public.staff_is_founder_or_administrator() then
    raise exception 'Only the Founder or the Administrator can decide' using errcode = '42501';
  end if;
  select * into r from public.calendar_time_requests where id = p_request_id for update;
  if not found or r.status <> 'pending' then raise exception 'That request is not waiting'; end if;
  -- The Administrator's authority covers the Founder's diary only.
  if not public.is_owner() and not public.calendar_is_founder(r.calendar_owner_id) then
    raise exception 'The Administrator decides requests on the Founder''s diary only' using errcode = '42501';
  end if;
  if r.requester_id = v_uid then raise exception 'You cannot decide your own request' using errcode = '42501'; end if;
  if p_note is not null and not public.staff_text_is_safe(p_note) then raise exception 'The note looks like it holds an ID or account number'; end if;
  if not p_accept and length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'Say why (at least 10 characters)'; end if;
  if p_accept then
    perform pg_advisory_xact_lock(hashtext('owner-calendar:' || r.calendar_owner_id::text));
    perform public.calendar_validate_slot(r.calendar_owner_id, r.category, r.starts_at, r.ends_at, null, false);
    insert into public.owner_calendar_events (owner_id, title, category, starts_at, ends_at, visibility, private_notes, lead_id, created_by)
    values (r.calendar_owner_id, 'Booked on request', r.category, r.starts_at, r.ends_at, 'busy', r.reason, r.lead_id, r.requester_id)
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
    null, jsonb_build_object('event_id', v_event, 'kind', r.kind));
  return v_event;
end;
$$;

create or replace function public.staff_add_meeting_note(p_event_id uuid, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_id uuid;
begin
  if not public.staff_is_founder_or_administrator() then
    raise exception 'Only the Founder or the Administrator writes meeting notes' using errcode = '42501';
  end if;
  select e.owner_id into v_owner from public.owner_calendar_events e where e.id = p_event_id;
  if v_owner is null or not public.calendar_is_founder(v_owner) then raise exception 'Booking not found'; end if;
  if length(btrim(coalesce(p_note, ''))) not between 3 and 4000 then raise exception 'Write the note in 3 to 4000 characters'; end if;
  if not public.staff_text_is_safe(p_note) then raise exception 'Notes cannot contain ID or account-length numbers'; end if;
  insert into public.calendar_meeting_notes (event_id, author_id, note) values (p_event_id, (select auth.uid()), btrim(p_note))
  returning id into v_id;
  perform public.staff_audit_write('calendar_event', p_event_id, 'meeting_note_added', null, jsonb_build_object('note_id', v_id));
  return v_id;
end;
$$;

create or replace function public.staff_meeting_notes(p_event_id uuid)
returns table (id uuid, author_name text, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.staff_is_founder_or_administrator() then
    raise exception 'Only the Founder or the Administrator reads meeting notes' using errcode = '42501';
  end if;
  return query
    select n.id, p.full_name, n.note, n.created_at
      from public.calendar_meeting_notes n join public.profiles p on p.id = n.author_id
     where n.event_id = p_event_id order by n.created_at limit 200;
end;
$$;

notify pgrst, 'reload schema';
