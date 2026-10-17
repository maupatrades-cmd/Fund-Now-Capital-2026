-- Direct Referral Agent Agreement Schedule 1 Part A and Sub-Agent Agreement
-- Schedule 1 Part A: R100 Submission Fees are monthly in arrears, by the 15th
-- of the following month. This changes only the R100 payout calendar.
-- Apply AFTER r100_reward_payroll_workspace. The old migration is preserved.
-- No existing lock, eligibility evidence, payment or commission amount is changed.
-- The legacy lock source still requires funder dispatch. Staff Complete-event
-- eligibility and the client-wide six-month limit need their own reconciliation;
-- this calendar change does not declare that integration complete.

-- The original payroll migration has not been activated. If another operator has
-- created batches, stop for explicit reconciliation instead of rewriting history.
do $$ begin
  if exists (select 1 from public.qualified_reward_payout_batches) then
    raise exception 'Existing R100 payout batches need calendar reconciliation before applying this migration';
  end if;
end $$;

alter table public.qualified_reward_payout_batches
  drop constraint qualified_reward_payout_batches_selected_payday_check,
  add constraint qualified_reward_payout_batches_selected_payday_check
    check (selected_payday = 15),
  add constraint qualified_reward_payout_batches_following_month_check
    check (planned_for = (cycle_month + interval '1 month 14 days')::date);

