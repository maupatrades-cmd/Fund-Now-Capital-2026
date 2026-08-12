-- C9: If the C8 legal gate is installed and enabled, R100 cannot lock before readiness.
-- Uses to_regprocedure so this PR remains mergeable before or after C8.

create or replace function public.enforce_reward_legal_readiness()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  if to_regprocedure('public.crm_compute_deal_dispatch_readiness(uuid)') is not null then
    execute 'select public.crm_compute_deal_dispatch_readiness($1)' into v_result using new.deal_id;
    if coalesce((v_result->>'enforced')::boolean,false)
       and not coalesce((v_result->>'ready')::boolean,false) then
      raise exception 'R100 reward cannot lock before legal and document dispatch readiness';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_reward_legal_readiness()
  from public,anon,authenticated;

drop trigger if exists enforce_reward_legal_readiness
  on public.complete_document_reward_locks;
create trigger enforce_reward_legal_readiness
before insert on public.complete_document_reward_locks
for each row execute function public.enforce_reward_legal_readiness();

do $$ begin
  if not exists(
    select 1 from pg_trigger
    where tgrelid='public.complete_document_reward_locks'::regclass
      and tgname='enforce_reward_legal_readiness' and not tgisinternal
  ) then raise exception 'C9: reward readiness trigger missing'; end if;
end $$;
