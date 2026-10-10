-- A deal has one payout route. Calculations and manual drafts remain available;
-- the first recorded payment fixes its route permanently. Accounting reversal
-- is not proof that cash was recovered, so it must not reopen the other route.
-- This is duplicate-payment protection, not the complete override workflow.
create table public.commission_payment_routes (
  deal_id uuid primary key references public.deals(id) on delete restrict,
  route text not null check (route in ('automatic', 'manual')),
  first_payment_record_id uuid not null,
  claimed_at timestamptz not null default now()
);
alter table public.commission_payment_routes enable row level security;
revoke all on public.commission_payment_routes from public, anon, authenticated;

-- Refuse to hide existing cross-ledger payments. Resolve historical conflicts
-- explicitly before retrying; do not pick a winner or rewrite payment evidence.
lock table public.commission_records, public.owner_commission_entries in share row exclusive mode;
do $$
begin
  if exists (
    select 1 from public.commission_records a
    join public.owner_commission_entries m on m.deal_id = a.deal_id
    where (a.status::text = 'settled' or a.settled_at is not null)
      and (m.status = 'paid' or m.paid_at is not null)
  ) then
    raise exception 'Existing payments use both commission ledgers for a deal; reconcile payment history before installing the route guard';
  end if;
end;
$$;

insert into public.commission_payment_routes (deal_id, route, first_payment_record_id, claimed_at)
select distinct on (deal_id) deal_id, route, id, coalesce(paid_at, now())
from (
  select deal_id, 'automatic'::text as route, id, settled_at as paid_at
  from public.commission_records where status::text = 'settled' or settled_at is not null
  union all
  select deal_id, 'manual'::text, id, paid_at
  from public.owner_commission_entries where status = 'paid' or paid_at is not null
) history
order by deal_id, paid_at nulls last, id;

create function public.commission_payment_route_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Commission payment route is permanent payment evidence';
end;
$$;
revoke all on function public.commission_payment_route_immutable() from public, anon, authenticated;
create trigger commission_payment_route_immutable
before update or delete on public.commission_payment_routes
for each row execute function public.commission_payment_route_immutable();

create function public.enforce_commission_payment_route()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_route text;
  v_existing text;
begin
  if tg_table_schema <> 'public' then
    raise exception 'Unexpected commission payment route trigger target';
  end if;
  if tg_table_name = 'commission_records' then
    if new.status::text <> 'settled' and new.settled_at is null then return new; end if;
    v_route := 'automatic';
  elsif tg_table_name = 'owner_commission_entries' then
    if new.status <> 'paid' and new.paid_at is null then return new; end if;
    v_route := 'manual';
  else
    raise exception 'Unexpected commission payment route trigger target';
  end if;

  -- The unique deal key serializes competing claims, including payments made
  -- through different RPCs or invoice types. A losing transaction is rolled
  -- back with its invoice state and audit/notification writes.
  insert into public.commission_payment_routes (deal_id, route, first_payment_record_id)
  values (new.deal_id, v_route, new.id)
  on conflict (deal_id) do nothing;
  select route into v_existing from public.commission_payment_routes where deal_id = new.deal_id;
  if v_existing is distinct from v_route then
    raise exception 'This deal already uses the % commission payment route; payment through the % route is blocked', v_existing, v_route;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_commission_payment_route() from public, anon, authenticated;

create trigger commission_payment_route_guard
after insert or update on public.commission_records
for each row execute function public.enforce_commission_payment_route();
create trigger commission_payment_route_guard
after insert or update on public.owner_commission_entries
for each row execute function public.enforce_commission_payment_route();
