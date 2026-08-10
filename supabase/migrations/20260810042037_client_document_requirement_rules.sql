-- Client backend PR 8: product/funder/Owner document rules on the canonical document taxonomy.

create table public.funding_product_catalog (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  display_name text not null,
  max_requested_amount numeric(14,2) check (max_requested_amount is null or max_requested_amount > 0),
  is_asset_backed boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.funding_product_catalog (code, display_name, max_requested_amount, is_asset_backed) values
  ('working_capital', 'Working capital', 100000000, false),
  ('purchase_order_finance', 'Purchase order finance', null, false),
  ('invoice_discounting', 'Invoice discounting', null, false),
  ('equipment_finance', 'Equipment finance', null, true),
  ('bridging_finance', 'Bridging finance', null, false),
  ('equity_venture_capital', 'Equity or venture capital', null, false),
  ('asset_backed_finance', 'Asset-backed finance', null, true)
on conflict (code) do nothing;

create table public.document_requirement_rules (
  id uuid primary key default gen_random_uuid(),
  rule_scope text not null check (rule_scope in ('product_baseline','funder_reference','owner_override')),
  product_code text not null references public.funding_product_catalog(code) on delete restrict,
  funder_id uuid references public.funders(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  document_type public.document_type not null,
  requirement text not null check (requirement in ('required','optional','waived')),
  client_safe_reason text,
  source_reference_text text,
  source_reference_url text,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_requirement_rules_scope_ck check (
    (rule_scope = 'product_baseline' and funder_id is null and deal_id is null)
    or (rule_scope = 'funder_reference' and funder_id is not null and deal_id is null
        and nullif(trim(coalesce(source_reference_text, '')), '') is not null)
    or (rule_scope = 'owner_override' and deal_id is not null)
  ),
  constraint document_requirement_rules_url_ck check (
    source_reference_url is null or source_reference_url ~ '^https://'
  )
);

create table public.deal_document_rule_contexts (
  deal_id uuid primary key references public.deals(id) on delete cascade,
  product_code text not null references public.funding_product_catalog(code) on delete restrict,
  funder_id uuid references public.funders(id) on delete set null,
  selected_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  selected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index document_requirement_rules_product_unique
  on public.document_requirement_rules (product_code, document_type)
  where rule_scope = 'product_baseline' and is_active;
create unique index document_requirement_rules_funder_unique
  on public.document_requirement_rules (product_code, funder_id, document_type)
  where rule_scope = 'funder_reference' and is_active;
create unique index document_requirement_rules_override_unique
  on public.document_requirement_rules (deal_id, document_type)
  where rule_scope = 'owner_override' and is_active;
create index document_requirement_rules_resolution_idx
  on public.document_requirement_rules (product_code, funder_id, deal_id, is_active);
create index deal_document_rule_contexts_product_idx
  on public.deal_document_rule_contexts (product_code);

create trigger set_updated_at before update on public.funding_product_catalog
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.document_requirement_rules
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.deal_document_rule_contexts
  for each row execute function public.set_updated_at();
create trigger log_activity_document_requirement_rules
  after insert or update or delete on public.document_requirement_rules
  for each row execute function public.log_activity();
create trigger log_activity_deal_document_rule_contexts
  after insert or update or delete on public.deal_document_rule_contexts
  for each row execute function public.log_activity();
create trigger log_activity_funding_product_catalog
  after insert or update or delete on public.funding_product_catalog
  for each row execute function public.log_activity();

create or replace function public.validate_document_rule_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.funder_id is not null and not exists (
    select 1 from public.funders f where f.id = new.funder_id and f.is_active
  ) then
    raise exception 'Document-rule funder must be active';
  end if;
  if tg_op = 'UPDATE' and new.deal_id is distinct from old.deal_id then
    raise exception 'Deal document-rule context cannot be moved to another deal';
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_document_rule_context() from public, anon, authenticated;
create trigger validate_document_rule_context
  before insert or update on public.deal_document_rule_contexts
  for each row execute function public.validate_document_rule_context();

create or replace function public.client_document_checklist(p_deal_id uuid)
returns table (
  document_type public.document_type,
  requirement text,
  client_safe_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  with authorised_context as (
    select c.deal_id, c.product_code, c.funder_id
    from public.deal_document_rule_contexts c
    join public.deals d on d.id = c.deal_id
    where c.deal_id = p_deal_id
      and (
        public.is_owner()
        or d.client_id = public.current_client_id()
      )
  ), candidates as (
    select r.document_type, r.requirement, r.client_safe_reason,
      case r.rule_scope when 'owner_override' then 3 when 'funder_reference' then 2 else 1 end as priority
    from authorised_context c
    join public.document_requirement_rules r
      on r.product_code = c.product_code and r.is_active
     and (
       r.rule_scope = 'product_baseline'
       or (r.rule_scope = 'funder_reference' and r.funder_id = c.funder_id)
       or (r.rule_scope = 'owner_override' and r.deal_id = c.deal_id)
     )
  ), ranked as (
    select candidates.*,
      row_number() over (partition by candidates.document_type order by candidates.priority desc) as rn
    from candidates
  )
  select ranked.document_type, ranked.requirement, ranked.client_safe_reason
  from ranked
  where ranked.rn = 1 and ranked.requirement <> 'waived'
  order by public.document_type_category(ranked.document_type), ranked.document_type;
$$;
revoke execute on function public.client_document_checklist(uuid) from public, anon;
grant execute on function public.client_document_checklist(uuid) to authenticated;

alter table public.funding_product_catalog enable row level security;
alter table public.document_requirement_rules enable row level security;
alter table public.deal_document_rule_contexts enable row level security;
revoke all on table public.funding_product_catalog from public, anon, authenticated;
revoke all on table public.document_requirement_rules from public, anon, authenticated;
revoke all on table public.deal_document_rule_contexts from public, anon, authenticated;
grant select, insert, update, delete on table public.funding_product_catalog to authenticated;
grant select, insert, update, delete on table public.document_requirement_rules to authenticated;
grant select, insert, update, delete on table public.deal_document_rule_contexts to authenticated;

create policy "funding_product_catalog_authenticated_read"
  on public.funding_product_catalog for select to authenticated
  using (is_active or (select public.is_owner()));
create policy "funding_product_catalog_owner_write"
  on public.funding_product_catalog for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy "document_requirement_rules_owner_all"
  on public.document_requirement_rules for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy "deal_document_rule_contexts_owner_all"
  on public.deal_document_rule_contexts for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

comment on table public.document_requirement_rules is
  'Owner-governed product, sourced funder-reference and per-deal override rules. Uses the existing public.document_type taxonomy; no funder requirements are seeded or invented.';
comment on function public.client_document_checklist(uuid) is
  'Returns only the client-safe resolved checklist. Never returns funder identity, internal references or waived rules.';

do $$
begin
  if (select max_requested_amount from public.funding_product_catalog where code = 'working_capital') <> 100000000 then
    raise exception 'PR 8: working-capital maximum must be R100 million';
  end if;
  if not exists (
    select 1 from public.funding_product_catalog
    where code = 'asset_backed_finance' and is_asset_backed and is_active
  ) then
    raise exception 'PR 8: asset-backed finance support is missing';
  end if;
  if exists (select 1 from public.document_requirement_rules) then
    raise exception 'PR 8: funder or product document requirements must not be invented in this migration';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('funding_product_catalog','document_requirement_rules','deal_document_rule_contexts')
      and c.relrowsecurity
    group by n.nspname having count(*) = 3
  ) then
    raise exception 'PR 8: RLS is missing from one or more document-rule tables';
  end if;
  if has_table_privilege('anon', 'public.document_requirement_rules', 'SELECT')
     or has_table_privilege('authenticated', 'public.document_requirement_rules', 'INSERT') is false then
    raise exception 'PR 8: document rule grants are incorrect';
  end if;
  if has_function_privilege('anon', 'public.client_document_checklist(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.client_document_checklist(uuid)', 'EXECUTE') then
    raise exception 'PR 8: checklist function grants are incorrect';
  end if;
end;
$$;