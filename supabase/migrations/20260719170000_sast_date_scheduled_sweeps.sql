-- SAST-native date for scheduled sweeps (B3 + B4 hotfix).
--
-- Bug found during B4 real-workflow smoke test at 01:48 SAST on 2026-07-20: a
-- follow-up logged with date = today returned 0 from check_followups_due(),
-- because the sweeps compared against raw current_date — which is UTC. At that
-- moment it was still 2026-07-19 in UTC, so a SAST-today follow-up (2026-07-20)
-- looked like tomorrow to the database (follow_up_date <= current_date → false).
--
-- The CRM operates in SAST because the business does. Fix: a canonical
-- current_sast_date() helper, and migrate the follow-up + document-expiry sweeps
-- (detection + mark) to use it. pg_cron SCHEDULES are unchanged — they still run
-- at 04:00 / 04:15 UTC (06:00 / 06:15 SAST); only what the sweeps consider
-- "today" becomes SAST-native. SA observes no DST, so the offset is always +2.

-- ===========================================================================
-- 1. current_sast_date() — canonical "today" for South African business logic.
-- ===========================================================================
create or replace function public.current_sast_date()
returns date
language sql
stable
parallel safe
set search_path = ''
as $$
  select (current_timestamp at time zone 'Africa/Johannesburg')::date;
$$;

comment on function public.current_sast_date() is
'Returns the current date in Africa/Johannesburg timezone (SAST, UTC+2). Used by scheduled sweeps and any date comparison where the user-facing calendar matters more than UTC. Canonical replacement for current_date in South African business logic.';

revoke all on function public.current_sast_date() from public;
grant execute on function public.current_sast_date() to authenticated;

-- ===========================================================================
-- 2. followups_due() — detection default now SAST (was current_date/UTC).
-- ===========================================================================
create or replace function public.followups_due(p_as_of date default public.current_sast_date())
returns table (
  call_log_id    uuid,
  client_id      uuid,
  client_name    text,
  medium         public.call_medium,
  call_date      date,
  follow_up_date date,
  next_action    text
)
language sql
stable
security definer
set search_path to ''
as $$
  select cl.id, cl.client_id, coalesce(c.business_name, 'the client'),
         cl.medium, cl.call_date, cl.follow_up_date, cl.next_action
  from public.call_logs cl
  left join public.clients c on c.id = cl.client_id
  where cl.follow_up_needed
    and cl.follow_up_date is not null
    and cl.follow_up_date <= p_as_of
    and not exists (select 1 from public.call_log_followup_alerts a where a.call_log_id = cl.id);
$$;

-- ===========================================================================
-- 3. check_followups_due() — sweep now evaluates "due" as of SAST today.
-- ===========================================================================
create or replace function public.check_followups_due()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_owner   uuid := public.notify_owner();
  r         record;
  v_claimed boolean;
  v_body    text;
  v_medium  text;
  v_count   integer := 0;
begin
  if v_owner is null then
    return 0;
  end if;

  for r in select * from public.followups_due(public.current_sast_date()) loop
    insert into public.call_log_followup_alerts (call_log_id)
    values (r.call_log_id)
    on conflict (call_log_id) do nothing
    returning true into v_claimed;

    if not coalesce(v_claimed, false) then
      continue;  -- another sweep already claimed this follow-up
    end if;

    v_medium := replace(r.medium::text, '_', ' ');
    v_body := r.client_name || ' — ' || coalesce(nullif(btrim(r.next_action), ''), 'follow-up needed')
      || ' (from your ' || v_medium || ' on ' || to_char(r.call_date, 'DD Mon YYYY') || ').';

    perform public.emit_in_app_notification(
      v_owner, 'FOLLOW_UP_DUE', 'Follow-up due', v_body, '/clients/' || r.client_id::text,
      jsonb_build_object(
        'call_log_id',    r.call_log_id,
        'client_id',      r.client_id,
        'follow_up_date', r.follow_up_date
      ));
    v_count := v_count + 1;
  end loop;

  return v_count;
end; $$;

