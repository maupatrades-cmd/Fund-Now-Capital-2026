-- Owner-only servicing ledger. It does not alter commissions or invoices.
create table public.repayment_schedules (
  id uuid primary key default gen_random_uuid(),
  deal_funder_submission_id uuid not null unique references public.deal_funder_submissions(id) on delete restrict,
  principal_amount numeric(14,2) not null check (principal_amount > 0),
  total_repayable numeric(14,2) not null check (total_repayable >= principal_amount),
  instalment_count integer not null check (instalment_count between 1 and 120),
  first_due_date date not null,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.repayment_instalments (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.repayment_schedules(id) on delete restrict,
  instalment_number integer not null, due_date date not null,
  amount_due numeric(14,2) not null check (amount_due > 0),
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  paid_at timestamptz, payment_reference text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(schedule_id, instalment_number)
);
create index repayment_instalments_due_idx on public.repayment_instalments(due_date) where amount_paid = 0;
alter table public.repayment_schedules enable row level security;
alter table public.repayment_instalments enable row level security;
create policy repayment_schedules_owner_select on public.repayment_schedules for select to authenticated using(public.is_owner());
create policy repayment_instalments_owner_select on public.repayment_instalments for select to authenticated using(public.is_owner());
revoke all on table public.repayment_schedules, public.repayment_instalments from public,anon,authenticated;
grant select on table public.repayment_schedules, public.repayment_instalments to authenticated;
grant all on table public.repayment_schedules, public.repayment_instalments to service_role;
create trigger set_updated_at before update on public.repayment_schedules for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.repayment_instalments for each row execute function public.set_updated_at();
create trigger log_activity_repayment_schedules after insert or update or delete on public.repayment_schedules for each row execute function public.log_activity();
create trigger log_activity_repayment_instalments after insert or update or delete on public.repayment_instalments for each row execute function public.log_activity();

create function public.owner_create_repayment_schedule(p_submission_id uuid,p_total_repayable numeric,p_instalment_count integer,p_first_due_date date)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_sub public.deal_funder_submissions; v_id uuid; v_total numeric(14,2); v_each numeric(14,2); i integer;
begin
  if not public.is_owner() then raise exception 'Only the owner can create schedules' using errcode='42501'; end if;
  select * into v_sub from public.deal_funder_submissions where id=p_submission_id for update;
  if not found or v_sub.amount_funded is null then raise exception 'A funded submission is required'; end if;
  v_total:=round(p_total_repayable,2);
  if v_total is null or v_total < v_sub.amount_funded or p_instalment_count not between 1 and 120 then raise exception 'Invalid repayment terms'; end if;
  if v_total < p_instalment_count * 0.01 then raise exception 'Total repayable is too small for the number of instalments'; end if;
  insert into public.repayment_schedules(deal_funder_submission_id,principal_amount,total_repayable,instalment_count,first_due_date)
  values(p_submission_id,v_sub.amount_funded,v_total,p_instalment_count,p_first_due_date) returning id into v_id;
  -- Truncate regular instalments to cents so rounding can never over-allocate;
  -- the final instalment receives the exact positive remainder.
  v_each:=trunc(v_total/p_instalment_count,2);
  for i in 1..p_instalment_count loop
    insert into public.repayment_instalments(schedule_id,instalment_number,due_date,amount_due)
    values(v_id,i,(p_first_due_date+make_interval(months=>i-1))::date,case when i=p_instalment_count then v_total-v_each*(p_instalment_count-1) else v_each end);
  end loop;
  return v_id;
end $$;

create function public.owner_record_repayment(p_instalment_id uuid,p_amount numeric,p_reference text default null)
returns public.repayment_instalments language plpgsql security definer set search_path='' as $$
declare v_row public.repayment_instalments;
begin
  if not public.is_owner() then raise exception 'Only the owner can record repayments' using errcode='42501'; end if;
  if p_amount <= 0 then raise exception 'Payment amount must be positive'; end if;
  select * into v_row from public.repayment_instalments where id=p_instalment_id and paid_at is null for update;
  if not found then raise exception 'Open instalment not found'; end if;
  if round(p_amount,2) <> v_row.amount_due then raise exception 'This first version records full instalment payments only; amount must equal %', v_row.amount_due; end if;
  update public.repayment_instalments set amount_paid=v_row.amount_due,paid_at=now(),payment_reference=nullif(btrim(p_reference),'') where id=p_instalment_id returning * into v_row;
  update public.repayment_schedules s set status='completed' where s.id=v_row.schedule_id and not exists(select 1 from public.repayment_instalments i where i.schedule_id=s.id and i.amount_paid<i.amount_due);
  return v_row;
end $$;
revoke all on function public.owner_create_repayment_schedule(uuid,numeric,integer,date) from public,anon;
revoke all on function public.owner_record_repayment(uuid,numeric,text) from public,anon;
grant execute on function public.owner_create_repayment_schedule(uuid,numeric,integer,date) to authenticated,service_role;
grant execute on function public.owner_record_repayment(uuid,numeric,text) to authenticated,service_role;
do $$ begin
  if has_function_privilege('anon','public.owner_record_repayment(uuid,numeric,text)','execute') then raise exception 'assert: anon repayment access'; end if;
  if has_table_privilege('authenticated','public.repayment_schedules','INSERT') or has_table_privilege('authenticated','public.repayment_instalments','UPDATE') then raise exception 'assert: direct repayment writes must be blocked'; end if;
end $$;
notify pgrst,'reload schema';
