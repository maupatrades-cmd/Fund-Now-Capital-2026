-- SC9: R35 Qualifying File tracker and Coordinator KPIs (Owner-confirmed rule, 10 Oct).
-- A file qualifies once, for the handler assigned when it first reached With Founder, if
--   (1) that handler was assigned at or before the file first became Complete (proxy for
--       "assigned from first contact" - the Founder judges the edge cases),
--   (2) the file became Complete (all required documents received), and
--   (3) the file reached With Founder.
-- Month = the month it first reached With Founder (Johannesburg). Cut-off the 4th of the next
-- month, Founder sign-off, paid the 27th of the next month. Everything here is an ESTIMATE
-- until the Founder signs off. Read-only; no payment is created and no commission data is touched.
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
    select wf.lead_id, wf.reached_at,
           (select nullif(a.detail ->> 'to', '')::uuid from public.staff_audit_events a
             where a.entity_type = 'submission_intake' and a.entity_id = wf.lead_id
               and a.event_type = 'assignee_changed' and a.occurred_at <= wf.reached_at
             order by a.occurred_at desc, a.id desc limit 1) as handler_id
      from wf
     where date_trunc('month', wf.reached_at at time zone 'Africa/Johannesburg')::date = v_start
  ), q as (
    select s.lead_id, s.reached_at, s.handler_id, si.first_complete_at,
           (select min(a.occurred_at) from public.staff_audit_events a
             where a.entity_type = 'submission_intake' and a.entity_id = s.lead_id
               and a.event_type = 'assignee_changed' and a.detail ->> 'to' = s.handler_id::text) as first_assigned_at
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

-- KPIs against the blueprint targets, over the last p_days days. Same-day acknowledgement and
-- first-contact timing are not recorded anywhere yet, so they are reported as not_tracked.
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

  select count(*)::int, count(*) filter (where d.decision = 'send_back')::int into v_dec_n, v_dec_back
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
