-- R100 qualified-submission reward payroll.
-- Reuses complete_document_reward_locks as the immutable eligibility source.
-- This migration adds scheduling/payment evidence only; it never changes a
-- locked reward or merges it into commission/invoice money.

create table public.qualified_reward_payout_batches (
  id uuid primary key default gen_random_uuid(),
  cycle_month date not null,
  selected_payday smallint not null check (selected_payday in (25, 30)),
  planned_for date not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'paid', 'cancelled')),
  payment_reference text,
  proof_storage_path text,
  owner_note text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  paid_by uuid references public.profiles(id) on delete restrict,
  paid_at timestamptz,
  unique (cycle_month, selected_payday),
  check (cycle_month = date_trunc('month', cycle_month)::date),
  check (extract(day from planned_for)::integer = selected_payday),
  check ((status = 'paid') = (paid_at is not null)),
  check (status <> 'paid' or (
    nullif(btrim(payment_reference), '') is not null
    and nullif(btrim(proof_storage_path), '') is not null
    and paid_by is not null
  ))
);

create table public.qualified_reward_payout_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.qualified_reward_payout_batches(id) on delete restrict,
  reward_lock_id uuid not null references public.complete_document_reward_locks(id) on delete restrict,
  amount numeric(14,2) not null check (amount = 100.00),
  scheduled_by uuid not null references public.profiles(id) on delete restrict,
  scheduled_at timestamptz not null default now(),
  unique (batch_id, reward_lock_id)
);

create table public.qualified_reward_payout_events (
  id uuid primary key default gen_random_uuid(),
  reward_lock_id uuid not null references public.complete_document_reward_locks(id) on delete restrict,
  batch_id uuid references public.qualified_reward_payout_batches(id) on delete restrict,
  event_type text not null
    check (event_type in ('scheduled', 'held', 'released', 'paid', 'carried_forward', 'reversed')),
  amount_delta numeric(14,2) not null,
  reason text,
  payment_reference text,
  proof_storage_path text,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  idempotency_key text not null unique,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  check ((event_type = 'reversed' and amount_delta = -100.00) or
         (event_type <> 'reversed' and amount_delta in (0.00, 100.00))),
  check (event_type <> 'paid' or (
    nullif(btrim(payment_reference), '') is not null
    and nullif(btrim(proof_storage_path), '') is not null
    and batch_id is not null
  )),
  check (event_type not in ('held', 'carried_forward', 'reversed') or
         nullif(btrim(reason), '') is not null)
);

create index qualified_reward_batches_cycle_idx
  on public.qualified_reward_payout_batches(cycle_month desc, planned_for);
create index qualified_reward_items_batch_idx
  on public.qualified_reward_payout_items(batch_id, scheduled_at);
create index qualified_reward_events_lock_idx
  on public.qualified_reward_payout_events(reward_lock_id, occurred_at desc, id desc);

alter table public.qualified_reward_payout_batches enable row level security;
alter table public.qualified_reward_payout_items enable row level security;
alter table public.qualified_reward_payout_events enable row level security;

revoke all on table public.qualified_reward_payout_batches,
  public.qualified_reward_payout_items,
  public.qualified_reward_payout_events from public, anon, authenticated;
grant select on table public.qualified_reward_payout_batches,
  public.qualified_reward_payout_items,
  public.qualified_reward_payout_events to authenticated;

create policy qualified_reward_batches_owner_read
  on public.qualified_reward_payout_batches for select to authenticated
  using (public.is_owner());

create policy qualified_reward_items_owner_read
  on public.qualified_reward_payout_items for select to authenticated
  using (public.is_owner());
create policy qualified_reward_items_beneficiary_read
  on public.qualified_reward_payout_items for select to authenticated
  using (exists (
    select 1 from public.complete_document_reward_locks reward
    where reward.id = reward_lock_id
      and reward.beneficiary_profile_id = (select auth.uid())
  ));

create policy qualified_reward_events_owner_read
  on public.qualified_reward_payout_events for select to authenticated
  using (public.is_owner());
create policy qualified_reward_events_beneficiary_read
  on public.qualified_reward_payout_events for select to authenticated
  using (exists (
    select 1 from public.complete_document_reward_locks reward
    where reward.id = reward_lock_id
      and reward.beneficiary_profile_id = (select auth.uid())
  ));

create or replace function public.qualified_reward_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'R100 reward payout evidence is append-only';
end;
$$;

create trigger qualified_reward_items_append_only
before update or delete on public.qualified_reward_payout_items
for each row execute function public.qualified_reward_append_only();
create trigger qualified_reward_events_append_only
before update or delete on public.qualified_reward_payout_events
for each row execute function public.qualified_reward_append_only();

