-- Owner-only soft archive for duplicate/test deals. Children and audit history
-- remain intact; archived deals leave operational and portal pipeline surfaces.

alter table public.deals
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id),
  add column if not exists archive_reason text;

create index if not exists deals_active_created_idx
  on public.deals (created_at desc) where archived_at is null;

create or replace function public.owner_set_deal_archived(
  p_deal_id uuid,
  p_archived boolean,
  p_reason text default null
)
returns public.deals
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.deals;
begin
  if v_uid is null or not exists (
    select 1 from public.profiles where id = v_uid and role = 'owner' and is_active
  ) then
    raise exception 'Only an active owner may archive deals' using errcode = '42501';
  end if;
  if p_archived and length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'An archive reason is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('deal-archive:' || p_deal_id::text));
  select * into v_row from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found'; end if;

  if p_archived and v_row.archived_at is null and (
    exists (select 1 from public.commission_records where deal_id = p_deal_id and status <> 'void')
    or exists (select 1 from public.bonus_records where deal_id = p_deal_id and state <> 'void')
    or exists (select 1 from public.funder_invoices where deal_id = p_deal_id and state <> 'void')
  ) then
    raise exception 'A deal with active financial records cannot be archived';
  end if;

  update public.deals
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then v_uid else null end,
         archive_reason = case when p_archived then btrim(p_reason) else null end,
         is_priority = case when p_archived then false else is_priority end
   where id = p_deal_id
   returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.owner_set_deal_archived(uuid,boolean,text) from public, anon;
grant execute on function public.owner_set_deal_archived(uuid,boolean,text) to authenticated, service_role;

-- Portal functions are recreated only to add the active-deal predicate. Their
-- return shape, role gates and fictional-funder projection remain unchanged.
create or replace function public.partner_list_own_deals()
returns table (deal_id uuid, deal_reference text, client_business_name text, current_stage text, anonymized_funder_name text, submitted_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_role text; v_active boolean;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode='28000'; end if;
  select role, is_active into v_role, v_active from public.profiles where id=v_uid;
  if v_role is distinct from 'partner' or not coalesce(v_active,false) then raise exception 'Active partner account required' using errcode='42501'; end if;
  return query select d.id,d.reference,c.business_name,d.stage::text,
    public.funder_display_name(d.awarded_funder_id,v_uid),l.created_at
    from public.deals d join public.leads l on l.id=d.lead_id join public.clients c on c.id=d.client_id
    where l.attributed_to_partner_id=v_uid and d.archived_at is null order by l.created_at desc;
end $$;

create or replace function public.contractor_list_own_deals()
returns table (deal_id uuid, deal_reference text, client_business_name text, current_stage text, anonymized_funder_name text, submitted_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_role text; v_active boolean;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode='28000'; end if;
  select role, is_active into v_role, v_active from public.profiles where id=v_uid;
  if v_role is distinct from 'contractor' or not coalesce(v_active,false) then raise exception 'Active contractor account required' using errcode='42501'; end if;
  return query select d.id,d.reference,c.business_name,d.stage::text,
    public.funder_display_name(d.awarded_funder_id,v_uid),l.created_at
    from public.deals d join public.leads l on l.id=d.lead_id join public.clients c on c.id=d.client_id
    where l.attributed_to_contractor_id=v_uid and d.archived_at is null order by l.created_at desc;
end $$;

revoke all on function public.partner_list_own_deals() from public, anon;
revoke all on function public.contractor_list_own_deals() from public, anon;
grant execute on function public.partner_list_own_deals() to authenticated, service_role;
grant execute on function public.contractor_list_own_deals() to authenticated, service_role;

-- Archived deals are immutable operational records. Enforce this below the UI
-- so direct API calls cannot add, alter, or remove downstream deal activity.
create or replace function public.prevent_archived_deal_child_mutation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_deal_id uuid;
begin
  v_deal_id := case when tg_op = 'DELETE' then old.deal_id else new.deal_id end;
  if v_deal_id is not null and exists (
    select 1 from public.deals where id = v_deal_id and archived_at is not null
  ) then
    raise exception 'Archived deals are read-only; restore the deal before changing operational records'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_archived_deal_child_mutation() from public, anon, authenticated;

drop trigger if exists prevent_archived_deal_submission_mutation on public.deal_funder_submissions;
create trigger prevent_archived_deal_submission_mutation
before insert or update or delete on public.deal_funder_submissions
for each row execute function public.prevent_archived_deal_child_mutation();

drop trigger if exists prevent_archived_deal_commission_mutation on public.commission_records;
create trigger prevent_archived_deal_commission_mutation
before insert or update or delete on public.commission_records
for each row execute function public.prevent_archived_deal_child_mutation();

drop trigger if exists prevent_archived_deal_bonus_mutation on public.bonus_records;
create trigger prevent_archived_deal_bonus_mutation
before insert or update or delete on public.bonus_records
for each row execute function public.prevent_archived_deal_child_mutation();

drop trigger if exists prevent_archived_deal_invoice_mutation on public.funder_invoices;
create trigger prevent_archived_deal_invoice_mutation
before insert or update or delete on public.funder_invoices
for each row execute function public.prevent_archived_deal_child_mutation();

drop trigger if exists prevent_archived_deal_communication_mutation on public.communications;
create trigger prevent_archived_deal_communication_mutation
before insert or update or delete on public.communications
for each row execute function public.prevent_archived_deal_child_mutation();

do $$ begin
  if has_function_privilege('anon','public.owner_set_deal_archived(uuid,boolean,text)','execute') then raise exception 'assert: anon archive execute'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='deals_active_created_idx') then raise exception 'assert: active deals index missing'; end if;
  if (select count(*) from pg_trigger where tgname like 'prevent_archived_deal_%_mutation' and not tgisinternal) <> 5 then raise exception 'assert: archived deal mutation guards missing'; end if;
end $$;

notify pgrst, 'reload schema';
