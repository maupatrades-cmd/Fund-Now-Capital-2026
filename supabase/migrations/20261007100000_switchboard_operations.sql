-- Staff build, Batch 2 (1/2): Switchboard operations — call log, shift handover,
-- shared tasks with routing, document checklist and diary projections.
--
-- Authority (enforced here, never in the UI):
--   Owner / Coordinator / Switchboard  log calls, write handovers, create tasks,
--                                      read the safe projections below.
--   Routing: Switchboard may route to coordinator or owner (escalate). Coordinator
--            may route to switchboard, coordinator or owner. Owner to anyone.
--   Completing a task: its current route role, the assignee, or the Owner. A
--            founder decision (task_kind = 'founder_decision') only the Owner.
-- Staff never see commission, bank, ID contents, funder identity or stored
-- documents. Free text is blocked from carrying a 13-digit number (SA ID shape)
-- or a long digit run (account shape). No table grants beyond Owner SELECT.
-- Nothing here touches signing, payroll, Path-A or commission objects.

-- ---------------------------------------------------------------------------
-- Shared guard: reject free text that looks like personal or banking numbers.
-- ---------------------------------------------------------------------------
create or replace function public.staff_text_is_safe(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text is null or regexp_replace(p_text, '[\s-]', '', 'g') !~ '\d{9,}';
$$;

-- ---------------------------------------------------------------------------
-- 1. Call log (append-only; a correction is a new row pointing at the old one)
-- ---------------------------------------------------------------------------
create table if not exists public.switchboard_call_logs (
  id             uuid primary key default gen_random_uuid(),
  shift_date     date not null default public.current_sast_date(),
  logged_at      timestamptz not null default now(),
  logged_by      uuid not null references public.profiles(id) on delete restrict,
  logged_by_role text not null,
  direction      text not null check (direction in ('inbound', 'outbound')),
  caller_kind    text not null check (caller_kind in
                   ('new_enquirer', 'existing_client', 'referral_agent', 'team_leader', 'partner', 'funder_contact', 'other')),
  caller_name    text not null check (length(btrim(caller_name)) between 2 and 120),
  caller_phone   text check (caller_phone is null or length(caller_phone) <= 30),
  business_name  text check (business_name is null or length(business_name) <= 160),
  topic          text not null check (topic in
                   ('new_enquiry', 'document_followup', 'status_query', 'callback_request', 'complaint', 'other')),
  summary        text not null check (length(btrim(summary)) between 3 and 1000),
  outcome        text not null check (outcome in ('resolved', 'routed', 'callback_needed', 'no_action')),
  callback_due_at timestamptz,
  lead_id        uuid references public.leads(id) on delete set null,
  corrects_id    uuid references public.switchboard_call_logs(id) on delete restrict,
  constraint switchboard_call_logs_safe_text_ck
    check (public.staff_text_is_safe(summary)),
  constraint switchboard_call_logs_callback_ck
    check (outcome <> 'callback_needed' or callback_due_at is not null)
);

create index if not exists switchboard_call_logs_shift_idx
  on public.switchboard_call_logs (shift_date desc, logged_at desc);
create index if not exists switchboard_call_logs_lead_idx
  on public.switchboard_call_logs (lead_id) where lead_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Shift handover (one note per author per shift, acknowledged by the next)
-- ---------------------------------------------------------------------------
create table if not exists public.staff_shift_handovers (
  id              uuid primary key default gen_random_uuid(),
  shift_date      date not null default public.current_sast_date(),
  shift_label     text not null check (shift_label in ('morning', 'afternoon', 'evening')),
  author_id       uuid not null references public.profiles(id) on delete restrict,
  author_role     text not null,
  summary         text not null check (length(btrim(summary)) between 3 and 2000),
  open_items      jsonb not null default '[]'::jsonb check (jsonb_typeof(open_items) = 'array'),
  created_at      timestamptz not null default now(),
  acknowledged_by uuid references public.profiles(id) on delete restrict,
  acknowledged_at timestamptz,
  constraint staff_shift_handovers_safe_text_ck
    check (public.staff_text_is_safe(summary) and public.staff_text_is_safe(open_items::text)),
  constraint staff_shift_handovers_ack_ck
    check ((acknowledged_by is null) = (acknowledged_at is null)),
  unique (shift_date, shift_label, author_id)
);

-- ---------------------------------------------------------------------------
-- 3. Shared tasks with routing
-- ---------------------------------------------------------------------------
create table if not exists public.staff_tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(btrim(title)) between 3 and 160),
  notes         text check (notes is null or length(notes) <= 1000),
  task_kind     text not null default 'general' check (task_kind in
                  ('general', 'document_chase', 'callback', 'founder_decision', 'review')),
  priority      text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status        text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  due_at        timestamptz,
  route_to      text not null check (route_to in ('switchboard', 'coordinator', 'owner')),
  assigned_to   uuid references public.profiles(id) on delete set null,
  lead_id       uuid references public.leads(id) on delete set null,
  call_log_id   uuid references public.switchboard_call_logs(id) on delete set null,
  created_by    uuid not null references public.profiles(id) on delete restrict,
  created_role  text not null,
  created_at    timestamptz not null default now(),
  completed_by  uuid references public.profiles(id) on delete restrict,
  completed_at  timestamptz,
  completion_note text check (completion_note is null or length(completion_note) <= 500),
  updated_at    timestamptz not null default now(),
  constraint staff_tasks_safe_text_ck
    check (public.staff_text_is_safe(title) and public.staff_text_is_safe(notes) and public.staff_text_is_safe(completion_note)),
  constraint staff_tasks_completion_ck check (
    (status = 'done' and completed_by is not null and completed_at is not null)
    or (status <> 'done' and completed_by is null and completed_at is null)),
  constraint staff_tasks_founder_route_ck check (task_kind <> 'founder_decision' or route_to = 'owner')
);

