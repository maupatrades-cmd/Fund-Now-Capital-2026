\set ON_ERROR_STOP on
begin;
do $$
declare v_missing text;v_bad text;
begin
  if not exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typnamespace='public'::regnamespace and t.typname='user_role' and e.enumlabel='client')then raise exception 'SMOKE: client role missing';end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='client_id')then raise exception 'SMOKE: profiles.client_id missing';end if;
  if to_regprocedure('public.current_client_id()') is null then raise exception 'SMOKE: current_client_id missing';end if;
  select string_agg(x,', ') into v_missing from unnest(array[
    'public.official_form_templates','public.official_form_field_mappings','public.generated_document_snapshots',
    'public.complete_document_reward_locks','public.potential_earning_snapshots','public.owner_earnings_waterfall_snapshots',
    'public.client_backend_smoke_runs'])x where to_regclass(x) is null;
  if v_missing is not null then raise exception 'SMOKE missing wave tables: %',v_missing;end if;
  select string_agg(n.nspname||'.'||c.relname,', ') into v_bad from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and(c.relname like 'client_%' or c.relname in('official_form_templates','official_form_field_mappings','generated_document_snapshots','complete_document_reward_locks','potential_earning_snapshots','owner_earnings_waterfall_snapshots'))and not c.relrowsecurity;
  if v_bad is not null then raise exception 'SMOKE RLS disabled: %',v_bad;end if;
  if exists(select 1 from information_schema.role_table_grants where table_schema='public' and grantee in('anon','PUBLIC') and table_name in('client_backend_smoke_runs','official_form_templates','official_form_field_mappings','generated_document_snapshots','complete_document_reward_locks','potential_earning_snapshots','owner_earnings_waterfall_snapshots'))then raise exception 'SMOKE anon or PUBLIC has sensitive table grant';end if;
  if has_function_privilege('anon','public.owner_lock_complete_document_reward(uuid,uuid,text)','EXECUTE')then raise exception 'SMOKE anon reward RPC';end if;
  if has_function_privilege('anon','public.owner_record_generated_document_snapshot(uuid,uuid,uuid,jsonb,jsonb,text,text)','EXECUTE')then raise exception 'SMOKE anon snapshot RPC';end if;
  if has_function_privilege('anon','public.potential_earnings_dashboard()','EXECUTE')then raise exception 'SMOKE anon earnings RPC';end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and tablename='complete_document_reward_locks' and indexdef ilike '%unique%(deal_id)%')then raise exception 'SMOKE R100 idempotency constraint missing';end if;
  raise notice 'Client backend structural/RLS smoke passed';
end$$;
rollback;
