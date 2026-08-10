-- Build 74A review follow-up: avoid write blocking on populated profiles.
-- Supabase migration execution must run this file outside an explicit
-- transaction because PostgreSQL CREATE INDEX CONCURRENTLY requires that.

drop index concurrently if exists public.idx_profiles_client_id;

create index concurrently idx_profiles_client_id
  on public.profiles (client_id)
  where client_id is not null;

alter table public.profiles
  validate constraint profiles_client_id_fkey;

do $$
begin
  if not exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'idx_profiles_client_id'
       and i.indisvalid
       and i.indisready
  ) then
    raise exception 'Build 74A: valid client identity index missing';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_client_id_fkey'
       and convalidated
  ) then
    raise exception 'Build 74A: profiles client foreign key is not validated';
  end if;
end;
$$;