-- ===========================================================================
-- 4. document_expiry_due() — detection default now SAST (was current_date/UTC).
-- ===========================================================================
create or replace function public.document_expiry_due(p_as_of date default public.current_sast_date())
returns table (
  document_id      uuid,
  alert_type       public.notification_event_type,
  document_type    public.document_type,
  is_period_scoped boolean,
  period_start     date,
  period_end       date,
  expiry_date      date,
  client_id        uuid,
  lead_id          uuid,
  entity_name      text
)
language sql
stable
security definer
set search_path = ''
as $$
  with due as (
    select
      d.id,
      case
        when d.expiry_date < p_as_of              then 'DOCUMENT_EXPIRED'::public.notification_event_type
        when (d.expiry_date - p_as_of) <= 7       then 'DOCUMENT_EXPIRING_7D'::public.notification_event_type
        when (d.expiry_date - p_as_of) <= 30      then 'DOCUMENT_EXPIRING_30D'::public.notification_event_type
        else null
      end as alert_type,
      d.document_type, d.is_period_scoped, d.period_start, d.period_end,
      d.expiry_date, d.client_id, d.lead_id
    from public.documents d
    where d.is_current_version
      and d.status = 'active'
      and d.expiry_date is not null
  )
  select
    due.id, due.alert_type, due.document_type, due.is_period_scoped,
    due.period_start, due.period_end, due.expiry_date, due.client_id, due.lead_id,
    coalesce(c.business_name, l.business_name, 'the client') as entity_name
  from due
  left join public.clients c on c.id = due.client_id
  left join public.leads   l on l.id = due.lead_id
  where due.alert_type is not null
    and not exists (
      select 1 from public.document_expiry_alerts a
      where a.document_id = due.id and a.alert_type = due.alert_type
    );
$$;

-- ===========================================================================
-- 5. mark_expired_documents() — the active→expired flip is scheduled-job logic
--    too, so it moves to SAST as well. (Not in the original hotfix enumeration,
--    but leaving it on UTC would disagree with document_expiry_due() at the
--    midnight boundary — one would classify a doc EXPIRED while the other
--    refused to flip it. Kept consistent.)
-- ===========================================================================
create or replace function public.mark_expired_documents()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.documents
     set status = 'expired'
   where is_current_version
     and status = 'active'
     and expiry_date is not null
     and expiry_date < public.current_sast_date();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ===========================================================================
-- 6. check_document_expiries() — sweep now evaluates "due" as of SAST today.
-- ===========================================================================
create or replace function public.check_document_expiries()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.notify_owner();
  r       record;
  v_title text;
  v_body  text;
  v_label text;
  v_link  text;
  v_when  text;
  v_claimed boolean;
  v_count integer := 0;
