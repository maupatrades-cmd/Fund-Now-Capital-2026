-- Build 74B: private, non-enumerating client magic-link request audit.

create table public.client_auth_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'accepted'
    check (status in ('accepted', 'sent', 'suppressed', 'failed', 'completed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  request_user_agent_hash text check (
    request_user_agent_hash is null or request_user_agent_hash ~ '^[0-9a-f]{64}$'
  ),
  failure_code text,
  constraint client_auth_requests_completion_ck check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create index client_auth_requests_email_time_idx
  on public.client_auth_requests (email_hash, requested_at desc);
create index client_auth_requests_ip_time_idx
  on public.client_auth_requests (ip_hash, requested_at desc)
  where ip_hash is not null;

alter table public.client_auth_requests enable row level security;
revoke all on table public.client_auth_requests from public, anon, authenticated;
grant select on table public.client_auth_requests to authenticated;

create policy "client_auth_requests_owner_read"
  on public.client_auth_requests for select to authenticated
  using (public.is_owner());

comment on table public.client_auth_requests is
  'Owner-readable, service-written audit and abuse-control ledger for client magic-link requests. Stores hashes, never raw request email or IP.';

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'client_auth_requests'
       and c.relrowsecurity
  ) then
    raise exception 'Build 74B: RLS missing on client_auth_requests';
  end if;

  if has_table_privilege('anon', 'public.client_auth_requests', 'SELECT')
     or has_table_privilege('anon', 'public.client_auth_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.client_auth_requests', 'INSERT') then
    raise exception 'Build 74B: auth request ledger has excessive Data API privileges';
  end if;
end;
$$;