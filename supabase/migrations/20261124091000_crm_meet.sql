-- In-CRM calls and meetings (owner, 24 Nov 2026), 2/2: "I need in the CRM where we can call and speak to each other and
-- also make a meeting like Teams." Browser-to-browser audio/video between logged-in CRM users (WebRTC, peer to peer).
-- No phone network, no recording, no media stored (POPIA): the database keeps only who called whom, when and for how long.
--
-- Signalling (the WebRTC offers/answers/ICE candidates) travels over PRIVATE Supabase Realtime broadcast channels:
--   meet:call:<call id>     the two parties of a 1:1 call
--   meet:room:<meeting id>  the host and the invitees of a meeting
--   meet:presence           everyone who may use calls (online / offline dots)
-- realtime.messages RLS (below) lets a user read/write a topic only through meet_can_use_topic(topic). Ringing reaches the
-- callee through postgres_changes on meet_calls (RLS: the callee reads their own rows), so meet_calls is added to the
-- supabase_realtime publication.
--
-- Who may contact whom (meet_can_contact): the Director and enabled office/field staff may call or invite each other and
-- agents (partner / contractor / lead_referrer). Agents may call or be called by Fund Now Capital staff and the Director,
-- never another agent. Only the Director and staff host meetings; agents join meetings they are invited to.
-- Meetings are a mesh (every browser connects to every other), capped at 8 people.

