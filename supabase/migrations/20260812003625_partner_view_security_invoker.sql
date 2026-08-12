-- C2: Four live Supabase Security Advisor errors.
-- Keep the existing security_barrier while forcing caller-context RLS.

alter view public.partner_submission_view
  set (security_invoker = true, security_barrier = true);
alter view public.partner_funder_industry_appetite
  set (security_invoker = true, security_barrier = true);
alter view public.partner_leads_view
  set (security_invoker = true, security_barrier = true);
alter view public.partner_stakeholders_view
  set (security_invoker = true, security_barrier = true);

do $$
declare
  v_name text;
  v_options text[];
begin
  foreach v_name in array array[
    'partner_submission_view',
    'partner_funder_industry_appetite',
    'partner_leads_view',
    'partner_stakeholders_view'
  ] loop
    select c.reloptions into v_options
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_name and c.relkind = 'v';
    if v_options is null or not ('security_invoker=true' = any(v_options)) then
      raise exception 'C2: %.% is not security_invoker', 'public', v_name;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
