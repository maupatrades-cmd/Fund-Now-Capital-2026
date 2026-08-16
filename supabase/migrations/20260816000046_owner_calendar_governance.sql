-- Owner calendar governance: one schedule, privacy-safe role visibility,
-- idempotent booking decisions, linked Owner tasks and durable delivery.
-- Extends owner_availability_slots, crm_bookings and owner_tasks.

alter table public.crm_bookings
  add column if not exists lead_id uuid references public.leads(id) on delete set null,
  add column if not exists request_idempotency_key text,
  add column if not exists owner_task_id uuid references public.owner_tasks(id) on delete set null;

alter table public.crm_bookings drop constraint if exists crm_bookings_booking_type_check;
alter table public.crm_bookings add constraint crm_bookings_booking_type_check check (
  booking_type in (
    'urgent','submission','submission_update','consultation',
    'presentation','call','paperwork_review'
  )
) not valid;
alter table public.crm_bookings add constraint crm_bookings_request_idempotency_key_check
check (request_idempotency_key is null or length(btrim(request_idempotency_key)) between 8 and 120) not valid;

create unique index if not exists crm_bookings_request_idempotency_idx
  on public.crm_bookings(requester_id,request_idempotency_key)
  where request_idempotency_key is not null;
create index if not exists crm_bookings_lead_idx
  on public.crm_bookings(lead_id,created_at desc) where lead_id is not null;

alter table public.owner_availability_slots alter column allowed_booking_types
  set default array['urgent','submission','submission_update','consultation']::text[];

create table public.owner_calendar_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (length(btrim(title)) between 3 and 160),
  category text not null check (category in ('urgent','submission','submission_update','consultation')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Africa/Johannesburg',
  visibility text not null default 'private' check (visibility in ('private','busy','public')),
  public_title text check (public_title is null or length(btrim(public_title)) between 3 and 120),
  private_notes text check (private_notes is null or length(private_notes)<=4000),
  client_id uuid references public.clients(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  task_id uuid references public.owner_tasks(id) on delete set null,
  booking_id uuid unique references public.crm_bookings(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at>starts_at),
  check (visibility<>'public' or public_title is not null)
);

alter table public.owner_calendar_events add constraint owner_calendar_events_no_overlap
exclude using gist (
  owner_id with =,
  tstzrange(starts_at,ends_at,'[)') with &&
) where (status='scheduled');

create index owner_calendar_events_window_idx
  on public.owner_calendar_events(starts_at,ends_at) where status='scheduled';
create unique index owner_calendar_events_task_idx
  on public.owner_calendar_events(task_id) where task_id is not null;

alter table public.crm_bookings add column if not exists calendar_event_id uuid
  references public.owner_calendar_events(id) on delete set null;
create unique index if not exists crm_bookings_calendar_event_idx
  on public.crm_bookings(calendar_event_id) where calendar_event_id is not null;

create trigger owner_calendar_events_updated_at
before update on public.owner_calendar_events
for each row execute function public.set_updated_at();

alter table public.owner_calendar_events enable row level security;
revoke all on table public.owner_calendar_events from public,anon,authenticated;
grant select on table public.owner_calendar_events to authenticated;
grant all on table public.owner_calendar_events to service_role;
create policy owner_calendar_events_owner_read on public.owner_calendar_events
  for select to authenticated using ((select public.is_owner()));

create table public.booking_confirmation_outbox (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.crm_bookings(id) on delete cascade,
  recipient_email text,
  recipient_name text,
  status text not null default 'queued' check (status in ('queued','processing','sent','failed','skipped')),
  attempts integer not null default 0 check (attempts>=0),
  external_id text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status='skipped' and recipient_email is null) or (status<>'skipped' and recipient_email is not null)),
  check ((status='sent' and sent_at is not null) or status<>'sent')
);
create index booking_confirmation_outbox_pending_idx
  on public.booking_confirmation_outbox(status,created_at) where status in ('queued','failed');
create trigger booking_confirmation_outbox_updated_at
before update on public.booking_confirmation_outbox
for each row execute function public.set_updated_at();

alter table public.booking_confirmation_outbox enable row level security;
revoke all on table public.booking_confirmation_outbox from public,anon,authenticated;
grant select on table public.booking_confirmation_outbox to authenticated;
grant all on table public.booking_confirmation_outbox to service_role;
create policy booking_confirmation_outbox_owner_read on public.booking_confirmation_outbox
  for select to authenticated using ((select public.is_owner()));

