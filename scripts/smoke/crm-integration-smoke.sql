-- C12: Transactional structural smoke test. Read-only assertions; always rolls back.
begin;

do $$
declare
  v_table text;
  v_view text;
begin
  foreach v_table in array array[
    'owner_tasks','owner_availability_slots','crm_bookings','crm_reminder_events',
    'crm_legal_execution_events','crm_integration_settings',
    'complete_document_reward_locks','funder_invoice_dispatches'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'C12 smoke: missing table public.%', v_table;
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || v_table)) then
      raise exception 'C12 smoke: RLS disabled on public.%', v_table;
    end if;
  end loop;

  foreach v_view in array array[
    'partner_submission_view','partner_funder_industry_appetite',
    'partner_leads_view','partner_stakeholders_view'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v_view and c.relkind='v'
        and 'security_invoker=true'=any(coalesce(c.reloptions,array[]::text[]))
    ) then
      raise exception 'C12 smoke: public.% is not security_invoker', v_view;
    end if;
  end loop;

  if has_table_privilege('authenticated','public.crm_bookings','INSERT,UPDATE,DELETE') then
    raise exception 'C12 smoke: direct booking writes exposed';
  end if;
  if has_table_privilege('authenticated','public.crm_legal_execution_events','INSERT') then
    raise exception 'C12 smoke: browser can forge legal execution';
  end if;
  if has_table_privilege('authenticated','public.crm_reminder_events','INSERT,UPDATE,DELETE') then
    raise exception 'C12 smoke: direct reminder writes exposed';
  end if;
  if to_regprocedure('public.request_owner_booking(uuid,text,text,uuid,uuid)') is null then
    raise exception 'C12 smoke: booking RPC is missing or its signature drifted';
  end if;
  if has_function_privilege('anon','public.request_owner_booking(uuid,text,text,uuid,uuid)','EXECUTE') then
    raise exception 'C12 smoke: anonymous booking RPC exposed';
  end if;
  if to_regprocedure('public.owner_funder_invoice_dispatch_health()') is null then
    raise exception 'C12 smoke: invoice health RPC is missing or its signature drifted';
  end if;
  if has_function_privilege('anon','public.owner_funder_invoice_dispatch_health()','EXECUTE') then
    raise exception 'C12 smoke: anonymous invoice health RPC exposed';
  end if;
end;
$$;

rollback;
