-- Booking usability correction:
-- * only presentations use the 14:00-20:00 SAST window;
-- * a booking may be standalone when a client/person name is supplied;
-- * lead-originated client invitations retain their source lead;
-- * Owner event creation remains atomic with its optional task.

alter table public.crm_bookings
  add column if not exists client_name text;

alter table public.crm_bookings
  add constraint crm_bookings_client_name_check
  check (client_name is null or length(btrim(client_name)) between 2 and 160) not valid;

alter table public.client_quick_invitations
  add column if not exists source_lead_id uuid references public.leads(id) on delete set null;

create index if not exists client_quick_invitations_source_lead_idx
  on public.client_quick_invitations(source_lead_id, created_at desc)
  where source_lead_id is not null;

-- Retain the old helper only as a compatibility shim. Existing RPC bodies call
-- it for consultations; returning true removes that obsolete restriction.
create or replace function public.calendar_is_consultation_window(
  p_starts_at timestamptz,p_ends_at timestamptz
) returns boolean language sql immutable set search_path='' as $$
  select p_ends_at > p_starts_at;
$$;

create or replace function public.calendar_is_presentation_window(
  p_starts_at timestamptz,p_ends_at timestamptz
) returns boolean language sql immutable set search_path='' as $$
  select (p_starts_at at time zone 'Africa/Johannesburg')::date=(p_ends_at at time zone 'Africa/Johannesburg')::date
    and (p_starts_at at time zone 'Africa/Johannesburg')::time>=time '14:00'
    and (p_ends_at at time zone 'Africa/Johannesburg')::time<=time '20:00'
    and p_ends_at>p_starts_at;
$$;

revoke all on function public.calendar_is_presentation_window(timestamptz,timestamptz)
  from public,anon,authenticated;

create or replace function public.enforce_presentation_booking_window()
returns trigger language plpgsql set search_path='' as $$
declare v_starts_at timestamptz; v_ends_at timestamptz;
begin
  if tg_table_name='owner_availability_slots' then
    if 'presentation'=any(new.allowed_booking_types)
       and not public.calendar_is_presentation_window(new.starts_at,new.ends_at) then
      raise exception 'Presentation availability must be between 14:00 and 20:00 Africa/Johannesburg on one day';
    end if;
  elsif tg_table_name='owner_calendar_events' then
    if new.category='presentation'
       and not public.calendar_is_presentation_window(new.starts_at,new.ends_at) then
      raise exception 'Presentations must be between 14:00 and 20:00 Africa/Johannesburg on one day';
    end if;
  elsif tg_table_name='crm_bookings' and new.booking_type='presentation' then
    select s.starts_at,s.ends_at into v_starts_at,v_ends_at
      from public.owner_availability_slots s where s.id=new.slot_id;
    if not public.calendar_is_presentation_window(v_starts_at,v_ends_at) then
      raise exception 'Presentations must be between 14:00 and 20:00 Africa/Johannesburg';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_presentation_booking_window() from public,anon,authenticated;

drop trigger if exists owner_availability_presentation_window on public.owner_availability_slots;
create trigger owner_availability_presentation_window
before insert or update of starts_at,ends_at,allowed_booking_types on public.owner_availability_slots
for each row execute function public.enforce_presentation_booking_window();

drop trigger if exists owner_event_presentation_window on public.owner_calendar_events;
create trigger owner_event_presentation_window
before insert or update of starts_at,ends_at,category on public.owner_calendar_events
for each row execute function public.enforce_presentation_booking_window();

drop trigger if exists crm_booking_presentation_window on public.crm_bookings;
create trigger crm_booking_presentation_window
before insert or update of slot_id,booking_type on public.crm_bookings
for each row execute function public.enforce_presentation_booking_window();

