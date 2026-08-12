-- C8: Stable CRM-side mirror of Claude's legal execution outputs.
-- The gate defaults OFF so deployment cannot block live dispatch before legal integration is ready.

create table public.crm_legal_execution_events (
  id uuid primary key default gen_random_uuid(),
  source_instance_id uuid not null,
  deal_id uuid not null references public.deals(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  document_key text not null check (document_key in ('client_nda','client_mandate','authority_consent')),
  execution_state text not null check (execution_state in ('sent','executed','withdrawn','superseded','expired','declined')),
  final_document_sha256 text check (final_document_sha256 is null or final_document_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  source_occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique(source_instance_id,execution_state,source_occurred_at)
);
create index crm_legal_execution_deal_idx
  on public.crm_legal_execution_events(deal_id,document_key,source_occurred_at desc);
alter table public.crm_legal_execution_events enable row level security;
revoke all on public.crm_legal_execution_events from public,anon,authenticated;
grant select on public.crm_legal_execution_events to authenticated;
grant insert on public.crm_legal_execution_events to service_role;
create policy crm_legal_execution_owner_read on public.crm_legal_execution_events
  for select to authenticated using(public.is_owner());

create table public.crm_integration_settings (
  singleton boolean primary key default true check(singleton),
  legal_dispatch_gate_enabled boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.crm_integration_settings(singleton) values(true) on conflict(singleton) do nothing;
alter table public.crm_integration_settings enable row level security;
revoke all on public.crm_integration_settings from public,anon,authenticated;
grant select on public.crm_integration_settings to authenticated;
create policy crm_integration_settings_owner_read on public.crm_integration_settings
  for select to authenticated using(public.is_owner());

create or replace function public.owner_set_legal_dispatch_gate(p_enabled boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can change the dispatch gate' using errcode='42501'; end if;
  update public.crm_integration_settings
  set legal_dispatch_gate_enabled=p_enabled,updated_by=auth.uid(),updated_at=now()
  where singleton;
  return p_enabled;
end $$;

create or replace function public.crm_compute_deal_dispatch_readiness(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_enabled boolean;
  v_mandate boolean;
  v_consent boolean;
  v_required integer;
  v_accepted integer;
begin
  select legal_dispatch_gate_enabled into v_enabled from public.crm_integration_settings where singleton;
  select coalesce((
    select e.execution_state='executed' and e.final_document_sha256 is not null
    from public.crm_legal_execution_events e
    where e.deal_id=p_deal_id and e.document_key='client_mandate'
    order by e.source_occurred_at desc, e.recorded_at desc, e.id desc
    limit 1
  ),false) into v_mandate;
  select coalesce((
    select e.execution_state='executed' and e.final_document_sha256 is not null
    from public.crm_legal_execution_events e
    where e.deal_id=p_deal_id and e.document_key='authority_consent'
    order by e.source_occurred_at desc, e.recorded_at desc, e.id desc
    limit 1
  ),false) into v_consent;

  -- Resolve requirements objectively. Do not call the client-scoped checklist
  -- helper here because service-role dispatch has no client auth.uid().
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
    select candidates.*,
      row_number() over(partition by document_type order by priority desc) rn
    from candidates
  ), required_types as (
    select document_type from ranked where rn=1 and requirement='required'
  )
  select count(*), count(*) filter(where exists(
    select 1 from public.documents d
    where d.deal_id=p_deal_id and d.document_type=required_types.document_type
      and d.is_current_version and d.status='active'
      and d.verification_status='accepted'
  ))
  into v_required,v_accepted from required_types;
  return jsonb_build_object(
    'ready',not v_enabled or (v_mandate and v_consent and v_accepted>=v_required),
    'enforced',v_enabled,'mandate_executed',v_mandate,
    'authority_consent_executed',v_consent,
    'required_documents',v_required,'accepted_required_documents',v_accepted
  );
end $$;

revoke all on function public.crm_compute_deal_dispatch_readiness(uuid)
  from public,anon,authenticated;

create or replace function public.owner_deal_dispatch_readiness(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can inspect dispatch readiness' using errcode='42501';
  end if;
  return public.crm_compute_deal_dispatch_readiness(p_deal_id);
end $$;

create or replace function public.enforce_crm_dispatch_readiness()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  v_result:=public.crm_compute_deal_dispatch_readiness(new.deal_id);
  if (v_result->>'enforced')::boolean and not (v_result->>'ready')::boolean then
    raise exception 'Deal is not legally/documentarily ready for funder dispatch';
  end if;
  return new;
end $$;
revoke all on function public.enforce_crm_dispatch_readiness() from public,anon,authenticated;
drop trigger if exists enforce_crm_dispatch_readiness on public.deal_package_dispatches;
create trigger enforce_crm_dispatch_readiness
before insert on public.deal_package_dispatches
for each row execute function public.enforce_crm_dispatch_readiness();

revoke all on function public.owner_set_legal_dispatch_gate(boolean) from public,anon;
grant execute on function public.owner_set_legal_dispatch_gate(boolean) to authenticated;
revoke all on function public.owner_deal_dispatch_readiness(uuid) from public,anon;
grant execute on function public.owner_deal_dispatch_readiness(uuid) to authenticated;

do $$ begin
  if (select legal_dispatch_gate_enabled from public.crm_integration_settings where singleton) then
    raise exception 'C8: legal dispatch gate must deploy disabled';
  end if;
  if has_table_privilege('authenticated','public.crm_legal_execution_events','INSERT') then
    raise exception 'C8: browser can forge legal execution';
  end if;
  if has_function_privilege('authenticated','public.crm_compute_deal_dispatch_readiness(uuid)','EXECUTE') then
    raise exception 'C8: internal readiness function is API executable';
  end if;
end $$;

notify pgrst,'reload schema';
