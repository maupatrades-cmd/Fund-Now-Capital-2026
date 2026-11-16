-- Sub-agents (role lead_referrer) can attach documents to the leads they submitted (launch fix, 16 Nov 2026).
--
-- lead_referrer_submit_lead stamps leads.attributed_to_lead_referrer_id, but caller_owns_lead only recognised partners
-- and contractors, so the documents + storage submitter policies (documents_lead_submitter_read/_insert,
-- documents_bucket_submitter_insert/_delete) refused every sub-agent upload. This adds the lead_referrer branch and
-- changes nothing else: the same SECURITY DEFINER helper, the same current-role guard (revoking the role revokes
-- document access at once), the same grants. The policies themselves are unchanged, so a sub-agent gets exactly the
-- partner/contractor rules: insert only into their own lead's folder with uploaded_by = themselves, and never read back
-- PII-class documents (bank statements and the other financial types stay owner-only, CLAUDE.md rule 7).
-- The calendar helpers that also call caller_owns_lead now let a sub-agent reference their own lead's deal/client,
-- which they could already do for the lead itself through entered_by/attribution.
create or replace function public.caller_owns_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.leads l
    join public.profiles p on p.id = (select auth.uid())
    where l.id = p_lead_id
      and (
        (p.role = 'partner' and l.attributed_to_partner_id = p.id)
        or (p.role = 'contractor' and l.attributed_to_contractor_id = p.id)
        or (p.role = 'lead_referrer' and l.attributed_to_lead_referrer_id = p.id)
      )
  );
$$;

revoke all on function public.caller_owns_lead(uuid) from public, anon;
grant execute on function public.caller_owns_lead(uuid) to authenticated;