-- Replace the Owner create RPC to make the optional task ID scalar and avoid
-- dereferencing an unassigned composite record when task creation is disabled.
create or replace function public.owner_create_calendar_event(
  p_title text,p_category text,p_starts_at timestamptz,p_ends_at timestamptz,
  p_visibility text default 'private',p_public_title text default null,
  p_private_notes text default null,p_client_id uuid default null,p_lead_id uuid default null,
  p_deal_id uuid default null,p_create_task boolean default true
) returns public.owner_calendar_events
language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid()); v_task_id uuid; v_event public.owner_calendar_events%rowtype;
begin
  if not public.is_owner() then raise exception 'Only the owner can create calendar events' using errcode='42501'; end if;
  if length(btrim(coalesce(p_title,''))) not between 3 and 160 then raise exception 'Event title must be 3 to 160 characters'; end if;
  if p_category not in ('urgent','submission','submission_update','consultation','presentation','call','paperwork_review') then raise exception 'Unsupported event category'; end if;
  if p_visibility not in ('private','busy','public') then raise exception 'Unsupported event visibility'; end if;
  if p_visibility='public' and length(btrim(coalesce(p_public_title,''))) not between 3 and 120 then raise exception 'A public event requires a safe public title'; end if;
  if p_ends_at<=p_starts_at or p_starts_at<=now() or p_ends_at-p_starts_at>interval '12 hours' then raise exception 'Event must be a future positive interval no longer than twelve hours'; end if;
  if p_category='presentation' and not public.calendar_is_presentation_window(p_starts_at,p_ends_at) then raise exception 'Presentations must be between 14:00 and 20:00 Africa/Johannesburg on one day'; end if;
  if not public.calendar_reference_is_visible(p_client_id,p_lead_id,p_deal_id) then raise exception 'One or more CRM references are unavailable' using errcode='42501'; end if;
  if p_deal_id is not null and not exists(select 1 from public.deals d where d.id=p_deal_id
    and (p_client_id is null or d.client_id=p_client_id) and (p_lead_id is null or d.lead_id=p_lead_id)) then raise exception 'Deal does not match the selected client or lead'; end if;
  perform pg_advisory_xact_lock(hashtext('owner-calendar:'||v_owner::text));
  if exists(select 1 from public.owner_calendar_events e where e.owner_id=v_owner and e.status='scheduled'
    and tstzrange(e.starts_at,e.ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)')) then raise exception 'Event overlaps the Owner calendar'; end if;
  if exists(select 1 from public.crm_bookings b join public.owner_availability_slots s on s.id=b.slot_id
    where b.status in ('requested','confirmed') and tstzrange(s.starts_at,s.ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)')) then raise exception 'Event overlaps an active booking'; end if;
  update public.owner_availability_slots s set is_open=false where s.owner_id=v_owner and s.is_open
    and tstzrange(s.starts_at,s.ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)');
  if coalesce(p_create_task,true) then
    insert into public.owner_tasks(title,notes,due_at,priority,client_id,lead_id,deal_id,assigned_to,created_by,task_kind)
    values(left('Meeting: '||btrim(p_title),160),nullif(btrim(p_private_notes),''),p_starts_at,
      case when p_category='urgent' then 'high' else 'normal' end,p_client_id,p_lead_id,p_deal_id,v_owner,v_owner,'meeting')
    returning id into v_task_id;
  end if;
  insert into public.owner_calendar_events(owner_id,title,category,starts_at,ends_at,visibility,public_title,
    private_notes,client_id,lead_id,deal_id,task_id,created_by)
  values(v_owner,btrim(p_title),p_category,p_starts_at,p_ends_at,p_visibility,
    case when p_visibility='public' then btrim(p_public_title) else null end,nullif(btrim(p_private_notes),''),
    p_client_id,p_lead_id,p_deal_id,v_task_id,v_owner) returning * into v_event;
  return v_event;
end;
$$;

create or replace function public.booking_portal_workspace(
  p_window_start timestamptz default now(),p_window_end timestamptz default now()+interval '30 days'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
    'category',case when v_owner or e.visibility='public' then e.category else null end,
    'display_title',case when v_owner then e.title when e.visibility='public' then e.public_title else 'Busy' end,
    'visibility',case when v_owner then e.visibility when e.visibility='public' then 'public' else 'busy' end)
    order by e.starts_at),'[]'::jsonb) into v_blocks from public.owner_calendar_events e
    where e.status='scheduled' and e.ends_at>p_window_start and e.starts_at<p_window_end and (v_owner or e.visibility in ('busy','public'));
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'slot_id',b.slot_id,'starts_at',s.starts_at,
    'ends_at',s.ends_at,'timezone',s.timezone,'booking_type',b.booking_type,'agenda',b.agenda,
    'client_name',b.client_name,'status',b.status,'owner_note',b.owner_note,'client_id',b.client_id,
    'lead_id',b.lead_id,'deal_id',b.deal_id,'created_at',b.created_at) order by s.starts_at desc),'[]'::jsonb)
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
    'presentation_window',jsonb_build_object('timezone','Africa/Johannesburg','starts_at','14:00','ends_at','20:00'),
    'open_slots',v_open_slots,'schedule_blocks',v_blocks,'my_bookings',v_bookings,'bookable_references',v_refs);
