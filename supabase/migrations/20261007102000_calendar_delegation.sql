-- Staff build, Batch 3 (1/2): delegated calendars, conflict-safe bookings,
-- once-only confirmations, Team Leader / partner check-in reminders.
--
-- Builds on the existing Owner calendar (owner_calendar_events with its
-- exclusion constraint, owner_availability_slots, crm_bookings). Nothing existing
-- is altered. Delegated writes take the SAME advisory lock the Owner RPCs take
-- ('owner-calendar:<owner>'), so an Owner edit and a staff booking can never
-- interleave into an overlap.
--
-- Four SEPARATE permissions, granted by the Owner per calendar and per person,
-- effective-dated and revocable (revocation applies on the next call):
--   view_availability   see busy/open blocks only (no titles, no categories)
--   create              create bookings on that calendar
--   change_own          reschedule/cancel bookings the person created
--   manage_others       reschedule/cancel anyone's booking on that calendar
-- None implies another. Private details are never returned: a title is shown
-- only for the person's own bookings or events the Owner marked 'public'.
--
-- Confirmations are queued once per (event, recipient, revision). Nothing here
-- sends a message; status never goes beyond what a provider call recorded, and
-- no real sender is wired in this migration.

-- ---------------------------------------------------------------------------
-- 1. Grants, settings, holidays
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_grants (
  id                uuid primary key default gen_random_uuid(),
  calendar_owner_id uuid not null references public.profiles(id) on delete restrict,
  grantee_id        uuid not null references public.profiles(id) on delete restrict,
  permission        text not null check (permission in ('view_availability', 'create', 'change_own', 'manage_others')),
  effective_from    date not null default public.current_sast_date(),
  effective_to      date,
  granted_by        uuid not null references public.profiles(id) on delete restrict,
  created_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  revoked_by        uuid references public.profiles(id) on delete restrict,
  revoke_reason     text,
  constraint calendar_grants_dates_ck check (effective_to is null or effective_to >= effective_from),
  constraint calendar_grants_revoke_ck check ((revoked_at is null) = (revoked_by is null))
);
create unique index if not exists calendar_grants_live_uq
  on public.calendar_grants (calendar_owner_id, grantee_id, permission) where revoked_at is null;
create index if not exists calendar_grants_grantee_idx on public.calendar_grants (grantee_id) where revoked_at is null;

create table if not exists public.calendar_settings (
  calendar_owner_id uuid primary key references public.profiles(id) on delete cascade,
  buffer_minutes    integer not null default 15 check (buffer_minutes between 0 and 120),
  day_start         time not null default time '08:00',
  day_end           time not null default time '20:00',
  updated_at        timestamptz not null default now(),
  constraint calendar_settings_hours_ck check (day_end > day_start)
);

-- Explicit business-day calendar. Empty until the Owner enters public holidays;
-- no dates are invented here.
create table if not exists public.business_holidays (
  holiday_date date primary key,
  label        text not null check (length(btrim(label)) between 2 and 80),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- Idempotent create: one key per actor returns the same event on retry.
create table if not exists public.calendar_delegated_requests (
  actor_id        uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null check (length(idempotency_key) between 8 and 120),
  event_id        uuid not null references public.owner_calendar_events(id) on delete restrict,
  created_at      timestamptz not null default now(),
  primary key (actor_id, idempotency_key)
);

-- Append-only history of delegated bookings, reschedules and cancellations.
create table if not exists public.calendar_event_changes (
  id          bigint generated always as identity primary key,
  event_id    uuid not null references public.owner_calendar_events(id) on delete restrict,
  at          timestamptz not null default now(),
  actor_id    uuid not null references public.profiles(id) on delete restrict,
  actor_role  text not null,
  kind        text not null check (kind in ('created', 'rescheduled', 'cancelled')),
  from_starts timestamptz,
  from_ends   timestamptz,
  to_starts   timestamptz,
  to_ends     timestamptz,
  reason      text check (reason is null or length(reason) <= 300)
);
create index if not exists calendar_event_changes_event_idx on public.calendar_event_changes (event_id, id);

drop trigger if exists calendar_event_changes_append_only on public.calendar_event_changes;
create trigger calendar_event_changes_append_only
  before update or delete on public.calendar_event_changes
  for each row execute function public.switchboard_append_only_guard();

-- Confirmation outbox: one row per (event, recipient, revision). A reschedule or
-- cancellation supersedes still-queued older rows so a stale notice is never sent.
create table if not exists public.calendar_confirmation_outbox (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.owner_calendar_events(id) on delete restrict,
  revision        integer not null default 1 check (revision >= 1),
  kind            text not null default 'confirmation' check (kind in ('confirmation', 'rescheduled', 'cancelled')),
  recipient_email text not null check (length(recipient_email) <= 160),
  recipient_name  text check (recipient_name is null or length(recipient_name) <= 120),
  status          text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'failed', 'superseded')),
  attempts        integer not null default 0 check (attempts >= 0),
  external_id     text,
  error_message   text,
  due_by          timestamptz not null,
  short_notice    boolean not null default false,
  handling_note   text check (handling_note is null or length(handling_note) <= 300),
  handled_by      uuid references public.profiles(id) on delete set null,
  handled_at      timestamptz,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  updated_at      timestamptz not null default now(),
  constraint calendar_confirmation_once_uq unique (event_id, recipient_email, revision),
  constraint calendar_confirmation_sent_ck check ((status = 'sent') = (sent_at is not null)),
  constraint calendar_confirmation_handling_ck check ((handled_by is null) = (handled_at is null))
);
create index if not exists calendar_confirmation_pending_idx
  on public.calendar_confirmation_outbox (status, created_at) where status in ('queued', 'failed');
