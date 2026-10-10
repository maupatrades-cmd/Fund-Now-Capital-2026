-- Preserve initial-confirmation meaning and invalidate older claimed notices.
-- No sender exists yet; a future sender must recheck revision before provider delivery.
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
   where event_id = p_event_id and status in ('queued', 'failed', 'processing');
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
notify pgrst, 'reload schema';
