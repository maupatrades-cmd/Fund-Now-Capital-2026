-- Security hardening for two functions flagged by the Supabase advisors.
--
-- 1. set_updated_at(): pin an empty search_path so the function can't be
--    hijacked via a mutable search_path (lint 0011_function_search_path_mutable).
--    Body only calls now() (pg_catalog), so an empty search_path is safe.
-- 2. handle_new_user(): it is a trigger function and never needs to be callable
--    over the REST API. Trigger execution does not require the EXECUTE privilege,
--    so revoking it from anon/authenticated (and PUBLIC) closes the RPC surface
--    (lints 0028/0029 anon/authenticated_security_definer_function_executable)
--    without affecting the on_auth_user_created trigger.
--
-- Note: is_owner() and current_partner_id() are intentionally left executable —
-- RLS policies call them as the querying role, so authenticated MUST keep EXECUTE.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
