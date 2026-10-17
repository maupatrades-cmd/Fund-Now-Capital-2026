-- Required-documents catalogue cut-over (owner decision 17 Oct 2026: all 24 funding types, everywhere).
-- Codex review findings 1 + 5 on the staff stack:
--   1. The Owner confirms catalogue lists, but the Complete gate still read the old 5-product
--      document_requirement_rules. From here the gate, the staff checklist and receipts all use the
--      catalogue the Owner confirms.
--   5. A file keeps the list versions it opened with, INCLUDING the included list (mezzanine -> equity).
-- Also: the 17 catalogue funding types that had no product row become real products, so staff intake,
-- the client application and deal documents can all use them.
-- Forward-only. Old document_requirement_rules rows stay (deal-side rules still use them); staff intake
-- no longer reads them. Receipts recorded before this (none live) keep their 52-type document_type.

-- 1. Funding products: one per catalogue funding type ------------------------------------------
alter table public.funding_product_catalog add column if not exists doc_list_code text;
update public.funding_product_catalog p set doc_list_code = case when p.code = 'equity_venture_capital' then 'equity_investment' else p.code end
 where p.doc_list_code is null and exists (select 1 from public.doc_lists l
        where l.code = case when p.code = 'equity_venture_capital' then 'equity_investment' else p.code end);

insert into public.funding_product_catalog (code, display_name, is_asset_backed, doc_list_code)
select v.code, v.name, v.asset, v.code
  from (values
    ('certificate_discounting', 'Certificate discounting', false),
    ('commercial_property_finance', 'Commercial property finance', false),
    ('contract_finance', 'Contract finance', false),
    ('debtor_factoring', 'Debtor factoring', false),
    ('export_finance', 'Export finance', false),
    ('grants_development', 'Grants and development funding', false),
    ('import_finance', 'Import finance', false),
    ('merchant_cash_advance', 'Merchant cash advance', false),
    ('mezzanine_finance', 'Mezzanine and convertible loans', false),
    ('project_finance', 'Project finance', false),
    ('property_bridging', 'Property bridging', false),
    ('revolving_credit', 'Revolving credit or overdraft', false),
    ('sale_and_leaseback', 'Sale and leaseback, and rental finance', true),
    ('stock_finance', 'Stock and inventory finance', false),
    ('supply_chain_finance', 'Supply chain and supplier finance', false),
    ('tender_finance', 'Tender finance', false),
    ('vehicle_fleet_finance', 'Vehicle and fleet finance', true)
  ) as v(code, name, asset)
 where exists (select 1 from public.doc_lists l where l.code = v.code and l.kind = 'funding_type')
on conflict (code) do nothing;

-- Small reference table (24 rows): NOT VALID then VALIDATE per the FK rule; no index needed at this size.
alter table public.funding_product_catalog
  add constraint funding_product_catalog_doc_list_fk foreign key (doc_list_code) references public.doc_lists(code) not valid;
alter table public.funding_product_catalog validate constraint funding_product_catalog_doc_list_fk;

-- The client application accepted only the original 7 codes through a hard-coded CHECK. Any active
-- catalogue product is now allowed, enforced by a foreign key instead.
alter table public.client_form_responses drop constraint if exists client_form_responses_product_code_check;
alter table public.client_form_responses
  add constraint client_form_responses_product_code_fk foreign key (product_code)
  references public.funding_product_catalog(code) not valid;
alter table public.client_form_responses validate constraint client_form_responses_product_code_fk;

