-- LEAD-SUBMIT lane — partner_submit_lead + contractor_submit_lead RPCs.
--
-- Belt-and-braces SECURITY DEFINER: each RPC re-checks the caller's role from
-- profiles (never trusts the client), creates a lead with the caller's
-- attribution set, and notifies every active owner. The lead INSERT fires the
-- existing leads triggers for free — log_activity (activity_logs audit row),
-- leads_cipc_block (duplicate-CIPC hard block, reused). qualification_stage
-- defaults to 'new_lead', so the lead lands in the owner's existing inbox.
--
-- Both return the new lead id. Grants: authenticated only (audit FIX-A posture);
-- anon/public revoked.

-- ---------------------------------------------------------------------------
-- partner_submit_lead
-- ---------------------------------------------------------------------------
create or replace function public.partner_submit_lead(
  p_business_name   text,
  p_contact_name    text,
  p_contact_cell    text default null,
  p_contact_email   text default null,
  p_cipc_number     text default null,
  p_industry_id     uuid default null,
  p_funding_amount  numeric default null,
  p_funding_purpose text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_role         text;
  v_partner_id   uuid;
  v_partner_name text;
  v_partner_slug text;
  v_referred_by  public.lead_referred_by;
  v_lead_id      uuid;
  v_owner        record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select p.role, p.referral_partner_id into v_role, v_partner_id
  from public.profiles p where p.id = v_uid;

  if v_role is distinct from 'partner' then
    raise exception 'Only referral partners can submit partner leads' using errcode = '42501';
  end if;

  -- Required fields (server-side, independent of the form's zod validation).
  if coalesce(btrim(p_business_name), '') = '' then
    raise exception 'Business name is required' using errcode = '22004';
  end if;
  if coalesce(btrim(p_contact_name), '') = '' then
    raise exception 'Contact name is required' using errcode = '22004';
  end if;
  if p_funding_amount is not null and p_funding_amount < 0 then
    raise exception 'Funding amount cannot be negative' using errcode = '22003';
  end if;

  select rp.name, rp.slug into v_partner_name, v_partner_slug
  from public.referral_partners rp where rp.id = v_partner_id;

  -- referred_by is a coarse channel bucket (enum: self | bright_destiny | other).
  -- Bright Destiny is the only contracted partner today; a future partner falls
  -- to 'other'. The authoritative attribution is referral_partner_id +
  -- attributed_to_partner_id, which the owner pipeline + partner_leads_view read.
  v_referred_by := case when v_partner_slug = 'bright_destiny'
                        then 'bright_destiny'::public.lead_referred_by
                        else 'other'::public.lead_referred_by end;

  insert into public.leads (
    business_name, contact_name, contact_cell, contact_email, cipc_number,
    industry_id, funding_amount, initial_notes,
    referred_by, referral_partner_id,
    attributed_to_partner_id, entered_by, qualification_stage
  ) values (
    btrim(p_business_name), btrim(p_contact_name),
    nullif(btrim(p_contact_cell), ''), nullif(btrim(p_contact_email), ''),
    nullif(btrim(p_cipc_number), ''), p_industry_id,
    p_funding_amount, nullif(btrim(p_funding_purpose), ''),
    v_referred_by, v_partner_id,
    v_uid, v_uid, 'new_lead'
  )
  returning id into v_lead_id;

  -- Notify every active owner (emit_in_app_notification chains the email invoke).
  for v_owner in
    select p.id from public.profiles p where p.role = 'owner' and p.is_active
  loop
    perform public.emit_in_app_notification(
      v_owner.id,
      'LEAD_SUBMITTED_BY_PARTNER',
      'New lead submitted',
      'A new lead, ' || btrim(p_business_name) || ', was submitted by '
        || coalesce(v_partner_name, 'a referral partner') || '.',
      '/leads/' || v_lead_id::text,
      jsonb_build_object('lead_id', v_lead_id, 'attributed_to_partner_id', v_uid)
    );
  end loop;

  return v_lead_id;
end;
$$;

revoke all on function public.partner_submit_lead(text, text, text, text, text, uuid, numeric, text)
  from public, anon;
grant execute on function public.partner_submit_lead(text, text, text, text, text, uuid, numeric, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- contractor_submit_lead
-- ---------------------------------------------------------------------------
create or replace function public.contractor_submit_lead(
  p_business_name   text,
  p_contact_name    text,
  p_contact_cell    text default null,
  p_contact_email   text default null,
  p_cipc_number     text default null,
  p_industry_id     uuid default null,
  p_funding_amount  numeric default null,
  p_funding_purpose text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid             uuid := (select auth.uid());
  v_role            text;
  v_contractor_name text;
  v_contractor_mail text;
  v_lead_id         uuid;
  v_owner           record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select p.role, p.full_name, p.email into v_role, v_contractor_name, v_contractor_mail
  from public.profiles p where p.id = v_uid;

  if v_role is distinct from 'contractor' then
    raise exception 'Only contractors can submit contractor leads' using errcode = '42501';
  end if;

  if coalesce(btrim(p_business_name), '') = '' then
    raise exception 'Business name is required' using errcode = '22004';
  end if;
  if coalesce(btrim(p_contact_name), '') = '' then
    raise exception 'Contact name is required' using errcode = '22004';
  end if;
  if p_funding_amount is not null and p_funding_amount < 0 then
    raise exception 'Funding amount cannot be negative' using errcode = '22003';
  end if;

  -- Contractors are FNC's direct team, not a referral channel → referred_by
  -- stays 'self' (there is no contractor enum value); attribution rides on
  -- attributed_to_contractor_id.
  insert into public.leads (
    business_name, contact_name, contact_cell, contact_email, cipc_number,
    industry_id, funding_amount, initial_notes,
    referred_by, attributed_to_contractor_id, entered_by, qualification_stage
  ) values (
    btrim(p_business_name), btrim(p_contact_name),
    nullif(btrim(p_contact_cell), ''), nullif(btrim(p_contact_email), ''),
    nullif(btrim(p_cipc_number), ''), p_industry_id,
    p_funding_amount, nullif(btrim(p_funding_purpose), ''),
    'self'::public.lead_referred_by, v_uid, v_uid, 'new_lead'
  )
  returning id into v_lead_id;

  for v_owner in
    select p.id from public.profiles p where p.role = 'owner' and p.is_active
  loop
    perform public.emit_in_app_notification(
      v_owner.id,
      'LEAD_SUBMITTED_BY_CONTRACTOR',
      'New lead submitted',
      'A new lead, ' || btrim(p_business_name) || ', was submitted by '
        || coalesce(nullif(btrim(v_contractor_name), ''), v_contractor_mail, 'a contractor') || '.',
      '/leads/' || v_lead_id::text,
      jsonb_build_object('lead_id', v_lead_id, 'attributed_to_contractor_id', v_uid)
    );
  end loop;

  return v_lead_id;
end;
$$;

revoke all on function public.contractor_submit_lead(text, text, text, text, text, uuid, numeric, text)
  from public, anon;
grant execute on function public.contractor_submit_lead(text, text, text, text, text, uuid, numeric, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  -- both RPCs exist
  if to_regprocedure('public.partner_submit_lead(text,text,text,text,text,uuid,numeric,text)') is null then
    raise exception 'partner_submit_lead not created';
  end if;
  if to_regprocedure('public.contractor_submit_lead(text,text,text,text,text,uuid,numeric,text)') is null then
    raise exception 'contractor_submit_lead not created';
  end if;

  -- grants: authenticated yes, anon no
  if not has_function_privilege('authenticated',
      'public.partner_submit_lead(text,text,text,text,text,uuid,numeric,text)', 'execute') then
    raise exception 'partner_submit_lead not executable by authenticated';
  end if;
  if has_function_privilege('anon',
      'public.partner_submit_lead(text,text,text,text,text,uuid,numeric,text)', 'execute') then
    raise exception 'partner_submit_lead must not be executable by anon';
  end if;
  if not has_function_privilege('authenticated',
      'public.contractor_submit_lead(text,text,text,text,text,uuid,numeric,text)', 'execute') then
    raise exception 'contractor_submit_lead not executable by authenticated';
  end if;
  if has_function_privilege('anon',
      'public.contractor_submit_lead(text,text,text,text,text,uuid,numeric,text)', 'execute') then
    raise exception 'contractor_submit_lead must not be executable by anon';
  end if;
end $$;