drop trigger if exists calendar_confirmation_outbox_updated_at on public.calendar_confirmation_outbox;
create trigger calendar_confirmation_outbox_updated_at
  before update on public.calendar_confirmation_outbox
  for each row execute function public.set_updated_at();

-- Check-in reminders for the Coordinator: Team Leader weekly, organisation every
-- two weeks. One row per (subject, period) so reruns never duplicate.
create table if not exists public.staff_checkin_reminders (
  id           uuid primary key default gen_random_uuid(),
  subject_kind text not null check (subject_kind in ('team', 'organisation')),
  subject_id   uuid not null,
  cadence      text not null check (cadence in ('weekly', 'fortnightly')),
  period_key   text not null,
  due_on       date not null,
  status       text not null default 'open' check (status in ('open', 'done', 'skipped')),
  completed_by uuid references public.profiles(id) on delete restrict,
  completed_at timestamptz,
  note         text check (note is null or length(note) <= 500),
  created_at   timestamptz not null default now(),
  constraint staff_checkin_period_uq unique (subject_kind, subject_id, period_key),
  constraint staff_checkin_done_ck check ((status = 'done') = (completed_by is not null and completed_at is not null)),
  constraint staff_checkin_safe_text_ck check (public.staff_text_is_safe(note))
);
create index if not exists staff_checkin_open_idx on public.staff_checkin_reminders (due_on) where status = 'open';

