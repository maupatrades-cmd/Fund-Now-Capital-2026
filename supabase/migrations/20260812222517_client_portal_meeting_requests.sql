-- Client portal: secure consultation and paperwork-review requests.
-- This records preferred times only. It deliberately does not create calendar
-- events or owner tasks; those remain separate workflows until the Owner
-- confirms a time.

create table if not exists public.client_meeting_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  request_type text not null check (
    request_type in ('funding_consultation', 'paperwork_review', 'presentation', 'phone_call')
  ),
  subject text not null check (length(btrim(subject)) between 3 and 120),
  notes text check (notes is null or length(notes) <= 2000),
  contact_method text not null default 'video' check (
    contact_method in ('video', 'phone', 'in_person')
  ),
  preferred_start timestamptz not null,
  alternate_start timestamptz,
  timezone text not null default 'Africa/Johannesburg' check (length(timezone) between 3 and 80),
  status text not null default 'pending' check (
    status in ('pending', 'confirmed', 'completed', 'declined', 'cancelled')
  ),
  scheduled_start timestamptz,
  meeting_url text check (meeting_url is null or length(meeting_url) <= 1000),
  owner_response text check (owner_response is null or length(owner_response) <= 2000),
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_meeting_requests_alternate_distinct_ck check (
    alternate_start is null or alternate_start <> preferred_start
  ),
  constraint client_meeting_requests_confirmation_ck check (
    (status = 'confirmed' and scheduled_start is not null and responded_at is not null)
    or status <> 'confirmed'
  ),
  constraint client_meeting_requests_cancelled_ck check (
    (status = 'cancelled' and cancelled_at is not null)
    or (status <> 'cancelled' and cancelled_at is null)
  )
);

comment on table public.client_meeting_requests is
  'Client-owned meeting preferences. A request is not a confirmed calendar booking until Owner sets status=confirmed and scheduled_start.';

create index if not exists client_meeting_requests_client_created_idx
  on public.client_meeting_requests (client_id, created_at desc);

create index if not exists client_meeting_requests_owner_queue_idx
  on public.client_meeting_requests (status, preferred_start, created_at)
  where status in ('pending', 'confirmed');

alter table public.client_meeting_requests enable row level security;

drop policy if exists client_meeting_requests_client_select_own on public.client_meeting_requests;
create policy client_meeting_requests_client_select_own
  on public.client_meeting_requests for select
  to authenticated
  using (client_id = (select public.current_client_id()));

drop policy if exists client_meeting_requests_owner_select on public.client_meeting_requests;
create policy client_meeting_requests_owner_select
  on public.client_meeting_requests for select
  to authenticated
  using ((select public.is_owner()));

drop policy if exists client_meeting_requests_owner_update on public.client_meeting_requests;
create policy client_meeting_requests_owner_update
  on public.client_meeting_requests for update
  to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));

revoke all on table public.client_meeting_requests from public, anon, authenticated;
grant select on table public.client_meeting_requests to authenticated;
grant update on table public.client_meeting_requests to authenticated;
grant all on table public.client_meeting_requests to service_role;

drop trigger if exists set_updated_at on public.client_meeting_requests;
create trigger set_updated_at
  before update on public.client_meeting_requests
  for each row execute function public.set_updated_at();

drop trigger if exists log_activity_client_meeting_requests on public.client_meeting_requests;
create trigger log_activity_client_meeting_requests
  after insert or update or delete on public.client_meeting_requests
  for each row execute function public.log_activity();

create or replace function public.client_create_meeting_request(
  p_request_type text,
  p_subject text,
  p_notes text,
  p_contact_method text,
  p_preferred_start timestamptz,
  p_alternate_start timestamptz default null,
  p_timezone text default 'Africa/Johannesburg'
)
returns public.client_meeting_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_client_id uuid := public.current_client_id();
  v_pending_count integer;
  v_request public.client_meeting_requests;
