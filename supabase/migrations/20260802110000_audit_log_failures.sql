-- ============================================================================
-- TEAM MANAGEMENT — audit_log_failures (POPIA audit safety net)
-- ============================================================================
-- The admin Edge Functions (admin-invite-user / admin-deactivate-user) write
-- their activity_logs (POPIA audit) row AFTER the primary, effectively
-- irreversible operation (Auth user created / user banned). If that audit
-- INSERT fails (DB blip, schema drift), hard-failing the request would
-- misreport a succeeded operation as failed — and Edge Function logs are
-- ephemeral, so a console.error alone is not a durable record.
--
-- This table is the persistent fallback: one row per failed audit write, so the
-- owner (or a future nightly sweep) can backfill the missing activity_logs
-- entry. The Edge Functions also console.error and return `audit_logged: false`
-- so the owner UI can surface a warning banner immediately.
--
-- Written ONLY by the Edge Functions' service-role client (bypasses RLS), never
-- by an API role — hence owner-read RLS with no INSERT/UPDATE/DELETE policy,
-- exactly like activity_logs.

-- Columns capture BOTH queryable metadata AND the full intended activity_logs
-- payload, so a later backfill sweep can reconstruct the missing POPIA row
-- verbatim (actor, event_type, description, and before/after values live in
-- `payload`). Without the payload the table could only say "a row is missing",
-- not what it should have contained.
create table if not exists public.audit_log_failures (
  id             uuid primary key default gen_random_uuid(),
  attempted_at   timestamptz not null default now(),
  edge_function  text not null,
  action         text not null,
  actor_user_id  uuid,
  actor_email    text,
  target_user_id uuid,
  event_type     text,
  description    text,
  payload        jsonb,          -- the complete intended activity_logs insert
  error_message  text,
  backfilled     boolean not null default false
);

alter table public.audit_log_failures enable row level security;

-- Owner-only read (operational visibility). No write policy: only the
-- service-role client writes, and it bypasses RLS.
drop policy if exists audit_log_failures_owner_read on public.audit_log_failures;
create policy audit_log_failures_owner_read
  on public.audit_log_failures for select
  using (public.is_owner());

-- Partial index for backfill sweeps (only the not-yet-backfilled rows).
create index if not exists audit_log_failures_pending_idx
  on public.audit_log_failures (attempted_at)
  where backfilled = false;

comment on table public.audit_log_failures is
  'Fallback ledger: one row each time an activity_logs (POPIA audit) write failed inside an admin Edge Function (invite/deactivate), so the missing entry can be backfilled. Service-role writes only; owner-read via RLS.';

-- ---------------------------------------------------------------------------
-- Self-check: RLS enabled + owner-read policy present.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'audit_log_failures' and c.relrowsecurity
  ) then
    raise exception 'audit_log_failures: RLS is not enabled';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'audit_log_failures'
       and policyname = 'audit_log_failures_owner_read'
  ) then
    raise exception 'audit_log_failures: owner-read policy missing';
  end if;
end;
$$;
