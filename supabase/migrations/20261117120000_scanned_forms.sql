-- Scan & upload paper forms (owner spec, 17 Nov 2026).
--
-- Staff fill in the printed FNC forms by hand, scan them (scanner or phone camera) and upload them, linked to a
-- client/deal, a staff member, an agent, a field contractor, or nothing (office registers).
--
-- Why a new ledger instead of an existing store:
--   * public.documents is the client/deal/lead evidence store (52-value document_type enum, per-type supersede,
--     bank-statement packs, expiry, partner RLS). It cannot link a staff member, an agent or an office register,
--     and its partner policies would be wrong for HR and CEO-only forms.
--   * public.contractor_documents is a contractor's OWN onboarding checklist (owner + that contractor only).
--   * public.doc_catalogue is the required-documents LIST for a funding file; it holds no files.
-- So this adds ONE generic ledger (a form submission + its versioned pages) and ONE private bucket, scanned-forms,
-- path <form_code>/<yyyy>/<mm>/<uuid>-<page>.<ext>. Nothing else stores scanned forms.
--
-- Visibility (catalogue roles): the Director (owner) sees every form. CEO-only forms exist for the owner alone:
-- their catalogue rows and uploads are invisible to every other role. Anyone else sees a form when their staff role
-- is a viewer of that form, when they uploaded it, or (self_view forms) when it is about them. Agents and clients
-- see nothing here. No form record carries funder names.
--
-- Access to files: storage SELECT is only allowed through a short-lived access ticket that
-- scanned_form_open_file() issues after checking visibility and writing the view/download to activity_logs; the
-- browser then asks Storage for a signed URL. There are no public links. Replacing keeps every earlier version.
-- Only the owner deletes (soft delete + storage removal), and every upload, view, download, replace and delete is
-- logged in activity_logs (POPIA).

-- 1. Catalogue ---------------------------------------------------------------------------------------------------
create table public.scanned_form_catalogue (
  code           text primary key check (code ~ '^[A-Z0-9-]{3,24}$'),
  title          text not null check (length(btrim(title)) between 3 and 120),
  category       text not null check (category in ('client_deal', 'ceo', 'agent', 'finance', 'hr', 'office', 'field')),
  link_kind      text not null check (link_kind in ('client', 'staff', 'agent', 'person', 'field_contractor', 'none')),
  link_required  boolean not null default true,
  period_kind    text not null default 'date' check (period_kind in ('date', 'day', 'week', 'month')),
  reminder       text check (reminder in ('daily', 'weekly')),
  uploader_roles text[] not null default '{}',
  viewer_roles   text[] not null default '{}',
  self_view      boolean not null default false,
  ceo_only       boolean not null default false,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  constraint scanned_form_catalogue_ceo_ck check (not ceo_only or (uploader_roles = '{}' and viewer_roles = '{}' and not self_view)),
  constraint scanned_form_catalogue_link_ck check (link_kind <> 'none' or not link_required)
);
alter table public.scanned_form_catalogue enable row level security;
revoke all on table public.scanned_form_catalogue from public, anon, authenticated;

-- Roles: owner is implied everywhere and never listed. Staff roles: administrator, coordinator, switchboard, hr,
-- field_supervisor, field_consultant.
insert into public.scanned_form_catalogue
  (code, title, category, link_kind, link_required, period_kind, reminder, uploader_roles, viewer_roles, self_view, ceo_only, sort_order)
