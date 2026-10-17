-- Restrict which submission_intakes columns partners, agents and Team Leaders can read.
-- Row access is unchanged (owner / relationship RLS). Internal intake columns (who handled it,
-- why it was archived, the claimed-agent text, the affiliation snapshot, idempotency key and
-- who created or archived it) are no longer selectable by the authenticated role at all.
-- Staff and the Owner read these through the SECURITY DEFINER staff RPCs, which are unaffected.
-- Checked first: no frontend code, edge function, other RLS policy or view reads this table directly.
revoke select on table public.submission_intakes from authenticated;
grant select (
  lead_id, deal_id, channel, organisation_id, team_id, team_leader_profile_id, agent_profile_id,
  funding_type, workflow_status, first_complete_at, registered_at, archived_at, created_at, updated_at
) on table public.submission_intakes to authenticated;
