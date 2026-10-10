-- Sales Coordinator build SC5: one landing read for the Coordinator (and Owner).
-- Counts of active files by status, the oldest files still being worked, the Founder's latest
-- answers, open Founder decisions, time requests, and the caller's own open and overdue tasks.
-- No funder identity, funder stage, commission, bank or ID data is read here.
create or replace function public.staff_coordinator_landing()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text; v_uid uuid := (select auth.uid());
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator']);
  return jsonb_build_object(
    'status_counts', coalesce((
      select jsonb_object_agg(s.workflow_status, s.n)
        from (select si.workflow_status::text, count(*)::int n from public.submission_intakes si
               where si.archived_at is null group by 1) s), '{}'::jsonb),
    'oldest_open_files', coalesce((
      select jsonb_agg(x order by x.waiting_days desc) from (
        select si.lead_id, l.business_name, si.workflow_status::text as workflow_status,
               (current_date - (si.updated_at at time zone 'Africa/Johannesburg')::date)::int as waiting_days,
               coalesce(cardinality(public.intake_required_docs_missing(si.lead_id)), 0) as missing_count
          from public.submission_intakes si join public.leads l on l.id = si.lead_id
         where si.archived_at is null and si.workflow_status in ('new', 'documents_incomplete')
         order by si.updated_at asc limit 10) x), '[]'::jsonb),
    'founder_open', (select count(*)::int from public.staff_tasks t where t.task_kind = 'founder_decision' and t.status = 'open'),
    'founder_recent', coalesce((
      select jsonb_agg(x order by x.decided_at desc) from (
        select d.lead_id, l.business_name, d.decision, d.decline_category, d.note, d.decided_at
          from public.founder_decisions d join public.leads l on l.id = d.lead_id
         order by d.decided_at desc limit 5) x), '[]'::jsonb),
    'time_requests_pending', (select count(*)::int from public.calendar_time_requests r
                               where r.status = 'pending' and (v_role = 'owner' or r.requester_id = v_uid)),
    'time_requests_answered_7d', (select count(*)::int from public.calendar_time_requests r
                                   where r.status <> 'pending' and r.decided_at > now() - interval '7 days'
                                     and (v_role = 'owner' or r.requester_id = v_uid)),
    'my_open_tasks', (select count(*)::int from public.staff_tasks t
                       where t.status = 'open' and t.task_kind <> 'founder_decision'
                         and (v_role = 'owner' or t.route_to = 'coordinator' or t.assigned_to = v_uid or t.created_by = v_uid)),
    'my_overdue_tasks', (select count(*)::int from public.staff_tasks t
                          where t.status = 'open' and t.task_kind <> 'founder_decision' and t.due_at < now()
                            and (v_role = 'owner' or t.route_to = 'coordinator' or t.assigned_to = v_uid or t.created_by = v_uid))
  );
end;
$$;
revoke all on function public.staff_coordinator_landing() from public, anon;
grant execute on function public.staff_coordinator_landing() to authenticated;
