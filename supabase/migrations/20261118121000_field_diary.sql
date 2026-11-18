-- Field diary (owner, 17 Nov 2026) (2/2): the Field Supervisor and field consultants book meetings (with a client or
-- lead, or internal) and see their day and week.
--
-- Why a new table: the staff Diary page is the desk's day (callbacks, handovers, check-ins, delegated Founder calendars)
-- and team diaries book client meetings into AGENTS' diaries. Neither has a per-person diary for field staff, so this adds
-- the smallest one: public.field_meetings, reached only through the SECURITY DEFINER functions below.
--
-- Who sees and books what:
--   * a field consultant: their own diary;
--   * the Field Supervisor: their own diary and every field consultant's (there is no team table yet), and may book a
--     meeting on a consultant's diary (the consultant is told);
--   * the Director and the Office Administrator: every field diary, and may book on any of them.
-- Meetings on one person's diary never overlap (scheduled ones). Cancelling needs a reason; nothing is deleted.
-- Every change is audited (staff_audit_write) with the real role.

create table if not exists public.field_meetings (
  id               uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  title            text not null check (length(btrim(title)) between 3 and 160),
  meeting_kind     text not null default 'client' check (meeting_kind in ('client', 'internal')),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  location         text check (location is null or length(location) <= 200),
  lead_id          uuid references public.leads(id) on delete set null,
  attendee_note    text check (attendee_note is null or length(attendee_note) <= 500),
  status           text not null default 'scheduled' check (status in ('scheduled', 'done', 'cancelled')),
  cancel_reason    text check (cancel_reason is null or length(cancel_reason) <= 300),
  created_by       uuid not null references public.profiles(id),
  created_role     text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint field_meetings_time_ck check (ends_at > starts_at and ends_at <= starts_at + interval '12 hours'),
  constraint field_meetings_cancel_ck check ((status = 'cancelled') = (cancel_reason is not null))
);
create index if not exists field_meetings_owner_time_idx on public.field_meetings (owner_profile_id, starts_at);

alter table public.field_meetings enable row level security;
revoke all on table public.field_meetings from public, anon, authenticated;

-- The caller's role for the field diary: 'owner', or the enabled staff role when it is administrator, field_supervisor or
-- field_consultant; otherwise null. NULL-safe.
create or replace function public.field_diary_actor()
returns text
language sql stable security definer set search_path = '' as $$
  select case when coalesce(public.is_owner(), false) then 'owner'
              when coalesce(public.staff_role_of() in ('administrator', 'field_supervisor', 'field_consultant'), false)
                then public.staff_role_of()
         end;
$$;
revoke all on function public.field_diary_actor() from public, anon, authenticated;

-- May the caller see (and book on) this person's diary? The person must be an active field supervisor or consultant.
create or replace function public.field_diary_can_use(p_person uuid)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_actor text := public.field_diary_actor(); v_role text;
begin
  if v_actor is null or p_person is null then return false; end if;
  select p.role::text into v_role from public.profiles p
   where p.id = p_person and p.is_active and p.role::text in ('field_supervisor', 'field_consultant');
  if v_role is null then return false; end if;
  return case v_actor
    when 'owner' then true
    when 'administrator' then true
    when 'field_supervisor' then p_person = (select auth.uid()) or v_role = 'field_consultant'
    when 'field_consultant' then p_person = (select auth.uid())
    else false end;
end;
$$;
revoke all on function public.field_diary_can_use(uuid) from public, anon, authenticated;

-- The diaries the caller may open: their own first, then the others they may see.
create or replace function public.field_diary_people()
returns table (profile_id uuid, full_name text, role text, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.field_diary_actor() is null then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query
    select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email), p.role::text, p.id = (select auth.uid())
      from public.profiles p
     where p.is_active and p.role::text in ('field_supervisor', 'field_consultant') and public.field_diary_can_use(p.id)
     order by (p.id = (select auth.uid())) desc, p.role::text desc, 2;
end;
$$;
revoke all on function public.field_diary_people() from public, anon;
grant execute on function public.field_diary_people() to authenticated;

-- One person's meetings between two dates (inclusive, SAST days). Defaults: the caller, today.
create or replace function public.field_meetings_list(
  p_person uuid default null, p_from date default null, p_to date default null, p_include_cancelled boolean default false)