-- ---------------------------------------------------------------------------
-- RLS: Owner reads; every write is a function below.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['calendar_grants', 'calendar_settings', 'business_holidays', 'calendar_delegated_requests',
                           'calendar_event_changes', 'calendar_confirmation_outbox', 'staff_checkin_reminders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_owner())', t || '_owner_select', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Permission helper and slot validation (private)
-- ---------------------------------------------------------------------------
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

create or replace function public.calendar_require_permission(p_calendar_owner uuid, p_permission text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.staff_actor_role();
begin
  if v_role is null or not public.calendar_has_permission(p_calendar_owner, p_permission) then
    raise exception 'You do not have calendar permission for this action' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

-- All slot rules in one place. p_actor_is_owner skips the staff-only business-
-- hours rule so the Owner can still book outside hours through other doors.
create or replace function public.calendar_validate_slot(
  p_calendar_owner uuid, p_category text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_exclude_event uuid default null, p_enforce_business_rules boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buffer  integer := 15;
  v_start   time := time '08:00';
  v_end     time := time '20:00';
  v_s_local timestamp := p_starts_at at time zone 'Africa/Johannesburg';
  v_e_local timestamp := p_ends_at at time zone 'Africa/Johannesburg';
begin
  select s.buffer_minutes, s.day_start, s.day_end into v_buffer, v_start, v_end
    from public.calendar_settings s where s.calendar_owner_id = p_calendar_owner;
  v_buffer := coalesce(v_buffer, 15); v_start := coalesce(v_start, time '08:00'); v_end := coalesce(v_end, time '20:00');

  if p_category not in ('urgent', 'submission', 'submission_update', 'consultation', 'presentation', 'call', 'paperwork_review') then
    raise exception 'Unsupported booking category';
  end if;
  if p_ends_at <= p_starts_at or p_starts_at <= now() or p_ends_at - p_starts_at > interval '12 hours' then
    raise exception 'A booking must be a future interval no longer than twelve hours';
  end if;
  if p_enforce_business_rules then
    if v_s_local::date <> v_e_local::date or v_s_local::time < v_start or v_e_local::time > v_end then
      raise exception 'A booking must fall inside business hours (% to %) on one day', v_start, v_end;
    end if;
    if extract(isodow from v_s_local) > 5 then raise exception 'Bookings are not taken on weekends'; end if;
    if exists (select 1 from public.business_holidays h where h.holiday_date = v_s_local::date) then
      raise exception 'That day is a public holiday';
    end if;
  end if;
  if p_category = 'consultation' and not public.calendar_is_consultation_window(p_starts_at, p_ends_at) then
    raise exception 'Consultations must be between 14:00 and 20:00 Africa/Johannesburg on one day';
  end if;

  -- Overlap including the buffer, against events and active bookings.
  if exists (select 1 from public.owner_calendar_events e
              where e.owner_id = p_calendar_owner and e.status = 'scheduled'
                and (p_exclude_event is null or e.id <> p_exclude_event)
                and tstzrange(e.starts_at - make_interval(mins => v_buffer), e.ends_at + make_interval(mins => v_buffer), '[)')
                    && tstzrange(p_starts_at, p_ends_at, '[)')) then
    raise exception 'That time overlaps another booking or its buffer';
  end if;
  if exists (select 1 from public.crm_bookings b join public.owner_availability_slots s on s.id = b.slot_id
              where s.owner_id = p_calendar_owner and b.status in ('requested', 'confirmed')
                and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')) then
    raise exception 'That time overlaps an active booking';
  end if;
end;
$$;

revoke all on function public.calendar_has_permission(uuid, text) from public, anon, authenticated;
revoke all on function public.calendar_require_permission(uuid, text) from public, anon, authenticated;
revoke all on function public.calendar_validate_slot(uuid, text, timestamptz, timestamptz, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Owner administration: grants, settings, holidays
-- ---------------------------------------------------------------------------
create or replace function public.owner_set_calendar_grant(
  p_calendar_owner uuid, p_grantee uuid, p_permission text, p_effective_to date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_owner() then raise exception 'Only the owner can grant calendar permissions' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_calendar_owner and p.is_active) then
    raise exception 'Calendar owner not found';
  end if;
  if not exists (select 1 from public.staff_access s join public.profiles p on p.id = s.profile_id
                  where s.profile_id = p_grantee and s.access_enabled and p.is_active) then
    raise exception 'The grantee must be an enabled staff member';
  end if;
  begin
    insert into public.calendar_grants (calendar_owner_id, grantee_id, permission, effective_to, granted_by)
    values (p_calendar_owner, p_grantee, p_permission, p_effective_to, (select auth.uid()))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'That permission is already granted; revoke it first to change it';
  end;
  perform public.staff_audit_write('calendar_grant', v_id, 'calendar_grant_created', null,
    jsonb_build_object('calendar_owner', p_calendar_owner, 'grantee', p_grantee, 'permission', p_permission, 'effective_to', p_effective_to));
  return v_id;
end;
$$;

create or replace function public.owner_revoke_calendar_grant(p_grant_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can revoke calendar permissions' using errcode = '42501'; end if;
  update public.calendar_grants
     set revoked_at = now(), revoked_by = (select auth.uid()), revoke_reason = nullif(btrim(p_reason), '')
   where id = p_grant_id and revoked_at is null;
  if not found then raise exception 'Grant not found or already revoked'; end if;
  perform public.staff_audit_write('calendar_grant', p_grant_id, 'calendar_grant_revoked', p_reason, '{}'::jsonb);
end;
$$;

create or replace function public.owner_calendar_grant_list()
returns table (
  id uuid, calendar_owner_id uuid, calendar_owner_name text, grantee_id uuid, grantee_name text,
  permission text, effective_from date, effective_to date, revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can list calendar permissions' using errcode = '42501'; end if;
  return query
    select g.id, g.calendar_owner_id, co.full_name, g.grantee_id, gp.full_name, g.permission,
           g.effective_from, g.effective_to, g.revoked_at
      from public.calendar_grants g
      join public.profiles co on co.id = g.calendar_owner_id
      join public.profiles gp on gp.id = g.grantee_id
     order by (g.revoked_at is null) desc, g.created_at desc
     limit 200;
end;
$$;

create or replace function public.owner_set_calendar_settings(
  p_calendar_owner uuid, p_buffer_minutes integer, p_day_start time, p_day_end time
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can change calendar settings' using errcode = '42501'; end if;
  insert into public.calendar_settings (calendar_owner_id, buffer_minutes, day_start, day_end)
  values (p_calendar_owner, p_buffer_minutes, p_day_start, p_day_end)
  on conflict (calendar_owner_id) do update
    set buffer_minutes = excluded.buffer_minutes, day_start = excluded.day_start, day_end = excluded.day_end, updated_at = now();
  perform public.staff_audit_write('calendar_settings', p_calendar_owner, 'calendar_settings_changed', null,
    jsonb_build_object('buffer_minutes', p_buffer_minutes, 'day_start', p_day_start, 'day_end', p_day_end));
end;
$$;

create or replace function public.owner_set_business_holiday(p_date date, p_label text, p_remove boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can edit the holiday calendar' using errcode = '42501'; end if;
  if coalesce(p_remove, false) then
    delete from public.business_holidays where holiday_date = p_date;
  else
    insert into public.business_holidays (holiday_date, label, created_by) values (p_date, p_label, (select auth.uid()))
    on conflict (holiday_date) do update set label = excluded.label;
  end if;
  perform public.staff_audit_write('business_holiday', null, case when coalesce(p_remove, false) then 'holiday_removed' else 'holiday_set' end,
    null, jsonb_build_object('date', p_date));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Staff: my grants, availability, create, reschedule, cancel
-- ---------------------------------------------------------------------------
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
     order by co.full_name, g.permission;
end;
$$;

-- Busy/open blocks only. No titles, no categories, no lead links.
create or replace function public.calendar_availability(p_calendar_owner uuid, p_from timestamptz, p_to timestamptz)
returns table (kind text, starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.calendar_require_permission(p_calendar_owner, 'view_availability');
  if p_to <= p_from or p_to - p_from > interval '60 days' then raise exception 'Choose a window of up to 60 days'; end if;
  return query
    (select 'busy'::text, e.starts_at, e.ends_at from public.owner_calendar_events e
      where e.owner_id = p_calendar_owner and e.status = 'scheduled'
        and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
     union all
     select 'busy'::text, s.starts_at, s.ends_at from public.crm_bookings b
       join public.owner_availability_slots s on s.id = b.slot_id
      where s.owner_id = p_calendar_owner and b.status in ('requested', 'confirmed')
        and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
     union all
     select 'open'::text, s.starts_at, s.ends_at from public.owner_availability_slots s
      where s.owner_id = p_calendar_owner and s.is_open and s.starts_at > now()
        and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_from, p_to, '[)'))
    order by 2
    limit 500;
end;
$$;

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

-- Shared permission test for changing a booking.
create or replace function public.calendar_require_change_right(p_event public.owner_calendar_events)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.staff_actor_role();
begin
  if v_role is null then raise exception 'You do not have calendar permission for this action' using errcode = '42501'; end if;
  if public.calendar_has_permission(p_event.owner_id, 'manage_others')
     or (p_event.created_by = (select auth.uid()) and public.calendar_has_permission(p_event.owner_id, 'change_own')) then
    return v_role;
  end if;
  raise exception 'You do not have calendar permission to change this booking' using errcode = '42501';
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
  update public.owner_calendar_events set starts_at = p_starts_at, ends_at = p_ends_at where id = p_event_id;
  update public.owner_availability_slots s set is_open = false
   where s.owner_id = v_event.owner_id and s.is_open
     and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

  insert into public.calendar_event_changes (event_id, actor_id, actor_role, kind, from_starts, from_ends, to_starts, to_ends, reason)
  values (p_event_id, (select auth.uid()), v_role, 'rescheduled', v_event.starts_at, v_event.ends_at, p_starts_at, p_ends_at, btrim(p_reason));

  -- Supersede unsent notices, then queue one fresh notice per recipient.
  update public.calendar_confirmation_outbox set status = 'superseded'
   where event_id = p_event_id and status in ('queued', 'failed');
  select coalesce(max(o.revision), 0) + 1 into v_rev from public.calendar_confirmation_outbox o where o.event_id = p_event_id;
  v_short := p_starts_at - now() < interval '24 hours';
  insert into public.calendar_confirmation_outbox (event_id, revision, kind, recipient_email, recipient_name, due_by, short_notice)
  select p_event_id, v_rev, 'rescheduled', r.recipient_email, r.recipient_name, p_starts_at - interval '24 hours', v_short
    from (select distinct on (o.recipient_email) o.recipient_email, o.recipient_name
            from public.calendar_confirmation_outbox o where o.event_id = p_event_id order by o.recipient_email, o.revision desc) r;
  get diagnostics v_rows = row_count;

  perform public.staff_audit_write('calendar_event', p_event_id, 'booking_rescheduled', p_reason,
    jsonb_build_object('notices_queued', v_rows, 'short_notice', v_short and v_rows > 0));
  return jsonb_build_object('event_id', p_event_id, 'notices_queued', v_rows, 'short_notice', v_short and v_rows > 0);
end;
$$;

create or replace function public.staff_cancel_calendar_event(p_event_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role  text;
  v_event public.owner_calendar_events;
  v_rev   integer;
  v_rows  integer;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 or not public.staff_text_is_safe(p_reason) then
    raise exception 'A short reason is required to cancel';
  end if;
  select * into v_event from public.owner_calendar_events e where e.id = p_event_id;
  if not found then raise exception 'Booking not found'; end if;
  perform pg_advisory_xact_lock(hashtext('owner-calendar:' || v_event.owner_id::text));
  select * into v_event from public.owner_calendar_events e where e.id = p_event_id for update;
  v_role := public.calendar_require_change_right(v_event);
  if v_event.booking_id is not null then raise exception 'Public booking requests are decided by the Owner'; end if;
  if v_event.status <> 'scheduled' then raise exception 'Only a scheduled booking can be cancelled'; end if;

  update public.owner_calendar_events set status = 'cancelled' where id = p_event_id;
  insert into public.calendar_event_changes (event_id, actor_id, actor_role, kind, from_starts, from_ends, reason)
  values (p_event_id, (select auth.uid()), v_role, 'cancelled', v_event.starts_at, v_event.ends_at, btrim(p_reason));

  update public.calendar_confirmation_outbox set status = 'superseded'
   where event_id = p_event_id and status in ('queued', 'failed');
  select coalesce(max(o.revision), 0) + 1 into v_rev from public.calendar_confirmation_outbox o where o.event_id = p_event_id;
  insert into public.calendar_confirmation_outbox (event_id, revision, kind, recipient_email, recipient_name, due_by, short_notice)
  select p_event_id, v_rev, 'cancelled', r.recipient_email, r.recipient_name, now(), false
    from (select distinct on (o.recipient_email) o.recipient_email, o.recipient_name
            from public.calendar_confirmation_outbox o where o.event_id = p_event_id and o.kind <> 'cancelled'
           order by o.recipient_email, o.revision desc) r;
  get diagnostics v_rows = row_count;

  perform public.staff_audit_write('calendar_event', p_event_id, 'booking_cancelled', p_reason, jsonb_build_object('notices_queued', v_rows));
  return jsonb_build_object('event_id', p_event_id, 'notices_queued', v_rows);
end;
$$;

-- Short-notice (under 24h) meetings are flagged, never silently treated as
-- compliant; a person with change rights records how it was handled.
create or replace function public.staff_record_short_notice_handling(p_confirmation_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conf  public.calendar_confirmation_outbox;
  v_event public.owner_calendar_events;
begin
  if length(btrim(coalesce(p_note, ''))) < 3 or not public.staff_text_is_safe(p_note) then raise exception 'A short handling note is required'; end if;
  select * into v_conf from public.calendar_confirmation_outbox c where c.id = p_confirmation_id for update;
  if not found then raise exception 'Notice not found'; end if;
  select * into v_event from public.owner_calendar_events e where e.id = v_conf.event_id;
  perform public.calendar_require_change_right(v_event);
  if not v_conf.short_notice then raise exception 'This notice was not short-notice'; end if;
  update public.calendar_confirmation_outbox
     set handling_note = btrim(p_note), handled_by = (select auth.uid()), handled_at = now()
   where id = p_confirmation_id;
  perform public.staff_audit_write('calendar_event', v_conf.event_id, 'short_notice_handled', p_note, '{}'::jsonb);
end;
$$;

-- The diary the Coordinator manages. Titles only for the person's own bookings
-- or events the Owner marked 'public'; everything else reads "Busy"/"Private".
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

-- Confirmation delivery (service role only, mirrors the existing booking outbox).
create or replace function public.claim_calendar_confirmation(p_id uuid)
returns public.calendar_confirmation_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.calendar_confirmation_outbox;
begin
  update public.calendar_confirmation_outbox
     set status = 'processing', attempts = attempts + 1, error_message = null
   where id = p_id
     and (status in ('queued', 'failed') or (status = 'processing' and updated_at < now() - interval '15 minutes'))
     and attempts < 5
  returning * into v_row;
  if not found then raise exception 'Notice is not claimable'; end if;
  return v_row;
end;
$$;

create or replace function public.record_calendar_confirmation_result(
  p_id uuid, p_status text, p_external_id text default null, p_error text default null
)
returns public.calendar_confirmation_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.calendar_confirmation_outbox;
begin
  if p_status not in ('sent', 'failed') then raise exception 'Unsupported delivery result'; end if;
  update public.calendar_confirmation_outbox
     set status = p_status, external_id = nullif(btrim(p_external_id), ''),
         error_message = case when p_status = 'failed' then left(nullif(btrim(p_error), ''), 1000) end,
         sent_at = case when p_status = 'sent' then now() end
   where id = p_id and status = 'processing'
  returning * into v_row;
  if not found then raise exception 'Notice is not processing'; end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Check-in reminders (Team Leader weekly, organisation fortnightly)
-- ---------------------------------------------------------------------------
create or replace function public.generate_staff_checkin_reminders(p_as_of date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d      date := coalesce(p_as_of, public.current_sast_date());
  v_friday date := v_d + (5 - extract(isodow from v_d)::int);
  v_week   text := to_char(v_d, 'IYYY-"W"IW');
  v_fort   text := to_char(v_d, 'IYYY') || '-F' || ((extract(week from v_d)::int + 1) / 2)::text;
  v_n      integer := 0;
  v_rows   integer;
begin
  -- A subject that has ended (inactive team, no current leader, inactive
  -- organisation) stops generating, and its open reminders are skipped.
  update public.staff_checkin_reminders r set status = 'skipped'
   where r.status = 'open' and (
     (r.subject_kind = 'team' and not exists (
        select 1 from public.referral_teams t join public.referral_team_memberships m on m.team_id = t.id
         where t.id = r.subject_id and t.is_active and m.membership_role = 'team_leader'
           and m.effective_from <= v_d and (m.effective_to is null or m.effective_to >= v_d)))
     or (r.subject_kind = 'organisation' and not exists (
        select 1 from public.referral_partners o where o.id = r.subject_id and o.is_active)));

  insert into public.staff_checkin_reminders (subject_kind, subject_id, cadence, period_key, due_on)
  select 'team', t.id, 'weekly', v_week, v_friday
    from public.referral_teams t
   where t.is_active and exists (
     select 1 from public.referral_team_memberships m
      where m.team_id = t.id and m.membership_role = 'team_leader'
        and m.effective_from <= v_d and (m.effective_to is null or m.effective_to >= v_d))
  on conflict (subject_kind, subject_id, period_key) do nothing;
  get diagnostics v_rows = row_count; v_n := v_n + v_rows;

  insert into public.staff_checkin_reminders (subject_kind, subject_id, cadence, period_key, due_on)
  select 'organisation', o.id, 'fortnightly', v_fort, v_friday
    from public.referral_partners o where o.is_active
  on conflict (subject_kind, subject_id, period_key) do nothing;
  get diagnostics v_rows = row_count; v_n := v_n + v_rows;
  return v_n;
end;
$$;

create or replace function public.owner_run_checkin_generation()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can run reminder generation' using errcode = '42501'; end if;
  return public.generate_staff_checkin_reminders(null);
end;
$$;

create or replace function public.staff_checkin_list(p_status text default 'open')
returns table (
  id uuid, subject_kind text, subject_name text, leader_name text, cadence text, due_on date, status text,
  overdue boolean, completed_by_name text, completed_at timestamptz, note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  return query
    select r.id, r.subject_kind,
           case r.subject_kind when 'team' then t.name else o.name end,
           case when r.subject_kind = 'team' then (
             select p.full_name from public.referral_team_memberships m join public.profiles p on p.id = m.profile_id
              where m.team_id = r.subject_id and m.membership_role = 'team_leader'
                and m.effective_from <= public.current_sast_date()
                and (m.effective_to is null or m.effective_to >= public.current_sast_date()) limit 1) end,
           r.cadence, r.due_on, r.status, (r.status = 'open' and r.due_on < public.current_sast_date()),
           cp.full_name, r.completed_at, r.note
      from public.staff_checkin_reminders r
      left join public.referral_teams t on r.subject_kind = 'team' and t.id = r.subject_id
      left join public.referral_partners o on r.subject_kind = 'organisation' and o.id = r.subject_id
      left join public.profiles cp on cp.id = r.completed_by
     where p_status is null or r.status = p_status
     order by r.due_on, r.created_at
     limit 100;
end;
$$;

create or replace function public.staff_complete_checkin(p_reminder_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  if not public.staff_text_is_safe(p_note) then raise exception 'The note cannot contain ID or account-length numbers'; end if;
  update public.staff_checkin_reminders
     set status = 'done', completed_by = (select auth.uid()), completed_at = now(), note = nullif(btrim(p_note), '')
   where id = p_reminder_id and status = 'open';
  if not found then raise exception 'Reminder not found or already closed'; end if;
  perform public.staff_audit_write('staff_checkin', p_reminder_id, 'checkin_completed', p_note, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Task completion returns to the originating call
-- ---------------------------------------------------------------------------
create or replace function public.staff_call_tasks(p_call_log_id uuid)
returns table (
  task_id uuid, title text, status text, route_to text, due_at timestamptz,
  completed_by_name text, completed_at timestamptz, completion_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  return query
    select t.id, t.title, t.status, t.route_to, t.due_at, cp.full_name, t.completed_at, t.completion_note
      from public.staff_tasks t left join public.profiles cp on cp.id = t.completed_by
     where t.call_log_id = p_call_log_id
     order by t.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.calendar_require_change_right(public.owner_calendar_events) from public, anon, authenticated;
revoke all on function public.generate_staff_checkin_reminders(date) from public, anon, authenticated;
revoke all on function public.claim_calendar_confirmation(uuid) from public, anon, authenticated;
revoke all on function public.record_calendar_confirmation_result(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_calendar_confirmation(uuid) to service_role;
grant execute on function public.record_calendar_confirmation_result(uuid, text, text, text) to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.owner_set_calendar_grant(uuid,uuid,text,date)',
    'public.owner_revoke_calendar_grant(uuid,text)',
    'public.owner_calendar_grant_list()',
    'public.owner_set_calendar_settings(uuid,integer,time,time)',
    'public.owner_set_business_holiday(date,text,boolean)',
    'public.owner_run_checkin_generation()',
    'public.staff_my_calendar_grants()',
    'public.calendar_availability(uuid,timestamptz,timestamptz)',
    'public.staff_create_calendar_event(uuid,text,text,timestamptz,timestamptz,text,text,text,uuid,text,text,text)',
    'public.staff_reschedule_calendar_event(uuid,timestamptz,timestamptz,text)',
    'public.staff_cancel_calendar_event(uuid,text)',
    'public.staff_record_short_notice_handling(uuid,text)',
    'public.staff_calendar_diary(uuid,timestamptz,timestamptz)',
    'public.staff_checkin_list(text)',
    'public.staff_complete_checkin(uuid,text)',
    'public.staff_call_tasks(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
