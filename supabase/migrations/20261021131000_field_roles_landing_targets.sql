-- Launch priority 2 (staff logins and landing pages) (2/2). docs/FNC-LAUNCH-PLAN-2026-11-09.md sections 2 and 7.
-- Forward-only.
--
--   1. Field Supervisor and field consultant are staff logins, switched on by the owner like the other staff roles.
--      Like HR, they hold nothing by default: no existing staff function names them. For launch they get their landing
--      page ("My day": tasks, targets) and staff notices. Lead capture for the field follows with launch priority 3.
--   2. History-role gap: functions that admit the Administrator through the Sales Coordinator's checks wrote
--      'coordinator' into their own history columns. A trigger on those tables now records the real role. Those
--      columns are only ever displayed, never used for a permission check. Rows written before this stay as they were.
--   3. Targets per role, shown against month-to-date on each landing page; the Director sees every role. The rows are
--      the owner's (proposed until she confirms them); actuals are counted from the CRM where the CRM records them.

-- 1. Field roles ----------------------------------------------------------------------------------------------------
alter table public.staff_access drop constraint if exists staff_access_role_ck;
alter table public.staff_access add constraint staff_access_role_ck
  check (staff_role::text in ('switchboard', 'coordinator', 'administrator', 'hr', 'field_supervisor', 'field_consultant'));

create or replace function public.staff_role_of()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role::text
    from public.profiles p
    join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
   where p.id = (select auth.uid())
     and p.is_active
     and s.access_enabled
     and p.role::text in ('switchboard', 'coordinator', 'administrator', 'hr', 'field_supervisor', 'field_consultant');
$$;

create or replace function public.owner_set_staff_access(p_profile_id uuid, p_enabled boolean, p_contract_reference text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare
  v_role text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can enable or disable staff access' using errcode = '42501';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = p_profile_id;
  if v_role is null then raise exception 'Profile not found'; end if;
  if v_role not in ('switchboard', 'coordinator', 'administrator', 'hr', 'field_supervisor', 'field_consultant') then
    raise exception 'Profile is not a staff role (assign Switchboard, Sales Coordinator, Administrator, HR, Field Supervisor or field consultant first)';
  end if;

  insert into public.staff_access (profile_id, staff_role, access_enabled, contract_reference, activation_note)
  values (p_profile_id, v_role::public.user_role, coalesce(p_enabled, false),
          nullif(btrim(p_contract_reference), ''), nullif(btrim(p_note), ''))
  on conflict (profile_id) do update
    set staff_role         = excluded.staff_role,
        access_enabled     = excluded.access_enabled,
        contract_reference = coalesce(excluded.contract_reference, public.staff_access.contract_reference),
        activation_note    = coalesce(excluded.activation_note, public.staff_access.activation_note);

  perform public.staff_audit_write(
    'staff_access', p_profile_id,
    case when coalesce(p_enabled, false) then 'staff_access_enabled' else 'staff_access_disabled' end,
    p_note,
    jsonb_build_object('staff_role', v_role, 'contract_reference', nullif(btrim(p_contract_reference), '')));
  return p_profile_id;
end;
$function$;

-- Staff notices to "staff" now reach the field roles too (the build spec gives them read access to notice forms).
create or replace function public.staff_post_notice(p_title text, p_body text, p_needs_attention boolean, p_audience text[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_uid uuid := (select auth.uid()); v_n integer; r record;
begin
  if not public.staff_is_founder_or_administrator() then
    raise exception 'Only the Administrator or the Founder posts notices' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 3 and 160 then raise exception 'Give the notice a title (3 to 160 characters)'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 3 and 4000 then raise exception 'Write the notice (3 to 4000 characters)'; end if;
  if not public.staff_text_is_safe(p_title) or not public.staff_text_is_safe(p_body) then
    raise exception 'Notices cannot contain ID or account-length numbers';
  end if;
  if p_audience is null or cardinality(p_audience) = 0 or not (p_audience <@ array['staff', 'sub_agents', 'team_leaders']) then
    raise exception 'Choose who the notice is for: staff, sub-agents and/or Team Leaders';
  end if;
  insert into public.staff_notices (title, body, needs_attention, audience, created_by, created_role)
  values (btrim(p_title), btrim(p_body), coalesce(p_needs_attention, false), p_audience, v_uid, public.staff_actor_role())
  returning id into v_id;
  insert into public.staff_notice_recipients (notice_id, recipient_id)
  select distinct v_id, x.id from (
    select p.id from public.profiles p
      join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role and s.access_enabled
     where 'staff' = any (p_audience) and p.is_active and p.role::text in ('administrator', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant')
    union
    select p.id from public.profiles p
     where 'sub_agents' = any (p_audience) and p.is_active and p.role::text = 'lead_referrer'
    union
    select m.profile_id from public.referral_team_memberships m join public.profiles p on p.id = m.profile_id
     where 'team_leaders' = any (p_audience) and p.is_active and m.membership_role = 'team_leader'
       and m.effective_from <= public.current_sast_date()
       and (m.effective_to is null or m.effective_to >= public.current_sast_date())
  ) x where x.id <> v_uid;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Nobody is in that group yet, so the notice was not posted'; end if;
  for r in select recipient_id from public.staff_notice_recipients where notice_id = v_id loop
    perform public.staff_notify(r.recipient_id, 'STAFF_NOTICE_POSTED',
      case when coalesce(p_needs_attention, false) then 'Needs attention: ' else 'Notice: ' end || btrim(p_title),
      case when coalesce(p_needs_attention, false) then 'Open it and acknowledge it.' else left(btrim(p_body), 160) end,
      public.comms_home(r.recipient_id, 'notices'), jsonb_build_object('notice_id', v_id));
  end loop;
  perform public.staff_audit_write('staff_notice', v_id, 'notice_posted', null,
    jsonb_build_object('audience', p_audience, 'needs_attention', coalesce(p_needs_attention, false), 'recipients', v_n));
  return v_id;
end;
$$;

-- 2. History-role gap ---------------------------------------------------------------------------------------------
-- The Administrator passes the Sales Coordinator's checks (intake_require_actor answers 'coordinator' so the existing
-- Coordinator branches apply). Functions that copy that answer into their history column therefore recorded
-- 'coordinator' for the Administrator's work. This BEFORE INSERT trigger puts the real role back. TG_ARGV[0] names the
-- column. Only 'coordinator' written by an Administrator is changed, so nothing else is touched.
create or replace function public.staff_history_real_role()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) ->> tg_argv[0]) = 'coordinator' and public.staff_actor_role() = 'administrator' then
    new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], 'administrator'));
  end if;
  return new;