returns table (id uuid, owner_profile_id uuid, owner_name text, title text, meeting_kind text, starts_at timestamptz,
               ends_at timestamptz, location text, lead_id uuid, business_name text, attendee_note text, status text,
               cancel_reason text, created_by_name text, created_role text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_person uuid := coalesce(p_person, (select auth.uid()));
  v_from date := coalesce(p_from, public.current_sast_date());
  v_to date := coalesce(p_to, coalesce(p_from, public.current_sast_date()));
begin
  if not public.field_diary_can_use(v_person) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  if v_to < v_from or v_to > v_from + 62 then raise exception 'Choose a range of up to two months'; end if;
  return query
    select m.id, m.owner_profile_id, coalesce(nullif(btrim(op.full_name), ''), op.email), m.title, m.meeting_kind,
           m.starts_at, m.ends_at, m.location, m.lead_id, l.business_name, m.attendee_note, m.status, m.cancel_reason,
           coalesce(nullif(btrim(cp.full_name), ''), cp.email), m.created_role, m.created_at
      from public.field_meetings m
      join public.profiles op on op.id = m.owner_profile_id
      left join public.profiles cp on cp.id = m.created_by
      left join public.leads l on l.id = m.lead_id
     where m.owner_profile_id = v_person
       and (m.starts_at at time zone 'Africa/Johannesburg')::date between v_from and v_to
       and (p_include_cancelled or m.status <> 'cancelled')
     order by m.starts_at;
end;
$$;
revoke all on function public.field_meetings_list(uuid, date, date, boolean) from public, anon;
grant execute on function public.field_meetings_list(uuid, date, date, boolean) to authenticated;

-- Book a meeting on a diary (own, or one the caller may use). Refuses an overlap with another scheduled meeting.
create or replace function public.field_meeting_book(
  p_person uuid, p_title text, p_starts_at timestamptz, p_ends_at timestamptz, p_meeting_kind text default 'client',
  p_location text default null, p_lead_id uuid default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_role text := public.staff_actor_role(); v_id uuid;
  v_person uuid := coalesce(p_person, (select auth.uid()));
  v_title text := btrim(coalesce(p_title, '')); v_loc text := nullif(btrim(coalesce(p_location, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_clash text;
begin
  if not public.field_diary_can_use(v_person) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  if length(v_title) not between 3 and 160 then raise exception 'Give the meeting a title (3 to 160 characters)'; end if;
  if coalesce(p_meeting_kind, '') not in ('client', 'internal') then raise exception 'Choose a client or internal meeting'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'The meeting must end after it starts';
  end if;
  if p_ends_at > p_starts_at + interval '12 hours' then raise exception 'A meeting can last at most 12 hours'; end if;
  if v_loc is not null and length(v_loc) > 200 then raise exception 'Keep the place under 200 characters'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'Keep the note under 500 characters'; end if;
  if p_lead_id is not null and not exists (select 1 from public.leads l where l.id = p_lead_id) then
    raise exception 'Lead not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('field_diary:' || v_person::text, 0));
  select m.title into v_clash from public.field_meetings m
   where m.owner_profile_id = v_person and m.status = 'scheduled'
     and tstzrange(m.starts_at, m.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
   limit 1;
  if v_clash is not null then
    raise exception 'This time overlaps another meeting on the diary: %', v_clash;
  end if;

  insert into public.field_meetings (owner_profile_id, title, meeting_kind, starts_at, ends_at, location, lead_id,
                                     attendee_note, created_by, created_role)
  values (v_person, v_title, p_meeting_kind, p_starts_at, p_ends_at, v_loc, p_lead_id, v_note, v_uid, coalesce(v_role, 'owner'))
  returning id into v_id;
  perform public.staff_audit_write('field_meeting', v_id, 'field_meeting_booked', null,
    jsonb_build_object('diary_of', v_person, 'starts_at', p_starts_at, 'ends_at', p_ends_at, 'kind', p_meeting_kind));
  if v_person <> v_uid then
    perform public.staff_notify(v_person, 'FIELD_MEETING_UPDATED', 'Meeting booked on your diary: ' || v_title,
      to_char(p_starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI') || ' to '
        || to_char(p_ends_at at time zone 'Africa/Johannesburg', 'HH24:MI') || coalesce(' at ' || v_loc, '') || '.',
      '/staff/my-diary', jsonb_build_object('meeting_id', v_id));
  end if;
  return v_id;
end;
$$;
revoke all on function public.field_meeting_book(uuid, text, timestamptz, timestamptz, text, text, uuid, text) from public, anon;
grant execute on function public.field_meeting_book(uuid, text, timestamptz, timestamptz, text, text, uuid, text) to authenticated;

-- Mark a scheduled meeting done, or cancel it with a reason. Anyone who may use that diary.
create or replace function public.field_meeting_set_status(p_meeting_id uuid, p_status text, p_reason text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); m public.field_meetings; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_rows int;
begin
  select * into m from public.field_meetings f where f.id = p_meeting_id for update;
  if m.id is null or not public.field_diary_can_use(m.owner_profile_id) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  if coalesce(p_status, '') not in ('done', 'cancelled') then raise exception 'Choose done or cancelled'; end if;
  if m.status <> 'scheduled' then raise exception 'Only a scheduled meeting can be changed'; end if;
  if p_status = 'cancelled' and (v_reason is null or length(v_reason) not between 3 and 300) then
    raise exception 'Say why the meeting is cancelled (3 to 300 characters)';
  end if;
  update public.field_meetings
     set status = p_status, cancel_reason = case when p_status = 'cancelled' then v_reason end, updated_at = now()
   where id = p_meeting_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'Changing the meeting affected no rows'; end if;
  perform public.staff_audit_write('field_meeting', p_meeting_id,
    case when p_status = 'done' then 'field_meeting_done' else 'field_meeting_cancelled' end, v_reason, '{}'::jsonb);
  if m.owner_profile_id <> v_uid and p_status = 'cancelled' then
    perform public.staff_notify(m.owner_profile_id, 'FIELD_MEETING_UPDATED', 'Meeting cancelled: ' || m.title,
      'Reason: ' || v_reason, '/staff/my-diary', jsonb_build_object('meeting_id', p_meeting_id));
  end if;
  return p_status;
end;
$$;
revoke all on function public.field_meeting_set_status(uuid, text, text) from public, anon;
grant execute on function public.field_meeting_set_status(uuid, text, text) to authenticated;
