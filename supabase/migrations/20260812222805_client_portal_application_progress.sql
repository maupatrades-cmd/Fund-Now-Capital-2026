-- Client portal application progress projection.
--
-- This intentionally exposes a narrow, client-safe projection rather than
-- granting client users direct SELECT access to deals or stage history. Funder
-- identity, internal stages, staff identities, notes, decline reasons, money
-- lifecycle data and commission data never cross this function boundary.

create or replace function public.client_portal_public_stage(p_stage public.deal_stage)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when p_stage in ('new_lead'::public.deal_stage, 'qualifying'::public.deal_stage) then 'received'
    when p_stage = 'document_collection'::public.deal_stage then 'documents'
    when p_stage = 'deal_review'::public.deal_stage then 'review'
    when p_stage in ('submitted'::public.deal_stage, 'in_credit'::public.deal_stage) then 'funding_review'
    when p_stage in ('approved_quote_received'::public.deal_stage, 'client_deciding'::public.deal_stage) then 'decision'
    when p_stage in ('verification_kyc'::public.deal_stage, 'contract_signed'::public.deal_stage, 'advance_pending'::public.deal_stage) then 'finalising'
    when p_stage in ('funded'::public.deal_stage, 'invoiced'::public.deal_stage, 'commission_paid'::public.deal_stage) then 'funded'
    when p_stage = 'declined'::public.deal_stage then 'closed'
    else 'received'
  end
$$;

revoke all on function public.client_portal_public_stage(public.deal_stage) from public, anon, authenticated;

create or replace function public.client_portal_application_progress()
returns table (
  deal_id uuid,
  deal_reference text,
  product_label text,
  current_status text,
  opened_at timestamptz,
  last_progress_at timestamptz,
  is_complete boolean,
  timeline jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_client_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select p.client_id
    into v_client_id
    from public.profiles p
   where p.id = v_user_id
     and p.role = 'client'::public.user_role
     and p.is_active
     and p.client_id is not null;

  if v_client_id is null then
    raise exception 'Active client portal access required' using errcode = '42501';
  end if;

  return query
  with safe_history as (
    select
      h.deal_id,
      h.changed_at,
      public.client_portal_public_stage(h.to_stage) as public_status
    from public.deal_stage_history h
    join public.deals owned_deal
      on owned_deal.id = h.deal_id
     and owned_deal.client_id = v_client_id
  ),
  status_changes as (
    select
      sh.*,
      lag(sh.public_status) over (
        partition by sh.deal_id
        order by sh.changed_at, sh.public_status
      ) as previous_status
    from safe_history sh
    where sh.public_status is not null
  ),
  safe_timelines as (
    select
      sc.deal_id,
      max(sc.changed_at) as last_history_at,
      jsonb_agg(
        jsonb_build_object(
          'status', sc.public_status,
          'occurredAt', sc.changed_at
        )
        order by sc.changed_at
      ) filter (where sc.previous_status is distinct from sc.public_status) as events
    from status_changes sc
    group by sc.deal_id
  )
  select
    d.id as deal_id,
    coalesce(d.reference, 'Application') as deal_reference,
    case d.deal_type::text
      when 'po' then 'Purchase order finance'
      when 'invoice_discounting' then 'Invoice discounting'
      when 'term_loan' then 'Term loan'
      when 'bridging' then 'Bridging finance'
      when 'other' then 'Business funding'
      else 'Working capital'
    end as product_label,
    public.client_portal_public_stage(d.stage) as current_status,
    d.created_at as opened_at,
    greatest(d.updated_at, coalesce(st.last_history_at, d.updated_at)) as last_progress_at,
    d.stage in (
      'funded'::public.deal_stage,
      'invoiced'::public.deal_stage,
      'commission_paid'::public.deal_stage,
      'declined'::public.deal_stage
    ) as is_complete,
    coalesce(
      st.events,
      jsonb_build_array(
        jsonb_build_object(
          'status', 'received',
          'occurredAt', d.created_at
        )
      )
    ) as timeline
  from public.deals d
  left join safe_timelines st on st.deal_id = d.id
  where d.client_id = v_client_id
    and d.archived_at is null
  order by
    (d.stage in (
      'funded'::public.deal_stage,
      'invoiced'::public.deal_stage,
      'commission_paid'::public.deal_stage,
      'declined'::public.deal_stage
    )),
    greatest(d.updated_at, coalesce(st.last_history_at, d.updated_at)) desc;
end;
$$;

revoke all on function public.client_portal_application_progress() from public, anon;
grant execute on function public.client_portal_application_progress() to authenticated;

comment on function public.client_portal_application_progress() is
  'Client-only, auth.uid-scoped application timeline. Maps internal deal stages to safe public milestones and omits funders, staff, internal notes, reasons and money data.';

-- Migration assertions: fail closed if the RPC is accidentally public or if
-- its source loses the explicit active-client ownership guard.
do $$
declare
  v_definition text;
begin
  if exists (
    select 1
      from information_schema.routine_privileges
     where routine_schema = 'public'
       and routine_name = 'client_portal_application_progress'
       and grantee in ('PUBLIC', 'anon')
       and privilege_type = 'EXECUTE'
  ) then
    raise exception 'Client progress RPC must not be executable by anon/PUBLIC';
  end if;

  if not has_function_privilege('authenticated', 'public.client_portal_application_progress()', 'execute') then
    raise exception 'Client progress RPC is not exposed to authenticated clients';
  end if;

  v_definition := pg_get_functiondef('public.client_portal_application_progress()'::regprocedure);
  if position('p.id = v_user_id' in v_definition) = 0
     or position('p.role = ''client''::public.user_role' in v_definition) = 0
     or position('and p.is_active' in v_definition) = 0
     or position('d.client_id = v_client_id' in v_definition) = 0 then
    raise exception 'Client progress RPC ownership guard is incomplete';
  end if;
end;
$$;
