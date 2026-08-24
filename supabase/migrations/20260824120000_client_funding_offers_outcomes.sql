-- Client-safe funding offers and immutable client decisions.
-- Generated after `supabase migration new` was attempted with the current CLI;
-- the CLI returned without creating a file in this Windows environment.

create table public.client_funding_offers (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  funder_submission_id uuid not null references public.deal_funder_submissions(id) on delete restrict,
  evidence_document_id uuid not null references public.documents(id) on delete restrict,
  client_funder_label text not null check (length(btrim(client_funder_label)) between 2 and 120),
  offer_amount numeric(14,2) not null check (offer_amount > 0),
  term_months integer check (term_months between 1 and 360),
  repayment_frequency text check (repayment_frequency is null or repayment_frequency in ('daily','weekly','fortnightly','monthly','on_completion','other')),
  repayment_amount numeric(14,2) check (repayment_amount is null or repayment_amount >= 0),
  total_repayment numeric(14,2) check (total_repayment is null or total_repayment >= offer_amount),
  fees_summary text,
  conditions_summary text,
  valid_until date,
  state text not null default 'draft' check (state in ('draft','published','withdrawn')),
  published_at timestamptz,
  published_by uuid references public.profiles(id) on delete restrict,
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.profiles(id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, funder_submission_id),
  constraint client_funding_offers_state_times_ck check (
    (state = 'draft' and published_at is null and withdrawn_at is null)
    or (state = 'published' and published_at is not null and published_by is not null and withdrawn_at is null)
    or (state = 'withdrawn' and published_at is not null and published_by is not null and withdrawn_at is not null and withdrawn_by is not null)
  )
);

create index client_funding_offers_client_published_idx
  on public.client_funding_offers(client_id, published_at desc) where state = 'published';
create index client_funding_offers_deal_idx on public.client_funding_offers(deal_id, created_at desc);

