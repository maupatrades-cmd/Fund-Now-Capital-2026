-- Owner Terms administration: narrow write RPCs for the existing framework.
-- The acceptance ledger remains immutable and is not exposed by these functions.

create or replace function public.owner_save_terms_version(
  p_id uuid,
  p_version_number text,
  p_effective_date date,
  p_content_markdown text
)
returns public.terms_versions
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.terms_versions;
begin
  if v_uid is null or not exists (
    select 1 from public.profiles
    where id = v_uid and role = 'owner' and is_active
  ) then
    raise exception 'Only an active owner may manage Terms & Conditions' using errcode = '42501';
  end if;

  if nullif(btrim(p_version_number), '') is null then
    raise exception 'Version number is required';
  end if;
  if p_effective_date is null then
    raise exception 'Effective date is required';
  end if;
  if length(btrim(coalesce(p_content_markdown, ''))) < 20 then
    raise exception 'Terms content is too short';
  end if;

  if p_id is null then
    insert into public.terms_versions (
      version_number, effective_date, content_markdown, applies_to_roles,
      is_current, created_by
    ) values (
      btrim(p_version_number), p_effective_date, p_content_markdown,
      array['partner','contractor']::public.user_role[], false, v_uid
    ) returning * into v_row;
  else
    update public.terms_versions
       set version_number = btrim(p_version_number),
           effective_date = p_effective_date,
           content_markdown = p_content_markdown
     where id = p_id and not is_current
     returning * into v_row;
    if not found then
      raise exception 'Only a draft Terms version may be edited';
    end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.owner_publish_terms_version(p_id uuid)
returns public.terms_versions
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.terms_versions;
begin
  if v_uid is null or not exists (
    select 1 from public.profiles
    where id = v_uid and role = 'owner' and is_active
  ) then
    raise exception 'Only an active owner may publish Terms & Conditions' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('terms_versions:publish'));
  select * into v_row from public.terms_versions where id = p_id for update;
  if not found then raise exception 'Terms version not found'; end if;
  if v_row.applies_to_roles is distinct from array['partner','contractor']::public.user_role[] then
    raise exception 'Platform Terms must apply to both partner and contractor roles';
  end if;

  update public.terms_versions set is_current = false where is_current and id <> p_id;
  update public.terms_versions set is_current = true where id = p_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.owner_retire_terms_version(p_id uuid)
returns public.terms_versions
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.terms_versions;
begin
  if v_uid is null or not exists (
    select 1 from public.profiles
    where id = v_uid and role = 'owner' and is_active
  ) then
    raise exception 'Only an active owner may retire Terms & Conditions' using errcode = '42501';
  end if;
  update public.terms_versions set is_current = false where id = p_id returning * into v_row;
  if not found then raise exception 'Terms version not found'; end if;
  return v_row;
end;
$$;

revoke all on function public.owner_save_terms_version(uuid,text,date,text) from public, anon;
revoke all on function public.owner_publish_terms_version(uuid) from public, anon;
revoke all on function public.owner_retire_terms_version(uuid) from public, anon;
grant execute on function public.owner_save_terms_version(uuid,text,date,text) to authenticated, service_role;
grant execute on function public.owner_publish_terms_version(uuid) to authenticated, service_role;
grant execute on function public.owner_retire_terms_version(uuid) to authenticated, service_role;

do $$
declare
  v_sig text;
  v_proc regprocedure;
begin
  foreach v_sig in array array[
    'public.owner_save_terms_version(uuid,text,date,text)',
    'public.owner_publish_terms_version(uuid)',
    'public.owner_retire_terms_version(uuid)'
  ] loop
    v_proc := to_regprocedure(v_sig);
    if v_proc is null then raise exception 'assert: missing %', v_sig; end if;
    if not (select prosecdef from pg_proc where oid = v_proc) then
      raise exception 'assert: % must be SECURITY DEFINER', v_sig;
    end if;
    if has_function_privilege('anon', v_proc, 'EXECUTE') then
      raise exception 'assert: anon must not execute %', v_sig;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
