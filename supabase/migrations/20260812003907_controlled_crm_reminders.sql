-- C7: Idempotent reminder queue for tasks and appointments.

create table public.crm_reminder_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  reminder_kind text not null check (reminder_kind in ('task_due','task_escalation','booking_upcoming')),
  target_user_id uuid not null references public.profiles(id) on delete restrict,
  task_id uuid references public.owner_tasks(id) on delete cascade,
  booking_id uuid references public.crm_bookings(id) on delete cascade,
  channel text not null default 'in_app' check (channel in ('in_app','email')),
  scheduled_for timestamptz not null,
  status text not null default 'queued' check (status in ('queued','sent','failed','cancelled')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check ((task_id is not null)::integer + (booking_id is not null)::integer = 1)
);

create index crm_reminder_queued_idx
  on public.crm_reminder_events(scheduled_for)
  where status='queued';
alter table public.crm_reminder_events enable row level security;
revoke all on public.crm_reminder_events from public,anon,authenticated;
grant select on public.crm_reminder_events to authenticated;
create policy crm_reminders_owner_read on public.crm_reminder_events
  for select to authenticated using(public.is_owner());
create policy crm_reminders_target_read on public.crm_reminder_events
  for select to authenticated using(target_user_id=(select auth.uid()));

create or replace function public.owner_queue_crm_reminders(
  p_window_start timestamptz default now(),
  p_window_end timestamptz default now()+interval '48 hours'
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_count integer := 0; v_added integer;
begin
  if not public.is_owner() then raise exception 'Only the owner can queue reminders' using errcode='42501'; end if;
  if p_window_end <= p_window_start or p_window_end-p_window_start > interval '31 days' then
    raise exception 'Invalid reminder window';
  end if;

  insert into public.crm_reminder_events(
    idempotency_key,reminder_kind,target_user_id,task_id,scheduled_for
  )
  select
    'task_due:'||t.id::text||':'||extract(epoch from t.due_at)::bigint::text,
    'task_due',coalesce(t.assigned_to,t.created_by),t.id,t.due_at
  from public.owner_tasks t
  where t.status in ('open','in_progress','blocked')
    and t.due_at >= p_window_start and t.due_at < p_window_end
  on conflict(idempotency_key) do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  insert into public.crm_reminder_events(
    idempotency_key,reminder_kind,target_user_id,booking_id,scheduled_for
  )
  select
    'booking_upcoming:'||b.id::text||':'||extract(epoch from s.starts_at)::bigint::text,
    'booking_upcoming',b.requester_id,b.id,s.starts_at-interval '24 hours'
  from public.crm_bookings b
  join public.owner_availability_slots s on s.id=b.slot_id
  where b.status='confirmed'
    and s.starts_at-interval '24 hours' >= p_window_start
    and s.starts_at-interval '24 hours' < p_window_end
  on conflict(idempotency_key) do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;
  return v_count;
end;
$$;

revoke all on function public.owner_queue_crm_reminders(timestamptz,timestamptz) from public,anon;
grant execute on function public.owner_queue_crm_reminders(timestamptz,timestamptz) to authenticated;

do $$ begin
  if has_table_privilege('authenticated','public.crm_reminder_events','INSERT,UPDATE,DELETE') then
    raise exception 'C7: direct reminder mutation exposed';
  end if;
end $$;

notify pgrst, 'reload schema';
