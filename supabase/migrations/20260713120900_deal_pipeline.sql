-- Deal pipeline (Kanban) support.

-- Priority flag (deals wrapped in the brand glow on the board) + free-text notes.
alter table public.deals add column is_priority boolean not null default false;
alter table public.deals add column notes text;

-- Rename to the pipeline's language: when the deal entered its current stage.
alter table public.deals rename column stage_changed_at to stage_entered_at;

-- Human-friendly auto reference: DEAL-001, DEAL-002, …
create sequence if not exists public.deals_reference_seq;

-- Stage history — one row per stage transition (incl. the initial New Lead).
create table public.deal_stage_history (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  from_stage public.deal_stage,
  to_stage public.deal_stage not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index idx_dsh_deal on public.deal_stage_history (deal_id);

-- BEFORE write: assign reference on insert; reset stage_entered_at whenever the
-- stage changes (so the board's "days in stage" is always accurate).
create or replace function public.deals_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.reference is null then
      new.reference := 'DEAL-' || lpad(nextval('public.deals_reference_seq')::text, 3, '0');
    end if;
    new.stage_entered_at := coalesce(new.stage_entered_at, now());
  elsif tg_op = 'UPDATE' then
    if new.stage is distinct from old.stage then
      new.stage_entered_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger deals_before_write
  before insert or update on public.deals
  for each row execute function public.deals_before_write();

-- AFTER write: log stage transitions. SECURITY DEFINER so history is written by
-- the system regardless of the caller's RLS (it's an audit trail, not user data).
create or replace function public.deals_log_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.deal_stage_history (deal_id, from_stage, to_stage, changed_by)
    values (new.id, null, new.stage, auth.uid());
  elsif tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    insert into public.deal_stage_history (deal_id, from_stage, to_stage, changed_by)
    values (new.id, old.stage, new.stage, auth.uid());
  end if;
  return null;
end;
$$;

revoke execute on function public.deals_log_stage() from public, anon, authenticated;

create trigger deals_log_stage
  after insert or update on public.deals
  for each row execute function public.deals_log_stage();

-- RLS on stage history: owners full; partners read history of their own deals.
alter table public.deal_stage_history enable row level security;

create policy "deal_stage_history_owner_all" on public.deal_stage_history
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy "deal_stage_history_partner_read_own" on public.deal_stage_history
  for select to authenticated
  using (
    exists (
      select 1 from public.deals d
      where d.id = deal_stage_history.deal_id
        and d.referral_partner_id = public.current_partner_id()
    )
  );
