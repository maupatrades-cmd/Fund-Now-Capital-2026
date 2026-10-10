-- Sales Coordinator build SC1: required documents lists per product.
-- The Owner's blueprint table (7 Oct 2026, section 6) is loaded as an UNCONFIRMED draft:
-- rows are inactive until the Owner confirms a product with owner_confirm_document_rules.
-- While inactive, the Complete gate keeps refusing ("no rules configured"), so nothing is
-- enforced on the strength of an unconfirmed table. Only the Owner can edit or confirm.
--
-- Mapping notes (change on request):
--  * "Asset finance" is loaded for both equipment_finance and asset_backed_finance.
--  * "Signed application form with POPIA consent" = application_form (one signed document).
--  * "CIPC registration and list of directors" = cipc_cert.
--  * "AFS or management accounts" = financial_statements (one type; management accounts
--    would need a separate either-or rule, not modelled).
--  * "If available" / "If applicable" are loaded as optional.

do $seed$
declare
  v_owner uuid;
  v_marker constant text := 'SC1 draft from the Owner blueprint of 7 Oct 2026. Unconfirmed.';
  r record;
begin
  select p.id into v_owner from public.profiles p where p.role::text = 'owner' order by p.created_at limit 1;
  if v_owner is null then raise exception 'No owner profile found; cannot seed the draft rules'; end if;

  for r in
    select * from (values
      -- document_type, requirement, products (array)
      ('application_form',     'required', array['purchase_order_finance','invoice_discounting','working_capital','equipment_finance','asset_backed_finance']),
      ('bank_statement',       'required', array['purchase_order_finance','invoice_discounting','working_capital','equipment_finance','asset_backed_finance']),
      ('cipc_cert',            'required', array['purchase_order_finance','invoice_discounting','working_capital','equipment_finance','asset_backed_finance']),
      ('id_copy',              'required', array['purchase_order_finance','invoice_discounting','working_capital','equipment_finance','asset_backed_finance']),
      ('proof_of_address',     'required', array['purchase_order_finance','invoice_discounting','working_capital','equipment_finance','asset_backed_finance']),
      ('tax_clearance',        'required', array['purchase_order_finance','invoice_discounting','working_capital','equipment_finance','asset_backed_finance']),
      ('purchase_order',       'required', array['purchase_order_finance']),
      ('invoice_doc',          'required', array['invoice_discounting']),
      ('quotation',            'required', array['purchase_order_finance','equipment_finance','asset_backed_finance']),
      ('financial_statements', 'optional', array['purchase_order_finance','invoice_discounting']),
      ('financial_statements', 'required', array['working_capital','equipment_finance','asset_backed_finance']),
      ('bee_cert',             'optional', array['purchase_order_finance','invoice_discounting','working_capital','equipment_finance','asset_backed_finance'])
    ) as t(document_type, requirement, products)
  loop
    insert into public.document_requirement_rules
      (rule_scope, product_code, document_type, requirement, source_reference_text, created_by, is_active)
    select 'product_baseline', p, r.document_type::public.document_type, r.requirement, v_marker, v_owner, false
      from unnest(r.products) as p
     where not exists (
       select 1 from public.document_requirement_rules x
        where x.rule_scope = 'product_baseline' and x.product_code = p
          and x.document_type = r.document_type::public.document_type);
  end loop;
end
$seed$;

