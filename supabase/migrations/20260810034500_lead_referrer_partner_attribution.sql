-- Backend wave PR 5: Path B (lead referrer belongs to a partner) attribution.

alter type public.user_role add value if not exists 'lead_referrer';

create table public.partner_lead_referrers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  referral_partner_id uuid not null references public.referral_partners(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 2 and 160),
  external_reference text,
  status text not null default 'active' check (status in ('invited','active','suspended','ended')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index partner_lead_referrers_partner_idx on public.partner_lead_referrers (referral_partner_id, status);
create trigger partner_lead_referrers_set_updated_at before update on public.partner_lead_referrers
  for each row execute function public.set_updated_at();

alter table public.leads add column if not exists attributed_to_lead_referrer_id uuid;
alter table public.leads add column if not exists attribution_locked_at timestamptz;
alter table public.leads add column if not exists attribution_locked_by uuid;
alter table public.leads add column if not exists attribution_source text;

alter table public.leads add constraint leads_attributed_to_lead_referrer_fkey
  foreign key (attributed_to_lead_referrer_id) references public.profiles(id) on delete set null not valid;
alter table public.leads add constraint leads_attribution_locked_by_fkey
  foreign key (attribution_locked_by) references public.profiles(id) on delete set null not valid;
alter table public.leads add constraint leads_attribution_source_ck
  check (attribution_source is null or attribution_source in ('direct','partner','contractor','lead_referrer','owner_override')) not valid;
alter table public.leads add constraint leads_path_b_partner_ck
  check (attributed_to_lead_referrer_id is null or referral_partner_id is not null) not valid;

create index leads_lead_referrer_idx on public.leads (attributed_to_lead_referrer_id, created_at desc)
  where attributed_to_lead_referrer_id is not null;
alter table public.leads validate constraint leads_attributed_to_lead_referrer_fkey;
alter table public.leads validate constraint leads_attribution_locked_by_fkey;
alter table public.leads validate constraint leads_attribution_source_ck;
alter table public.leads validate constraint leads_path_b_partner_ck;

create table public.lead_attribution_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_type text not null check (event_type in ('captured','verified','locked','owner_override','released')),
  lead_referrer_profile_id uuid references public.profiles(id) on delete set null,
  referral_partner_id uuid references public.referral_partners(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text,
  occurred_at timestamptz not null default now()
);
create index lead_attribution_events_lead_idx on public.lead_attribution_events (lead_id, occurred_at);

alter table public.partner_lead_referrers enable row level security;
alter table public.lead_attribution_events enable row level security;
revoke all on public.partner_lead_referrers, public.lead_attribution_events from public, anon, authenticated;
grant select, insert, update, delete on public.partner_lead_referrers to authenticated;
grant select on public.lead_attribution_events to authenticated;

create policy "partner_lead_referrers_owner_all" on public.partner_lead_referrers
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "partner_lead_referrers_partner_read" on public.partner_lead_referrers
  for select to authenticated using (referral_partner_id = public.current_partner_id());
create policy "partner_lead_referrers_self_read" on public.partner_lead_referrers
  for select to authenticated using (profile_id = (select auth.uid()));
create policy "lead_attribution_events_owner_read" on public.lead_attribution_events
  for select to authenticated using (public.is_owner());
create policy "lead_attribution_events_partner_read" on public.lead_attribution_events
  for select to authenticated using (referral_partner_id = public.current_partner_id());
create policy "lead_attribution_events_referrer_read" on public.lead_attribution_events
  for select to authenticated using (lead_referrer_profile_id = (select auth.uid()));
create policy "leads_lead_referrer_read_own" on public.leads
  for select to authenticated using (
    attributed_to_lead_referrer_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role::text = 'lead_referrer' and p.is_active)
  );

