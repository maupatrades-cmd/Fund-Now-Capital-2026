-- Client backend PR 7: canonical, resumable business/person/product form answers.

create table public.client_form_responses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  product_code text not null check (product_code in (
    'working_capital','purchase_order_finance','invoice_discounting',
    'equipment_finance','bridging_finance','equity_venture_capital','asset_backed_finance'
  )),
  requested_amount numeric(14,2) check (requested_amount is null or requested_amount > 0),
  status text not null default 'draft' check (status in ('draft','submitted','superseded')),
  schema_version integer not null default 1 check (schema_version > 0),
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_form_responses_submit_ck check (
    (status = 'submitted' and submitted_at is not null)
    or (status <> 'submitted' and submitted_at is null)
  ),
  constraint client_form_responses_working_capital_cap_ck check (
    product_code <> 'working_capital' or requested_amount is null or requested_amount <= 100000000
  )
);

create table public.client_form_answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.client_form_responses(id) on delete cascade,
  section text not null check (section in ('business','person','product')),
  subject_key text not null default 'primary' check (subject_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  answer_key text not null check (answer_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  answer_value jsonb not null check (jsonb_typeof(answer_value) <> 'null'),
  source text not null check (source in ('client','owner')),
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_form_answers_unique unique (response_id, section, subject_key, answer_key)
);

create index client_form_responses_client_idx
  on public.client_form_responses (client_id, updated_at desc);
create index client_form_responses_deal_idx
  on public.client_form_responses (deal_id) where deal_id is not null;
create index client_form_answers_response_idx
  on public.client_form_answers (response_id, section, subject_key);

create trigger set_updated_at before update on public.client_form_responses
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.client_form_answers
  for each row execute function public.set_updated_at();
create trigger log_activity_client_form_responses
  after insert or update or delete on public.client_form_responses
  for each row execute function public.log_activity();

-- Answers may contain IDs, bank details or other sensitive client data. Audit
-- the mutation metadata, never the answer payload or before/after snapshot.
create or replace function public.log_client_form_answer_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.client_form_answers;
  v_event public.activity_event_type;
  v_actor uuid := (select auth.uid());
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  v_event := case tg_op when 'INSERT' then 'CREATE' when 'UPDATE' then 'UPDATE' else 'DELETE' end::public.activity_event_type;
  insert into public.activity_logs (
    user_id, user_email, user_role, event_type, entity_type, entity_id,
    description, related_entity_ids
  )
  select
    v_actor, p.email, p.role::text, v_event, 'client_form_answer', v_row.id,
    'Client form answer ' || lower(tg_op) || ' (' || v_row.section || ')',
    jsonb_build_array(v_row.response_id)
  from (select 1) seed
  left join public.profiles p on p.id = v_actor;
  return null;
end;
$$;
revoke execute on function public.log_client_form_answer_activity() from public, anon, authenticated;
create trigger log_activity_client_form_answers
  after insert or update or delete on public.client_form_answers
  for each row execute function public.log_client_form_answer_activity();

create or replace function public.validate_client_form_response_relationships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'submitted'
     and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    new.submitted_at := now();
  elsif new.status <> 'submitted' then
    new.submitted_at := null;
  end if;
  if new.deal_id is not null and not exists (
    select 1 from public.deals d where d.id = new.deal_id and d.client_id = new.client_id
  ) then
    raise exception 'The selected deal does not belong to this client';
  end if;
  if tg_op = 'UPDATE' and (
    new.client_id is distinct from old.client_id
    or new.deal_id is distinct from old.deal_id
    or new.created_by is distinct from old.created_by
  ) then
    raise exception 'Form ownership and deal identity are immutable';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'draft' and new is distinct from old then
    raise exception 'Submitted or superseded forms are immutable';
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_client_form_response_relationships() from public, anon, authenticated;
create trigger validate_client_form_response_relationships
  before insert or update on public.client_form_responses
  for each row execute function public.validate_client_form_response_relationships();

create or replace function public.validate_client_form_answer_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select r.status into v_status from public.client_form_responses r where r.id = new.response_id;
  if v_status is distinct from 'draft' then
    raise exception 'Answers can only be changed while the form is a draft';
  end if;
  if tg_op = 'UPDATE' and (
    new.response_id is distinct from old.response_id
    or new.created_by is distinct from old.created_by
    or new.source is distinct from old.source
  ) then
    raise exception 'Answer ownership and source are immutable';
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_client_form_answer_write() from public, anon, authenticated;
create trigger validate_client_form_answer_write
  before insert or update on public.client_form_answers
  for each row execute function public.validate_client_form_answer_write();

alter table public.client_form_responses enable row level security;
alter table public.client_form_answers enable row level security;
revoke all on table public.client_form_responses from public, anon, authenticated;
revoke all on table public.client_form_answers from public, anon, authenticated;
grant select, insert, update on table public.client_form_responses to authenticated;
grant select, insert, update on table public.client_form_answers to authenticated;

create policy "client_form_responses_owner_all"
  on public.client_form_responses for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy "client_form_responses_client_read"
  on public.client_form_responses for select to authenticated
  using (client_id = (select public.current_client_id()));
create policy "client_form_responses_client_insert"
  on public.client_form_responses for insert to authenticated
  with check (
    client_id = (select public.current_client_id())
    and created_by = (select auth.uid())
    and status = 'draft'
  );
create policy "client_form_responses_client_update"
  on public.client_form_responses for update to authenticated
  using (client_id = (select public.current_client_id()) and status = 'draft')
  with check (
    client_id = (select public.current_client_id())
    and created_by = (select auth.uid())
    and status in ('draft','submitted')
  );

create policy "client_form_answers_owner_all"
  on public.client_form_answers for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy "client_form_answers_client_read"
  on public.client_form_answers for select to authenticated
  using (exists (
    select 1 from public.client_form_responses r
    where r.id = response_id and r.client_id = (select public.current_client_id())
  ));
create policy "client_form_answers_client_insert"
  on public.client_form_answers for insert to authenticated
  with check (
    created_by = (select auth.uid()) and source = 'client'
    and exists (
      select 1 from public.client_form_responses r
      where r.id = response_id and r.client_id = (select public.current_client_id()) and r.status = 'draft'
    )
  );
create policy "client_form_answers_client_update"
  on public.client_form_answers for update to authenticated
  using (
    created_by = (select auth.uid()) and source = 'client'
    and exists (
      select 1 from public.client_form_responses r
      where r.id = response_id and r.client_id = (select public.current_client_id()) and r.status = 'draft'
    )
  )
  with check (
    created_by = (select auth.uid()) and source = 'client'
    and exists (
      select 1 from public.client_form_responses r
      where r.id = response_id and r.client_id = (select public.current_client_id()) and r.status = 'draft'
    )
  );

comment on table public.client_form_responses is
  'Canonical resumable client intake form header. Working-capital requests are capped at R100 million.';
comment on table public.client_form_answers is
  'Canonical business, person and product answers. Product-specific keys are stored without flattening sensitive answers into activity descriptions.';

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('client_form_responses','client_form_answers')
      and c.relrowsecurity
    group by n.nspname having count(*) = 2
  ) then
    raise exception 'PR 7: RLS missing from client form tables';
  end if;
  if has_table_privilege('anon', 'public.client_form_responses', 'SELECT')
     or has_table_privilege('anon', 'public.client_form_answers', 'SELECT')
     or has_table_privilege('authenticated', 'public.client_form_responses', 'DELETE')
     or has_table_privilege('authenticated', 'public.client_form_answers', 'DELETE') then
    raise exception 'PR 7: client form grants are excessive';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.client_form_responses'::regclass
      and conname = 'client_form_responses_working_capital_cap_ck'
  ) then
    raise exception 'PR 7: R100m working-capital cap is missing';
  end if;
end;
$$;
