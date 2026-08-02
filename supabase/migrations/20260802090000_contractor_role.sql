-- ============================================================================
-- CONTRACTOR ROLE — add 'contractor' to the user_role enum
-- ============================================================================
-- CONTRACTOR.md Phase 1 foundation: FNC's direct contractors log in through the
-- same Supabase-native auth as the owner and referral partners (CLAUDE.md
-- security rule 1). Role storage mechanism (verified against live schema
-- 2026-08-02): profiles.role is public.user_role ('owner' | 'partner'),
-- populated by the handle_new_user auth trigger from raw_user_meta_data->>'role'
-- with a 'partner' fallback. This migration extends that same mechanism —
-- no new table, no new RPC, no grant changes:
--   * handle_new_user already casts any valid user_role label, so the owner
--     creates a contractor by setting user metadata role = 'contractor'
--     (public signup stays OFF — CLAUDE.md rule 4).
--   * The frontend reads the role through the existing profiles_select_own
--     RLS policy (id = auth.uid()) — no new surface area.
--   * Data isolation needs no new policy: every partner-facing surface scopes
--     via current_partner_id() (NULL for contractors — profiles.referral_partner_id
--     is only set for partners) and everything else is is_owner(), so a
--     contractor sees no CRM data at all until later contractor-scoped
--     policies are deliberately added (POPIA cross-role isolation by default).
--
-- ADD VALUE is safe inside the migration transaction on PG 12+ because the
-- enum type predates this transaction; the assertion below only reads the
-- pg_enum catalog as text, never *uses* the new value (which would be the
-- unsafe-in-same-transaction operation).

alter type public.user_role add value if not exists 'contractor';

comment on type public.user_role is
  'Application role on profiles.role: owner (Thapelo — full CRM), partner (referral partner, e.g. Bright Destiny — Phase D portal), contractor (FNC direct contractor — contractor portal).';

-- ---------------------------------------------------------------------------
-- Harden current_partner_id(): only a 'partner' role may resolve a partner id
-- (Macroscope PR #101 finding, owner-approved). Without the role guard, a
-- partner converted to contractor who kept a stale referral_partner_id would
-- still satisfy every partner-scoped RLS policy/view. The guard makes
-- "contractor = zero data access" structural instead of relying on the
-- column being NULL. Zero behaviour change for the three live profiles
-- (owner + test contractor have NULL partner ids; Doctor is role 'partner'),
-- and it matches partner_profile_id(), which already filters role = 'partner'.
-- CREATE OR REPLACE preserves the FIX-A grant matrix (authenticated-only);
-- signature, STABLE SECURITY DEFINER, and the pinned empty search_path are
-- kept verbatim from the live definition.
create or replace function public.current_partner_id()
returns uuid
language sql
stable security definer
set search_path = ''
as $$
  select p.referral_partner_id
    from public.profiles p
   where p.id = (select auth.uid())
     and p.role = 'partner';
$$;

-- ---------------------------------------------------------------------------
-- Assertions (belt-and-braces): fail loudly if the enum is not exactly the
-- three expected labels, if the contractor label somehow carries data
-- access it should not have yet, or if the role guard didn't land.
-- ---------------------------------------------------------------------------
do $$
declare
  v_labels text[];
begin
  select array_agg(e.enumlabel order by e.enumsortorder)
    into v_labels
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typname = 'user_role';

  if v_labels is distinct from array['owner', 'partner', 'contractor'] then
    raise exception 'user_role enum labels unexpected: %', v_labels;
  end if;

  -- No RLS policy anywhere may reference the contractor role yet — this PR
  -- grants the role zero data access by design (later PRs add deliberate,
  -- reviewed contractor-scoped policies).
  if exists (
    select 1
      from pg_policies
     where qual ilike '%contractor%'
        or with_check ilike '%contractor%'
  ) then
    raise exception 'unexpected RLS policy referencing contractor role';
  end if;

  -- The partner-id resolver must carry the role guard.
  if position('role = ''partner''' in
       pg_get_functiondef('public.current_partner_id()'::regprocedure)) = 0 then
    raise exception 'current_partner_id() is missing the role = partner guard';
  end if;
end;
$$;
