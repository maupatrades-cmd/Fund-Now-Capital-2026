-- "Forgot password" for staff, agents and the Director (owner, 17 Nov 2026): abuse-control ledger for the
-- request-password-reset Edge Function. Same shape as client_auth_requests: hashes only (never the raw email or IP),
-- written by the service role inside the function, readable by the Director for audit. No profile FK on purpose
-- beyond set-null, so deleting a person never deletes the ledger.
create table public.password_reset_requests (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references public.profiles(id) on delete set null,
  email_hash   text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  ip_hash      text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  status       text not null default 'accepted' check (status in ('accepted', 'sent', 'suppressed', 'failed')),
  failure_code text,
  requested_at timestamptz not null default now()
);

create index password_reset_requests_email_time_idx on public.password_reset_requests (email_hash, requested_at desc);
create index password_reset_requests_ip_time_idx on public.password_reset_requests (ip_hash, requested_at desc)
  where ip_hash is not null;

alter table public.password_reset_requests enable row level security;
revoke all on table public.password_reset_requests from public, anon, authenticated;
grant select on table public.password_reset_requests to authenticated;

create policy password_reset_requests_owner_read
  on public.password_reset_requests for select to authenticated
  using (coalesce(public.is_owner(), false));

comment on table public.password_reset_requests is
  'Director-readable, service-written audit and throttle ledger for "Forgot password" requests. Stores hashes, never the raw email or IP.';
