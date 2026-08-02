-- ============================================================================
-- TEAM MANAGEMENT — admin_update_user_role RPC
-- ============================================================================
-- Owner-facing Team Management (invite / list / edit / deactivate people) needs
-- a safe way to change a user's role from the CRM UI instead of hand-written SQL
-- in the Supabase dashboard. This RPC is the "Edit Role" backend.
--
-- Design mirrors set_document_verification() (the canonical owner-guarded
-- DEFINER RPC that writes its own activity_logs row):
--   * SECURITY DEFINER + SET search_path = '' (CLAUDE.md non-negotiable style).
--   * is_owner() gate at entry — auth.uid() under DEFINER is still the caller,
--     so attribution stays honest and there is no privilege escalation.
--   * mutation uses RETURNING ... INTO + a FOUND check so a silent RLS/no-op
--     surfaces loudly (CLAUDE.md silent-RLS rule).
--   * writes a PERMISSION_CHANGE activity_logs row with before/after values.
--   * belt-and-braces grant matrix: EXECUTE for authenticated only, never
--     anon/PUBLIC (audit FIX-A rule).
--
-- SAFETY FIX (mirrors the contractor-role migration's current_partner_id role
-- guard): referral_partner_id is meaningful ONLY for a 'partner'. When a user
-- is moved to any non-partner role (contractor/owner) this RPC CLEARS
-- referral_partner_id, so a converted user can never satisfy a partner-scoped
-- RLS policy/view via a stale id. This makes "non-partner = no partner data"
-- structural at write-time, complementing the read-time role guard.
--
-- The owner role is deliberately NOT assignable through this path (nor the UI):
-- the owner account is provisioned out-of-band. The RPC also refuses to modify
-- an existing owner row, so the sole owner can never be demoted here.

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
  v_email                text;
  v_role                 text;
  v_old                  public.profiles;
  v_new                  public.profiles;
  v_effective_partner_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change user roles';
  end if;

  -- The owner role is never assignable through user management.
  if p_new_role = 'owner' then
    raise exception 'The owner role cannot be assigned through user management';
  end if;

  select * into v_old from public.profiles where id = p_user_id;
  if not found then
    raise exception 'User profile not found';
  end if;

  -- Never alter an owner account here (protects the sole owner from demotion).
  if v_old.role = 'owner' then
    raise exception 'The owner account cannot be modified through user management';
  end if;

  -- Safety fix: only a partner keeps a referral_partner_id; any non-partner
  -- role has it cleared.
  if p_new_role = 'partner' then
    v_effective_partner_id := p_new_referral_partner_id;
    -- Validate the referral partner exists when one is supplied (the FK would
    -- catch this too, but a clear message beats a raw 23503).
    if v_effective_partner_id is not null
       and not exists (select 1 from public.referral_partners rp where rp.id = v_effective_partner_id) then
      raise exception 'Referral partner not found';
    end if;
  else
    v_effective_partner_id := null;
  end if;

  update public.profiles
     set role                = p_new_role,
         referral_partner_id = v_effective_partner_id,
         updated_at          = now()
   where id = p_user_id
   returning * into v_new;
  if not found then
    raise exception 'Role update affected no rows';  -- surfaces a silent RLS/no-op loudly
  end if;

  -- Audit trail (POPIA: every user-management action is logged). Attribution is
  -- the calling owner, entity is the affected profile.
  select email, role into v_email, v_role from public.profiles where id = v_uid;
  insert into public.activity_logs
    (user_id, user_email, user_role, event_type, entity_type, entity_id, description,
     changed_fields, before_values, after_values)
  values
    (v_uid, v_email, v_role, 'PERMISSION_CHANGE', 'profile', p_user_id,
     'User role changed from ' || v_old.role || ' to ' || v_new.role,
     jsonb_build_array('role', 'referral_partner_id'),
     jsonb_build_object('role', v_old.role, 'referral_partner_id', v_old.referral_partner_id),
     jsonb_build_object('role', v_new.role, 'referral_partner_id', v_new.referral_partner_id));

  return p_user_id;
end;
$$;

-- Grant matrix (audit FIX-A): authenticated only; never anon/PUBLIC. Every
-- .rpc() call site sits behind OwnerGate and the is_owner() gate is the real
-- authorization backstop.
revoke execute on function public.admin_update_user_role(uuid, public.user_role, uuid) from public;
revoke execute on function public.admin_update_user_role(uuid, public.user_role, uuid) from anon;
grant  execute on function public.admin_update_user_role(uuid, public.user_role, uuid) to authenticated;

comment on function public.admin_update_user_role(uuid, public.user_role, uuid) is
  'Owner-only (is_owner) role change for a profile. Clears referral_partner_id for non-partner roles; refuses to assign or modify the owner role; writes a PERMISSION_CHANGE activity_logs row. Team Management "Edit Role".';

-- ---------------------------------------------------------------------------
-- Self-check assertions — RAISE (rolling the migration back) on failure.
-- ---------------------------------------------------------------------------
do $$
begin
  -- authenticated must hold EXECUTE.
  if not exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'admin_update_user_role'
       and grantee = 'authenticated' and privilege_type = 'EXECUTE'
  ) then
    raise exception 'admin_update_user_role: authenticated is missing EXECUTE';
  end if;

  -- anon/PUBLIC must hold NO EXECUTE.
  if exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'admin_update_user_role'
       and grantee in ('anon', 'PUBLIC') and privilege_type = 'EXECUTE'
  ) then
    raise exception 'admin_update_user_role: anon/PUBLIC still hold EXECUTE';
  end if;

  -- search_path must be pinned.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'admin_update_user_role'
       and p.proconfig::text like '%search_path=%'
  ) then
    raise exception 'admin_update_user_role: search_path is not pinned';
  end if;
end;
$$;
