-- Auto-create a profile row whenever a new auth user is created.
--
-- New users are owner-invited only (public signup is OFF, security rule #4).
-- Role defaults to 'partner' (least privilege). An owner invite can set
--   raw_user_meta_data = { "role": "owner" }  or
--   raw_user_meta_data = { "role": "partner", "referral_partner_id": "<uuid>" }
-- to pre-assign. The very first owner is created in the Supabase dashboard and
-- then elevated once (see supabase/README.md).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role, referral_partner_id)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'partner'),
    nullif(new.raw_user_meta_data ->> 'referral_partner_id', '')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
