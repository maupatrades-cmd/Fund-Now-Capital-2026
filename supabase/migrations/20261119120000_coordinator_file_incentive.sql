-- Sales Coordinator file incentive (owner, 19 Nov 2026): "R29 per file", counted only for files that are READY FOR
-- SUBMISSION. That is the SC9 qualifying file (20261010062000, fixed in 20261017100000), unchanged: the handler assigned
-- at or before the file first became Complete (all required documents received) and the file reached With Founder;
-- counted once; the month is the month it first reached With Founder (Johannesburg).
-- It replaces the R35 of 10 Oct and the launch plan's "R25 per closed file" (docs/FNC-LAUNCH-PLAN-2026-11-09.md §4).
--
-- Paid both ways the owner asked for:
--   (a) a monthly report: the Director sees each coordinator's files, count x rate = total (staff_qualifying_files,
--       as before, now with the effective rate and the sign-off state), and signs the month off;
--   (b) an incentive line on the coordinator's payslip one month in arrears (files of October are paid in the November
--       cycle, on the 27th), added ONLY for a signed-off month, recomputed server-side and never twice.
--
--   * staff_incentive_rates: effective-dated rates (numeric(14,2)). Seeded R35 from 1 Oct 2026 (the 10 Oct rule) and
--     R29 from 1 Nov 2026 (staff started 4 Nov). The start month of R29 is an owner question; changing it is one row.
--   * qualifying_file_signoffs: one row per (coordinator, month) the Director signs off, holding the count, rate, total
--     and the files counted (snapshot). Append-only except that the payslip line it produced is recorded once.
--   * owner_signoff_qualifying_files(month, handler): Director only; recomputes and stores the snapshot; refuses an
--     empty month and a month that has not ended; idempotent (a second call returns the existing sign-off).
--   * payroll_apply_qualifying_files(cycle): the Administrator or the Director; adds an incentive line to each draft
--     payslip in the cycle for the signed-off month before the pay month; skips sign-offs whose line already stands.
--     Also run automatically at sign-off when that cycle already has a draft payslip.

-- 1. Rates ---------------------------------------------------------------------------------------------------------------
create table if not exists public.staff_incentive_rates (
  code           text not null check (code ~ '^[a-z][a-z0-9_]{2,60}$'),
  effective_from date not null check (effective_from = date_trunc('month', effective_from)::date),
  amount         numeric(14,2) not null check (amount >= 0),
  note           text check (note is null or length(note) <= 200),
  created_at     timestamptz not null default now(),
  primary key (code, effective_from)
);
alter table public.staff_incentive_rates enable row level security;
revoke all on table public.staff_incentive_rates from public, anon, authenticated;
insert into public.staff_incentive_rates (code, effective_from, amount, note) values
  ('coordinator_qualifying_file', date '2026-10-01', 35.00, 'SC9 rule of 10 Oct 2026'),
  ('coordinator_qualifying_file', date '2026-11-01', 29.00, 'Owner decision 19 Nov 2026: R29 per file ready for submission')
on conflict (code, effective_from) do nothing;

-- The rate in force for a month (the latest row on or before it); null when none.
create or replace function public.staff_incentive_rate(p_code text, p_month date)
returns numeric
language sql stable security definer set search_path = '' as $$
  select r.amount from public.staff_incentive_rates r
   where r.code = p_code and r.effective_from <= date_trunc('month', p_month)::date
   order by r.effective_from desc limit 1;
$$;
revoke all on function public.staff_incentive_rate(text, date) from public, anon, authenticated;

