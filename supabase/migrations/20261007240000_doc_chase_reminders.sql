-- Staff build, Batch 4: day 3 and day 7 document chasers.
-- When a file has been in Documents incomplete for 3 and for 7 working days (12 working hours a day,
-- 08:00 to 20:00 weekdays, not public holidays), the Coordinator gets an in-app chaser to follow up
-- with the client. Counted from the latest move into Documents incomplete. Nothing is sent to anyone.

create table if not exists public.intake_document_reminders (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.submission_intakes(lead_id) on delete cascade,
  day_mark     integer not null check (day_mark in (3, 7)),
  entered_at   timestamptz not null,
  due_at       timestamptz not null,
  status       text not null default 'open' check (status in ('open', 'done', 'skipped')),
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  note         text check (note is null or length(note) <= 300 and public.staff_text_is_safe(note)),
  created_at   timestamptz not null default now(),
  constraint intake_document_reminders_uq unique (lead_id, day_mark, entered_at),
  constraint intake_document_reminders_done_ck check ((status = 'done') = (completed_at is not null))
);
create index if not exists intake_document_reminders_open_idx on public.intake_document_reminders (due_at) where status = 'open';
alter table public.intake_document_reminders enable row level security;
revoke all on table public.intake_document_reminders from public, anon, authenticated;

create or replace function public.generate_document_chasers()
returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_entered timestamptz; v_mark integer; v_due timestamptz; v_n integer := 0; v_rows integer;
begin
  -- A file that moved on, or was archived, stops needing a chaser.
  update public.intake_document_reminders d set status = 'skipped'
   where d.status = 'open' and not exists (
     select 1 from public.submission_intakes si
      where si.lead_id = d.lead_id and si.workflow_status = 'documents_incomplete' and si.archived_at is null);

  for r in select si.lead_id, si.registered_at from public.submission_intakes si
            where si.workflow_status = 'documents_incomplete' and si.archived_at is null loop
    select max(e.occurred_at) into v_entered from public.staff_audit_events e
     where e.entity_type = 'submission_intake' and e.entity_id = r.lead_id
       and e.event_type = 'status_changed' and e.detail->>'to' = 'documents_incomplete';
    v_entered := coalesce(v_entered, r.registered_at);
    foreach v_mark in array array[3, 7] loop
      v_due := public.business_hours_add(v_entered, v_mark * 12);
      if now() >= v_due then
        insert into public.intake_document_reminders (lead_id, day_mark, entered_at, due_at)
        values (r.lead_id, v_mark, v_entered, v_due) on conflict do nothing;
        get diagnostics v_rows = row_count; v_n := v_n + v_rows;
      end if;
    end loop;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.generate_document_chasers() from public, anon, authenticated;

create or replace function public.staff_document_chasers()
returns table (id uuid, lead_id uuid, business_name text, day_mark integer, due_at timestamptz, missing_documents text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  return query
    select d.id, d.lead_id, l.business_name, d.day_mark, d.due_at, public.intake_required_docs_missing(d.lead_id)
      from public.intake_document_reminders d join public.leads l on l.id = d.lead_id
     where d.status = 'open' order by d.day_mark desc, d.due_at asc limit 100;
end;
$$;

create or replace function public.staff_complete_document_chaser(p_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare d public.intake_document_reminders;
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  select * into d from public.intake_document_reminders where id = p_id for update;
  if not found or d.status <> 'open' then raise exception 'That chaser is not open'; end if;
  update public.intake_document_reminders
     set status = 'done', completed_by = (select auth.uid()), completed_at = now(), note = nullif(btrim(p_note), '')
   where id = p_id;
  perform public.staff_audit_write('submission_intake', d.lead_id, 'document_chaser_done', null, jsonb_build_object('day_mark', d.day_mark));
end;
$$;
revoke all on function public.staff_document_chasers() from public, anon;
revoke all on function public.staff_complete_document_chaser(uuid, text) from public, anon;
grant execute on function public.staff_document_chasers() to authenticated;
grant execute on function public.staff_complete_document_chaser(uuid, text) to authenticated;

create extension if not exists pg_cron;
select cron.schedule('staff-document-chasers', '40 4 * * 1-5', $$select public.generate_document_chasers();$$);
