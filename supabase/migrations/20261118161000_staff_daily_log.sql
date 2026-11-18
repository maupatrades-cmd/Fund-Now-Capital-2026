-- Staff daily log (owner, 18 Nov 2026), 2/3: "can all staff have daily log". Every enabled staff member (any staff role)
-- gets their own Daily log, PRIVATE to that person: nobody else reads it, not even the Director, exactly like the
-- Director's own log (20261118140000). One table and one set of RPCs serve everyone:
--   * owner_daily_logs.owner_id now means "the writer" (the Director or a staff member). Every RPC scopes to auth.uid(),
--     so a caller can only ever reach their own rows; the RLS policies say the same.
--   * owner_daily_log_require_owner() keeps its name (the four RPCs call it) but now admits the Director OR an enabled
--     staff member (staff_role_of() is not null). Partners, agents, clients, anonymous callers and switched-off staff
--     still get 42501.
--   * owner_daily_log_save writes the activity-log entry with the writer's real role (owner or staff role); the journal
--     text is never logged and the 30-minute throttle stays.
--   * send_daily_log_reminders(): 16:30 SAST Monday to Friday (not on business_holidays), one in-app reminder per enabled
--     staff member per day who has not written any text in today's log. A claim-then-act ledger
--     (daily_log_reminders_sent) makes a second run the same day send nothing. The cron job is in 20261118162000.

comment on column public.owner_daily_logs.owner_id is
  'The writer of this daily log entry: the Director or a staff member. Only that person can read or write it.';

create or replace function public.owner_daily_log_require_owner()
returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null
     or not (coalesce(public.is_owner(), false) or public.staff_role_of() is not null) then
    raise exception 'You do not have permission to use the daily log' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;
revoke all on function public.owner_daily_log_require_owner() from public, anon, authenticated;

drop policy if exists owner_daily_logs_select on public.owner_daily_logs;
create policy owner_daily_logs_select on public.owner_daily_logs for select to authenticated
  using (owner_id = (select auth.uid()) and (coalesce(public.is_owner(), false) or public.staff_role_of() is not null));
drop policy if exists owner_daily_logs_insert on public.owner_daily_logs;
create policy owner_daily_logs_insert on public.owner_daily_logs for insert to authenticated
  with check (owner_id = (select auth.uid()) and (coalesce(public.is_owner(), false) or public.staff_role_of() is not null));
drop policy if exists owner_daily_logs_update on public.owner_daily_logs;
create policy owner_daily_logs_update on public.owner_daily_logs for update to authenticated
  using (owner_id = (select auth.uid()) and (coalesce(public.is_owner(), false) or public.staff_role_of() is not null))
  with check (owner_id = (select auth.uid()) and (coalesce(public.is_owner(), false) or public.staff_role_of() is not null));

-- Save: same as 20261118140000 except the activity-log role is the writer's real role.
create or replace function public.owner_daily_log_save(
  p_date date, p_what_happened text, p_what_i_did text, p_notes text)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := public.owner_daily_log_require_owner();
  v_happened text := nullif(btrim(coalesce(p_what_happened, '')), '');
  v_did text := nullif(btrim(coalesce(p_what_i_did, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_existed boolean; v_saved timestamptz; v_rows int; v_email text;
  v_role text := case when coalesce(public.is_owner(), false) then 'owner' else public.staff_role_of() end;
begin
  if p_date is null then raise exception 'Choose a day'; end if;
  if p_date > public.current_sast_date() then raise exception 'You can only write the log for today or an earlier day'; end if;
  if coalesce(length(v_happened), 0) > 8000 or coalesce(length(v_did), 0) > 8000 or coalesce(length(v_notes), 0) > 8000 then
    raise exception 'Keep each box under 8000 characters';
  end if;

  select exists (select 1 from public.owner_daily_logs l where l.owner_id = v_owner and l.log_date = p_date) into v_existed;
  insert into public.owner_daily_logs (owner_id, log_date, what_happened, what_i_did, notes_for_tomorrow)
  values (v_owner, p_date, v_happened, v_did, v_notes)
  on conflict (owner_id, log_date) do update
     set what_happened = excluded.what_happened, what_i_did = excluded.what_i_did,
         notes_for_tomorrow = excluded.notes_for_tomorrow, updated_at = now()
  returning updated_at into v_saved;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'Saving the daily log affected no rows'; end if;

  -- The log entry names the day only; the journal text never leaves the writer's own rows. Autosave runs every few
  -- seconds while typing, so one entry per day per 30 minutes is enough (the first save of a day always logs).
  if not exists (
    select 1 from public.activity_logs a
     where a.user_id = v_owner and a.entity_type = 'daily_log'
       and a.description = 'Daily log updated for ' || to_char(p_date, 'YYYY-MM-DD')
       and a.occurred_at > now() - interval '30 minutes') then
    select p.email into v_email from public.profiles p where p.id = v_owner;
    insert into public.activity_logs (user_id, user_email, user_role, event_type, entity_type, entity_id, description)
    values (v_owner, v_email, v_role, case when v_existed then 'UPDATE' else 'CREATE' end::public.activity_event_type,
            'daily_log', null, 'Daily log updated for ' || to_char(p_date, 'YYYY-MM-DD'));
  end if;
  return v_saved;
end;
$$;
revoke all on function public.owner_daily_log_save(date, text, text, text) from public, anon;
grant execute on function public.owner_daily_log_save(date, text, text, text) to authenticated;

-- Reminder ledger: one row per (person, day) a reminder was claimed. Server-only.
create table if not exists public.daily_log_reminders_sent (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  log_date   date not null,
  sent_at    timestamptz not null default now(),
  primary key (profile_id, log_date)
);
alter table public.daily_log_reminders_sent enable row level security;
revoke all on table public.daily_log_reminders_sent from public, anon, authenticated;

-- 16:30 SAST sweep. Returns the number of reminders sent. Weekends and business_holidays send nothing.
create or replace function public.send_daily_log_reminders(p_as_of timestamptz default now())
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (coalesce(p_as_of, now()) at time zone 'Africa/Johannesburg')::date;
  v_person uuid; v_claimed uuid; v_count integer := 0;
begin
  if extract(isodow from v_day) in (6, 7) then return 0; end if;
  if exists (select 1 from public.business_holidays h where h.holiday_date = v_day) then return 0; end if;

  for v_person in
    select p.id
      from public.profiles p
      join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
     where s.access_enabled and p.is_active
       and p.role::text in ('switchboard', 'coordinator', 'administrator', 'hr', 'field_supervisor', 'field_consultant')
       and not exists (
         select 1 from public.owner_daily_logs l
          where l.owner_id = p.id and l.log_date = v_day
            and coalesce(l.what_happened, l.what_i_did, l.notes_for_tomorrow) is not null)
     order by p.id
  loop
    v_claimed := null;
    insert into public.daily_log_reminders_sent (profile_id, log_date) values (v_person, v_day)
    on conflict (profile_id, log_date) do nothing
    returning profile_id into v_claimed;
    continue when v_claimed is null;
    perform public.staff_notify(v_person, 'DAILY_LOG_REMINDER', 'Daily log: write today''s entry',
      'You have not written today''s daily log yet. Note what happened and what you did before you finish.',
      '/staff/daily-log', jsonb_build_object('log_date', v_day));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.send_daily_log_reminders(timestamptz) from public, anon, authenticated;