create table public.client_funding_offer_decisions (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null unique references public.client_funding_offers(id) on delete restrict,
  deal_id uuid not null references public.deals(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  decision text not null check (decision in ('accepted','declined')),
  client_reason text check (client_reason is null or length(btrim(client_reason)) between 3 and 500),
  decided_by uuid not null references public.profiles(id) on delete restrict,
  decided_at timestamptz not null default now()
);

create index client_funding_offer_decisions_deal_idx
  on public.client_funding_offer_decisions(deal_id, decided_at desc);

alter table public.client_funding_offers enable row level security;
alter table public.client_funding_offer_decisions enable row level security;

revoke all on table public.client_funding_offers from public, anon, authenticated;
revoke all on table public.client_funding_offer_decisions from public, anon, authenticated;
grant select on table public.client_funding_offers to authenticated;
grant select on table public.client_funding_offer_decisions to authenticated;
grant all on table public.client_funding_offers to service_role;
grant all on table public.client_funding_offer_decisions to service_role;

create policy client_funding_offers_owner_read on public.client_funding_offers
  for select to authenticated using (public.is_owner());
create policy client_funding_offers_client_read on public.client_funding_offers
  for select to authenticated using (
    state = 'published' and client_id = (select public.current_client_id())
  );
create policy client_funding_offer_decisions_owner_read on public.client_funding_offer_decisions
  for select to authenticated using (public.is_owner());
create policy client_funding_offer_decisions_client_read on public.client_funding_offer_decisions
  for select to authenticated using (client_id = (select public.current_client_id()));

create trigger set_updated_at before update on public.client_funding_offers
  for each row execute function public.set_updated_at();

create or replace function public.prevent_client_offer_decision_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Client offer decisions are immutable';
end;
$$;
create trigger client_offer_decisions_immutable
  before update or delete on public.client_funding_offer_decisions
  for each row execute function public.prevent_client_offer_decision_mutation();

create or replace function public.owner_create_client_funding_offer(
  p_deal_id uuid,
  p_funder_submission_id uuid,
  p_evidence_document_id uuid,
  p_client_funder_label text,
  p_offer_amount numeric,
  p_term_months integer default null,
  p_repayment_frequency text default null,
  p_repayment_amount numeric default null,
  p_total_repayment numeric default null,
  p_fees_summary text default null,
  p_conditions_summary text default null,
  p_valid_until date default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_client_id uuid; v_offer_id uuid;
begin
  if v_uid is null or not public.is_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
  select d.client_id into v_client_id from public.deals d where d.id = p_deal_id and d.archived_at is null;
  if v_client_id is null then raise exception 'Active deal not found'; end if;
  if not exists (select 1 from public.deal_funder_submissions s where s.id=p_funder_submission_id and s.deal_id=p_deal_id and s.status in ('approved','quote_received')) then
    raise exception 'Offer requires an approved or quoted funder submission for this deal';
  end if;
  if not exists (
    select 1 from public.documents d where d.id=p_evidence_document_id and d.client_id=v_client_id
      and (d.deal_id is null or d.deal_id=p_deal_id) and d.document_type in ('offer_letter','term_sheet')
      and d.verification_status='accepted' and d.is_current_version
  ) then raise exception 'Offer requires a current accepted offer letter or term sheet'; end if;
  insert into public.client_funding_offers(
    deal_id,client_id,funder_submission_id,evidence_document_id,client_funder_label,offer_amount,
    term_months,repayment_frequency,repayment_amount,total_repayment,fees_summary,conditions_summary,valid_until,created_by
  ) values (
    p_deal_id,v_client_id,p_funder_submission_id,p_evidence_document_id,btrim(p_client_funder_label),p_offer_amount,
    p_term_months,p_repayment_frequency,p_repayment_amount,p_total_repayment,nullif(btrim(p_fees_summary),''),
    nullif(btrim(p_conditions_summary),''),p_valid_until,v_uid
  ) returning id into v_offer_id;
  insert into public.activity_logs(user_id,user_role,event_type,entity_type,entity_id,description,after_values,related_entity_ids)
  values(v_uid,'owner','CLIENT_OFFER_DRAFTED','client_funding_offer',v_offer_id,'Client funding offer drafted from verified evidence',jsonb_build_object('deal_id',p_deal_id,'offer_amount',p_offer_amount),jsonb_build_array(p_deal_id,v_client_id,p_evidence_document_id));
  return v_offer_id;
end;
$$;

create or replace function public.owner_publish_client_funding_offer(p_offer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_offer public.client_funding_offers;
begin
  if v_uid is null or not public.is_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
  select * into v_offer from public.client_funding_offers where id=p_offer_id for update;
  if not found then raise exception 'Offer not found'; end if;
  if v_offer.state <> 'draft' then raise exception 'Only draft offers can be published'; end if;
  if v_offer.valid_until is not null and v_offer.valid_until < current_date then raise exception 'Expired offers cannot be published'; end if;
  update public.client_funding_offers set state='published',published_at=now(),published_by=v_uid where id=p_offer_id;
  update public.deals set stage='client_deciding' where id=v_offer.deal_id and stage in ('approved_quote_received','in_credit','submitted');
  insert into public.owner_tasks(title,notes,due_at,priority,status,client_id,deal_id,created_by)
  values('Follow up on published funding offer','Confirm that the client reviewed the published evidence-backed offer.',now()+interval '2 days','high','open',v_offer.client_id,v_offer.deal_id,v_uid);
  insert into public.activity_logs(user_id,user_role,event_type,entity_type,entity_id,description,after_values,related_entity_ids)
  values(v_uid,'owner','CLIENT_OFFER_PUBLISHED','client_funding_offer',p_offer_id,'Funding offer published to client portal',jsonb_build_object('state','published'),jsonb_build_array(v_offer.deal_id,v_offer.client_id));
  return p_offer_id;
end;
$$;

create or replace function public.client_funding_offer_workspace()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_client_id uuid := public.current_client_id(); v_offers jsonb;
begin
  if (select auth.uid()) is null or v_client_id is null then raise exception 'Client portal account is not linked' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'deal_id',o.deal_id,'deal_reference',d.reference,'funder_label',o.client_funder_label,
    'offer_amount',o.offer_amount,'term_months',o.term_months,'repayment_frequency',o.repayment_frequency,
    'repayment_amount',o.repayment_amount,'total_repayment',o.total_repayment,'fees_summary',o.fees_summary,
    'conditions_summary',o.conditions_summary,'valid_until',o.valid_until,'published_at',o.published_at,
    'evidence_document_id',o.evidence_document_id,'decision',dec.decision,'decision_reason',dec.client_reason,'decided_at',dec.decided_at
  ) order by o.published_at desc),'[]'::jsonb) into v_offers
  from public.client_funding_offers o join public.deals d on d.id=o.deal_id
  left join public.client_funding_offer_decisions dec on dec.offer_id=o.id
  where o.client_id=v_client_id and o.state='published';
  return jsonb_build_object('client_id',v_client_id,'offers',v_offers);