-- 1. Who is who ---------------------------------------------------------------------------------------------------------
create or replace function public.meet_person_kind(p_profile uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p.role::text = 'owner' then 'owner'
    when p.role::text in ('administrator', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant')
         and exists (select 1 from public.staff_access s
                      where s.profile_id = p.id and s.access_enabled and s.staff_role::text = p.role::text) then 'staff'
    when p.role::text in ('partner', 'contractor', 'lead_referrer') then 'agent'
  end
  from public.profiles p where p.id = p_profile and p.is_active;
$$;
revoke all on function public.meet_person_kind(uuid) from public, anon, authenticated;

create or replace function public.meet_can_contact(p_from uuid, p_to uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_from is not null and p_to is not null and p_from <> p_to
    and public.meet_person_kind(p_from) is not null and public.meet_person_kind(p_to) is not null
    and not (public.meet_person_kind(p_from) = 'agent' and public.meet_person_kind(p_to) = 'agent'), false);
$$;
revoke all on function public.meet_can_contact(uuid, uuid) from public, anon, authenticated;

create or replace function public.meet_require_user()
returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text := public.meet_person_kind((select auth.uid()));
begin
  if v_kind is null then raise exception 'Calls and meetings are for Fund Now Capital staff, the Director and agents' using errcode = '42501'; end if;
  return v_kind;
end;
$$;
revoke all on function public.meet_require_user() from public, anon, authenticated;

create or replace function public.meet_display_name(p_profile uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(p.full_name), ''), p.email, 'Someone') from public.profiles p where p.id = p_profile;
$$;
revoke all on function public.meet_display_name(uuid) from public, anon, authenticated;

-- 2. Tables ---------------------------------------------------------------------------------------------------------------
create table if not exists public.meet_meetings (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (length(btrim(title)) between 2 and 120),
  host_id          uuid not null references public.profiles(id) on delete restrict,
  starts_at        timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  status           text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended', 'cancelled')),
  instant          boolean not null default false,
  ended_at         timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists meet_meetings_host_idx on public.meet_meetings (host_id, starts_at desc);

create table if not exists public.meet_participants (
  meeting_id  uuid not null references public.meet_meetings(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete restrict,
  is_host     boolean not null default false,
  invited_at  timestamptz not null default now(),
  joined_at   timestamptz,
  left_at     timestamptz,
  primary key (meeting_id, profile_id)
);
create index if not exists meet_participants_profile_idx on public.meet_participants (profile_id, invited_at desc);

create table if not exists public.meet_calls (
  id               uuid primary key default gen_random_uuid(),
  caller_id        uuid not null references public.profiles(id) on delete restrict,
  callee_id        uuid not null references public.profiles(id) on delete restrict,
  kind             text not null default 'call' check (kind in ('call')),
  video            boolean not null default false,
  status           text not null default 'ringing' check (status in ('ringing', 'answered', 'missed', 'declined', 'ended')),
  started_at       timestamptz not null default now(),
  answered_at      timestamptz,
  ended_at         timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  constraint meet_calls_parties_ck check (caller_id <> callee_id)
);
create index if not exists meet_calls_caller_idx on public.meet_calls (caller_id, started_at desc);
create index if not exists meet_calls_callee_idx on public.meet_calls (callee_id, started_at desc);

alter table public.meet_meetings enable row level security;
alter table public.meet_participants enable row level security;
alter table public.meet_calls enable row level security;
revoke all on table public.meet_meetings, public.meet_participants, public.meet_calls from public, anon, authenticated;
grant select on table public.meet_meetings, public.meet_participants, public.meet_calls to authenticated;

create or replace function public.meet_is_participant(p_meeting uuid, p_profile uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meet_participants mp where mp.meeting_id = p_meeting and mp.profile_id = p_profile);
$$;
revoke all on function public.meet_is_participant(uuid, uuid) from public, anon;
grant execute on function public.meet_is_participant(uuid, uuid) to authenticated;

-- Read: your own rows; the Director reads everything. Writes only through the functions below.
drop policy if exists meet_calls_read on public.meet_calls;
create policy meet_calls_read on public.meet_calls for select to authenticated
  using (caller_id = (select auth.uid()) or callee_id = (select auth.uid()) or coalesce(public.is_owner(), false));
drop policy if exists meet_meetings_read on public.meet_meetings;
create policy meet_meetings_read on public.meet_meetings for select to authenticated
  using (coalesce(public.is_owner(), false)
         or public.meet_is_participant(id, (select auth.uid())));
drop policy if exists meet_participants_read on public.meet_participants;
create policy meet_participants_read on public.meet_participants for select to authenticated
  using (coalesce(public.is_owner(), false) or profile_id = (select auth.uid())
         or public.meet_is_participant(meeting_id, (select auth.uid())));

-- 3. Helpers ---------------------------------------------------------------------------------------------------------------
-- In-app notice without email (calls are live events; an email about a missed call is noise).
create or replace function public.meet_notify(p_user uuid, p_event public.notification_event_type, p_title text, p_body text,
  p_link text, p_data jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_in_app boolean;
begin
  if p_user is null then return; end if;
  v_in_app := public.check_notification_channel_enabled(p_user, p_event, 'in_app');
  insert into public.notifications (user_id, event_type, title, body_text, link_url, data, read_status, read_at)
  values (p_user, p_event, p_title, p_body, p_link, p_data, not v_in_app, case when v_in_app then null else now() end)
  returning id into v_id;
  insert into public.notification_deliveries (notification_id, channel, delivery_status, sent_at, delivered_at)
  values (v_id, 'in_app', case when v_in_app then 'delivered' else 'skipped' end::public.notification_delivery_status,
          case when v_in_app then now() end, case when v_in_app then now() end);
end;
$$;
revoke all on function public.meet_notify(uuid, public.notification_event_type, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.meet_log(p_entity text, p_id uuid, p_event text, p_description text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.activity_logs (user_id, user_email, user_role, event_type, entity_type, entity_id, description)
  select (select auth.uid()), p.email, p.role::text, p_event::public.activity_event_type, p_entity, p_id, p_description
    from public.profiles p where p.id = (select auth.uid());
end;
$$;
revoke all on function public.meet_log(text, uuid, text, text) from public, anon, authenticated;

-- A ringing call older than 60 seconds was missed: settle it (and tell the callee) whenever calls are touched.
create or replace function public.meet_expire_stale()
returns void
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  for c in update public.meet_calls set status = 'missed', ended_at = now()
            where status = 'ringing' and started_at < now() - interval '60 seconds'
            returning id, caller_id, callee_id
  loop
    perform public.meet_notify(c.callee_id, 'MEET_MISSED_CALL', 'Missed call from ' || public.meet_display_name(c.caller_id),
      'You missed a CRM call. Open Calls & meetings to call back.', '/calls', jsonb_build_object('call_id', c.id));
  end loop;
end;
$$;
revoke all on function public.meet_expire_stale() from public, anon, authenticated;

-- 4. Calls ---------------------------------------------------------------------------------------------------------------
create or replace function public.meet_start_call(p_callee uuid, p_video boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  perform public.meet_require_user();
  perform public.meet_expire_stale();
  if not public.meet_can_contact(v_uid, p_callee) then
    raise exception 'You cannot call this person from the CRM' using errcode = '42501';
  end if;
  -- One ringing call per caller at a time.
  update public.meet_calls set status = 'missed', ended_at = now() where caller_id = v_uid and status = 'ringing';
  insert into public.meet_calls (caller_id, callee_id, video) values (v_uid, p_callee, coalesce(p_video, false))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.meet_start_call(uuid, boolean) from public, anon;
grant execute on function public.meet_start_call(uuid, boolean) to authenticated;

create or replace function public.meet_answer_call(p_call uuid, p_accept boolean default true)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); c public.meet_calls;
begin
  perform public.meet_require_user();
  perform public.meet_expire_stale();
  select * into c from public.meet_calls where id = p_call for update;
  if not found or c.callee_id <> v_uid then raise exception 'Call not found' using errcode = '42501'; end if;
  if c.status <> 'ringing' then return c.status; end if;  -- already settled (idempotent)
  if coalesce(p_accept, true) then
    update public.meet_calls set status = 'answered', answered_at = now() where id = p_call;
    perform public.meet_log('meet_call', p_call, 'UPDATE',
      'CRM call answered: ' || public.meet_display_name(c.caller_id) || ' → ' || public.meet_display_name(c.callee_id));
    return 'answered';
  end if;
  update public.meet_calls set status = 'declined', ended_at = now() where id = p_call;
  return 'declined';
end;
$$;
revoke all on function public.meet_answer_call(uuid, boolean) from public, anon;
grant execute on function public.meet_answer_call(uuid, boolean) to authenticated;

-- Either party ends the call. Ringing + caller gives up (or the 45 s ring timeout) = missed (callee told); answered =
-- ended with its duration. Already settled: returns the status unchanged.
create or replace function public.meet_end_call(p_call uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); c public.meet_calls;
begin
  perform public.meet_require_user();
  select * into c from public.meet_calls where id = p_call for update;
  if not found or v_uid not in (c.caller_id, c.callee_id) then raise exception 'Call not found' using errcode = '42501'; end if;
  if c.status = 'ringing' then
    if v_uid = c.callee_id then
      update public.meet_calls set status = 'declined', ended_at = now() where id = p_call;
      return 'declined';
    end if;
    update public.meet_calls set status = 'missed', ended_at = now() where id = p_call;
    perform public.meet_notify(c.callee_id, 'MEET_MISSED_CALL', 'Missed call from ' || public.meet_display_name(c.caller_id),
      'You missed a CRM call. Open Calls & meetings to call back.', '/calls', jsonb_build_object('call_id', c.id));
    return 'missed';
  elsif c.status = 'answered' then
    update public.meet_calls
       set status = 'ended', ended_at = now(),
           duration_seconds = greatest(0, extract(epoch from (now() - c.answered_at))::int)
     where id = p_call;
    return 'ended';
  end if;
  return c.status;
end;
$$;
revoke all on function public.meet_end_call(uuid) from public, anon;
grant execute on function public.meet_end_call(uuid) to authenticated;

-- 5. Meetings ------------------------------------------------------------------------------------------------------------
create or replace function public.meet_create_meeting(p_title text, p_starts_at timestamptz, p_duration_minutes integer,
  p_invitees uuid[], p_instant boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_kind text := public.meet_require_user(); v_id uuid; v_p uuid;
  v_invitees uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_invitees, '{}')) x where x <> v_uid), '{}');
  v_title text := btrim(coalesce(p_title, ''));
begin
  if v_kind = 'agent' then raise exception 'Only Fund Now Capital staff and the Director host meetings' using errcode = '42501'; end if;
  if length(v_title) not between 2 and 120 then raise exception 'Give the meeting a title (2 to 120 characters)'; end if;
  if coalesce(p_duration_minutes, 0) not between 5 and 480 then raise exception 'A meeting lasts 5 minutes to 8 hours'; end if;
  if cardinality(v_invitees) = 0 then raise exception 'Invite at least one person'; end if;
  if cardinality(v_invitees) > 7 then raise exception 'A meeting holds up to 8 people (you and 7 others)'; end if;
  foreach v_p in array v_invitees loop
    if not public.meet_can_contact(v_uid, v_p) then
      raise exception 'You cannot invite % to a CRM meeting', coalesce(public.meet_display_name(v_p), 'that person') using errcode = '42501';
    end if;
  end loop;
  insert into public.meet_meetings (title, host_id, starts_at, duration_minutes, instant, status)
  values (v_title, v_uid, coalesce(case when p_instant then now() end, p_starts_at, now()), p_duration_minutes,
          coalesce(p_instant, false), case when coalesce(p_instant, false) then 'live' else 'scheduled' end)
  returning id into v_id;
  insert into public.meet_participants (meeting_id, profile_id, is_host) values (v_id, v_uid, true);
  foreach v_p in array v_invitees loop
    insert into public.meet_participants (meeting_id, profile_id) values (v_id, v_p);
    perform public.meet_notify(v_p, 'MEET_INVITE',
      case when coalesce(p_instant, false) then public.meet_display_name(v_uid) || ' started a meeting: ' || v_title
           else 'Meeting invite: ' || v_title end,
      case when coalesce(p_instant, false) then 'Join now from Calls & meetings.'
           else to_char(coalesce(p_starts_at, now()) at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI')
                || ' · ' || p_duration_minutes || ' min · from ' || public.meet_display_name(v_uid) end,
      '/calls?meeting=' || v_id::text, jsonb_build_object('meeting_id', v_id));
  end loop;
  perform public.meet_log('meet_meeting', v_id, 'CREATE', 'CRM meeting created: ' || v_title || ' (' || (cardinality(v_invitees) + 1) || ' people)');
  return v_id;
end;
$$;
revoke all on function public.meet_create_meeting(text, timestamptz, integer, uuid[], boolean) from public, anon;
grant execute on function public.meet_create_meeting(text, timestamptz, integer, uuid[], boolean) to authenticated;

create or replace function public.meet_join_meeting(p_meeting uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); m public.meet_meetings; v_in integer; v_me public.meet_participants;
begin
  perform public.meet_require_user();
  select * into m from public.meet_meetings where id = p_meeting for update;
  if not found then raise exception 'Meeting not found' using errcode = '42501'; end if;
  select * into v_me from public.meet_participants where meeting_id = p_meeting and profile_id = v_uid;
  if not found then raise exception 'You are not invited to this meeting' using errcode = '42501'; end if;
  if m.status in ('ended', 'cancelled') then raise exception 'This meeting has ended'; end if;
  select count(*) into v_in from public.meet_participants
   where meeting_id = p_meeting and joined_at is not null and left_at is null and profile_id <> v_uid;
  if v_in >= 8 then raise exception 'This meeting is full (8 people). Ask the host to start another one.'; end if;
  update public.meet_participants set joined_at = now(), left_at = null where meeting_id = p_meeting and profile_id = v_uid;
  if m.status = 'scheduled' then update public.meet_meetings set status = 'live' where id = p_meeting; end if;
  return jsonb_build_object('meeting_id', m.id, 'title', m.title, 'host_id', m.host_id, 'is_host', v_me.is_host);
end;
$$;
revoke all on function public.meet_join_meeting(uuid) from public, anon;
grant execute on function public.meet_join_meeting(uuid) to authenticated;

create or replace function public.meet_leave_meeting(p_meeting uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.meet_require_user();
  update public.meet_participants set left_at = now()
   where meeting_id = p_meeting and profile_id = (select auth.uid()) and joined_at is not null and left_at is null;
end;
$$;
revoke all on function public.meet_leave_meeting(uuid) from public, anon;
grant execute on function public.meet_leave_meeting(uuid) to authenticated;

create or replace function public.meet_end_meeting(p_meeting uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); m public.meet_meetings;
begin
  perform public.meet_require_user();
  select * into m from public.meet_meetings where id = p_meeting for update;
  if not found then raise exception 'Meeting not found' using errcode = '42501'; end if;
  if m.host_id <> v_uid and not coalesce(public.is_owner(), false) then
    raise exception 'Only the host or the Director ends a meeting for everyone' using errcode = '42501';
  end if;
  if m.status in ('ended', 'cancelled') then return m.status; end if;
  update public.meet_meetings set status = case when m.status = 'scheduled' then 'cancelled' else 'ended' end, ended_at = now()
   where id = p_meeting;
  update public.meet_participants set left_at = now() where meeting_id = p_meeting and joined_at is not null and left_at is null;
  perform public.meet_log('meet_meeting', p_meeting, 'UPDATE', 'CRM meeting ended: ' || m.title);
  return case when m.status = 'scheduled' then 'cancelled' else 'ended' end;
end;
$$;
revoke all on function public.meet_end_meeting(uuid) from public, anon;
grant execute on function public.meet_end_meeting(uuid) to authenticated;

-- 6. Lists ---------------------------------------------------------------------------------------------------------------
create or replace function public.meet_people(p_query text default null)
returns table (profile_id uuid, name text, role text, kind text)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_q text := '%' || btrim(coalesce(p_query, '')) || '%';
begin
  perform public.meet_require_user();
  return query
    select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email), p.role::text, public.meet_person_kind(p.id)
      from public.profiles p
     where p.is_active and p.id <> v_uid and public.meet_can_contact(v_uid, p.id)
       and (coalesce(p.full_name, '') ilike v_q or coalesce(p.email, '') ilike v_q)
     order by 2
     limit 200;
end;
$$;
revoke all on function public.meet_people(text) from public, anon;
grant execute on function public.meet_people(text) to authenticated;

create or replace function public.meet_list_my()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  perform public.meet_require_user();
  perform public.meet_expire_stale();
  return jsonb_build_object(
    'calls', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'outgoing', c.caller_id = v_uid,
               'other_id', case when c.caller_id = v_uid then c.callee_id else c.caller_id end,
               'other_name', public.meet_display_name(case when c.caller_id = v_uid then c.callee_id else c.caller_id end),
               'video', c.video, 'status', c.status, 'started_at', c.started_at, 'duration_seconds', c.duration_seconds)
             order by c.started_at desc)
        from (select * from public.meet_calls where caller_id = v_uid or callee_id = v_uid order by started_at desc limit 50) c), '[]'::jsonb),
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'title', m.title, 'host_id', m.host_id, 'host_name', public.meet_display_name(m.host_id),
               'is_host', m.host_id = v_uid, 'starts_at', m.starts_at, 'duration_minutes', m.duration_minutes,
               'status', m.status, 'instant', m.instant,
               'participants', (select jsonb_agg(jsonb_build_object('profile_id', mp.profile_id,
                                         'name', public.meet_display_name(mp.profile_id), 'is_host', mp.is_host,
                                         'in_room', mp.joined_at is not null and mp.left_at is null) order by mp.is_host desc)
                                  from public.meet_participants mp where mp.meeting_id = m.id))
             order by m.starts_at desc)
        from (select mm.* from public.meet_meetings mm
               where exists (select 1 from public.meet_participants mp where mp.meeting_id = mm.id and mp.profile_id = v_uid)
                 and (mm.status in ('scheduled', 'live') or mm.starts_at > now() - interval '14 days')
               order by mm.starts_at desc limit 50) m), '[]'::jsonb));
