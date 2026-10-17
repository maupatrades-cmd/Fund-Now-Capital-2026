-- Staff review fixes 2 (Codex handover, 17 Oct 2026). Forward-only; replaces three function bodies.
-- 1. Wording: a Verified file with no funder-side stage has NOT been sent to a funder yet, so it must
--    not say "Submitted to a funding partner". Only the Owner's funder stage 'submitted' says that.
-- 2. Reschedule: staff could move a Founder booking to a time the Founder never opened (create
--    checked open slots, reschedule did not). Reschedule now applies the same SC4 rule.
-- 3. KPI: the send-back count compared against 'send_back', but the decision value stored is
--    'send_back_with_query', so the KPI always read 0%.

create or replace function public.intake_status_wording(p_lead_id uuid)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_status public.intake_workflow_status; v_stage public.intake_funder_stage; v_cat text; v_missing text[];
begin
  select si.workflow_status into v_status from public.submission_intakes si where si.lead_id = p_lead_id;
  if not found then return null; end if;
  select fs.stage, fs.decline_category into v_stage, v_cat
    from public.submission_intake_funder_stage fs where fs.lead_id = p_lead_id;
  if v_stage is not null then
    return case v_stage
      when 'submitted'    then 'Submitted to a funding partner'
      when 'funder_query' then 'The funding partner has a question. We will contact the client.'
      when 'offer'        then 'Offer received. Waiting for the client to accept.'
      when 'approved'     then 'Approved. Payout is being arranged.'
      when 'declined'     then 'Not approved at this time. Reason: ' || replace(coalesce(v_cat, 'other'), '_', ' ')
      when 'withdrawn'    then 'This application has been withdrawn.'
      when 'funded'       then 'Funded. The commission process has started.'
      when 'stale'        then 'On hold: no response from the client for 10 business days'
    end;
  end if;
  return case v_status
    when 'new' then 'Received. We are contacting the client.'
    when 'documents_incomplete' then 'Waiting for documents: ' ||
      coalesce(nullif(replace(array_to_string(public.intake_required_docs_missing(p_lead_id), ', '), '_', ' '), ''), 'none outstanding')
    when 'complete' then 'File complete and under internal review'
    when 'with_founder' then 'File complete and under internal review'
    when 'verified' then 'Approved by the Founder. Being prepared for a funding partner.'
  end;
end;
$$;
revoke all on function public.intake_status_wording(uuid) from public, anon, authenticated;

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
  if v_role <> 'owner' then perform public.calendar_require_open_slot(v_event.owner_id, v_event.category, p_starts_at, p_ends_at); end if;
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

create or replace function public.staff_coordinator_kpis(p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_since timestamptz; v_n int; v_ok int;
  v_ans_n int; v_ans_ok int; v_cmp_n int; v_cmp_ok int; v_act int; v_stale int;
  v_dec_n int; v_dec_back int; v_ci_n int; v_ci_ok int;
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  p_days := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since := now() - make_interval(days => p_days);

  select count(*)::int, count(*) filter (where not coalesce(a.answered_late, false))::int into v_ans_n, v_ans_ok
    from public.answer_desk_items a
   where a.kind = 'status_question' and a.status <> 'open' and a.answered_at >= v_since;

  select count(*)::int,
         count(*) filter (where (
           select count(*) from generate_series((si.registered_at at time zone 'Africa/Johannesburg')::date,
                                                (si.first_complete_at at time zone 'Africa/Johannesburg')::date - 1, interval '1 day') d
            where extract(isodow from d) < 6) <= 7)::int
    into v_cmp_n, v_cmp_ok
    from public.submission_intakes si
   where si.first_complete_at >= v_since;

  select count(*)::int, count(*) filter (where si.updated_at < now() - interval '7 days')::int into v_act, v_stale
    from public.submission_intakes si
   where si.archived_at is null and si.workflow_status in ('new', 'documents_incomplete', 'complete');

  select count(*)::int, count(*) filter (where d.decision = 'send_back_with_query')::int into v_dec_n, v_dec_back
    from public.founder_decisions d where d.decided_at >= v_since;

  select count(*)::int, count(*) filter (where r.status = 'done')::int into v_ci_n, v_ci_ok
    from public.staff_checkin_reminders r
   where r.due_on between (v_since at time zone 'Africa/Johannesburg')::date and (now() at time zone 'Africa/Johannesburg')::date;

  return jsonb_build_object('days', p_days, 'kpis', jsonb_build_array(
    jsonb_build_object('key', 'answers_in_4h', 'label', 'Status answers within 4 working hours', 'target_pct', 90, 'direction', 'min',
      'sample', v_ans_n, 'value_pct', case when v_ans_n > 0 then round(100.0 * v_ans_ok / v_ans_n, 1) end),
    jsonb_build_object('key', 'new_to_complete_7d', 'label', 'Files Complete within 7 business days', 'target_pct', 100, 'direction', 'min',
      'sample', v_cmp_n, 'value_pct', case when v_cmp_n > 0 then round(100.0 * v_cmp_ok / v_cmp_n, 1) end),
    jsonb_build_object('key', 'stale_files', 'label', 'Active files not touched for 7 days', 'target_pct', 20, 'direction', 'max',
      'sample', v_act, 'value_pct', case when v_act > 0 then round(100.0 * v_stale / v_act, 1) end),
    jsonb_build_object('key', 'sent_back', 'label', 'Files sent back by the Founder', 'target_pct', 10, 'direction', 'max',
      'sample', v_dec_n, 'value_pct', case when v_dec_n > 0 then round(100.0 * v_dec_back / v_dec_n, 1) end),
    jsonb_build_object('key', 'checkins', 'label', 'Check-ins completed', 'target_pct', 95, 'direction', 'min',
      'sample', v_ci_n, 'value_pct', case when v_ci_n > 0 then round(100.0 * v_ci_ok / v_ci_n, 1) end),
    jsonb_build_object('key', 'same_day_ack', 'label', 'Leads acknowledged the same day', 'target_pct', 100, 'direction', 'min', 'not_tracked', true),
    jsonb_build_object('key', 'first_contact_1d', 'label', 'First contact within 1 day', 'target_pct', 95, 'direction', 'min', 'not_tracked', true)));
end $$;
revoke all on function public.staff_coordinator_kpis(int) from public, anon;
grant execute on function public.staff_coordinator_kpis(int) to authenticated;
notify pgrst, 'reload schema';
