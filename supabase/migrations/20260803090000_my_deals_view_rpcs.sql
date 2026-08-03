-- MY-DEALS-VIEW-SHELL lane — read-only "My Deals" RPCs for the partner + contractor portals.
--
-- Real problem: a referral partner (Doctor / Bright Destiny) and an FNC
-- contractor each need to see the deals that grew out of the leads THEY
-- referred, with a partner-safe status and an anonymised funder name — nothing
-- more. No earnings/commission figures here (those land in a follow-up PR once
-- the PICKER-BACKEND commission columns merge).
--
-- Linkage note (verified against live schema 2026-08-03, NOT guessed):
--   * `deals` carries NO submitter-attribution column — only `referral_partner_id`
--     (→ referral_partners.id, and contractors have no referral_partner at all).
--   * Submitter attribution lives on `leads.attributed_to_partner_id` /
--     `attributed_to_contractor_id` (= auth.uid()), set by the LEAD-SUBMIT flow
--     (PR #104). A deal points back to its originating lead via `deals.lead_id`
--     (set by qualify_lead).
--   So the only POPIA-correct, role-uniform path from a submitter to "their"
--   deals is deals.lead_id → leads.attributed_to_{partner,contractor}_id.
--   An INNER JOIN on leads means a legacy deal with no lead (DEAL-001) is
--   correctly invisible to every partner/contractor.
--
-- Belt-and-braces SECURITY DEFINER: each RPC re-checks the caller's role +
-- is_active from profiles and filters strictly on auth.uid(), so a partner can
-- never see a contractor's deals and vice-versa, regardless of RLS. Read-only
-- (STABLE, no writes). Grants: authenticated + service_role only; anon/public
-- revoked (audit FIX-A posture).
--
-- Funder anonymisation: funder_display_name(funder_id, recipient) already
-- returns display_name_for_partner for any non-owner recipient, so the real
-- funder identity never leaves the database for a partner/contractor caller.

-- ---------------------------------------------------------------------------
-- partner_list_own_deals
-- ---------------------------------------------------------------------------
create or replace function public.partner_list_own_deals()
returns table (
  deal_id               uuid,
  deal_reference        text,
  client_business_name  text,
  current_stage         text,
  anonymized_funder_name text,
  submitted_at          timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_role   text;
  v_active boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select p.role, p.is_active into v_role, v_active
  from public.profiles p where p.id = v_uid;

  if v_role is distinct from 'partner' then
    raise exception 'Only referral partners can list partner deals' using errcode = '42501';
  end if;
  if not coalesce(v_active, false) then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;

  return query
  select
    d.id,
    d.reference,
    c.business_name,
    d.stage::text,
    -- recipient = the partner caller, so this resolves to the fictional name only
    public.funder_display_name(d.awarded_funder_id, v_uid),
    -- "submitted" = when the partner submitted the originating lead
    l.created_at
  from public.deals d
  join public.leads   l on l.id = d.lead_id
  join public.clients c on c.id = d.client_id
  where l.attributed_to_partner_id = v_uid
  order by l.created_at desc;
end;
$$;

revoke all on function public.partner_list_own_deals() from public, anon;
grant execute on function public.partner_list_own_deals() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- contractor_list_own_deals
-- ---------------------------------------------------------------------------
create or replace function public.contractor_list_own_deals()
returns table (
  deal_id               uuid,
  deal_reference        text,
  client_business_name  text,
  current_stage         text,
  anonymized_funder_name text,
  submitted_at          timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_role   text;
  v_active boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select p.role, p.is_active into v_role, v_active
  from public.profiles p where p.id = v_uid;

  if v_role is distinct from 'contractor' then
    raise exception 'Only contractors can list contractor deals' using errcode = '42501';
  end if;
  if not coalesce(v_active, false) then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;

  return query
  select
    d.id,
    d.reference,
    c.business_name,
    d.stage::text,
    public.funder_display_name(d.awarded_funder_id, v_uid),
    l.created_at
  from public.deals d
  join public.leads   l on l.id = d.lead_id
  join public.clients c on c.id = d.client_id
  where l.attributed_to_contractor_id = v_uid
  order by l.created_at desc;
end;
$$;

revoke all on function public.contractor_list_own_deals() from public, anon;
grant execute on function public.contractor_list_own_deals() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  -- both RPCs exist
  if to_regprocedure('public.partner_list_own_deals()') is null then
    raise exception 'partner_list_own_deals not created';
  end if;
  if to_regprocedure('public.contractor_list_own_deals()') is null then
    raise exception 'contractor_list_own_deals not created';
  end if;

  -- SECURITY DEFINER on both
  if not exists (
    select 1 from pg_proc where oid = 'public.partner_list_own_deals()'::regprocedure and prosecdef
  ) then
    raise exception 'partner_list_own_deals must be SECURITY DEFINER';
  end if;
  if not exists (
    select 1 from pg_proc where oid = 'public.contractor_list_own_deals()'::regprocedure and prosecdef
  ) then
    raise exception 'contractor_list_own_deals must be SECURITY DEFINER';
  end if;

  -- grants: authenticated yes, anon no
  if not has_function_privilege('authenticated', 'public.partner_list_own_deals()', 'execute') then
    raise exception 'partner_list_own_deals not executable by authenticated';
  end if;
  if has_function_privilege('anon', 'public.partner_list_own_deals()', 'execute') then
    raise exception 'partner_list_own_deals must not be executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.contractor_list_own_deals()', 'execute') then
    raise exception 'contractor_list_own_deals not executable by authenticated';
  end if;
  if has_function_privilege('anon', 'public.contractor_list_own_deals()', 'execute') then
    raise exception 'contractor_list_own_deals must not be executable by anon';
  end if;
end $$;
