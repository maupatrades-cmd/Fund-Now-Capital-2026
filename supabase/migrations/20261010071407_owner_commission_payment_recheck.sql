-- Recheck manual commission payment eligibility under the same per-deal lock
-- used by approval and draft edits. Does not unify the automatic/manual ledgers.


create or replace function public.owner_flag_commission_entry(
  p_entry_id uuid, p_kind text, p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal uuid;
  v_id uuid;
begin
  perform public.owner_commission_require_owner();
  select e.deal_id into v_deal from public.owner_commission_entries e where e.id = p_entry_id;
  if v_deal is null then raise exception 'Entry not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('owner_commission:' || v_deal::text, 0));
  if not exists (select 1 from public.owner_commission_entries e where e.id = p_entry_id) then
    raise exception 'Entry not found';
  end if;
  insert into public.owner_commission_flags (entry_id, flag_kind, note, raised_by)
  values (p_entry_id, p_kind, btrim(p_note), (select auth.uid()))
  returning id into v_id;
  perform public.staff_audit_write('owner_commission_entry', p_entry_id, 'commission_flag_raised', p_note,
    jsonb_build_object('flag_id', v_id, 'kind', p_kind));
  return v_id;
end;
$$;

create or replace function public.owner_resolve_commission_flag(p_flag_id uuid, p_resolution text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal uuid;
  v_entry uuid;
begin
  perform public.owner_commission_require_owner();
  select e.deal_id into v_deal from public.owner_commission_entries e join public.owner_commission_flags f on f.entry_id = e.id where f.id = p_flag_id;
  if v_deal is null then raise exception 'Entry not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('owner_commission:' || v_deal::text, 0));
  update public.owner_commission_flags
     set status = 'acknowledged', resolved_by = (select auth.uid()), resolved_at = now(), resolution = btrim(p_resolution)
   where id = p_flag_id and status = 'open'
   returning entry_id into v_entry;
  if v_entry is null then raise exception 'Open flag not found'; end if;
  perform public.staff_audit_write('owner_commission_entry', v_entry, 'commission_flag_acknowledged', p_resolution,
    jsonb_build_object('flag_id', p_flag_id));
  return p_flag_id;
end;
$$;

create or replace function public.owner_adjust_commission_entry(
  p_entry_id uuid, p_delta numeric, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal uuid;
  v_status text;
  v_prev   numeric(14,2);
begin
  perform public.owner_commission_require_owner();
  select e.deal_id into v_deal from public.owner_commission_entries e where e.id = p_entry_id;
  if v_deal is null then raise exception 'Entry not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('owner_commission:' || v_deal::text, 0));
  select e.status into v_status from public.owner_commission_entries e where e.id = p_entry_id for update;
  if v_status is null then raise exception 'Entry not found'; end if;
  if v_status not in ('approved', 'paid') then
    raise exception 'Only approved or paid entries are adjusted; edit a draft directly';
  end if;
  v_prev := public.owner_commission_effective(p_entry_id);
  insert into public.owner_commission_adjustments (entry_id, delta, previous_effective, new_effective, reason, actor_id)
  values (p_entry_id, p_delta, v_prev, v_prev + p_delta, btrim(p_reason), (select auth.uid()));
  perform public.staff_audit_write('owner_commission_entry', p_entry_id, 'commission_entry_adjusted', p_reason,
    jsonb_build_object('delta', p_delta, 'previous_effective', v_prev, 'new_effective', v_prev + p_delta));
  return jsonb_build_object('entry_id', p_entry_id, 'effective_amount', v_prev + p_delta);
end;
$$;

create or replace function public.owner_mark_commission_entry_paid(
  p_entry_id uuid, p_payment_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal uuid;
  v_status text;
  v_recon jsonb;
begin
  perform public.owner_commission_require_owner();
  select e.deal_id into v_deal from public.owner_commission_entries e where e.id = p_entry_id;
  if v_deal is null then raise exception 'Entry not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('owner_commission:' || v_deal::text, 0));
  select e.status into v_status from public.owner_commission_entries e where e.id = p_entry_id for update;
  if v_status is null then raise exception 'Entry not found'; end if;
  if v_status <> 'approved' then raise exception 'Only an approved entry can be marked paid'; end if;
  if p_payment_reference is null or length(btrim(p_payment_reference)) < 3 then
    raise exception 'A payment reference is required';
  end if;
  v_recon := public.owner_commission_reconciliation(v_deal);
  if (v_recon ->> 'reconciled')::boolean is not true then
    raise exception 'Entries do not reconcile to the stated total; reconcile before payment';
  end if;
  if (v_recon ->> 'open_flags')::integer > 0 then
    raise exception 'Resolve the open commission flags before payment';
  end if;
  if exists (select 1 from public.owner_commission_entries e
              where e.deal_id = v_deal and e.status = 'draft') then
    raise exception 'Approve all draft commission entries before payment';
  end if;
  perform set_config('fnc.commission_transition', 'on', true);
  update public.owner_commission_entries
     set status = 'paid', paid_by = (select auth.uid()), paid_at = now(), payment_reference = btrim(p_payment_reference)
   where id = p_entry_id;
  perform set_config('fnc.commission_transition', 'off', true);
  perform public.staff_audit_write('owner_commission_entry', p_entry_id, 'commission_entry_paid', null,
    jsonb_build_object('effective_amount', public.owner_commission_effective(p_entry_id)));
  return p_entry_id;
end;
$$;
