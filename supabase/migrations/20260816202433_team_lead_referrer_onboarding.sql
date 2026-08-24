-- Team onboarding: make the existing lead_referrer role assignable and keep
-- the existing Path-B sub-agent relationship canonical. A "sub-agent" is not
-- a new role: it is a lead_referrer profile with sourced_via_partner_id and a
-- matching partner_lead_referrers membership row.

create or replace function public.admin_update_user_role(
  p_user_id                 uuid,
  p_new_role                public.user_role,
  p_new_referral_partner_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid                  uuid := (select auth.uid());
  v_old                  public.profiles;
  v_new                  public.profiles;
  v_partner_id           uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change user roles';
  end if;
  if p_new_role = 'owner' then
    raise exception 'The owner role cannot be assigned through user management';
  end if;

  select * into v_old from public.profiles where id = p_user_id for update;
  if not found then raise exception 'User profile not found'; end if;
  if v_old.role = 'owner' then
    raise exception 'The owner account cannot be modified through user management';
  end if;

  if p_new_role::text in ('partner', 'lead_referrer') then
    v_partner_id := p_new_referral_partner_id;
    if v_partner_id is not null and not exists (
      select 1 from public.referral_partners rp
       where rp.id = v_partner_id and rp.is_active
    ) then
      raise exception 'Active referral partner not found';
    end if;
  end if;

  update public.profiles
     set role = p_new_role,
         referral_partner_id = case when p_new_role = 'partner' then v_partner_id else null end,
         sourced_via_partner_id = case when p_new_role::text = 'lead_referrer' then v_partner_id else null end,
         updated_at = now()
   where id = p_user_id
   returning * into v_new;
  if not found then raise exception 'Role update affected no rows'; end if;

  if p_new_role::text = 'lead_referrer' and v_partner_id is not null then
    insert into public.partner_lead_referrers
      (profile_id, referral_partner_id, display_name, status, invited_by)
    values
      (p_user_id, v_partner_id, coalesce(nullif(btrim(v_new.full_name), ''), v_new.email, 'Lead referrer'), 'active', v_uid)
    on conflict (profile_id) do update
      set referral_partner_id = excluded.referral_partner_id,
          display_name = excluded.display_name,
          status = 'active',
          updated_at = now();
  else
    delete from public.partner_lead_referrers where profile_id = p_user_id;
  end if;

  insert into public.activity_logs
    (user_id, user_email, user_role, event_type, entity_type, entity_id, description,
     changed_fields, before_values, after_values)
  select
    v_uid, actor.email, actor.role, 'PERMISSION_CHANGE', 'profile', p_user_id,
    'User role or partner attribution changed',
    jsonb_build_array('role', 'referral_partner_id', 'sourced_via_partner_id'),
    jsonb_build_object(
      'role', v_old.role,
      'referral_partner_id', v_old.referral_partner_id,
      'sourced_via_partner_id', v_old.sourced_via_partner_id
    ),
    jsonb_build_object(
      'role', v_new.role,
      'referral_partner_id', v_new.referral_partner_id,
      'sourced_via_partner_id', v_new.sourced_via_partner_id
    )
  from public.profiles actor where actor.id = v_uid;

  return p_user_id;
end;
$$;

revoke all on function public.admin_update_user_role(uuid, public.user_role, uuid) from public, anon;
grant execute on function public.admin_update_user_role(uuid, public.user_role, uuid) to authenticated;

-- The original Path-B submitter required every lead referrer to belong to a
-- partner. Team Management now exposes both canonical paths, so keep one RPC:
-- Path A has no parent partner; Path B carries the selected partner through to
-- the lead. The parameter names intentionally match the existing signature.
alter table public.leads drop constraint if exists leads_path_b_partner_ck;

create or replace function public.lead_referrer_submit_lead(
  p_business_name text,
  p_contact_name text,
  p_contact_cell text,
  p_contact_email text,
  p_funding_amount numeric,
  p_funding_purpose jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_parent uuid;
  v_membership_parent uuid;
  v_lead uuid;
  v_owner record;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select p.sourced_via_partner_id
    into v_parent
    from public.profiles p
   where p.id = v_uid and p.role::text = 'lead_referrer' and p.is_active;
  if not found then raise exception 'Active lead-referrer profile required'; end if;

  select lr.referral_partner_id
    into v_membership_parent
    from public.partner_lead_referrers lr
   where lr.profile_id = v_uid and lr.status = 'active';

  if v_parent is not null and v_membership_parent is distinct from v_parent then
    raise exception 'Lead-referrer partner attribution is incomplete; ask the owner to repair the Team assignment';
  end if;
  if v_parent is null and v_membership_parent is not null then
    v_parent := v_membership_parent;
  end if;

  if length(btrim(coalesce(p_business_name, ''))) < 2
     or length(btrim(coalesce(p_contact_name, ''))) < 2 then
    raise exception 'Business and contact names are required';
  end if;
  if p_funding_amount is not null and (p_funding_amount <= 0 or p_funding_amount > 100000000) then
    raise exception 'Funding amount is outside the allowed range';
  end if;

  insert into public.leads (
    business_name,
    contact_name,
    contact_cell,
    contact_email,
    funding_amount,
    funding_purpose,
    referred_by,
    referral_partner_id,
    entered_by,
    attributed_to_lead_referrer_id,
    sourced_by_lead_refer_id,
    attribution_source
  ) values (
    btrim(p_business_name),
    btrim(p_contact_name),
    nullif(btrim(p_contact_cell), ''),
    lower(nullif(btrim(p_contact_email), '')),
    p_funding_amount,
    coalesce(p_funding_purpose, '[]'::jsonb),
    'other',
    v_parent,
    v_uid,
    v_uid,
    v_uid,
    'lead_referrer'
  ) returning id into v_lead;

  insert into public.lead_attribution_events
    (lead_id, event_type, lead_referrer_profile_id, referral_partner_id, actor_id)
  values (v_lead, 'captured', v_uid, v_parent, v_uid);

  for v_owner in
    select p.id from public.profiles p where p.role = 'owner' and p.is_active
  loop
    perform public.emit_in_app_notification(
      v_owner.id,
      'LEAD_SUBMITTED_BY_PARTNER',
      'New lead submitted by a lead referrer',
      'A new lead, ' || btrim(p_business_name) || ', was submitted by a lead referrer.',
      '/leads/' || v_lead::text,
      jsonb_build_object(
        'lead_id', v_lead,
        'lead_referrer_profile_id', v_uid,
        'referral_partner_id', v_parent,
        'attribution_path', case when v_parent is null then 'A' else 'B' end
      )
    );
  end loop;
  return v_lead;
end;
$$;

revoke all on function public.lead_referrer_submit_lead(text, text, text, text, numeric, jsonb) from public, anon;
grant execute on function public.lead_referrer_submit_lead(text, text, text, text, numeric, jsonb) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'user_role' and e.enumlabel = 'lead_referrer'
  ) then
    raise exception 'lead_referrer enum value is required';
  end if;
  if to_regclass('public.partner_lead_referrers') is null then
    raise exception 'partner_lead_referrers is required';
  end if;
  if has_function_privilege('anon', 'public.admin_update_user_role(uuid, public.user_role, uuid)', 'EXECUTE') then
    raise exception 'admin_update_user_role must not be executable by anon';
  end if;
  if has_function_privilege('anon', 'public.lead_referrer_submit_lead(text, text, text, text, numeric, jsonb)', 'EXECUTE') then
    raise exception 'lead_referrer_submit_lead must not be executable by anon';
  end if;
end;
$$;

notify pgrst, 'reload schema';
