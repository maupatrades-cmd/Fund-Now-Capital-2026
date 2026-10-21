-- Administrator Batch 5c (payslips and the payroll cycle) (2/2). Owner decisions of 21 Oct 2026
-- (docs/FNC-LAUNCH-PLAN-2026-11-09.md section 3 decision 3, and section 5). Forward-only.
--
--   * One payroll cycle per pay month. The capture period runs from the 7th of the previous month to the 6th of the
--     pay month; queries close on the 11th; pay day is the 27th, or the last working day before it (weekends and the
--     public holidays the Director entered in business_holidays). Example: the December 2026 cycle captures
--     7 Nov to 6 Dec and pays on Thursday 24 December.
--     Statuses: Open -> Calculating -> Query window -> Closed -> Paid. The Office Administrator and HR calculate;
--     only the Director closes the cycle and marks it paid. Every move is logged.
--   * One payslip per staff member per cycle. Salary is for the current calendar month (pro-rata in a first month,
--     on WORKING days, which reproduces the Director's figures of about R5,700 and R4,570 for a 9 November start);
--     commission, fees and bonuses on the payslip are the arrears for the capture period. Lines are typed in for
--     now; the incentives engine will add its lines automatically later.
--   * Routing: the Administrator prepares the payslip -> the Director approves it (or sends it back with a reason) ->
--     the Administrator releases it to HR -> HR distributes it -> the staff member sees it and acknowledges it.
--   * Who sees salaries: the Director and the Administrator (all), HR (from the moment a payslip reaches HR), and each
--     staff member (their own, once distributed). Sales Coordinator and Switchboard never see anyone else's pay.
-- Money is numeric(14,2) and recomputed by the database. Lines are fixed once a payslip leaves draft. RLS on, no
-- grants; every read and write is a role-checked SECURITY DEFINER function.

-- 0. Helpers ------------------------------------------------------------------------------------------------------
-- The staff roles that receive a payslip. Field Supervisor and field consultant join here when those roles exist.
create or replace function public.payroll_payee_roles()
returns text[]
language sql immutable set search_path = '' as $$
  select array['administrator', 'coordinator', 'switchboard', 'hr'];
$$;
revoke all on function public.payroll_payee_roles() from public, anon, authenticated;

create or replace function public.payroll_payee_ids()
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
   where p.is_active and s.access_enabled and p.role::text = any (public.payroll_payee_roles());
$$;
revoke all on function public.payroll_payee_ids() from public, anon, authenticated;

-- A working day: Monday to Friday and not a public holiday the Director entered.
create or replace function public.payroll_is_working_day(p_day date)
returns boolean
language sql stable security definer set search_path = '' as $$
  select extract(isodow from p_day) < 6 and not exists (select 1 from public.business_holidays h where h.holiday_date = p_day);
$$;
revoke all on function public.payroll_is_working_day(date) from public, anon, authenticated;

-- Pay day for a pay month: the 27th, or the last working day before it.
create or replace function public.payroll_pay_date(p_pay_month date)
returns date
language plpgsql stable security definer set search_path = '' as $$
declare v date := date_trunc('month', p_pay_month)::date + 26;
begin
  while not public.payroll_is_working_day(v) loop v := v - 1; end loop;
  return v;
end;
$$;
revoke all on function public.payroll_pay_date(date) from public, anon, authenticated;

-- Pro-rata salary for a month in which the person started (or a full month when the start is on or before the 1st):
-- monthly amount x working days from the start date to month end / working days in the month.
create or replace function public.payroll_pro_rata(p_monthly numeric, p_start date, p_month date)
returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare v_first date := date_trunc('month', p_month)::date; v_last date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_all int; v_worked int;
begin
  if p_start is null or p_start <= v_first then return round(p_monthly, 2); end if;
  if p_start > v_last then return 0; end if;
  select count(*) filter (where public.payroll_is_working_day(d::date)), count(*) filter (where public.payroll_is_working_day(d::date) and d::date >= p_start)
    into v_all, v_worked from generate_series(v_first, v_last, interval '1 day') g(d);
  if v_all = 0 then return 0; end if;
  return round(p_monthly * v_worked / v_all, 2);
end;
$$;
revoke all on function public.payroll_pro_rata(numeric, date, date) from public, anon, authenticated;

-- A line amount: non-zero, at most 2 decimals, below R1,000,000 either way.
create or replace function public.payroll_valid_amount(p_amount numeric)
returns boolean
language sql immutable set search_path = '' as $$
  select p_amount is not null and p_amount::text not in ('NaN', 'Infinity', '-Infinity')
     and p_amount <> 0 and abs(p_amount) < 1000000 and p_amount = round(p_amount, 2);
$$;
revoke all on function public.payroll_valid_amount(numeric) from public, anon, authenticated;

-- 1. Tables -------------------------------------------------------------------------------------------------------
create table if not exists public.payroll_cycles (
  id              uuid primary key default gen_random_uuid(),
  pay_month       date not null unique check (pay_month = date_trunc('month', pay_month)::date),
  period_start    date not null,
  period_end      date not null,
  query_close_on  date not null,
  pay_date        date not null,
  status          text not null default 'open' check (status in ('open', 'calculating', 'query_window', 'closed', 'paid')),
  opened_by       uuid not null references public.profiles(id) on delete restrict,
  opened_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint payroll_cycles_period_ck check (period_start = (pay_month - interval '1 month')::date + 6
                                             and period_end = pay_month + 5 and query_close_on = pay_month + 10)
);
create table if not exists public.payroll_cycle_events (
  id          bigint generated always as identity primary key,
  cycle_id    uuid not null references public.payroll_cycles(id) on delete restrict,
  at          timestamptz not null default now(),
  actor_id    uuid not null references public.profiles(id) on delete restrict,
  actor_role  text not null,
  from_status text,
  to_status   text not null,
  note        text check (note is null or (length(note) <= 500 and public.staff_text_is_safe(note)))
);

create table if not exists public.payslips (
  id          uuid primary key default gen_random_uuid(),
  cycle_id    uuid not null references public.payroll_cycles(id) on delete restrict,
  profile_id  uuid not null references public.profiles(id) on delete restrict,
  status      text not null default 'draft' check (status in ('draft', 'awaiting_director', 'approved', 'with_hr',
                                                                'distributed', 'acknowledged')),
  created_by  uuid not null references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (cycle_id, profile_id)
);
create index if not exists payslips_profile_idx on public.payslips (profile_id, cycle_id);

create table if not exists public.payslip_lines (
  id             uuid primary key default gen_random_uuid(),
  payslip_id     uuid not null references public.payslips(id) on delete restrict,
  kind           text not null check (kind in ('salary', 'allowance', 'incentive', 'deduction', 'clawback')),
  label          text not null check (length(btrim(label)) between 2 and 120),
  amount         numeric(14,2) not null check (public.payroll_valid_amount(amount)),
  added_by       uuid not null references public.profiles(id) on delete restrict,
  added_role     text not null,
  added_at       timestamptz not null default now(),
  removed_at     timestamptz,
  removed_by     uuid references public.profiles(id) on delete restrict,
  remove_reason  text check (remove_reason is null or length(remove_reason) <= 300),
  -- Earnings are positive, deductions and clawbacks negative, so the net is the plain sum.
  constraint payslip_lines_sign_ck check ((kind in ('deduction', 'clawback')) = (amount < 0)),
  constraint payslip_lines_safe_text_ck check (public.staff_text_is_safe(label) and public.staff_text_is_safe(remove_reason)),
  constraint payslip_lines_remove_ck check ((removed_at is null) = (removed_by is null) and (removed_at is null) = (remove_reason is null))
);
create index if not exists payslip_lines_payslip_idx on public.payslip_lines (payslip_id) where removed_at is null;

create table if not exists public.payslip_events (
  id          bigint generated always as identity primary key,
  payslip_id  uuid not null references public.payslips(id) on delete restrict,
  at          timestamptz not null default now(),
  actor_id    uuid not null references public.profiles(id) on delete restrict,
  actor_role  text not null,
  from_status text,
  to_status   text not null,
  note        text check (note is null or (length(note) <= 500 and public.staff_text_is_safe(note)))
);
create index if not exists payslip_events_payslip_idx on public.payslip_events (payslip_id, at);

alter table public.payroll_cycles enable row level security;
alter table public.payroll_cycle_events enable row level security;
alter table public.payslips enable row level security;
alter table public.payslip_lines enable row level security;
alter table public.payslip_events enable row level security;
revoke all on table public.payroll_cycles, public.payroll_cycle_events, public.payslips, public.payslip_lines,
  public.payslip_events from public, anon, authenticated;

create trigger payroll_cycle_events_append_only before update or delete on public.payroll_cycle_events
  for each row execute function public.intake_append_only_guard();
create trigger payslip_events_append_only before update or delete on public.payslip_events
  for each row execute function public.intake_append_only_guard();

-- Cycles and payslips change status only through their move functions (which set fnc.payroll); lines are only ever
-- removed (once, while the payslip is a draft).
create or replace function public.payroll_row_guard()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception '% rows cannot be deleted', tg_table_name; end if;
  if tg_table_name in ('payroll_cycles', 'payslips') then
    if coalesce(current_setting('fnc.payroll', true), '') <> 'on' then
      raise exception 'Payroll changes only through the payroll functions';
    end if;
    if (to_jsonb(new) - array['status', 'updated_at']) <> (to_jsonb(old) - array['status', 'updated_at']) then
      raise exception 'Only the status of a payroll record can change';
    end if;
  elsif tg_table_name = 'payslip_lines' then
    if old.removed_at is not null or new.removed_at is null
       or (to_jsonb(new) - array['removed_at', 'removed_by', 'remove_reason']) <> (to_jsonb(old) - array['removed_at', 'removed_by', 'remove_reason']) then
      raise exception 'A payslip line can only be removed, once';
    end if;
    if (select s.status from public.payslips s where s.id = old.payslip_id) <> 'draft' then
      raise exception 'This payslip is no longer a draft; its lines are fixed';
    end if;
  end if;
  return new;
end;
$$;
create trigger payroll_cycles_guard before update or delete on public.payroll_cycles
  for each row execute function public.payroll_row_guard();
create trigger payslips_guard before update or delete on public.payslips
  for each row execute function public.payroll_row_guard();
create trigger payslip_lines_guard before update or delete on public.payslip_lines
  for each row execute function public.payroll_row_guard();

-- New lines only on a draft payslip.
create or replace function public.payslip_lines_insert_guard()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select s.status from public.payslips s where s.id = new.payslip_id) is distinct from 'draft' then
    raise exception 'This payslip is no longer a draft; its lines are fixed';
  end if;
  return new;
