-- Agent Code onboarding (2/2). Owner decision 30 Oct 2026 (docs/FNC-LAUNCH-PLAN-2026-11-09.md section 3):
--   * HR marks four onboarding documents as received for each agent, sub-agent or Team Leader: the signed contract, a
--     certified ID, a bank letter and the iFacts consent. HR (or the Director) also records the date iFacts cleared.
--     Only the ticks and dates are stored here, never the ID or bank numbers themselves (POPIA).
--   * The Sales Coordinator issues the Agent Code, but only once all four documents are received AND iFacts has cleared.
--     The Director (CEO) can always issue it; when the checklist is incomplete that is an override and needs a reason.
--   * An R100 line for an agent without an Agent Code waits ("pending"). If no Agent Code is issued within 30 days of the
--     file's submission, the line is forfeited: it is never scheduled, and the rewards card shows it as forfeited.
-- Builds on 20261021140000_r100_on_verified.sql (agent_onboarding_clearances, owner_issue_agent_code, the R100 lines and
-- the payout scheduler); nothing there is duplicated. Apply after 20261102090000_agent_code_enums.sql.

-- 1. The onboarding checklist (append-only: the latest event per item is its current state) --------------------------
create table if not exists public.agent_onboarding_checklist_events (
  id                bigint generated always as identity primary key,
  profile_id        uuid not null references public.profiles(id) on delete restrict,
  item              text not null check (item in ('signed_contract', 'certified_id', 'bank_letter', 'ifacts_consent', 'ifacts_cleared')),
  received          boolean not null,
  ifacts_cleared_on date,
  note              text check (note is null or length(note) <= 300),
  actor_id          uuid not null references public.profiles(id) on delete restrict,
  actor_role        text not null,
  created_at        timestamptz not null default now(),
  -- The iFacts date belongs only to a positive "iFacts cleared" event.
  constraint agent_onboarding_checklist_date_ck check ((item = 'ifacts_cleared' and received) = (ifacts_cleared_on is not null))
);
create index if not exists agent_onboarding_checklist_events_profile_idx
  on public.agent_onboarding_checklist_events (profile_id, item, id desc);
alter table public.agent_onboarding_checklist_events enable row level security;
revoke all on table public.agent_onboarding_checklist_events from public, anon, authenticated;
create trigger agent_onboarding_checklist_events_append_only before update or delete on public.agent_onboarding_checklist_events
  for each row execute function public.intake_append_only_guard();

