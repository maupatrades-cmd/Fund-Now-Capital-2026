-- Client backend PR 9: owner-governed official form mappings and immutable output snapshots.
-- No legal text, funder field names, rates, or templates are seeded here. The owner supplies
-- each approved official template and its mapping through a later governed workflow.

create table public.official_form_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  template_kind text not null check (template_kind in ('fnc', 'funder', 'legal', 'other')),
  funder_id uuid references public.funders(id) on delete restrict,
  version integer not null check (version > 0),
  storage_path text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  is_active boolean not null default true,
  approved_by uuid not null references public.profiles(id) on delete restrict,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (name, version),
  constraint official_form_template_funder_ck check (
    (template_kind = 'funder' and funder_id is not null)
    or (template_kind <> 'funder')
  )
);

create table public.official_form_field_mappings (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.official_form_templates(id) on delete cascade,
  target_field text not null,
  source_scope text not null check (source_scope in ('client', 'primary_contact', 'deal', 'application', 'owner_manual')),
  source_path text not null,
  transform_key text,
  is_required boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (template_id, target_field)
);

create table public.generated_document_snapshots (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.official_form_templates(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  deal_id uuid references public.deals(id) on delete restrict,
  generated_by uuid not null references public.profiles(id) on delete restrict,
  template_name_snapshot text not null,
  template_version_snapshot integer not null check (template_version_snapshot > 0),
  template_sha256_snapshot text not null check (template_sha256_snapshot ~ '^[0-9a-f]{64}$'),
  mapping_snapshot jsonb not null check (jsonb_typeof(mapping_snapshot) = 'array'),
  source_values_snapshot jsonb not null check (jsonb_typeof(source_values_snapshot) = 'object'),
  rendered_storage_path text not null,
  rendered_sha256 text not null check (rendered_sha256 ~ '^[0-9a-f]{64}$'),
  generated_at timestamptz not null default now()
);

create index official_form_templates_active_idx on public.official_form_templates (is_active, template_kind);
create index official_form_field_mappings_template_idx on public.official_form_field_mappings (template_id);
create index generated_document_snapshots_client_idx on public.generated_document_snapshots (client_id, generated_at desc);
create index generated_document_snapshots_deal_idx on public.generated_document_snapshots (deal_id, generated_at desc) where deal_id is not null;

alter table public.official_form_templates enable row level security;
alter table public.official_form_field_mappings enable row level security;
alter table public.generated_document_snapshots enable row level security;
revoke all on table public.official_form_templates, public.official_form_field_mappings,
  public.generated_document_snapshots from public, anon, authenticated;
grant select on table public.official_form_templates, public.official_form_field_mappings,
  public.generated_document_snapshots to authenticated;

create policy official_form_templates_owner_read on public.official_form_templates
  for select to authenticated using (public.is_owner());
create policy official_form_field_mappings_owner_read on public.official_form_field_mappings
  for select to authenticated using (public.is_owner());
create policy generated_document_snapshots_owner_read on public.generated_document_snapshots
  for select to authenticated using (public.is_owner());
create policy generated_document_snapshots_client_read on public.generated_document_snapshots
  for select to authenticated using (client_id = public.current_client_id());

create function public.generated_document_snapshots_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Generated document snapshots are immutable';
end;
$$;
create trigger generated_document_snapshots_immutable
  before update or delete on public.generated_document_snapshots
  for each row execute function public.generated_document_snapshots_immutable();

create function public.owner_register_official_form_template(
  p_name text, p_template_kind text, p_funder_id uuid, p_version integer,
  p_storage_path text, p_content_sha256 text
) returns public.official_form_templates
language plpgsql security definer set search_path = '' as $$
declare v public.official_form_templates;
begin
  if not public.is_owner() then raise exception 'Only the owner can register official templates' using errcode='42501'; end if;
  insert into public.official_form_templates(name,template_kind,funder_id,version,storage_path,content_sha256,approved_by)
  values(btrim(p_name),p_template_kind,p_funder_id,p_version,btrim(p_storage_path),lower(p_content_sha256),(select auth.uid()))
  returning * into v;
  insert into public.activity_logs(timestamp,user_id,user_email,user_role,event_type,entity_type,entity_id,description)
  select now(),p.id,p.email,p.role::text,'CREATE','official_form_template',v.id,'Official form template registered'
  from public.profiles p where p.id=(select auth.uid());
  return v;
end;$$;

create function public.owner_set_official_form_field_mapping(
  p_template_id uuid,p_target_field text,p_source_scope text,p_source_path text,
  p_transform_key text,p_is_required boolean
) returns public.official_form_field_mappings
language plpgsql security definer set search_path = '' as $$
declare v public.official_form_field_mappings;
begin
  if not public.is_owner() then raise exception 'Only the owner can configure official mappings' using errcode='42501'; end if;
  if not exists(select 1 from public.official_form_templates where id=p_template_id and is_active) then raise exception 'Active official template not found'; end if;
  insert into public.official_form_field_mappings(template_id,target_field,source_scope,source_path,transform_key,is_required,created_by)
  values(p_template_id,btrim(p_target_field),p_source_scope,btrim(p_source_path),nullif(btrim(p_transform_key),''),p_is_required,(select auth.uid()))
  on conflict(template_id,target_field) do update set source_scope=excluded.source_scope,source_path=excluded.source_path,
    transform_key=excluded.transform_key,is_required=excluded.is_required,created_by=excluded.created_by,created_at=now()
  returning * into v;
  return v;
end;$$;

create function public.owner_record_generated_document_snapshot(
  p_template_id uuid,
  p_client_id uuid,
  p_deal_id uuid,
  p_mapping_snapshot jsonb,
  p_source_values_snapshot jsonb,
  p_rendered_storage_path text,
  p_rendered_sha256 text
) returns public.generated_document_snapshots
language plpgsql security definer set search_path = '' as $$
declare v_template public.official_form_templates; v_result public.generated_document_snapshots;
begin
  if not public.is_owner() then raise exception 'Only the owner can record generated documents' using errcode = '42501'; end if;
  if jsonb_typeof(p_mapping_snapshot) <> 'array' or jsonb_typeof(p_source_values_snapshot) <> 'object' then
    raise exception 'Mapping and source snapshots have invalid shapes';
  end if;
  select * into v_template from public.official_form_templates where id = p_template_id and is_active;
  if v_template.id is null then raise exception 'Active official template not found'; end if;
  if p_deal_id is not null and not exists (
    select 1 from public.deals where id = p_deal_id and client_id = p_client_id
  ) then raise exception 'Deal does not belong to client'; end if;
  insert into public.generated_document_snapshots (
    template_id, client_id, deal_id, generated_by, template_name_snapshot,
    template_version_snapshot, template_sha256_snapshot, mapping_snapshot,
    source_values_snapshot, rendered_storage_path, rendered_sha256
  ) values (
    v_template.id, p_client_id, p_deal_id, (select auth.uid()), v_template.name,
    v_template.version, v_template.content_sha256, p_mapping_snapshot,
    p_source_values_snapshot, btrim(p_rendered_storage_path), lower(p_rendered_sha256)
  ) returning * into v_result;
  insert into public.activity_logs (
    timestamp, user_id, user_email, user_role, event_type, entity_type, entity_id,
    description, related_entity_ids
  ) select now(), p.id, p.email, p.role::text, 'CREATE', 'generated_document_snapshot',
      v_result.id, 'Official generated-document snapshot recorded',
      array_remove(array[p_client_id, p_deal_id], null)
    from public.profiles p where p.id = (select auth.uid());
  return v_result;
end;
$$;

revoke all on function public.generated_document_snapshots_immutable() from public, anon, authenticated;
revoke all on function public.owner_register_official_form_template(text,text,uuid,integer,text,text) from public, anon;
revoke all on function public.owner_set_official_form_field_mapping(uuid,text,text,text,text,boolean) from public, anon;
revoke all on function public.owner_record_generated_document_snapshot(uuid,uuid,uuid,jsonb,jsonb,text,text) from public, anon;
grant execute on function public.owner_register_official_form_template(text,text,uuid,integer,text,text) to authenticated;
grant execute on function public.owner_set_official_form_field_mapping(uuid,text,text,text,text,boolean) to authenticated;
grant execute on function public.owner_record_generated_document_snapshot(uuid,uuid,uuid,jsonb,jsonb,text,text) to authenticated;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.generated_document_snapshots'::regclass) then
    raise exception 'PR9: snapshot RLS is disabled';
  end if;
  if has_table_privilege('authenticated','public.generated_document_snapshots','INSERT')
     or has_table_privilege('anon','public.generated_document_snapshots','SELECT') then
    raise exception 'PR9: snapshot grants are excessive';
  end if;
  if has_function_privilege('anon','public.owner_record_generated_document_snapshot(uuid,uuid,uuid,jsonb,jsonb,text,text)','EXECUTE') then
    raise exception 'PR9: anon can call owner snapshot RPC';
  end if;
  if has_function_privilege('anon','public.owner_register_official_form_template(text,text,uuid,integer,text,text)','EXECUTE') then
    raise exception 'PR9: anon can register templates';
  end if;
end $$;
notify pgrst, 'reload schema';