-- Staff build review fixes, round 1 (forward-only; applied migrations are not rewritten).
-- 1. owner_set_staff_access: keep staff_access.staff_role in step with the profile role,
--    otherwise a role change locks the person out of being re-enabled.
-- 2. Commission RPCs: every writer takes the same per-deal advisory lock as approve,
--    so a concurrent edit cannot slip an unreconciled draft into approval.
-- 3. owner_set_calendar_grant: the calendar owner must be an owner profile.

create or replace function public.owner_set_staff_access(p_profile_id uuid, p_enabled boolean, p_contract_reference text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare
  v_role text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can enable or disable staff access' using errcode = '42501';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = p_profile_id;
  if v_role is null then raise exception 'Profile not found'; end if;
  if v_role not in ('switchboard', 'coordinator') then
    raise exception 'Profile is not a staff role (assign switchboard or coordinator first)';
  end if;

  insert into public.staff_access (profile_id, staff_role, access_enabled, contract_reference, activation_note)
  values (p_profile_id, v_role::public.user_role, coalesce(p_enabled, false),
          nullif(btrim(p_contract_reference), ''), nullif(btrim(p_note), ''))
  on conflict (profile_id) do update
    set staff_role         = excluded.staff_role,
        access_enabled     = excluded.access_enabled,
        contract_reference = coalesce(excluded.contract_reference, public.staff_access.contract_reference),
        activation_note    = coalesce(excluded.activation_note, public.staff_access.activation_note);

  perform public.staff_audit_write(
    'staff_access', p_profile_id,
    case when coalesce(p_enabled, false) then 'staff_access_enabled' else 'staff_access_disabled' end,
    p_note,
    jsonb_build_object('staff_role', v_role, 'contract_reference', nullif(btrim(p_contract_reference), '')));
  return p_profile_id;
end;
$function$;

create or replace function public.owner_save_commission_entry(p_entry_id uuid, p_deal_id uuid, p_beneficiary_kind text, p_beneficiary_profile_id uuid, p_beneficiary_organisation_id uuid, p_beneficiary_name text, p_currency text, p_amount numeric, p_basis text default null, p_percentage numeric default null, p_reason text default null)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare
  v_id  uuid;
  v_old public.owner_commission_entries;
begin
  perform public.owner_commission_require_owner();
  perform pg_advisory_xact_lock(hashtextextended('owner_commission:' || p_deal_id::text, 0));
  if not exists (select 1 from public.deals d where d.id = p_deal_id) then raise exception 'Deal not found'; end if;

  if p_beneficiary_kind = 'agent' and not exists (
       select 1 from public.profiles p where p.id = p_beneficiary_profile_id and p.is_active
          and p.role::text in ('partner', 'lead_referrer')) then
    raise exception 'The agent must be an active partner or lead-referrer profile';
  elsif p_beneficiary_kind = 'team_leader' and not exists (
       select 1 from public.referral_team_memberships m
        where m.profile_id = p_beneficiary_profile_id and m.membership_role = 'team_leader') then
    raise exception 'That person has never been a Team Leader';
  elsif p_beneficiary_kind = 'organisation' and not exists (
       select 1 from public.referral_partners rp where rp.id = p_beneficiary_organisation_id and rp.is_active) then
    raise exception 'Active organisation not found';
  end if;

  if p_entry_id is null then
    insert into public.owner_commission_entries
      (deal_id, beneficiary_kind, beneficiary_profile_id, beneficiary_organisation_id, beneficiary_name,
       currency, amount, basis, percentage, entered_by, reason)
    values (p_deal_id, p_beneficiary_kind, p_beneficiary_profile_id, p_beneficiary_organisation_id,
            nullif(btrim(p_beneficiary_name), ''), upper(coalesce(p_currency, 'ZAR')), p_amount,
            nullif(btrim(p_basis), ''), p_percentage, (select auth.uid()), nullif(btrim(p_reason), ''))
    returning id into v_id;
    perform public.staff_audit_write('owner_commission_entry', v_id, 'commission_entry_created', p_reason,
      jsonb_build_object('deal_id', p_deal_id, 'kind', p_beneficiary_kind, 'amount', p_amount,
                         'currency', upper(coalesce(p_currency, 'ZAR')), 'percentage', p_percentage));
    return v_id;
  end if;

  select * into v_old from public.owner_commission_entries e where e.id = p_entry_id for update;
  if not found then raise exception 'Entry not found'; end if;
  if v_old.deal_id <> p_deal_id then raise exception 'Entry belongs to a different deal'; end if;
  if v_old.status <> 'draft' then
    raise exception 'Only a draft entry can be edited; use an adjustment for an approved or paid entry';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'A reason of at least 10 characters is required to amend an entry';
  end if;
  update public.owner_commission_entries
     set beneficiary_kind = p_beneficiary_kind, beneficiary_profile_id = p_beneficiary_profile_id,
         beneficiary_organisation_id = p_beneficiary_organisation_id,
         beneficiary_name = nullif(btrim(p_beneficiary_name), ''),
         currency = upper(coalesce(p_currency, 'ZAR')), amount = p_amount,
         basis = nullif(btrim(p_basis), ''), percentage = p_percentage, reason = btrim(p_reason)
   where id = p_entry_id;
  perform public.staff_audit_write('owner_commission_entry', p_entry_id, 'commission_entry_amended', p_reason,
    jsonb_build_object('previous_amount', v_old.amount, 'new_amount', p_amount,
                       'previous_percentage', v_old.percentage, 'new_percentage', p_percentage));
  return p_entry_id;
end;
$function$;

create or replace function public.owner_set_commission_total(p_deal_id uuid, p_currency text, p_total numeric, p_reason text default null)
returns uuid language plpgsql security definer set search_path to '' as $function$
begin
  perform public.owner_commission_require_owner();
  perform pg_advisory_xact_lock(hashtextextended('owner_commission:' || p_deal_id::text, 0));
  if not exists (select 1 from public.deals d where d.id = p_deal_id) then raise exception 'Deal not found'; end if;
  if exists (select 1 from public.owner_commission_entries e
              where e.deal_id = p_deal_id and e.status in ('approved', 'paid')) then
    raise exception 'The stated total cannot change once an entry is approved; adjust entries instead';
  end if;
  insert into public.owner_commission_deal_totals (deal_id, currency, total_amount, set_by)
  values (p_deal_id, upper(coalesce(p_currency, 'ZAR')), p_total, (select auth.uid()))
  on conflict (deal_id) do update
    set currency = excluded.currency, total_amount = excluded.total_amount,
        set_by = excluded.set_by, set_at = now();
  perform public.staff_audit_write('owner_commission_entry', p_deal_id, 'commission_total_set', p_reason,
    jsonb_build_object('currency', upper(coalesce(p_currency, 'ZAR')), 'total', p_total));
  return p_deal_id;
end;
$function$;

create or replace function public.owner_void_commission_entry(p_entry_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare
  v_status text;
  v_deal   uuid;
begin
  perform public.owner_commission_require_owner();
  select e.deal_id into v_deal from public.owner_commission_entries e where e.id = p_entry_id;
  if v_deal is null then raise exception 'Entry not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('owner_commission:' || v_deal::text, 0));
  select e.status into v_status from public.owner_commission_entries e where e.id = p_entry_id for update;
  if v_status <> 'draft' then raise exception 'Only a draft entry can be voided'; end if;
  perform set_config('fnc.commission_transition', 'on', true);
  update public.owner_commission_entries set status = 'void', void_reason = btrim(p_reason) where id = p_entry_id;
  perform set_config('fnc.commission_transition', 'off', true);
  perform public.staff_audit_write('owner_commission_entry', p_entry_id, 'commission_entry_voided', p_reason, '{}'::jsonb);
  return p_entry_id;
end;
$function$;

create or replace function public.owner_set_calendar_grant(p_calendar_owner uuid, p_grantee uuid, p_permission text, p_effective_to date default null)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare
  v_id uuid;
begin
  if not public.is_owner() then raise exception 'Only the owner can grant calendar permissions' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_calendar_owner and p.is_active and p.role::text = 'owner') then
    raise exception 'Calendar owner not found';
  end if;
  if not exists (select 1 from public.staff_access s join public.profiles p on p.id = s.profile_id
                  where s.profile_id = p_grantee and s.access_enabled and p.is_active) then
    raise exception 'The grantee must be an enabled staff member';
  end if;
  begin
    insert into public.calendar_grants (calendar_owner_id, grantee_id, permission, effective_to, granted_by)
    values (p_calendar_owner, p_grantee, p_permission, p_effective_to, (select auth.uid()))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'That permission is already granted; revoke it first to change it';
  end;
  perform public.staff_audit_write('calendar_grant', v_id, 'calendar_grant_created', null,
    jsonb_build_object('calendar_owner', p_calendar_owner, 'grantee', p_grantee, 'permission', p_permission, 'effective_to', p_effective_to));
  return v_id;
end;
$function$;
