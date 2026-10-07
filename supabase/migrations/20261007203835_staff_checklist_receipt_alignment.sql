-- One metadata-only receipt projection for both staff display and Complete gate.
-- A receipt is not authenticity verification. Suspicious receipts do not qualify.
create or replace function public.intake_document_receipt_summary(p_lead_id uuid)
returns table(document_type text, received_count integer, last_received_at timestamptz,
              flagged_suspicious boolean)
language sql stable security definer set search_path = '' as $$
  with evidence as (
    select r.document_type::text as kind, r.received_at as at_time,
           coalesce((select f.event_kind from public.intake_document_flag_events f
                     where f.receipt_id = r.id order by f.id desc limit 1), '')
             = 'suspicious_flagged' as suspicious
      from public.intake_document_receipts r where r.lead_id = p_lead_id
    union all
    select d.document_type::text, null::timestamptz, false
      from public.documents d
     where d.is_current_version and (
       d.lead_id = p_lead_id or
       (d.lead_id is null and d.client_id in (
         select deal.client_id from public.submission_intakes si
         join public.deals deal on deal.id = si.deal_id
         where si.lead_id = p_lead_id)))
  )
  select kind, (count(*) filter (where not suspicious))::integer,
         max(at_time) filter (where not suspicious), bool_or(suspicious)
    from evidence group by kind;
$$;
revoke all on function public.intake_document_receipt_summary(uuid) from public, anon, authenticated;

create or replace function public.intake_required_docs_missing(p_lead_id uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare v_type text; v_missing text[];
begin
  select funding_type into v_type from public.submission_intakes where lead_id = p_lead_id;
  if v_type is null then return array['Funding type not set']; end if;
  if not exists (select 1 from public.document_requirement_rules r
    where r.rule_scope = 'product_baseline' and r.product_code = v_type
      and r.is_active and r.requirement = 'required') then
    return array['No required-document rules are configured for this funding type'];
  end if;
  select coalesce(array_agg(r.document_type::text order by r.document_type::text), '{}'::text[])
    into v_missing from public.document_requirement_rules r
    left join public.intake_document_receipt_summary(p_lead_id) s
      on s.document_type = r.document_type::text
   where r.rule_scope = 'product_baseline' and r.product_code = v_type
     and r.is_active and r.requirement = 'required' and coalesce(s.received_count,0) = 0;
  return v_missing;
end;
$$;
revoke all on function public.intake_required_docs_missing(uuid) from public, anon, authenticated;

create or replace function public.staff_document_checklist(p_lead_id uuid)
returns table(document_type text, requirement text, received boolean, received_count integer,
              last_received_at timestamptz, flagged_suspicious boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_type text;
begin
  perform public.intake_require_actor(array['owner','coordinator','switchboard']);
  select funding_type into v_type from public.submission_intakes where lead_id = p_lead_id;
  if not found then raise exception 'Submission not found'; end if;
  return query select r.document_type::text, r.requirement,
    coalesce(s.received_count,0) > 0, coalesce(s.received_count,0),
    s.last_received_at, coalesce(s.flagged_suspicious,false)
    from public.document_requirement_rules r
    left join public.intake_document_receipt_summary(p_lead_id) s
      on s.document_type = r.document_type::text
   where r.rule_scope = 'product_baseline' and r.product_code = v_type and r.is_active
   order by (r.requirement = 'required') desc, r.document_type::text;
end;
$$;
revoke all on function public.staff_document_checklist(uuid) from public, anon;
grant execute on function public.staff_document_checklist(uuid) to authenticated;
notify pgrst, 'reload schema';
