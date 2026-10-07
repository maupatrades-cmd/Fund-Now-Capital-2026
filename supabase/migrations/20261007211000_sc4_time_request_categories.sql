-- SC4 follow-up: the Founder's default open slots allow urgent/submission/submission_update/consultation,
-- so a Coordinator's request for other time may use consultation, submission and submission_update as well.
alter table public.calendar_time_requests drop constraint if exists calendar_time_requests_category_check;
alter table public.calendar_time_requests add constraint calendar_time_requests_category_check
  check (category in ('consultation', 'submission', 'submission_update', 'call', 'presentation', 'paperwork_review'));

create or replace function public.staff_request_founder_time(
  p_calendar_owner uuid, p_category text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_reason text, p_lead_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  perform public.calendar_require_permission(p_calendar_owner, 'create');
  if p_category not in ('consultation', 'submission', 'submission_update', 'call', 'presentation', 'paperwork_review') then
    raise exception 'Unsupported booking category';
  end if;
  if p_ends_at <= p_starts_at or p_starts_at <= now() or p_ends_at - p_starts_at > interval '12 hours' then
    raise exception 'A request must be a future interval no longer than twelve hours';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 or not public.staff_text_is_safe(p_reason) then
    raise exception 'Give a reason of at least 10 characters, without ID or account numbers';
  end if;
  if (select count(*) from public.calendar_time_requests r where r.requester_id = v_uid and r.status = 'pending') >= 5 then
    raise exception 'You already have 5 requests waiting for the Founder';
  end if;
  insert into public.calendar_time_requests (requester_id, calendar_owner_id, category, starts_at, ends_at, reason, lead_id)
  values (v_uid, p_calendar_owner, p_category, p_starts_at, p_ends_at, btrim(p_reason), p_lead_id) returning id into v_id;
  perform public.staff_audit_write('calendar_time_request', v_id, 'time_requested', null,
    jsonb_build_object('calendar_owner', p_calendar_owner, 'category', p_category));
  return v_id;
end;
$$;
