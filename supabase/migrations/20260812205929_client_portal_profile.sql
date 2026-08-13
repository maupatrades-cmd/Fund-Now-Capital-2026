-- Client portal profile: narrow self-service contact/business corrections.
-- Canonical application answers, identity, attribution and financial fields are intentionally untouched.

create or replace function public.client_portal_profile_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_client_id uuid;
  v_result jsonb;
begin
  select p.client_id into v_client_id
  from public.profiles p
  where p.id = v_uid and p.role = 'client'::public.user_role and p.is_active;
  if v_client_id is null then raise exception 'Active linked client account required' using errcode = '42501'; end if;

  select jsonb_build_object(
    'client_id', c.id,
    'business_name', c.business_name,
    'cipc_number', c.cipc_number,
    'sector', c.sector,
    'address', c.address,
    'contact', coalesce((
      select jsonb_build_object('id', cc.id, 'full_name', cc.full_name, 'email', cc.email,
        'phone', cc.phone, 'position', cc.position)
      from public.client_contacts cc
      where cc.client_id = c.id and cc.is_primary_director
      order by cc.created_at limit 1
    ), '{}'::jsonb)
  ) into v_result
  from public.clients c where c.id = v_client_id;
  if v_result is null then raise exception 'Linked client record not found' using errcode = 'P0002'; end if;
  return v_result;
end;
$$;

create or replace function public.update_client_portal_profile(
  p_business_name text,
  p_sector text,
  p_address text,
  p_contact_name text,
  p_contact_phone text,
  p_contact_email text,
  p_contact_position text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_client_id uuid;
  v_contact_id uuid;
  v_contact_before jsonb;
  v_before jsonb;
  v_after jsonb;
  v_changed text[] := array[]::text[];
begin
  select p.client_id into v_client_id from public.profiles p
  where p.id = v_uid and p.role = 'client'::public.user_role and p.is_active;
  if v_client_id is null then raise exception 'Active linked client account required' using errcode = '42501'; end if;
  if nullif(btrim(p_business_name), '') is null then raise exception 'Business name is required' using errcode = '22023'; end if;
  if nullif(btrim(p_contact_name), '') is null then raise exception 'Contact name is required' using errcode = '22023'; end if;
  if p_contact_email is not null and btrim(p_contact_email) <> '' and lower(btrim(p_contact_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    then raise exception 'Enter a valid email address' using errcode = '22023'; end if;

  select jsonb_build_object('business_name', c.business_name, 'sector', c.sector, 'address', c.address)
    into v_before from public.clients c where c.id = v_client_id for update;
  if v_before is null then raise exception 'Linked client record not found' using errcode = 'P0002'; end if;

  if v_before->>'business_name' is distinct from btrim(p_business_name) then v_changed := array_append(v_changed, 'business_name'); end if;
  if v_before->>'sector' is distinct from nullif(btrim(p_sector), '') then v_changed := array_append(v_changed, 'sector'); end if;
  if v_before->>'address' is distinct from nullif(btrim(p_address), '') then v_changed := array_append(v_changed, 'address'); end if;

  if cardinality(v_changed) > 0 then
    update public.clients set business_name=btrim(p_business_name), sector=nullif(btrim(p_sector), ''),
      address=nullif(btrim(p_address), ''), updated_at=now() where id=v_client_id;
  end if;

  select cc.id, jsonb_build_object(
      'full_name', cc.full_name,
      'email', cc.email,
      'phone', cc.phone,
      'position', cc.position
    ) into v_contact_id, v_contact_before from public.client_contacts cc
  where cc.client_id=v_client_id and cc.is_primary_director order by cc.created_at limit 1 for update;
  if v_contact_id is null then
    insert into public.client_contacts(client_id,full_name,email,phone,position,is_primary_director)
    values(v_client_id,btrim(p_contact_name),nullif(lower(btrim(p_contact_email)),''),nullif(btrim(p_contact_phone),''),nullif(btrim(p_contact_position),''),true)
    returning id into v_contact_id;
    v_changed := array_append(v_changed, 'primary_contact');
  elsif v_contact_before is distinct from jsonb_build_object(
      'full_name', btrim(p_contact_name),
      'email', nullif(lower(btrim(p_contact_email)),''),
      'phone', nullif(btrim(p_contact_phone),''),
      'position', nullif(btrim(p_contact_position),'')
    ) then
    update public.client_contacts set full_name=btrim(p_contact_name), email=nullif(lower(btrim(p_contact_email)),''),
      phone=nullif(btrim(p_contact_phone),''), position=nullif(btrim(p_contact_position),''), updated_at=now()
    where id=v_contact_id;
    v_changed := array_append(v_changed, 'primary_contact');
  end if;

  v_after := public.client_portal_profile_workspace();
  if cardinality(v_changed) > 0 then
    insert into public.activity_logs(user_id,user_email,user_role,event_type,entity_type,entity_id,description,changed_fields,before_values,after_values,related_entity_ids)
    select v_uid,p.email,'client','UPDATE','client',v_client_id,'Client updated permitted portal profile fields',
      to_jsonb(v_changed),v_before,v_after,jsonb_build_array(v_client_id,v_contact_id)
    from public.profiles p where p.id=v_uid;
  end if;
  return v_after;
end;
$$;

revoke all on function public.client_portal_profile_workspace() from public, anon;
revoke all on function public.update_client_portal_profile(text,text,text,text,text,text,text) from public, anon;
grant execute on function public.client_portal_profile_workspace() to authenticated;
grant execute on function public.update_client_portal_profile(text,text,text,text,text,text,text) to authenticated;

comment on function public.update_client_portal_profile(text,text,text,text,text,text,text) is
  'Client-only correction endpoint. Never changes CIPC identity, role, attribution, funding, financial or canonical application fields.';

do $$ begin
  if has_function_privilege('anon','public.update_client_portal_profile(text,text,text,text,text,text,text)','EXECUTE') then
    raise exception 'anon may execute client profile update';
  end if;
end $$;