end;
$$;

create or replace function public.request_owner_booking_v3(
  p_slot_id uuid,p_booking_type text,p_agenda text,p_client_name text default null,
  p_client_id uuid default null,p_lead_id uuid default null,p_deal_id uuid default null,
  p_idempotency_key text default null
) returns public.crm_bookings language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=(select auth.uid()); v_role text; v_slot public.owner_availability_slots%rowtype;
  v_booking public.crm_bookings%rowtype; v_key text:=nullif(btrim(p_idempotency_key),''); v_client uuid:=p_client_id;
  v_name text:=nullif(btrim(p_client_name),'');
begin
  select p.role::text into v_role from public.profiles p where p.id=v_uid and p.is_active;
  if v_role is null or v_role not in ('owner','partner','contractor','lead_referrer','client') then raise exception 'Active CRM role required' using errcode='42501'; end if;
  if v_role='client' then
    if v_client is not null and v_client is distinct from public.current_client_id() then raise exception 'A client may book only for their own business' using errcode='42501'; end if;
    v_client:=public.current_client_id();
  end if;
  if v_client is null and p_lead_id is null and p_deal_id is null and v_name is null then raise exception 'Add a client or person name for a standalone booking'; end if;
  if v_name is not null and length(v_name) not between 2 and 160 then raise exception 'Client or person name must be 2 to 160 characters'; end if;
  if length(btrim(coalesce(p_agenda,''))) not between 3 and 1000 then raise exception 'A brief meeting purpose is required'; end if;
  if v_key is not null and length(v_key) not between 8 and 120 then raise exception 'Idempotency key must be 8 to 120 characters'; end if;
  if v_key is not null then
    select * into v_booking from public.crm_bookings where requester_id=v_uid and request_idempotency_key=v_key;
    if found then return v_booking; end if;
  end if;
  if not public.calendar_reference_is_visible(v_client,p_lead_id,p_deal_id) then raise exception 'One or more CRM references are unavailable' using errcode='42501'; end if;
  if p_deal_id is not null and not exists(select 1 from public.deals d where d.id=p_deal_id
    and (v_client is null or d.client_id=v_client) and (p_lead_id is null or d.lead_id=p_lead_id)) then raise exception 'Deal does not match the selected client or lead'; end if;
  select * into v_slot from public.owner_availability_slots where id=p_slot_id and is_open and starts_at>now() for update;
  if not found then raise exception 'Availability is no longer open'; end if;
  if not (p_booking_type=any(v_slot.allowed_booking_types)) then raise exception 'Booking type is not allowed for this slot'; end if;
  if p_booking_type='presentation' and not public.calendar_is_presentation_window(v_slot.starts_at,v_slot.ends_at) then raise exception 'Presentations must be between 14:00 and 20:00 Africa/Johannesburg'; end if;
  insert into public.crm_bookings(slot_id,requester_id,client_id,lead_id,deal_id,booking_type,agenda,client_name,request_idempotency_key)
    values(p_slot_id,v_uid,v_client,p_lead_id,p_deal_id,p_booking_type,btrim(p_agenda),v_name,v_key) returning * into v_booking;
  update public.owner_availability_slots set is_open=false where id=p_slot_id;
  return v_booking;
exception when unique_violation then
  if v_key is not null then select * into v_booking from public.crm_bookings where requester_id=v_uid and request_idempotency_key=v_key;
    if found then return v_booking; end if; end if; raise;
end;
$$;

