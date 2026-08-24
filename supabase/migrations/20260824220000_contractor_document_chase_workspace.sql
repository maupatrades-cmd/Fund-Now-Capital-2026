-- Contractor document-chase workspace.
-- Reuses attributed_to_contractor_id, the governed document rule tables,
-- public.documents and the existing owner_tasks assignee workflow.

create unique index if not exists owner_tasks_one_open_contractor_document_chase
  on public.owner_tasks (deal_id, assigned_to, title)
  where deal_id is not null
    and assigned_to is not null
    and task_kind = 'document_request'
    and status not in ('completed', 'cancelled')
    and notes like '[contractor_document_chase:%';

create or replace function public.contractor_document_chase_items()
returns table (
  deal_id uuid,
  deal_reference text,
  client_business_name text,
  current_stage text,
  product_name text,
  document_type public.document_type,
  requirement text,
  client_safe_reason text,
  document_status text,
  rejection_reason text,
  task_id uuid,
  task_status text,
  task_due_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with actor as (
    select p.id
      from public.profiles p
     where p.id = auth.uid()
       and p.role::text = 'contractor'
       and p.is_active
  ), own_deals as (
    select
      d.id,
      d.reference,
      d.client_id,
      d.stage::text as stage,
      client.business_name,
      context.product_code,
      context.funder_id
    from actor
    join public.leads lead on lead.attributed_to_contractor_id = actor.id
    join public.deals d on d.lead_id = lead.id
    join public.clients client on client.id = d.client_id
    left join public.deal_document_rule_contexts context on context.deal_id = d.id
    where d.archived_at is null
  ), candidates as (
    select
      own_deals.*,
      product.display_name as product_name,
      rule.document_type,
      rule.requirement,
      rule.client_safe_reason,
      case rule.rule_scope
        when 'owner_override' then 3
        when 'funder_reference' then 2
        else 1
      end as priority
    from own_deals
    join public.funding_product_catalog product
      on product.code = own_deals.product_code
    join public.document_requirement_rules rule
      on rule.product_code = own_deals.product_code
     and rule.is_active
     and (
       rule.rule_scope = 'product_baseline'
       or (rule.rule_scope = 'funder_reference' and rule.funder_id = own_deals.funder_id)
       or (rule.rule_scope = 'owner_override' and rule.deal_id = own_deals.id)
     )
  ), ranked as (
    select candidates.*,
      row_number() over (
        partition by candidates.id, candidates.document_type
        order by candidates.priority desc
      ) as rule_rank
    from candidates
  )
  select
    ranked.id,
    ranked.reference,
    ranked.business_name,
    ranked.stage,
    ranked.product_name,
    ranked.document_type,
    ranked.requirement,
    ranked.client_safe_reason,
    case
      when latest_document.id is null then 'missing'
      when latest_document.verification_status::text = 'accepted' then 'accepted'
      when latest_document.verification_status::text = 'rejected' then 'rejected'
      else 'submitted'
    end,
    case
      when latest_document.verification_status::text = 'rejected'
        then latest_document.rejection_reason::text
      else null
    end,
    chase_task.id,
    chase_task.status,
    chase_task.due_at
  from ranked
  left join lateral (
    select document.id, document.verification_status, document.rejection_reason
      from public.documents document
     where document.client_id = ranked.client_id
       and document.deal_id = ranked.id
       and document.document_type = ranked.document_type
       and document.is_current_version
     order by document.version_number desc, document.created_at desc
     limit 1
  ) latest_document on true
  left join lateral (
    select task.id, task.status, task.due_at
      from public.owner_tasks task
     where task.deal_id = ranked.id
       and task.assigned_to = auth.uid()
       and task.task_kind = 'document_request'
       and task.notes like '[contractor_document_chase:' || ranked.document_type::text || ']%'
       and task.status not in ('completed', 'cancelled')
     order by task.created_at desc
     limit 1
  ) chase_task on true
  where ranked.rule_rank = 1
    and ranked.requirement <> 'waived'
  order by ranked.business_name, ranked.document_type::text;
$$;

comment on function public.contractor_document_chase_items() is
  'Contractor-safe paperwork projection for only the caller''s attributed, unarchived deals. Returns client-safe rule explanations and document verification state; never funder identity, internal rule source, files, contact details or Owner notes.';

revoke all on function public.contractor_document_chase_items() from public, anon;
grant execute on function public.contractor_document_chase_items() to authenticated;

create or replace function public.contractor_create_document_chase_task(
  p_deal_id uuid,
  p_document_type public.document_type,
  p_due_in_days integer default 2
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_item record;
  v_title text;
  v_task_id uuid;
begin
  if v_uid is null or not exists (
    select 1 from public.profiles p
     where p.id = v_uid and p.role::text = 'contractor' and p.is_active
  ) then
    raise exception 'Active contractor access required' using errcode = '42501';
  end if;
  if p_due_in_days not between 0 and 30 then
    raise exception 'Due days must be between 0 and 30';
  end if;

  select item.* into v_item
    from public.contractor_document_chase_items() item
   where item.deal_id = p_deal_id
     and item.document_type = p_document_type;
  if not found then
    raise exception 'Document requirement is not available for this contractor deal' using errcode = '42501';
  end if;
  if v_item.document_status = 'accepted' then
    raise exception 'This document is already accepted';
  end if;

  v_title := 'Chase: ' || initcap(replace(p_document_type::text, '_', ' '));
  select task.id into v_task_id
    from public.owner_tasks task
   where task.deal_id = p_deal_id
     and task.assigned_to = v_uid
     and task.title = v_title
     and task.task_kind = 'document_request'
     and task.status not in ('completed', 'cancelled')
     and task.notes like '[contractor_document_chase:' || p_document_type::text || ']%'
   order by task.created_at desc
   limit 1;

  if v_task_id is null then
    insert into public.owner_tasks (
      title, notes, due_at, priority, client_id, deal_id,
      assigned_to, created_by, task_kind
    )
    select
      v_title,
      '[contractor_document_chase:' || p_document_type::text || '] ' ||
        coalesce(v_item.client_safe_reason, 'Required for the selected funding package.'),
      now() + make_interval(days => p_due_in_days),
      case when v_item.document_status = 'rejected' then 'high' else 'normal' end,
      deal.client_id,
      deal.id,
      v_uid,
      v_uid,
      'document_request'
    from public.deals deal
    where deal.id = p_deal_id
    returning id into v_task_id;
  end if;

  return v_task_id;
exception
  when unique_violation then
    select task.id into v_task_id
      from public.owner_tasks task
     where task.deal_id = p_deal_id
       and task.assigned_to = v_uid
       and task.title = v_title
       and task.task_kind = 'document_request'
       and task.status not in ('completed', 'cancelled')
     order by task.created_at desc
     limit 1;
    return v_task_id;
end;
$$;

comment on function public.contractor_create_document_chase_task(uuid, public.document_type, integer) is
  'Idempotently creates a self-assigned document_request task only for a missing/rejected requirement on the active contractor caller''s own attributed deal.';

revoke all on function public.contractor_create_document_chase_task(uuid, public.document_type, integer) from public, anon;
grant execute on function public.contractor_create_document_chase_task(uuid, public.document_type, integer) to authenticated;

do $$
declare v_definition text;
begin
  if has_function_privilege('anon', 'public.contractor_document_chase_items()', 'EXECUTE')
     or has_function_privilege('anon', 'public.contractor_create_document_chase_task(uuid,public.document_type,integer)', 'EXECUTE') then
    raise exception 'contractor document-chase functions must not be executable by anon';
  end if;
  select lower(pg_get_functiondef('public.contractor_document_chase_items()'::regprocedure)) into v_definition;
  if v_definition not like '%lead.attributed_to_contractor_id = actor.id%'
     or v_definition like '%contact_email%'
     or v_definition like '%contact_cell%'
     or v_definition like '%funder.name%'
     or v_definition like '%verification_notes%' then
    raise exception 'contractor document-chase projection isolation is invalid';
  end if;
end;
$$;

notify pgrst, 'reload schema';
