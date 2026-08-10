-- Build 74A: add the client authentication role as an isolated enum step.
-- The following migration uses this value after this migration commits.

alter type public.user_role add value if not exists 'client';

comment on type public.user_role is
  'Application roles for FNC owner, referral partners, contractors, and funding clients. Client access is scoped through profiles.client_id.';

do $$
begin
  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      join pg_enum e on e.enumtypid = t.oid
     where n.nspname = 'public'
       and t.typname = 'user_role'
       and e.enumlabel = 'client'
  ) then
    raise exception 'Build 74A: user_role.client was not created';
  end if;
end;
$$;