begin
  if v_uid is null or v_client_id is null then
    raise exception 'A linked client portal account is required' using errcode = '42501';
  end if;

  if p_request_type not in ('funding_consultation', 'paperwork_review', 'presentation', 'phone_call') then
    raise exception 'Invalid meeting request type';
  end if;
  if p_contact_method not in ('video', 'phone', 'in_person') then
    raise exception 'Invalid contact method';
  end if;
  if length(btrim(coalesce(p_subject, ''))) not between 3 and 120 then
    raise exception 'Subject must be 3 to 120 characters';
  end if;
  if length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Notes cannot exceed 2000 characters';
  end if;
  if p_preferred_start < now() + interval '1 hour'
     or p_preferred_start > now() + interval '180 days' then
    raise exception 'Preferred time must be between one hour and 180 days from now';
  end if;
  if p_alternate_start is not null and (
    p_alternate_start < now() + interval '1 hour'
    or p_alternate_start > now() + interval '180 days'
    or p_alternate_start = p_preferred_start
  ) then
    raise exception 'Alternate time must be different and between one hour and 180 days from now';
  end if;
  if length(btrim(coalesce(p_timezone, ''))) not between 3 and 80 then
    raise exception 'Invalid timezone';
  end if;

  select count(*)::integer
    into v_pending_count
    from public.client_meeting_requests r
   where r.client_id = v_client_id
     and r.status in ('pending', 'confirmed');

  if v_pending_count >= 3 then
    raise exception 'You already have three open meeting requests';
  end if;

  insert into public.client_meeting_requests (
    client_id,
    requested_by,
    request_type,
    subject,
    notes,
    contact_method,
    preferred_start,
    alternate_start,
    timezone
  ) values (
    v_client_id,
    v_uid,
    p_request_type,
    btrim(p_subject),
    nullif(btrim(p_notes), ''),
    p_contact_method,
    p_preferred_start,
    p_alternate_start,
    btrim(p_timezone)
  )
  returning * into v_request;

  return v_request;
end;
$$;

create or replace function public.client_cancel_meeting_request(p_request_id uuid)
returns public.client_meeting_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_client_id uuid := public.current_client_id();
  v_request public.client_meeting_requests;
begin
  if v_uid is null or v_client_id is null then
    raise exception 'A linked client portal account is required' using errcode = '42501';
  end if;

  update public.client_meeting_requests
     set status = 'cancelled',
         cancelled_at = now()
   where id = p_request_id
     and client_id = v_client_id
     and requested_by = v_uid
     and status = 'pending'
  returning * into v_request;

  if not found then
    raise exception 'Only your pending meeting request can be cancelled' using errcode = '42501';
  end if;

  return v_request;
end;
$$;

revoke all on function public.client_create_meeting_request(text,text,text,text,timestamptz,timestamptz,text) from public, anon;
revoke all on function public.client_cancel_meeting_request(uuid) from public, anon;
grant execute on function public.client_create_meeting_request(text,text,text,text,timestamptz,timestamptz,text) to authenticated, service_role;
grant execute on function public.client_cancel_meeting_request(uuid) to authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'client_meeting_requests'
       and policyname = 'client_meeting_requests_client_select_own'
       and roles = array['authenticated']::name[]
  ) then
    raise exception 'Client meeting request ownership policy missing';
  end if;

  if has_table_privilege('authenticated', 'public.client_meeting_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.client_meeting_requests', 'DELETE') then
    raise exception 'Client meeting request direct writes must stay blocked';
  end if;

  if has_function_privilege('anon', 'public.client_create_meeting_request(text,text,text,text,timestamptz,timestamptz,text)', 'execute')
     or has_function_privilege('anon', 'public.client_cancel_meeting_request(uuid)', 'execute') then
    raise exception 'Anonymous meeting request RPC access detected';
  end if;
end;
$$;

notify pgrst, 'reload schema';