values
  -- Client / deal (client required; deal optional and must belong to the client)
  ('FNC-CAF-01', 'Client Funding Application Form', 'client_deal', 'client', true, 'date', null, '{administrator,coordinator}', '{administrator,coordinator}', false, false, 10),
  ('FNC-DCL-01', 'Document Checklist', 'client_deal', 'client', true, 'date', null, '{administrator,coordinator}', '{administrator,coordinator}', false, false, 11),
  ('FNC-LRF-01', 'Lead Referral Form', 'client_deal', 'client', true, 'date', null, '{administrator,coordinator,switchboard}', '{administrator,coordinator}', false, false, 12),
  ('FNC-CL-01', 'Deal Summary', 'client_deal', 'client', true, 'date', null, '{administrator,coordinator}', '{administrator,coordinator}', false, false, 13),
  ('FNC-CL-04', 'Offer and Client Acceptance', 'client_deal', 'client', true, 'date', null, '{administrator,coordinator}', '{administrator,coordinator}', false, false, 14),
  ('FNC-CL-06', 'File Closure Form', 'client_deal', 'client', true, 'date', null, '{administrator,coordinator}', '{administrator,coordinator}', false, false, 15),
  ('FNC-CL-08', 'Client Mandate and Fee Agreement', 'client_deal', 'client', true, 'date', null, '{administrator,coordinator}', '{administrator,coordinator}', false, false, 16),
  ('FNC-CL-07', 'Complaints Form', 'client_deal', 'client', false, 'date', null, '{administrator,coordinator,switchboard}', '{administrator,coordinator}', false, false, 17),
  -- CEO only
  ('FNC-CL-02', 'Founder Decision Record', 'ceo', 'client', false, 'date', null, '{}', '{}', false, true, 20),
  ('FNC-CL-03', 'Funder Submission Record', 'ceo', 'client', false, 'date', null, '{}', '{}', false, true, 21),
  ('FNC-CL-05', 'Success-Fee Invoice', 'ceo', 'client', false, 'date', null, '{}', '{}', false, true, 22),
  ('FNC-FIN-04', 'Supplier Payment Approval', 'ceo', 'none', false, 'date', null, '{}', '{}', false, true, 23),
  ('FNC-FIN-08', 'Bank Reconciliation and Budget Review', 'ceo', 'none', false, 'month', null, '{}', '{}', false, true, 24),
  ('FNC-HR-04', 'Probation Review', 'ceo', 'staff', true, 'date', null, '{}', '{}', false, true, 25),
  ('FNC-HR-05', 'Performance Review', 'ceo', 'staff', true, 'date', null, '{}', '{}', false, true, 26),
  ('FNC-HR-09', 'Warning and Disciplinary Record', 'ceo', 'staff', true, 'date', null, '{}', '{}', false, true, 27),
  -- Agents / Team Leaders (+ onboarding documents the Office Administrator scans, owner 17 Nov)
  ('FNC-AG-04', 'Team Membership Form', 'agent', 'agent', true, 'date', null, '{administrator,coordinator,hr}', '{administrator,coordinator,hr}', false, false, 30),
  ('FNC-AG-05', 'Agent Invoice Approval Slip', 'agent', 'agent', true, 'date', null, '{administrator,coordinator,hr}', '{administrator,coordinator,hr}', false, false, 31),
  ('FNC-AG-08', 'Agent Check-in and Performance Notes', 'agent', 'agent', true, 'date', null, '{administrator,coordinator,hr}', '{administrator,coordinator,hr}', false, false, 32),
  ('FNC-AG-CON', 'Signed Agent Contract (SAA-01 / DRA-01)', 'agent', 'agent', true, 'date', null, '{administrator,hr}', '{administrator,hr}', false, false, 33),
  ('FNC-AG-ID', 'Certified ID Copy', 'agent', 'agent', true, 'date', null, '{administrator,hr}', '{administrator,hr}', false, false, 34),
  ('FNC-AG-BANK', 'Bank Confirmation Letter', 'agent', 'agent', true, 'date', null, '{administrator,hr}', '{administrator,hr}', false, false, 35),
  -- Finance / admin
  ('FNC-FIN-01', 'Admin Fee Invoice Register', 'finance', 'none', false, 'month', null, '{administrator}', '{administrator}', false, false, 40),
  ('FNC-FIN-02', 'Agent and Contractor Invoice Register', 'finance', 'none', false, 'month', null, '{administrator}', '{administrator}', false, false, 41),
  ('FNC-FIN-03', 'Payroll Sign-off Sheet', 'finance', 'none', false, 'month', null, '{administrator}', '{administrator}', false, false, 42),
  ('FNC-FIN-05', 'Expense Claim', 'finance', 'none', false, 'date', null, '{administrator}', '{administrator}', false, false, 43),
  ('FNC-FIN-06', 'Petty Cash Register', 'finance', 'none', false, 'week', 'weekly', '{administrator}', '{administrator}', false, false, 44),
  ('FNC-FIN-07', 'Stationery and Purchase Request', 'finance', 'none', false, 'date', null, '{administrator}', '{administrator}', false, false, 45),
  -- HR / staff (the staff member sees their own). iFacts consent: HR, the Office Administrator (owner, 17 Nov) and the
  -- owner only; no other role is even shown that the form exists, and the person it is about does not see it here.
  ('FNC-HR-01', 'Attendance Register', 'hr', 'none', false, 'day', 'daily', '{administrator,hr}', '{administrator,hr}', false, false, 50),
  ('FNC-HR-02', 'Leave Application', 'hr', 'staff', true, 'date', null, '{administrator,hr}', '{administrator,hr}', true, false, 51),
  ('FNC-HR-03', 'Leave Register', 'hr', 'none', false, 'month', null, '{administrator,hr}', '{administrator,hr}', false, false, 52),
  ('FNC-HR-06', 'Training Register', 'hr', 'none', false, 'date', null, '{administrator,hr}', '{administrator,hr}', false, false, 53),
  ('FNC-HR-07', 'Equipment Issue and Return', 'hr', 'staff', true, 'date', null, '{administrator,hr}', '{administrator,hr}', true, false, 54),
  ('FNC-HR-13', 'Code of Conduct and Confidentiality', 'hr', 'staff', true, 'date', null, '{administrator,hr}', '{administrator,hr}', true, false, 55),
  ('FNC-HR-14', 'Induction Checklist', 'hr', 'staff', true, 'date', null, '{administrator,hr}', '{administrator,hr}', true, false, 56),
  ('FNC-HR-IFC', 'iFacts Background Check Consent', 'hr', 'person', true, 'date', null, '{administrator,hr}', '{administrator,hr}', false, false, 57),
  -- Office registers (no person link)
  ('FNC-OPS-01', 'Founder''s Daily Briefing Sheet', 'office', 'none', false, 'day', 'daily', '{administrator}', '{administrator}', false, false, 60),
  ('FNC-OPS-02', 'Meeting Minutes and Action List', 'office', 'none', false, 'date', null, '{administrator,coordinator,hr,field_supervisor}', '{administrator}', false, false, 61),
  ('FNC-OPS-03', 'Visitor Register', 'office', 'none', false, 'day', null, '{administrator,switchboard}', '{administrator}', false, false, 62),
  ('FNC-OPS-04', 'Asset Register', 'office', 'none', false, 'month', null, '{administrator}', '{administrator}', false, false, 63),
  ('FNC-OPS-05', 'Key and Access Register', 'office', 'none', false, 'month', null, '{administrator}', '{administrator}', false, false, 64),
  ('FNC-OPS-06', 'Stationery Stock Register', 'office', 'none', false, 'month', null, '{administrator}', '{administrator}', false, false, 65),
  ('FNC-OPS-07', 'Verification Log', 'office', 'none', false, 'week', null, '{administrator}', '{administrator}', false, false, 66),
  ('FNC-OPS-08', 'Incident and Health and Safety Register', 'office', 'none', false, 'date', null, '{administrator}', '{administrator}', false, false, 67),
  ('FNC-OPS-10', 'Office Opening and Closing Checklist', 'office', 'none', false, 'day', 'daily', '{administrator}', '{administrator}', false, false, 68),
  -- Field team (the Field Supervisor uploads; the field contractor sees their own approval and code of conduct)
  ('FNC-FM-01', 'Field Contractor Approval', 'field', 'field_contractor', true, 'date', null, '{field_supervisor,administrator}', '{field_supervisor,administrator}', true, false, 70),
  ('FNC-FM-02', 'Field Contractor Code of Conduct', 'field', 'field_contractor', true, 'date', null, '{field_supervisor,administrator}', '{field_supervisor,administrator}', true, false, 71),
  ('FNC-FM-03', 'Field Campaign Plan', 'field', 'none', false, 'date', null, '{field_supervisor,administrator}', '{field_supervisor,administrator}', false, false, 72),
  ('FNC-FM-04', 'Flyer and Material Stock Register', 'field', 'none', false, 'month', null, '{field_supervisor,administrator}', '{field_supervisor,administrator}', false, false, 73),
  ('FNC-FM-05', 'Daily Field Activity Log', 'field', 'none', false, 'day', 'daily', '{field_supervisor}', '{field_supervisor,administrator}', false, false, 74),
  ('FNC-FM-06', 'Weekly Field Report', 'field', 'none', false, 'week', 'weekly', '{field_supervisor}', '{field_supervisor,administrator}', false, false, 75),
  ('FNC-FM-07', 'Field Contractor Payment Schedule', 'field', 'none', false, 'month', null, '{field_supervisor}', '{administrator}', false, false, 76);

