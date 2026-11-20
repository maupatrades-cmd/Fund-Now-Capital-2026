-- R100 chooser + Files report (owner, 20 Nov 2026).
--
-- OWNER DECISIONS (20 Nov 2026):
--   * "I need you choose who is getting R100": the DIRECTOR chooses who gets the R100.00 for a file. The beneficiary is
--     an existing person (an agent - partner / contractor / lead_referrer -, a field person or office staff) OR a name
--     she types for someone who is not on the CRM.
--   * "I can capture any client or type out any agent then click which client it is": the choice works on ANY file -
--     a deal, a lead with no deal yet, or a client - not only the Sales Coordinator's.
--   * "if it is in credit then also have a report": an owner-only Files report per month, filtered by stage
--     (Submitted / In credit / later), with the R29 and R100 status of every file, printable and downloadable.
--
-- The existing R100 engine (r100_create_for_verified, complete_document_reward_locks, owner_lock_complete_document_reward,
-- owner_schedule_qualified_reward_batch) is NOT changed. A choice is stored here, with its payment path:
--   * agent  (partner / contractor / lead_referrer): the Director either locks it through the existing R100 engine on
--            the deal (owner_lock_complete_document_reward - its own checks apply) or pays it herself and marks it
--            paid here (date + reference). The report shows the engine lock when one exists for the deal.
--   * staff  (office staff and the field team): an incentive line on the person's payslip in the cycle after the month
--            the choice was made (payroll_apply_file_rewards, idempotent, the same arrears pattern as the R29). The
--            Director's choice is the sign-off.
--   * outside (a typed name, not on the CRM): paid by the Director outside the CRM and marked paid here.
-- One current choice per file; a new choice replaces the old one (kept as history) unless it was already paid or is on
-- a payslip. Every change is audited (staff_audit_write). Owner-only: RLS on with no policy, owner-only RPCs.

-- 1. Choices ------------------------------------------------------------------------------------------------------------
create table if not exists public.file_reward_assignments (
  id                     uuid primary key default gen_random_uuid(),
  file_key               uuid not null,                       -- deal_id, else lead_id, else client_id
  deal_id                uuid references public.deals(id) on delete restrict,
  lead_id                uuid references public.leads(id) on delete restrict,
  client_id              uuid references public.clients(id) on delete restrict,
  beneficiary_kind       text not null check (beneficiary_kind in ('agent', 'staff', 'outside')),
  beneficiary_profile_id uuid references public.profiles(id) on delete restrict,
  beneficiary_name       text not null check (length(btrim(beneficiary_name)) between 2 and 120),
  amount                 numeric(14,2) not null default 100.00 check (amount > 0 and amount <= 10000),
  reason                 text check (reason is null or length(reason) <= 300),
  chosen_by              uuid not null references public.profiles(id) on delete restrict,
  chosen_at              timestamptz not null default now(),
  is_current             boolean not null default true,
  replaced_at            timestamptz,
  paid_on                date,
  paid_reference         text check (paid_reference is null or length(btrim(paid_reference)) between 2 and 120),
  paid_by                uuid references public.profiles(id) on delete restrict,
  payslip_line_id        uuid references public.payslip_lines(id) on delete restrict,
  constraint file_reward_assignments_file_ck check (deal_id is not null or lead_id is not null or client_id is not null),
  constraint file_reward_assignments_key_ck check (file_key = coalesce(deal_id, lead_id, client_id)),
  constraint file_reward_assignments_who_ck check ((beneficiary_kind = 'outside') = (beneficiary_profile_id is null)),
  constraint file_reward_assignments_paid_ck check ((paid_on is null) = (paid_reference is null)),
  constraint file_reward_assignments_current_ck check (is_current or replaced_at is not null)
);
create unique index if not exists file_reward_assignments_current_uq
  on public.file_reward_assignments (file_key) where is_current;
create index if not exists file_reward_assignments_deal_idx on public.file_reward_assignments (deal_id) where deal_id is not null;
create index if not exists file_reward_assignments_lead_idx on public.file_reward_assignments (lead_id) where lead_id is not null;
alter table public.file_reward_assignments enable row level security;
revoke all on table public.file_reward_assignments from public, anon, authenticated;

