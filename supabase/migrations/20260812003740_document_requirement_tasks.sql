-- C4: Materialise the governed product/funder checklist into the existing CRM task queue.

create unique index if not exists owner_tasks_one_open_document_requirement
  on public.owner_tasks (deal_id, title)
  where deal_id is not null
    and status <> 'cancelled'
    and notes like '[document_requirement:%';

create or replace function public.owner_generate_document_requirement_tasks(
  p_deal_id uuid,
  p_assigned_to uuid default null,
  p_due_in_days integer default 3
)
returns setof public.owner_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal public.deals%rowtype;
  v_rule record;
  v_title text;
  v_task public.owner_tasks%rowtype;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can generate document tasks' using errcode = '42501';
  end if;
  if p_due_in_days not between 0 and 90 then
    raise exception 'Due days must be between 0 and 90';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then raise exception 'Deal not found'; end if;
  if p_assigned_to is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_assigned_to and p.is_active
      and p.role::text in ('owner','partner','contractor','lead_referrer')
  ) then
    raise exception 'Task assignee is not an active supported CRM role';
  end if;

  for v_rule in select * from public.client_document_checklist(p_deal_id) loop
    v_title := 'Collect: ' || initcap(replace(v_rule.document_type::text, '_', ' '));
    if not exists (
      select 1 from public.owner_tasks t
      where t.deal_id = p_deal_id and t.title = v_title and t.status <> 'cancelled'
    ) then
      insert into public.owner_tasks (
        title, notes, due_at, priority, client_id, lead_id, deal_id,
        assigned_to, created_by
      ) values (
        v_title,
        '[document_requirement:' || v_rule.document_type::text || '] ' ||
          coalesce(v_rule.client_safe_reason, 'Required for the selected funding package.'),
        now() + make_interval(days => p_due_in_days),
        case when v_rule.requirement = 'required' then 'high' else 'normal' end,
        v_deal.client_id, v_deal.lead_id, v_deal.id,
        p_assigned_to, auth.uid()
      )
      returning * into v_task;
      return next v_task;
    end if;
  end loop;
end;
$$;

revoke all on function public.owner_generate_document_requirement_tasks(uuid,uuid,integer)
  from public, anon;
grant execute on function public.owner_generate_document_requirement_tasks(uuid,uuid,integer)
  to authenticated;

do $$
begin
  if has_function_privilege(
    'anon',
    'public.owner_generate_document_requirement_tasks(uuid,uuid,integer)',
    'execute'
  ) then
    raise exception 'C4: anon can generate document tasks';
  end if;
end;
$$;

notify pgrst, 'reload schema';