end;
$$;
create trigger payslip_lines_insert_guard before insert on public.payslip_lines
  for each row execute function public.payslip_lines_insert_guard();

-- Totals for one payslip.
create or replace function public.payslip_totals(p_payslip uuid)
returns table (gross numeric, deductions numeric, net numeric)
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.amount) filter (where l.amount > 0), 0)::numeric(14,2),
         coalesce(-sum(l.amount) filter (where l.amount < 0), 0)::numeric(14,2),
         coalesce(sum(l.amount), 0)::numeric(14,2)
    from public.payslip_lines l where l.payslip_id = p_payslip and l.removed_at is null;
$$;
revoke all on function public.payslip_totals(uuid) from public, anon, authenticated;

-- Who may see one payslip: the Director and the Administrator always; HR once it has reached HR; the staff member
-- once it has been distributed to them.
create or replace function public.payslip_can_view(p_payslip uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select public.staff_is_founder_or_administrator()
        or (public.staff_actor_role() = 'hr' and s.status in ('with_hr', 'distributed', 'acknowledged'))
        or (s.profile_id = (select auth.uid()) and s.status in ('distributed', 'acknowledged'))
      from public.payslips s where s.id = p_payslip), false);
$$;
revoke all on function public.payslip_can_view(uuid) from public, anon, authenticated;

