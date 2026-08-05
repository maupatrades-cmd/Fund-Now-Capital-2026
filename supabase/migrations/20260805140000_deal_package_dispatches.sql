create table public.deal_package_dispatches(
 id uuid primary key default gen_random_uuid(), deal_id uuid not null references public.deals(id) on delete restrict,
 funder_id uuid not null references public.funders(id) on delete restrict,
 delivery_method text not null check(delivery_method in('email','portal','hand_delivery','other')),
 recipient text, notes text, sent_at timestamptz not null default now(),
 sent_by uuid not null default auth.uid() references public.profiles(id), created_at timestamptz not null default now()
);
create index deal_package_dispatches_deal_idx on public.deal_package_dispatches(deal_id,sent_at desc);
alter table public.deal_package_dispatches enable row level security;
create policy deal_package_dispatches_owner_select on public.deal_package_dispatches for select to authenticated using(public.is_owner());
create policy deal_package_dispatches_owner_insert on public.deal_package_dispatches for insert to authenticated with check(public.is_owner() and sent_by=auth.uid());
create trigger log_activity_deal_package_dispatches after insert on public.deal_package_dispatches for each row execute function public.log_activity();
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='deal_package_dispatches' and policyname='deal_package_dispatches_owner_insert') then raise exception 'assert: dispatch insert policy missing'; end if; end $$;
notify pgrst,'reload schema';
