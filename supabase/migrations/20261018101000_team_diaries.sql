-- Team diaries (Administrator spec §18, Batch 1b) (2/2). Owner decisions 17 Oct 2026. Forward-only.
--
-- The Sales Coordinator and Reception (Switchboard) set appointments on the diaries of direct agents
-- (contractors), sub-agents (lead referrers), Team Leaders and partners. The Administrator (who carries the
-- Coordinator's authority) and the Founder can too.
--   * The client is emailed when the appointment is booked, moved or cancelled, whoever makes the change:
--     "Your meeting is booked with our FNC partner [name]", the reason, the date and time, and the team
--     member's name, phone number and email address.
--   * The team member sees the appointment in their portal ("My appointments"), gets an in-app notice and
--     may move or cancel it themselves.
--   * Times: weekdays 08:00-17:00 Africa/Johannesburg, public holidays closed, one day, at most four hours,
--     no overlap on the team member's diary.
-- Nothing here touches the Founder's diary, funders, commission or success fees. All access is through the
-- SECURITY DEFINER functions below; the tables have RLS on and no grants.

-- 1. Tables ---------------------------------------------------------------------------------------------
create table if not exists public.team_appointments (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.profiles(id) on delete restrict,
  lead_id         uuid references public.leads(id) on delete set null,
  client_name     text not null check (length(btrim(client_name)) between 2 and 160),
  client_email    text not null check (client_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(client_email) <= 254),
  client_phone    text check (client_phone is null or length(btrim(client_phone)) between 6 and 30),
  reason          text not null check (length(btrim(reason)) between 10 and 500),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  status          text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_by      uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null check (length(idempotency_key) between 8 and 120),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint team_appointments_time_ck check (ends_at > starts_at),
  constraint team_appointments_idem_uq unique (created_by, idempotency_key),
  constraint team_appointments_no_overlap exclude using gist
    (member_id with =, tstzrange(starts_at, ends_at, '[)') with &&) where (status = 'scheduled')
);
create index if not exists team_appointments_member_idx on public.team_appointments (member_id, starts_at);
create index if not exists team_appointments_starts_idx on public.team_appointments (starts_at) where status = 'scheduled';
create trigger team_appointments_updated_at before update on public.team_appointments
  for each row execute function public.set_updated_at();
alter table public.team_appointments enable row level security;
revoke all on table public.team_appointments from public, anon, authenticated;

-- Who changed what, when (append-only).
create table if not exists public.team_appointment_changes (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.team_appointments(id) on delete restrict,
  actor_id       uuid not null references public.profiles(id) on delete restrict,
  actor_role     text not null,
  kind           text not null check (kind in ('booked', 'moved', 'cancelled')),
  from_starts    timestamptz,
  from_ends      timestamptz,
  to_starts      timestamptz,
  to_ends        timestamptz,
  reason         text,
  created_at     timestamptz not null default now()
);
create index if not exists team_appointment_changes_appt_idx on public.team_appointment_changes (appointment_id, created_at);
alter table public.team_appointment_changes enable row level security;
revoke all on table public.team_appointment_changes from public, anon, authenticated;
create trigger team_appointment_changes_append_only before update or delete on public.team_appointment_changes
  for each row execute function public.intake_append_only_guard();

-- Client emails: one row per notice; a newer notice supersedes an unsent older one.
create table if not exists public.team_appointment_emails (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid not null references public.team_appointments(id) on delete restrict,
  revision        integer not null check (revision >= 1),
  kind            text not null check (kind in ('booked', 'moved', 'cancelled')),
  recipient_email text not null,
  recipient_name  text,
  status          text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'failed', 'superseded')),
  attempts        integer not null default 0,
  external_id     text,
  error_message   text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint team_appointment_emails_rev_uq unique (appointment_id, revision)
);
create index if not exists team_appointment_emails_pending_idx
  on public.team_appointment_emails (status, created_at) where status in ('queued', 'failed');
create trigger team_appointment_emails_updated_at before update on public.team_appointment_emails
  for each row execute function public.set_updated_at();
alter table public.team_appointment_emails enable row level security;
revoke all on table public.team_appointment_emails from public, anon, authenticated;

-- 2. Helpers (internal) ------------------------------------------------------------------------------------
-- Staff who may book on team diaries: the Founder, Administrator, Sales Coordinator and Reception.
create or replace function public.team_booker_role()
returns text
language sql stable security definer set search_path = '' as $$
  select r from (select public.staff_actor_role() as r) x
   where r in ('owner', 'administrator', 'coordinator', 'switchboard');
