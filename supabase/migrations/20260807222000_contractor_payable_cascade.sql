-- Build 7: connect the existing locked contractor tier row to the existing
-- funder-invoice lifecycle. This does not calculate or accept a new amount:
-- contractor_share was already frozen by apply_tier_on_lock (or the audited
-- R1m+ manual amount RPC). It only advances that row as FNC invoices and is paid.

create or replace function public.transition_contractor_commission_record(
  p_commission_record_id uuid,
  p_to public.commission_state,
  p_funder_invoice_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.commission_state;
  v_deal_id uuid;
  v_invoice_deal_id uuid;
  v_contractor_id uuid;
  v_contractor_share numeric(14,2);
  v_attribution_type text;
  v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can transition contractor commission records';
  end if;

  perform pg_advisory_xact_lock(hashtext('contractor_commission_record:' || p_commission_record_id::text));

  select status, deal_id, contractor_id, contractor_share, attribution_type
    into v_from, v_deal_id, v_contractor_id, v_contractor_share, v_attribution_type
  from public.commission_records
  where id = p_commission_record_id
    and deal_funder_submission_id is null;

  if v_from is null then
    raise exception 'Contractor tier commission record % not found', p_commission_record_id;
  end if;
  if v_attribution_type is distinct from 'FNC_Contractor'
     or v_contractor_id is null
     or coalesce(v_contractor_share, 0) <= 0 then
    raise exception 'Commission record % is not a payable FNC contractor tier row', p_commission_record_id;
  end if;
  if v_from = p_to then
    return jsonb_build_object('was_transitioned', false, 'status', v_from, 'reason', 'already_at_target');
  end if;
  if not (
       (p_to = 'outstanding' and v_from = 'earned')
    or (p_to = 'payable' and v_from = 'outstanding')
    or (p_to = 'earned' and v_from = 'outstanding')
  ) then
    raise exception 'Illegal contractor commission transition % -> % (record %)',
      v_from, p_to, p_commission_record_id;
  end if;

  if p_to = 'outstanding' then
    if p_funder_invoice_id is null then
      raise exception 'Transition to outstanding requires a funder invoice';
    end if;
    select deal_id into v_invoice_deal_id
    from public.funder_invoices
    where id = p_funder_invoice_id;
    if v_invoice_deal_id is null then
      raise exception 'Funder invoice % not found', p_funder_invoice_id;
    end if;
    if v_invoice_deal_id is distinct from v_deal_id then
      raise exception 'Funder invoice % belongs to a different deal than contractor commission %',
        p_funder_invoice_id, p_commission_record_id;
    end if;
  end if;

  update public.commission_records
  set status = p_to,
      funder_invoice_id = case when p_to = 'outstanding' then p_funder_invoice_id
                               when p_to = 'earned' then null
                               else funder_invoice_id end,
      outstanding_at = case when p_to = 'outstanding' then now()
                            when p_to = 'earned' then null
                            else outstanding_at end,
      payable_at = case when p_to = 'payable' then now()
                        when p_to = 'earned' then null
                        else payable_at end
  where id = p_commission_record_id and status = v_from
  returning id into v_id;

  if v_id is null then
    select status into v_from from public.commission_records where id = p_commission_record_id;
    return jsonb_build_object('was_transitioned', false, 'status', v_from, 'reason', 'lost_race');
  end if;

  return jsonb_build_object('was_transitioned', true, 'from', v_from, 'to', p_to);
end;
$$;

revoke all on function public.transition_contractor_commission_record(uuid, public.commission_state, uuid)
  from public, anon, authenticated;

create or replace function public.contractor_commission_cascade_on_invoice_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if new.state is not distinct from old.state then
    return null;
  end if;

  if old.state = 'draft' and new.state = 'issued' then
    -- Claim the one active contractor tier row for this deal. If a deal has
    -- multiple funder invoices, only the first invoice to move an earned row
    -- can claim it; the row-level transition RPC locks and rechecks the state.
    for r in
      select cr.id
      from public.commission_records cr
      where cr.deal_id = new.deal_id
        and cr.deal_funder_submission_id is null
        and cr.attribution_type = 'FNC_Contractor'
        and cr.contractor_id is not null
        and cr.contractor_share > 0
        and cr.status = 'earned'
        and cr.funder_invoice_id is null
    loop
      perform public.transition_contractor_commission_record(r.id, 'outstanding', new.id);
    end loop;

  elsif new.state = 'paid' and old.state in ('issued', 'overdue') then
    -- Defensive catch-up: if a legacy/late-created tier row missed the issue
    -- event, attach it before making it payable. No amount is recomputed.
    for r in
      select cr.id
      from public.commission_records cr
      where cr.deal_id = new.deal_id
        and cr.deal_funder_submission_id is null
        and cr.attribution_type = 'FNC_Contractor'
        and cr.contractor_id is not null
        and cr.contractor_share > 0
        and cr.status = 'earned'
        and cr.funder_invoice_id is null
    loop
      perform public.transition_contractor_commission_record(r.id, 'outstanding', new.id);
    end loop;

    for r in
      select cr.id
      from public.commission_records cr
      where cr.deal_id = new.deal_id
        and cr.deal_funder_submission_id is null
        and cr.attribution_type = 'FNC_Contractor'
        and cr.contractor_id is not null
        and cr.contractor_share > 0
        and cr.status = 'outstanding'
        and cr.funder_invoice_id = new.id
    loop
      perform public.transition_contractor_commission_record(r.id, 'payable', new.id);
    end loop;

  elsif new.state = 'void' and old.state in ('issued', 'overdue') then
    for r in
      select cr.id, cr.status
      from public.commission_records cr
      where cr.deal_id = new.deal_id
        and cr.deal_funder_submission_id is null
        and cr.attribution_type = 'FNC_Contractor'
        and cr.contractor_id is not null
        and cr.funder_invoice_id = new.id
    loop
      if r.status = 'outstanding' then
        perform public.transition_contractor_commission_record(r.id, 'earned', new.id);
      elsif r.status in ('payable', 'settled') then
        -- Never claw back an amount that became payable or was settled. The
        -- immutable audit alert tells the owner to reconcile it explicitly.
        insert into public.activity_logs (
          occurred_at, user_id, event_type, entity_type, entity_id,
          description, after_values, related_entity_ids
        ) values (
          now(), auth.uid(), 'INVOICE'::public.activity_event_type,
          'commission_record', r.id,
          'CONTRACTOR_COMMISSION_MISMATCH_ON_INVOICE_VOID: invoice ' ||
            new.invoice_number || ' was voided after contractor commission became ' || r.status,
          jsonb_build_object(
            'invoice_id', new.id,
            'commission_record_id', r.id,
            'commission_status', r.status
          ),
          jsonb_build_array(new.deal_id)
        );
      end if;
    end loop;
  end if;

  return null;
end;
$$;

drop trigger if exists contractor_commission_cascade_on_invoice_state
  on public.funder_invoices;
create trigger contractor_commission_cascade_on_invoice_state
after update of state on public.funder_invoices
for each row execute function public.contractor_commission_cascade_on_invoice_state();

-- Internal trigger body only. Invoice state changes still enter through the
-- existing owner-gated invoice RPCs; no new public money mutation is exposed.
revoke all on function public.contractor_commission_cascade_on_invoice_state()
  from public, anon, authenticated;

do $$
declare
  v_definition text;
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.funder_invoices'::regclass
      and tgname = 'contractor_commission_cascade_on_invoice_state'
      and not tgisinternal
  ) then
    raise exception 'Contractor payable cascade assertion failed: trigger missing';
  end if;

  if has_function_privilege(
    'anon',
    'public.contractor_commission_cascade_on_invoice_state()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.contractor_commission_cascade_on_invoice_state()',
    'execute'
  ) then
    raise exception 'Contractor payable cascade assertion failed: trigger function exposed to API roles';
  end if;

  select pg_get_functiondef(
    'public.contractor_commission_cascade_on_invoice_state()'::regprocedure
  ) into v_definition;

  if v_definition not ilike '%deal_funder_submission_id is null%'
     or v_definition not ilike '%attribution_type = ''FNC_Contractor''%'
     or v_definition not ilike '%contractor_share > 0%'
     or v_definition not ilike '%transition_contractor_commission_record%payable%' then
    raise exception 'Contractor payable cascade assertion failed: contractor-only lifecycle guards missing';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = 'public.contractor_commission_cascade_on_invoice_state()'::regprocedure
      and prosecdef
      and proconfig::text like '%search_path=%'
  ) then
    raise exception 'Contractor payable cascade assertion failed: function is not hardened';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.transition_contractor_commission_record(uuid,public.commission_state,uuid)',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.transition_contractor_commission_record(uuid,public.commission_state,uuid)',
    'execute'
  ) then
    raise exception 'Contractor payable cascade assertion failed: contractor transition exposed to API roles';
  end if;
end;
$$;

notify pgrst, 'reload schema';
