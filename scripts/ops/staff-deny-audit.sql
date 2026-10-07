-- Read-only audit for the integrator: run in the Supabase SQL editor AFTER the
-- staff-build migrations are applied. Staff roles (switchboard / coordinator)
-- must be denied by default everywhere except the named SECURITY DEFINER
-- projections. Any row returned by sections 1-3 needs a human decision.
-- Makes no changes.

-- 1. Policies open to every signed-in user (a staff role would pass them).
--    Expected: only reference/lookup data (industries, badges, checklist types).
select schemaname, tablename, policyname, cmd, qual
  from pg_policies
 where schemaname in ('public', 'storage')
   and ('authenticated' = any (roles) or 'public' = any (roles))
   and (qual is null or qual in ('true', '(true)') or with_check in ('true', '(true)'))
 order by 1, 2, 3;

-- 2. Public tables with row level security switched OFF.
select c.relname as table_without_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
 order by 1;

-- 3. Storage policies that name no role helper at all (would admit staff).
select policyname, cmd, qual
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and coalesce(qual, '') !~ '(is_owner|current_partner_id|current_client_id|auth\.uid|owner_|my_)'
 order by 1;

-- 4. Confirm the staff-build objects exist and staff have no table grants beyond
--    SELECT-through-RLS (writes must be zero).
select table_name, string_agg(privilege_type, ', ' order by privilege_type) as authenticated_privileges
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'authenticated'
   and table_name in ('submission_intakes', 'submission_introducing_parties', 'intake_review_flags',
                      'intake_document_receipts', 'intake_document_flag_events', 'staff_audit_events')
 group by 1 order by 1;