-- Current checklist state for one person: each item's latest event.
create or replace function public.agent_onboarding_state(p_profile uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with latest as (
    select distinct on (e.item) e.item, e.received, e.ifacts_cleared_on, e.created_at
      from public.agent_onboarding_checklist_events e
     where e.profile_id = p_profile
     order by e.item, e.id desc
  ), docs as (
    select count(*) filter (where item in ('signed_contract', 'certified_id', 'bank_letter', 'ifacts_consent') and received) as n
      from latest
  )
  select jsonb_build_object(
    'documents_received', (select n from docs) = 4,
    'ifacts_cleared_on', (select l.ifacts_cleared_on from latest l where l.item = 'ifacts_cleared' and l.received),
    'ready', (select n from docs) = 4 and exists (select 1 from latest l where l.item = 'ifacts_cleared' and l.received)
  );
$$;
revoke all on function public.agent_onboarding_state(uuid) from public, anon, authenticated;

-- HR (or the Director) marks one item received, or takes the tick back to correct a mistake. The checklist closes once
-- the Agent Code is issued. When the checklist becomes complete, the Sales Coordinators are told the code can be issued.
create or replace function public.hr_mark_onboarding_item(
  p_profile uuid, p_item text, p_received boolean, p_ifacts_cleared_on date default null, p_note text default null)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_owner boolean := coalesce(public.is_owner(), false);
  v_staff text := public.staff_role_of(); v_role text; v_name text; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_was_ready boolean; v_now_ready boolean; v_id bigint; v_current boolean; v_current_date date; v_coord uuid;
begin
  if not (v_owner or coalesce(v_staff = 'hr', false)) then
    raise exception 'Only HR or the Director marks onboarding documents' using errcode = '42501';
  end if;
  if p_item is null or p_item not in ('signed_contract', 'certified_id', 'bank_letter', 'ifacts_consent', 'ifacts_cleared') then
    raise exception 'Unknown onboarding item';
  end if;
  if p_received is null then raise exception 'Say whether the item is received'; end if;
  select p.role::text, p.full_name into v_role, v_name from public.profiles p where p.id = p_profile and p.is_active;
  if v_role is null or v_role not in ('partner', 'contractor', 'lead_referrer') then
    raise exception 'The onboarding checklist is for active agents, sub-agents and Team Leaders';
  end if;
  if p_item = 'ifacts_cleared' and p_received then
    if p_ifacts_cleared_on is null or p_ifacts_cleared_on > public.current_sast_date() then
      raise exception 'Enter the date iFacts cleared (today or earlier)';
    end if;
  elsif p_ifacts_cleared_on is not null then
    raise exception 'A date is only recorded when iFacts has cleared';
  end if;
  if v_note is not null and (length(v_note) > 300 or not public.staff_text_is_safe(v_note)) then
    raise exception 'Keep the note under 300 characters, with no ID, bank or other long numbers';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agent_onboarding:' || p_profile::text, 0));
  if exists (select 1 from public.agent_onboarding_clearances c where c.profile_id = p_profile) then
    raise exception 'The Agent Code is already issued; the checklist is closed';
  end if;
  select e.received, e.ifacts_cleared_on into v_current, v_current_date
    from public.agent_onboarding_checklist_events e
   where e.profile_id = p_profile and e.item = p_item order by e.id desc limit 1;
  if coalesce(v_current, false) = p_received and v_current_date is not distinct from p_ifacts_cleared_on then
    raise exception 'Nothing to change: the item is already marked that way';
  end if;

  v_was_ready := coalesce((public.agent_onboarding_state(p_profile)->>'ready')::boolean, false);
  insert into public.agent_onboarding_checklist_events (profile_id, item, received, ifacts_cleared_on, note, actor_id, actor_role)
  values (p_profile, p_item, p_received, case when p_received then p_ifacts_cleared_on end, v_note, v_uid,
          case when v_owner then 'owner' else v_staff end)
  returning id into v_id;
  perform public.staff_audit_write('agent_onboarding', p_profile,
    case when p_received then 'onboarding_item_received' else 'onboarding_item_withdrawn' end, v_note,
    jsonb_build_object('item', p_item, 'ifacts_cleared_on', p_ifacts_cleared_on));

  v_now_ready := coalesce((public.agent_onboarding_state(p_profile)->>'ready')::boolean, false);
  if v_now_ready and not v_was_ready then
    for v_coord in
      select p.id from public.profiles p join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
       where p.role::text = 'coordinator' and p.is_active and s.access_enabled
    loop
      perform public.staff_notify(v_coord, 'AGENT_ONBOARDING_READY', 'Agent Code can be issued',
        coalesce(v_name, 'An agent') || ' has all four onboarding documents and a cleared iFacts check.',
        '/staff/onboarding', jsonb_build_object('profile_id', p_profile));
    end loop;
  end if;
  return v_id;
end;
$$;
revoke all on function public.hr_mark_onboarding_item(uuid, text, boolean, date, text) from public, anon;
grant execute on function public.hr_mark_onboarding_item(uuid, text, boolean, date, text) to authenticated;

-- 2. Issuing the Agent Code ----------------------------------------------------------------------------------------------
-- The Sales Coordinator: only when the checklist is complete, using the iFacts date HR recorded. The Director: always;
-- with an incomplete checklist it is an override and needs a reason. The iFacts date is still required either way,
-- because the contracts make nothing payable before iFacts clears.
create or replace function public.staff_issue_agent_code(
  p_profile uuid, p_agent_code text, p_ifacts_cleared_on date default null, p_override_reason text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := upper(btrim(coalesce(p_agent_code, ''))); v_role text; v_owner boolean := coalesce(public.is_owner(), false);
  v_staff text := public.staff_role_of(); v_state jsonb; v_ready boolean; v_date date;
  v_reason text := nullif(btrim(coalesce(p_override_reason, '')), ''); v_override boolean := false;
begin
  if not (v_owner or coalesce(v_staff = 'coordinator', false)) then
    raise exception 'Only the Sales Coordinator or the Director issues an Agent Code' using errcode = '42501';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = p_profile and p.is_active;
  if v_role is null or v_role not in ('partner', 'contractor', 'lead_referrer') then
    raise exception 'Agent Codes are for active agents, sub-agents and Team Leaders';
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{2,23}$' then raise exception 'Enter an Agent Code of 3 to 24 letters, numbers or dashes'; end if;

  perform pg_advisory_xact_lock(hashtextextended('agent_onboarding:' || p_profile::text, 0));
  if exists (select 1 from public.agent_onboarding_clearances c where c.profile_id = p_profile) then
    raise exception 'This person already has an Agent Code';
  end if;
  v_state := public.agent_onboarding_state(p_profile);
  v_ready := coalesce((v_state->>'ready')::boolean, false);

  if v_owner then
    v_date := coalesce(p_ifacts_cleared_on, (v_state->>'ifacts_cleared_on')::date);
    if not v_ready then
      v_override := true;
      if v_reason is null or length(v_reason) < 5 or length(v_reason) > 300 or not public.staff_text_is_safe(v_reason) then
        raise exception 'The onboarding checklist is not complete: give a reason (5 to 300 characters, no long numbers) to override';
      end if;
    end if;
  else
    if not v_ready then
      raise exception 'HR has not yet marked all four documents received and iFacts cleared';
    end if;
    v_date := (v_state->>'ifacts_cleared_on')::date;
    v_reason := null;
  end if;
  if v_date is null or v_date > public.current_sast_date() then
    raise exception 'Enter the date iFacts cleared (today or earlier)';
  end if;

  begin
    insert into public.agent_onboarding_clearances (profile_id, agent_code, ifacts_cleared_on, set_by)
    values (p_profile, v_code, v_date, (select auth.uid()));
  exception when unique_violation then
    raise exception 'That Agent Code is already in use';
  end;
  perform public.staff_audit_write('agent_onboarding', p_profile,
    case when v_override then 'agent_code_issued_override' else 'agent_code_issued' end, v_reason,
    jsonb_build_object('agent_code', v_code, 'ifacts_cleared_on', v_date, 'checklist_complete', v_ready));
  perform public.staff_notify(p_profile, 'AGENT_CODE_ISSUED', 'Your Agent Code is issued',
    'Your Agent Code is ' || v_code || '. Your R100 rewards and commission can now be paid on the contract dates.',
    null, jsonb_build_object('agent_code', v_code));
  return v_code;
end;
$$;
revoke all on function public.staff_issue_agent_code(uuid, text, date, text) from public, anon;
grant execute on function public.staff_issue_agent_code(uuid, text, date, text) to authenticated;

-- The Director's original route (Team page) keeps working: it is the Director's override with a fixed reason.
create or replace function public.owner_issue_agent_code(p_profile uuid, p_agent_code text, p_ifacts_cleared_on date)
returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.is_owner(), false) then
    raise exception 'Only the Director issues an Agent Code' using errcode = '42501';
  end if;
  if p_ifacts_cleared_on is null or p_ifacts_cleared_on > public.current_sast_date() then
    raise exception 'Enter the date iFacts cleared (today or earlier)';
  end if;
  return public.staff_issue_agent_code(p_profile, p_agent_code, p_ifacts_cleared_on, 'Director issued it directly');
end;
$$;
revoke all on function public.owner_issue_agent_code(uuid, text, date) from public, anon;
grant execute on function public.owner_issue_agent_code(uuid, text, date) to authenticated;

-- The onboarding screen: every active agent, sub-agent and Team Leader with the checklist and Agent Code. For the
-- Director, HR, the Office Administrator and the Sales Coordinator. No ID or bank details exist here to show.
create or replace function public.agent_onboarding_list()
returns table (
  profile_id uuid, full_name text, role text,
  signed_contract_at timestamptz, certified_id_at timestamptz, bank_letter_at timestamptz, ifacts_consent_at timestamptz,
  ifacts_cleared_on date, ready boolean, agent_code text, code_issued_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (coalesce(public.is_owner(), false) or coalesce(public.staff_role_of() in ('hr', 'administrator', 'coordinator'), false)) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query
    with latest as (
      select distinct on (e.profile_id, e.item) e.profile_id, e.item, e.received, e.ifacts_cleared_on, e.created_at
        from public.agent_onboarding_checklist_events e
       order by e.profile_id, e.item, e.id desc
    )
    select p.id, p.full_name, p.role::text,
           (select l.created_at from latest l where l.profile_id = p.id and l.item = 'signed_contract' and l.received),
           (select l.created_at from latest l where l.profile_id = p.id and l.item = 'certified_id' and l.received),
           (select l.created_at from latest l where l.profile_id = p.id and l.item = 'bank_letter' and l.received),
           (select l.created_at from latest l where l.profile_id = p.id and l.item = 'ifacts_consent' and l.received),
           coalesce(c.ifacts_cleared_on, (select l.ifacts_cleared_on from latest l where l.profile_id = p.id and l.item = 'ifacts_cleared' and l.received)),
           coalesce((public.agent_onboarding_state(p.id)->>'ready')::boolean, false),
           c.agent_code, c.set_at
      from public.profiles p
      left join public.agent_onboarding_clearances c on c.profile_id = p.id
     where p.is_active and p.role::text in ('partner', 'contractor', 'lead_referrer')
     order by (c.profile_id is not null), p.full_name nulls last
     limit 1000;
end;
$$;
revoke all on function public.agent_onboarding_list() from public, anon;
grant execute on function public.agent_onboarding_list() to authenticated;

-- 3. Forfeiting R100 lines when no Agent Code follows within 30 days of the submission -----------------------------------
-- The submission date is when the file was registered (submission_intakes.registered_at), SAST. A line already put in a
-- payout batch is never forfeited. An Agent Code issued after the deadline does not revive the line.
create or replace function public.r100_forfeit_deadline(p_reward uuid)
returns date
language sql stable security definer set search_path = '' as $$
  select ((coalesce(si.registered_at, r.locked_at) at time zone 'Africa/Johannesburg')::date + 30)
    from public.complete_document_reward_locks r
    left join public.submission_intakes si on si.lead_id = r.lead_id
   where r.id = p_reward;
$$;
revoke all on function public.r100_forfeit_deadline(uuid) from public, anon, authenticated;

create or replace function public.r100_is_forfeited(p_reward uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.qualified_reward_payout_items i where i.reward_lock_id = r.id)
         and case when c.profile_id is not null
                  then (c.set_at at time zone 'Africa/Johannesburg')::date > public.r100_forfeit_deadline(r.id)
                  else public.current_sast_date() > public.r100_forfeit_deadline(r.id) end
    from public.complete_document_reward_locks r
    left join public.agent_onboarding_clearances c on c.profile_id = r.beneficiary_profile_id
   where r.id = p_reward;
$$;
revoke all on function public.r100_is_forfeited(uuid) from public, anon, authenticated;

-- Evidence of each forfeit, written once (the rule above stays the source of truth; this is the audit record).
create table if not exists public.r100_forfeitures (
  reward_lock_id         uuid primary key references public.complete_document_reward_locks(id) on delete restrict,
  beneficiary_profile_id uuid not null references public.profiles(id) on delete restrict,
  deadline               date not null,
  recorded_at            timestamptz not null default now()
);
alter table public.r100_forfeitures enable row level security;
revoke all on table public.r100_forfeitures from public, anon, authenticated;
create trigger r100_forfeitures_append_only before update or delete on public.r100_forfeitures
  for each row execute function public.intake_append_only_guard();

create or replace function public.r100_record_forfeitures()
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0; r record;
begin
  for r in
    insert into public.r100_forfeitures (reward_lock_id, beneficiary_profile_id, deadline)
    select l.id, l.beneficiary_profile_id, public.r100_forfeit_deadline(l.id)
      from public.complete_document_reward_locks l
     where public.r100_is_forfeited(l.id)
       and not exists (select 1 from public.r100_forfeitures f where f.reward_lock_id = l.id)
    on conflict (reward_lock_id) do nothing
    returning reward_lock_id, beneficiary_profile_id, deadline
  loop
    v_count := v_count + 1;
    perform public.staff_audit_write('r100_reward', r.reward_lock_id, 'r100_forfeited',
      'No Agent Code was issued within 30 days of the submission',
      jsonb_build_object('beneficiary', r.beneficiary_profile_id, 'deadline', r.deadline));
  end loop;
  return v_count;
end;
$$;
revoke all on function public.r100_record_forfeitures() from public, anon, authenticated;

-- The scheduler from 20261021140000, unchanged except: forfeited lines are never scheduled and are recorded, and the
-- counts say how many are still waiting for an Agent Code and how many were forfeited.
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
  perform public.r100_record_forfeitures();
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
  where public.agent_is_cleared(reward.beneficiary_profile_id)
    and ((
      reward.locked_at < ((v_cycle + interval '1 month')::timestamp at time zone 'Africa/Johannesburg')
      and not exists (
        select 1 from public.qualified_reward_payout_items existing
        where existing.reward_lock_id = reward.id
      )
      and not public.r100_is_forfeited(reward.id)
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
    ));
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
                            'planned_for', v_planned,
                            'waiting_for_agent_code', (select count(*) from public.complete_document_reward_locks r
                               where not public.agent_is_cleared(r.beneficiary_profile_id)
                                 and not public.r100_is_forfeited(r.id)
                                 and not exists (select 1 from public.qualified_reward_payout_items i where i.reward_lock_id = r.id)),
                            'forfeited', (select count(*) from public.r100_forfeitures));
end;
$$;
revoke all on function public.owner_schedule_qualified_reward_batch(date, integer, text) from public, anon;
grant execute on function public.owner_schedule_qualified_reward_batch(date, integer, text) to authenticated;

-- The rewards card (20261010205101), unchanged except that an unscheduled line past its 30 days reads 'forfeited'.
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
         coalesce(latest.event_type, case when item.id is not null then 'scheduled'
                                          when public.r100_is_forfeited(reward.id) then 'forfeited' else 'locked' end),
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
revoke all on function public.qualified_reward_workspace() from public, anon;
grant execute on function public.qualified_reward_workspace() to authenticated;

notify pgrst, 'reload schema';