-- Value-free audit: never snapshot agenda, notes or recipient data.
create or replace function public.log_calendar_activity()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_role text;
  v_event public.activity_event_type;
  v_entity_type text;
  v_changed jsonb;
  v_row jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  if v_uid is not null then
    select p.email,p.role::text into v_email,v_role from public.profiles p where p.id=v_uid;
  end if;
  v_event := case tg_op when 'INSERT' then 'CREATE'::public.activity_event_type
    when 'DELETE' then 'DELETE'::public.activity_event_type else 'UPDATE'::public.activity_event_type end;
  v_entity_type := case tg_table_name when 'crm_bookings' then 'crm_booking' else 'owner_calendar_event' end;
  if tg_op='UPDATE' then
    select jsonb_agg(k order by k) into v_changed from jsonb_object_keys(to_jsonb(new)) k
    where to_jsonb(new)->k is distinct from to_jsonb(old)->k
      and k not in ('updated_at','title','public_title','private_notes','agenda','owner_note');
  end if;
  insert into public.activity_logs(
    user_id,user_email,user_role,event_type,entity_type,entity_id,
    description,changed_fields,related_entity_ids
  ) values (
    v_uid,v_email,v_role,v_event,v_entity_type,(v_row->>'id')::uuid,
    v_entity_type||case tg_op when 'INSERT' then ' created' when 'DELETE' then ' deleted' else ' updated' end,
    v_changed,jsonb_strip_nulls(jsonb_build_object(
      'client_id',v_row->>'client_id','lead_id',v_row->>'lead_id','deal_id',v_row->>'deal_id',
      'booking_id',case when tg_table_name='crm_bookings' then v_row->>'id' else v_row->>'booking_id' end
    ))
  );
  return null;
end;
$$;

create or replace function public.calendar_is_consultation_window(
  p_starts_at timestamptz,p_ends_at timestamptz
) returns boolean language sql immutable set search_path='' as $$
  select (p_starts_at at time zone 'Africa/Johannesburg')::date=(p_ends_at at time zone 'Africa/Johannesburg')::date
    and (p_starts_at at time zone 'Africa/Johannesburg')::time>=time '14:00'
    and (p_ends_at at time zone 'Africa/Johannesburg')::time<=time '20:00'
    and p_ends_at>p_starts_at;
$$;

