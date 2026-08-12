-- Client portal secure inbox. This is intentionally separate from public.communications,
-- which remains an internal CRM interaction log and may contain private notes.

create table if not exists public.client_message_threads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete set null,
  subject text not null check (length(btrim(subject)) between 3 and 160),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_portal_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.client_message_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  sender_kind text not null check (sender_kind in ('client', 'owner')),
  body text not null check (length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index if not exists client_message_threads_client_updated_idx
  on public.client_message_threads (client_id, updated_at desc);
create index if not exists client_message_threads_deal_idx
  on public.client_message_threads (deal_id, updated_at desc)
  where deal_id is not null;
create index if not exists client_portal_messages_thread_created_idx
  on public.client_portal_messages (thread_id, created_at);

drop trigger if exists set_updated_at on public.client_message_threads;
create trigger set_updated_at before update on public.client_message_threads
  for each row execute function public.set_updated_at();

alter table public.client_message_threads enable row level security;
alter table public.client_portal_messages enable row level security;

drop policy if exists client_message_threads_owner_all on public.client_message_threads;
create policy client_message_threads_owner_all on public.client_message_threads
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

drop policy if exists client_message_threads_client_select_own on public.client_message_threads;
create policy client_message_threads_client_select_own on public.client_message_threads
  for select to authenticated
  using (client_id = (select public.current_client_id()));

drop policy if exists client_portal_messages_owner_all on public.client_portal_messages;
create policy client_portal_messages_owner_all on public.client_portal_messages
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

drop policy if exists client_portal_messages_client_select_own on public.client_portal_messages;
create policy client_portal_messages_client_select_own on public.client_portal_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.client_message_threads t
      where t.id = client_portal_messages.thread_id
        and t.client_id = (select public.current_client_id())
    )
  );

revoke all on table public.client_message_threads from public, anon, authenticated;
revoke all on table public.client_portal_messages from public, anon, authenticated;
grant select on table public.client_message_threads to authenticated;
grant select on table public.client_portal_messages to authenticated;
grant all on table public.client_message_threads to service_role;
grant all on table public.client_portal_messages to service_role;

create or replace function public.client_portal_message_workspace()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with identity as (
    select public.current_client_id() as client_id
  ), allowed_deals as (
    select d.id, d.reference, d.stage::text as stage
    from public.deals d
    join identity i on i.client_id = d.client_id
    where d.archived_at is null
    order by d.created_at desc
  ), allowed_threads as (
    select t.id, t.deal_id, t.subject, t.status, t.created_at, t.updated_at
    from public.client_message_threads t
    join identity i on i.client_id = t.client_id
    order by t.updated_at desc
  )
  select jsonb_build_object(
    'deals', coalesce((select jsonb_agg(to_jsonb(d)) from allowed_deals d), '[]'::jsonb),
    'threads', coalesce((
      select jsonb_agg(
        to_jsonb(t) || jsonb_build_object(
          'messages', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', m.id,
                'senderKind', m.sender_kind,
                'body', m.body,
                'createdAt', m.created_at
              ) order by m.created_at
            )
            from public.client_portal_messages m
            where m.thread_id = t.id
          ), '[]'::jsonb)
        )
      )
      from allowed_threads t
    ), '[]'::jsonb)
  )
  from identity i
  where i.client_id is not null;
$$;

create or replace function public.client_send_portal_message(
  p_body text,
  p_thread_id uuid default null,
  p_deal_id uuid default null,
  p_subject text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_client_id uuid := public.current_client_id();
  v_thread public.client_message_threads%rowtype;
begin
  if v_user_id is null or v_client_id is null then
    raise exception 'Active linked client access is required';
  end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'Message must contain between 1 and 5000 characters';
  end if;

  if p_thread_id is null then
    if length(btrim(coalesce(p_subject, ''))) not between 3 and 160 then
      raise exception 'Subject must contain between 3 and 160 characters';
    end if;
    if p_deal_id is not null and not exists (
      select 1 from public.deals d where d.id = p_deal_id and d.client_id = v_client_id
    ) then
      raise exception 'The selected deal is not available to this client';
    end if;
    insert into public.client_message_threads (client_id, deal_id, subject, created_by)
    values (v_client_id, p_deal_id, btrim(p_subject), v_user_id)
    returning * into v_thread;
  else
    select * into v_thread
    from public.client_message_threads t
    where t.id = p_thread_id and t.client_id = v_client_id;
    if v_thread.id is null then
      raise exception 'Conversation not found';
    end if;
    if v_thread.status <> 'open' then
      raise exception 'This conversation is closed';
    end if;
  end if;

  insert into public.client_portal_messages (thread_id, sender_id, sender_kind, body)
  values (v_thread.id, v_user_id, 'client', btrim(p_body));
  update public.client_message_threads set updated_at = now() where id = v_thread.id;

  insert into public.activity_logs (
    user_id, user_email, user_role, event_type, entity_type, entity_id,
    description, related_entity_ids
  )
  select p.id, p.email, p.role::text, 'CREATE', 'client_message_thread', v_thread.id,
    'Client portal message received',
    to_jsonb(array_remove(array[v_thread.client_id, v_thread.deal_id], null))
  from public.profiles p where p.id = v_user_id;

  return v_thread.id;
end;
$$;

create or replace function public.owner_send_client_portal_message(
  p_thread_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_message_id uuid;
begin
  if v_user_id is null or not public.is_owner() then
    raise exception 'Owner access required';
  end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'Message must contain between 1 and 5000 characters';
  end if;
  if not exists (
    select 1 from public.client_message_threads t
    where t.id = p_thread_id and t.status = 'open'
  ) then
    raise exception 'Open conversation not found';
  end if;

  insert into public.client_portal_messages (thread_id, sender_id, sender_kind, body)
  values (p_thread_id, v_user_id, 'owner', btrim(p_body))
  returning id into v_message_id;
  update public.client_message_threads set updated_at = now() where id = p_thread_id;
  return v_message_id;
end;
$$;

revoke all on function public.client_portal_message_workspace() from public, anon;
revoke all on function public.client_send_portal_message(text, uuid, uuid, text) from public, anon;
revoke all on function public.owner_send_client_portal_message(uuid, text) from public, anon;
grant execute on function public.client_portal_message_workspace() to authenticated;
grant execute on function public.client_send_portal_message(text, uuid, uuid, text) to authenticated;
grant execute on function public.owner_send_client_portal_message(uuid, text) to authenticated;

comment on table public.client_message_threads is
  'Portal-visible client-to-FNC conversations. Internal CRM communications and funder notes never belong here.';
comment on table public.client_portal_messages is
  'Portal-visible messages only. Sender kind is assigned by guarded database functions.';

do $$
begin
  if exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name in (
        'client_portal_message_workspace',
        'client_send_portal_message',
        'owner_send_client_portal_message'
      )
      and grantee in ('PUBLIC', 'anon')
      and privilege_type = 'EXECUTE'
  ) then
    raise exception 'Secure communications functions remain executable by PUBLIC/anon';
  end if;
end;
$$;