-- Owner-only listing: shows each rule with whether it is still an unconfirmed draft.
create or replace function public.owner_list_document_rules()
returns table (product_code text, document_type text, requirement text, is_active boolean, is_draft boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can view document rules' using errcode = '42501'; end if;
  return query
    select r.product_code, r.document_type::text, r.requirement, r.is_active,
           (not r.is_active and r.source_reference_text like 'SC1 draft%')
      from public.document_requirement_rules r
     where r.rule_scope = 'product_baseline'
     order by r.product_code, (r.requirement = 'required') desc, r.document_type::text;
end;
$$;

-- Owner confirms a product's draft list: draft rows become active and enforced.
create or replace function public.owner_confirm_document_rules(p_product_code text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if not public.is_owner() then raise exception 'Only the owner can confirm document rules' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('document_rules:' || p_product_code, 0));
  update public.document_requirement_rules r
     set is_active = true, source_reference_text = 'Confirmed by the Owner'
   where r.rule_scope = 'product_baseline' and r.product_code = p_product_code
     and not r.is_active and r.source_reference_text like 'SC1 draft%';
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'No unconfirmed draft rules for %', p_product_code; end if;
  perform public.staff_audit_write('document_rules', null, 'document_rules_confirmed', null,
    jsonb_build_object('product', p_product_code, 'rules', v_n));
  return v_n;
end;
$$;

-- Owner edits one rule: required / optional / waived, or removes it from the list.
create or replace function public.owner_set_document_rule(p_product_code text, p_document_type text, p_requirement text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_type public.document_type; v_n integer;
begin
  if not public.is_owner() then raise exception 'Only the owner can change document rules' using errcode = '42501'; end if;
  if p_requirement not in ('required', 'optional', 'waived') then raise exception 'Requirement must be required, optional or waived'; end if;
  v_type := p_document_type::public.document_type;
  perform pg_advisory_xact_lock(hashtextextended('document_rules:' || p_product_code, 0));
  update public.document_requirement_rules r set requirement = p_requirement
   where r.rule_scope = 'product_baseline' and r.product_code = p_product_code and r.document_type = v_type;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    insert into public.document_requirement_rules (rule_scope, product_code, document_type, requirement, source_reference_text, created_by, is_active)
    values ('product_baseline', p_product_code, v_type, p_requirement, 'Set by the Owner', (select auth.uid()), true);
  end if;
  perform public.staff_audit_write('document_rules', null, 'document_rule_set', null,
    jsonb_build_object('product', p_product_code, 'document_type', p_document_type, 'requirement', p_requirement));
end;
$$;

revoke all on function public.owner_list_document_rules() from public, anon;
revoke all on function public.owner_confirm_document_rules(text) from public, anon;
revoke all on function public.owner_set_document_rule(text, text, text) from public, anon;
grant execute on function public.owner_list_document_rules() to authenticated;
grant execute on function public.owner_confirm_document_rules(text) to authenticated;
grant execute on function public.owner_set_document_rule(text, text, text) to authenticated;

-- Review fix: the Document Tracker checklist now agrees with the Complete gate
-- (intake_required_docs_missing). A document counts as received when a non-flagged
-- receipt exists OR a current stored document exists; a flagged receipt does not count.
create or replace function public.staff_document_checklist(p_lead_id uuid)
returns table (
  document_type text, requirement text, received boolean, received_count integer,
  last_received_at timestamptz, flagged_suspicious boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare v_type text;
begin
  perform public.intake_require_actor(array['owner', 'coordinator', 'switchboard']);
  select si.funding_type into v_type from public.submission_intakes si where si.lead_id = p_lead_id;
  if not found then raise exception 'Submission not found'; end if;
  return query
    select r.document_type::text, r.requirement,
           (coalesce(x.ok_cnt, 0) > 0 or exists (
              select 1 from public.documents d
               where d.lead_id = p_lead_id and d.document_type = r.document_type and d.is_current_version)),
           coalesce(x.cnt, 0)::integer, x.last_at, coalesce(x.flagged, false)
      from public.document_requirement_rules r
      left join lateral (
        select count(*) as cnt, max(d.received_at) as last_at,
               count(*) filter (where coalesce((select f.event_kind from public.intake_document_flag_events f
                                  where f.receipt_id = d.id order by f.id desc limit 1), '') <> 'suspicious_flagged') as ok_cnt,
               bool_or(coalesce((select f.event_kind from public.intake_document_flag_events f
                                  where f.receipt_id = d.id order by f.id desc limit 1), '') = 'suspicious_flagged') as flagged
          from public.intake_document_receipts d
         where d.lead_id = p_lead_id and d.document_type = r.document_type) x on true
     where r.rule_scope = 'product_baseline' and r.product_code = v_type and r.is_active
     order by (r.requirement = 'required') desc, r.document_type::text;
end;
$$;
