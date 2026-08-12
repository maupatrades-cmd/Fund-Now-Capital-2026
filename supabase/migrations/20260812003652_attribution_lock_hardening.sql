-- C3: A locked lead attribution is historical evidence and cannot be rewritten.

create or replace function public.prevent_locked_lead_attribution_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.lead_attribution_events e
    where e.lead_id = old.id and e.event_type = 'locked'
  ) and (
    new.referral_partner_id is distinct from old.referral_partner_id
    or new.attributed_to_partner_id is distinct from old.attributed_to_partner_id
    or new.attributed_to_contractor_id is distinct from old.attributed_to_contractor_id
    or new.attributed_to_lead_referrer_id is distinct from old.attributed_to_lead_referrer_id
    or new.attribution_source is distinct from old.attribution_source
  ) then
    raise exception 'Locked lead attribution is immutable. Create a governed compensating event instead.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_locked_lead_attribution_rewrite()
  from public, anon, authenticated;

drop trigger if exists prevent_locked_lead_attribution_rewrite on public.leads;
create trigger prevent_locked_lead_attribution_rewrite
before update on public.leads
for each row execute function public.prevent_locked_lead_attribution_rewrite();

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.leads'::regclass
      and tgname = 'prevent_locked_lead_attribution_rewrite'
      and not tgisinternal
  ) then
    raise exception 'C3: attribution immutability trigger missing';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.prevent_locked_lead_attribution_rewrite()',
    'execute'
  ) then
    raise exception 'C3: trigger function must not be API executable';
  end if;
end;
$$;
