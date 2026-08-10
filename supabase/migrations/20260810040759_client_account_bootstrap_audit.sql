-- Client backend PR 6: owner-verified client account bootstrap audit.

create table public.client_account_bootstraps (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  client_contact_id uuid not null references public.client_contacts(id) on delete restrict,
  profile_id uuid references public.profiles(id) on delete set null,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'requested'
    check (status in ('requested','account_created','welcome_sent','welcome_failed')),
  requested_at timestamptz not null default now(),
  account_created_at timestamptz,
  welcome_sent_at timestamptz,
  failure_code text,
  updated_at timestamptz not null default now(),
  constraint client_account_bootstraps_state_ck check (
    (status = 'requested' and account_created_at is null and welcome_sent_at is null)
    or (status in ('account_created','welcome_failed') and account_created_at is not null and welcome_sent_at is null)
    or (status = 'welcome_sent' and account_created_at is not null and welcome_sent_at is not null)
  )
);

create index client_account_bootstraps_client_idx
  on public.client_account_bootstraps (client_id, requested_at desc);
create index client_account_bootstraps_profile_idx
  on public.client_account_bootstraps (profile_id, requested_at desc)
  where profile_id is not null;
create unique index client_account_bootstraps_one_active_profile_idx
  on public.client_account_bootstraps (profile_id)
  where profile_id is not null and status in ('account_created','welcome_sent');

create trigger set_updated_at before update on public.client_account_bootstraps
  for each row execute function public.set_updated_at();
create trigger log_activity_client_account_bootstraps
  after insert or update or delete on public.client_account_bootstraps
  for each row execute function public.log_activity();

alter table public.client_account_bootstraps enable row level security;
revoke all on table public.client_account_bootstraps from public, anon, authenticated;
grant select on table public.client_account_bootstraps to authenticated;

create policy "client_account_bootstraps_owner_read"
  on public.client_account_bootstraps for select to authenticated
  using ((select public.is_owner()));

comment on table public.client_account_bootstraps is
  'Owner-readable, service-written audit ledger for verified client account creation and welcome delivery. Raw email is never stored.';

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'client_account_bootstraps' and c.relrowsecurity
  ) then
    raise exception 'PR 6: RLS is not enabled on client_account_bootstraps';
  end if;
  if has_table_privilege('anon', 'public.client_account_bootstraps', 'SELECT')
     or has_table_privilege('authenticated', 'public.client_account_bootstraps', 'INSERT')
     or has_table_privilege('authenticated', 'public.client_account_bootstraps', 'UPDATE')
     or has_table_privilege('authenticated', 'public.client_account_bootstraps', 'DELETE') then
    raise exception 'PR 6: bootstrap ledger has excessive Data API grants';
  end if;
end;
$$;