-- 2. Ledger ------------------------------------------------------------------------------------------------------
create table public.scanned_forms (
  id                 uuid primary key default gen_random_uuid(),
  form_code          text not null references public.scanned_form_catalogue(code),
  client_id          uuid references public.clients(id) on delete restrict,
  deal_id            uuid references public.deals(id) on delete restrict,
  subject_profile_id uuid references public.profiles(id) on delete restrict,
  period_start       date not null,
  period_end         date not null,
  signed_by          text not null check (length(btrim(signed_by)) between 2 and 120),
  note               text check (note is null or length(note) <= 500),
  current_version    integer not null default 1 check (current_version >= 1),
  created_by         uuid not null references public.profiles(id),
  created_role       text not null,
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         uuid references public.profiles(id),
  delete_reason      text,
  constraint scanned_forms_period_ck check (period_end >= period_start),
  constraint scanned_forms_delete_ck check ((deleted_at is null) = (deleted_by is null))
);
create index scanned_forms_code_period_idx on public.scanned_forms (form_code, period_start desc) where deleted_at is null;
create index scanned_forms_client_idx on public.scanned_forms (client_id) where client_id is not null;
create index scanned_forms_deal_idx on public.scanned_forms (deal_id) where deal_id is not null;
create index scanned_forms_subject_idx on public.scanned_forms (subject_profile_id) where subject_profile_id is not null;

create table public.scanned_form_files (
  id            uuid primary key default gen_random_uuid(),
  form_id       uuid not null references public.scanned_forms(id) on delete restrict,
  version       integer not null check (version >= 1),
  page_no       integer not null check (page_no between 1 and 30),
  storage_path  text not null unique,
  file_name     text not null check (length(file_name) between 1 and 200),
  mime_type     text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  uploaded_by   uuid not null references public.profiles(id),
  uploaded_role text not null,
  uploaded_at   timestamptz not null default now(),
  unique (form_id, version, page_no)
);

-- Short-lived permission to read one storage object, issued by scanned_form_open_file after the visibility check
-- and the activity-log write. Storage SELECT requires a live ticket, so every view/download is logged first.
create table public.scanned_form_access_tickets (
  id           bigint generated always as identity primary key,
  user_id      uuid not null,
  storage_path text not null,
  purpose      text not null check (purpose in ('view', 'download', 'delete')),
  expires_at   timestamptz not null
);
create index scanned_form_access_tickets_lookup on public.scanned_form_access_tickets (user_id, storage_path, expires_at);

