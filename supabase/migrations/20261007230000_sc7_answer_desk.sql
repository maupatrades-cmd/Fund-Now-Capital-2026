-- Sales Coordinator build SC7: answer-desk timers.
-- Every question that someone is waiting on gets a due time counted in working hours
-- (08:00 to 20:00 Africa/Johannesburg, weekdays, not public holidays) and a traffic-light state:
-- green, amber from 75% of the window, red once overdue. Nothing is sent to anyone.
--   status_question 4 working hours · founder_holding_reply same working day ·
--   founder_answer 1 working day (12 working hours) · outcome_relay 1 working day · complaint_to_ops same working day

-- Add working hours to a moment. A working day is the 12 hours between 08:00 and 20:00.
create or replace function public.business_hours_add(p_from timestamptz, p_hours numeric)
returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  t timestamp := p_from at time zone 'Africa/Johannesburg';
  remaining numeric := p_hours * 60;
  d date; avail numeric; guard integer := 0;
begin
  loop
    guard := guard + 1;
    if guard > 400 then raise exception 'Could not place that time within 400 days'; end if;
    d := t::date;
    if extract(isodow from t) > 5 or exists (select 1 from public.business_holidays h where h.holiday_date = d) then
      t := (d + 1)::timestamp + time '08:00'; continue;
    end if;
    if t::time < time '08:00' then t := d::timestamp + time '08:00'; end if;
    if t::time >= time '20:00' then t := (d + 1)::timestamp + time '08:00'; continue; end if;
    avail := extract(epoch from ((d::timestamp + time '20:00') - t)) / 60;
    if remaining <= avail then t := t + make_interval(mins => remaining::integer); exit; end if;
    remaining := remaining - avail;
    t := (d + 1)::timestamp + time '08:00';
  end loop;
  return t at time zone 'Africa/Johannesburg';
end;
$$;

-- End of the working day that contains (or, after hours, follows) a moment.
create or replace function public.business_day_end(p_from timestamptz)
returns timestamptz
language plpgsql stable set search_path = '' as $$
declare t timestamp := public.business_hours_add(p_from, 0) at time zone 'Africa/Johannesburg';
begin
  return (t::date::timestamp + time '20:00') at time zone 'Africa/Johannesburg';
end;
$$;
revoke all on function public.business_hours_add(timestamptz, numeric) from public, anon, authenticated;
revoke all on function public.business_day_end(timestamptz) from public, anon, authenticated;

create table if not exists public.answer_desk_items (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('status_question', 'founder_holding_reply', 'founder_answer', 'outcome_relay', 'complaint_to_ops')),
  asker_type   text not null check (asker_type in ('agent', 'team_leader', 'partner', 'client', 'founder', 'other')),
  asker_label  text check (asker_label is null or length(btrim(asker_label)) between 1 and 120),
  topic        text not null check (length(btrim(topic)) between 3 and 300),
  lead_id      uuid references public.leads(id) on delete set null,
  asked_at     timestamptz not null default now(),
  due_at       timestamptz not null,
  status       text not null default 'open' check (status in ('open', 'answered')),
  answered_at  timestamptz,
  answered_by  uuid references public.profiles(id) on delete set null,
  answer_note  text check (answer_note is null or length(answer_note) <= 300),
  answered_late boolean,
  created_by   uuid not null references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now(),
  constraint answer_desk_safe_text_ck check (public.staff_text_is_safe(asker_label) and public.staff_text_is_safe(topic) and public.staff_text_is_safe(answer_note)),
  constraint answer_desk_answered_ck check ((status = 'open' and answered_at is null) or (status = 'answered' and answered_at is not null and answered_by is not null))
);
create index if not exists answer_desk_open_idx on public.answer_desk_items (due_at) where status = 'open';
alter table public.answer_desk_items enable row level security;
revoke all on table public.answer_desk_items from public, anon, authenticated;

create or replace function public.staff_log_answer_item(
  p_kind text, p_asker_type text, p_asker_label text, p_topic text, p_lead_id uuid default null, p_asked_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_asked timestamptz := coalesce(p_asked_at, now()); v_due timestamptz; v_id uuid;
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  if v_asked > now() + interval '5 minutes' then raise exception 'The question cannot be asked in the future'; end if;
  if v_asked < now() - interval '14 days' then raise exception 'Questions older than 14 days cannot be logged'; end if;
  v_due := case p_kind
    when 'status_question' then public.business_hours_add(v_asked, 4)
    when 'founder_answer' then public.business_hours_add(v_asked, 12)
    when 'outcome_relay' then public.business_hours_add(v_asked, 12)
    when 'founder_holding_reply' then public.business_day_end(v_asked)
    when 'complaint_to_ops' then public.business_day_end(v_asked)
    else null end;
  if v_due is null then raise exception 'Unknown question type'; end if;
  if p_lead_id is not null and not exists (select 1 from public.submission_intakes si where si.lead_id = p_lead_id) then
    raise exception 'Submission not found';
  end if;
  insert into public.answer_desk_items (kind, asker_type, asker_label, topic, lead_id, asked_at, due_at, created_by)
  values (p_kind, p_asker_type, nullif(btrim(p_asker_label), ''), btrim(p_topic), p_lead_id, v_asked, v_due, v_uid)
  returning id into v_id;
  perform public.staff_audit_write('answer_desk_item', v_id, 'answer_item_logged', null, jsonb_build_object('kind', p_kind));
  return v_id;
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
                when now() >= a.asked_at + (a.due_at - a.asked_at) * 0.75 then 'amber'
                else 'green' end,
           case when a.status = 'open' then (extract(epoch from (a.due_at - now())) / 60)::integer end
      from public.answer_desk_items a left join public.leads l on l.id = a.lead_id
     where p_include_answered or a.status = 'open'
     order by (a.status = 'open') desc, a.due_at asc
     limit 100;
end;
$$;

create or replace function public.staff_resolve_answer_item(p_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare a public.answer_desk_items; v_uid uuid := (select auth.uid());
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  select * into a from public.answer_desk_items where id = p_id for update;
  if not found or a.status <> 'open' then raise exception 'That question is not open'; end if;
  update public.answer_desk_items
     set status = 'answered', answered_at = now(), answered_by = v_uid, answer_note = nullif(btrim(p_note), ''),
         answered_late = now() > a.due_at
   where id = p_id;
  perform public.staff_audit_write('answer_desk_item', p_id, 'answer_item_answered', null, jsonb_build_object('late', now() > a.due_at));
end;
$$;

revoke all on function public.staff_log_answer_item(text, text, text, text, uuid, timestamptz) from public, anon;
revoke all on function public.staff_answer_desk(boolean) from public, anon;
revoke all on function public.staff_resolve_answer_item(uuid, text) from public, anon;
grant execute on function public.staff_log_answer_item(text, text, text, text, uuid, timestamptz) to authenticated;
grant execute on function public.staff_answer_desk(boolean) to authenticated;
grant execute on function public.staff_resolve_answer_item(uuid, text) to authenticated;
