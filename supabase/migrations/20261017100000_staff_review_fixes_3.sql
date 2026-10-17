-- Staff review fixes 3 (Qodo review of PR #297, owner-approved 17 Oct 2026). Forward-only.
-- 1. Reschedule: staff may move a booking within the Founder slot it already occupies (booking
--    closes that slot, so the open-slot check refused every small shift).
-- 2. Answer desk: amber starts at 75% of the WORKING-hour allowance, not of wall-clock time.
-- 3. Document chasers: a file that left Documents incomplete (or re-entered it) stops showing
--    its old chasers straight away, not only after the next scheduled run.
-- 4. Qualifying files: Complete is compared with the start of the assignment in effect when the
--    file reached With Founder, not with the handler's earliest historical assignment.

-- Working minutes (08:00 to 20:00 Africa/Johannesburg, weekdays, not holidays) between two moments.
create or replace function public.business_minutes_between(p_from timestamptz, p_to timestamptz)
returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(greatest(0, extract(epoch from (
           least(p_to at time zone 'Africa/Johannesburg', d::timestamp + time '20:00')
         - greatest(p_from at time zone 'Africa/Johannesburg', d::timestamp + time '08:00'))) / 60)), 0)
    from generate_series((p_from at time zone 'Africa/Johannesburg')::date,
                         (p_to at time zone 'Africa/Johannesburg')::date, interval '1 day') d
   where p_to > p_from
     and extract(isodow from d) < 6
     and not exists (select 1 from public.business_holidays h where h.holiday_date = d::date);
$$;
revoke all on function public.business_minutes_between(timestamptz, timestamptz) from public, anon, authenticated;

-- When the current stay in Documents incomplete began; null if the file is not there now.
create or replace function public.intake_docs_incomplete_since(p_lead_id uuid)
returns timestamptz
language sql stable security definer set search_path = '' as $$
  select coalesce((select max(e.occurred_at) from public.staff_audit_events e
                    where e.entity_type = 'submission_intake' and e.entity_id = si.lead_id
                      and e.event_type = 'status_changed' and e.detail ->> 'to' = 'documents_incomplete'),
                  si.registered_at)
    from public.submission_intakes si
   where si.lead_id = p_lead_id and si.workflow_status = 'documents_incomplete' and si.archived_at is null;
$$;
revoke all on function public.intake_docs_incomplete_since(uuid) from public, anon, authenticated;

-- Open-slot rule for a MOVE: the target must sit inside one Founder slot that is open, or that is
-- closed only because this booking occupies it.
create or replace function public.calendar_require_open_slot_for_move(
  p_event_id uuid, p_calendar_owner uuid, p_category text, p_starts_at timestamptz, p_ends_at timestamptz)
returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz; v_to timestamptz;
begin
  select e.starts_at, e.ends_at into v_from, v_to from public.owner_calendar_events e where e.id = p_event_id;
  if not exists (
    select 1 from public.owner_availability_slots s
     where s.owner_id = p_calendar_owner
       and s.starts_at <= p_starts_at and s.ends_at >= p_ends_at
       and p_category = any (s.allowed_booking_types)
       and (s.is_open or tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(v_from, v_to, '[)'))) then
    raise exception 'That time is not open. Pick a slot the Founder has opened, or request another time';
  end if;
