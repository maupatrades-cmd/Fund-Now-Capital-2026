-- Administrator (Second-in-Charge), Batch 1 (2/2): role, Founder-diary booking windows, Important /
-- after-hours requests, booking notices to the Founder with the Administrator CC'd, meeting notes.
-- Owner specification 17 Oct 2026 (docs/FNC-ADMINISTRATOR-SPEC-2026-10-17.md). Forward-only.
--
-- What the Administrator can do (enforced here, not in the screens):
--   * everything the Sales Coordinator can do in the staff workspace (intake_require_actor treats
--     'administrator' as carrying Coordinator authority);
--   * full diary rights on the Founder's calendar without a grant (view, book, change own, manage others),
--     real titles except Private ones, meeting notes, and approving Important / after-hours requests
--     (never their own).
-- What the Administrator can NOT see: funders, client success fees, commission records or splits. Staff
-- roles have no table policy on any of those tables and no staff function returns them; nothing below
-- adds one.
--
-- Booking windows on the Founder's diary (weekdays, Africa/Johannesburg; holidays closed):
--   Administrator, Sales Coordinator  08:30-14:00 (consultations and presentations: 14:00-17:00, the
--                                     window of the clients and agents they are booked for)
--   Switchboard Assistant             08:00-17:00
--   Anyone else                       14:00-17:00
--   Founder                           any time
-- Outside the window, up to 19:00: an Important (inside the day) or after-hours (17:00-19:00) request
-- with a reason, approved by the Administrator or the Founder.

-- 1. Staff role plumbing -----------------------------------------------------------------------------
alter table public.staff_access drop constraint if exists staff_access_role_ck;
alter table public.staff_access add constraint staff_access_role_ck
  check (staff_role::text in ('switchboard', 'coordinator', 'administrator'));

create or replace function public.staff_role_of()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role::text
    from public.profiles p
    join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
   where p.id = (select auth.uid())
     and p.is_active
     and s.access_enabled
     and p.role::text in ('switchboard', 'coordinator', 'administrator');
$$;

-- The Administrator carries the Coordinator's authority: a check that admits 'coordinator' admits the
-- Administrator too (and answers 'coordinator' so existing Coordinator branches apply), unless the
-- function names 'administrator' itself. The audit trail still records 'administrator' (staff_actor_role).
create or replace function public.intake_require_actor(p_allowed text[])
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.staff_actor_role();
begin
  if v_role = 'administrator' and not ('administrator' = any (p_allowed)) and 'coordinator' = any (p_allowed) then
    return 'coordinator';
  end if;
  if v_role is null or not (v_role = any (p_allowed)) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