end;
$$;

create or replace function public.client_decide_funding_offer(p_offer_id uuid,p_decision text,p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_client_id uuid := public.current_client_id(); v_offer public.client_funding_offers; v_id uuid; v_open_count integer;
begin
  if v_uid is null or v_client_id is null then raise exception 'Client portal account is not linked' using errcode='42501'; end if;
  if p_decision not in ('accepted','declined') then raise exception 'Decision must be accepted or declined'; end if;
  select * into v_offer from public.client_funding_offers where id=p_offer_id and client_id=v_client_id and state='published' for update;
  if not found then raise exception 'Published offer not found'; end if;
  if v_offer.valid_until is not null and v_offer.valid_until < current_date then raise exception 'This offer has expired'; end if;
  if exists(select 1 from public.client_funding_offer_decisions where offer_id=p_offer_id) then raise exception 'A decision has already been recorded'; end if;
  insert into public.client_funding_offer_decisions(offer_id,deal_id,client_id,decision,client_reason,decided_by)
  values(p_offer_id,v_offer.deal_id,v_client_id,p_decision,nullif(btrim(p_reason),''),v_uid) returning id into v_id;
  if p_decision='accepted' then
    update public.deals set stage='verification_kyc' where id=v_offer.deal_id and stage in ('approved_quote_received','client_deciding');
    update public.owner_tasks set status='completed',completed_at=now(),completed_by=v_uid
      where deal_id=v_offer.deal_id and status='open' and title='Follow up on published funding offer';
    insert into public.owner_tasks(title,notes,due_at,priority,status,client_id,deal_id,created_by)
    values('Progress accepted client offer','Verify KYC and complete the funder contracting steps.',now()+interval '1 day','high','open',v_client_id,v_offer.deal_id,v_uid);
  else
    select count(*) into v_open_count from public.client_funding_offers o left join public.client_funding_offer_decisions d on d.offer_id=o.id
      where o.deal_id=v_offer.deal_id and o.state='published' and d.id is null;
    if v_open_count=0 then
      insert into public.owner_tasks(title,notes,due_at,priority,status,client_id,deal_id,created_by)
      values('Review declined funding outcomes','All currently published offers have a client decision. Review the reason and agree next steps.',now(),'high','open',v_client_id,v_offer.deal_id,v_uid);
    end if;
  end if;
  insert into public.activity_logs(user_id,user_role,event_type,entity_type,entity_id,description,after_values,related_entity_ids)
  values(v_uid,'client','CLIENT_OFFER_'||upper(p_decision),'client_funding_offer_decision',v_id,'Client funding offer decision recorded',jsonb_build_object('decision',p_decision),jsonb_build_array(p_offer_id,v_offer.deal_id,v_client_id));
  return v_id;
end;
$$;

revoke all on function public.owner_create_client_funding_offer(uuid,uuid,uuid,text,numeric,integer,text,numeric,numeric,text,text,date) from public,anon;
revoke all on function public.owner_publish_client_funding_offer(uuid) from public,anon;
revoke all on function public.client_funding_offer_workspace() from public,anon;
revoke all on function public.client_decide_funding_offer(uuid,text,text) from public,anon;
grant execute on function public.owner_create_client_funding_offer(uuid,uuid,uuid,text,numeric,integer,text,numeric,numeric,text,text,date) to authenticated,service_role;
grant execute on function public.owner_publish_client_funding_offer(uuid) to authenticated,service_role;
grant execute on function public.client_funding_offer_workspace() to authenticated;
grant execute on function public.client_decide_funding_offer(uuid,text,text) to authenticated;

do $$ begin
  if has_table_privilege('authenticated','public.client_funding_offers','INSERT') or has_table_privilege('authenticated','public.client_funding_offer_decisions','INSERT') then raise exception 'Direct offer writes must remain blocked'; end if;
  if has_function_privilege('anon','public.client_funding_offer_workspace()','execute') then raise exception 'Anonymous offer workspace access is forbidden'; end if;
end $$;

notify pgrst, 'reload schema';
