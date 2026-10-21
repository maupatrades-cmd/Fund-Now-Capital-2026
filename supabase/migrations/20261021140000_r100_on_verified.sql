-- R100 submission fee / document reward created on VERIFIED (owner decision 21 Oct 2026,
-- docs/FNC-LAUNCH-PLAN-2026-11-09.md section 3 decision 1 and section 4). Claude Code owns this logic from 21 Oct.
-- Apply AFTER 20261007161254_r100_reward_payroll_workspace.sql and 20261010205101_r100_submission_fee_payment_calendar.sql
-- (Codex's payout workspace, never applied before; it is reused unchanged and is what the portals' rewards card reads).
--
-- What changes:
--   1. The R100 line is created automatically, once, when a client file is Verified: the Director moves the staff file
--      to Verified, or the Office Administrator approves the documents while the Director is away (Batch 2). It is
--      created whether the deal is later approved or declined. It is written into complete_document_reward_locks (the
--      existing exactly-once R100 record that the payout workspace already pays from), marked source = 'verified'.
--   2. At most one R100 per client per 6 months (any agent). A later Verified file for the same client inside that
--      window creates no line; the skip is written to the audit trail.
--   3. Not payable before the agent has an Agent Code and a cleared iFacts check. Nothing in the CRM recorded that yet,
--      so agent_onboarding_clearances is added (set by the Director only). An R100 line exists from Verified but is only
--      scheduled into a payout batch once the agent is cleared; until then it waits and is picked up by a later batch.
--   4. The legacy path (owner_lock_complete_document_reward: R100 on funder dispatch) is switched off for signed-in users,
--      so one file can never earn two R100s by two routes. Its evidence table and history stay.
-- Paid on the contract schedule: by the 15th of the month after the Verified date (the calendar migration's batches).

-- 1. Agent Code and iFacts clearance ---------------------------------------------------------------------------------
create table if not exists public.agent_onboarding_clearances (
  profile_id        uuid primary key references public.profiles(id) on delete restrict,
  agent_code        text not null unique check (agent_code ~ '^[A-Z0-9][A-Z0-9-]{2,23}$'),
  ifacts_cleared_on date not null,
  set_by            uuid not null references public.profiles(id) on delete restrict,
  set_at            timestamptz not null default now()
);
alter table public.agent_onboarding_clearances enable row level security;
revoke all on table public.agent_onboarding_clearances from public, anon, authenticated;
create trigger agent_onboarding_clearances_append_only before update or delete on public.agent_onboarding_clearances
  for each row execute function public.intake_append_only_guard();

-- Is this person cleared to be paid (Agent Code issued after a cleared iFacts check)?
create or replace function public.agent_is_cleared(p_profile uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agent_onboarding_clearances c where c.profile_id = p_profile);
$$;
revoke all on function public.agent_is_cleared(uuid) from public, anon, authenticated;

-- The Director issues the Agent Code once iFacts has cleared (build spec: "iFacts submission and Agent Code: Director").
create or replace function public.owner_issue_agent_code(p_profile uuid, p_agent_code text, p_ifacts_cleared_on date)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text := upper(btrim(coalesce(p_agent_code, ''))); v_role text;
begin
  if not coalesce(public.is_owner(), false) then
    raise exception 'Only the Director issues an Agent Code' using errcode = '42501';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = p_profile and p.is_active;
  if v_role is null or v_role not in ('partner', 'contractor', 'lead_referrer') then
    raise exception 'Agent Codes are for active agents, sub-agents and Team Leaders';
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{2,23}$' then raise exception 'Enter an Agent Code of 3 to 24 letters, numbers or dashes'; end if;
  if p_ifacts_cleared_on is null or p_ifacts_cleared_on > public.current_sast_date() then
    raise exception 'Enter the date iFacts cleared (today or earlier)';
  end if;
  if exists (select 1 from public.agent_onboarding_clearances c where c.profile_id = p_profile) then
    raise exception 'This person already has an Agent Code';
  end if;
  begin
    insert into public.agent_onboarding_clearances (profile_id, agent_code, ifacts_cleared_on, set_by)
    values (p_profile, v_code, p_ifacts_cleared_on, (select auth.uid()));
  exception when unique_violation then
    raise exception 'That Agent Code is already in use';
  end;
  perform public.staff_audit_write('agent_onboarding', p_profile, 'agent_code_issued', null,
    jsonb_build_object('agent_code', v_code, 'ifacts_cleared_on', p_ifacts_cleared_on));
  return v_code;
end;
$$;
revoke all on function public.owner_issue_agent_code(uuid, text, date) from public, anon;
grant execute on function public.owner_issue_agent_code(uuid, text, date) to authenticated;

-- Agent Codes issued (Director, Office Administrator, HR).
create or replace function public.agent_clearances_list()
returns table (profile_id uuid, full_name text, role text, agent_code text, ifacts_cleared_on date, set_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (coalesce(public.is_owner(), false) or coalesce(public.staff_role_of() in ('administrator', 'hr'), false)) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query
    select c.profile_id, p.full_name, p.role::text, c.agent_code, c.ifacts_cleared_on, c.set_at
      from public.agent_onboarding_clearances c join public.profiles p on p.id = c.profile_id
     order by c.set_at desc limit 500;
end;
$$;
revoke all on function public.agent_clearances_list() from public, anon;
grant execute on function public.agent_clearances_list() to authenticated;

-- The caller's own payment gate, for the rewards card ("paid once your Agent Code is issued").
create or replace function public.my_reward_gate()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('cleared', c.profile_id is not null, 'agent_code', c.agent_code)
    from (select (select auth.uid()) as uid) me
    left join public.agent_onboarding_clearances c on c.profile_id = me.uid;
$$;
revoke all on function public.my_reward_gate() from public, anon;
grant execute on function public.my_reward_gate() to authenticated;

-- 2. The R100 record now also holds file-level (Verified) lines ------------------------------------------------------
-- The table is empty in production (21 Oct 2026), so relaxing deal_id is safe. Legacy lines keep needing a deal.
alter table public.complete_document_reward_locks alter column deal_id drop not null;
alter table public.complete_document_reward_locks
  add column if not exists source text not null default 'funder_dispatch' check (source in ('funder_dispatch', 'verified')),
  add column if not exists client_key text;
alter table public.complete_document_reward_locks add constraint complete_document_reward_locks_source_ck
  check ((source = 'funder_dispatch' and deal_id is not null) or (source = 'verified' and lead_id is not null and client_key is not null));
-- Never two Verified lines for the same file.
create unique index if not exists complete_document_reward_locks_verified_file_uq
  on public.complete_document_reward_locks (lead_id) where source = 'verified';
create index if not exists complete_document_reward_locks_client_idx
  on public.complete_document_reward_locks (client_key, locked_at desc) where client_key is not null;

-- The funder-dispatch readiness gate applies only to the legacy dispatch lines.
create or replace function public.enforce_reward_legal_readiness()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  if new.source = 'verified' then return new; end if;
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
revoke all on function public.enforce_reward_legal_readiness() from public,anon,authenticated;

-- The legacy route (R100 on funder dispatch) is replaced by Verified: no signed-in user can call it any more.
revoke all on function public.owner_lock_complete_document_reward(uuid,uuid,text) from public, anon, authenticated;

-- 3. Create the line on Verified ---------------------------------------------------------------------------------------
-- The client is identified by the CIPC registration number (letters and digits only, lower case) when the file has one:
-- the same company can come in on a new lead, and the six-month limit is per client, not per lead. Without a CIPC number
-- the lead itself is the client (a sole trader or a file not yet registered), so the limit cannot be checked across leads.
create or replace function public.r100_client_key(p_lead uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select coalesce('cipc:' || nullif(lower(regexp_replace(coalesce(l.cipc_number, ''), '[^0-9A-Za-z]', '', 'g')), ''), 'lead:' || l.id::text)
    from public.leads l where l.id = p_lead;
$$;
revoke all on function public.r100_client_key(uuid) from public, anon, authenticated;

-- Creates the R100 line for a Verified file, once. Returns the line, or null when no line is due (already exists,
-- six-month limit, or no agent to pay). p_via: 'director_verified' or 'administrator_absence_approval'.
create or replace function public.r100_create_for_verified(p_lead uuid, p_via text, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_key text; v_id uuid; v_agent uuid; v_role text; v_si public.submission_intakes; v_lead public.leads;
  v_day date := public.current_sast_date(); v_cycle date; v_prior uuid;
begin
  select * into v_si from public.submission_intakes where lead_id = p_lead;
  select * into v_lead from public.leads where id = p_lead;
  if v_si.lead_id is null or v_lead.id is null then return null; end if;
  v_key := public.r100_client_key(p_lead);
  perform pg_advisory_xact_lock(hashtextextended('r100_client:' || v_key, 0));
  select r.id into v_id from public.complete_document_reward_locks r where r.lead_id = p_lead and r.source = 'verified';
  if v_id is not null then return v_id; end if;

  -- The submitting agent: the agent recorded on the file, else the lead's attribution (sub-agent, agent, partner).
  v_agent := coalesce(v_si.agent_profile_id, v_lead.attributed_to_lead_referrer_id, v_lead.attributed_to_contractor_id,
                      v_lead.attributed_to_partner_id);
  select p.role::text into v_role from public.profiles p where p.id = v_agent and p.is_active;
  if v_role is null or v_role not in ('partner', 'contractor', 'lead_referrer') then
    perform public.staff_audit_write('submission_intake', p_lead, 'r100_not_due', 'No agent, sub-agent or Team Leader to pay on this file',
      jsonb_build_object('via', p_via));
    return null;
  end if;

  select r.id into v_prior from public.complete_document_reward_locks r
   where r.client_key = v_key and r.locked_at > now() - interval '6 months' limit 1;
  if v_prior is not null then
    perform public.staff_audit_write('submission_intake', p_lead, 'r100_not_due', 'Already paid an R100 for this client in the last 6 months',
      jsonb_build_object('via', p_via, 'earlier_reward', v_prior, 'client_key', v_key));
    return null;
  end if;

  v_cycle := date_trunc('month', v_day)::date;
  insert into public.complete_document_reward_locks (deal_id, lead_id, beneficiary_profile_id, beneficiary_role, eligibility_snapshot,
                                                     locked_by, cutoff_date, pay_window_open_on, pay_window_close_on, source, client_key)
  values (v_si.deal_id, p_lead, v_agent, v_role,
          jsonb_build_object('via', p_via, 'workflow_status', v_si.workflow_status, 'verified_on', v_day,
                             'first_complete_at', v_si.first_complete_at, 'channel', v_si.channel),
          p_actor, (v_cycle + interval '1 month - 1 day')::date, (v_cycle + interval '1 month')::date,
          (v_cycle + interval '1 month 14 days')::date, 'verified', v_key)
  returning id into v_id;
  perform public.staff_audit_write('r100_reward', v_id, 'r100_created', null,
    jsonb_build_object('lead_id', p_lead, 'beneficiary', v_agent, 'via', p_via));
  return v_id;
end;
$$;
revoke all on function public.r100_create_for_verified(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.r100_on_intake_verified()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.r100_create_for_verified(new.lead_id, 'director_verified',
    coalesce((select auth.uid()), (select p.id from public.profiles p where p.role::text = 'owner' and p.is_active order by p.created_at limit 1)));
  return null;
end;
$$;
revoke all on function public.r100_on_intake_verified() from public, anon, authenticated;
create trigger submission_intakes_r100_on_verified
  after update of workflow_status on public.submission_intakes
  for each row when (new.workflow_status = 'verified' and old.workflow_status is distinct from 'verified')
  execute function public.r100_on_intake_verified();

create or replace function public.r100_on_absence_approval()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.r100_create_for_verified(new.lead_id, 'administrator_absence_approval', new.approved_by);
  return null;
end;
$$;
revoke all on function public.r100_on_absence_approval() from public, anon, authenticated;
create trigger intake_absence_approvals_r100
  after insert on public.intake_absence_approvals
  for each row execute function public.r100_on_absence_approval();

-- 4. Payout scheduling: only cleared agents, and lines that waited for clearance are picked up later ------------------
-- Same signature and checks as the calendar migration. Rewards locked up to the end of the cycle month that have never
-- been scheduled are taken in (so a line that waited for an Agent Code joins the next batch), but only for agents who
-- are cleared. Each reward still lands in a batch at most once (plus the existing carry-forward rule).
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
  where public.agent_is_cleared(reward.beneficiary_profile_id)
    and ((
      reward.locked_at < ((v_cycle + interval '1 month')::timestamp at time zone 'Africa/Johannesburg')
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
                                 and not exists (select 1 from public.qualified_reward_payout_items i where i.reward_lock_id = r.id)));
end;
$$;