end;
$$;
revoke all on function public.calendar_require_open_slot_for_move(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;

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
  -- SC4: anyone but the Founder moves a booking only into time the Founder has opened.
  if v_role <> 'owner' then perform public.calendar_require_open_slot_for_move(p_event_id, v_event.owner_id, v_event.category, p_starts_at, p_ends_at); end if;
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

create or replace function public.staff_answer_desk(p_include_answered boolean default false)
returns table (id uuid, kind text, asker_type text, asker_label text, topic text, lead_id uuid, business_name text,
               asked_at timestamptz, due_at timestamptz, status text, answered_at timestamptz, answered_late boolean,
               sla_state text, minutes_left integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  return query
    select a.id, a.kind, a.asker_type, a.asker_label, a.topic, a.lead_id, l.business_name, a.asked_at, a.due_at, a.status,
           a.answered_at, a.answered_late,
           case when a.status = 'answered' then 'answered'
                when now() > a.due_at then 'red'
                -- Review fix 3: amber at 75% of the WORKING-hour allowance, not of wall-clock time.
                when public.business_minutes_between(a.asked_at, now()) >= 0.75 * public.business_minutes_between(a.asked_at, a.due_at) then 'amber'
                else 'green' end,
           case when a.status = 'open' then (extract(epoch from (a.due_at - now())) / 60)::integer end
      from public.answer_desk_items a left join public.leads l on l.id = a.lead_id
     where p_include_answered or a.status = 'open'
     order by (a.status = 'open') desc, a.due_at asc
     limit 100;
end;
$$;

create or replace function public.generate_document_chasers()
returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_entered timestamptz; v_mark integer; v_due timestamptz; v_n integer := 0; v_rows integer;
begin
  -- A file that moved on, or was archived, stops needing a chaser.
  -- Review fix 3: also skip chasers from an EARLIER stay in Documents incomplete.
  update public.intake_document_reminders d set status = 'skipped'
   where d.status = 'open' and d.entered_at is distinct from public.intake_docs_incomplete_since(d.lead_id);

  for r in select si.lead_id, si.registered_at from public.submission_intakes si
            where si.workflow_status = 'documents_incomplete' and si.archived_at is null loop
    select max(e.occurred_at) into v_entered from public.staff_audit_events e
     where e.entity_type = 'submission_intake' and e.entity_id = r.lead_id
       and e.event_type = 'status_changed' and e.detail->>'to' = 'documents_incomplete';
    v_entered := coalesce(v_entered, r.registered_at);
    foreach v_mark in array array[3, 7] loop
      v_due := public.business_hours_add(v_entered, v_mark * 12);
      if now() >= v_due then
        insert into public.intake_document_reminders (lead_id, day_mark, entered_at, due_at)
        values (r.lead_id, v_mark, v_entered, v_due) on conflict do nothing;
        get diagnostics v_rows = row_count; v_n := v_n + v_rows;
      end if;
    end loop;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.generate_document_chasers() from public, anon, authenticated;

create or replace function public.staff_document_chasers()
returns table (id uuid, lead_id uuid, business_name text, day_mark integer, due_at timestamptz, missing_documents text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  return query
    select d.id, d.lead_id, l.business_name, d.day_mark, d.due_at, public.intake_required_docs_missing(d.lead_id)
      from public.intake_document_reminders d join public.leads l on l.id = d.lead_id
     where d.status = 'open'
       -- Review fix 3: only files still in Documents incomplete, and only chasers for the current stay.
       and d.entered_at is not distinct from public.intake_docs_incomplete_since(d.lead_id)
     order by d.day_mark desc, d.due_at asc limit 100;
end;
$$;

create or replace function public.staff_qualifying_files(p_month date default null, p_handler uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text; v_uid uuid := (select auth.uid());
  v_start date; v_handler uuid;
  v_rate constant numeric := 35;
  v_files jsonb; v_count int;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator']);
  v_start := date_trunc('month', coalesce(p_month, (now() at time zone 'Africa/Johannesburg')::date))::date;
  v_handler := case when v_role = 'owner' then p_handler else v_uid end;

  with wf as (
    select e.entity_id as lead_id, min(e.occurred_at) as reached_at
      from public.staff_audit_events e
     where e.entity_type = 'submission_intake' and e.event_type = 'status_changed'
       and e.detail ->> 'to' = 'with_founder'
     group by e.entity_id
  ), scoped as (
    -- The assignment in effect when the file first reached With Founder: its handler AND its start.
    select wf.lead_id, wf.reached_at, cur.handler_id, cur.assigned_at
      from wf
      cross join lateral (
        select nullif(a.detail ->> 'to', '')::uuid as handler_id, a.occurred_at as assigned_at
          from public.staff_audit_events a
         where a.entity_type = 'submission_intake' and a.entity_id = wf.lead_id
           and a.event_type = 'assignee_changed' and a.occurred_at <= wf.reached_at
         order by a.occurred_at desc, a.id desc limit 1) cur
     where date_trunc('month', wf.reached_at at time zone 'Africa/Johannesburg')::date = v_start
  ), q as (
    -- Review fix 3: compare Complete with the start of THAT assignment, not the handler's earliest
    -- historical assignment (assign, remove, re-assign after Complete must not qualify).
    select s.lead_id, s.reached_at, s.handler_id, si.first_complete_at, s.assigned_at as first_assigned_at
      from scoped s join public.submission_intakes si on si.lead_id = s.lead_id
     where s.handler_id is not null and si.first_complete_at is not null
       and (v_handler is null or s.handler_id = v_handler)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'lead_id', q.lead_id, 'business_name', l.business_name, 'handler_id', q.handler_id,
           'handler_name', p.full_name, 'reached_founder_at', q.reached_at,
           'first_assigned_at', q.first_assigned_at, 'first_complete_at', q.first_complete_at)
         order by q.reached_at), '[]'::jsonb), count(*)::int
    into v_files, v_count
    from q join public.leads l on l.id = q.lead_id left join public.profiles p on p.id = q.handler_id
   where q.first_assigned_at <= q.first_complete_at;

  return jsonb_build_object(
    'month', v_start, 'rate_per_file', v_rate, 'count', v_count, 'estimate_total', v_count * v_rate,
    'cutoff_date', (v_start + interval '1 month' + interval '3 days')::date,
    'pay_date', (v_start + interval '1 month' + interval '26 days')::date,
    'status', 'estimate_until_founder_sign_off', 'files', v_files);
end $$;
revoke all on function public.staff_qualifying_files(date, uuid) from public, anon;
grant execute on function public.staff_qualifying_files(date, uuid) to authenticated;
notify pgrst, 'reload schema';
