-- Fix: Team invites failed with "Database error creating new user" (owner report, 17 Oct 2026).
--
-- Supabase Auth inserts the auth.users row BEFORE it applies the app_metadata the admin API was given, so
-- at insert time raw_app_meta_data has no 'role'. handle_new_user() then raised "Auth users require a
-- service-assigned app_metadata.role" and the whole createUser call failed. Client accounts still worked
-- only because their role is found from the pending quick invitation by email.
--
-- Change: when no role can be resolved at insert, create no profile and let the caller provision it. The
-- admin-invite-user Edge Function already upserts the profile (with the role) with the service role right
-- after createUser. An auth user with no profile has no access anywhere (every policy and RPC keys on the
-- profile), so this keeps the old guarantee that nobody gets a role they were not given by the service.
-- Everything else in the function is unchanged.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_role public.user_role;
  v_partner_id uuid;
  v_client_id uuid;
  v_quick_client_count integer := 0;
  v_rows integer;
begin
  v_role := nullif(new.raw_app_meta_data ->> 'role', '')::public.user_role;

  if v_role is null and nullif(lower(btrim(new.email)), '') is not null then
    select count(distinct qi.client_id)::integer, min(qi.client_id::text)::uuid
      into v_quick_client_count, v_client_id
      from public.client_quick_invitations qi
     where lower(btrim(qi.contact_email)) = lower(btrim(new.email))
       and qi.status = 'pending';

    if v_quick_client_count = 1 then
      v_role := 'client'::public.user_role;
    elsif v_quick_client_count > 1 then
      raise exception 'Quick client invitation is ambiguous';
    end if;
  end if;

  -- No role yet: the service that created the user provisions the profile itself (see header).
  if v_role is null then
    return new;
  end if;

  if v_role = 'partner'::public.user_role then
    v_partner_id := nullif(new.raw_app_meta_data ->> 'referral_partner_id', '')::uuid;
  end if;

  if v_role = 'client'::public.user_role then
    v_client_id := coalesce(v_client_id, nullif(new.raw_app_meta_data ->> 'client_id', '')::uuid);
    if v_client_id is null then
      raise exception 'Client auth users require app_metadata.client_id';
    end if;
  end if;

  insert into public.profiles
    (id, email, full_name, role, referral_partner_id, client_id)
  values (
    new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''),
    v_role, v_partner_id, v_client_id
  )
  on conflict (id) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 1 and v_role = 'client'::public.user_role then
    insert into public.activity_logs (
      user_id, user_email, user_role, event_type, entity_type, entity_id,
      description, after_values, related_entity_ids
    ) values (
      new.id, new.email, 'client', 'CREATE', 'profile', new.id,
      'Client portal profile provisioned',
      jsonb_build_object('role', 'client', 'client_id', v_client_id),
      jsonb_build_array(v_client_id)
    );
  end if;

  return new;
end;
$function$;