$$;
revoke all on function public.team_booker_role() from public, anon, authenticated;

-- Direct agents (contractor), sub-agents (lead_referrer), partners, and anyone leading a team today.
create or replace function public.team_member_type(p_profile uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.referral_team_memberships m
                  where m.profile_id = p.id and m.membership_role = 'team_leader'
                    and m.effective_from <= public.current_sast_date()
                    and (m.effective_to is null or m.effective_to >= public.current_sast_date())) then 'Team Leader'
    when p.role::text = 'partner' then 'Partner'
    when p.role::text = 'contractor' then 'Direct agent'
    when p.role::text = 'lead_referrer' then 'Sub-agent'
  end
  from public.profiles p
  where p.id = p_profile and p.is_active;
$$;
revoke all on function public.team_member_type(uuid) from public, anon, authenticated;

-- Where the team member opens their appointments.
create or replace function public.team_portal_path(p_profile uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case p.role::text
    when 'partner' then '/partner/appointments'
    when 'contractor' then '/contractor/appointments'
    when 'lead_referrer' then '/lead-referrer/appointments'
    else '/staff/team-diary' end
  from public.profiles p where p.id = p_profile;
$$;
revoke all on function public.team_portal_path(uuid) from public, anon, authenticated;

-- Weekdays 08:00-17:00 SAST, one day, future, at most four hours, not a holiday, no overlap.
create or replace function public.team_validate_slot(p_member uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude uuid)
returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s timestamp := p_starts_at at time zone 'Africa/Johannesburg';
  v_e timestamp := p_ends_at at time zone 'Africa/Johannesburg';
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_starts_at <= now() then
    raise exception 'Choose a future start and an end after it';
  end if;
  if p_ends_at - p_starts_at > interval '4 hours' then raise exception 'An appointment can be at most four hours'; end if;
  if v_s::date <> v_e::date or v_s::time < time '08:00' or v_e::time > time '17:00' then
    raise exception 'Team appointments are between 08:00 and 17:00 on one day';
  end if;
  if extract(isodow from v_s) > 5 then raise exception 'Appointments are not booked on weekends'; end if;
  if exists (select 1 from public.business_holidays h where h.holiday_date = v_s::date) then
    raise exception 'That day is a public holiday';
  end if;
  if exists (select 1 from public.team_appointments a
              where a.member_id = p_member and a.status = 'scheduled'
                and (p_exclude is null or a.id <> p_exclude)
                and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')) then
    raise exception 'That time overlaps another appointment on this diary';
  end if;
end;
$$;
revoke all on function public.team_validate_slot(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

-- In-app notice (no email; the client email is separate).
create or replace function public.team_diary_notify(p_user uuid, p_title text, p_body text, p_link text, p_data jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_on boolean;
begin
  if p_user is null then return; end if;
  v_on := public.check_notification_channel_enabled(p_user, 'TEAM_APPOINTMENT_CHANGED', 'in_app');
  insert into public.notifications (user_id, event_type, title, body_text, link_url, data, read_status, read_at)
  values (p_user, 'TEAM_APPOINTMENT_CHANGED', p_title, p_body, p_link, p_data, not v_on, case when v_on then null else now() end)
  returning id into v_id;
  insert into public.notification_deliveries (notification_id, channel, delivery_status, sent_at, delivered_at)
  values (v_id, 'in_app', (case when v_on then 'delivered' else 'skipped' end)::public.notification_delivery_status,
          case when v_on then now() end, case when v_on then now() end);
end;
$$;
revoke all on function public.team_diary_notify(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Hand one queued email to the send-team-appointment-email Edge Function (same path as the booking
-- confirmations: Vault edge_base_url + webhook_secret through pg_net, which sends after commit).
create or replace function public.invoke_send_team_appointment_email(p_email_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_base_url text; v_secret text;
begin
  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'edge_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'webhook_secret';
  if v_base_url is null or v_secret is null then return; end if;
  begin
    perform net.http_post(
      url := rtrim(v_base_url, '/') || '/functions/v1/send-team-appointment-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', v_secret),
      body := jsonb_build_object('email_id', p_email_id));
  exception when others then
    raise warning 'invoke_send_team_appointment_email failed for %: %', p_email_id, sqlerrm;
  end;
end;
$$;
revoke all on function public.invoke_send_team_appointment_email(uuid) from public, anon, authenticated;

-- Queue the next client email for an appointment; unsent older ones are superseded.
create or replace function public.team_queue_client_email(p_appointment uuid, p_kind text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.team_appointments; v_rev integer; v_id uuid;
begin
  select * into a from public.team_appointments where id = p_appointment;
  update public.team_appointment_emails set status = 'superseded'
   where appointment_id = p_appointment and status in ('queued', 'failed');
  select coalesce(max(e.revision), 0) + 1 into v_rev from public.team_appointment_emails e where e.appointment_id = p_appointment;
  insert into public.team_appointment_emails (appointment_id, revision, kind, recipient_email, recipient_name)
  values (p_appointment, v_rev, p_kind, lower(btrim(a.client_email)), btrim(a.client_name))
  returning id into v_id;
  perform public.invoke_send_team_appointment_email(v_id);
  return v_id;
end;
$$;
revoke all on function public.team_queue_client_email(uuid, text) from public, anon, authenticated;

-- 3. Staff and team-member functions ----------------------------------------------------------------------
-- Team members a booker can choose.
create or replace function public.team_diary_members()
returns table (profile_id uuid, full_name text, member_type text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.team_booker_role() is null then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, public.team_member_type(p.id)
      from public.profiles p
     where p.is_active and public.team_member_type(p.id) is not null
     order by p.full_name
     limit 500;
end;
$$;

create or replace function public.team_book_appointment(
  p_member uuid, p_client_name text, p_client_email text, p_client_phone text, p_reason text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_lead_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := public.team_booker_role();
  v_actor uuid := (select auth.uid());
  v_id uuid; v_email uuid; v_type text; v_when text;
begin
  if v_role is null then
    raise exception 'Only the Founder, the Administrator, the Sales Coordinator or Reception can book team appointments' using errcode = '42501';
  end if;
  if length(coalesce(p_idempotency_key, '')) not between 8 and 120 then raise exception 'An idempotency key of 8 to 120 characters is required'; end if;
  select a.id into v_id from public.team_appointments a where a.created_by = v_actor and a.idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('status', 'existing', 'appointment_id', v_id); end if;

  v_type := public.team_member_type(p_member);
  if v_type is null then raise exception 'Choose an active direct agent, sub-agent, Team Leader or partner'; end if;
  if length(btrim(coalesce(p_client_name, ''))) not between 2 and 160 then raise exception 'Enter the client''s name'; end if;
  if coalesce(p_client_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_client_email) > 254 then
    raise exception 'Enter a valid client email address: the client is emailed the booking';
  end if;
  if p_client_phone is not null and length(btrim(p_client_phone)) not between 6 and 30 then raise exception 'The client phone number looks wrong'; end if;
  if length(btrim(coalesce(p_reason, ''))) not between 10 and 500 then raise exception 'Give the reason for the meeting (10 to 500 characters)'; end if;
  if not public.staff_text_is_safe(p_reason) or not public.staff_text_is_safe(p_client_name) then
    raise exception 'The reason and client name cannot contain ID or account-length numbers';
  end if;
  if p_lead_id is not null and not exists (select 1 from public.leads l where l.id = p_lead_id) then raise exception 'Lead not found'; end if;

  perform pg_advisory_xact_lock(hashtext('team-diary:' || p_member::text));
  perform public.team_validate_slot(p_member, p_starts_at, p_ends_at, null);

  insert into public.team_appointments (member_id, lead_id, client_name, client_email, client_phone, reason,
                                        starts_at, ends_at, created_by, idempotency_key)
  values (p_member, p_lead_id, btrim(p_client_name), lower(btrim(p_client_email)), nullif(btrim(p_client_phone), ''),
          btrim(p_reason), p_starts_at, p_ends_at, v_actor, p_idempotency_key)
  returning id into v_id;
  insert into public.team_appointment_changes (appointment_id, actor_id, actor_role, kind, to_starts, to_ends)
  values (v_id, v_actor, v_role, 'booked', p_starts_at, p_ends_at);

  v_email := public.team_queue_client_email(v_id, 'booked');
  v_when := to_char(p_starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI') || ' to '
         || to_char(p_ends_at at time zone 'Africa/Johannesburg', 'HH24:MI');
  perform public.team_diary_notify(p_member, 'New appointment booked for you', btrim(p_client_name) || ' · ' || v_when,
    public.team_portal_path(p_member), jsonb_build_object('appointment_id', v_id, 'change', 'booked'));
  perform public.staff_audit_write('team_appointment', v_id, 'team_appointment_booked', null,
    jsonb_build_object('member_id', p_member, 'member_type', v_type));
  return jsonb_build_object('status', 'created', 'appointment_id', v_id, 'email_id', v_email);
end;
$$;

-- Who may change an appointment: any booker, or the team member whose diary it is.
create or replace function public.team_change_actor(a public.team_appointments)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := public.team_booker_role();
begin
  if v_role is not null then return v_role; end if;
  if a.member_id = (select auth.uid()) and public.team_member_type(a.member_id) is not null then return 'team_member'; end if;
  raise exception 'You cannot change this appointment' using errcode = '42501';
end;
$$;
revoke all on function public.team_change_actor(public.team_appointments) from public, anon, authenticated;

create or replace function public.team_move_appointment(p_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.team_appointments; v_role text; v_actor uuid := (select auth.uid()); v_email uuid; v_when text;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 or not public.staff_text_is_safe(p_reason) then
    raise exception 'Say briefly why the appointment is moving';
  end if;
  select * into a from public.team_appointments where id = p_id;
  if not found then raise exception 'Appointment not found'; end if;
  perform pg_advisory_xact_lock(hashtext('team-diary:' || a.member_id::text));
  select * into a from public.team_appointments where id = p_id for update;
  v_role := public.team_change_actor(a);
  if a.status <> 'scheduled' or a.starts_at <= now() then raise exception 'Only a future scheduled appointment can be moved'; end if;
  perform public.team_validate_slot(a.member_id, p_starts_at, p_ends_at, p_id);

  update public.team_appointments set starts_at = p_starts_at, ends_at = p_ends_at where id = p_id;
  insert into public.team_appointment_changes (appointment_id, actor_id, actor_role, kind, from_starts, from_ends, to_starts, to_ends, reason)
  values (p_id, v_actor, v_role, 'moved', a.starts_at, a.ends_at, p_starts_at, p_ends_at, btrim(p_reason));
  v_email := public.team_queue_client_email(p_id, 'moved');

  v_when := to_char(p_starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI') || ' to '
         || to_char(p_ends_at at time zone 'Africa/Johannesburg', 'HH24:MI');
  if a.member_id <> v_actor then
    perform public.team_diary_notify(a.member_id, 'Appointment moved', a.client_name || ' · now ' || v_when,
      public.team_portal_path(a.member_id), jsonb_build_object('appointment_id', p_id, 'change', 'moved'));
  end if;
  if a.created_by <> v_actor and a.created_by <> a.member_id then
    perform public.team_diary_notify(a.created_by, 'Team appointment moved', a.client_name || ' · now ' || v_when,
      '/staff/team-diary', jsonb_build_object('appointment_id', p_id, 'change', 'moved'));
  end if;
  perform public.staff_audit_write('team_appointment', p_id, 'team_appointment_moved', p_reason,
    jsonb_build_object('by', v_role));
  return jsonb_build_object('appointment_id', p_id, 'email_id', v_email);
end;
$$;

create or replace function public.team_cancel_appointment(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.team_appointments; v_role text; v_actor uuid := (select auth.uid()); v_email uuid;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 or not public.staff_text_is_safe(p_reason) then
    raise exception 'Say briefly why the appointment is cancelled';
  end if;
  select * into a from public.team_appointments where id = p_id;
  if not found then raise exception 'Appointment not found'; end if;
  perform pg_advisory_xact_lock(hashtext('team-diary:' || a.member_id::text));
  select * into a from public.team_appointments where id = p_id for update;
  v_role := public.team_change_actor(a);
  if a.status <> 'scheduled' or a.starts_at <= now() then raise exception 'Only a future scheduled appointment can be cancelled'; end if;

  update public.team_appointments set status = 'cancelled' where id = p_id;
  insert into public.team_appointment_changes (appointment_id, actor_id, actor_role, kind, from_starts, from_ends, reason)
  values (p_id, v_actor, v_role, 'cancelled', a.starts_at, a.ends_at, btrim(p_reason));
  v_email := public.team_queue_client_email(p_id, 'cancelled');

  if a.member_id <> v_actor then
    perform public.team_diary_notify(a.member_id, 'Appointment cancelled', a.client_name || ' · '
      || to_char(a.starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI'),
      public.team_portal_path(a.member_id), jsonb_build_object('appointment_id', p_id, 'change', 'cancelled'));
  end if;
  if a.created_by <> v_actor and a.created_by <> a.member_id then
    perform public.team_diary_notify(a.created_by, 'Team appointment cancelled', a.client_name || ' · '
      || to_char(a.starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI'),
      '/staff/team-diary', jsonb_build_object('appointment_id', p_id, 'change', 'cancelled'));
  end if;
  perform public.staff_audit_write('team_appointment', p_id, 'team_appointment_cancelled', p_reason,
    jsonb_build_object('by', v_role));
  return jsonb_build_object('appointment_id', p_id, 'email_id', v_email);
end;
$$;

-- Bookers see every team diary (or one member's); a team member sees only their own.
create or replace function public.team_appointments_list(p_member uuid, p_from timestamptz, p_to timestamptz)
returns table (
  appointment_id uuid, member_id uuid, member_name text, member_type text, client_name text, client_email text,
  client_phone text, reason text, starts_at timestamptz, ends_at timestamptz, status text,
  email_status text, can_change boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_staff boolean := public.team_booker_role() is not null;
begin
  if not v_staff and public.team_member_type(v_uid) is null then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  if p_to <= p_from or p_to - p_from > interval '93 days' then raise exception 'Choose a window of up to three months'; end if;
  return query
    select a.id, a.member_id, p.full_name, public.team_member_type(a.member_id), a.client_name, a.client_email,
           a.client_phone, a.reason, a.starts_at, a.ends_at, a.status,
           (select e.status from public.team_appointment_emails e where e.appointment_id = a.id order by e.revision desc limit 1),
           a.status = 'scheduled' and a.starts_at > now()
      from public.team_appointments a join public.profiles p on p.id = a.member_id
     where (case when v_staff then (p_member is null or a.member_id = p_member) else a.member_id = v_uid end)
       and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
     order by a.starts_at
     limit 300;
end;
$$;

revoke all on function public.team_diary_members() from public, anon;
revoke all on function public.team_book_appointment(uuid, text, text, text, text, timestamptz, timestamptz, uuid, text) from public, anon;
revoke all on function public.team_move_appointment(uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.team_cancel_appointment(uuid, text) from public, anon;
revoke all on function public.team_appointments_list(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.team_diary_members() to authenticated;
grant execute on function public.team_book_appointment(uuid, text, text, text, text, timestamptz, timestamptz, uuid, text) to authenticated;
grant execute on function public.team_move_appointment(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.team_cancel_appointment(uuid, text) to authenticated;
grant execute on function public.team_appointments_list(uuid, timestamptz, timestamptz) to authenticated;

-- 4. Email sender (service role only) ----------------------------------------------------------------------
create or replace function public.claim_team_appointment_email(p_email_id uuid)
returns public.team_appointment_emails
language plpgsql security definer set search_path = '' as $$
declare v public.team_appointment_emails;
begin
  update public.team_appointment_emails
     set status = 'processing', attempts = attempts + 1, error_message = null
   where id = p_email_id
     and (status in ('queued', 'failed') or (status = 'processing' and updated_at < now() - interval '15 minutes'))
     and attempts < 5
  returning * into v;
  if not found then raise exception 'Email is not claimable'; end if;
  return v;
end;
$$;

create or replace function public.record_team_appointment_email_result(
  p_email_id uuid, p_status text, p_external_id text default null, p_error_message text default null)
returns public.team_appointment_emails
language plpgsql security definer set search_path = '' as $$
declare v public.team_appointment_emails;
begin
  if p_status not in ('sent', 'failed') then raise exception 'Unsupported delivery result'; end if;
  update public.team_appointment_emails
     set status = p_status, external_id = nullif(btrim(p_external_id), ''),
         error_message = case when p_status = 'failed' then left(nullif(btrim(p_error_message), ''), 1000) end,
         sent_at = case when p_status = 'sent' then now() end
   where id = p_email_id and status = 'processing'
  returning * into v;
  if not found then raise exception 'Email is not processing'; end if;
  return v;
end;
$$;

-- What the email says: the appointment as it is now, and the team member's contact details.
create or replace function public.team_appointment_email_payload(p_email_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'kind', e.kind, 'recipient_email', e.recipient_email, 'recipient_name', e.recipient_name,
           'member_name', p.full_name, 'member_phone', p.phone_number, 'member_email', p.email,
           'reason', a.reason, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status)
    from public.team_appointment_emails e
    join public.team_appointments a on a.id = e.appointment_id
    join public.profiles p on p.id = a.member_id
   where e.id = p_email_id;
$$;

revoke all on function public.claim_team_appointment_email(uuid) from public, anon, authenticated;
revoke all on function public.record_team_appointment_email_result(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.team_appointment_email_payload(uuid) from public, anon, authenticated;
grant execute on function public.claim_team_appointment_email(uuid) to service_role;
grant execute on function public.record_team_appointment_email_result(uuid, text, text, text) to service_role;
grant execute on function public.team_appointment_email_payload(uuid) to service_role;

notify pgrst, 'reload schema';