-- 2. Cycles ---------------------------------------------------------------------------------------------------------
-- Open the cycle for a pay month and create a draft payslip for every enabled staff member. Idempotent.
create or replace function public.payroll_open_cycle(p_pay_month date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_month date := date_trunc('month', p_pay_month)::date; v_id uuid; v_new boolean := false;
  u uuid;
begin
  if not public.staff_is_founder_or_administrator() then
    raise exception 'Only the Administrator or the Director opens a payroll cycle' using errcode = '42501';
  end if;
  if v_month is null or v_month < date_trunc('month', public.current_sast_date())::date - interval '1 month'
     or v_month > date_trunc('month', public.current_sast_date())::date + interval '2 months' then
    raise exception 'Choose a pay month from last month to two months ahead';
  end if;
  select c.id into v_id from public.payroll_cycles c where c.pay_month = v_month;
  if v_id is null then
    insert into public.payroll_cycles (pay_month, period_start, period_end, query_close_on, pay_date, opened_by)
    values (v_month, (v_month - interval '1 month')::date + 6, v_month + 5, v_month + 10, public.payroll_pay_date(v_month), v_uid)
    on conflict (pay_month) do nothing returning id into v_id;
    if v_id is null then select c.id into v_id from public.payroll_cycles c where c.pay_month = v_month; else v_new := true; end if;
  end if;
  if v_new then
    insert into public.payroll_cycle_events (cycle_id, actor_id, actor_role, from_status, to_status)
    values (v_id, v_uid, public.staff_actor_role(), null, 'open');
    perform public.staff_audit_write('payroll_cycle', v_id, 'payroll_cycle_opened', null, jsonb_build_object('pay_month', v_month));
  end if;
  -- Staff enabled after the cycle opened are added the next time it is opened (this call is idempotent).
  for u in select public.payroll_payee_ids() loop
    insert into public.payslips (cycle_id, profile_id, created_by) values (v_id, u, v_uid) on conflict (cycle_id, profile_id) do nothing;
  end loop;
  return v_id;
end;
$$;
revoke all on function public.payroll_open_cycle(date) from public, anon;
grant execute on function public.payroll_open_cycle(date) to authenticated;

create or replace function public.payroll_move_cycle(p_cycle uuid, p_to text, p_note text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_role text := public.staff_actor_role(); v_uid uuid := (select auth.uid()); c public.payroll_cycles; v_ok boolean; u uuid;
begin
  if v_role is null or v_role not in ('owner', 'administrator', 'hr') then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  if p_note is not null and (length(p_note) > 500 or not public.staff_text_is_safe(p_note)) then
    raise exception 'Keep the note under 500 characters, without ID or account-length numbers';
  end if;
  select * into c from public.payroll_cycles where id = p_cycle for update;
  if c.id is null then raise exception 'Payroll cycle not found'; end if;
  v_ok := case
    when c.status = 'open' and p_to = 'calculating' then true
    when c.status = 'calculating' and p_to = 'query_window' then true
    when c.status = 'query_window' and p_to = 'calculating' then true
    when c.status = 'query_window' and p_to = 'closed' then v_role = 'owner'
    when c.status = 'closed' and p_to = 'paid' then v_role = 'owner'
    else false end;
  if not v_ok then
    raise exception 'You cannot move this cycle from "%" to "%"', c.status, p_to using errcode = '42501';
  end if;
  if p_to = 'closed' and exists (select 1 from public.payslips s where s.cycle_id = p_cycle and s.status in ('draft', 'awaiting_director')) then
    raise exception 'Approve or finish every payslip in this cycle before closing it';
  end if;
  if p_to = 'paid' and exists (select 1 from public.payslips s where s.cycle_id = p_cycle and s.status in ('draft', 'awaiting_director')) then
    raise exception 'Every payslip must be approved before the cycle is marked paid';
  end if;
  perform set_config('fnc.payroll', 'on', true);
  update public.payroll_cycles set status = p_to, updated_at = now() where id = p_cycle;
  perform set_config('fnc.payroll', 'off', true);
  insert into public.payroll_cycle_events (cycle_id, actor_id, actor_role, from_status, to_status, note)
  values (p_cycle, v_uid, v_role, c.status, p_to, nullif(btrim(p_note), ''));
  for u in select x.id from (select d as id from public.staff_director_ids() d
                             union select public.staff_enabled_in_role('administrator')
                             union select public.staff_enabled_in_role('hr')) x where x.id <> v_uid loop
    perform public.staff_notify(u, 'PAYROLL_CYCLE_CHANGED', 'Payroll ' || to_char(c.pay_month, 'FMMonth YYYY') || ': ' ||
      case p_to when 'calculating' then 'calculating' when 'query_window' then 'open for queries until the ' || to_char(c.query_close_on, 'FMDD Mon')
                when 'closed' then 'closed by the Director' when 'paid' then 'paid' end,
      coalesce(nullif(btrim(p_note), ''), 'Pay day ' || to_char(c.pay_date, 'FMDD FMMonth')), '/staff/payroll',
      jsonb_build_object('cycle_id', p_cycle, 'status', p_to));
  end loop;
  perform public.staff_audit_write('payroll_cycle', p_cycle, 'payroll_cycle_moved', nullif(btrim(p_note), ''),
    jsonb_build_object('from', c.status, 'to', p_to));
  return p_to;
end;
$$;
revoke all on function public.payroll_move_cycle(uuid, text, text) from public, anon;
grant execute on function public.payroll_move_cycle(uuid, text, text) to authenticated;

create or replace function public.payroll_cycles_list()
returns table (cycle_id uuid, pay_month date, period_start date, period_end date, query_close_on date, pay_date date,
               status text, payslips integer, draft integer, awaiting_director integer, approved_or_later integer,
               acknowledged integer, next_steps text[])
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := public.staff_actor_role();
begin
  if v_role is null or v_role not in ('owner', 'administrator', 'hr') then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query
    select c.id, c.pay_month, c.period_start, c.period_end, c.query_close_on, c.pay_date, c.status,
           (select count(*)::int from public.payslips s where s.cycle_id = c.id),
           (select count(*)::int from public.payslips s where s.cycle_id = c.id and s.status = 'draft'),
           (select count(*)::int from public.payslips s where s.cycle_id = c.id and s.status = 'awaiting_director'),
           (select count(*)::int from public.payslips s where s.cycle_id = c.id and s.status not in ('draft', 'awaiting_director')),
           (select count(*)::int from public.payslips s where s.cycle_id = c.id and s.status = 'acknowledged'),
           case c.status
             when 'open' then array['calculating']
             when 'calculating' then array['query_window']
             when 'query_window' then case when v_role = 'owner' then array['closed', 'calculating'] else array['calculating'] end
             when 'closed' then case when v_role = 'owner' then array['paid'] else '{}'::text[] end
             else '{}'::text[] end
      from public.payroll_cycles c
     order by c.pay_month desc
     limit 36;
end;
$$;
revoke all on function public.payroll_cycles_list() from public, anon;
grant execute on function public.payroll_cycles_list() to authenticated;

-- 3. Payslips -------------------------------------------------------------------------------------------------------
create or replace function public.payslip_add_line(p_payslip uuid, p_kind text, p_label text, p_amount numeric)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_amount numeric := p_amount; s record;
begin
  if not public.staff_is_founder_or_administrator() then
    raise exception 'Only the Administrator or the Director prepares payslips' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('salary', 'allowance', 'incentive', 'deduction', 'clawback') then
    raise exception 'Choose the kind of line: salary, allowance, incentive, deduction or clawback';
  end if;
  if length(btrim(coalesce(p_label, ''))) not between 2 and 120 or not public.staff_text_is_safe(p_label) then
    raise exception 'Describe the line (2 to 120 characters, without ID or account-length numbers)';
  end if;
  -- Amounts are typed as positive Rands; deductions and clawbacks are stored negative.
  if not public.payroll_valid_amount(v_amount) or v_amount < 0 then raise exception 'Enter the amount in Rands (more than R0, at most 2 decimals)'; end if;
  if p_kind in ('deduction', 'clawback') then v_amount := -v_amount; end if;
  select ps.status, c.status as cycle_status into s from public.payslips ps join public.payroll_cycles c on c.id = ps.cycle_id where ps.id = p_payslip;
  if s.status is null then raise exception 'Payslip not found'; end if;
  if s.cycle_status in ('closed', 'paid') then raise exception 'This payroll cycle is closed'; end if;
  insert into public.payslip_lines (payslip_id, kind, label, amount, added_by, added_role)
  values (p_payslip, p_kind, btrim(p_label), v_amount, (select auth.uid()), public.staff_actor_role())
  returning id into v_id;
  perform public.staff_audit_write('payslip', p_payslip, 'payslip_line_added', null, jsonb_build_object('kind', p_kind));
  return v_id;
end;
$$;
revoke all on function public.payslip_add_line(uuid, text, text, numeric) from public, anon;
grant execute on function public.payslip_add_line(uuid, text, text, numeric) to authenticated;

-- The salary line for the pay month, pro-rata on working days when the person started during that month.
create or replace function public.payslip_add_salary_line(p_payslip uuid, p_monthly numeric, p_start date default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_month date; v_amount numeric; v_label text;
begin
  if not public.staff_is_founder_or_administrator() then
    raise exception 'Only the Administrator or the Director prepares payslips' using errcode = '42501';
  end if;
  if not public.payroll_valid_amount(p_monthly) or p_monthly < 0 then raise exception 'Enter the monthly salary in Rands'; end if;
  select c.pay_month into v_month from public.payslips s join public.payroll_cycles c on c.id = s.cycle_id where s.id = p_payslip;
  if v_month is null then raise exception 'Payslip not found'; end if;
  v_amount := public.payroll_pro_rata(p_monthly, p_start, v_month);
  if v_amount <= 0 then raise exception 'The start date is after this pay month'; end if;
  v_label := 'Salary ' || to_char(v_month, 'FMMonth YYYY') ||
    case when v_amount < round(p_monthly, 2) then ' (pro-rata from ' || to_char(p_start, 'FMDD FMMonth') || ')' else '' end;
  return public.payslip_add_line(p_payslip, 'salary', v_label, v_amount);
end;
$$;
revoke all on function public.payslip_add_salary_line(uuid, numeric, date) from public, anon;
grant execute on function public.payslip_add_salary_line(uuid, numeric, date) to authenticated;

create or replace function public.payslip_remove_line(p_line uuid, p_reason text)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz; v_payslip uuid;
begin
  if not public.staff_is_founder_or_administrator() then
    raise exception 'Only the Administrator or the Director prepares payslips' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 300 or not public.staff_text_is_safe(p_reason) then
    raise exception 'Give a reason (3 to 300 characters)';
  end if;
  update public.payslip_lines set removed_at = now(), removed_by = (select auth.uid()), remove_reason = btrim(p_reason)
   where id = p_line and removed_at is null returning removed_at, payslip_id into v_at, v_payslip;
  if v_at is null then raise exception 'Line not found, or already removed'; end if;
  perform public.staff_audit_write('payslip', v_payslip, 'payslip_line_removed', btrim(p_reason), jsonb_build_object('line_id', p_line));
  return v_at;
end;
$$;
revoke all on function public.payslip_remove_line(uuid, text) from public, anon;
grant execute on function public.payslip_remove_line(uuid, text) to authenticated;

-- Steps a caller may take on a payslip. 'draft' from awaiting_director is the Director's send-back.
create or replace function public.payslip_next(p_payslip uuid)
returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case s.status
      when 'draft' then case when public.staff_is_founder_or_administrator() then array['awaiting_director'] end
      when 'awaiting_director' then case when coalesce(public.is_owner(), false) then array['approved', 'draft'] end
      when 'approved' then case when public.staff_is_founder_or_administrator() then array['with_hr'] end
      when 'with_hr' then case when public.staff_actor_role() in ('hr', 'owner') then array['distributed'] end
      when 'distributed' then case when s.profile_id = (select auth.uid()) then array['acknowledged'] end
    end from public.payslips s where s.id = p_payslip), '{}'::text[]);
$$;
revoke all on function public.payslip_next(uuid) from public, anon, authenticated;

create or replace function public.payslip_move(p_payslip uuid, p_to text, p_note text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_role text; s record; v_title text; v_to uuid[]; u uuid; v_link text := '/staff/payroll';
begin
  v_role := coalesce(public.staff_actor_role(), 'staff');
  select ps.*, c.status as cycle_status, c.pay_month, p.full_name into s
    from public.payslips ps join public.payroll_cycles c on c.id = ps.cycle_id join public.profiles p on p.id = ps.profile_id
   where ps.id = p_payslip for update of ps;
  if s.id is null then raise exception 'Payslip not found'; end if;
  if not (p_to = any (public.payslip_next(p_payslip))) then
    raise exception 'You cannot move this payslip from "%" to "%"', s.status, p_to using errcode = '42501';
  end if;
  if p_note is not null and (length(p_note) > 500 or not public.staff_text_is_safe(p_note)) then
    raise exception 'Keep the note under 500 characters, without ID or account-length numbers';
  end if;
  if s.status = 'awaiting_director' and p_to = 'draft' and length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Say why the payslip is going back';
  end if;
  if p_to = 'awaiting_director' and not exists (select 1 from public.payslip_lines l where l.payslip_id = p_payslip and l.removed_at is null) then
    raise exception 'Add at least one line before sending the payslip for approval';
  end if;
  if p_to = 'awaiting_director' and (select t.net from public.payslip_totals(p_payslip) t) < 0 then
    raise exception 'The net pay cannot be negative';
  end if;
  perform set_config('fnc.payroll', 'on', true);
  update public.payslips set status = p_to, updated_at = now() where id = p_payslip;
  perform set_config('fnc.payroll', 'off', true);
  insert into public.payslip_events (payslip_id, actor_id, actor_role, from_status, to_status, note)
  values (p_payslip, v_uid, v_role, s.status, p_to, nullif(btrim(p_note), ''));
  v_title := 'Payslip ' || to_char(s.pay_month, 'FMMonth YYYY') || ': ' || coalesce(s.full_name, 'staff member');
  case p_to
    when 'awaiting_director' then v_to := array(select public.staff_director_ids());
    when 'approved' then v_to := array(select public.staff_enabled_in_role('administrator'));
    when 'draft' then v_to := array(select public.staff_enabled_in_role('administrator'));
    when 'with_hr' then v_to := array(select public.staff_enabled_in_role('hr'));
    when 'distributed' then v_to := array[s.profile_id]; v_link := '/staff/payslips'; v_title := 'Your payslip for ' || to_char(s.pay_month, 'FMMonth YYYY');
    when 'acknowledged' then v_to := array(select public.staff_enabled_in_role('hr'));
  end case;
  foreach u in array coalesce(v_to, '{}'::uuid[]) loop
    if u <> v_uid then
      perform public.staff_notify(u, 'PAYSLIP_STATUS_CHANGED', v_title,
        case p_to when 'awaiting_director' then 'Ready for your approval.' when 'approved' then 'Approved by the Director. Release it to HR.'
                  when 'draft' then 'Sent back by the Director: ' || btrim(p_note) when 'with_hr' then 'Approved. Distribute it to the staff member.'
                  when 'distributed' then 'Open it from My payslips.' when 'acknowledged' then 'The staff member has acknowledged it.' end,
        v_link, jsonb_build_object('payslip_id', p_payslip, 'status', p_to));
    end if;
  end loop;
  perform public.staff_audit_write('payslip', p_payslip, 'payslip_moved', nullif(btrim(p_note), ''), jsonb_build_object('from', s.status, 'to', p_to));
  return p_to;
end;
$$;
revoke all on function public.payslip_move(uuid, text, text) from public, anon;
grant execute on function public.payslip_move(uuid, text, text) to authenticated;

-- The payslips in one cycle: everything for the Director and the Administrator; for HR only those that reached HR.
create or replace function public.payroll_payslips(p_cycle uuid)
returns table (payslip_id uuid, profile_id uuid, full_name text, staff_role text, status text, gross numeric,
               deductions numeric, net numeric, lines jsonb, next_steps text[], last_note text, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := public.staff_actor_role();
begin
  if v_role is null or v_role not in ('owner', 'administrator', 'hr') then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query
    select s.id, s.profile_id, p.full_name, p.role::text, s.status, t.gross, t.deductions, t.net,
           coalesce((select jsonb_agg(jsonb_build_object('line_id', l.id, 'kind', l.kind, 'label', l.label, 'amount', l.amount) order by l.added_at)
                       from public.payslip_lines l where l.payslip_id = s.id and l.removed_at is null), '[]'::jsonb),
           public.payslip_next(s.id),
           (select e.note from public.payslip_events e where e.payslip_id = s.id order by e.at desc limit 1),
           s.updated_at
      from public.payslips s
      join public.profiles p on p.id = s.profile_id
      cross join lateral public.payslip_totals(s.id) t
     where s.cycle_id = p_cycle and (v_role <> 'hr' or s.status in ('with_hr', 'distributed', 'acknowledged'))
     order by p.full_name;
end;
$$;
revoke all on function public.payroll_payslips(uuid) from public, anon;
grant execute on function public.payroll_payslips(uuid) to authenticated;

-- The caller's own payslips, once HR has distributed them.
create or replace function public.my_payslips()
returns table (payslip_id uuid, pay_month date, pay_date date, status text, gross numeric, deductions numeric, net numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  return query
    select s.id, c.pay_month, c.pay_date, s.status, t.gross, t.deductions, t.net
      from public.payslips s join public.payroll_cycles c on c.id = s.cycle_id cross join lateral public.payslip_totals(s.id) t
     where s.profile_id = (select auth.uid()) and s.status in ('distributed', 'acknowledged')
     order by c.pay_month desc
     limit 60;
end;
$$;
revoke all on function public.my_payslips() from public, anon;
grant execute on function public.my_payslips() to authenticated;

-- Everything needed to print one payslip.
create or replace function public.payslip_document(p_payslip uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.payslip_can_view(p_payslip) then raise exception 'Payslip not found'; end if;
  select jsonb_build_object(
           'payslip_id', s.id, 'status', s.status, 'full_name', p.full_name, 'staff_role', p.role::text,
           'pay_month', c.pay_month, 'period_start', c.period_start, 'period_end', c.period_end, 'pay_date', c.pay_date,
           'gross', t.gross, 'deductions', t.deductions, 'net', t.net,
           'lines', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'label', l.label, 'amount', l.amount) order by l.added_at)
                                from public.payslip_lines l where l.payslip_id = s.id and l.removed_at is null), '[]'::jsonb),
           'can_acknowledge', 'acknowledged' = any (public.payslip_next(s.id)),
           'company', coalesce((select jsonb_build_object('legal_name', a.legal_name, 'registration_number', a.registration_number, 'address', a.address)
                                  from public.admin_fee_settings a), '{}'::jsonb))
    into v
    from public.payslips s join public.profiles p on p.id = s.profile_id join public.payroll_cycles c on c.id = s.cycle_id
    cross join lateral public.payslip_totals(s.id) t
   where s.id = p_payslip;
  return v;
end;
$$;
revoke all on function public.payslip_document(uuid) from public, anon;
grant execute on function public.payslip_document(uuid) to authenticated;