create or replace function public.lead_referrer_submit_lead(
  p_business_name text,
  p_contact_name text,
  p_contact_cell text,
  p_contact_email text,
  p_funding_amount numeric,
  p_funding_purpose jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid(); v_parent uuid; v_lead uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select lr.referral_partner_id into v_parent
    from public.partner_lead_referrers lr
    join public.profiles p on p.id = lr.profile_id
   where lr.profile_id = v_uid and lr.status = 'active'
     and p.role::text = 'lead_referrer' and p.is_active;
  if v_parent is null then raise exception 'Active lead-referrer membership required'; end if;
  if length(btrim(coalesce(p_business_name,''))) < 2 or length(btrim(coalesce(p_contact_name,''))) < 2 then
    raise exception 'Business and contact names are required';
  end if;
  if p_funding_amount is not null and (p_funding_amount <= 0 or p_funding_amount > 100000000) then
    raise exception 'Funding amount is outside the allowed range';
  end if;
  insert into public.leads (
    business_name,contact_name,contact_cell,contact_email,funding_amount,funding_purpose,
    referred_by,referral_partner_id,entered_by,attributed_to_lead_referrer_id,attribution_source
  ) values (
    btrim(p_business_name),btrim(p_contact_name),nullif(btrim(p_contact_cell),''),lower(nullif(btrim(p_contact_email),'')),
    p_funding_amount,coalesce(p_funding_purpose,'[]'::jsonb),'other',v_parent,v_uid,v_uid,'lead_referrer'
  ) returning id into v_lead;
  insert into public.lead_attribution_events
    (lead_id,event_type,lead_referrer_profile_id,referral_partner_id,actor_id)
  values (v_lead,'captured',v_uid,v_parent,v_uid);
  return v_lead;
end;
$$;
revoke all on function public.lead_referrer_submit_lead(text,text,text,text,numeric,jsonb) from public, anon;
grant execute on function public.lead_referrer_submit_lead(text,text,text,text,numeric,jsonb) to authenticated;

create or replace function public.owner_lock_lead_attribution(p_lead_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid(); v_lead public.leads%rowtype;
begin
  if v_uid is null or not public.is_owner() then raise exception 'Owner access required'; end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;
  if v_lead.attributed_to_lead_referrer_id is null then raise exception 'Lead has no lead-referrer attribution'; end if;
  if not exists (
    select 1 from public.partner_lead_referrers lr
     where lr.profile_id = v_lead.attributed_to_lead_referrer_id
       and lr.referral_partner_id = v_lead.referral_partner_id
  ) then raise exception 'Path B parent relationship is invalid'; end if;
  if v_lead.attribution_locked_at is null then
    update public.leads set attribution_locked_at=now(), attribution_locked_by=v_uid where id=p_lead_id;
    insert into public.lead_attribution_events
      (lead_id,event_type,lead_referrer_profile_id,referral_partner_id,actor_id,reason)
    values (p_lead_id,'locked',v_lead.attributed_to_lead_referrer_id,v_lead.referral_partner_id,v_uid,nullif(btrim(p_reason),''));
  end if;
  return jsonb_build_object('lead_id',p_lead_id,'locked',true,'lead_referrer_profile_id',v_lead.attributed_to_lead_referrer_id,'referral_partner_id',v_lead.referral_partner_id);
end;
$$;
revoke all on function public.owner_lock_lead_attribution(uuid,text) from public, anon;
grant execute on function public.owner_lock_lead_attribution(uuid,text) to authenticated;

do $$
begin
  if has_table_privilege('anon','public.partner_lead_referrers','SELECT') then
    raise exception 'PR5: lead-referrer membership is exposed to anon';
  end if;
  if has_function_privilege('anon','public.lead_referrer_submit_lead(text,text,text,text,numeric,jsonb)','EXECUTE') then
    raise exception 'PR5: submit function is exposed to anon';
  end if;
  if position('security definer' in lower(pg_get_functiondef(
      'public.lead_referrer_submit_lead(text,text,text,text,numeric,jsonb)'::regprocedure))) = 0 then
    raise exception 'PR5: submit function is not hardened';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='lead_referrer_submit_lead'
       and p.proconfig @> array['search_path=pg_catalog, public']
  ) then
    raise exception 'PR5: submit function search_path is not pinned';
  end if;
end;
$$;