-- Preserve the existing decision API while using a standalone name in the
-- linked task and event. Email delivery remains skipped when no CRM contact is linked.
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
    update public.crm_bookings set status='declined',owner_note=nullif(btrim(p_owner_note),''),decided_by=v_uid,decided_at=now()
      where id=p_booking_id returning * into v_booking;
    update public.owner_availability_slots set is_open=true where id=v_booking.slot_id and starts_at>now();
    return v_booking;
  end if;
  if p_status='completed' then
    if v_booking.status='completed' then return v_booking; end if;
    if v_booking.status<>'confirmed' then raise exception 'Only a confirmed booking can be completed'; end if;
    update public.crm_bookings set status='completed',owner_note=coalesce(nullif(btrim(p_owner_note),''),owner_note),decided_by=v_uid,decided_at=now()
      where id=p_booking_id returning * into v_booking;
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
  select coalesce(c.business_name,l.business_name,v_booking.client_name,'Client meeting') into v_title from (select 1) x
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
      values(v_uid,left(v_title||' - '||replace(initcap(v_booking.booking_type),'_',' '),160),v_booking.booking_type,
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
    values(v_booking.id,nullif(btrim(v_email),''),coalesce(nullif(btrim(v_name),''),v_booking.client_name),
      case when nullif(btrim(v_email),'') is null then 'skipped' else 'queued' end)
    on conflict(booking_id) do nothing returning id into v_delivery_id;
  if v_delivery_id is not null and v_email is not null then perform public.invoke_send_booking_confirmation(v_delivery_id); end if;
  return v_booking;
end;
$$;

create or replace function public.service_create_quick_client_invitation_for_lead(
  p_actor_id uuid,p_source_lead_id uuid,p_email text,p_contact_name text default null,
  p_phone text default null,p_business_name text default null
) returns table(invitation_id uuid,client_id uuid,client_contact_id uuid,business_name text,contact_name text,contact_email text)
language plpgsql security definer set search_path='' as $$
declare v_actor public.profiles%rowtype; v_lead public.leads%rowtype; v_result record;
begin
  select * into v_actor from public.profiles where id=p_actor_id and is_active
    and role in ('owner','partner','contractor','lead_referrer');
  if not found then raise exception 'This role cannot invite clients'; end if;
  select * into v_lead from public.leads where id=p_source_lead_id;
  if not found then raise exception 'Lead not found'; end if;
  if v_actor.role<>'owner' and not (
    v_lead.entered_by=v_actor.id
    or (v_actor.role='partner' and v_actor.referral_partner_id is not null and v_lead.referral_partner_id=v_actor.referral_partner_id)
    or (v_actor.role='contractor' and v_lead.attributed_to_contractor_id=v_actor.id)
    or (v_actor.role='lead_referrer' and coalesce(v_lead.attributed_to_lead_referrer_id,v_lead.original_referrer_id)=v_actor.id)
  ) then raise exception 'This lead is not attributed to your role' using errcode='42501'; end if;
  if nullif(btrim(v_lead.contact_email),'') is null or lower(btrim(v_lead.contact_email))<>lower(btrim(p_email)) then
    raise exception 'The invitation email must match the lead contact email';
  end if;
  select * into v_result from public.service_create_quick_client_invitation(
    p_actor_id,p_email,coalesce(nullif(btrim(p_contact_name),''),v_lead.contact_name),p_phone,
    coalesce(nullif(btrim(p_business_name),''),v_lead.business_name));
  update public.client_quick_invitations set source_lead_id=p_source_lead_id where id=v_result.invitation_id;
  return query select v_result.invitation_id,v_result.client_id,v_result.client_contact_id,
    v_result.business_name,v_result.contact_name,v_result.contact_email;
end;
$$;

revoke all on function public.request_owner_booking_v3(uuid,text,text,text,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.request_owner_booking_v3(uuid,text,text,text,uuid,uuid,uuid,text) to authenticated,service_role;
revoke all on function public.service_create_quick_client_invitation_for_lead(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.service_create_quick_client_invitation_for_lead(uuid,uuid,text,text,text,text) to service_role;

do $$ begin
  if has_function_privilege('anon','public.request_owner_booking_v3(uuid,text,text,text,uuid,uuid,uuid,text)','execute') then
    raise exception 'Standalone booking API is exposed to anonymous users';
  end if;
  if not has_function_privilege('authenticated','public.request_owner_booking_v3(uuid,text,text,text,uuid,uuid,uuid,text)','execute') then
    raise exception 'Authenticated booking API is unavailable';
  end if;
  if has_function_privilege('authenticated','public.service_create_quick_client_invitation_for_lead(uuid,uuid,text,text,text,text)','execute') then
    raise exception 'Lead invitation service RPC is exposed directly';
  end if;
end; $$;

notify pgrst,'reload schema';