-- 2. The qualifying files of a month (the SC9 rule, unchanged), without the caller check -------------------------------
create or replace function public.qualifying_files_compute(p_month date, p_handler uuid)
returns table (lead_id uuid, business_name text, handler_id uuid, handler_name text, reached_founder_at timestamptz,
               first_assigned_at timestamptz, first_complete_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with wf as (
    select e.entity_id as lead_id, min(e.occurred_at) as reached_at
      from public.staff_audit_events e
     where e.entity_type = 'submission_intake' and e.event_type = 'status_changed'
       and e.detail ->> 'to' = 'with_founder'
     group by e.entity_id
  ), scoped as (
    select wf.lead_id, wf.reached_at, cur.handler_id, cur.assigned_at
      from wf
      cross join lateral (
        select nullif(a.detail ->> 'to', '')::uuid as handler_id, a.occurred_at as assigned_at
          from public.staff_audit_events a
         where a.entity_type = 'submission_intake' and a.entity_id = wf.lead_id
           and a.event_type = 'assignee_changed' and a.occurred_at <= wf.reached_at
         order by a.occurred_at desc, a.id desc limit 1) cur
     where date_trunc('month', wf.reached_at at time zone 'Africa/Johannesburg')::date = date_trunc('month', p_month)::date
  ), q as (
    select s.lead_id, s.reached_at, s.handler_id, si.first_complete_at, s.assigned_at as first_assigned_at
      from scoped s join public.submission_intakes si on si.lead_id = s.lead_id
     where s.handler_id is not null and si.first_complete_at is not null
       and (p_handler is null or s.handler_id = p_handler)
  )
  select q.lead_id, l.business_name, q.handler_id, p.full_name, q.reached_at, q.first_assigned_at, q.first_complete_at
    from q join public.leads l on l.id = q.lead_id left join public.profiles p on p.id = q.handler_id
   where q.first_assigned_at <= q.first_complete_at
   order by q.reached_at;
$$;
revoke all on function public.qualifying_files_compute(date, uuid) from public, anon, authenticated;

-- 3. Sign-offs -----------------------------------------------------------------------------------------------------------
create table if not exists public.qualifying_file_signoffs (
  id              uuid primary key default gen_random_uuid(),
  handler_id      uuid not null references public.profiles(id) on delete restrict,
  file_month      date not null check (file_month = date_trunc('month', file_month)::date),
  file_count      integer not null check (file_count > 0),
  rate            numeric(14,2) not null check (rate >= 0),
  total           numeric(14,2) not null check (total >= 0),
  lead_ids        uuid[] not null,
  signed_by       uuid not null references public.profiles(id) on delete restrict,
  signed_at       timestamptz not null default now(),
  payslip_line_id uuid references public.payslip_lines(id) on delete restrict,
  unique (handler_id, file_month),
  constraint qualifying_file_signoffs_total_ck check (total = round(file_count * rate, 2))
);
alter table public.qualifying_file_signoffs enable row level security;
revoke all on table public.qualifying_file_signoffs from public, anon, authenticated;

-- A sign-off is fixed; only its payslip line may be recorded (or re-recorded after the line was removed from a draft).
create or replace function public.qualifying_file_signoffs_guard()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'A sign-off cannot be deleted'; end if;
  if (new.id, new.handler_id, new.file_month, new.file_count, new.rate, new.total, new.lead_ids, new.signed_by, new.signed_at)
     is distinct from
     (old.id, old.handler_id, old.file_month, old.file_count, old.rate, old.total, old.lead_ids, old.signed_by, old.signed_at) then
    raise exception 'A sign-off cannot be changed';
  end if;
  return new;
end;
$$;
revoke all on function public.qualifying_file_signoffs_guard() from public, anon, authenticated;
drop trigger if exists qualifying_file_signoffs_guard on public.qualifying_file_signoffs;
create trigger qualifying_file_signoffs_guard before update or delete on public.qualifying_file_signoffs
  for each row execute function public.qualifying_file_signoffs_guard();

-- 4. Payslip lines for signed-off months ------------------------------------------------------------------------------
-- Adds the incentive line to each DRAFT payslip of the cycle whose holder has a signed-off month just before the pay
-- month and no standing line for it. Returns the number of lines added. Safe to run again.
create or replace function public.payroll_apply_qualifying_files(p_cycle uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_month date; v_cycle_status text; s record; v_line uuid; v_count integer := 0;
begin
  if not public.staff_is_founder_or_administrator() then
    raise exception 'Only the Administrator or the Director prepares payslips' using errcode = '42501';
  end if;
  select c.pay_month, c.status into v_month, v_cycle_status from public.payroll_cycles c where c.id = p_cycle;
  if v_month is null then raise exception 'Payroll cycle not found'; end if;
  if v_cycle_status in ('closed', 'paid') then raise exception 'This payroll cycle is closed'; end if;

  for s in
    select q.id, q.file_month, q.file_count, q.rate, q.total, ps.id as payslip_id
      from public.qualifying_file_signoffs q
      join public.payslips ps on ps.cycle_id = p_cycle and ps.profile_id = q.handler_id and ps.status = 'draft'
     where q.file_month = (v_month - interval '1 month')::date
       and q.total > 0
       and not exists (select 1 from public.payslip_lines l where l.id = q.payslip_line_id and l.removed_at is null)
     for update of q
  loop
    v_line := public.payslip_add_line(s.payslip_id, 'incentive',
      'Files ready for submission, ' || to_char(s.file_month, 'FMMonth YYYY') || ': ' || s.file_count || ' x R'
        || to_char(s.rate, 'FM999990.00'),
      s.total);
    update public.qualifying_file_signoffs set payslip_line_id = v_line where id = s.id;
    perform public.staff_audit_write('qualifying_file_signoff', s.id, 'qualifying_files_paid_on_payslip', null,
      jsonb_build_object('payslip_id', s.payslip_id, 'line_id', v_line, 'total', s.total));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.payroll_apply_qualifying_files(uuid) from public, anon;
grant execute on function public.payroll_apply_qualifying_files(uuid) to authenticated;

-- 5. The Director signs a month off ---------------------------------------------------------------------------------
create or replace function public.owner_signoff_qualifying_files(p_month date, p_handler uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_existing public.qualifying_file_signoffs; v_rate numeric; v_count integer; v_leads uuid[]; v_id uuid;
  v_cycle uuid; v_applied integer := 0;
begin
  if not coalesce(public.is_owner(), false) then
    raise exception 'Only the Director signs off qualifying files' using errcode = '42501';
  end if;
  if v_month is null or p_handler is null then raise exception 'Choose the month and the coordinator'; end if;
  if v_month >= date_trunc('month', public.current_sast_date())::date then
    raise exception 'A month can be signed off once it has ended';
  end if;

  select * into v_existing from public.qualifying_file_signoffs q where q.handler_id = p_handler and q.file_month = v_month;
  if found then
    return jsonb_build_object('signoff_id', v_existing.id, 'already_signed_off', true, 'count', v_existing.file_count,
                              'rate', v_existing.rate, 'total', v_existing.total);
  end if;

  v_rate := public.staff_incentive_rate('coordinator_qualifying_file', v_month);
  if v_rate is null then raise exception 'No rate is set for that month'; end if;
  select count(*)::int, coalesce(array_agg(f.lead_id order by f.reached_founder_at), '{}')
    into v_count, v_leads
    from public.qualifying_files_compute(v_month, p_handler) f;
  if v_count = 0 then raise exception 'There are no qualifying files to sign off for that month'; end if;

  perform pg_advisory_xact_lock(hashtextextended('qualifying_signoff:' || p_handler::text || ':' || v_month::text, 0));
  insert into public.qualifying_file_signoffs (handler_id, file_month, file_count, rate, total, lead_ids, signed_by)
  values (p_handler, v_month, v_count, v_rate, round(v_count * v_rate, 2), v_leads, (select auth.uid()))
  on conflict (handler_id, file_month) do nothing
  returning id into v_id;
  if v_id is null then
    select q.id into v_id from public.qualifying_file_signoffs q where q.handler_id = p_handler and q.file_month = v_month;
    return jsonb_build_object('signoff_id', v_id, 'already_signed_off', true);
  end if;
  perform public.staff_audit_write('qualifying_file_signoff', v_id, 'qualifying_files_signed_off', null,
    jsonb_build_object('handler_id', p_handler, 'month', v_month, 'count', v_count, 'rate', v_rate,
                       'total', round(v_count * v_rate, 2)));

  -- Pay it on the next cycle straight away when that cycle already has a draft payslip for the coordinator.
  select c.id into v_cycle from public.payroll_cycles c
   where c.pay_month = (v_month + interval '1 month')::date and c.status not in ('closed', 'paid');
  if v_cycle is not null then v_applied := public.payroll_apply_qualifying_files(v_cycle); end if;

  return jsonb_build_object('signoff_id', v_id, 'already_signed_off', false, 'count', v_count, 'rate', v_rate,
                            'total', round(v_count * v_rate, 2), 'added_to_payslip', v_applied > 0);
end;
$$;
revoke all on function public.owner_signoff_qualifying_files(date, uuid) from public, anon;
grant execute on function public.owner_signoff_qualifying_files(date, uuid) to authenticated;

-- 6. The report (live body of 20261017100000, now through qualifying_files_compute, with the effective rate and the
--    sign-offs). The Director sees every coordinator (or one, with p_handler); a coordinator sees only her own files.
create or replace function public.staff_qualifying_files(p_month date default null, p_handler uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text; v_uid uuid := (select auth.uid());
  v_start date; v_handler uuid; v_rate numeric; v_files jsonb; v_count int; v_signoffs jsonb;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator']);
  v_start := date_trunc('month', coalesce(p_month, (now() at time zone 'Africa/Johannesburg')::date))::date;
  v_handler := case when v_role = 'owner' then p_handler else v_uid end;
  v_rate := coalesce(public.staff_incentive_rate('coordinator_qualifying_file', v_start), 0);

  select coalesce(jsonb_agg(jsonb_build_object(
           'lead_id', f.lead_id, 'business_name', f.business_name, 'handler_id', f.handler_id,
           'handler_name', f.handler_name, 'reached_founder_at', f.reached_founder_at,
           'first_assigned_at', f.first_assigned_at, 'first_complete_at', f.first_complete_at)
         order by f.reached_founder_at), '[]'::jsonb), count(*)::int
    into v_files, v_count
    from public.qualifying_files_compute(v_start, v_handler) f;

  select coalesce(jsonb_agg(jsonb_build_object(
           'handler_id', q.handler_id, 'count', q.file_count, 'rate', q.rate, 'total', q.total,
           'signed_at', q.signed_at,
           'on_payslip', exists (select 1 from public.payslip_lines l where l.id = q.payslip_line_id and l.removed_at is null))),
         '[]'::jsonb)
    into v_signoffs
    from public.qualifying_file_signoffs q
   where q.file_month = v_start and (v_handler is null or q.handler_id = v_handler);

  return jsonb_build_object(
    'month', v_start, 'rate_per_file', v_rate, 'count', v_count, 'estimate_total', round(v_count * v_rate, 2),
    'cutoff_date', (v_start + interval '1 month' + interval '3 days')::date,
    'pay_date', (v_start + interval '1 month' + interval '26 days')::date,
    'status', case when jsonb_array_length(v_signoffs) > 0 then 'signed_off' else 'estimate_until_founder_sign_off' end,
    'month_ended', v_start < date_trunc('month', public.current_sast_date())::date,
    'files', v_files, 'signoffs', v_signoffs);
end $$;
revoke all on function public.staff_qualifying_files(date, uuid) from public, anon;
grant execute on function public.staff_qualifying_files(date, uuid) to authenticated;