create index if not exists staff_tasks_open_route_idx
  on public.staff_tasks (route_to, due_at nulls last, created_at desc) where status = 'open';
create index if not exists staff_tasks_lead_idx on public.staff_tasks (lead_id) where lead_id is not null;

create table if not exists public.staff_task_events (
  id        bigint generated always as identity primary key,
  task_id   uuid not null references public.staff_tasks(id) on delete cascade,
  at        timestamptz not null default now(),
  actor_id  uuid not null,
  actor_role text not null,
  event     text not null check (event in ('created', 'routed', 'completed', 'cancelled')),
  from_route text,
  to_route   text,
  reason     text
);

-- ---------------------------------------------------------------------------
-- Immutability + RLS. Owner reads; every write is an RPC below.
-- ---------------------------------------------------------------------------
create or replace function public.switchboard_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: record a correction instead', tg_table_name;
end;
$$;

drop trigger if exists switchboard_call_logs_append_only on public.switchboard_call_logs;
create trigger switchboard_call_logs_append_only
  before update or delete on public.switchboard_call_logs
  for each row execute function public.switchboard_append_only_guard();
drop trigger if exists staff_task_events_append_only on public.staff_task_events;
create trigger staff_task_events_append_only
  before update or delete on public.staff_task_events
  for each row execute function public.switchboard_append_only_guard();

-- Handovers: only the acknowledgement columns may ever change, once.
create or replace function public.staff_handover_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Handovers cannot be deleted'; end if;
  if old.acknowledged_at is not null then raise exception 'A handover can be acknowledged only once'; end if;
  if (new.id, new.shift_date, new.shift_label, new.author_id, new.summary, new.open_items, new.created_at)
     is distinct from (old.id, old.shift_date, old.shift_label, old.author_id, old.summary, old.open_items, old.created_at) then
    raise exception 'A handover cannot be edited after it is written';
  end if;
  return new;
end;
$$;
drop trigger if exists staff_handover_guard on public.staff_shift_handovers;
create trigger staff_handover_guard
  before update or delete on public.staff_shift_handovers
  for each row execute function public.staff_handover_guard();