-- A choice is history once made: only replacing it, recording its payment, or its payslip line may change it.
create or replace function public.file_reward_assignments_guard()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'An R100 choice cannot be deleted; choose again to replace it'; end if;
  if (new.id, new.file_key, new.deal_id, new.lead_id, new.client_id, new.beneficiary_kind, new.beneficiary_profile_id,
      new.beneficiary_name, new.amount, new.reason, new.chosen_by, new.chosen_at)
     is distinct from
     (old.id, old.file_key, old.deal_id, old.lead_id, old.client_id, old.beneficiary_kind, old.beneficiary_profile_id,
      old.beneficiary_name, old.amount, old.reason, old.chosen_by, old.chosen_at) then
    raise exception 'An R100 choice cannot be changed; choose again to replace it';
  end if;
  if not old.is_current and new.is_current then raise exception 'A replaced R100 choice stays replaced'; end if;
  if old.paid_on is not null and (new.paid_on, new.paid_reference) is distinct from (old.paid_on, old.paid_reference) then
    raise exception 'A paid R100 cannot be changed';
  end if;
  return new;
end;
$$;
revoke all on function public.file_reward_assignments_guard() from public, anon, authenticated;
drop trigger if exists file_reward_assignments_guard on public.file_reward_assignments;
create trigger file_reward_assignments_guard before update or delete on public.file_reward_assignments
  for each row execute function public.file_reward_assignments_guard();

-- 2. Helpers ------------------------------------------------------------------------------------------------------------
create or replace function public.file_reward_require_owner()
returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.is_owner(), false) then
    raise exception 'Only the Director chooses and pays the R100' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;
revoke all on function public.file_reward_require_owner() from public, anon, authenticated;

-- Kind of person for the R100: agent / staff, or null when the person cannot receive it (the Director, a client).
create or replace function public.file_reward_kind_of(p_role text)
returns text
language sql immutable set search_path = '' as $$
  select case
    when p_role in ('partner', 'contractor', 'lead_referrer') then 'agent'
    when p_role in ('coordinator', 'switchboard', 'administrator', 'hr', 'field_supervisor', 'field_consultant') then 'staff'
  end;
$$;
revoke all on function public.file_reward_kind_of(text) from public, anon, authenticated;

-- A file's display name: the business of its deal / lead / client.
create or replace function public.file_reward_label(p_deal uuid, p_lead uuid, p_client uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select coalesce(l.business_name, c.business_name) || coalesce(' (' || d.reference || ')', '')
       from public.deals d left join public.leads l on l.id = d.lead_id left join public.clients c on c.id = d.client_id
      where d.id = p_deal),
    (select l.business_name from public.leads l where l.id = p_lead),
    (select c.business_name from public.clients c where c.id = p_client),
    'File');
$$;
revoke all on function public.file_reward_label(uuid, uuid, uuid) from public, anon, authenticated;

-- 3. Search: any client / lead / deal, and anyone who can receive the R100 ---------------------------------------------
create or replace function public.owner_file_search(p_query text)
returns table (kind text, deal_id uuid, lead_id uuid, client_id uuid, label text, detail text)
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := '%' || btrim(coalesce(p_query, '')) || '%';
begin
  perform public.file_reward_require_owner();
  if length(btrim(coalesce(p_query, ''))) < 2 then raise exception 'Type at least 2 letters'; end if;
  return query
    (select 'deal'::text, d.id, d.lead_id, d.client_id,
            coalesce(l.business_name, c.business_name, 'Deal') || coalesce(' (' || d.reference || ')', ''),
            replace(d.stage::text, '_', ' ')
       from public.deals d left join public.leads l on l.id = d.lead_id left join public.clients c on c.id = d.client_id
      where d.archived_at is null
        and (d.reference ilike v_q or l.business_name ilike v_q or c.business_name ilike v_q)
      order by d.reference limit 25)
    union all
    (select 'lead'::text, null::uuid, l.id, null::uuid, l.business_name, 'lead (no deal yet)'
       from public.leads l
      where l.business_name ilike v_q and not exists (select 1 from public.deals d where d.lead_id = l.id)
      order by l.business_name limit 25)
    union all
    (select 'client'::text, null::uuid, null::uuid, c.id, c.business_name, 'client (no deal yet)'
       from public.clients c
      where c.business_name ilike v_q and not exists (select 1 from public.deals d where d.client_id = c.id)
      order by c.business_name limit 25);