end;
$$;
revoke all on function public.staff_history_real_role() from public, anon, authenticated;

create trigger intake_document_receipts_real_role before insert on public.intake_document_receipts
  for each row execute function public.staff_history_real_role('received_by_role');
create trigger intake_document_flag_events_real_role before insert on public.intake_document_flag_events
  for each row execute function public.staff_history_real_role('actor_role');
create trigger switchboard_call_logs_real_role before insert on public.switchboard_call_logs
  for each row execute function public.staff_history_real_role('logged_by_role');
create trigger staff_shift_handovers_real_role before insert on public.staff_shift_handovers
  for each row execute function public.staff_history_real_role('author_role');
create trigger staff_tasks_real_role before insert on public.staff_tasks
  for each row execute function public.staff_history_real_role('created_role');
create trigger staff_task_events_real_role before insert on public.staff_task_events
  for each row execute function public.staff_history_real_role('actor_role');

-- 3. Targets per role -----------------------------------------------------------------------------------------------
-- One row per role and measure. The seed is the build spec's list: "proposed" until the Director confirms it. A measure
-- the CRM does not record yet is shown as "not tracked yet" rather than guessed.
create table if not exists public.role_targets (
  id         uuid primary key default gen_random_uuid(),
  role       text not null check (role in ('administrator', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant')),
  metric_key text not null check (metric_key ~ '^[a-z0-9_]{3,60}$'),
  label      text not null check (length(btrim(label)) between 3 and 160),
  target     numeric(14,2) check (target is null or target >= 0),
  unit       text not null default 'count' check (unit in ('count', 'percent', 'text')),
  scope      text not null default 'person' check (scope in ('person', 'office')),
  status     text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  sort_order integer not null default 100,
  active     boolean not null default true,
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  unique (role, metric_key)
);
alter table public.role_targets enable row level security;
revoke all on table public.role_targets from public, anon, authenticated;

insert into public.role_targets (role, metric_key, label, target, unit, scope, sort_order) values
  ('coordinator', 'files_opened', 'Client files opened this month', 60, 'count', 'office', 10),
  ('coordinator', 'docs_complete_7d_pct', 'Files with documents complete within 7 days', 70, 'percent', 'office', 20),
  ('coordinator', 'daily_sales_call', '08:00 sales call every working day', null, 'text', 'person', 30),
  ('coordinator', 'weekly_sales_report', 'Weekly sales report every Friday', null, 'text', 'person', 40),
  ('switchboard', 'leads_captured', 'Leads captured this month', 30, 'count', 'person', 10),
  ('switchboard', 'calls_logged_same_day', 'Every call logged the same day', null, 'text', 'person', 20),
  ('switchboard', 'missed_calls_2h', 'Missed calls returned within 2 hours', null, 'text', 'person', 30),
  ('switchboard', 'docs_email_1h', 'Required-documents email within 1 hour of a request', null, 'text', 'person', 40),
  ('administrator', 'admin_fee_1day', 'Admin-fee invoice within 1 working day of a signed mandate', null, 'text', 'person', 10),
  ('administrator', 'admin_fee_collected_7d_pct', 'Admin-fee invoices collected within 7 days', 80, 'percent', 'office', 20),
  ('administrator', 'payroll_ready_9th', 'Payroll figures ready by the 9th', null, 'text', 'person', 30),
  ('field_consultant', 'leads_captured', 'Leads captured this month', 40, 'count', 'person', 10),
  ('field_consultant', 'ready_for_sale', 'Leads marked ready for sale', 12, 'count', 'person', 20),
  ('field_consultant', 'field_days', 'Field days a week', 3, 'text', 'person', 30),
  ('field_supervisor', 'active_consultants', 'Active field consultants', 5, 'count', 'person', 10),
  ('field_supervisor', 'team_leads', 'Team leads captured this month', 150, 'count', 'person', 20),
  ('field_supervisor', 'team_ready_for_sale', 'Team leads marked ready for sale', 45, 'count', 'person', 30),
  ('field_supervisor', 'daily_field_report', 'Daily field report by 17:00', null, 'text', 'person', 40)
on conflict (role, metric_key) do nothing;

-- Month-to-date actual for one measure, for one person (or the office, by the row's scope). Null = not tracked yet.
create or replace function public.role_target_actual(p_metric text, p_profile uuid, p_scope text)
returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare v_m tstzrange := tstzrange((date_trunc('month', public.current_sast_date())::timestamp at time zone 'Africa/Johannesburg'), null, '[)');
begin
  return case p_metric
    when 'files_opened' then (select count(*) from public.submission_intakes si where si.registered_at <@ v_m)
    when 'docs_complete_7d_pct' then (
      select case when count(*) > 0 then round(100.0 * count(*) filter (where si.first_complete_at <= si.registered_at + interval '7 days') / count(*), 1) end
        from public.submission_intakes si where si.first_complete_at <@ v_m)
    when 'leads_captured' then (select count(*) from public.submission_intakes si where si.registered_at <@ v_m and si.created_by = p_profile)
    when 'admin_fee_collected_7d_pct' then (
      select case when count(*) > 0 then round(100.0 * count(*) filter (where r.issued_at <= i.issued_at + interval '7 days') / count(*), 1) end
        from public.admin_fee_invoices i left join public.admin_fee_receipts r on r.invoice_id = i.id
       where i.voided_at is null and i.issued_at <@ v_m and i.issued_at < now() - interval '7 days')
    else null
  end;
end;
$$;
revoke all on function public.role_target_actual(text, uuid, text) from public, anon, authenticated;

-- The caller's own targets against month-to-date.
create or replace function public.my_targets()
returns table (metric_key text, label text, target numeric, unit text, scope text, status text, actual numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := public.staff_actor_role(); v_uid uuid := (select auth.uid());
begin
  if v_role is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  return query
    select t.metric_key, t.label, t.target, t.unit, t.scope, t.status,
           case when t.unit = 'text' then null else public.role_target_actual(t.metric_key, v_uid, t.scope) end
      from public.role_targets t where t.active and t.role = v_role
     order by t.sort_order, t.label;
end;
$$;
revoke all on function public.my_targets() from public, anon;
grant execute on function public.my_targets() to authenticated;

-- The Director's one screen: every enabled staff member's targets against month-to-date.
create or replace function public.owner_targets_overview()
returns table (profile_id uuid, full_name text, role text, metric_key text, label text, target numeric, unit text,
               scope text, status text, actual numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.is_owner(), false) then
    raise exception 'Only the Director sees every role''s targets' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.role::text, t.metric_key, t.label, t.target, t.unit, t.scope, t.status,
           case when t.unit = 'text' then null else public.role_target_actual(t.metric_key, p.id, t.scope) end
      from public.profiles p
      join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role and s.access_enabled
      join public.role_targets t on t.role = p.role::text and t.active
     where p.is_active
     order by p.role::text, p.full_name, t.sort_order;
end;
$$;
revoke all on function public.owner_targets_overview() from public, anon;
grant execute on function public.owner_targets_overview() to authenticated;

-- The Director confirms or changes a target.
create or replace function public.owner_set_role_target(p_role text, p_metric text, p_target numeric, p_confirm boolean default true)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  if not coalesce(public.is_owner(), false) then
    raise exception 'Only the Director sets targets' using errcode = '42501';
  end if;
  if p_target is not null and (p_target < 0 or p_target::text in ('NaN', 'Infinity')) then raise exception 'Enter a target of 0 or more'; end if;
  update public.role_targets set target = p_target, status = case when coalesce(p_confirm, true) then 'confirmed' else status end,
         updated_by = (select auth.uid()), updated_at = now()
   where role = p_role and metric_key = p_metric
  returning updated_at into v_at;
  if v_at is null then raise exception 'Target not found'; end if;
  perform public.staff_audit_write('role_target', null, 'role_target_set', null,
    jsonb_build_object('role', p_role, 'metric', p_metric, 'target', p_target));
  return v_at;
end;
$$;
revoke all on function public.owner_set_role_target(text, text, numeric, boolean) from public, anon;
grant execute on function public.owner_set_role_target(text, text, numeric, boolean) to authenticated;