-- Tasks: only RPCs (which set fnc.task_transition) may change a task, and the
-- identity/creation columns never move.
create or replace function public.staff_task_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Tasks cannot be deleted; cancel them'; end if;
  if coalesce(current_setting('fnc.task_transition', true), '') <> 'on' then
    raise exception 'Tasks change only through the task functions';
  end if;
  if (new.id, new.title, new.task_kind, new.created_by, new.created_at, new.lead_id)
     is distinct from (old.id, old.title, old.task_kind, old.created_by, old.created_at, old.lead_id) then
    raise exception 'Task identity cannot be changed';
  end if;
  if old.status <> 'open' then raise exception 'A % task cannot be changed', old.status; end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists staff_task_guard on public.staff_tasks;
create trigger staff_task_guard
  before update or delete on public.staff_tasks
  for each row execute function public.staff_task_guard();

alter table public.switchboard_call_logs enable row level security;
alter table public.staff_shift_handovers enable row level security;
alter table public.staff_tasks enable row level security;
alter table public.staff_task_events enable row level security;

do $$
declare t text;
begin
  foreach t in array array['switchboard_call_logs', 'staff_shift_handovers', 'staff_tasks', 'staff_task_events'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_owner())', t || '_owner_select', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs: calls
-- ---------------------------------------------------------------------------
create or replace function public.staff_log_call(
  p_direction       text,
  p_caller_kind     text,
  p_caller_name     text,
  p_caller_phone    text,
  p_business_name   text,
  p_topic           text,
  p_summary         text,
  p_outcome         text,
  p_callback_due_at timestamptz default null,
  p_lead_id         uuid default null,
  p_corrects_id     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_id   uuid;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  if p_lead_id is not null and not exists (select 1 from public.submission_intakes si where si.lead_id = p_lead_id) then
    raise exception 'Submission not found';
  end if;
  if p_corrects_id is not null and not exists (select 1 from public.switchboard_call_logs c where c.id = p_corrects_id) then
    raise exception 'The call being corrected was not found';
  end if;
  insert into public.switchboard_call_logs
    (logged_by, logged_by_role, direction, caller_kind, caller_name, caller_phone, business_name,
     topic, summary, outcome, callback_due_at, lead_id, corrects_id)
  values ((select auth.uid()), v_role, p_direction, p_caller_kind, btrim(p_caller_name), nullif(btrim(p_caller_phone), ''),
          nullif(btrim(p_business_name), ''), p_topic, btrim(p_summary), p_outcome, p_callback_due_at, p_lead_id, p_corrects_id)
  returning id into v_id;
  perform public.staff_audit_write('switchboard_call', v_id, case when p_corrects_id is null then 'call_logged' else 'call_corrected' end,
    null, jsonb_build_object('topic', p_topic, 'outcome', p_outcome, 'lead_id', p_lead_id));
  return v_id;
end;
$$;

-- Shift desk view: the same for every staff role so the desk can hand over.
create or replace function public.staff_call_log_list(p_shift_date date default null, p_limit integer default 50)
returns table (
  id uuid, shift_date date, logged_at timestamptz, logged_by_name text, logged_by_role text,
  direction text, caller_kind text, caller_name text, caller_phone text, business_name text,
  topic text, summary text, outcome text, callback_due_at timestamptz, lead_id uuid, corrects_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  return query
    select c.id, c.shift_date, c.logged_at, p.full_name, c.logged_by_role, c.direction, c.caller_kind,
           c.caller_name, c.caller_phone, c.business_name, c.topic, c.summary, c.outcome,
           c.callback_due_at, c.lead_id, c.corrects_id
      from public.switchboard_call_logs c
      join public.profiles p on p.id = c.logged_by
     where p_shift_date is null or c.shift_date = p_shift_date
     order by c.logged_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: shift handover
-- ---------------------------------------------------------------------------
create or replace function public.staff_write_handover(
  p_shift_label text, p_summary text, p_open_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_id   uuid;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  insert into public.staff_shift_handovers (shift_label, author_id, author_role, summary, open_items)
  values (p_shift_label, (select auth.uid()), v_role, btrim(p_summary), coalesce(p_open_items, '[]'::jsonb))
  returning id into v_id;
  perform public.staff_audit_write('shift_handover', v_id, 'handover_written', null,
    jsonb_build_object('shift_label', p_shift_label));
  return v_id;
exception when unique_violation then
  raise exception 'You have already written a handover for this shift';
end;
$$;

create or replace function public.staff_acknowledge_handover(p_handover_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_shift_handovers;
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  select * into v_row from public.staff_shift_handovers h where h.id = p_handover_id for update;
  if not found then raise exception 'Handover not found'; end if;
  if v_row.author_id = (select auth.uid()) then raise exception 'You cannot acknowledge your own handover'; end if;
  update public.staff_shift_handovers set acknowledged_by = (select auth.uid()), acknowledged_at = now()
   where id = p_handover_id;
  perform public.staff_audit_write('shift_handover', p_handover_id, 'handover_acknowledged', null, '{}'::jsonb);
end;
$$;

create or replace function public.staff_handover_list(p_days integer default 3)
returns table (
  id uuid, shift_date date, shift_label text, author_name text, author_role text, summary text,
  open_items jsonb, created_at timestamptz, acknowledged_by_name text, acknowledged_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  return query
    select h.id, h.shift_date, h.shift_label, a.full_name, h.author_role, h.summary, h.open_items,
           h.created_at, k.full_name, h.acknowledged_at
      from public.staff_shift_handovers h
      join public.profiles a on a.id = h.author_id
      left join public.profiles k on k.id = h.acknowledged_by
     where h.shift_date >= public.current_sast_date() - least(greatest(coalesce(p_days, 3), 1), 14)
     order by h.created_at desc
     limit 50;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: shared tasks and routing
-- ---------------------------------------------------------------------------
create or replace function public.staff_task_can_route(p_actor text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_actor
    when 'owner' then p_to in ('switchboard', 'coordinator', 'owner')
    when 'coordinator' then p_to in ('switchboard', 'coordinator', 'owner')
    when 'switchboard' then p_to in ('coordinator', 'owner')
    else false end;
$$;

create or replace function public.staff_create_task(
  p_title text, p_notes text, p_task_kind text, p_priority text, p_due_at timestamptz,
  p_route_to text, p_lead_id uuid default null, p_call_log_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_id   uuid;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  if not public.staff_task_can_route(v_role, p_route_to) then
    raise exception 'Your role cannot route a task to %', p_route_to using errcode = '42501';
  end if;
  if p_lead_id is not null and not exists (select 1 from public.submission_intakes si where si.lead_id = p_lead_id) then
    raise exception 'Submission not found';
  end if;
  perform set_config('fnc.task_transition', 'on', true);
  insert into public.staff_tasks (title, notes, task_kind, priority, due_at, route_to, lead_id, call_log_id, created_by, created_role)
  values (btrim(p_title), nullif(btrim(p_notes), ''), coalesce(p_task_kind, 'general'), coalesce(p_priority, 'normal'),
          p_due_at, p_route_to, p_lead_id, p_call_log_id, (select auth.uid()), v_role)
  returning id into v_id;
  insert into public.staff_task_events (task_id, actor_id, actor_role, event, to_route)
  values (v_id, (select auth.uid()), v_role, 'created', p_route_to);
  perform public.staff_audit_write('staff_task', v_id, 'task_created', null,
    jsonb_build_object('route_to', p_route_to, 'task_kind', coalesce(p_task_kind, 'general')));
  return v_id;
end;
$$;

create or replace function public.staff_route_task(p_task_id uuid, p_route_to text, p_reason text, p_assigned_to uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_task public.staff_tasks;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'A reason is required to route a task'; end if;
  if not public.staff_task_can_route(v_role, p_route_to) then
    raise exception 'Your role cannot route a task to %', p_route_to using errcode = '42501';
  end if;
  select * into v_task from public.staff_tasks t where t.id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if v_role <> 'owner' and v_task.route_to <> v_role and v_task.created_by <> (select auth.uid()) then
    raise exception 'You can only route tasks that are with you or that you created' using errcode = '42501';
  end if;
  if v_task.task_kind = 'founder_decision' and p_route_to <> 'owner' then
    raise exception 'A founder decision stays with the Owner';
  end if;
  if p_assigned_to is not null and not exists (
       select 1 from public.staff_access s join public.profiles p on p.id = s.profile_id
        where s.profile_id = p_assigned_to and s.access_enabled and p.is_active and s.staff_role::text = p_route_to) then
    raise exception 'The assignee must be an enabled % user', p_route_to;
  end if;
  perform set_config('fnc.task_transition', 'on', true);
  update public.staff_tasks set route_to = p_route_to, assigned_to = p_assigned_to where id = p_task_id;
  insert into public.staff_task_events (task_id, actor_id, actor_role, event, from_route, to_route, reason)
  values (p_task_id, (select auth.uid()), v_role, 'routed', v_task.route_to, p_route_to, btrim(p_reason));
  perform public.staff_audit_write('staff_task', p_task_id, 'task_routed', p_reason,
    jsonb_build_object('from', v_task.route_to, 'to', p_route_to));
end;
$$;

create or replace function public.staff_close_task(p_task_id uuid, p_outcome text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_task public.staff_tasks;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  if p_outcome not in ('done', 'cancelled') then raise exception 'Outcome must be done or cancelled'; end if;
  select * into v_task from public.staff_tasks t where t.id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if v_task.task_kind = 'founder_decision' and v_role <> 'owner' then
    raise exception 'Only the Owner can close a founder decision' using errcode = '42501';
  end if;
  if v_role <> 'owner' and v_task.route_to <> v_role and v_task.assigned_to is distinct from (select auth.uid())
     and not (p_outcome = 'cancelled' and v_task.created_by = (select auth.uid())) then
    raise exception 'This task is not with you' using errcode = '42501';
  end if;
  perform set_config('fnc.task_transition', 'on', true);
  update public.staff_tasks
     set status = p_outcome,
         completed_by = case when p_outcome = 'done' then (select auth.uid()) end,
         completed_at = case when p_outcome = 'done' then now() end,
         completion_note = nullif(btrim(p_note), '')
   where id = p_task_id;
  insert into public.staff_task_events (task_id, actor_id, actor_role, event, reason)
  values (p_task_id, (select auth.uid()), v_role, case p_outcome when 'done' then 'completed' else 'cancelled' end, nullif(btrim(p_note), ''));
  perform public.staff_audit_write('staff_task', p_task_id, case p_outcome when 'done' then 'task_completed' else 'task_cancelled' end, p_note, '{}'::jsonb);
end;
$$;

-- Queue view. Switchboard: tasks with the desk or created by them. Coordinator:
-- tasks with Coordinator or the desk, plus their own. Owner: everything.
create or replace function public.staff_task_list(p_status text default 'open', p_limit integer default 50)
returns table (
  id uuid, title text, notes text, task_kind text, priority text, status text, due_at timestamptz,
  route_to text, assigned_name text, lead_id uuid, business_name text, created_by_name text,
  created_role text, created_at timestamptz, overdue boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  return query
    select t.id, t.title, t.notes, t.task_kind, t.priority, t.status, t.due_at, t.route_to, ap.full_name,
           t.lead_id, l.business_name, cp.full_name, t.created_role, t.created_at,
           (t.status = 'open' and t.due_at is not null and t.due_at < now())
      from public.staff_tasks t
      join public.profiles cp on cp.id = t.created_by
      left join public.profiles ap on ap.id = t.assigned_to
      left join public.leads l on l.id = t.lead_id
     where (p_status is null or t.status = p_status)
       and (v_role = 'owner'
            or t.created_by = (select auth.uid())
            or t.assigned_to = (select auth.uid())
            or t.route_to = v_role
            or (v_role = 'coordinator' and t.route_to = 'switchboard'))
     order by (t.priority = 'high') desc, t.due_at nulls last, t.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- ---------------------------------------------------------------------------
-- Document Tracker projection: the checklist for a submission's funding type
-- against received documents. Type names only, no file access, no contents.
-- ---------------------------------------------------------------------------
create or replace function public.staff_document_checklist(p_lead_id uuid)
returns table (
  document_type text, requirement text, received boolean, received_count integer,
  last_received_at timestamptz, flagged_suspicious boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type text;
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  select si.funding_type into v_type from public.submission_intakes si where si.lead_id = p_lead_id;
  if not found then raise exception 'Submission not found'; end if;
  return query
    select r.document_type::text, r.requirement,
           coalesce(x.cnt, 0) > 0, coalesce(x.cnt, 0)::integer, x.last_at,
           coalesce(x.flagged, false)
      from public.document_requirement_rules r
      left join lateral (
        select count(*) as cnt, max(d.received_at) as last_at,
               bool_or(coalesce((select f.event_kind from public.intake_document_flag_events f
                                  where f.receipt_id = d.id order by f.id desc limit 1), '') = 'suspicious_flagged') as flagged
          from public.intake_document_receipts d
         where d.lead_id = p_lead_id and d.document_type = r.document_type) x on true
     where r.rule_scope = 'product_baseline' and r.product_code = v_type and r.is_active
     order by (r.requirement = 'required') desc, r.document_type::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- Diary projection (Batch 2 scope: tasks, callbacks, handover). Calendar and
-- Founder diary permissions arrive in Batch 3.
-- ---------------------------------------------------------------------------
create or replace function public.staff_diary(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_date date := coalesce(p_date, public.current_sast_date());
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  return jsonb_build_object(
    'date', v_date,
    'tasks_due', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'due_at', t.due_at, 'route_to', t.route_to,
                                          'priority', t.priority, 'overdue', t.due_at < now()) order by t.due_at)
        from public.staff_tasks t
       where t.status = 'open' and t.due_at is not null
         and (t.due_at at time zone 'Africa/Johannesburg')::date <= v_date
         and (v_role = 'owner' or t.created_by = (select auth.uid()) or t.assigned_to = (select auth.uid())
              or t.route_to = v_role or (v_role = 'coordinator' and t.route_to = 'switchboard'))), '[]'::jsonb),
    'callbacks_due', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'caller_name', c.caller_name, 'caller_phone', c.caller_phone,
                                          'due_at', c.callback_due_at, 'topic', c.topic) order by c.callback_due_at)
        from public.switchboard_call_logs c
       where c.outcome = 'callback_needed'
         and (c.callback_due_at at time zone 'Africa/Johannesburg')::date <= v_date
         and not exists (select 1 from public.switchboard_call_logs k where k.corrects_id = c.id)), '[]'::jsonb),
    'unacknowledged_handovers', (
      select count(*) from public.staff_shift_handovers h
       where h.acknowledged_at is null and h.author_id <> (select auth.uid()))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: named doors only. Guard helpers stay private.
-- ---------------------------------------------------------------------------
revoke all on function public.staff_text_is_safe(text) from public, anon, authenticated;
revoke all on function public.staff_task_can_route(text, text) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.staff_log_call(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid)',
    'public.staff_call_log_list(date,integer)',
    'public.staff_write_handover(text,text,jsonb)',
    'public.staff_acknowledge_handover(uuid)',
    'public.staff_handover_list(integer)',
    'public.staff_create_task(text,text,text,text,timestamptz,text,uuid,uuid)',
    'public.staff_route_task(uuid,text,text,uuid)',
    'public.staff_close_task(uuid,text,text)',
    'public.staff_task_list(text,integer)',
    'public.staff_document_checklist(uuid)',
    'public.staff_diary(date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