end;
$$;
revoke all on function public.owner_file_search(text) from public, anon;
grant execute on function public.owner_file_search(text) to authenticated;

create or replace function public.owner_reward_people_search(p_query text)
returns table (profile_id uuid, name text, role text, kind text)
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := '%' || btrim(coalesce(p_query, '')) || '%';
begin
  perform public.file_reward_require_owner();
  return query
    select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email), p.role::text, public.file_reward_kind_of(p.role::text)
      from public.profiles p
     where p.is_active and public.file_reward_kind_of(p.role::text) is not null
       and (coalesce(p.full_name, '') ilike v_q or coalesce(p.email, '') ilike v_q)
     order by 2 limit 30;
end;
$$;
revoke all on function public.owner_reward_people_search(text) from public, anon;
grant execute on function public.owner_reward_people_search(text) to authenticated;

-- 4. Choose / replace -----------------------------------------------------------------------------------------------------
create or replace function public.owner_set_file_reward(
  p_deal_id uuid, p_lead_id uuid, p_client_id uuid, p_beneficiary_profile_id uuid, p_beneficiary_name text,
  p_reason text default null, p_amount numeric default 100.00)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.file_reward_require_owner();
  v_deal public.deals; v_lead uuid := p_lead_id; v_client uuid := p_client_id; v_key uuid;
  v_kind text; v_name text := nullif(btrim(coalesce(p_beneficiary_name, '')), ''); v_role text;
  v_old public.file_reward_assignments; v_id uuid;
  v_amount numeric(14,2) := round(coalesce(p_amount, 100.00), 2);
begin
  if num_nonnulls(p_deal_id, p_lead_id, p_client_id) <> 1 then
    raise exception 'Choose one file: a deal, a lead or a client';
  end if;
  if p_deal_id is not null then
    select * into v_deal from public.deals d where d.id = p_deal_id;
    if not found then raise exception 'Deal not found'; end if;
    v_lead := v_deal.lead_id; v_client := v_deal.client_id;
  elsif p_lead_id is not null and not exists (select 1 from public.leads l where l.id = p_lead_id) then
    raise exception 'Lead not found';
  elsif p_client_id is not null and not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'Client not found';
  end if;
  v_key := coalesce(p_deal_id, p_lead_id, p_client_id);
  if v_amount <= 0 or v_amount > 10000 then raise exception 'The amount must be more than R0 and at most R10,000'; end if;
  if p_reason is not null and length(p_reason) > 300 then raise exception 'Keep the reason under 300 characters'; end if;

  if p_beneficiary_profile_id is not null then
    select p.role::text, coalesce(nullif(btrim(p.full_name), ''), p.email) into v_role, v_name
      from public.profiles p where p.id = p_beneficiary_profile_id and p.is_active;
    if v_role is null then raise exception 'Choose an active person'; end if;
    v_kind := public.file_reward_kind_of(v_role);
    if v_kind is null then raise exception 'That person cannot receive the R100 (choose an agent, a field person or office staff)'; end if;
  else
    if v_name is null or length(v_name) not between 2 and 120 then
      raise exception 'Choose a person or type the name of who gets the R100 (2 to 120 characters)';
    end if;
    v_kind := 'outside';
  end if;

  -- A lead that already has a deal is chosen through the deal (one file, one R100).
  if p_lead_id is not null and exists (select 1 from public.deals d where d.lead_id = p_lead_id and d.archived_at is null) then
    raise exception 'This lead already has a deal; choose the deal';
  end if;
  if p_client_id is not null and exists (select 1 from public.deals d where d.client_id = p_client_id and d.archived_at is null) then
    raise exception 'This client already has a deal; choose the deal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('file_reward:' || coalesce(v_lead, v_key)::text, 0));
  -- The current choice for this file: the same key, or (choosing a deal) one made earlier on its lead before the deal.
  select * into v_old from public.file_reward_assignments a
   where a.is_current and (a.file_key = v_key or (p_deal_id is not null and a.deal_id is null and a.lead_id = v_lead))
   for update;
  if found then
    if v_old.paid_on is not null then raise exception 'The R100 for this file is already paid; it cannot be given to someone else'; end if;
    if v_old.payslip_line_id is not null and exists (select 1 from public.payslip_lines l
                                                      where l.id = v_old.payslip_line_id and l.removed_at is null) then
      raise exception 'The R100 for this file is already on a payslip; remove that line first';
    end if;
    update public.file_reward_assignments set is_current = false, replaced_at = now() where id = v_old.id;
  end if;

  insert into public.file_reward_assignments (file_key, deal_id, lead_id, client_id, beneficiary_kind, beneficiary_profile_id,
                                              beneficiary_name, amount, reason, chosen_by)
  values (v_key, p_deal_id, v_lead, v_client,
          v_kind, p_beneficiary_profile_id, v_name, v_amount, nullif(btrim(coalesce(p_reason, '')), ''), v_uid)
  returning id into v_id;
  perform public.staff_audit_write('file_reward', v_id, case when v_old.id is null then 'file_reward_chosen' else 'file_reward_replaced' end,
    p_reason, jsonb_build_object('file', public.file_reward_label(p_deal_id, v_lead, v_client), 'deal_id', p_deal_id,
      'lead_id', v_lead, 'client_id', v_client, 'beneficiary', v_name, 'kind', v_kind, 'amount', v_amount,
      'replaced', v_old.beneficiary_name));
  return v_id;
