-- PR12: production-safe evidence registry for backend smoke executions.
create table public.client_backend_smoke_runs(
 id uuid primary key default gen_random_uuid(),wave text not null,git_sha text not null check(git_sha~'^[0-9a-f]{7,40}$'),
 environment text not null check(environment in('local','preview','staging','production')),
 status text not null check(status in('passed','failed')),checks jsonb not null check(jsonb_typeof(checks)='array'),
 failure_summary text,run_at timestamptz not null default now(),constraint smoke_failure_ck check((status='passed' and failure_summary is null)or(status='failed' and failure_summary is not null)));
create index client_backend_smoke_runs_time_idx on public.client_backend_smoke_runs(run_at desc);
alter table public.client_backend_smoke_runs enable row level security;revoke all on table public.client_backend_smoke_runs from public,anon,authenticated;
grant select on table public.client_backend_smoke_runs to authenticated;grant insert on table public.client_backend_smoke_runs to service_role;
create policy client_backend_smoke_runs_owner_read on public.client_backend_smoke_runs for select to authenticated using(public.is_owner());
do $$begin if not(select relrowsecurity from pg_class where oid='public.client_backend_smoke_runs'::regclass)then raise exception 'PR12 RLS missing';end if;if has_table_privilege('anon','public.client_backend_smoke_runs','SELECT')or has_table_privilege('authenticated','public.client_backend_smoke_runs','INSERT')then raise exception 'PR12 excessive grants';end if;end$$;
notify pgrst,'reload schema';