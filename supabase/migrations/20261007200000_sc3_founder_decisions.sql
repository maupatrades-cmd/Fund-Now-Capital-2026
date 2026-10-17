-- Sales Coordinator build SC3: Deal Summary and the four Founder Decision buttons.
-- The Coordinator sends a finished (Complete) file to the Founder with a one-page Deal Summary.
-- The Founder (Owner) answers with one of four decisions; each one moves the file and leaves the
-- Coordinator a follow-up task. Funder-side facts never enter these tables.
-- Decline: recorded as the funder-side stage 'declined' with a reason category (no free text),
-- so the approved wording already covers it. The stage row is written directly here because the
-- file has not been verified (owner_set_funder_stage requires Verified).

create table if not exists public.founder_deal_summaries (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.submission_intakes(lead_id) on delete restrict,
  task_id          uuid references public.staff_tasks(id) on delete set null,
  amount_purpose   text not null check (length(btrim(amount_purpose)) between 3 and 600),
  turnover_trading text not null check (length(btrim(turnover_trading)) between 3 and 600),
  documents_note   text check (documents_note is null or length(documents_note) <= 600),
  red_flags        text check (red_flags is null or length(red_flags) <= 600),
  written_by       uuid not null references public.profiles(id) on delete restrict,
  created_at       timestamptz not null default now(),
  constraint founder_deal_summaries_safe_text_ck check (
    public.staff_text_is_safe(amount_purpose) and public.staff_text_is_safe(turnover_trading)
    and public.staff_text_is_safe(documents_note) and public.staff_text_is_safe(red_flags))
);
create index if not exists founder_deal_summaries_lead_idx on public.founder_deal_summaries (lead_id, created_at desc);

create table if not exists public.founder_decisions (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.submission_intakes(lead_id) on delete restrict,
  task_id          uuid references public.staff_tasks(id) on delete set null,
  decision         text not null check (decision in ('approve_to_submit', 'send_back_with_query', 'decline', 'call_me')),
  decline_category text check (decline_category in ('affordability', 'documentation', 'credit_profile', 'sector_policy', 'other')),
  note             text check (note is null or length(note) <= 600),
  decided_by       uuid not null references public.profiles(id) on delete restrict,
  decided_at       timestamptz not null default now(),
  constraint founder_decisions_safe_text_ck check (public.staff_text_is_safe(note)),
  constraint founder_decisions_category_ck check (decision = 'decline' or decline_category is null)
);
create index if not exists founder_decisions_lead_idx on public.founder_decisions (lead_id, decided_at desc);

create or replace function public.founder_records_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only: record a new entry instead', tg_table_name;
end;
$$;
create trigger founder_deal_summaries_append_only before update or delete on public.founder_deal_summaries
  for each row execute function public.founder_records_append_only();
create trigger founder_decisions_append_only before update or delete on public.founder_decisions
  for each row execute function public.founder_records_append_only();

alter table public.founder_deal_summaries enable row level security;
alter table public.founder_decisions enable row level security;
create policy founder_deal_summaries_owner_select on public.founder_deal_summaries
  for select to authenticated using (public.is_owner());
create policy founder_decisions_owner_select on public.founder_decisions
  for select to authenticated using (public.is_owner());
revoke all on table public.founder_deal_summaries from public, anon, authenticated;
revoke all on table public.founder_decisions from public, anon, authenticated;
grant select on table public.founder_deal_summaries to authenticated;
grant select on table public.founder_decisions to authenticated;

