-- Owner daily log (owner, 18 Nov 2026): "I need also daily activity so I can type out what happened on that day and
-- what I have done." A private journal for the Director: one entry per SAST day with three free-text fields, next to a
-- read-only list of what the CRM itself recorded for her that day (her own activity_logs rows).
--
-- Owner-only. Nobody else (staff, partners, agents, clients) can read or write it: RLS allows only the owner on her own
-- rows, and every RPC refuses anyone who is not the owner (42501). Entries are never deleted; clearing the text is
-- allowed. A save writes an activity_logs row that names the date only, never the journal text.

create table if not exists public.owner_daily_logs (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.profiles(id) on delete cascade,
  log_date           date not null,
  what_happened      text check (what_happened is null or length(what_happened) <= 8000),
  what_i_did         text check (what_i_did is null or length(what_i_did) <= 8000),
  notes_for_tomorrow text check (notes_for_tomorrow is null or length(notes_for_tomorrow) <= 8000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint owner_daily_logs_owner_date_uq unique (owner_id, log_date)
);

alter table public.owner_daily_logs enable row level security;
revoke all on table public.owner_daily_logs from public, anon, authenticated;
grant select, insert, update on table public.owner_daily_logs to authenticated;

drop policy if exists owner_daily_logs_select on public.owner_daily_logs;
create policy owner_daily_logs_select on public.owner_daily_logs for select to authenticated
  using (coalesce(public.is_owner(), false) and owner_id = (select auth.uid()));
drop policy if exists owner_daily_logs_insert on public.owner_daily_logs;
create policy owner_daily_logs_insert on public.owner_daily_logs for insert to authenticated
  with check (coalesce(public.is_owner(), false) and owner_id = (select auth.uid()));
drop policy if exists owner_daily_logs_update on public.owner_daily_logs;
create policy owner_daily_logs_update on public.owner_daily_logs for update to authenticated
  using (coalesce(public.is_owner(), false) and owner_id = (select auth.uid()))
  with check (coalesce(public.is_owner(), false) and owner_id = (select auth.uid()));
-- No delete policy: entries are kept.

create or replace function public.owner_daily_log_require_owner()
returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.is_owner(), false) or (select auth.uid()) is null then
    raise exception 'Only the Director can use the daily log' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;
revoke all on function public.owner_daily_log_require_owner() from public, anon, authenticated;

-- One day's entry (no row yet = all fields null, saved_at null).
create or replace function public.owner_daily_log_get(p_date date)
returns table (log_date date, what_happened text, what_i_did text, notes_for_tomorrow text, saved_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := public.owner_daily_log_require_owner();
begin
  if p_date is null then raise exception 'Choose a day'; end if;
  return query
    select p_date, l.what_happened, l.what_i_did, l.notes_for_tomorrow, l.updated_at
      from (select 1) x
      left join public.owner_daily_logs l on l.owner_id = v_owner and l.log_date = p_date;
end;
$$;
revoke all on function public.owner_daily_log_get(date) from public, anon;
grant execute on function public.owner_daily_log_get(date) to authenticated;

-- Save (create or replace) one day's entry. Today or earlier only (SAST).
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

  -- The log entry names the day only; the journal text never leaves the owner's own table. Autosave runs every few
  -- seconds while she types, so one entry per day per 30 minutes is enough (the first save of a day always logs).
  if not exists (
    select 1 from public.activity_logs a
     where a.user_id = v_owner and a.entity_type = 'daily_log'
       and a.description = 'Daily log updated for ' || to_char(p_date, 'YYYY-MM-DD')
       and a.occurred_at > now() - interval '30 minutes') then
    select p.email into v_email from public.profiles p where p.id = v_owner;
    insert into public.activity_logs (user_id, user_email, user_role, event_type, entity_type, entity_id, description)
    values (v_owner, v_email, 'owner', case when v_existed then 'UPDATE' else 'CREATE' end::public.activity_event_type,
            'daily_log', null, 'Daily log updated for ' || to_char(p_date, 'YYYY-MM-DD'));
  end if;
  return v_saved;
end;
$$;
revoke all on function public.owner_daily_log_save(date, text, text, text) from public, anon;
grant execute on function public.owner_daily_log_save(date, text, text, text) to authenticated;

-- Entries between two days (inclusive), newest first, for the History list and search. At most 366 days.
create or replace function public.owner_daily_log_list(p_from date, p_to date)
returns table (log_date date, what_happened text, what_i_did text, notes_for_tomorrow text, saved_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := public.owner_daily_log_require_owner();
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid range of days'; end if;
  if p_to - p_from > 366 then raise exception 'Choose a range of up to a year'; end if;
  return query
    select l.log_date, l.what_happened, l.what_i_did, l.notes_for_tomorrow, l.updated_at
      from public.owner_daily_logs l
     where l.owner_id = v_owner and l.log_date between p_from and p_to
     order by l.log_date desc;
end;
$$;
revoke all on function public.owner_daily_log_list(date, date) from public, anon;
grant execute on function public.owner_daily_log_list(date, date) to authenticated;

-- What the CRM recorded for the owner on that SAST day (her own activity_logs rows), oldest first, capped at 200.
-- The daily-log saves themselves are left out so the panel shows the work, not the journal.
create or replace function public.owner_daily_log_activity(p_date date)
returns table (occurred_at timestamptz, event_type text, entity_type text, description text)
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := public.owner_daily_log_require_owner();
begin
  if p_date is null then raise exception 'Choose a day'; end if;
  return query
    select a.occurred_at, a.event_type::text, a.entity_type, a.description
      from public.activity_logs a
     where a.user_id = v_owner
       and a.entity_type <> 'daily_log'
       and a.occurred_at >= (p_date::timestamp at time zone 'Africa/Johannesburg')
       and a.occurred_at < ((p_date + 1)::timestamp at time zone 'Africa/Johannesburg')
     order by a.occurred_at
     limit 200;
end;
$$;
revoke all on function public.owner_daily_log_activity(date) from public, anon;
grant execute on function public.owner_daily_log_activity(date) to authenticated;