comment on column public.qualified_reward_payout_batches.cycle_month is
  'Month of the immutable R100 lock in Africa/Johannesburg; payment due by the following month 15th.';

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
  -- One lock across schedule/action/payment prevents cross-batch allocation races.
  if not public.is_owner() then
    raise exception 'Only the owner can schedule R100 reward payouts' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('qualified_reward_payroll'));
  if p_cycle_month is null or p_selected_payday is distinct from 15 then
    raise exception 'R100 submission fees are due by the 15th of the following month';
  end if;
  v_planned := (v_cycle + interval '1 month 14 days')::date;

  insert into public.qualified_reward_payout_batches(
    cycle_month, selected_payday, planned_for, owner_note, created_by
  ) values (
    v_cycle, p_selected_payday, v_planned, nullif(btrim(p_owner_note), ''), (select auth.uid())
  )
  on conflict (cycle_month, selected_payday) do nothing;
  select * into v_batch from public.qualified_reward_payout_batches
  where cycle_month = v_cycle and selected_payday = p_selected_payday for update;
  if v_batch.status <> 'scheduled' then
    raise exception 'Only a scheduled batch can accept rewards';
  end if;

  insert into public.qualified_reward_payout_items(
    batch_id, reward_lock_id, amount, scheduled_by
  )
  select v_batch.id, reward.id, reward.amount, (select auth.uid())
  from public.complete_document_reward_locks reward
  where (
    reward.locked_at >= (v_cycle::timestamp at time zone 'Africa/Johannesburg')
    and reward.locked_at < ((v_cycle + interval '1 month')::timestamp at time zone 'Africa/Johannesburg')
    and not exists (
      select 1 from public.qualified_reward_payout_items existing
      where existing.reward_lock_id = reward.id
    )
  ) or (
    exists (
      select 1 from public.qualified_reward_payout_events carry
      where carry.reward_lock_id = reward.id
        and carry.event_type = 'carried_forward'
        and exists (select 1 from public.qualified_reward_payout_batches prior
          where prior.id = carry.batch_id and prior.cycle_month < v_cycle)
        and not exists (
          select 1 from public.qualified_reward_payout_events later
          where later.reward_lock_id = reward.id
            and (later.event_order) > (carry.event_order)
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
  -- One lock across schedule/action/payment prevents cross-batch allocation races.
  if not public.is_owner() then
    raise exception 'Only the owner can record R100 reward payment' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('qualified_reward_payroll'));
  if nullif(btrim(p_payment_reference), '') is null
     or nullif(btrim(p_proof_storage_path), '') is null then
    raise exception 'Payment reference and proof of payment are required';
  end if;
  if not exists (select 1 from storage.objects
    where bucket_id = 'qualified-reward-proofs' and name = btrim(p_proof_storage_path)
      and name like 'rewards/' || p_batch_id::text || '/%') then
    raise exception 'Upload proof of payment for this batch first';
  end if;
  select * into v_batch from public.qualified_reward_payout_batches
   where id = p_batch_id for update;
  if not found then raise exception 'Reward payout batch not found'; end if;
  if v_batch.status = 'cancelled' then raise exception 'Cancelled batch cannot be paid'; end if;
  if v_batch.status = 'paid' then
    return jsonb_build_object('batch_id', v_batch.id, 'already_paid', true);
  end if;
  if (now() at time zone 'Africa/Johannesburg')::date <
     (v_batch.cycle_month + interval '1 month')::date then
    raise exception 'R100 submission fees are paid in arrears after the reward month ends';
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
    and exists (
      select 1 from public.qualified_reward_payout_events latest
      where latest.reward_lock_id = item.reward_lock_id
        and latest.batch_id = v_batch.id
        and latest.event_type in ('scheduled', 'released')
        and latest.event_order = (select max(e.event_order)
          from public.qualified_reward_payout_events e where e.reward_lock_id = item.reward_lock_id)
    )
  on conflict (idempotency_key) do nothing;
  get diagnostics v_paid = row_count;
  if v_paid = 0 and not exists (
    select 1 from public.qualified_reward_payout_events
    where batch_id = v_batch.id and event_type = 'paid'
  ) then
    raise exception 'Batch has no payable rewards';
  end if;

  select count(*) into v_remaining
  from public.qualified_reward_payout_items item
  where item.batch_id = v_batch.id
    and not exists (
      select 1 from public.qualified_reward_payout_events terminal
      where terminal.reward_lock_id = item.reward_lock_id
        and (terminal.event_type in ('paid', 'reversed')
          or (terminal.event_type = 'carried_forward' and terminal.batch_id = v_batch.id))
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
         reward.amount, reward.locked_at,
          (date_trunc('month', reward.locked_at at time zone 'Africa/Johannesburg')
            + interval '1 month - 1 day')::date, batch.planned_for,
         batch.id,
         coalesce(latest.event_type, case when item.id is null then 'locked' else 'scheduled' end),
         latest.payment_reference, case when public.is_owner() then latest.proof_storage_path else null::text end, latest.occurred_at
  from public.complete_document_reward_locks reward
  join public.profiles profile on profile.id = reward.beneficiary_profile_id
  left join public.leads lead on lead.id = reward.lead_id
  left join lateral (
    select scheduled.* from public.qualified_reward_payout_items scheduled
    where scheduled.reward_lock_id = reward.id
    order by (select max(e.event_order) from public.qualified_reward_payout_events e
      where e.reward_lock_id = reward.id and e.batch_id = scheduled.batch_id) desc limit 1
  ) item on true
  left join public.qualified_reward_payout_batches batch on batch.id = item.batch_id
  left join lateral (
    select event.event_type, event.payment_reference, event.proof_storage_path,
           event.occurred_at
    from public.qualified_reward_payout_events event
    where event.reward_lock_id = reward.id
    order by event.event_order desc limit 1
  ) latest on true
  where public.is_owner() or reward.beneficiary_profile_id = v_uid
  order by reward.locked_at desc;
end;
$$;

-- CREATE OR REPLACE preserves existing privileges; make the RPC boundary explicit.
revoke all on function public.owner_schedule_qualified_reward_batch(date, integer, text) from public, anon;
revoke all on function public.owner_mark_qualified_reward_batch_paid(uuid, text, text, text) from public, anon;
revoke all on function public.qualified_reward_workspace() from public, anon;
grant execute on function public.owner_schedule_qualified_reward_batch(date, integer, text) to authenticated;
grant execute on function public.owner_mark_qualified_reward_batch_paid(uuid, text, text, text) to authenticated;
grant execute on function public.qualified_reward_workspace() to authenticated;
notify pgrst, 'reload schema';
