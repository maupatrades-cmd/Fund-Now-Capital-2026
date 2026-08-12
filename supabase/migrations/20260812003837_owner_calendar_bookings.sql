-- C6: Owner availability and governed bookings for CRM roles and clients.

create table public.owner_availability_slots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Africa/Johannesburg',
  allowed_booking_types text[] not null default array['consultation','presentation','call','paperwork_review'],
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (cardinality(allowed_booking_types) > 0)
);

create table public.crm_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.owner_availability_slots(id) on delete restrict,
  requester_id uuid not null references public.profiles(id) on delete restrict,
  client_id uuid references public.clients(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  booking_type text not null check (booking_type in ('consultation','presentation','call','paperwork_review')),
  agenda text not null check (length(btrim(agenda)) between 3 and 1000),
  status text not null default 'requested' check (status in ('requested','confirmed','declined','cancelled','completed')),
  owner_note text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status in ('requested','cancelled') and decided_by is null and decided_at is null)
    or (status in ('confirmed','declined','completed') and decided_by is not null and decided_at is not null)
  )
);

create unique index crm_bookings_one_active_slot
  on public.crm_bookings(slot_id)
  where status in ('requested','confirmed');
create index owner_availability_open_idx
  on public.owner_availability_slots(starts_at)
  where is_open;
create index crm_bookings_requester_idx
  on public.crm_bookings(requester_id, created_at desc);

create trigger owner_availability_slots_updated_at
before update on public.owner_availability_slots
for each row execute function public.set_updated_at();
create trigger crm_bookings_updated_at
before update on public.crm_bookings
for each row execute function public.set_updated_at();
create trigger crm_bookings_activity
after insert or update on public.crm_bookings
for each row execute function public.log_activity();

alter table public.owner_availability_slots enable row level security;
alter table public.crm_bookings enable row level security;
revoke all on public.owner_availability_slots, public.crm_bookings
  from public, anon, authenticated;
grant select on public.owner_availability_slots, public.crm_bookings to authenticated;

create policy owner_availability_authenticated_read
on public.owner_availability_slots for select to authenticated
using (is_open or public.is_owner());
create policy crm_bookings_owner_read
on public.crm_bookings for select to authenticated
using (public.is_owner());
create policy crm_bookings_requester_read
on public.crm_bookings for select to authenticated
using (requester_id = (select auth.uid()));

create or replace function public.owner_publish_availability(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_allowed_booking_types text[]
)
returns public.owner_availability_slots
language plpgsql
security definer
set search_path = ''
as $$
declare v_slot public.owner_availability_slots%rowtype;
begin
  if not public.is_owner() then raise exception 'Only the owner can publish availability' using errcode='42501'; end if;
  if p_ends_at <= p_starts_at or p_starts_at <= now() then raise exception 'Availability must be a future positive interval'; end if;
  if p_allowed_booking_types is null or cardinality(p_allowed_booking_types) = 0
     or not (p_allowed_booking_types <@ array['consultation','presentation','call','paperwork_review']::text[]) then
    raise exception 'Unsupported booking type';
  end if;
  insert into public.owner_availability_slots(owner_id,starts_at,ends_at,allowed_booking_types)
  values(auth.uid(),p_starts_at,p_ends_at,p_allowed_booking_types)
  returning * into v_slot;
  return v_slot;
end;
$$;

create or replace function public.request_owner_booking(
  p_slot_id uuid,
  p_booking_type text,
  p_agenda text,
  p_client_id uuid default null,
  p_deal_id uuid default null
)
returns public.crm_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot public.owner_availability_slots%rowtype;
  v_role text;
  v_booking public.crm_bookings%rowtype;
begin
  select p.role::text into v_role from public.profiles p
  where p.id = auth.uid() and p.is_active;
  if v_role is null or v_role not in ('owner','partner','contractor','lead_referrer','client') then
    raise exception 'Active CRM role required' using errcode='42501';
  end if;
  if p_client_id is not null and not exists (
    select 1 from public.clients c
    where c.id=p_client_id and (
      coalesce(public.is_owner(),false)
      or c.id=public.current_client_id()
      or c.referral_partner_id=public.current_partner_id()
      or exists (
        select 1 from public.deals d
        where d.client_id=c.id and d.lead_id is not null
          and coalesce(public.caller_owns_lead(d.lead_id),false)
      )
    )
  ) then
    raise exception 'Client is not visible to the requester' using errcode='42501';
  end if;
  if p_deal_id is not null and not exists (
    select 1 from public.deals d
    where d.id=p_deal_id and (
      coalesce(public.is_owner(),false)
      or d.client_id=public.current_client_id()
      or d.referral_partner_id=public.current_partner_id()
      or (d.lead_id is not null and coalesce(public.caller_owns_lead(d.lead_id),false))
    )
  ) then
    raise exception 'Deal is not visible to the requester' using errcode='42501';
  end if;
  if p_client_id is not null and p_deal_id is not null and not exists (
    select 1 from public.deals d where d.id=p_deal_id and d.client_id=p_client_id
  ) then
    raise exception 'Deal does not belong to the selected client';
  end if;
  select * into v_slot from public.owner_availability_slots
  where id = p_slot_id and is_open and starts_at > now() for update;
  if not found then raise exception 'Availability is no longer open'; end if;
  if not (p_booking_type = any(v_slot.allowed_booking_types)) then
    raise exception 'Booking type is not allowed for this slot';
  end if;
  insert into public.crm_bookings(slot_id,requester_id,client_id,deal_id,booking_type,agenda)
  values(p_slot_id,auth.uid(),p_client_id,p_deal_id,p_booking_type,btrim(p_agenda))
  returning * into v_booking;
  update public.owner_availability_slots set is_open = false where id = p_slot_id;
  return v_booking;
end;
$$;

create or replace function public.owner_decide_booking(
  p_booking_id uuid,
  p_status text,
  p_owner_note text default null
)
returns public.crm_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare v_booking public.crm_bookings%rowtype;
begin
  if not public.is_owner() then raise exception 'Only the owner can decide bookings' using errcode='42501'; end if;
  if p_status not in ('confirmed','declined','completed') then raise exception 'Unsupported booking decision'; end if;
  update public.crm_bookings
  set status=p_status, owner_note=nullif(btrim(p_owner_note),''),
      decided_by=auth.uid(), decided_at=now()
  where id=p_booking_id and status in ('requested','confirmed')
  returning * into v_booking;
  if not found then raise exception 'Booking is not decisionable'; end if;
  if p_status='declined' then
    update public.owner_availability_slots set is_open=true
    where id=v_booking.slot_id and starts_at > now();
  end if;
  return v_booking;
end;
$$;

revoke all on function public.owner_publish_availability(timestamptz,timestamptz,text[]) from public,anon;
grant execute on function public.owner_publish_availability(timestamptz,timestamptz,text[]) to authenticated;
revoke all on function public.request_owner_booking(uuid,text,text,uuid,uuid) from public,anon;
grant execute on function public.request_owner_booking(uuid,text,text,uuid,uuid) to authenticated;
revoke all on function public.owner_decide_booking(uuid,text,text) from public,anon;
grant execute on function public.owner_decide_booking(uuid,text,text) to authenticated;

do $$
begin
  if has_table_privilege('authenticated','public.crm_bookings','INSERT,UPDATE,DELETE') then
    raise exception 'C6: direct booking mutation exposed';
  end if;
  if has_function_privilege('anon','public.request_owner_booking(uuid,text,text,uuid,uuid)','EXECUTE') then
    raise exception 'C6: anonymous booking exposed';
  end if;
end;
$$;

notify pgrst, 'reload schema';
