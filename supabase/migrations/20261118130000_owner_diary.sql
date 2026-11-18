-- Owner diary (owner, 18 Nov 2026). Three changes to the Director's calendar:
--
--   1. New event types for the Director's own diary: meeting, personal, travel, other. A 'personal' event is ALWAYS
--      private: the server forces visibility 'private' (and no public label) whatever the caller sends. Booking types
--      (crm_bookings, availability slots, staff time requests) are unchanged: these four are diary-only.
--   2. owner_field_meetings_range: the Director sees the field team's scheduled meetings (field_meetings, PR #334) as
--      a read-only layer on her Calendar page.
--   3. A new calendar permission 'manage_diary' ("Manage my diary"): the holder fills in the Director's diary for her
--      (create / edit / cancel events in every type except Personal). A Personal event is shown to them only as a busy
--      block and can never be touched by them. calendar_has_permission semantics apply (effective dates, revocation;
--      an enabled Office Administrator already holds every permission on the Founder's calendar, unchanged).
--      Every change is audited (calendar_event_changes + staff_audit_write + the activity-log trigger) and the
--      Director is told in-app: create / move / cancel by the existing owner_calendar_events_diary_notice trigger,
--      edits that keep the time by diary_notify here.
--
-- owner_create_calendar_event / owner_update_calendar_event are copied from the LIVE definitions (18 Nov 2026); the
-- only changes are the category list and forcing 'personal' to private.

-- 1. Constraints -------------------------------------------------------------------------------------------------------
-- Both tables hold rows: add the wider checks NOT VALID, then validate (every existing row already passes).
alter table public.owner_calendar_events drop constraint if exists owner_calendar_events_category_check;
alter table public.owner_calendar_events add constraint owner_calendar_events_category_check check (category in (
  'urgent', 'submission', 'submission_update', 'consultation', 'presentation', 'call', 'paperwork_review',
  'meeting', 'personal', 'travel', 'other')) not valid;
alter table public.owner_calendar_events validate constraint owner_calendar_events_category_check;

-- A Personal event is private, enforced on the row itself as well as in the functions.
alter table public.owner_calendar_events drop constraint if exists owner_calendar_events_personal_private_ck;
alter table public.owner_calendar_events add constraint owner_calendar_events_personal_private_ck
  check (category <> 'personal' or (visibility = 'private' and public_title is null)) not valid;
alter table public.owner_calendar_events validate constraint owner_calendar_events_personal_private_ck;

alter table public.calendar_grants drop constraint if exists calendar_grants_permission_check;
alter table public.calendar_grants add constraint calendar_grants_permission_check
  check (permission in ('view_availability', 'create', 'change_own', 'manage_others', 'manage_diary')) not valid;
alter table public.calendar_grants validate constraint calendar_grants_permission_check;

-- 2. The Director's own create / update (live bodies; category list + personal forced private) ---------------------
create or replace function public.owner_create_calendar_event(p_title text, p_category text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_visibility text DEFAULT 'private'::text, p_public_title text DEFAULT NULL::text, p_private_notes text DEFAULT NULL::text, p_client_id uuid DEFAULT NULL::uuid, p_lead_id uuid DEFAULT NULL::uuid, p_deal_id uuid DEFAULT NULL::uuid, p_create_task boolean DEFAULT true)
 RETURNS public.owner_calendar_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid:=(select auth.uid()); v_task_id uuid; v_event public.owner_calendar_events%rowtype;
  v_visibility text := case when p_category='personal' then 'private' else p_visibility end;
begin
  if not public.is_owner() then raise exception 'Only the owner can create calendar events' using errcode='42501'; end if;
  if length(btrim(coalesce(p_title,''))) not between 3 and 160 then raise exception 'Event title must be 3 to 160 characters'; end if;
  if p_category not in ('urgent','submission','submission_update','consultation','presentation','call','paperwork_review',
                        'meeting','personal','travel','other') then raise exception 'Unsupported event category'; end if;
  if v_visibility not in ('private','busy','public') then raise exception 'Unsupported event visibility'; end if;
  if v_visibility='public' and length(btrim(coalesce(p_public_title,''))) not between 3 and 120 then raise exception 'A public event requires a safe public title'; end if;
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
  values(v_owner,btrim(p_title),p_category,p_starts_at,p_ends_at,v_visibility,
    case when v_visibility='public' then btrim(p_public_title) else null end,nullif(btrim(p_private_notes),''),
    p_client_id,p_lead_id,p_deal_id,v_task_id,v_owner) returning * into v_event;
  return v_event;
end;
$function$;

create or replace function public.owner_update_calendar_event(p_event_id uuid, p_title text, p_category text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_visibility text DEFAULT 'private'::text, p_public_title text DEFAULT NULL::text, p_private_notes text DEFAULT NULL::text, p_client_id uuid DEFAULT NULL::uuid, p_lead_id uuid DEFAULT NULL::uuid, p_deal_id uuid DEFAULT NULL::uuid)
 RETURNS public.owner_calendar_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid:=(select auth.uid()); v_event public.owner_calendar_events%rowtype;
  v_visibility text := case when p_category='personal' then 'private' else p_visibility end;
begin
  if not public.is_owner() then raise exception 'Only the owner can update calendar events' using errcode='42501'; end if;
  select * into v_event from public.owner_calendar_events where id=p_event_id and owner_id=v_owner for update;
  if not found then raise exception 'Calendar event not found'; end if;
  if v_event.booking_id is not null then raise exception 'Booking events are managed from booking decisions'; end if;
  if v_event.status<>'scheduled' then raise exception 'Only scheduled events can be edited'; end if;
  if length(btrim(coalesce(p_title,''))) not between 3 and 160 then raise exception 'Event title must be 3 to 160 characters'; end if;
  if p_category not in ('urgent','submission','submission_update','consultation','presentation','call','paperwork_review',
                        'meeting','personal','travel','other') then raise exception 'Unsupported event category'; end if;
  if v_visibility not in ('private','busy','public') then raise exception 'Unsupported event visibility'; end if;
  if v_visibility='public' and length(btrim(coalesce(p_public_title,''))) not between 3 and 120 then raise exception 'A public event requires a safe public title'; end if;
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
    visibility=v_visibility,public_title=case when v_visibility='public' then btrim(p_public_title) else null end,
    private_notes=nullif(btrim(p_private_notes),''),client_id=p_client_id,lead_id=p_lead_id,deal_id=p_deal_id
    where id=p_event_id returning * into v_event;
  if v_event.task_id is not null then update public.owner_tasks set title=left('Meeting: '||btrim(p_title),160),
    notes=nullif(btrim(p_private_notes),''),due_at=p_starts_at,priority=case when p_category='urgent' then 'high' else 'normal' end,
    client_id=p_client_id,lead_id=p_lead_id,deal_id=p_deal_id where id=v_event.task_id and status in ('open','in_progress','blocked'); end if;
  return v_event;
end; $function$;

-- 3. Field team layer on the Director's calendar ------------------------------------------------------------------------
create or replace function public.owner_field_meetings_range(p_from timestamptz, p_to timestamptz)
returns table (id uuid, owner_profile_id uuid, owner_name text, title text, meeting_kind text, starts_at timestamptz,
               ends_at timestamptz, location text, business_name text, status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.is_owner(), false) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception 'Choose a window of up to two months';
  end if;
  return query
    select m.id, m.owner_profile_id, coalesce(nullif(btrim(op.full_name), ''), op.email), m.title, m.meeting_kind,
           m.starts_at, m.ends_at, m.location, l.business_name, m.status
      from public.field_meetings m
      join public.profiles op on op.id = m.owner_profile_id
      left join public.leads l on l.id = m.lead_id
     where m.status = 'scheduled' and op.is_active and op.role::text in ('field_supervisor', 'field_consultant')
       and tstzrange(m.starts_at, m.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
     order by m.starts_at
     limit 500;
end;
$$;
revoke all on function public.owner_field_meetings_range(timestamptz, timestamptz) from public, anon;
grant execute on function public.owner_field_meetings_range(timestamptz, timestamptz) to authenticated;

-- 4. "Manage my diary" ----------------------------------------------------------------------------------------------
-- The calendars the caller may fill in (staff only; the Director uses her own Calendar page).
create or replace function public.staff_diary_calendars()
returns table (calendar_owner_id uuid, calendar_owner_name text)
language sql stable security definer set search_path = '' as $$
  select o.id, coalesce(nullif(btrim(o.full_name), ''), o.email)
    from public.profiles o
   where public.staff_role_of() is not null and o.role::text = 'owner' and o.is_active
     and public.calendar_has_permission(o.id, 'manage_diary')
   order by o.created_at;
$$;
revoke all on function public.staff_diary_calendars() from public, anon;
grant execute on function public.staff_diary_calendars() to authenticated;

-- Shared checks for a delegated diary write. Returns the caller's real role.
create or replace function public.staff_diary_require(p_calendar_owner uuid)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  if public.staff_role_of() is null or not public.calendar_is_founder(p_calendar_owner) then
    raise exception 'You do not have calendar permission for this action' using errcode = '42501';
  end if;
  v_role := public.calendar_require_permission(p_calendar_owner, 'manage_diary');
  return v_role;
end;
$$;
revoke all on function public.staff_diary_require(uuid) from public, anon, authenticated;

-- Validation shared by delegated create and edit (same rules as the Director's own functions; never 'personal').
create or replace function public.staff_diary_validate(
  p_title text, p_category text, p_starts_at timestamptz, p_ends_at timestamptz, p_visibility text, p_public_title text,
  p_notes text, p_client_id uuid, p_lead_id uuid, p_deal_id uuid, p_is_edit boolean)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if length(btrim(coalesce(p_title, ''))) not between 3 and 160 then raise exception 'Event title must be 3 to 160 characters'; end if;
  if p_category = 'personal' then
    raise exception 'Only the Director adds Personal events' using errcode = '42501';
  end if;
  if coalesce(p_category, '') not in ('urgent','submission','submission_update','consultation','presentation','call',
                                      'paperwork_review','meeting','travel','other') then
    raise exception 'Unsupported event category';
  end if;
  if coalesce(p_visibility, '') not in ('private','busy','public') then raise exception 'Unsupported event visibility'; end if;
  if p_visibility = 'public' and length(btrim(coalesce(p_public_title, ''))) not between 3 and 120 then
    raise exception 'A public event requires a safe public title';
  end if;
  if p_notes is not null and length(p_notes) > 4000 then raise exception 'Keep the notes under 4000 characters'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_starts_at <= now()
     or p_ends_at - p_starts_at > interval '12 hours' then
    raise exception 'Event must be a future positive interval no longer than twelve hours';
  end if;
  if not p_is_edit and p_category = 'presentation' and not public.calendar_is_presentation_window(p_starts_at, p_ends_at) then
    raise exception 'Presentations must be between 14:00 and 20:00 Africa/Johannesburg on one day';
  end if;
  if p_is_edit and p_category = 'consultation' and not public.calendar_is_consultation_window(p_starts_at, p_ends_at) then
    raise exception 'Consultations must be between 14:00 and 20:00 Africa/Johannesburg on one day';
  end if;
  if (p_client_id is not null and not exists (select 1 from public.clients c where c.id = p_client_id))
     or (p_lead_id is not null and not exists (select 1 from public.leads l where l.id = p_lead_id))
     or (p_deal_id is not null and not exists (select 1 from public.deals d where d.id = p_deal_id)) then
    raise exception 'One or more CRM references are unavailable';
  end if;
  if p_deal_id is not null and not exists (select 1 from public.deals d where d.id = p_deal_id
    and (p_client_id is null or d.client_id = p_client_id) and (p_lead_id is null or d.lead_id = p_lead_id)) then
    raise exception 'Deal does not match the selected client or lead';
  end if;
end;
$$;
revoke all on function public.staff_diary_validate(text, text, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, boolean)
  from public, anon, authenticated;

-- Overlap checks under the calendar lock (same as the Director's own functions).
create or replace function public.staff_diary_require_free(p_calendar_owner uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_except uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.owner_calendar_events e where e.owner_id = p_calendar_owner and e.status = 'scheduled'
               and e.id is distinct from p_except
               and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')) then
    raise exception 'Event overlaps the Owner calendar';
  end if;
  if exists (select 1 from public.crm_bookings b join public.owner_availability_slots s on s.id = b.slot_id
              where b.status in ('requested','confirmed')
                and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')) then
    raise exception 'Event overlaps an active booking';
  end if;
  update public.owner_availability_slots s set is_open = false
   where s.owner_id = p_calendar_owner and s.is_open
     and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');
end;
$$;
revoke all on function public.staff_diary_require_free(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

-- The Director's diary for a delegate. Personal events come back as a busy block only.
create or replace function public.staff_diary_events(p_calendar_owner uuid, p_from timestamptz, p_to timestamptz)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, status text, is_personal boolean, is_booking boolean,
               category text, title text, visibility text, public_title text, notes text,
               client_id uuid, lead_id uuid, deal_id uuid, client_name text, lead_name text, deal_reference text,
               created_by_name text, can_change boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.staff_diary_require(p_calendar_owner);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception 'Choose a window of up to two months';
  end if;
  return query
    select e.id, e.starts_at, e.ends_at, e.status,
           e.category = 'personal', e.booking_id is not null,
           case when e.category = 'personal' then null else e.category end,
           case when e.category = 'personal' then 'Busy' else e.title end,
           case when e.category = 'personal' then 'private' else e.visibility end,
           case when e.category = 'personal' then null else e.public_title end,
           case when e.category = 'personal' then null else e.private_notes end,
           case when e.category = 'personal' then null else e.client_id end,
           case when e.category = 'personal' then null else e.lead_id end,
           case when e.category = 'personal' then null else e.deal_id end,
           case when e.category = 'personal' then null else c.business_name end,
           case when e.category = 'personal' then null else l.business_name end,
           case when e.category = 'personal' then null else d.reference end,
           case when e.category = 'personal' then null else coalesce(nullif(btrim(cp.full_name), ''), cp.email) end,
           (e.category <> 'personal' and e.booking_id is null and e.status = 'scheduled' and e.starts_at > now())
      from public.owner_calendar_events e
      left join public.clients c on c.id = e.client_id
      left join public.leads l on l.id = e.lead_id
      left join public.deals d on d.id = e.deal_id
      left join public.profiles cp on cp.id = e.created_by
     where e.owner_id = p_calendar_owner and e.status in ('scheduled', 'completed')
       and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
     order by e.starts_at
     limit 500;
end;
$$;
revoke all on function public.staff_diary_events(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.staff_diary_events(uuid, timestamptz, timestamptz) to authenticated;

-- Pick lists for the event form (clients, leads, deals), only for a delegate.
create or replace function public.staff_diary_link_options(p_calendar_owner uuid)
returns table (kind text, id uuid, label text, client_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.staff_diary_require(p_calendar_owner);
  return query
    (select 'client'::text, c.id, c.business_name::text, null::uuid from public.clients c order by c.business_name limit 1000)
    union all
    (select 'lead'::text, l.id, l.business_name::text, null::uuid from public.leads l order by l.business_name limit 1000)
    union all
    (select 'deal'::text, d.id, coalesce(d.reference, 'Unreferenced deal')::text, d.client_id from public.deals d
      order by d.created_at desc limit 1000);
end;
$$;
revoke all on function public.staff_diary_link_options(uuid) from public, anon;
grant execute on function public.staff_diary_link_options(uuid) to authenticated;

create or replace function public.staff_diary_create_event(
  p_calendar_owner uuid, p_title text, p_category text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_visibility text default 'private', p_public_title text default null, p_notes text default null,
  p_client_id uuid default null, p_lead_id uuid default null, p_deal_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_role text; v_actor uuid := (select auth.uid()); v_id uuid;
begin
  v_role := public.staff_diary_require(p_calendar_owner);
  perform public.staff_diary_validate(p_title, p_category, p_starts_at, p_ends_at, p_visibility, p_public_title, p_notes,
                                      p_client_id, p_lead_id, p_deal_id, false);
  perform pg_advisory_xact_lock(hashtext('owner-calendar:' || p_calendar_owner::text));
  perform public.staff_diary_require_free(p_calendar_owner, p_starts_at, p_ends_at, null);
  insert into public.owner_calendar_events (owner_id, title, category, starts_at, ends_at, visibility, public_title,
                                            private_notes, client_id, lead_id, deal_id, created_by)
  values (p_calendar_owner, btrim(p_title), p_category, p_starts_at, p_ends_at, p_visibility,
          case when p_visibility = 'public' then btrim(p_public_title) end, nullif(btrim(p_notes), ''),
          p_client_id, p_lead_id, p_deal_id, v_actor)
  returning id into v_id;
  insert into public.calendar_event_changes (event_id, actor_id, actor_role, kind, to_starts, to_ends)
  values (v_id, v_actor, v_role, 'created', p_starts_at, p_ends_at);
  perform public.staff_audit_write('calendar_event', v_id, 'diary_event_created', null,
    jsonb_build_object('calendar_owner', p_calendar_owner, 'category', p_category, 'starts_at', p_starts_at));
  -- The Director is told by the owner_calendar_events_diary_notice trigger.
  return v_id;
end;
$$;
revoke all on function public.staff_diary_create_event(uuid, text, text, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.staff_diary_create_event(uuid, text, text, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid) to authenticated;

create or replace function public.staff_diary_update_event(
  p_event_id uuid, p_title text, p_category text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_visibility text default 'private', p_public_title text default null, p_notes text default null,
  p_client_id uuid default null, p_lead_id uuid default null, p_deal_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_role text; v_actor uuid := (select auth.uid()); v_event public.owner_calendar_events; v_rows int;
begin
  select * into v_event from public.owner_calendar_events e where e.id = p_event_id;
  if not found then raise exception 'Calendar event not found'; end if;
  v_role := public.staff_diary_require(v_event.owner_id);
  perform pg_advisory_xact_lock(hashtext('owner-calendar:' || v_event.owner_id::text));
  select * into v_event from public.owner_calendar_events e where e.id = p_event_id for update;
  if v_event.category = 'personal' then raise exception 'Only the Director changes a Personal event' using errcode = '42501'; end if;
  if v_event.booking_id is not null then raise exception 'Booking events are managed from booking decisions'; end if;
  if v_event.status <> 'scheduled' then raise exception 'Only scheduled events can be edited'; end if;
  perform public.staff_diary_validate(p_title, p_category, p_starts_at, p_ends_at, p_visibility, p_public_title, p_notes,
                                      p_client_id, p_lead_id, p_deal_id, true);
  perform public.staff_diary_require_free(v_event.owner_id, p_starts_at, p_ends_at, p_event_id);
  update public.owner_calendar_events
     set title = btrim(p_title), category = p_category, starts_at = p_starts_at, ends_at = p_ends_at,
         visibility = p_visibility, public_title = case when p_visibility = 'public' then btrim(p_public_title) end,
         private_notes = nullif(btrim(p_notes), ''), client_id = p_client_id, lead_id = p_lead_id, deal_id = p_deal_id
   where id = p_event_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'Changing the event affected no rows'; end if;
  if v_event.task_id is not null then
    update public.owner_tasks set title = left('Meeting: ' || btrim(p_title), 160), notes = nullif(btrim(p_notes), ''),
           due_at = p_starts_at, priority = case when p_category = 'urgent' then 'high' else 'normal' end,
           client_id = p_client_id, lead_id = p_lead_id, deal_id = p_deal_id
     where id = v_event.task_id and status in ('open', 'in_progress', 'blocked');
  end if;
  if p_starts_at is distinct from v_event.starts_at or p_ends_at is distinct from v_event.ends_at then
    insert into public.calendar_event_changes (event_id, actor_id, actor_role, kind, from_starts, from_ends, to_starts, to_ends)
    values (p_event_id, v_actor, v_role, 'rescheduled', v_event.starts_at, v_event.ends_at, p_starts_at, p_ends_at);
    -- The Director is told by the owner_calendar_events_diary_notice trigger.
  else
    perform public.diary_notify(v_event.owner_id, 'Diary: event updated',
      btrim(p_title) || ' · ' || to_char(p_starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI'),
      '/calendar', jsonb_build_object('event_id', p_event_id, 'change', 'updated'));
  end if;
  perform public.staff_audit_write('calendar_event', p_event_id, 'diary_event_updated', null,
    jsonb_build_object('calendar_owner', v_event.owner_id, 'category', p_category, 'starts_at', p_starts_at));
  return p_event_id;
end;
$$;
revoke all on function public.staff_diary_update_event(uuid, text, text, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.staff_diary_update_event(uuid, text, text, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid) to authenticated;

create or replace function public.staff_diary_cancel_event(p_event_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_role text; v_actor uuid := (select auth.uid()); v_event public.owner_calendar_events; v_rows int; v_rev int;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) not between 3 and 300 then raise exception 'Say why the event is cancelled (3 to 300 characters)'; end if;
  select * into v_event from public.owner_calendar_events e where e.id = p_event_id;
  if not found then raise exception 'Calendar event not found'; end if;
  v_role := public.staff_diary_require(v_event.owner_id);
  perform pg_advisory_xact_lock(hashtext('owner-calendar:' || v_event.owner_id::text));
  select * into v_event from public.owner_calendar_events e where e.id = p_event_id for update;
  if v_event.category = 'personal' then raise exception 'Only the Director changes a Personal event' using errcode = '42501'; end if;
  if v_event.booking_id is not null then raise exception 'Booking events are managed from booking decisions'; end if;
  if v_event.status <> 'scheduled' then raise exception 'Only a scheduled event can be cancelled'; end if;
  update public.owner_calendar_events set status = 'cancelled' where id = p_event_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'Cancelling the event affected no rows'; end if;
  if v_event.task_id is not null then
    update public.owner_tasks set status = 'cancelled', completed_at = null, completed_by = null, blocker_reason = null
     where id = v_event.task_id and status not in ('completed', 'cancelled');
  end if;
  insert into public.calendar_event_changes (event_id, actor_id, actor_role, kind, from_starts, from_ends, reason)
  values (p_event_id, v_actor, v_role, 'cancelled', v_event.starts_at, v_event.ends_at, v_reason);
  -- Attendees who were sent a confirmation get a cancellation notice (same as staff_cancel_calendar_event).
  update public.calendar_confirmation_outbox set status = 'superseded'
   where event_id = p_event_id and status in ('queued', 'failed', 'processing');
  select coalesce(max(o.revision), 0) + 1 into v_rev from public.calendar_confirmation_outbox o where o.event_id = p_event_id;
  insert into public.calendar_confirmation_outbox (event_id, revision, kind, recipient_email, recipient_name, due_by, short_notice)
  select p_event_id, v_rev, 'cancelled', r.recipient_email, r.recipient_name, now(), false
    from (select distinct on (o.recipient_email) o.recipient_email, o.recipient_name
            from public.calendar_confirmation_outbox o where o.event_id = p_event_id and o.kind <> 'cancelled'
           order by o.recipient_email, o.revision desc) r;
  perform public.staff_audit_write('calendar_event', p_event_id, 'diary_event_cancelled', v_reason,
    jsonb_build_object('calendar_owner', v_event.owner_id));
  -- The Director is told by the owner_calendar_events_diary_notice trigger.
  return p_event_id;
end;
$$;
revoke all on function public.staff_diary_cancel_event(uuid, text) from public, anon;
grant execute on function public.staff_diary_cancel_event(uuid, text) to authenticated;