end;
$$;
revoke all on function public.owner_set_file_reward(uuid, uuid, uuid, uuid, text, text, numeric) from public, anon;
grant execute on function public.owner_set_file_reward(uuid, uuid, uuid, uuid, text, text, numeric) to authenticated;

-- 5. Mark an agent / outside R100 paid (staff are paid on the payslip) -------------------------------------------------
create or replace function public.owner_mark_file_reward_paid(p_id uuid, p_paid_on date, p_reference text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.file_reward_require_owner(); v_row public.file_reward_assignments; v_rows int;
begin
  select * into v_row from public.file_reward_assignments a where a.id = p_id for update;
  if not found then raise exception 'R100 choice not found'; end if;
  if not v_row.is_current then raise exception 'That choice was replaced; pay the current one'; end if;
  if v_row.paid_on is not null then raise exception 'Already marked paid'; end if;
  if v_row.beneficiary_kind = 'staff' then raise exception 'Staff are paid on their payslip'; end if;
  if p_paid_on is null or p_paid_on > public.current_sast_date() then raise exception 'Enter the date it was paid (today or earlier)'; end if;
  if length(btrim(coalesce(p_reference, ''))) not between 2 and 120 then raise exception 'Enter the payment reference (2 to 120 characters)'; end if;
  update public.file_reward_assignments
     set paid_on = p_paid_on, paid_reference = btrim(p_reference), paid_by = v_uid
   where id = p_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'Marking it paid affected no rows'; end if;
  perform public.staff_audit_write('file_reward', p_id, 'file_reward_paid', null,
    jsonb_build_object('paid_on', p_paid_on, 'reference', btrim(p_reference), 'amount', v_row.amount,
                       'beneficiary', v_row.beneficiary_name));
  return p_id;
end;
$$;
revoke all on function public.owner_mark_file_reward_paid(uuid, date, text) from public, anon;
grant execute on function public.owner_mark_file_reward_paid(uuid, date, text) to authenticated;

-- 6. Staff R100s on the payslip (cycle after the month the choice was made) -------------------------------------------
create or replace function public.payroll_apply_file_rewards(p_cycle uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_month date; v_status text; r record; v_line uuid; v_count integer := 0;
begin
  if not public.staff_is_founder_or_administrator() then
    raise exception 'Only the Administrator or the Director prepares payslips' using errcode = '42501';
  end if;
  select c.pay_month, c.status into v_month, v_status from public.payroll_cycles c where c.id = p_cycle;
  if v_month is null then raise exception 'Payroll cycle not found'; end if;
  if v_status in ('closed', 'paid') then raise exception 'This payroll cycle is closed'; end if;
  for r in
    select a.id, a.amount, a.deal_id, a.lead_id, a.client_id, ps.id as payslip_id
      from public.file_reward_assignments a
      join public.payslips ps on ps.cycle_id = p_cycle and ps.profile_id = a.beneficiary_profile_id and ps.status = 'draft'
     where a.is_current and a.beneficiary_kind = 'staff' and a.paid_on is null
       and date_trunc('month', a.chosen_at at time zone 'Africa/Johannesburg')::date = (v_month - interval '1 month')::date
       and not exists (select 1 from public.payslip_lines l where l.id = a.payslip_line_id and l.removed_at is null)
     for update of a
  loop
    v_line := public.payslip_add_line(r.payslip_id, 'incentive',
      'R100 file reward: ' || left(public.file_reward_label(r.deal_id, r.lead_id, r.client_id), 120), r.amount);
    update public.file_reward_assignments set payslip_line_id = v_line where id = r.id;
    perform public.staff_audit_write('file_reward', r.id, 'file_reward_on_payslip', null,
      jsonb_build_object('payslip_id', r.payslip_id, 'line_id', v_line, 'amount', r.amount));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.payroll_apply_file_rewards(uuid) from public, anon;
grant execute on function public.payroll_apply_file_rewards(uuid) to authenticated;

-- 7. The Files report ---------------------------------------------------------------------------------------------------
-- Files of a month: every deal that first reached Submitted (or later) in the month, plus every file whose R100 was
-- chosen in the month. Stage filter on the deal's CURRENT stage: all / submitted / in_credit / later (after In credit,
-- not declined). Owner only.
create or replace function public.owner_files_report(p_month date, p_stage text default 'all')
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, public.current_sast_date()))::date;
  v_rate numeric := coalesce(public.staff_incentive_rate('coordinator_qualifying_file', v_month), 0);
  v_rows jsonb;