-- Coordinator (or Owner) sends a Complete file to the Founder with the Deal Summary.
create or replace function public.staff_send_founder_decision(
  p_lead_id uuid, p_amount_purpose text, p_turnover_trading text,
  p_documents_note text default null, p_red_flags text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_status public.intake_workflow_status; v_name text; v_task uuid; v_uid uuid := (select auth.uid());
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  perform pg_advisory_xact_lock(hashtextextended('founder_decision:' || p_lead_id::text, 0));
  select si.workflow_status, l.business_name into v_status, v_name
    from public.submission_intakes si join public.leads l on l.id = si.lead_id where si.lead_id = p_lead_id;
  if not found then raise exception 'Submission not found'; end if;
  if v_status <> 'complete' then raise exception 'Only a Complete file can be sent to the Founder'; end if;
  if exists (select 1 from public.staff_tasks t
              where t.lead_id = p_lead_id and t.task_kind = 'founder_decision' and t.status = 'open') then
    raise exception 'This file already has an open Founder decision';
  end if;

  v_task := public.staff_create_task('Founder decision: ' || left(v_name, 120),
    'Deal Summary attached to the file. Choose one of the four decisions.',
    'founder_decision', 'high', now() + interval '1 day', 'owner', p_lead_id, null);
  insert into public.founder_deal_summaries
    (lead_id, task_id, amount_purpose, turnover_trading, documents_note, red_flags, written_by)
  values (p_lead_id, v_task, btrim(p_amount_purpose), btrim(p_turnover_trading),
          nullif(btrim(p_documents_note), ''), nullif(btrim(p_red_flags), ''), v_uid);
  perform public.staff_set_intake_status(p_lead_id, 'with_founder', null);
  perform public.staff_audit_write('submission_intake', p_lead_id, 'sent_to_founder', null,
    jsonb_build_object('task_id', v_task));
  return v_task;
end;
$$;

-- Owner reads the Deal Summary that belongs to a Founder decision task.
create or replace function public.owner_deal_summary(p_task_id uuid)
returns table (business_name text, funding_type_label text, requested_amount numeric,
               amount_purpose text, turnover_trading text, documents_note text, red_flags text,
               agent_name text, team_name text, written_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can read Deal Summaries' using errcode = '42501'; end if;
  return query
    select l.business_name, fpc.display_name, l.funding_amount, s.amount_purpose, s.turnover_trading,
           s.documents_note, s.red_flags, ap.full_name, rt.name, s.created_at
      from public.founder_deal_summaries s
      join public.submission_intakes si on si.lead_id = s.lead_id
      join public.leads l on l.id = si.lead_id
      join public.funding_product_catalog fpc on fpc.code = si.funding_type
      left join public.profiles ap on ap.id = si.agent_profile_id
      left join public.referral_teams rt on rt.id = si.team_id
     where s.task_id = p_task_id
     order by s.created_at desc limit 1;
end;
$$;

-- The four buttons.
create or replace function public.owner_decide_founder_task(
  p_task_id uuid, p_decision text, p_note text default null, p_decline_category text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_task public.staff_tasks; v_status public.intake_workflow_status; v_uid uuid := (select auth.uid());
  v_follow text;
begin
  if not public.is_owner() then raise exception 'Only the owner can decide' using errcode = '42501'; end if;
  if p_decision not in ('approve_to_submit', 'send_back_with_query', 'decline', 'call_me') then
    raise exception 'Unknown decision';
  end if;
  select * into v_task from public.staff_tasks t where t.id = p_task_id for update;
  if not found or v_task.task_kind <> 'founder_decision' or v_task.status <> 'open' or v_task.lead_id is null then
    raise exception 'That is not an open Founder decision';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('founder_decision:' || v_task.lead_id::text, 0));
  select si.workflow_status into v_status from public.submission_intakes si where si.lead_id = v_task.lead_id;
  if v_status <> 'with_founder' then raise exception 'The file is not with the Founder (it is %)', v_status; end if;

  if p_decision = 'send_back_with_query' and length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'Write the question for the client (at least 10 characters)';
  end if;
  if p_decision = 'decline' and p_decline_category is null then
    raise exception 'A decline needs a reason category';
  end if;
  if p_note is not null and not public.staff_text_is_safe(p_note) then
    raise exception 'The note looks like it holds an ID or account number';
  end if;

  if p_decision = 'approve_to_submit' then
    perform public.staff_set_intake_status(v_task.lead_id, 'verified', null);
    v_follow := 'Tell the agent and Team Leader: Submitted to a funding partner';
  elsif p_decision = 'send_back_with_query' then
    perform public.staff_set_intake_status(v_task.lead_id, 'documents_incomplete', btrim(p_note));
    v_follow := 'Get the answer or document from the client, then send the file back to the Founder';
  elsif p_decision = 'decline' then
    insert into public.submission_intake_funder_stage (lead_id, stage, decline_category, set_by)
    values (v_task.lead_id, 'declined', p_decline_category, v_uid)
    on conflict (lead_id) do update
      set stage = 'declined', decline_category = excluded.decline_category, set_by = excluded.set_by, set_at = now();
    insert into public.submission_intake_funder_stage_events (lead_id, stage, decline_category, note, actor_id)
    values (v_task.lead_id, 'declined', p_decline_category, nullif(btrim(p_note), ''), v_uid);
    v_follow := 'Tell the client, agent and Team Leader the file was not approved, in approved wording';
  else
    v_follow := 'Book the Founder a 10-minute call for this file and prepare the file';
  end if;

  insert into public.founder_decisions (lead_id, task_id, decision, decline_category, note, decided_by)
  values (v_task.lead_id, p_task_id, p_decision, case when p_decision = 'decline' then p_decline_category end,
          nullif(btrim(p_note), ''), v_uid);
  perform public.staff_close_task(p_task_id, 'done', p_decision);
  perform public.staff_create_task(v_follow, nullif(btrim(p_note), ''), 'general', 'high',
    now() + interval '1 day', 'coordinator', v_task.lead_id, null);
  perform public.staff_audit_write('submission_intake', v_task.lead_id, 'founder_decided', null,
    jsonb_build_object('decision', p_decision, 'task_id', p_task_id));
end;
$$;

-- What the Coordinator may see of the Founder's answer: the decision, the decline category and the
-- Founder's question for the client. Nothing else.
create or replace function public.staff_file_decision(p_lead_id uuid)
returns table (decision text, decline_category text, note text, decided_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  return query
    select d.decision, d.decline_category, d.note, d.decided_at
      from public.founder_decisions d where d.lead_id = p_lead_id order by d.decided_at desc limit 1;
end;
$$;

revoke all on function public.staff_send_founder_decision(uuid, text, text, text, text) from public, anon;
revoke all on function public.owner_deal_summary(uuid) from public, anon;
revoke all on function public.owner_decide_founder_task(uuid, text, text, text) from public, anon;
revoke all on function public.staff_file_decision(uuid) from public, anon;
grant execute on function public.staff_send_founder_decision(uuid, text, text, text, text) to authenticated;
grant execute on function public.owner_deal_summary(uuid) to authenticated;
grant execute on function public.owner_decide_founder_task(uuid, text, text, text) to authenticated;
grant execute on function public.staff_file_decision(uuid) to authenticated;