-- Entity-specific documents get their own condition wording (Qodo, PR #298). Entity rules are not
-- versioned, so each change is kept in the audit trail with its old and new wording.
alter table public.doc_entity_rules add column if not exists condition_text text
  check (condition_text is null or length(btrim(condition_text)) between 3 and 300);

-- 2. Effective list with a pinned included-list version (finding 5) ------------------------------
-- The 4-argument version is retired by rename (not dropped) so this applies without a destructive step.
alter function public.doc_effective_list(text, text, integer, integer) rename to doc_effective_list_retired_v1;
revoke all on function public.doc_effective_list_retired_v1(text, text, integer, integer) from public, anon, authenticated;
create or replace function public.doc_effective_list(
  p_type text, p_entity text default null, p_common_version integer default null,
  p_type_version integer default null, p_included_version integer default null)
returns table (doc_code text, title text, level public.doc_requirement_level, condition_text text, source_list text, sort_order integer)
language sql stable security definer set search_path = '' as $$
with t as (select * from public.doc_lists where code = p_type and kind = 'funding_type'),
layers as (
  select 0 as layer, 'COMMON'::text as list_code,
         coalesce(p_common_version, (select current_version from public.doc_lists where code = 'COMMON')) as ver
  union all
  select 1, t.includes_list_code,
         coalesce(p_included_version, (select x.current_version from public.doc_lists x where x.code = t.includes_list_code))
    from t where t.includes_list_code is not null
  union all
  select 2, t.code, coalesce(p_type_version, t.current_version) from t),
raw as (
  select l.layer, i.doc_code, i.level, coalesce(i.condition_text, c.note) as cond, i.replaces_code,
         l.list_code as src, l.layer * 1000 + i.sort_order as srt, c.title
    from layers l
    join public.doc_list_items i on i.list_code = l.list_code and i.version = l.ver
    join public.doc_catalogue c on c.code = i.doc_code),
top as (select distinct on (r.doc_code) * from raw r order by r.doc_code, r.layer desc),
kept as (
  select * from top x
   where not exists (select 1 from raw y where y.replaces_code = x.doc_code and y.layer > x.layer)),
er as (select * from public.doc_entity_rules where entity_type = p_entity),
final as (
  select k.doc_code, k.title,
         coalesce((select e.level from er e where e.op = 'set_level' and e.target_code = k.doc_code limit 1), k.level) as level,
         k.cond, k.src, k.srt
    from kept k
   where not exists (select 1 from er e where e.op in ('remove', 'replace') and e.target_code = k.doc_code)
  union all
  select e.doc_code, c.title, e.level, coalesce(e.condition_text, c.note), 'ENTITY:' || p_entity, 3000 + e.sort_order
    from er e join public.doc_catalogue c on c.code = e.doc_code
   where e.op in ('add', 'replace'))
select f.doc_code, f.title, f.level, f.cond, f.src, f.srt from final f order by f.srt, f.doc_code
$$;
revoke all on function public.doc_effective_list(text, text, integer, integer, integer) from public, anon, authenticated;

-- 3. Per-file pinned list versions -----------------------------------------------------------
-- One row per (file, funding-type list), written once when every list the file needs is confirmed.
-- Append-only: an Owner edit after that makes a new version for NEW files only.
create table if not exists public.intake_doc_list_pins (
  lead_id          uuid not null references public.submission_intakes(lead_id) on delete restrict,
  type_list        text not null references public.doc_lists(code),
  type_version     integer not null,
  common_version   integer not null,
  included_list    text references public.doc_lists(code),
  included_version integer,
  pinned_at        timestamptz not null default now(),
  primary key (lead_id, type_list),
  constraint intake_doc_list_pins_included_ck check ((included_list is null) = (included_version is null))
);
alter table public.intake_doc_list_pins enable row level security;
revoke all on table public.intake_doc_list_pins from public, anon, authenticated;
create trigger intake_doc_list_pins_append_only before update or delete on public.intake_doc_list_pins
  for each row execute function public.intake_append_only_guard();

-- The catalogue list a file's funding type uses.
create or replace function public.intake_doc_type_list(p_lead_id uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select p.doc_list_code from public.submission_intakes si
    join public.funding_product_catalog p on p.code = si.funding_type
   where si.lead_id = p_lead_id;
$$;
revoke all on function public.intake_doc_type_list(uuid) from public, anon, authenticated;

-- Client entity type in the catalogue's vocabulary (null = standard list).
create or replace function public.intake_doc_entity(p_lead_id uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case l.entity_type::text
           when 'pty_ltd' then 'pty_ltd' when 'cc' then 'cc' when 'sole_prop' then 'sole_proprietor'
           when 'trust' then 'trust' when 'partnership' then 'partnership' when 'ngo' then 'npo' end
    from public.leads l where l.id = p_lead_id;
$$;
revoke all on function public.intake_doc_entity(uuid) from public, anon, authenticated;

-- Pin the file's lists if they are all confirmed and it is not pinned yet. Returns true when pinned.
create or replace function public.intake_pin_doc_lists(p_lead_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_type public.doc_lists; v_common public.doc_lists; v_inc public.doc_lists;
begin
  select l.* into v_type from public.doc_lists l where l.code = public.intake_doc_type_list(p_lead_id);
  if not found then return false; end if;
  if exists (select 1 from public.intake_doc_list_pins x where x.lead_id = p_lead_id and x.type_list = v_type.code) then
    return true;
  end if;
  select l.* into v_common from public.doc_lists l where l.code = 'COMMON';
  if v_type.includes_list_code is not null then
    select l.* into v_inc from public.doc_lists l where l.code = v_type.includes_list_code;
  end if;
  if not v_type.is_confirmed or not coalesce(v_common.is_confirmed, false)
     or (v_type.includes_list_code is not null and not coalesce(v_inc.is_confirmed, false)) then
    return false;
  end if;
  insert into public.intake_doc_list_pins (lead_id, type_list, type_version, common_version, included_list, included_version)
  values (p_lead_id, v_type.code, v_type.current_version, v_common.current_version,
          v_type.includes_list_code, case when v_type.includes_list_code is not null then v_inc.current_version end)
  on conflict do nothing;
  return true;
end;
$$;
revoke all on function public.intake_pin_doc_lists(uuid) from public, anon, authenticated;

-- New files pin straight away when their lists are already confirmed.
create or replace function public.intake_pin_on_register()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.intake_pin_doc_lists(new.lead_id);
  return null;
end;
$$;
create trigger submission_intakes_pin_doc_lists after insert or update of funding_type on public.submission_intakes
  for each row execute function public.intake_pin_on_register();

-- The file's effective list at its pinned versions. No rows until pinned.
create or replace function public.intake_effective_docs(p_lead_id uuid)
returns table (doc_code text, title text, level public.doc_requirement_level, condition_text text, source_list text, sort_order integer)
language sql stable security definer set search_path = '' as $$
  select e.* from public.intake_doc_list_pins p
   cross join lateral public.doc_effective_list(p.type_list, public.intake_doc_entity(p_lead_id),
                                                p.common_version, p.type_version, p.included_version) e
   where p.lead_id = p_lead_id and p.type_list = public.intake_doc_type_list(p_lead_id);
$$;
revoke all on function public.intake_effective_docs(uuid) from public, anon, authenticated;

-- 4. Receipts against catalogue documents -----------------------------------------------------
-- The table is empty live, so the plain index below takes no meaningful lock.
alter table public.intake_document_receipts add column if not exists doc_code text;
alter table public.intake_document_receipts
  add constraint intake_document_receipts_doc_code_fk foreign key (doc_code) references public.doc_catalogue(code) not valid;
alter table public.intake_document_receipts validate constraint intake_document_receipts_doc_code_fk;
alter table public.intake_document_receipts alter column document_type drop not null;
alter table public.intake_document_receipts
  add constraint intake_document_receipts_kind_ck check (document_type is not null or doc_code is not null);
create index if not exists intake_document_receipts_doc_code_idx on public.intake_document_receipts (lead_id, doc_code);

-- Status of every document on the file's pinned list. A flagged receipt does not count as received.
create or replace function public.intake_catalogue_doc_status(p_lead_id uuid)
returns table (doc_code text, title text, level public.doc_requirement_level, condition_text text, source_list text,
               sort_order integer, received_count integer, last_received_at timestamptz, flagged_suspicious boolean)
language sql stable security definer set search_path = '' as $$
  with ev as (
    select r.doc_code, r.received_at,
           coalesce((select f.event_kind from public.intake_document_flag_events f
                      where f.receipt_id = r.id order by f.id desc limit 1), '') = 'suspicious_flagged' as suspicious
      from public.intake_document_receipts r where r.lead_id = p_lead_id and r.doc_code is not null)
  select e.doc_code, e.title, e.level, e.condition_text, e.source_list, e.sort_order,
         coalesce((select count(*) from ev where ev.doc_code = e.doc_code and not ev.suspicious), 0)::integer,
         (select max(ev.received_at) from ev where ev.doc_code = e.doc_code and not ev.suspicious),
         coalesce((select bool_or(ev.suspicious) from ev where ev.doc_code = e.doc_code), false)
    from public.intake_effective_docs(p_lead_id) e;
$$;
revoke all on function public.intake_catalogue_doc_status(uuid) from public, anon, authenticated;

-- 5. The Complete gate reads the catalogue (finding 1) -----------------------------------------
-- Returns the titles of required documents not yet received, or a reason the file cannot be judged.
create or replace function public.intake_required_docs_missing(p_lead_id uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare v_type text; v_missing text[];
begin
  select funding_type into v_type from public.submission_intakes where lead_id = p_lead_id;
  if v_type is null then return array['Funding type not set']; end if;
  if public.intake_doc_type_list(p_lead_id) is null then
    return array['This funding type has no document list'];
  end if;
  if not exists (select 1 from public.intake_doc_list_pins p
                  where p.lead_id = p_lead_id and p.type_list = public.intake_doc_type_list(p_lead_id)) then
    return array['The Founder has not confirmed the document list for this funding type yet'];
  end if;
  select coalesce(array_agg(s.title order by s.sort_order, s.doc_code), '{}'::text[]) into v_missing
    from public.intake_catalogue_doc_status(p_lead_id) s
   where s.level = 'required' and s.received_count = 0;
  return v_missing;
end;
$$;
revoke all on function public.intake_required_docs_missing(uuid) from public, anon, authenticated;

-- 6. Staff checklist and receipt recording ------------------------------------------------------
-- The return shape changes, so the old function is retired by rename and its grant removed.
alter function public.staff_document_checklist(uuid) rename to staff_document_checklist_retired_v1;
revoke all on function public.staff_document_checklist_retired_v1(uuid) from public, anon, authenticated;
create or replace function public.staff_document_checklist(p_lead_id uuid)
returns table (doc_code text, title text, requirement text, condition_text text, received boolean,
               received_count integer, last_received_at timestamptz, flagged_suspicious boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  if not exists (select 1 from public.submission_intakes si where si.lead_id = p_lead_id) then
    raise exception 'Submission not found';
  end if;
  return query
    select s.doc_code, s.title, s.level::text, s.condition_text, s.received_count > 0, s.received_count,
           s.last_received_at, s.flagged_suspicious
      from public.intake_catalogue_doc_status(p_lead_id) s
     order by (s.level = 'required') desc, s.sort_order, s.doc_code;
end;
$$;
revoke all on function public.staff_document_checklist(uuid) from public, anon;
grant execute on function public.staff_document_checklist(uuid) to authenticated;

-- Record that a catalogue document ARRIVED (metadata only; no file access). The document must be on
-- the file's confirmed list.
create or replace function public.staff_record_catalogue_receipt(
  p_lead_id uuid, p_doc_code text, p_received_via text, p_file_label text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_role text; v_row public.submission_intakes; v_id uuid; v_at timestamptz;
begin
  v_role := public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  select * into v_row from public.submission_intakes si where si.lead_id = p_lead_id;
  if not found then raise exception 'Submission not found'; end if;
  if v_row.archived_at is not null then raise exception 'An archived submission cannot receive documents'; end if;
  perform public.intake_pin_doc_lists(p_lead_id);
  if not exists (select 1 from public.intake_effective_docs(p_lead_id) e where e.doc_code = p_doc_code) then
    raise exception 'That document is not on this file''s confirmed list';
  end if;
  if p_file_label is not null and not public.staff_text_is_safe(p_file_label) then
    raise exception 'The note cannot contain ID or account-length numbers';
  end if;
  insert into public.intake_document_receipts (lead_id, doc_code, received_via, file_label, received_by, received_by_role)
  values (p_lead_id, p_doc_code, p_received_via, nullif(btrim(p_file_label), ''), (select auth.uid()), v_role)
  returning id, received_at into v_id, v_at;
  perform public.staff_audit_write('submission_intake', p_lead_id, 'document_received', null,
    jsonb_build_object('receipt_id', v_id, 'doc_code', p_doc_code, 'via', p_received_via));
  return jsonb_build_object('receipt_id', v_id, 'doc_code', p_doc_code, 'received_at', v_at);
end;
$$;
revoke all on function public.staff_record_catalogue_receipt(uuid, text, text, text) from public, anon;
grant execute on function public.staff_record_catalogue_receipt(uuid, text, text, text) to authenticated;

-- Confirming a list pins every open file that was waiting on it.
create or replace function public.owner_confirm_doc_list(p_code text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_n integer; r record; v_pinned integer := 0;
begin
  if not public.is_owner() then raise exception 'Only the Owner can confirm a document list' using errcode = '42501'; end if;
  update public.doc_lists l set is_confirmed = true, confirmed_at = now(), confirmed_by = (select auth.uid())
   where l.code = p_code and not l.is_confirmed;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'List not found or already confirmed'; end if;
  for r in select si.lead_id from public.submission_intakes si where si.archived_at is null loop
    if public.intake_pin_doc_lists(r.lead_id) then v_pinned := v_pinned + 1; end if;
  end loop;
  perform public.staff_audit_write('document_rules', null, 'doc_list_confirmed', null,
    jsonb_build_object('list', p_code, 'version', (select current_version from public.doc_lists where code = p_code),
                       'files_pinned', v_pinned));
end $$;

-- Owner edits the condition wording of a document an entity type adds or swaps in.
create or replace function public.owner_edit_entity_doc_condition(p_entity text, p_doc text, p_condition text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_rule public.doc_entity_rules;
begin
  if not public.is_owner() then raise exception 'Only the Owner can edit a document list' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_condition, ''))) not between 3 and 300 then
    raise exception 'Write the condition in 3 to 300 characters';
  end if;
  select * into v_rule from public.doc_entity_rules r
   where r.entity_type = p_entity and r.doc_code = p_doc and r.op in ('add', 'replace')
   order by r.id limit 1 for update;
  if not found then raise exception 'That document is not added for this entity type'; end if;
  update public.doc_entity_rules set condition_text = btrim(p_condition) where id = v_rule.id;
  perform public.staff_audit_write('document_rules', null, 'doc_entity_condition_edited', null,
    jsonb_build_object('entity_type', p_entity, 'doc', p_doc, 'from', v_rule.condition_text, 'to', btrim(p_condition)));
end $$;
revoke all on function public.owner_edit_entity_doc_condition(text, text, text) from public, anon;
grant execute on function public.owner_edit_entity_doc_condition(text, text, text) to authenticated;

-- 7. Queue detail shows catalogue receipts by title ------------------------------------------------
create or replace function public.staff_intake_detail(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  select jsonb_build_object(
    'lead_id', si.lead_id,
    'business_name', l.business_name,
    'contact_name', l.contact_name,
    'contact_cell', l.contact_cell,
    'contact_email', l.contact_email,
    'cipc_number', l.cipc_number,
    'requested_amount', l.funding_amount,
    'funding_purpose', l.funding_purpose,
    'funding_type', si.funding_type,
    'channel', si.channel,
    'organisation_name', rp.name,
    'team_name', rt.name,
    'agent_name', ap.full_name,
    'claimed_agent_reference', si.claimed_agent_reference,
    'workflow_status', si.workflow_status,
    'assignee_name', asg.full_name,
    'registered_at', si.registered_at,
    'first_complete_at', si.first_complete_at,
    'archived_at', si.archived_at,
    'archive_reason_code', si.archive_reason_code,
    'missing_documents', case when si.archived_at is null then to_jsonb(public.intake_required_docs_missing(si.lead_id)) else '[]'::jsonb end,
    'open_review_flags', (select count(*) from public.intake_review_flags f where f.lead_id = si.lead_id and f.status = 'open'),
    'introducing_parties', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ip.id, 'kind', ip.party_kind,
               'name', coalesce(pp.full_name, po.name, ip.external_name), 'note', ip.note))
        from public.submission_introducing_parties ip
        left join public.profiles pp on pp.id = ip.profile_id
        left join public.referral_partners po on po.id = ip.organisation_id
       where ip.lead_id = si.lead_id and ip.removed_at is null), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'receipt_id', r.id, 'document_type', coalesce(c.title, r.document_type::text), 'doc_code', r.doc_code,
               'received_via', r.received_via, 'received_at', r.received_at,
               'flagged_suspicious', coalesce((select f.event_kind from public.intake_document_flag_events f
                                                 where f.receipt_id = r.id order by f.id desc limit 1), '') = 'suspicious_flagged')
               order by r.received_at)
        from public.intake_document_receipts r left join public.doc_catalogue c on c.code = r.doc_code
       where r.lead_id = si.lead_id), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'at', e.occurred_at, 'event', e.event_type, 'actor_role', e.actor_role,
               'actor_name', ep.full_name, 'reason', e.reason,
               'to', e.detail ->> 'to') order by e.id)
        from public.staff_audit_events e
        left join public.profiles ep on ep.id = e.actor_id
       where e.entity_type = 'submission_intake' and e.entity_id = si.lead_id), '[]'::jsonb)
  ) into v_result
  from public.submission_intakes si
  join public.leads l on l.id = si.lead_id
  left join public.referral_partners rp on rp.id = si.organisation_id
  left join public.referral_teams rt on rt.id = si.team_id
  left join public.profiles ap on ap.id = si.agent_profile_id
  left join public.profiles asg on asg.id = si.operational_assignee_id
  where si.lead_id = p_lead_id;
  if v_result is null then raise exception 'Submission not found'; end if;
  return v_result;
end;
$$;

notify pgrst, 'reload schema';
