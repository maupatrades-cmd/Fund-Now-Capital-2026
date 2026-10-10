-- Staff build, Batch 4: names of enabled staff so the Coordinator can pick an operational assignee.
-- Names and roles only; no contact, salary or contract data.
create or replace function public.staff_assignable_staff()
returns table (profile_id uuid, full_name text, staff_role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.intake_require_actor(array['owner', 'coordinator']);
  return query
    select s.profile_id, p.full_name, s.staff_role::text
      from public.staff_access s join public.profiles p on p.id = s.profile_id
     where s.access_enabled and p.is_active and p.role = s.staff_role
     order by p.full_name;
end;
$$;
revoke all on function public.staff_assignable_staff() from public, anon;
grant execute on function public.staff_assignable_staff() to authenticated;