begin
  perform public.file_reward_require_owner();
  if coalesce(p_stage, 'all') not in ('all', 'submitted', 'in_credit', 'later') then
    raise exception 'Choose all, submitted, in credit or later';
  end if;

  with reach as (
    select h.deal_id, min(h.changed_at) filter (where public.deal_stage_is_submitted_or_later(h.to_stage)) as submitted_at,
           min(h.changed_at) filter (where h.to_stage = 'in_credit') as in_credit_at
      from public.deal_stage_history h group by h.deal_id
  ), rewards as (
    select a.* from public.file_reward_assignments a where a.is_current
  ), files as (
    select d.id as deal_id, d.lead_id, d.client_id from public.deals d join reach r on r.deal_id = d.id
     where d.archived_at is null and r.submitted_at is not null
       and date_trunc('month', r.submitted_at at time zone 'Africa/Johannesburg')::date = v_month
    union
    select a.deal_id, a.lead_id, a.client_id from rewards a
     where date_trunc('month', a.chosen_at at time zone 'Africa/Johannesburg')::date = v_month
  ), credits as (
    select c.lead_id, c.handler_id, c.handler_name, c.reached_submitted_at from public.coordinator_file_credits() c
  ), rows as (
    select f.deal_id, f.lead_id, f.client_id, d.reference, d.stage,
           coalesce(l.business_name, cl.business_name, public.file_reward_label(f.deal_id, f.lead_id, f.client_id)) as business_name,
           r.submitted_at, r.in_credit_at,
           si.channel::text as channel,
           coalesce(nullif(btrim(cp.full_name), ''), cp.email) as captured_by,
           coalesce(nullif(btrim(hp.full_name), ''), hp.email) as handler,
           coalesce(nullif(btrim(ap.full_name), ''), ap.email) as agent_name,
           rp.name as organisation_name,
           to_jsonb(si) ->> 'inhouse_kind' as inhouse_kind,
           (select coalesce(nullif(btrim(fp.full_name), ''), fp.email) from public.profiles fp
             where fp.id = nullif(to_jsonb(si) ->> 'field_agent_id', '')::uuid) as field_agent,
           cr.handler_id as r29_handler_id, cr.handler_name as r29_handler, cr.reached_submitted_at as r29_at,
           a.id as reward_id, a.beneficiary_name, a.beneficiary_kind, a.amount as reward_amount, a.paid_on, a.paid_reference,
           (a.payslip_line_id is not null and exists (select 1 from public.payslip_lines pl
                                                       where pl.id = a.payslip_line_id and pl.removed_at is null)) as reward_on_payslip
      from files f
      left join public.deals d on d.id = f.deal_id
      left join reach r on r.deal_id = f.deal_id
      left join public.leads l on l.id = f.lead_id
      left join public.clients cl on cl.id = f.client_id
      left join public.submission_intakes si on si.lead_id = f.lead_id
      left join public.profiles cp on cp.id = si.created_by
      left join public.profiles hp on hp.id = si.operational_assignee_id
      left join public.profiles ap on ap.id = si.agent_profile_id
      left join public.referral_partners rp on rp.id = si.organisation_id
      left join credits cr on cr.lead_id = f.lead_id
      left join rewards a on a.file_key = coalesce(f.deal_id, f.lead_id, f.client_id)
     where coalesce(p_stage, 'all') = 'all'
        or (p_stage = 'submitted' and d.stage = 'submitted')
        or (p_stage = 'in_credit' and d.stage = 'in_credit')
        or (p_stage = 'later' and d.stage > 'in_credit'::public.deal_stage and d.stage <> 'declined'::public.deal_stage)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'deal_id', x.deal_id, 'lead_id', x.lead_id, 'client_id', x.client_id, 'deal_reference', x.reference,
           'business_name', x.business_name, 'stage', x.stage, 'in_credit', x.stage = 'in_credit',
           'reached_submitted_at', x.submitted_at, 'reached_in_credit_at', x.in_credit_at,
           'captured_by', x.captured_by, 'handler', x.handler,
           'source', case x.channel
                       when 'inhouse' then 'Fund Now Capital (in-house)'
                       when 'field' then 'Field team' || coalesce(' — ' || x.field_agent, '')
                       when 'direct_agent' then 'Direct agent' || coalesce(' — ' || x.agent_name, '')
                       when 'team' then 'Team' || coalesce(' — ' || x.organisation_name, '') || coalesce(' · ' || x.agent_name, '')
                       when 'referral_partner' then coalesce(x.organisation_name, 'Referral partner') || coalesce(' · ' || x.agent_name, '')
                       else null end,
           'r29', case when x.r29_handler_id is null then null else jsonb_build_object(
                    'handler', x.r29_handler,
                    'counts_in_month', date_trunc('month', x.r29_at at time zone 'Africa/Johannesburg')::date = v_month,
                    'rate', v_rate,
                    'signed_off', exists (select 1 from public.qualifying_file_signoffs s
                                           where s.handler_id = x.r29_handler_id and x.lead_id = any (s.lead_ids)),
                    'on_payslip', exists (select 1 from public.qualifying_file_signoffs s join public.payslip_lines pl on pl.id = s.payslip_line_id
                                           where s.handler_id = x.r29_handler_id and x.lead_id = any (s.lead_ids) and pl.removed_at is null)) end,
           'r100', case when x.reward_id is null then null else jsonb_build_object(
                     'id', x.reward_id, 'beneficiary', x.beneficiary_name, 'kind', x.beneficiary_kind, 'amount', x.reward_amount,
                     'path', case x.beneficiary_kind when 'agent' then 'agent: lock through the R100 engine on the deal, or pay and mark paid here'
                                                     when 'staff' then 'staff: added to the payslip in the next cycle'
                                                     else 'outside the CRM: pay and mark paid here' end,
                     'status', case when x.paid_on is not null then 'paid'
                                    when x.reward_on_payslip then 'on_payslip'
                                    else 'to_pay' end,
                     'paid_on', x.paid_on, 'paid_reference', x.paid_reference) end)
         order by x.submitted_at nulls last, x.business_name), '[]'::jsonb)
    into v_rows
    from rows x;

  return jsonb_build_object(
    'month', v_month, 'stage', coalesce(p_stage, 'all'), 'rows', v_rows, 'r29_rate', v_rate,
    'r29_count', (select count(*) from jsonb_array_elements(v_rows) e where (e -> 'r29' ->> 'counts_in_month')::boolean),
    'r29_total', round(v_rate * (select count(*) from jsonb_array_elements(v_rows) e where (e -> 'r29' ->> 'counts_in_month')::boolean), 2),
    'r100_count', (select count(*) from jsonb_array_elements(v_rows) e where e -> 'r100' is not null and e -> 'r100' <> 'null'::jsonb),
    'r100_total', coalesce((select sum((e -> 'r100' ->> 'amount')::numeric) from jsonb_array_elements(v_rows) e
                             where e -> 'r100' is not null and e -> 'r100' <> 'null'::jsonb), 0));
end;
$$;
revoke all on function public.owner_files_report(date, text) from public, anon;
grant execute on function public.owner_files_report(date, text) to authenticated;
