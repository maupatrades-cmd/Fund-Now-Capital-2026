-- Keep the CRM task queue aligned with the governed document checklist.
-- The automation runs only from database triggers; no browser-callable definer
-- function is introduced. Existing dispatch readiness remains authoritative.

create schema if not exists fnc_internal;
revoke all on schema fnc_internal from public, anon, authenticated;

create table public.deal_document_task_evidence (
  deal_id uuid not null references public.deals(id) on delete cascade,
  document_type public.document_type not null,
  requirement text not null check (requirement in ('required','optional','waived')),
  document_status text not null check (document_status in ('missing','submitted','rejected','accepted','waived')),
  is_submission_blocker boolean not null,
  blocking_reason text,
  task_id uuid references public.owner_tasks(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  last_document_id uuid references public.documents(id) on delete set null,
  synced_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (deal_id, document_type),
  constraint deal_document_task_evidence_blocker_reason_ck check (
    not is_submission_blocker or nullif(btrim(coalesce(blocking_reason,'')), '') is not null
  )
);

alter table public.deal_document_task_evidence enable row level security;
revoke all on public.deal_document_task_evidence from public, anon, authenticated;
grant select on public.deal_document_task_evidence to authenticated;

create policy deal_document_task_evidence_owner_read
  on public.deal_document_task_evidence for select to authenticated
  using ((select public.is_owner()));
create policy deal_document_task_evidence_assignee_read
  on public.deal_document_task_evidence for select to authenticated
  using (assigned_to = (select auth.uid()));

create or replace function fnc_internal.sync_deal_document_tasks(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, fnc_internal
as $$
declare
  v_deal public.deals%rowtype;
  v_rule record;
  v_document record;
  v_assignee uuid;
  v_owner uuid;
  v_task_id uuid;
  v_status text;
  v_title text;
  v_reason text;
begin
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return; end if;

  select p.id into v_owner
    from public.profiles p
   where p.role::text = 'owner' and p.is_active
   order by p.created_at, p.id limit 1;
  if v_owner is null then return; end if;

  -- Prefer the actor already responsible for the attributed lead. Every
  -- candidate is revalidated against an active supported CRM role.
  select coalesce(l.attributed_to_contractor_id,
                  l.attributed_to_lead_referrer_id,
                  l.attributed_to_partner_id,
                  partner_profile.id,
                  v_owner)
    into v_assignee
    from public.deals d
    left join public.leads l on l.id = d.lead_id
    left join lateral (
      select p.id from public.profiles p
       where p.referral_partner_id = d.referral_partner_id
         and p.role::text = 'partner' and p.is_active
       order by p.created_at, p.id limit 1
    ) partner_profile on true
   where d.id = p_deal_id;
  if not exists (
    select 1 from public.profiles p where p.id = v_assignee and p.is_active
      and p.role::text in ('owner','partner','contractor','lead_referrer')
  ) then v_assignee := v_owner; end if;

  for v_rule in
    with context as (
      select c.deal_id,c.product_code,c.funder_id
        from public.deal_document_rule_contexts c where c.deal_id=p_deal_id
    ), candidates as (
      select r.document_type,r.requirement,r.client_safe_reason,
        case r.rule_scope when 'owner_override' then 3 when 'funder_reference' then 2 else 1 end priority
      from context c join public.document_requirement_rules r
        on r.product_code=c.product_code and r.is_active
       and (r.rule_scope='product_baseline'
         or (r.rule_scope='funder_reference' and r.funder_id=c.funder_id)
         or (r.rule_scope='owner_override' and r.deal_id=c.deal_id))
    ), ranked as (
      select candidates.*,row_number() over(partition by document_type order by priority desc) rn
      from candidates
    )
    select * from ranked where rn=1 and requirement <> 'waived'
  loop
    select d.id,d.verification_status::text,d.verified_by into v_document
      from public.documents d
     where d.deal_id=p_deal_id and d.document_type=v_rule.document_type
       and d.is_current_version and d.status='active'
     order by d.version_number desc,d.created_at desc limit 1;
    v_status := case
      when v_document.id is null then 'missing'
      when v_document.verification_status='accepted' then 'accepted'
      when v_document.verification_status='rejected' then 'rejected'
      else 'submitted' end;
    v_title := case when v_status='submitted' then 'Review: ' else 'Collect: ' end
      || initcap(replace(v_rule.document_type::text,'_',' '));
    v_reason := case
      when v_rule.requirement <> 'required' or v_status='accepted' then null
      when v_status='missing' then 'Required document is missing'
      when v_status='rejected' then 'Required document was rejected and must be replaced'
      else 'Required document is awaiting Owner verification' end;

    select e.task_id into v_task_id
      from public.deal_document_task_evidence e
     where e.deal_id=p_deal_id and e.document_type=v_rule.document_type;
    if v_task_id is null then
      select t.id into v_task_id from public.owner_tasks t
       where t.deal_id=p_deal_id and t.status not in ('completed','cancelled')
         and (t.notes like '[document_requirement:'||v_rule.document_type::text||']%'
           or t.notes like '[contractor_document_chase:'||v_rule.document_type::text||']%')
       order by t.created_at desc limit 1;
    end if;

    if v_rule.requirement='required' and v_status <> 'accepted' then
      if v_task_id is null then
        insert into public.owner_tasks(title,notes,due_at,priority,status,client_id,lead_id,deal_id,
          assigned_to,created_by,task_kind)
        values(v_title,'[document_requirement:auto:'||v_rule.document_type::text||'] '
          ||coalesce(v_rule.client_safe_reason,v_reason),now()+interval '3 days',
          case when v_status in ('rejected','submitted') then 'high' else 'normal' end,'open',
          v_deal.client_id,v_deal.lead_id,p_deal_id,
          case when v_status='submitted' then v_owner else v_assignee end,v_owner,
          case when v_status='submitted' then 'paperwork_review' else 'document_request' end)
        returning id into v_task_id;
      else
        update public.owner_tasks set title=v_title,notes='[document_requirement:auto:'||v_rule.document_type::text||'] '
          ||coalesce(v_rule.client_safe_reason,v_reason),
          priority=case when v_status in ('rejected','submitted') then 'high' else 'normal' end,
          status=case when status in ('completed','cancelled') then 'open' else status end,
          task_kind=case when v_status='submitted' then 'paperwork_review' else 'document_request' end,
          assigned_to=case when v_status='submitted' then v_owner else coalesce(assigned_to,v_assignee) end,
          completed_at=null,completed_by=null
        where id=v_task_id;
      end if;
    elsif v_task_id is not null then
      update public.owner_tasks set status='completed',completed_at=coalesce(completed_at,now()),
        completed_by=coalesce(completed_by,v_document.verified_by,v_owner),blocker_reason=null
      where id=v_task_id and status not in ('completed','cancelled');
    end if;

    insert into public.deal_document_task_evidence(deal_id,document_type,requirement,document_status,
      is_submission_blocker,blocking_reason,task_id,assigned_to,last_document_id,synced_at,resolved_at)
    select p_deal_id,v_rule.document_type,v_rule.requirement,v_status,
      v_rule.requirement='required' and v_status<>'accepted',v_reason,v_task_id,t.assigned_to,
      v_document.id,now(),case when v_status='accepted' then now() else null end
    from (select 1) seed left join public.owner_tasks t on t.id=v_task_id
    on conflict(deal_id,document_type) do update set
      requirement=excluded.requirement,document_status=excluded.document_status,
      is_submission_blocker=excluded.is_submission_blocker,blocking_reason=excluded.blocking_reason,
      task_id=excluded.task_id,assigned_to=excluded.assigned_to,last_document_id=excluded.last_document_id,
      synced_at=excluded.synced_at,resolved_at=excluded.resolved_at;
  end loop;

  -- Preserve evidence when a rule is waived/removed and close its linked task.
  for v_rule in
    select e.* from public.deal_document_task_evidence e
     where e.deal_id=p_deal_id and not exists (
       with context as (
         select c.deal_id,c.product_code,c.funder_id
           from public.deal_document_rule_contexts c where c.deal_id=p_deal_id
       ), candidates as (
         select r.document_type,r.requirement,
           case r.rule_scope when 'owner_override' then 3 when 'funder_reference' then 2 else 1 end priority
         from context c join public.document_requirement_rules r
           on r.product_code=c.product_code and r.is_active
          and (r.rule_scope='product_baseline'
            or (r.rule_scope='funder_reference' and r.funder_id=c.funder_id)
            or (r.rule_scope='owner_override' and r.deal_id=c.deal_id))
       ), ranked as (
         select candidates.*,row_number() over(partition by document_type order by priority desc) rn
           from candidates
       )
       select 1 from ranked where rn=1 and requirement<>'waived'
         and document_type=e.document_type)
  loop
    update public.owner_tasks set status='completed',completed_at=coalesce(completed_at,now()),
      completed_by=coalesce(completed_by,v_owner),blocker_reason=null
    where id=v_rule.task_id and status not in ('completed','cancelled');
    update public.deal_document_task_evidence set requirement='waived',document_status='waived',
      is_submission_blocker=false,blocking_reason=null,synced_at=now(),resolved_at=now()
    where deal_id=p_deal_id and document_type=v_rule.document_type;
  end loop;
end;
$$;

revoke all on function fnc_internal.sync_deal_document_tasks(uuid) from public, anon, authenticated;

create or replace function fnc_internal.sync_deal_document_tasks_trigger()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, fnc_internal as $$
declare v_deal_id uuid;
begin
  if tg_table_name='documents' then
    v_deal_id:=coalesce(new.deal_id,old.deal_id);
    if v_deal_id is not null then perform fnc_internal.sync_deal_document_tasks(v_deal_id); end if;
  elsif tg_table_name='deal_document_rule_contexts' then
    v_deal_id:=coalesce(new.deal_id,old.deal_id);
    perform fnc_internal.sync_deal_document_tasks(v_deal_id);
  else
    for v_deal_id in
      select distinct c.deal_id from public.deal_document_rule_contexts c
       where c.product_code in (coalesce(new.product_code,old.product_code))
         and (coalesce(new.rule_scope,old.rule_scope)<>'funder_reference'
           or c.funder_id=coalesce(new.funder_id,old.funder_id))
    loop perform fnc_internal.sync_deal_document_tasks(v_deal_id); end loop;
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function fnc_internal.sync_deal_document_tasks_trigger() from public,anon,authenticated;

create trigger sync_document_tasks_from_documents
after insert or update of verification_status,is_current_version,status,deal_id or delete on public.documents
for each row execute function fnc_internal.sync_deal_document_tasks_trigger();
create trigger sync_document_tasks_from_context
after insert or update or delete on public.deal_document_rule_contexts
for each row execute function fnc_internal.sync_deal_document_tasks_trigger();
create trigger sync_document_tasks_from_rules
after insert or update or delete on public.document_requirement_rules
for each row execute function fnc_internal.sync_deal_document_tasks_trigger();

-- Existing dispatch evidence now includes the linked task/blocker projection;
-- the pre-existing readiness gate still makes the allow/deny decision.
create or replace function public.owner_deal_document_task_evidence(p_deal_id uuid)
returns setof public.deal_document_task_evidence
language sql stable security invoker set search_path=pg_catalog,public as $$
  select e.* from public.deal_document_task_evidence e where e.deal_id=p_deal_id
  order by e.is_submission_blocker desc,e.document_type::text;
$$;
revoke all on function public.owner_deal_document_task_evidence(uuid) from public,anon;
grant execute on function public.owner_deal_document_task_evidence(uuid) to authenticated;

do $$ begin
  if has_table_privilege('authenticated','public.deal_document_task_evidence','INSERT')
    or has_table_privilege('authenticated','public.deal_document_task_evidence','UPDATE') then
    raise exception 'document task evidence must be trigger-written only';
  end if;
  if has_function_privilege('authenticated','fnc_internal.sync_deal_document_tasks(uuid)','EXECUTE') then
    raise exception 'internal document task sync must not be API executable';
  end if;
end $$;

notify pgrst,'reload schema';