create or replace function public.calendar_reference_is_visible(
  p_client_id uuid default null,p_lead_id uuid default null,p_deal_id uuid default null
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid:=(select auth.uid()); v_client uuid:=public.current_client_id();
  v_partner uuid:=public.current_partner_id();
begin
  if v_uid is null or not exists(select 1 from public.profiles p where p.id=v_uid and p.is_active) then return false; end if;
  if public.is_owner() then return
    (p_client_id is null or exists(select 1 from public.clients c where c.id=p_client_id)) and
    (p_lead_id is null or exists(select 1 from public.leads l where l.id=p_lead_id)) and
    (p_deal_id is null or exists(select 1 from public.deals d where d.id=p_deal_id)); end if;
  if p_client_id is not null and not exists(select 1 from public.clients c where c.id=p_client_id and (
    c.id=v_client or c.referral_partner_id=v_partner or exists(select 1 from public.deals d
      where d.client_id=c.id and d.lead_id is not null and coalesce(public.caller_owns_lead(d.lead_id),false)))) then return false; end if;
  if p_lead_id is not null and not exists(select 1 from public.leads l where l.id=p_lead_id and (
    l.entered_by=v_uid or l.referral_partner_id=v_partner or coalesce(public.caller_owns_lead(l.id),false)
    or exists(select 1 from public.deals d where d.lead_id=l.id and d.client_id=v_client))) then return false; end if;
  if p_deal_id is not null and not exists(select 1 from public.deals d where d.id=p_deal_id and (
    d.client_id=v_client or d.referral_partner_id=v_partner
    or (d.lead_id is not null and coalesce(public.caller_owns_lead(d.lead_id),false)))) then return false; end if;
  return true;
end; $$;
revoke all on function public.calendar_reference_is_visible(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.owner_update_calendar_event(
  p_event_id uuid,p_title text,p_category text,p_starts_at timestamptz,p_ends_at timestamptz,
  p_visibility text default 'private',p_public_title text default null,p_private_notes text default null,
  p_client_id uuid default null,p_lead_id uuid default null,p_deal_id uuid default null
) returns public.owner_calendar_events language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid()); v_event public.owner_calendar_events%rowtype;
begin
  if not public.is_owner() then raise exception 'Only the owner can update calendar events' using errcode='42501'; end if;
  select * into v_event from public.owner_calendar_events where id=p_event_id and owner_id=v_owner for update;
  if not found then raise exception 'Calendar event not found'; end if;
  if v_event.booking_id is not null then raise exception 'Booking events are managed from booking decisions'; end if;
  if v_event.status<>'scheduled' then raise exception 'Only scheduled events can be edited'; end if;
  if length(btrim(coalesce(p_title,''))) not between 3 and 160 then raise exception 'Event title must be 3 to 160 characters'; end if;
  if p_category not in ('urgent','submission','submission_update','consultation') then raise exception 'Unsupported event category'; end if;
  if p_visibility not in ('private','busy','public') then raise exception 'Unsupported event visibility'; end if;
  if p_visibility='public' and length(btrim(coalesce(p_public_title,''))) not between 3 and 120 then raise exception 'A public event requires a safe public title'; end if;
  if p_ends_at<=p_starts_at or p_starts_at<=now() or p_ends_at-p_starts_at>interval '12 hours' then raise exception 'Event must be a future positive interval no longer than twelve hours'; end if;
  if p_category='consultation' and not public.calendar_is_consultation_window(p_starts_at,p_ends_at) then raise exception 'Consultations must be between 14:00 and 20:00 Africa/Johannesburg on one day'; end if;
  if not public.calendar_reference_is_visible(p_client_id,p_lead_id,p_deal_id) then raise exception 'One or more CRM references are unavailable' using errcode='42501'; end if;
  if p_deal_id is not null and not exists(select 1 from public.deals d where d.id=p_deal_id
    and (p_client_id is null or d.client_id=p_client_id) and (p_lead_id is null or d.lead_id=p_lead_id)) then raise exception 'Deal does not match the selected client or lead'; end if;
  perform pg_advisory_xact_lock(hashtext('owner-calendar:'||v_owner::text));
  if exists(select 1 from public.owner_calendar_events e where e.owner_id=v_owner and e.id<>p_event_id
    and e.status='scheduled' and tstzrange(e.starts_at,e.ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)')) then raise exception 'Event overlaps the Owner calendar'; end if;
  if exists(select 1 from public.crm_bookings b join public.owner_availability_slots s on s.id=b.slot_id
    where b.status in ('requested','confirmed') and tstzrange(s.starts_at,s.ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)')) then raise exception 'Event overlaps an active booking'; end if;
  update public.owner_availability_slots s set is_open=false where s.owner_id=v_owner and s.is_open
    and tstzrange(s.starts_at,s.ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)');
  update public.owner_calendar_events set title=btrim(p_title),category=p_category,starts_at=p_starts_at,ends_at=p_ends_at,
    visibility=p_visibility,public_title=case when p_visibility='public' then btrim(p_public_title) else null end,
    private_notes=nullif(btrim(p_private_notes),''),client_id=p_client_id,lead_id=p_lead_id,deal_id=p_deal_id
    where id=p_event_id returning * into v_event;
  if v_event.task_id is not null then update public.owner_tasks set title=left('Meeting: '||btrim(p_title),160),
    notes=nullif(btrim(p_private_notes),''),due_at=p_starts_at,priority=case when p_category='urgent' then 'high' else 'normal' end,
    client_id=p_client_id,lead_id=p_lead_id,deal_id=p_deal_id where id=v_event.task_id and status in ('open','in_progress','blocked'); end if;
  return v_event;
end; $$;

create or replace function public.owner_set_calendar_event_status(p_event_id uuid,p_status text)
returns public.owner_calendar_events language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=(select auth.uid()); v_event public.owner_calendar_events%rowtype;
begin
  if not public.is_owner() then raise exception 'Only the owner can update calendar events' using errcode='42501'; end if;
  if p_status not in ('completed','cancelled') then raise exception 'Unsupported calendar event status'; end if;
  select * into v_event from public.owner_calendar_events where id=p_event_id and owner_id=v_uid for update;
  if not found then raise exception 'Calendar event not found'; end if;
  if v_event.booking_id is not null then raise exception 'Booking events are managed from booking decisions'; end if;
  if v_event.status=p_status then return v_event; end if;
  if v_event.status<>'scheduled' then raise exception 'Calendar event is no longer scheduled'; end if;
  update public.owner_calendar_events set status=p_status where id=p_event_id returning * into v_event;
  if v_event.task_id is not null then update public.owner_tasks set status=p_status,
    completed_at=case when p_status='completed' then now() else null end,
    completed_by=case when p_status='completed' then v_uid else null end,blocker_reason=null
    where id=v_event.task_id and status not in ('completed','cancelled'); end if;
  return v_event;
end; $$;
revoke all on function public.log_calendar_activity() from public,anon,authenticated;
drop trigger if exists crm_bookings_activity on public.crm_bookings;
create trigger crm_bookings_activity after insert or update on public.crm_bookings
  for each row execute function public.log_calendar_activity();
create trigger owner_calendar_events_activity after insert or update on public.owner_calendar_events
  for each row execute function public.log_calendar_activity();

create or replace function public.calendar_is_consultation_window(
  p_starts_at timestamptz,p_ends_at timestamptz
) returns boolean language sql immutable set search_path='' as $$
  select
    (p_starts_at at time zone 'Africa/Johannesburg')::date=(p_ends_at at time zone 'Africa/Johannesburg')::date
    and (p_starts_at at time zone 'Africa/Johannesburg')::time>=time '14:00'
    and (p_ends_at at time zone 'Africa/Johannesburg')::time<=time '20:00'
    and p_ends_at>p_starts_at;
$$;
revoke all on function public.calendar_is_consultation_window(timestamptz,timestamptz)
  from public,anon,authenticated;

create or replace function public.invoke_send_booking_confirmation(p_delivery_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_base_url text; v_secret text;
begin
  select decrypted_secret into v_base_url from vault.decrypted_secrets where name='edge_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='webhook_secret';
  if v_base_url is null or v_secret is null then return; end if;
  begin
    perform net.http_post(
      url:=rtrim(v_base_url,'/')||'/functions/v1/send-booking-confirmation',
      headers:=jsonb_build_object('Content-Type','application/json','X-Webhook-Secret',v_secret),
      body:=jsonb_build_object('delivery_id',p_delivery_id)
    );
  exception when others then
    raise warning 'invoke_send_booking_confirmation failed for %: %',p_delivery_id,sqlerrm;
  end;
end;
$$;
revoke all on function public.invoke_send_booking_confirmation(uuid) from public,anon,authenticated;

create or replace function public.claim_booking_confirmation_delivery(p_delivery_id uuid)
returns public.booking_confirmation_outbox
language plpgsql security definer set search_path='' as $$
declare v_delivery public.booking_confirmation_outbox%rowtype;
begin
  update public.booking_confirmation_outbox
  set status='processing',attempts=attempts+1,error_message=null
  where id=p_delivery_id and status in ('queued','failed') and attempts<5
  returning * into v_delivery;
  if not found then raise exception 'Delivery is not claimable'; end if;
  return v_delivery;
end;
$$;

create or replace function public.record_booking_confirmation_delivery_result(
  p_delivery_id uuid,p_status text,p_external_id text default null,p_error_message text default null
) returns public.booking_confirmation_outbox
language plpgsql security definer set search_path='' as $$
declare v_delivery public.booking_confirmation_outbox%rowtype;
begin
  if p_status not in ('sent','failed') then raise exception 'Unsupported delivery result'; end if;
  update public.booking_confirmation_outbox set
    status=p_status,external_id=nullif(btrim(p_external_id),''),
    error_message=case when p_status='failed' then left(nullif(btrim(p_error_message),''),1000) else null end,
    sent_at=case when p_status='sent' then now() else null end
  where id=p_delivery_id and status='processing' returning * into v_delivery;
  if not found then raise exception 'Delivery is not processing'; end if;
  return v_delivery;
end;
$$;
revoke all on function public.claim_booking_confirmation_delivery(uuid) from public,anon,authenticated;
revoke all on function public.record_booking_confirmation_delivery_result(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_booking_confirmation_delivery(uuid) to service_role;
grant execute on function public.record_booking_confirmation_delivery_result(uuid,text,text,text) to service_role;

create or replace function public.owner_publish_availability(
  p_starts_at timestamptz,p_ends_at timestamptz,p_allowed_booking_types text[]
) returns public.owner_availability_slots
language plpgsql security definer set search_path='' as $$
declare v_slot public.owner_availability_slots%rowtype; v_owner uuid:=(select auth.uid());
begin
  if not public.is_owner() then raise exception 'Only the owner can publish availability' using errcode='42501'; end if;
  if p_ends_at<=p_starts_at or p_starts_at<=now() then raise exception 'Availability must be a future positive interval'; end if;
  if p_ends_at-p_starts_at>interval '8 hours' then raise exception 'Availability cannot exceed eight hours'; end if;
  if p_allowed_booking_types is null or cardinality(p_allowed_booking_types)=0
     or not (p_allowed_booking_types<@array[
       'urgent','submission','submission_update','consultation','presentation','call','paperwork_review'
     ]::text[]) then raise exception 'Unsupported booking type'; end if;
  if 'consultation'=any(p_allowed_booking_types)
     and not public.calendar_is_consultation_window(p_starts_at,p_ends_at) then
    raise exception 'Consultation availability must be between 14:00 and 20:00 Africa/Johannesburg on one day';
  end if;
  perform pg_advisory_xact_lock(hashtext('owner-calendar:'||v_owner::text));
  if exists(select 1 from public.owner_calendar_events e
    where e.owner_id=v_owner and e.status='scheduled'
      and tstzrange(e.starts_at,e.ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)')) then
    raise exception 'Availability overlaps an Owner calendar event';
  end if;
  if exists(select 1 from public.owner_availability_slots s
    where s.owner_id=v_owner and s.is_open
      and tstzrange(s.starts_at,s.ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)')) then
    raise exception 'Availability overlaps an existing open slot';
  end if;
  insert into public.owner_availability_slots(owner_id,starts_at,ends_at,allowed_booking_types)
  values(v_owner,p_starts_at,p_ends_at,array(select distinct unnest(p_allowed_booking_types)))
  returning * into v_slot;
  return v_slot;
end;
$$;

create or replace function public.owner_create_calendar_event(
  p_title text,p_category text,p_starts_at timestamptz,p_ends_at timestamptz,
  p_visibility text default 'private',p_public_title text default null,
  p_private_notes text default null,p_client_id uuid default null,p_lead_id uuid default null,
  p_deal_id uuid default null,p_create_task boolean default true
) returns public.owner_calendar_events
language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid:=(select auth.uid());
  v_task public.owner_tasks%rowtype;
  v_event public.owner_calendar_events%rowtype;
begin
  if not public.is_owner() then raise exception 'Only the owner can create calendar events' using errcode='42501'; end if;
  if length(btrim(coalesce(p_title,''))) not between 3 and 160 then raise exception 'Event title must be 3 to 160 characters'; end if;
  if p_category not in ('urgent','submission','submission_update','consultation') then raise exception 'Unsupported event category'; end if;
  if p_visibility not in ('private','busy','public') then raise exception 'Unsupported event visibility'; end if;
  if p_visibility='public' and length(btrim(coalesce(p_public_title,''))) not between 3 and 120 then
    raise exception 'A public event requires a safe public title';
  end if;
  if p_ends_at<=p_starts_at or p_starts_at<=now() or p_ends_at-p_starts_at>interval '12 hours' then
    raise exception 'Event must be a future positive interval no longer than twelve hours';
  end if;
  if p_category='consultation' and not public.calendar_is_consultation_window(p_starts_at,p_ends_at) then
    raise exception 'Consultations must be between 14:00 and 20:00 Africa/Johannesburg on one day';
  end if;
  if p_client_id is not null and not exists(select 1 from public.clients where id=p_client_id) then raise exception 'Client not found'; end if;
  if p_lead_id is not null and not exists(select 1 from public.leads where id=p_lead_id) then raise exception 'Lead not found'; end if;
  if p_deal_id is not null and not exists(select 1 from public.deals d where d.id=p_deal_id
      and (p_client_id is null or d.client_id=p_client_id) and (p_lead_id is null or d.lead_id=p_lead_id)) then
    raise exception 'Deal does not match the selected client or lead';
  end if;
  perform pg_advisory_xact_lock(hashtext('owner-calendar:'||v_owner::text));
  if exists(select 1 from public.owner_calendar_events e where e.owner_id=v_owner and e.status='scheduled'
      and tstzrange(e.starts_at,e.ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)')) then
    raise exception 'Event overlaps the Owner calendar';
  end if;
  if exists(select 1 from public.crm_bookings b join public.owner_availability_slots s on s.id=b.slot_id
    where b.status in ('requested','confirmed')
      and tstzrange(s.starts_at,s.ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)')) then
    raise exception 'Event overlaps an active booking';
  end if;
  update public.owner_availability_slots s set is_open=false
  where s.owner_id=v_owner and s.is_open
    and tstzrange(s.starts_at,s.ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)');
  if coalesce(p_create_task,true) then
    insert into public.owner_tasks(
      title,notes,due_at,priority,client_id,lead_id,deal_id,assigned_to,created_by,task_kind
    ) values (
      left('Meeting: '||btrim(p_title),160),nullif(btrim(p_private_notes),''),p_starts_at,
      case when p_category='urgent' then 'high' else 'normal' end,
      p_client_id,p_lead_id,p_deal_id,v_owner,v_owner,'meeting'
    ) returning * into v_task;
  end if;
  insert into public.owner_calendar_events(
    owner_id,title,category,starts_at,ends_at,visibility,public_title,private_notes,
    client_id,lead_id,deal_id,task_id,created_by
  ) values (
    v_owner,btrim(p_title),p_category,p_starts_at,p_ends_at,p_visibility,
    case when p_visibility='public' then btrim(p_public_title) else null end,
    nullif(btrim(p_private_notes),''),p_client_id,p_lead_id,p_deal_id,v_task.id,v_owner
  ) returning * into v_event;
  return v_event;
end;
$$;

create or replace function public.booking_portal_workspace(
  p_window_start timestamptz default now(),
  p_window_end timestamptz default now()+interval '30 days'
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid:=(select auth.uid()); v_role text; v_owner boolean;
  v_open_slots jsonb; v_blocks jsonb; v_bookings jsonb; v_refs jsonb;
begin
  select p.role::text,public.is_owner() into v_role,v_owner from public.profiles p where p.id=v_uid and p.is_active;
  if v_role is null or v_role not in ('owner','partner','contractor','lead_referrer','client') then raise exception 'Active CRM role required' using errcode='42501'; end if;
  if p_window_end<=p_window_start or p_window_end-p_window_start>interval '90 days' then raise exception 'Calendar window must be positive and no longer than 90 days'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'starts_at',s.starts_at,'ends_at',s.ends_at,
    'timezone',s.timezone,'allowed_booking_types',s.allowed_booking_types) order by s.starts_at),'[]'::jsonb)
    into v_open_slots from public.owner_availability_slots s
    where s.is_open and s.starts_at>=greatest(now(),p_window_start) and s.starts_at<p_window_end;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'starts_at',e.starts_at,'ends_at',e.ends_at,
    'category',e.category,'display_title',case when v_owner then e.title when e.visibility='public' then e.public_title else 'Busy' end,
    'visibility',case when v_owner then e.visibility when e.visibility='public' then 'public' else 'busy' end)
    order by e.starts_at),'[]'::jsonb) into v_blocks from public.owner_calendar_events e
    where e.status='scheduled' and e.ends_at>p_window_start and e.starts_at<p_window_end
      and (v_owner or e.visibility in ('busy','public'));
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'slot_id',b.slot_id,'starts_at',s.starts_at,
    'ends_at',s.ends_at,'timezone',s.timezone,'booking_type',b.booking_type,'agenda',b.agenda,
    'status',b.status,'owner_note',b.owner_note,'client_id',b.client_id,'lead_id',b.lead_id,
    'deal_id',b.deal_id,'created_at',b.created_at) order by s.starts_at desc),'[]'::jsonb)
    into v_bookings from public.crm_bookings b join public.owner_availability_slots s on s.id=b.slot_id
    where v_owner or b.requester_id=v_uid;
  select coalesce(jsonb_agg(r.item order by r.sort_at desc),'[]'::jsonb) into v_refs from (
    select jsonb_build_object('reference_kind','client','reference_id',c.id,'display_name',c.business_name) item,c.created_at sort_at
      from public.clients c where public.calendar_reference_is_visible(c.id,null,null)
    union all
    select jsonb_build_object('reference_kind','lead','reference_id',l.id,'display_name',l.business_name),l.created_at
      from public.leads l where public.calendar_reference_is_visible(null,l.id,null)
    order by sort_at desc limit 200
  ) r;
  return jsonb_build_object('viewer_role',v_role,
    'consultation_window',jsonb_build_object('timezone','Africa/Johannesburg','starts_at','14:00','ends_at','20:00'),
    'open_slots',v_open_slots,'schedule_blocks',v_blocks,'my_bookings',v_bookings,'bookable_references',v_refs);
end; $$;

create or replace function public.request_owner_booking_v2(
  p_slot_id uuid,p_booking_type text,p_agenda text,p_client_id uuid default null,
  p_lead_id uuid default null,p_deal_id uuid default null,p_idempotency_key text default null
) returns public.crm_bookings language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=(select auth.uid()); v_role text; v_slot public.owner_availability_slots%rowtype;
  v_booking public.crm_bookings%rowtype; v_key text:=nullif(btrim(p_idempotency_key),'');
  v_client uuid:=p_client_id;
begin
  select p.role::text into v_role from public.profiles p where p.id=v_uid and p.is_active;
  if v_role is null or v_role not in ('owner','partner','contractor','lead_referrer','client') then raise exception 'Active CRM role required' using errcode='42501'; end if;
  if v_role='client' then
    if v_client is not null and v_client is distinct from public.current_client_id() then raise exception 'A client may book only for their own business' using errcode='42501'; end if;
    v_client:=public.current_client_id();
  end if;
  if v_client is null and p_lead_id is null then raise exception 'Select a client or lead for the meeting'; end if;
  if length(btrim(coalesce(p_agenda,''))) not between 3 and 1000 then raise exception 'A brief meeting reason is required'; end if;
  if v_key is not null and length(v_key) not between 8 and 120 then raise exception 'Idempotency key must be 8 to 120 characters'; end if;
  if v_key is not null then
    select * into v_booking from public.crm_bookings where requester_id=v_uid and request_idempotency_key=v_key;
    if found then
      if v_booking.slot_id is distinct from p_slot_id or v_booking.booking_type is distinct from p_booking_type
        or v_booking.client_id is distinct from v_client or v_booking.lead_id is distinct from p_lead_id
        or v_booking.deal_id is distinct from p_deal_id then raise exception 'Idempotency key is already used for a different booking'; end if;
      return v_booking;
    end if;
  end if;
  if not public.calendar_reference_is_visible(v_client,p_lead_id,p_deal_id) then raise exception 'One or more CRM references are unavailable' using errcode='42501'; end if;
  if p_deal_id is not null and not exists(select 1 from public.deals d where d.id=p_deal_id
    and (v_client is null or d.client_id=v_client) and (p_lead_id is null or d.lead_id=p_lead_id)) then raise exception 'Deal does not match the selected client or lead'; end if;
  select * into v_slot from public.owner_availability_slots where id=p_slot_id and is_open and starts_at>now() for update;
  if not found then raise exception 'Availability is no longer open'; end if;
  if not (p_booking_type=any(v_slot.allowed_booking_types)) then raise exception 'Booking type is not allowed for this slot'; end if;
  if p_booking_type='consultation' and not public.calendar_is_consultation_window(v_slot.starts_at,v_slot.ends_at) then raise exception 'Consultations must be between 14:00 and 20:00 Africa/Johannesburg'; end if;
  insert into public.crm_bookings(slot_id,requester_id,client_id,lead_id,deal_id,booking_type,agenda,request_idempotency_key)
    values(p_slot_id,v_uid,v_client,p_lead_id,p_deal_id,p_booking_type,btrim(p_agenda),v_key) returning * into v_booking;
  update public.owner_availability_slots set is_open=false where id=p_slot_id;
  return v_booking;
exception when unique_violation then
  if v_key is not null then select * into v_booking from public.crm_bookings where requester_id=v_uid and request_idempotency_key=v_key;
    if found then return v_booking; end if; end if; raise;
end; $$;

create or replace function public.request_owner_booking(
  p_slot_id uuid,p_booking_type text,p_agenda text,p_client_id uuid default null,p_deal_id uuid default null
) returns public.crm_bookings language sql security definer set search_path='' as $$
  select public.request_owner_booking_v2(p_slot_id,p_booking_type,p_agenda,p_client_id,null,p_deal_id,
    'legacy-'||md5(coalesce((select auth.uid())::text,'')||':'||p_slot_id::text||':'||p_booking_type));
$$;

create or replace function public.owner_decide_booking(
  p_booking_id uuid,p_status text,p_owner_note text default null
) returns public.crm_bookings language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=(select auth.uid()); v_booking public.crm_bookings%rowtype;
  v_slot public.owner_availability_slots%rowtype; v_task public.owner_tasks%rowtype;
  v_event public.owner_calendar_events%rowtype; v_delivery_id uuid; v_email text; v_name text;
  v_title text; v_client uuid; v_lead uuid;
begin
  if not public.is_owner() then raise exception 'Only the owner can decide bookings' using errcode='42501'; end if;
  if p_status not in ('confirmed','declined','completed') then raise exception 'Unsupported booking decision'; end if;
  select * into v_booking from public.crm_bookings where id=p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  select * into v_slot from public.owner_availability_slots where id=v_booking.slot_id for update;
  if p_status='declined' then
    if v_booking.status='declined' then return v_booking; end if;
    if v_booking.status<>'requested' then raise exception 'Only a requested booking can be declined'; end if;
    update public.crm_bookings set status='declined',owner_note=nullif(btrim(p_owner_note),''),
      decided_by=v_uid,decided_at=now() where id=p_booking_id returning * into v_booking;
    update public.owner_availability_slots set is_open=true where id=v_booking.slot_id and starts_at>now();
    return v_booking;
  end if;
  if p_status='completed' then
    if v_booking.status='completed' then return v_booking; end if;
    if v_booking.status<>'confirmed' then raise exception 'Only a confirmed booking can be completed'; end if;
    update public.crm_bookings set status='completed',owner_note=coalesce(nullif(btrim(p_owner_note),''),owner_note),
      decided_by=v_uid,decided_at=now() where id=p_booking_id returning * into v_booking;
    update public.owner_calendar_events set status='completed' where id=v_booking.calendar_event_id and status='scheduled';
    update public.owner_tasks set status='completed',completed_at=now(),completed_by=v_uid,blocker_reason=null
      where id=v_booking.owner_task_id and status not in ('completed','cancelled');
    return v_booking;
  end if;
  if v_booking.status not in ('requested','confirmed') then raise exception 'Booking cannot be confirmed from its current status'; end if;
  perform pg_advisory_xact_lock(hashtext('owner-calendar:'||v_uid::text));
  if v_booking.status='requested' then
    if exists(select 1 from public.owner_calendar_events e where e.owner_id=v_uid and e.status='scheduled'
      and tstzrange(e.starts_at,e.ends_at,'[)')&&tstzrange(v_slot.starts_at,v_slot.ends_at,'[)')) then raise exception 'Booking overlaps the Owner calendar'; end if;
    update public.crm_bookings set status='confirmed',owner_note=nullif(btrim(p_owner_note),''),decided_by=v_uid,decided_at=now()
      where id=p_booking_id returning * into v_booking;
  end if;
  v_client:=v_booking.client_id; v_lead:=v_booking.lead_id;
  if v_booking.deal_id is not null then select coalesce(v_client,d.client_id),coalesce(v_lead,d.lead_id)
    into v_client,v_lead from public.deals d where d.id=v_booking.deal_id; end if;
  select coalesce(c.business_name,l.business_name,'Client meeting') into v_title from (select 1) x
    left join public.clients c on c.id=v_client left join public.leads l on l.id=v_lead;
  if v_booking.owner_task_id is null then
    insert into public.owner_tasks(title,notes,due_at,priority,client_id,lead_id,deal_id,assigned_to,created_by,task_kind)
      values(left('Meeting: '||v_title||' - '||replace(initcap(v_booking.booking_type),'_',' '),160),v_booking.agenda,
        v_slot.starts_at,case when v_booking.booking_type='urgent' then 'high' else 'normal' end,
        v_client,v_lead,v_booking.deal_id,v_uid,v_uid,'meeting') returning * into v_task;
    update public.crm_bookings set owner_task_id=v_task.id where id=p_booking_id returning * into v_booking;
  else select * into v_task from public.owner_tasks where id=v_booking.owner_task_id; end if;
  if v_booking.calendar_event_id is null then
    insert into public.owner_calendar_events(owner_id,title,category,starts_at,ends_at,visibility,private_notes,
      client_id,lead_id,deal_id,task_id,booking_id,created_by)
      values(v_uid,left(v_title||' - '||replace(initcap(v_booking.booking_type),'_',' '),160),
        case when v_booking.booking_type in ('urgent','submission','submission_update','consultation') then v_booking.booking_type else 'consultation' end,
        v_slot.starts_at,v_slot.ends_at,'private',v_booking.agenda,v_client,v_lead,v_booking.deal_id,v_task.id,v_booking.id,v_uid)
      returning * into v_event;
    update public.crm_bookings set calendar_event_id=v_event.id where id=p_booking_id returning * into v_booking;
  end if;
  select cc.email,cc.full_name into v_email,v_name from public.client_contacts cc
    where cc.client_id=v_client and nullif(btrim(cc.email),'') is not null order by cc.is_primary_director desc,cc.created_at limit 1;
  if v_email is null and v_client is not null then select p.email,p.full_name into v_email,v_name from public.profiles p
    where p.client_id=v_client and p.is_active and nullif(btrim(p.email),'') is not null limit 1; end if;
  if v_email is null and v_lead is not null then select l.contact_email,l.contact_name into v_email,v_name from public.leads l where l.id=v_lead; end if;
  insert into public.booking_confirmation_outbox(booking_id,recipient_email,recipient_name,status)
    values(v_booking.id,nullif(btrim(v_email),''),nullif(btrim(v_name),''),
      case when nullif(btrim(v_email),'') is null then 'skipped' else 'queued' end)
    on conflict(booking_id) do nothing returning id into v_delivery_id;
  if v_delivery_id is not null and v_email is not null then perform public.invoke_send_booking_confirmation(v_delivery_id); end if;
  return v_booking;
end; $$;

revoke all on function public.owner_publish_availability(timestamptz,timestamptz,text[]) from public,anon,authenticated;
revoke all on function public.owner_create_calendar_event(text,text,timestamptz,timestamptz,text,text,text,uuid,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.owner_update_calendar_event(uuid,text,text,timestamptz,timestamptz,text,text,text,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.owner_set_calendar_event_status(uuid,text) from public,anon,authenticated;
revoke all on function public.booking_portal_workspace(timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.request_owner_booking_v2(uuid,text,text,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.request_owner_booking(uuid,text,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.owner_decide_booking(uuid,text,text) from public,anon,authenticated;
grant execute on function public.owner_publish_availability(timestamptz,timestamptz,text[]) to authenticated,service_role;
grant execute on function public.owner_create_calendar_event(text,text,timestamptz,timestamptz,text,text,text,uuid,uuid,uuid,boolean) to authenticated,service_role;
grant execute on function public.owner_update_calendar_event(uuid,text,text,timestamptz,timestamptz,text,text,text,uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.owner_set_calendar_event_status(uuid,text) to authenticated,service_role;
grant execute on function public.booking_portal_workspace(timestamptz,timestamptz) to authenticated,service_role;
grant execute on function public.request_owner_booking_v2(uuid,text,text,uuid,uuid,uuid,text) to authenticated,service_role;
grant execute on function public.request_owner_booking(uuid,text,text,uuid,uuid) to authenticated,service_role;
grant execute on function public.owner_decide_booking(uuid,text,text) to authenticated,service_role;

do $$ begin
  if has_table_privilege('authenticated','public.owner_calendar_events','INSERT,UPDATE,DELETE') then raise exception 'Calendar governance: direct event writes exposed'; end if;
  if has_table_privilege('authenticated','public.booking_confirmation_outbox','INSERT,UPDATE,DELETE') then raise exception 'Calendar governance: direct delivery writes exposed'; end if;
  if has_function_privilege('anon','public.booking_portal_workspace(timestamptz,timestamptz)','execute')
    or has_function_privilege('anon','public.request_owner_booking_v2(uuid,text,text,uuid,uuid,uuid,text)','execute')
    or has_function_privilege('anon','public.owner_decide_booking(uuid,text,text)','execute') then raise exception 'Calendar governance: anonymous API exposed'; end if;
  if not has_function_privilege('authenticated','public.booking_portal_workspace(timestamptz,timestamptz)','execute')
    or not has_function_privilege('authenticated','public.request_owner_booking_v2(uuid,text,text,uuid,uuid,uuid,text)','execute') then raise exception 'Calendar governance: authenticated API missing'; end if;
end; $$;

notify pgrst,'reload schema';
