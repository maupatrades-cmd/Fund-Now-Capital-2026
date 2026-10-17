-- Sales Coordinator build SC2: funder-side stages, hidden from staff and agents.
-- The staff workflow (new .. verified) ends at Verified. What happens after the Founder
-- submits (query, offer, approved, declined, withdrawn, funded, stale) is recorded here by the
-- OWNER only. The stage names carry no funder identity; staff, agents and partners never read
-- this table. They see only the approved wording from intake_status_wording(), which never
-- includes a funder name, rate or tier.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'intake_funder_stage') then
    create type public.intake_funder_stage as enum
      ('submitted', 'funder_query', 'offer', 'approved', 'declined', 'withdrawn', 'funded', 'stale');
  end if;
end $$;

create table if not exists public.submission_intake_funder_stage (
  lead_id          uuid primary key references public.submission_intakes(lead_id) on delete restrict,
  stage            public.intake_funder_stage not null,
  -- Category only, never free text (it can be shown to clients and agents).
  decline_category text check (decline_category in
    ('affordability', 'documentation', 'credit_profile', 'sector_policy', 'other')),
  set_by           uuid not null references public.profiles(id) on delete restrict,
  set_at           timestamptz not null default now(),
  constraint funder_stage_decline_category_ck check (stage = 'declined' or decline_category is null)
);

create table if not exists public.submission_intake_funder_stage_events (
  id               bigint generated always as identity primary key,
  lead_id          uuid not null references public.submission_intakes(lead_id) on delete restrict,
  stage            public.intake_funder_stage not null,
  decline_category text,
  note             text,
  actor_id         uuid not null references public.profiles(id) on delete restrict,
  created_at       timestamptz not null default now()
);
create index if not exists funder_stage_events_lead_idx on public.submission_intake_funder_stage_events (lead_id, id);

create or replace function public.funder_stage_events_block_rewrite()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Funder stage history is append-only: corrections are new events';
end;
$$;
create trigger funder_stage_events_no_update_delete
  before update or delete on public.submission_intake_funder_stage_events
  for each row execute function public.funder_stage_events_block_rewrite();

alter table public.submission_intake_funder_stage enable row level security;
alter table public.submission_intake_funder_stage_events enable row level security;
create policy funder_stage_owner_select on public.submission_intake_funder_stage
  for select to authenticated using (public.is_owner());
create policy funder_stage_events_owner_select on public.submission_intake_funder_stage_events
  for select to authenticated using (public.is_owner());
revoke all on table public.submission_intake_funder_stage from anon, authenticated;
revoke all on table public.submission_intake_funder_stage_events from anon, authenticated;
grant select on table public.submission_intake_funder_stage to authenticated;
grant select on table public.submission_intake_funder_stage_events to authenticated;

-- Owner records the stage after submission. Only a Verified file can have a funder stage.
create or replace function public.owner_set_funder_stage(
  p_lead_id uuid, p_stage public.intake_funder_stage,
  p_decline_category text default null, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_status public.intake_workflow_status; v_uid uuid := (select auth.uid());
begin
  if not public.is_owner() then raise exception 'Only the owner can record a funder-side stage' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('funder_stage:' || p_lead_id::text, 0));
  select si.workflow_status into v_status from public.submission_intakes si where si.lead_id = p_lead_id;
  if not found then raise exception 'Submission not found'; end if;
  if v_status <> 'verified' then raise exception 'Only a Verified file can have a funder-side stage'; end if;
  if p_stage = 'declined' and p_decline_category is null then
    raise exception 'A decline needs a reason category';
  end if;
  if p_note is not null and not public.staff_text_is_safe(p_note) then
    raise exception 'The note looks like it holds an ID or account number';
  end if;

  insert into public.submission_intake_funder_stage (lead_id, stage, decline_category, set_by)
  values (p_lead_id, p_stage, case when p_stage = 'declined' then p_decline_category end, v_uid)
  on conflict (lead_id) do update
    set stage = excluded.stage, decline_category = excluded.decline_category,
        set_by = excluded.set_by, set_at = now();
  insert into public.submission_intake_funder_stage_events (lead_id, stage, decline_category, note, actor_id)
  values (p_lead_id, p_stage, case when p_stage = 'declined' then p_decline_category end, nullif(btrim(p_note), ''), v_uid);
  perform public.staff_audit_write('submission_intake', p_lead_id, 'funder_stage_set', p_note,
    jsonb_build_object('stage', p_stage));
end;
$$;

-- Approved wording. Internal only (not granted to clients): callers wrap it in a role check.
create or replace function public.intake_status_wording(p_lead_id uuid)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_status public.intake_workflow_status; v_stage public.intake_funder_stage; v_cat text; v_missing text[];
begin
  select si.workflow_status into v_status from public.submission_intakes si where si.lead_id = p_lead_id;
  if not found then return null; end if;
  select fs.stage, fs.decline_category into v_stage, v_cat
    from public.submission_intake_funder_stage fs where fs.lead_id = p_lead_id;
  if v_stage is not null then
    return case v_stage
      when 'submitted'    then 'Submitted to a funding partner'
      when 'funder_query' then 'The funding partner has a question. We will contact the client.'
      when 'offer'        then 'Offer received. Waiting for the client to accept.'
      when 'approved'     then 'Approved. Payout is being arranged.'
      when 'declined'     then 'Not approved at this time. Reason: ' || replace(coalesce(v_cat, 'other'), '_', ' ')
      when 'withdrawn'    then 'This application has been withdrawn.'
      when 'funded'       then 'Funded. The commission process has started.'
      when 'stale'        then 'On hold: no response from the client for 10 business days'
    end;
  end if;
  return case v_status
    when 'new' then 'Received. We are contacting the client.'
    when 'documents_incomplete' then 'Waiting for documents: ' ||
      coalesce(nullif(replace(array_to_string(public.intake_required_docs_missing(p_lead_id), ', '), '_', ' '), ''), 'none outstanding')
    when 'complete' then 'File complete and under internal review'
    when 'with_founder' then 'File complete and under internal review'
    when 'verified' then 'Submitted to a funding partner'
  end;
end;
$$;
revoke all on function public.intake_status_wording(uuid) from public, anon, authenticated;

-- Staff projection: wording for a batch of files. No stage, no funder, no ids beyond the file.
create or replace function public.staff_status_wordings(p_lead_ids uuid[])
returns table (lead_id uuid, wording text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  return query
    select t.i, public.intake_status_wording(t.i)
      from (select unnest(coalesce(p_lead_ids, '{}'::uuid[])) as i limit 100) t;
end;
$$;

-- The agent / Team Leader / partner "My files" wording surface arrives with SC10, built on the
-- same intake_status_wording() helper behind a proper per-caller visibility check.

revoke all on function public.owner_set_funder_stage(uuid, public.intake_funder_stage, text, text) from public, anon;
revoke all on function public.staff_status_wordings(uuid[]) from public, anon;
grant execute on function public.owner_set_funder_stage(uuid, public.intake_funder_stage, text, text) to authenticated;
grant execute on function public.staff_status_wordings(uuid[]) to authenticated;