alter table public.scanned_forms enable row level security;
alter table public.scanned_form_files enable row level security;
alter table public.scanned_form_access_tickets enable row level security;
revoke all on table public.scanned_forms, public.scanned_form_files, public.scanned_form_access_tickets
  from public, anon, authenticated;

-- Pages of a version are never changed or removed by hand; a replacement is a new version.
create trigger scanned_form_files_append_only
  before update or delete on public.scanned_form_files
  for each row execute function public.intake_append_only_guard();

-- 3. Helpers (internal) ------------------------------------------------------------------------------------------
create or replace function public.scanned_form_can_upload(p_code text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.scanned_form_catalogue c
     where c.code = p_code
       and (coalesce(public.is_owner(), false)
            or (not c.ceo_only and coalesce(public.staff_role_of() = any (c.uploader_roles), false))));
$$;

create or replace function public.scanned_form_is_visible(p_form_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.scanned_forms f join public.scanned_form_catalogue c on c.code = f.form_code
     where f.id = p_form_id and f.deleted_at is null
       and (coalesce(public.is_owner(), false)
            or (not c.ceo_only and (
                  coalesce(public.staff_role_of() = any (c.viewer_roles), false)
                  or (f.created_by = (select auth.uid()) and public.staff_role_of() is not null)
                  or (c.self_view and f.subject_profile_id = (select auth.uid()))))));
$$;

create or replace function public.scanned_form_log(
  p_event public.activity_event_type, p_form_id uuid, p_description text, p_after jsonb default null)
returns void
language sql security definer set search_path = '' as $$
  insert into public.activity_logs (user_id, user_email, user_role, event_type, entity_type, entity_id, description, after_values)
  select (select auth.uid()), p.email, public.staff_actor_role(), p_event, 'scanned_form', p_form_id, p_description, p_after
    from (select 1) x left join public.profiles p on p.id = (select auth.uid());
$$;