end;
$$;
revoke all on function public.meet_list_my() from public, anon;
grant execute on function public.meet_list_my() to authenticated;

-- 7. Realtime authorization ----------------------------------------------------------------------------------------------
-- meet:presence -> anyone who may use calls; meet:call:<id> -> its two parties while the call is ringing or answered;
-- meet:room:<id> -> the meeting's host and invitees while it is not ended. Every other topic: refused by these policies
-- (no other part of the CRM uses private channels today).
create or replace function public.meet_can_use_topic(p_topic text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  if v_uid is null or p_topic is null or public.meet_person_kind(v_uid) is null then return false; end if;
  if p_topic = 'meet:presence' then return true; end if;
  if p_topic ~ '^meet:call:[0-9a-f-]{36}$' then
    v_id := substr(p_topic, 11)::uuid;
    return exists (select 1 from public.meet_calls c where c.id = v_id and v_uid in (c.caller_id, c.callee_id)
                      and c.status in ('ringing', 'answered'));
  end if;
  if p_topic ~ '^meet:room:[0-9a-f-]{36}$' then
    v_id := substr(p_topic, 11)::uuid;
    return exists (select 1 from public.meet_meetings m join public.meet_participants mp on mp.meeting_id = m.id
                    where m.id = v_id and mp.profile_id = v_uid and m.status in ('scheduled', 'live'));
  end if;
  return false;
end;
$$;
revoke all on function public.meet_can_use_topic(text) from public, anon;
grant execute on function public.meet_can_use_topic(text) to authenticated;

drop policy if exists meet_realtime_read on realtime.messages;
create policy meet_realtime_read on realtime.messages for select to authenticated
  using (public.meet_can_use_topic((select realtime.topic())));
drop policy if exists meet_realtime_write on realtime.messages;
create policy meet_realtime_write on realtime.messages for insert to authenticated
  with check (public.meet_can_use_topic((select realtime.topic())));

-- Ringing: the callee's browser listens for new meet_calls rows (RLS limits them to their own).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
                                                           and tablename = 'meet_calls') then
    execute 'alter publication supabase_realtime add table public.meet_calls';
  end if;
end $$;