begin
  if v_owner is null then
    -- No owner to notify, but still keep the lifecycle column truthful:
    -- past-expiry docs must flip active → expired regardless of notification.
    perform public.mark_expired_documents();
    return 0;
  end if;

  for r in select * from public.document_expiry_due(public.current_sast_date()) loop
    -- Claim the (document, threshold) alert BEFORE composing/emitting so two
    -- concurrent sweeps can't both pass document_expiry_due() and double-send.
    -- ON CONFLICT DO NOTHING returns no row on a lost race → v_claimed is NULL;
    -- only the sweep that actually inserts the ledger row emits (claim-then-act).
    insert into public.document_expiry_alerts (document_id, alert_type)
    values (r.document_id, r.alert_type)
    on conflict (document_id, alert_type) do nothing
    returning true into v_claimed;

    if not coalesce(v_claimed, false) then
      continue;  -- another sweep already claimed this alert; skip emission
    end if;

    v_label := public.document_type_label(r.document_type);
    v_link  := case when r.client_id is not null
                    then '/clients/' || r.client_id::text
                    else '/leads/'   || r.lead_id::text end;
    v_when  := case when r.alert_type = 'DOCUMENT_EXPIRED'
                    then 'expired on '  || to_char(r.expiry_date, 'DD Mon YYYY')
                    else 'expires on '  || to_char(r.expiry_date, 'DD Mon YYYY') end;

    v_title := case r.alert_type
                 when 'DOCUMENT_EXPIRED'      then 'Document expired'
                 when 'DOCUMENT_EXPIRING_7D'  then 'Document expiring soon'
                 else                              'Document expiring within 30 days'
               end;

    if r.is_period_scoped then
      -- Pack-aware body for period-scoped types (bank statements etc.).
      v_body := r.entity_name || '''s ' || v_label || ' pack — the '
        || coalesce(to_char(r.period_start, 'DD Mon YYYY'), '?') || ' – '
        || coalesce(to_char(r.period_end,   'DD Mon YYYY'), '?') || ' statement '
        || v_when || '. Upload the next period to keep a current 12-month pack.';
    else
      v_body := r.entity_name || '''s ' || v_label || ' ' || v_when || '.';
    end if;

    -- emit_in_app_notification fans out to in-app + email automatically.
    perform public.emit_in_app_notification(
      v_owner, r.alert_type, v_title, v_body, v_link,
      jsonb_build_object(
        'document_id',   r.document_id,
        'document_type', r.document_type,
        'client_id',     r.client_id,
        'lead_id',       r.lead_id,
        'expiry_date',   r.expiry_date
      )
    );

    v_count := v_count + 1;
  end loop;

  perform public.mark_expired_documents();
  return v_count;
end;
$$;

-- Re-assert the internal-only lockdown on every re-declared emit-capable
-- function. CREATE OR REPLACE preserves ACL, but Supabase re-grants EXECUTE to
-- anon/authenticated/service_role on function DDL, so revoke explicitly (the
-- qualify_lead lesson). current_sast_date() is intentionally left callable by
-- authenticated (a harmless date helper) per its grant above.
revoke execute on function public.followups_due(date)         from public, anon, authenticated;
revoke execute on function public.check_followups_due()       from public, anon, authenticated;
revoke execute on function public.document_expiry_due(date)   from public, anon, authenticated;
revoke execute on function public.mark_expired_documents()    from public, anon, authenticated;
revoke execute on function public.check_document_expiries()   from public, anon, authenticated;

-- ===========================================================================
-- 7. Assertions — prove the SAST conversion across the UTC-midnight boundary.
--    timestamptz literals carry an explicit offset, so they are independent of
--    the session timezone; `at time zone 'Africa/Johannesburg'` yields Joburg
--    wall-clock, and ::date the calendar day there. RAISEs (rolls back) on any
--    mismatch. SA has no DST, so +2 holds year-round.
-- ===========================================================================
do $$
begin
  -- 21:00 UTC = 23:00 SAST, still the 19th
  if (timestamptz '2026-07-19 21:00:00+00' at time zone 'Africa/Johannesburg')::date <> date '2026-07-19' then
    raise exception 'SAST assert FAIL: 2026-07-19 21:00 UTC should map to 2026-07-19 SAST';
  end if;
  -- 22:00 UTC = 00:00 SAST, ticks over to the 20th (the exact bug window)
  if (timestamptz '2026-07-19 22:00:00+00' at time zone 'Africa/Johannesburg')::date <> date '2026-07-20' then
    raise exception 'SAST assert FAIL: 2026-07-19 22:00 UTC should map to 2026-07-20 SAST';
  end if;
  -- 04:00 UTC = 06:00 SAST, the 20th (when the document-expiry cron runs)
  if (timestamptz '2026-07-20 04:00:00+00' at time zone 'Africa/Johannesburg')::date <> date '2026-07-20' then
    raise exception 'SAST assert FAIL: 2026-07-20 04:00 UTC should map to 2026-07-20 SAST';
  end if;
  -- The live helper is never earlier than UTC current_date (SAST is UTC+2).
  if public.current_sast_date() < current_date then
    raise exception 'SAST assert FAIL: current_sast_date() is earlier than UTC current_date';
  end if;
  raise notice 'current_sast_date assertions passed (SAST boundary correct; sweeps SAST-native).';
end $$;

notify pgrst, 'reload schema';