-- Checks and normalises the uploaded pages: 1-30 pages, PDF/JPG/PNG, 20 MB in total, each path under
-- <form_code>/<yyyy>/<mm>/ and already uploaded to the scanned-forms bucket by the caller.
create or replace function public.scanned_form_check_pages(p_code text, p_files jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_count integer; v_total bigint; v_path text; f jsonb;
begin
  if p_files is null or jsonb_typeof(p_files) <> 'array' then raise exception 'Attach the scanned pages'; end if;
  v_count := jsonb_array_length(p_files);
  if v_count < 1 or v_count > 30 then raise exception 'Attach between 1 and 30 pages'; end if;
  select coalesce(sum((e->>'size_bytes')::bigint), 0) into v_total from jsonb_array_elements(p_files) e;
  if v_total > 20971520 then raise exception 'The pages together are larger than 20 MB'; end if;
  for f in select * from jsonb_array_elements(p_files) loop
    v_path := f->>'path';
    if v_path is null or v_path !~ ('^' || p_code || '/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}-[0-9]{1,2}\.(pdf|jpg|jpeg|png)$') then
      raise exception 'Upload the pages through the CRM (unexpected file path)';
    end if;
    if coalesce(f->>'mime_type', '') not in ('application/pdf', 'image/jpeg', 'image/png') then
      raise exception 'Only PDF, JPG and PNG files can be uploaded';
    end if;
    if coalesce((f->>'size_bytes')::bigint, 0) <= 0 then raise exception 'A page is empty'; end if;
    if not exists (select 1 from storage.objects o
                    where o.bucket_id = 'scanned-forms' and o.name = v_path and o.owner_id = (select auth.uid())::text) then
      raise exception 'A page has not finished uploading; try again';
    end if;
    if exists (select 1 from public.scanned_form_files x where x.storage_path = v_path) then
      raise exception 'A page was already used for another upload';
    end if;
  end loop;
  return p_files;
end;
$$;

revoke all on function public.scanned_form_can_upload(text) from public, anon, authenticated;
revoke all on function public.scanned_form_is_visible(uuid) from public, anon, authenticated;
revoke all on function public.scanned_form_log(public.activity_event_type, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.scanned_form_check_pages(text, jsonb) from public, anon, authenticated;

-- A scanned "Bank Confirmation Letter" (FNC-AG-BANK) is the agent's proof of banking (Agent file, PR #326): it is
-- linked to the agent's payee profile as 'scanned-form:<form id>' through staff_save_agent_payee, which re-checks the
-- capturer (Director / HR / Office Administrator) and, when the bank details are otherwise complete, moves them to
-- pending verification for the Director. If the link cannot be made (for example a partner not yet linked to a
-- brokerage), the upload still stands and the reason is kept in activity_logs.
create or replace function public.scanned_form_link_bank_proof(p_form_id uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_subject uuid;
begin
  select f.subject_profile_id into v_subject from public.scanned_forms f
   where f.id = p_form_id and f.form_code = 'FNC-AG-BANK' and f.deleted_at is null;
  if v_subject is null then return 'not_applicable'; end if;
  begin
    perform public.staff_save_agent_payee(p_profile => v_subject, p_banking_proof_storage_path => 'scanned-form:' || p_form_id::text);
    return 'linked';
  exception when others then
    return left('not_linked: ' || sqlerrm, 300);
  end;
end;
$$;
revoke all on function public.scanned_form_link_bank_proof(uuid) from public, anon, authenticated;

-- 4. RPCs ------------------------------------------------------------------------------------------------------------
-- The forms this person may upload or see. Non-owners never receive a CEO-only row.
create or replace function public.scanned_form_catalogue_list()
returns table (code text, title text, category text, link_kind text, link_required boolean, period_kind text,
               can_upload boolean)
language sql stable security definer set search_path = '' as $$
  select c.code, c.title, c.category, c.link_kind, c.link_required, c.period_kind, public.scanned_form_can_upload(c.code)
    from public.scanned_form_catalogue c
   where coalesce(public.is_owner(), false)
      or (not c.ceo_only and public.staff_role_of() is not null
          and (public.staff_role_of() = any (c.uploader_roles) or public.staff_role_of() = any (c.viewer_roles) or c.self_view))
   order by c.sort_order, c.code;
$$;

-- People or clients a form can be linked to. Only for someone who may upload a form with that link.
create or replace function public.scanned_form_link_options(p_link_kind text, p_search text default null)
returns table (id uuid, label text, detail text)
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := '%' || lower(btrim(coalesce(p_search, ''))) || '%';
begin
  if not exists (select 1 from public.scanned_form_catalogue c where c.link_kind = p_link_kind and public.scanned_form_can_upload(c.code)) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  if p_link_kind = 'client' then
    return query select c.id, c.business_name, coalesce(c.cipc_number, '')
      from public.clients c where lower(c.business_name) like v_q order by c.business_name limit 50;
  else
    return query select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email), p.role::text
      from public.profiles p
     where p.is_active
       and (lower(coalesce(p.full_name, '')) like v_q or lower(coalesce(p.email, '')) like v_q)
       and case p_link_kind
             when 'staff' then p.role::text in ('administrator', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant')
             when 'agent' then p.role::text in ('partner', 'contractor', 'lead_referrer')
             when 'person' then p.role::text in ('administrator', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant', 'partner', 'contractor', 'lead_referrer')
             when 'field_contractor' then p.role::text = 'field_consultant'
             else false end
     order by 2 limit 50;
  end if;
end;
$$;

-- The deals of one client, for the optional deal link on client forms.
create or replace function public.scanned_form_client_deals(p_client_id uuid)
returns table (id uuid, reference text, stage text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.scanned_form_catalogue c where c.link_kind = 'client' and public.scanned_form_can_upload(c.code)) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query select d.id, d.reference, d.stage::text from public.deals d
   where d.client_id = p_client_id and d.archived_at is null order by d.created_at desc;
end;
$$;

-- Upload: the browser stores the pages in the scanned-forms bucket first, then registers them here.
create or replace function public.scanned_form_register(
  p_form_code text, p_client_id uuid, p_deal_id uuid, p_subject_profile_id uuid, p_period_date date,
  p_signed_by text, p_note text, p_files jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.scanned_form_catalogue; v_role text := public.staff_actor_role(); v_uid uuid := (select auth.uid());
  v_start date; v_end date; v_subject_role text; v_id uuid; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  f jsonb; v_page integer := 0; v_link_ok boolean;
begin
  select * into c from public.scanned_form_catalogue where code = p_form_code;
  if not found or not public.scanned_form_can_upload(p_form_code) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_signed_by, ''))) not between 2 and 120 or not public.staff_text_is_safe(p_signed_by) then
    raise exception 'Enter who signed the form (2 to 120 characters, no ID or bank numbers)';
  end if;
  if v_note is not null and (length(v_note) > 500 or not public.staff_text_is_safe(v_note)) then
    raise exception 'Keep the note under 500 characters, with no ID, bank or other long numbers';
  end if;
  if p_period_date is null then raise exception 'Enter the date on the form'; end if;
  v_start := case c.period_kind when 'week' then date_trunc('week', p_period_date)::date
                                when 'month' then date_trunc('month', p_period_date)::date else p_period_date end;
  v_end := case c.period_kind when 'week' then v_start + 6
                              when 'month' then (v_start + interval '1 month')::date - 1 else v_start end;
  if v_start > public.current_sast_date() then raise exception 'The date on the form cannot be in the future'; end if;

  -- The form decides the link.
  if c.link_kind = 'client' then
    if p_subject_profile_id is not null then raise exception 'This form is linked to a client, not a person'; end if;
    if p_client_id is null and c.link_required then raise exception 'Choose the client this form belongs to'; end if;
    if p_client_id is not null and not exists (select 1 from public.clients x where x.id = p_client_id) then
      raise exception 'Client not found';
    end if;
    if p_deal_id is not null and (p_client_id is null
        or not exists (select 1 from public.deals d where d.id = p_deal_id and d.client_id = p_client_id)) then
      raise exception 'That deal does not belong to the chosen client';
    end if;
  elsif c.link_kind = 'none' then
    if p_client_id is not null or p_deal_id is not null or p_subject_profile_id is not null then
      raise exception 'This register is not linked to a person or client';
    end if;
  else
    if p_client_id is not null or p_deal_id is not null then raise exception 'This form is linked to a person, not a client'; end if;
    if p_subject_profile_id is null and c.link_required then raise exception 'Choose the person this form is about'; end if;
    if p_subject_profile_id is not null then
      select p.role::text into v_subject_role from public.profiles p where p.id = p_subject_profile_id;
      -- (Assigned first: a CASE inside an IF condition would end the condition at its first THEN.)
      v_link_ok := case c.link_kind
           when 'staff' then v_subject_role in ('administrator', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant')
           when 'agent' then v_subject_role in ('partner', 'contractor', 'lead_referrer')
           when 'person' then v_subject_role in ('administrator', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant', 'partner', 'contractor', 'lead_referrer')
           when 'field_contractor' then v_subject_role = 'field_consultant'
           else false end;
      if not coalesce(v_link_ok, false) then
        raise exception 'That person cannot be linked to this form';
      end if;
    end if;
  end if;

  perform public.scanned_form_check_pages(p_form_code, p_files);
  insert into public.scanned_forms (form_code, client_id, deal_id, subject_profile_id, period_start, period_end, signed_by, note,
                                    created_by, created_role)
  values (p_form_code, p_client_id, p_deal_id, p_subject_profile_id, v_start, v_end, btrim(p_signed_by), v_note, v_uid, v_role)
  returning id into v_id;
  for f in select * from jsonb_array_elements(p_files) loop
    v_page := v_page + 1;
    insert into public.scanned_form_files (form_id, version, page_no, storage_path, file_name, mime_type, size_bytes, uploaded_by, uploaded_role)
    values (v_id, 1, v_page, f->>'path', left(coalesce(nullif(btrim(f->>'file_name'), ''), 'page-' || v_page), 200),
            f->>'mime_type', (f->>'size_bytes')::bigint, v_uid, v_role);
  end loop;
  perform public.scanned_form_log('CREATE', v_id, 'Scanned form uploaded: ' || p_form_code,
    jsonb_build_object('form_code', p_form_code, 'pages', v_page, 'period_start', v_start, 'period_end', v_end,
                       'client_id', p_client_id, 'deal_id', p_deal_id, 'subject_profile_id', p_subject_profile_id,
                       'bank_proof', public.scanned_form_link_bank_proof(v_id)));
  return v_id;
end;
$$;

-- Replace: a new version of the pages. Earlier versions stay readable in the history.
create or replace function public.scanned_form_replace(p_form_id uuid, p_files jsonb, p_reason text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_code text; v_version integer; v_role text := public.staff_actor_role(); v_uid uuid := (select auth.uid());
  f jsonb; v_page integer := 0; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select f2.form_code, f2.current_version + 1 into v_code, v_version from public.scanned_forms f2
   where f2.id = p_form_id and f2.deleted_at is null for update;
  if v_code is null or not public.scanned_form_is_visible(p_form_id) or not public.scanned_form_can_upload(v_code) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 300 or not public.staff_text_is_safe(v_reason) then
    raise exception 'Say why the scan is replaced (3 to 300 characters, no ID or bank numbers)';
  end if;
  perform public.scanned_form_check_pages(v_code, p_files);
  for f in select * from jsonb_array_elements(p_files) loop
    v_page := v_page + 1;
    insert into public.scanned_form_files (form_id, version, page_no, storage_path, file_name, mime_type, size_bytes, uploaded_by, uploaded_role)
    values (p_form_id, v_version, v_page, f->>'path', left(coalesce(nullif(btrim(f->>'file_name'), ''), 'page-' || v_page), 200),
            f->>'mime_type', (f->>'size_bytes')::bigint, v_uid, v_role);
  end loop;
  update public.scanned_forms set current_version = v_version where id = p_form_id;
  perform public.scanned_form_log('UPDATE', p_form_id, 'Scanned form replaced: ' || v_code,
    jsonb_build_object('form_code', v_code, 'version', v_version, 'pages', v_page, 'reason', v_reason,
                       'bank_proof', public.scanned_form_link_bank_proof(p_form_id)));
  return v_version;
end;
$$;

-- The library and the "Scanned forms" tabs. Every filter is optional.
create or replace function public.scanned_forms_list(
  p_form_code text default null, p_category text default null, p_from date default null, p_to date default null,
  p_subject_profile_id uuid default null, p_client_id uuid default null, p_deal_id uuid default null,
  p_uploaded_by uuid default null, p_limit integer default 200)
returns table (id uuid, form_code text, title text, category text, link_kind text, client_id uuid, client_name text,
               deal_id uuid, deal_reference text, subject_profile_id uuid, subject_name text, period_kind text,
               period_start date, period_end date, signed_by text, note text, current_version integer,
               created_by uuid, created_by_name text, created_role text, created_at timestamptz, pages jsonb)
language sql stable security definer set search_path = '' as $$
  select f.id, f.form_code, c.title, c.category, c.link_kind, f.client_id, cl.business_name, f.deal_id, d.reference,
         f.subject_profile_id, coalesce(nullif(btrim(sp.full_name), ''), sp.email), c.period_kind, f.period_start,
         f.period_end, f.signed_by, f.note, f.current_version, f.created_by, coalesce(nullif(btrim(up.full_name), ''), up.email),
         f.created_role, f.created_at,
         coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'page_no', x.page_no, 'file_name', x.file_name,
                                                        'mime_type', x.mime_type, 'size_bytes', x.size_bytes) order by x.page_no)
                     from public.scanned_form_files x where x.form_id = f.id and x.version = f.current_version), '[]'::jsonb)
    from public.scanned_forms f
    join public.scanned_form_catalogue c on c.code = f.form_code
    left join public.clients cl on cl.id = f.client_id
    left join public.deals d on d.id = f.deal_id
    left join public.profiles sp on sp.id = f.subject_profile_id
    left join public.profiles up on up.id = f.created_by
   where public.scanned_form_is_visible(f.id)
     and (p_form_code is null or f.form_code = p_form_code)
     and (p_category is null or c.category = p_category)
     and (p_from is null or f.period_end >= p_from)
     and (p_to is null or f.period_start <= p_to)
     and (p_subject_profile_id is null or f.subject_profile_id = p_subject_profile_id)
     and (p_client_id is null or f.client_id = p_client_id)
     and (p_deal_id is null or f.deal_id = p_deal_id)
     and (p_uploaded_by is null or f.created_by = p_uploaded_by)
   order by f.period_start desc, f.created_at desc
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

-- Version history of one form.
create or replace function public.scanned_form_versions(p_form_id uuid)
returns table (version integer, page_no integer, file_id uuid, file_name text, mime_type text, size_bytes bigint,
               uploaded_by_name text, uploaded_role text, uploaded_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.scanned_form_is_visible(p_form_id) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query select x.version, x.page_no, x.id, x.file_name, x.mime_type, x.size_bytes,
                      coalesce(nullif(btrim(p.full_name), ''), p.email), x.uploaded_role, x.uploaded_at
    from public.scanned_form_files x left join public.profiles p on p.id = x.uploaded_by
   where x.form_id = p_form_id order by x.version desc, x.page_no;
end;
$$;

-- View or download one page: checks visibility, logs it, and issues a 2-minute ticket the storage SELECT policy
-- needs before Storage will sign a URL for that object. Returns the storage path to sign.
create or replace function public.scanned_form_open_file(p_file_id uuid, p_purpose text)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_form uuid; v_path text; v_code text; v_version integer; v_page integer;
begin
  if p_purpose not in ('view', 'download') then raise exception 'Say whether to view or download'; end if;
  select x.form_id, x.storage_path, f.form_code, x.version, x.page_no into v_form, v_path, v_code, v_version, v_page
    from public.scanned_form_files x join public.scanned_forms f on f.id = x.form_id where x.id = p_file_id;
  if v_form is null or not public.scanned_form_is_visible(v_form) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  delete from public.scanned_form_access_tickets where expires_at < now() - interval '1 day';
  insert into public.scanned_form_access_tickets (user_id, storage_path, purpose, expires_at)
  values ((select auth.uid()), v_path, p_purpose, now() + interval '2 minutes');
  perform public.scanned_form_log(case when p_purpose = 'view' then 'READ'::public.activity_event_type else 'EXPORT'::public.activity_event_type end,
    v_form, 'Scanned form ' || case when p_purpose = 'view' then 'viewed' else 'downloaded' end || ': ' || v_code,
    jsonb_build_object('form_code', v_code, 'version', v_version, 'page_no', v_page));
  return v_path;
end;
$$;

-- Owner only: remove a form. The record is kept (marked deleted, hidden everywhere) for the audit trail; the
-- returned storage paths are removed from the bucket by the browser with the owner's delete permission.
create or replace function public.owner_delete_scanned_form(p_form_id uuid, p_reason text)
returns text[]
language plpgsql security definer set search_path = '' as $$
declare v_code text; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_paths text[];
begin
  if not coalesce(public.is_owner(), false) then
    raise exception 'Only the Director deletes scanned forms' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 300 then
    raise exception 'Give a reason for deleting (3 to 300 characters)';
  end if;
  update public.scanned_forms set deleted_at = now(), deleted_by = (select auth.uid()), delete_reason = v_reason
   where id = p_form_id and deleted_at is null returning form_code into v_code;
  if v_code is null then raise exception 'Scanned form not found'; end if;
  select array_agg(x.storage_path) into v_paths from public.scanned_form_files x where x.form_id = p_form_id;
  -- Storage only deletes objects the caller can read, so the owner gets a short ticket for exactly these files.
  insert into public.scanned_form_access_tickets (user_id, storage_path, purpose, expires_at)
  select (select auth.uid()), unnest(coalesce(v_paths, '{}')), 'delete', now() + interval '5 minutes';
  perform public.scanned_form_log('DELETE', p_form_id, 'Scanned form deleted: ' || v_code,
    jsonb_build_object('form_code', v_code, 'reason', v_reason, 'files', coalesce(array_length(v_paths, 1), 0)));
  return coalesce(v_paths, '{}');
end;
$$;

-- Registers with no upload for their period (Administrator landing). Daily registers: each of the last five
-- working days before today. Weekly registers: last week. Only periods from the day this catalogue went live.
create or replace function public.scanned_form_missing_registers()
returns table (form_code text, title text, period_start date, period_end date)
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := public.current_sast_date(); v_since date;
begin
  if not (coalesce(public.is_owner(), false) or coalesce(public.staff_role_of() = 'administrator', false)) then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  select min(c.created_at at time zone 'Africa/Johannesburg')::date into v_since from public.scanned_form_catalogue c;
  return query
  with days as (
    select d::date as day from generate_series(v_today - 10, v_today - 1, interval '1 day') d
     where public.payroll_is_working_day(d::date) and d::date >= v_since
     order by d desc limit 5
  ), wanted as (
    select c.code, c.title, s.day as ps, s.day as pe from public.scanned_form_catalogue c cross join days s where c.reminder = 'daily'
    union all
    select c.code, c.title, (date_trunc('week', v_today)::date - 7), (date_trunc('week', v_today)::date - 1)
      from public.scanned_form_catalogue c
     where c.reminder = 'weekly' and (date_trunc('week', v_today)::date - 7) >= date_trunc('week', v_since)::date
  )
  select w.code, w.title, w.ps, w.pe from wanted w
   where not exists (select 1 from public.scanned_forms f
                      where f.form_code = w.code and f.deleted_at is null and f.period_start <= w.pe and f.period_end >= w.ps)
   order by w.ps desc, w.code;
end;
$$;

-- A page the person uploaded that was never registered (an upload that failed half-way, or one still in flight):
-- they may read it back and delete it. Once registered, reads need a ticket like everyone else's.
create or replace function public.scanned_form_object_unregistered(p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.scanned_form_files x where x.storage_path = p_name);
$$;

create or replace function public.scanned_form_has_ticket(p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.scanned_form_access_tickets t
                  where t.user_id = (select auth.uid()) and t.storage_path = p_name and t.expires_at > now());
$$;

revoke all on function public.scanned_form_catalogue_list() from public, anon;
revoke all on function public.scanned_form_link_options(text, text) from public, anon;
revoke all on function public.scanned_form_client_deals(uuid) from public, anon;
revoke all on function public.scanned_form_register(text, uuid, uuid, uuid, date, text, text, jsonb) from public, anon;
revoke all on function public.scanned_form_replace(uuid, jsonb, text) from public, anon;
revoke all on function public.scanned_forms_list(text, text, date, date, uuid, uuid, uuid, uuid, integer) from public, anon;
revoke all on function public.scanned_form_versions(uuid) from public, anon;
revoke all on function public.scanned_form_open_file(uuid, text) from public, anon;
revoke all on function public.owner_delete_scanned_form(uuid, text) from public, anon;
revoke all on function public.scanned_form_missing_registers() from public, anon;
revoke all on function public.scanned_form_object_unregistered(text) from public, anon;
revoke all on function public.scanned_form_has_ticket(text) from public, anon;
grant execute on function public.scanned_form_catalogue_list() to authenticated;
grant execute on function public.scanned_form_link_options(text, text) to authenticated;
grant execute on function public.scanned_form_client_deals(uuid) to authenticated;
grant execute on function public.scanned_form_register(text, uuid, uuid, uuid, date, text, text, jsonb) to authenticated;
grant execute on function public.scanned_form_replace(uuid, jsonb, text) to authenticated;
grant execute on function public.scanned_forms_list(text, text, date, date, uuid, uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.scanned_form_versions(uuid) to authenticated;
grant execute on function public.scanned_form_open_file(uuid, text) to authenticated;
grant execute on function public.owner_delete_scanned_form(uuid, text) to authenticated;
grant execute on function public.scanned_form_missing_registers() to authenticated;
-- Used inside the storage policies, which run as the calling user.
grant execute on function public.scanned_form_can_upload(text) to authenticated;
grant execute on function public.scanned_form_object_unregistered(text) to authenticated;
grant execute on function public.scanned_form_has_ticket(text) to authenticated;

-- 5. Private bucket and storage policies ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scanned-forms', 'scanned-forms', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists scanned_forms_bucket_insert on storage.objects;
create policy scanned_forms_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'scanned-forms' and public.scanned_form_can_upload((storage.foldername(name))[1]));

drop policy if exists scanned_forms_bucket_select on storage.objects;
create policy scanned_forms_bucket_select on storage.objects for select to authenticated
  using (bucket_id = 'scanned-forms'
         and (public.scanned_form_has_ticket(name)
              or (owner_id = (select auth.uid())::text and public.scanned_form_object_unregistered(name))));

drop policy if exists scanned_forms_bucket_delete on storage.objects;
create policy scanned_forms_bucket_delete on storage.objects for delete to authenticated
  using (bucket_id = 'scanned-forms'
         and (coalesce(public.is_owner(), false)
              or (owner_id = (select auth.uid())::text and public.scanned_form_object_unregistered(name))));