create or replace function public.owner_schedule_qualified_reward_batch(
  p_cycle_month date,
  p_selected_payday integer,
  p_owner_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cycle date := date_trunc('month', p_cycle_month)::date;
  v_planned date;
  v_batch public.qualified_reward_payout_batches;
  v_count integer;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can schedule R100 reward payouts' using errcode = '42501';
  end if;
  if p_selected_payday not in (25, 30) then
    raise exception 'Payout day must be the 25th or 30th';
  end if;
  begin
    v_planned := make_date(extract(year from v_cycle)::integer,
                           extract(month from v_cycle)::integer,
                           p_selected_payday);
  exception when datetime_field_overflow then
    raise exception 'The selected month has no %th day; choose the 25th', p_selected_payday;
  end;

  insert into public.qualified_reward_payout_batches(
    cycle_month, selected_payday, planned_for, owner_note, created_by
  ) values (
    v_cycle, p_selected_payday, v_planned, nullif(btrim(p_owner_note), ''), (select auth.uid())
  )
  on conflict (cycle_month, selected_payday) do update
    set owner_note = coalesce(excluded.owner_note, public.qualified_reward_payout_batches.owner_note)
  returning * into v_batch;

  insert into public.qualified_reward_payout_items(
    batch_id, reward_lock_id, amount, scheduled_by
  )
  select v_batch.id, reward.id, reward.amount, (select auth.uid())
  from public.complete_document_reward_locks reward
  where (
    reward.cutoff_date = (v_cycle + interval '21 days')::date
    and not exists (
      select 1 from public.qualified_reward_payout_items existing
      where existing.reward_lock_id = reward.id
    )
  ) or (
    exists (
      select 1 from public.qualified_reward_payout_events carry
      where carry.reward_lock_id = reward.id
        and carry.event_type = 'carried_forward'
        and not exists (
          select 1 from public.qualified_reward_payout_events later
          where later.reward_lock_id = reward.id
            and (later.occurred_at, later.id) > (carry.occurred_at, carry.id)
        )
    )
    and not exists (
      select 1 from public.qualified_reward_payout_items current_item
      where current_item.reward_lock_id = reward.id
        and current_item.batch_id = v_batch.id
    )
  );
  get diagnostics v_count = row_count;

  insert into public.qualified_reward_payout_events(
    reward_lock_id, batch_id, event_type, amount_delta, actor_id,
    idempotency_key, evidence
  )
  select item.reward_lock_id, v_batch.id, 'scheduled', 100.00, (select auth.uid()),
         'reward-scheduled:' || v_batch.id::text || ':' || item.reward_lock_id::text,
         jsonb_build_object('cycle_month', v_cycle, 'planned_for', v_planned,
                            'selected_payday', p_selected_payday)
  from public.qualified_reward_payout_items item
  where item.batch_id = v_batch.id
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('batch_id', v_batch.id, 'scheduled_count', v_count,
                            'planned_for', v_planned);
end;
$$;

create or replace function public.owner_record_qualified_reward_action(
  p_reward_lock_id uuid,
  p_event_type text,
  p_reason text,
  p_idempotency_key text,
  p_evidence jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.qualified_reward_payout_items;
  v_event_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can manage R100 reward payouts' using errcode = '42501';
  end if;
  if p_event_type not in ('held', 'released', 'carried_forward', 'reversed') then
    raise exception 'Unsupported reward action';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Idempotency key is required';
  end if;
  if jsonb_typeof(coalesce(p_evidence, '{}'::jsonb)) <> 'object' then
    raise exception 'Evidence must be a JSON object';
  end if;
  select * into v_item from public.qualified_reward_payout_items
   where reward_lock_id = p_reward_lock_id
   order by scheduled_at desc limit 1;
  if not found then raise exception 'Reward has not been scheduled'; end if;
  if p_event_type = 'reversed' and exists (
    select 1 from public.qualified_reward_payout_events
    where reward_lock_id = p_reward_lock_id and event_type = 'reversed'
  ) then raise exception 'Reward is already reversed'; end if;

  insert into public.qualified_reward_payout_events(
    reward_lock_id, batch_id, event_type, amount_delta, reason,
    actor_id, idempotency_key, evidence
  ) values (
    p_reward_lock_id, v_item.batch_id, p_event_type,
    case when p_event_type = 'reversed' then -100.00 else 0.00 end,
    nullif(btrim(p_reason), ''), (select auth.uid()), btrim(p_idempotency_key),
    coalesce(p_evidence, '{}'::jsonb)
  ) on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
  returning id into v_event_id;
  return v_event_id;
end;
$$;

create or replace function public.owner_mark_qualified_reward_batch_paid(
  p_batch_id uuid,
  p_payment_reference text,
  p_proof_storage_path text,
  p_owner_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.qualified_reward_payout_batches;
  v_paid integer;
  v_remaining integer;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can record R100 reward payment' using errcode = '42501';
  end if;
  if nullif(btrim(p_payment_reference), '') is null
     or nullif(btrim(p_proof_storage_path), '') is null then
    raise exception 'Payment reference and proof of payment are required';
  end if;
  select * into v_batch from public.qualified_reward_payout_batches
   where id = p_batch_id for update;
  if not found then raise exception 'Reward payout batch not found'; end if;
  if v_batch.status = 'paid' then
    return jsonb_build_object('batch_id', v_batch.id, 'already_paid', true);
  end if;

  insert into public.qualified_reward_payout_events(
    reward_lock_id, batch_id, event_type, amount_delta, payment_reference,
    proof_storage_path, actor_id, idempotency_key, evidence
  )
  select item.reward_lock_id, v_batch.id, 'paid', 0.00,
         btrim(p_payment_reference), btrim(p_proof_storage_path), (select auth.uid()),
         'reward-paid:' || item.reward_lock_id::text,
         jsonb_build_object('batch_id', v_batch.id, 'paid_at', now())
  from public.qualified_reward_payout_items item
  where item.batch_id = v_batch.id
    and not exists (
      select 1 from public.qualified_reward_payout_events held
      where held.reward_lock_id = item.reward_lock_id
        and held.event_type = 'held'
        and not exists (
          select 1 from public.qualified_reward_payout_events released
          where released.reward_lock_id = item.reward_lock_id
            and released.event_type = 'released'
            and released.occurred_at > held.occurred_at
        )
    )
    and not exists (
      select 1 from public.qualified_reward_payout_events reversed
      where reversed.reward_lock_id = item.reward_lock_id and reversed.event_type = 'reversed'
    )
  on conflict (idempotency_key) do nothing;
  get diagnostics v_paid = row_count;

  select count(*) into v_remaining
  from public.qualified_reward_payout_items item
  where item.batch_id = v_batch.id
    and not exists (
      select 1 from public.qualified_reward_payout_events terminal
      where terminal.reward_lock_id = item.reward_lock_id
        and terminal.event_type in ('paid', 'reversed')
    );

  update public.qualified_reward_payout_batches set
    status = case when v_remaining = 0 then 'paid' else 'processing' end,
    payment_reference = btrim(p_payment_reference),
    proof_storage_path = btrim(p_proof_storage_path),
    owner_note = coalesce(nullif(btrim(p_owner_note), ''), owner_note),
    paid_by = case when v_remaining = 0 then (select auth.uid()) else null end,
    paid_at = case when v_remaining = 0 then now() else null end
  where id = v_batch.id;

  return jsonb_build_object('batch_id', v_batch.id, 'paid_count', v_paid,
                            'remaining_count', v_remaining,
                            'payment_reference', btrim(p_payment_reference));
end;
$$;

create or replace function public.qualified_reward_workspace()
returns table (
  reward_lock_id uuid, deal_id uuid, lead_id uuid,
  beneficiary_profile_id uuid, beneficiary_name text, beneficiary_role text,
  partner_organisation_id uuid, amount numeric, locked_at timestamptz,
  cutoff_date date, payout_date date, batch_id uuid, current_status text,
  payment_reference text, proof_storage_path text, last_event_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return query
  select reward.id, reward.deal_id, reward.lead_id,
         reward.beneficiary_profile_id, profile.full_name, reward.beneficiary_role,
         coalesce(profile.sourced_via_partner_id, lead.referral_partner_id),
         reward.amount, reward.locked_at, reward.cutoff_date, batch.planned_for,
         batch.id,
         coalesce(latest.event_type, case when item.id is null then 'locked' else 'scheduled' end),
         latest.payment_reference, latest.proof_storage_path, latest.occurred_at
  from public.complete_document_reward_locks reward
  join public.profiles profile on profile.id = reward.beneficiary_profile_id
  left join public.leads lead on lead.id = reward.lead_id
  left join lateral (
    select scheduled.* from public.qualified_reward_payout_items scheduled
    where scheduled.reward_lock_id = reward.id
    order by scheduled.scheduled_at desc limit 1
  ) item on true
  left join public.qualified_reward_payout_batches batch on batch.id = item.batch_id
  left join lateral (
    select event.event_type, event.payment_reference, event.proof_storage_path,
           event.occurred_at
    from public.qualified_reward_payout_events event
    where event.reward_lock_id = reward.id
    order by event.occurred_at desc, event.id desc limit 1
  ) latest on true
  where public.is_owner() or reward.beneficiary_profile_id = v_uid
  order by reward.locked_at desc;
end;
$$;

revoke all on function public.qualified_reward_append_only() from public, anon, authenticated;
revoke all on function public.owner_schedule_qualified_reward_batch(date, integer, text) from public, anon, authenticated;
revoke all on function public.owner_record_qualified_reward_action(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.owner_mark_qualified_reward_batch_paid(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.qualified_reward_workspace() from public, anon, authenticated;
grant execute on function public.owner_schedule_qualified_reward_batch(date, integer, text) to authenticated;
grant execute on function public.owner_record_qualified_reward_action(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.owner_mark_qualified_reward_batch_paid(uuid, text, text, text) to authenticated;
grant execute on function public.qualified_reward_workspace() to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.qualified_reward_payout_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.qualified_reward_payout_items', 'UPDATE') then
    raise exception 'R100 payroll tables must not allow direct authenticated writes';
  end if;
  if has_function_privilege('anon', 'public.qualified_reward_workspace()', 'EXECUTE')
     or has_function_privilege('anon', 'public.owner_mark_qualified_reward_batch_paid(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'Anonymous R100 payroll access is forbidden';
  end if;
end $$;

notify pgrst, 'reload schema';
