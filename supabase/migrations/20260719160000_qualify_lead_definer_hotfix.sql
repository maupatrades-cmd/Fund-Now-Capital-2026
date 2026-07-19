-- B3.2 hotfix — qualify_lead must run SECURITY DEFINER.
--
-- Bug: B3.2 (PR #47) shipped qualify_lead as SECURITY INVOKER. Its override
-- branch calls public.log_qualification_override(), whose EXECUTE is deliberately
-- revoked from authenticated/anon/public (it is an internal, DEFINER-only audit
-- writer). Under INVOKER, qualify_lead runs as `authenticated`, so that internal
-- call fails the EXECUTE check → 42501 insufficient_privilege → HTTP 403. The
-- happy path never touches the helper, so only the override-with-missing-
-- categories flow 403s. Caught by the owner's B3.2 smoke test (Test 1, override
-- flow) before real workflow use.
--
-- Fix: qualify_lead is the trusted orchestrator — already gated by is_owner() at
-- entry — so it should be SECURITY DEFINER. As definer, its internal call to the
-- locked-down helper succeeds while the helper stays uncallable by any API role
-- directly. No privilege escalation: is_owner() remains the entry gate, and
-- auth.uid() under DEFINER still returns the real caller, so created_by
-- attribution stays honest. search_path = '' is safe — the body already
-- schema-qualifies every reference (public./auth.).
--
-- Body is re-declared byte-for-byte from 20260719120100; only the SECURITY
-- DEFINER + SET search_path header and the explicit grant hygiene are new.

create or replace function public.qualify_lead(p_lead_id uuid, p_override boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lead      public.leads;
  v_client_id uuid;
  v_deal_id   uuid;
  v_missing   text[];
begin
  if not public.is_owner() then
    raise exception 'Only the owner can qualify leads';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found';
  end if;

  if v_lead.qualification_stage = 'qualified' then
    select id into v_deal_id from public.deals where lead_id = p_lead_id limit 1;
    return v_deal_id;  -- idempotent
  end if;

  -- Document verification gate (B3.2). Required *accepted* current documents by
  -- category. Blocks by default; an explicit owner override proceeds and logs.
  v_missing := public.lead_required_docs_missing(p_lead_id);
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    if not p_override then
      raise exception 'Cannot qualify — missing required accepted documents: %', array_to_string(v_missing, '; ')
        using errcode = 'P0001';
    else
      perform public.log_qualification_override(p_lead_id, v_missing);
    end if;
  end if;

  select id into v_client_id
  from public.clients
  where lower(business_name) = lower(v_lead.business_name)
  limit 1;

  if v_client_id is null then
    insert into public.clients
      (business_name, cipc_number, industry_id, sub_industry_id, sector_notes,
       address, referral_partner_id, created_by)
    values
      (v_lead.business_name, v_lead.cipc_number, v_lead.industry_id, v_lead.sub_industry_id,
       v_lead.sector_notes, v_lead.physical_address, v_lead.referral_partner_id, auth.uid())
    returning id into v_client_id;

    insert into public.client_contacts
      (client_id, full_name, email, phone, position, id_number, is_primary_director)
    values
      (v_client_id, v_lead.contact_name, v_lead.contact_email, v_lead.contact_cell,
       v_lead.contact_role, v_lead.contact_id_number, true);
  end if;

  insert into public.deals
    (client_id, lead_id, referral_partner_id, stage, amount_requested,
     funding_purpose, funding_timeline, created_by)
  values
    (v_client_id, p_lead_id, v_lead.referral_partner_id, 'qualifying', v_lead.funding_amount,
     v_lead.funding_purpose, v_lead.funding_timeline, auth.uid())
  returning id into v_deal_id;

  -- Re-point the lead's documents to the new/matched client. Single UPDATE so the
  -- num_nonnulls(lead_id, client_id) = 1 CHECK holds through the swap; the
  -- physical storage bytes stay at their original leads/{id}/... path (RLS is
  -- keyed on the uploader, not the path) — a physical move is deferred (ROADMAP).
  update public.documents
     set client_id = v_client_id, lead_id = null
   where lead_id = p_lead_id;

  update public.leads set qualification_stage = 'qualified' where id = p_lead_id;

  return v_deal_id;
end;
$function$;

-- Explicit grant hygiene: keep authenticated as the only API-role that can
-- execute. Supabase auto-grants EXECUTE to anon, authenticated AND service_role
-- explicitly on every new public function (plus the PUBLIC default), so a bare
-- `revoke from public` leaves the explicit anon grant in place. Revoke from
-- public AND anon (mirrors the log_qualification_override lockdown, which revokes
-- from public, anon, authenticated). service_role is left untouched — the trusted
-- backend role, same as that precedent — and is not asserted below.
revoke all on function public.qualify_lead(uuid, boolean) from public, anon;
grant execute on function public.qualify_lead(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions: security_type is DEFINER and the grant matrix is exactly
-- { authenticated } — not anon, not PUBLIC. RAISEs (rolls the migration back)
-- on any mismatch.
-- ---------------------------------------------------------------------------
do $$
begin
  if not (select p.prosecdef from pg_proc p
            where p.oid = 'public.qualify_lead(uuid, boolean)'::regprocedure) then
    raise exception 'qualify_lead is not SECURITY DEFINER';
  end if;

  if not has_function_privilege('authenticated', 'public.qualify_lead(uuid, boolean)', 'execute') then
    raise exception 'authenticated cannot execute qualify_lead';
  end if;

  if has_function_privilege('anon', 'public.qualify_lead(uuid, boolean)', 'execute') then
    raise exception 'anon can execute qualify_lead (should not)';
  end if;

  if exists (
    select 1 from pg_proc p
    cross join lateral aclexplode(p.proacl) a
    where p.oid = 'public.qualify_lead(uuid, boolean)'::regprocedure
      and a.grantee = 0                    -- 0 = PUBLIC
      and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'qualify_lead still grants EXECUTE to PUBLIC';
  end if;

  raise notice 'qualify_lead hotfix assertions passed (DEFINER + grant matrix { authenticated }).';
end $$;