create or replace function public.owner_set_staff_access(p_profile_id uuid, p_enabled boolean, p_contract_reference text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare
  v_role text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can enable or disable staff access' using errcode = '42501';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = p_profile_id;
  if v_role is null then raise exception 'Profile not found'; end if;
  if v_role not in ('switchboard', 'coordinator', 'administrator') then
    raise exception 'Profile is not a staff role (assign Switchboard, Sales Coordinator or Administrator first)';
  end if;

  insert into public.staff_access (profile_id, staff_role, access_enabled, contract_reference, activation_note)
  values (p_profile_id, v_role::public.user_role, coalesce(p_enabled, false),
          nullif(btrim(p_contract_reference), ''), nullif(btrim(p_note), ''))
  on conflict (profile_id) do update
    set staff_role         = excluded.staff_role,
        access_enabled     = excluded.access_enabled,
        contract_reference = coalesce(excluded.contract_reference, public.staff_access.contract_reference),
        activation_note    = coalesce(excluded.activation_note, public.staff_access.activation_note);

  perform public.staff_audit_write(
    'staff_access', p_profile_id,
    case when coalesce(p_enabled, false) then 'staff_access_enabled' else 'staff_access_disabled' end,
    p_note,
    jsonb_build_object('staff_role', v_role, 'contract_reference', nullif(btrim(p_contract_reference), '')));
  return p_profile_id;
end;
$function$;

-- 2. The Administrator's diary rights on the Founder's calendar ------------------------------------------
create or replace function public.calendar_is_founder(p_calendar_owner uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_calendar_owner and p.role::text = 'owner');
$$;
revoke all on function public.calendar_is_founder(uuid) from public, anon, authenticated;

create or replace function public.calendar_has_permission(p_calendar_owner uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_owner() then true
    when public.staff_role_of() is null then false
    -- The Administrator manages the Founder's diary without a grant.
    when public.staff_role_of() = 'administrator' and public.calendar_is_founder(p_calendar_owner) then true
    else exists (
      select 1 from public.calendar_grants g
       where g.calendar_owner_id = p_calendar_owner
         and g.grantee_id = (select auth.uid())
         and g.permission = p_permission
         and g.revoked_at is null
         and g.effective_from <= public.current_sast_date()
         and (g.effective_to is null or g.effective_to >= public.current_sast_date()))
  end;
$$;

-- Grants as the screens see them; the Administrator gets all four on the Founder's calendar.
create or replace function public.staff_my_calendar_grants()
returns table (calendar_owner_id uuid, calendar_owner_name text, permission text, effective_to date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  return query
    select g.calendar_owner_id, co.full_name, g.permission, g.effective_to
      from public.calendar_grants g join public.profiles co on co.id = g.calendar_owner_id
     where g.grantee_id = (select auth.uid()) and g.revoked_at is null
       and g.effective_from <= public.current_sast_date()
       and (g.effective_to is null or g.effective_to >= public.current_sast_date())
    union
    select o.id, o.full_name, perm, null::date
      from public.profiles o
      cross join unnest(array['view_availability', 'create', 'change_own', 'manage_others']) as perm
     where public.staff_role_of() = 'administrator' and o.role::text = 'owner' and o.is_active
     order by 2, 3;
end;
$$;

-- 3. Booking windows -----------------------------------------------------------------------------------
create or replace function public.calendar_booking_window(p_role text, p_category text)
returns table (win_start time, win_end time)
language sql immutable set search_path = '' as $$
  select case
           when p_role = 'switchboard' then time '08:00'
           when p_role in ('administrator', 'coordinator') and p_category not in ('consultation', 'presentation') then time '08:30'
           else time '14:00' end,
         case
           when p_role in ('administrator', 'coordinator') and p_category not in ('consultation', 'presentation') then time '14:00'
           else time '17:00' end;
$$;
revoke all on function public.calendar_booking_window(text, text) from public, anon, authenticated;

-- Applies to bookings on the Founder's diary by anyone but the Founder.
create or replace function public.calendar_require_booking_window(
  p_calendar_owner uuid, p_role text, p_category text, p_starts_at timestamptz, p_ends_at timestamptz)
returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  w record;
  v_s timestamp := p_starts_at at time zone 'Africa/Johannesburg';
  v_e timestamp := p_ends_at at time zone 'Africa/Johannesburg';
begin
  if p_role = 'owner' or not public.calendar_is_founder(p_calendar_owner) then return; end if;
  select * into w from public.calendar_booking_window(p_role, p_category);
  if v_s::date <> v_e::date or v_s::time < w.win_start or v_e::time > w.win_end then
    raise exception 'Your booking window on the Founder''s diary is % to %. For another time up to 19:00, send an Important or after-hours request with a reason; the Administrator or the Founder approves it.',
      to_char(w.win_start, 'HH24:MI'), to_char(w.win_end, 'HH24:MI');
  end if;
end;
$$;
revoke all on function public.calendar_require_booking_window(uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;

-- Booking and moving on the Founder's diary use the windows (copies of the current functions; only the
-- open-slot line changes).
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
  -- Administrator batch 1 (owner, 17 Oct): booking windows on the Founder's diary replace the SC4
  -- "Founder-opened slots only" rule. Other times go through an Important / after-hours request.
  perform public.calendar_require_booking_window(p_calendar_owner, v_role, p_category, p_starts_at, p_ends_at);

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

create or replace function public.staff_reschedule_calendar_event(
  p_event_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role  text;
  v_event public.owner_calendar_events;
  v_rev   integer;
  v_short boolean;
  v_rows  integer;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 or not public.staff_text_is_safe(p_reason) then
    raise exception 'A short reason is required to reschedule';
  end if;
  select * into v_event from public.owner_calendar_events e where e.id = p_event_id;
  if not found then raise exception 'Booking not found'; end if;
  perform pg_advisory_xact_lock(hashtext('owner-calendar:' || v_event.owner_id::text));
  select * into v_event from public.owner_calendar_events e where e.id = p_event_id for update;
  v_role := public.calendar_require_change_right(v_event);
  if v_event.booking_id is not null then raise exception 'Public booking requests are decided by the Owner'; end if;
  if v_event.status <> 'scheduled' or v_event.starts_at <= now() then raise exception 'Only a future scheduled booking can be rescheduled'; end if;

  perform public.calendar_validate_slot(v_event.owner_id, v_event.category, p_starts_at, p_ends_at, p_event_id, v_role <> 'owner');
  -- Booking windows replace the open-slot rule (Administrator batch 1).
  perform public.calendar_require_booking_window(v_event.owner_id, v_role, v_event.category, p_starts_at, p_ends_at);
  update public.owner_calendar_events set starts_at = p_starts_at, ends_at = p_ends_at where id = p_event_id;
  update public.owner_availability_slots s set is_open = false
   where s.owner_id = v_event.owner_id and s.is_open
     and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

  insert into public.calendar_event_changes (event_id, actor_id, actor_role, kind, from_starts, from_ends, to_starts, to_ends, reason)
  values (p_event_id, (select auth.uid()), v_role, 'rescheduled', v_event.starts_at, v_event.ends_at, p_starts_at, p_ends_at, btrim(p_reason));

  -- Supersede unsent notices, then queue one fresh notice per recipient.
  update public.calendar_confirmation_outbox set status = 'superseded'
   where event_id = p_event_id and status in ('queued', 'failed', 'processing');
  select coalesce(max(o.revision), 0) + 1 into v_rev from public.calendar_confirmation_outbox o where o.event_id = p_event_id;
  v_short := p_starts_at - now() < interval '24 hours';
  insert into public.calendar_confirmation_outbox (event_id, revision, kind, recipient_email, recipient_name, due_by, short_notice)
  select p_event_id, v_rev, case when exists (select 1 from public.calendar_confirmation_outbox sent where sent.event_id = p_event_id and sent.recipient_email = r.recipient_email and sent.status = 'sent') then 'rescheduled' else 'confirmation' end, r.recipient_email, r.recipient_name, p_starts_at - interval '24 hours', v_short
    from (select distinct on (o.recipient_email) o.recipient_email, o.recipient_name
            from public.calendar_confirmation_outbox o where o.event_id = p_event_id order by o.recipient_email, o.revision desc) r;
  get diagnostics v_rows = row_count;

  perform public.staff_audit_write('calendar_event', p_event_id, 'booking_rescheduled', p_reason,
    jsonb_build_object('notices_queued', v_rows, 'short_notice', v_short and v_rows > 0));
  return jsonb_build_object('event_id', p_event_id, 'notices_queued', v_rows, 'short_notice', v_short and v_rows > 0);
end;
$$;

-- Diary titles for the Administrator (Private stays Private).
create or replace function public.staff_calendar_diary(p_calendar_owner uuid, p_from timestamptz, p_to timestamptz)
returns table (
  event_id uuid, starts_at timestamptz, ends_at timestamptz, status text, display_title text,
  is_mine boolean, can_change boolean, lead_id uuid, notice_status text, short_notice boolean,
  needs_short_notice_handling boolean, confirmation_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_manage boolean;
  v_own boolean;
  v_admin boolean := public.staff_role_of() = 'administrator';
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  v_manage := public.calendar_has_permission(p_calendar_owner, 'manage_others');
  v_own := public.calendar_has_permission(p_calendar_owner, 'change_own');
  if not (v_manage or v_own or public.calendar_has_permission(p_calendar_owner, 'create')) then
    raise exception 'You do not have calendar permission for this action' using errcode = '42501';
  end if;
  if p_to <= p_from or p_to - p_from > interval '60 days' then raise exception 'Choose a window of up to 60 days'; end if;
  return query
    select e.id, e.starts_at, e.ends_at, e.status,
           case when e.created_by = v_uid then e.title
                -- The Administrator manages the Founder's diary: real titles, except Private ones.
                when v_admin and e.visibility <> 'private' then e.title
                when e.visibility = 'public' then e.public_title
                when e.visibility = 'private' then 'Private'
                else 'Busy' end,
           e.created_by = v_uid,
           (e.status = 'scheduled' and e.booking_id is null and e.starts_at > now()
              and (v_manage or (v_own and e.created_by = v_uid))),
           case when e.created_by = v_uid or v_manage then e.lead_id end,
           case when e.created_by = v_uid or v_manage then c.status end,
           case when e.created_by = v_uid or v_manage then coalesce(c.short_notice, false) else false end,
           case when e.created_by = v_uid or v_manage then (coalesce(c.short_notice, false) and c.handled_at is null) else false end,
           case when e.created_by = v_uid or v_manage then c.id end
      from public.owner_calendar_events e
      left join lateral (select o.id, o.status, o.short_notice, o.handled_at from public.calendar_confirmation_outbox o
                          where o.event_id = e.id order by o.revision desc, o.created_at desc limit 1) c on true
     where e.owner_id = p_calendar_owner and e.status in ('scheduled', 'cancelled')
       and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
     order by e.starts_at
     limit 200;
end;
$$;

-- 4. Important / after-hours requests ------------------------------------------------------------------
alter table public.calendar_time_requests add column if not exists kind text
  check (kind is null or kind in ('important', 'after_hours'));

create or replace function public.staff_request_founder_time(
  p_calendar_owner uuid, p_category text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_reason text, p_lead_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_id uuid; v_kind text;
  v_s timestamp := p_starts_at at time zone 'Africa/Johannesburg';
  v_e timestamp := p_ends_at at time zone 'Africa/Johannesburg';
begin
  perform public.calendar_require_permission(p_calendar_owner, 'create');
  if p_category not in ('consultation', 'submission', 'submission_update', 'call', 'presentation', 'paperwork_review') then
    raise exception 'Unsupported booking category';
  end if;
  if p_ends_at <= p_starts_at or p_starts_at <= now() or p_ends_at - p_starts_at > interval '12 hours' then
    raise exception 'A request must be a future interval no longer than twelve hours';
  end if;
  -- Owner rule (17 Oct): weekdays only, nothing before 08:00 or after 19:00, public holidays closed.
  if v_s::date <> v_e::date or v_s::time < time '08:00' or v_e::time > time '19:00' then
    raise exception 'Requests must fall between 08:00 and 19:00 on one day';
  end if;
  if extract(isodow from v_s) > 5 then raise exception 'Bookings are not taken on weekends'; end if;
  if exists (select 1 from public.business_holidays h where h.holiday_date = v_s::date) then
    raise exception 'That day is a public holiday';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 or not public.staff_text_is_safe(p_reason) then
    raise exception 'Give a reason of at least 10 characters, without ID or account numbers';
  end if;
  if (select count(*) from public.calendar_time_requests r where r.requester_id = v_uid and r.status = 'pending') >= 5 then
    raise exception 'You already have 5 requests waiting for a decision';
  end if;
  v_kind := case when v_e::time > time '17:00' then 'after_hours' else 'important' end;
  insert into public.calendar_time_requests (requester_id, calendar_owner_id, category, starts_at, ends_at, reason, lead_id, kind)
  values (v_uid, p_calendar_owner, p_category, p_starts_at, p_ends_at, btrim(p_reason), p_lead_id, v_kind) returning id into v_id;
  perform public.staff_audit_write('calendar_time_request', v_id, 'time_requested', null,
    jsonb_build_object('calendar_owner', p_calendar_owner, 'category', p_category, 'kind', v_kind));
  return v_id;
end;
$$;

-- Requesters see their own requests; the Founder and the Administrator see all of them.
create or replace function public.staff_time_requests(p_status text default null)
returns table (id uuid, category text, starts_at timestamptz, ends_at timestamptz, reason text, status text,
               owner_note text, requester_name text, created_at timestamptz, decided_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_role text; v_uid uuid := (select auth.uid()); v_all boolean;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  v_all := v_role = 'owner' or public.staff_role_of() = 'administrator';
  return query
    select r.id, r.category, r.starts_at, r.ends_at, r.reason, r.status, r.owner_note, p.full_name, r.created_at, r.decided_at
      from public.calendar_time_requests r join public.profiles p on p.id = r.requester_id
     where (v_all or r.requester_id = v_uid) and (p_status is null or r.status = p_status)
     order by r.created_at desc limit 100;
end;
$$;

-- The Founder or the Administrator decides; nobody decides their own request.
create or replace function public.owner_decide_time_request(p_request_id uuid, p_accept boolean, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.calendar_time_requests; v_uid uuid := (select auth.uid()); v_event uuid;
begin
  if not (public.is_owner() or public.staff_role_of() = 'administrator') then
    raise exception 'Only the Founder or the Administrator can decide' using errcode = '42501';
  end if;
  select * into r from public.calendar_time_requests where id = p_request_id for update;
  if not found or r.status <> 'pending' then raise exception 'That request is not waiting'; end if;
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

-- 5. Booking notices: the Founder, with the Administrator CC'd ------------------------------------------
-- In-app only (no email template exists for this event yet). A failed notice never blocks a booking.
create or replace function public.diary_notify(p_user uuid, p_title text, p_body text, p_link text, p_data jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_on boolean;
begin
  if p_user is null then return; end if;
  v_on := public.check_notification_channel_enabled(p_user, 'DIARY_BOOKING_CHANGED', 'in_app');
  insert into public.notifications (user_id, event_type, title, body_text, link_url, data, read_status, read_at)
  values (p_user, 'DIARY_BOOKING_CHANGED', p_title, p_body, p_link, p_data, not v_on, case when v_on then null else now() end)
  returning id into v_id;
  insert into public.notification_deliveries (notification_id, channel, delivery_status, sent_at, delivered_at)
  values (v_id, 'in_app', (case when v_on then 'delivered' else 'skipped' end)::public.notification_delivery_status,
          case when v_on then now() end, case when v_on then now() end);
end;
$$;
revoke all on function public.diary_notify(uuid, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.diary_booking_notice()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text; v_when text; v_actor uuid := (select auth.uid()); a record;
begin
  if tg_op = 'INSERT' then v_kind := 'created';
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then v_kind := 'cancelled';
  elsif new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then v_kind := 'moved';
  else return null; end if;
  if not public.calendar_is_founder(new.owner_id) then return null; end if;
  begin
    v_when := to_char(new.starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI') || ' to '
           || to_char(new.ends_at at time zone 'Africa/Johannesburg', 'HH24:MI');
    if new.owner_id is distinct from v_actor then
      perform public.diary_notify(new.owner_id, 'Diary: booking ' || v_kind, coalesce(new.title, 'Booking') || ' · ' || v_when,
        '/calendar', jsonb_build_object('event_id', new.id, 'change', v_kind));
    end if;
    for a in select p.id from public.profiles p join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
              where p.role::text = 'administrator' and p.is_active and s.access_enabled and p.id is distinct from v_actor loop
      perform public.diary_notify(a.id, 'Diary: booking ' || v_kind || ' (CC)',
        case when new.visibility = 'private' then 'Private booking' else coalesce(new.title, 'Booking') end || ' · ' || v_when,
        '/staff/diary', jsonb_build_object('event_id', new.id, 'change', v_kind));
    end loop;
  exception when others then
    raise warning 'diary booking notice failed for %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
create trigger owner_calendar_events_diary_notice
  after insert or update of starts_at, ends_at, status on public.owner_calendar_events
  for each row execute function public.diary_booking_notice();

-- 6. Meeting notes on the Founder's bookings (Founder and Administrator) -----------------------------------
create table if not exists public.calendar_meeting_notes (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.owner_calendar_events(id) on delete restrict,
  author_id  uuid not null references public.profiles(id) on delete restrict,
  note       text not null check (length(btrim(note)) between 3 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists calendar_meeting_notes_event_idx on public.calendar_meeting_notes (event_id, created_at);
alter table public.calendar_meeting_notes enable row level security;
revoke all on table public.calendar_meeting_notes from public, anon, authenticated;
create trigger calendar_meeting_notes_append_only before update or delete on public.calendar_meeting_notes
  for each row execute function public.intake_append_only_guard();

create or replace function public.staff_add_meeting_note(p_event_id uuid, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_id uuid;
begin
  if not (public.is_owner() or public.staff_role_of() = 'administrator') then
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
  if not (public.is_owner() or public.staff_role_of() = 'administrator') then
    raise exception 'Only the Founder or the Administrator reads meeting notes' using errcode = '42501';
  end if;
  return query
    select n.id, p.full_name, n.note, n.created_at
      from public.calendar_meeting_notes n join public.profiles p on p.id = n.author_id
     where n.event_id = p_event_id order by n.created_at limit 200;
end;
$$;

revoke all on function public.staff_add_meeting_note(uuid, text) from public, anon;
revoke all on function public.staff_meeting_notes(uuid) from public, anon;
grant execute on function public.staff_add_meeting_note(uuid, text) to authenticated;
grant execute on function public.staff_meeting_notes(uuid) to authenticated;

notify pgrst, 'reload schema';
