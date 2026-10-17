-- FNC Required Documents Spec (Owner, 10 Oct 2026), part 1: the catalogue model.
-- Why a new model: the spec has ~250 distinct documents; the old document_requirement_rules table
-- keys on the 52-value document_type enum and cannot hold them. This is additive: nothing here
-- changes the existing Complete gate yet (cut-over is the override-flow migration).
--  * doc_catalogue      every document once (code, title, note)
--  * doc_lists          COMMON plus one list per funding type; confirmation state + current version
--  * doc_list_versions  one row per version; versions are immutable so a file keeps the list it opened with
--  * doc_list_items     the list contents per version, with level and the common code it replaces
--  * doc_entity_rules   entity-type swaps/additions (Pty Ltd, CC, sole proprietor, trust, ...)
-- Only the Owner edits or confirms; Operations/Coordinator/Switchboard read through the RPCs.
create type public.doc_requirement_level as enum ('required', 'conditional', 'optional', 'required_later');

create table public.doc_catalogue (
  code text primary key,
  title text not null check (length(btrim(title)) > 0),
  note text,
  created_at timestamptz not null default now()
);

create table public.doc_lists (
  code text primary key,
  label text not null,
  group_label text not null,
  kind text not null check (kind in ('common', 'funding_type')),
  includes_list_code text references public.doc_lists(code),
  is_confirmed boolean not null default false,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  current_version integer not null default 1
);

create table public.doc_list_versions (
  list_code text not null references public.doc_lists(code),
  version integer not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  change_note text,
  primary key (list_code, version)
);

create table public.doc_list_items (
  list_code text not null,
  version integer not null,
  doc_code text not null references public.doc_catalogue(code),
  level public.doc_requirement_level not null,
  condition_text text,
  replaces_code text references public.doc_catalogue(code),
  sort_order integer not null default 0,
  primary key (list_code, version, doc_code),
  foreign key (list_code, version) references public.doc_list_versions(list_code, version)
);

create table public.doc_entity_rules (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in
    ('pty_ltd', 'cc', 'sole_proprietor', 'partnership', 'trust', 'npo', 'joint_venture', 'cooperative', 'foreign_owned')),
  op text not null check (op in ('add', 'replace', 'remove', 'set_level', 'note')),
  doc_code text references public.doc_catalogue(code),
  level public.doc_requirement_level,
  target_code text references public.doc_catalogue(code),
  note text,
  sort_order integer not null default 0,
  constraint doc_entity_rules_shape_ck check (
    (op in ('add', 'replace') and doc_code is not null and level is not null)
    and (op <> 'replace' or target_code is not null)
    or (op = 'remove' and target_code is not null)
    or (op = 'set_level' and target_code is not null and level is not null)
    or (op = 'note' and note is not null))
);

alter table public.doc_catalogue enable row level security;
alter table public.doc_lists enable row level security;
alter table public.doc_list_versions enable row level security;
alter table public.doc_list_items enable row level security;
alter table public.doc_entity_rules enable row level security;
revoke all on table public.doc_catalogue, public.doc_lists, public.doc_list_versions,
  public.doc_list_items, public.doc_entity_rules from anon, authenticated;
-- No policies and no grants: every read and write goes through the SECURITY DEFINER functions below.

-- Effective list for a funding type + entity type at given list versions (defaults: current).
-- Layers: COMMON (0), the included list (1, mezzanine -> equity), the type's own items (2).
-- A higher layer's item wins on the same code; an item's replaces_code drops that lower-layer item.
-- Entity rules are applied last: remove/replace drop a code, set_level changes a level, add/replace add a document.
create or replace function public.doc_effective_list(
  p_type text, p_entity text default null, p_common_version integer default null, p_type_version integer default null)
returns table (doc_code text, title text, level public.doc_requirement_level, condition_text text, source_list text, sort_order integer)
language sql stable security definer set search_path = '' as $$
with t as (select * from public.doc_lists where code = p_type and kind = 'funding_type'),
layers as (
  select 0 as layer, 'COMMON'::text as list_code,
         coalesce(p_common_version, (select current_version from public.doc_lists where code = 'COMMON')) as ver
  union all
  select 1, t.includes_list_code, (select x.current_version from public.doc_lists x where x.code = t.includes_list_code)
    from t where t.includes_list_code is not null
  union all
  select 2, t.code, coalesce(p_type_version, t.current_version) from t),
raw as (
  select l.layer, i.doc_code, i.level, coalesce(i.condition_text, c.note) as cond, i.replaces_code,
         l.list_code as src, l.layer * 1000 + i.sort_order as srt, c.title
    from layers l
    join public.doc_list_items i on i.list_code = l.list_code and i.version = l.ver
    join public.doc_catalogue c on c.code = i.doc_code),
top as (select distinct on (r.doc_code) * from raw r order by r.doc_code, r.layer desc),
kept as (
  select * from top x
   where not exists (select 1 from raw y where y.replaces_code = x.doc_code and y.layer > x.layer)),
er as (select * from public.doc_entity_rules where entity_type = p_entity),
final as (
  select k.doc_code, k.title,
         coalesce((select e.level from er e where e.op = 'set_level' and e.target_code = k.doc_code limit 1), k.level) as level,
         k.cond, k.src, k.srt
    from kept k
   where not exists (select 1 from er e where e.op in ('remove', 'replace') and e.target_code = k.doc_code)
  union all
  select e.doc_code, c.title, e.level, c.note, 'ENTITY:' || p_entity, 3000 + e.sort_order
    from er e join public.doc_catalogue c on c.code = e.doc_code
   where e.op in ('add', 'replace'))
select f.doc_code, f.title, f.level, f.cond, f.src, f.srt from final f order by f.srt, f.doc_code
$$;
revoke all on function public.doc_effective_list(text, text, integer, integer) from public, anon, authenticated;

-- Read: overview of every list and its confirmation state.
create or replace function public.staff_doc_lists_overview()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.intake_require_actor(array['owner', 'operations', 'coordinator', 'switchboard']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', l.code, 'label', l.label, 'group', l.group_label, 'kind', l.kind,
      'includes', l.includes_list_code, 'confirmed', l.is_confirmed, 'confirmed_at', l.confirmed_at,
      'version', l.current_version,
      'items', (select count(*) from public.doc_list_items i where i.list_code = l.code and i.version = l.current_version),
      'required', (select count(*) from public.doc_list_items i where i.list_code = l.code and i.version = l.current_version and i.level = 'required'))
      order by (l.kind = 'common') desc, l.group_label, l.label)
    from public.doc_lists l), '[]'::jsonb);
end $$;

-- Read: the effective document list for a funding type (and optionally an entity type).
create or replace function public.staff_doc_list_detail(p_type text, p_entity text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_l public.doc_lists;
begin
  perform public.intake_require_actor(array['owner', 'operations', 'coordinator', 'switchboard']);
  select * into v_l from public.doc_lists l where l.code = p_type and l.kind = 'funding_type';
  if not found then raise exception 'Unknown funding type'; end if;
  return jsonb_build_object(
    'type', v_l.code, 'label', v_l.label, 'confirmed', v_l.is_confirmed, 'version', v_l.current_version,
    'entity_type', p_entity,
    'entity_notes', coalesce((select jsonb_agg(er.note) from public.doc_entity_rules er where er.entity_type = p_entity and er.op = 'note'), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'doc_code', e.doc_code, 'title', e.title, 'level', e.level, 'note', e.condition_text, 'source', e.source_list)
        order by e.sort_order, e.doc_code) from public.doc_effective_list(p_type, p_entity) e), '[]'::jsonb));
end $$;

-- Owner confirms one funding type (or COMMON). Until then files of that type cannot reach Complete.
create or replace function public.owner_confirm_doc_list(p_code text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if not public.is_owner() then raise exception 'Only the Owner can confirm a document list' using errcode = '42501'; end if;
  update public.doc_lists l set is_confirmed = true, confirmed_at = now(), confirmed_by = (select auth.uid())
   where l.code = p_code and not l.is_confirmed;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'List not found or already confirmed'; end if;
  perform public.staff_audit_write('document_rules', null, 'doc_list_confirmed', null,
    jsonb_build_object('list', p_code, 'version', (select current_version from public.doc_lists where code = p_code)));
end $$;

-- Owner changes one item (level/condition) or removes it (p_level null). Creates a NEW list version;
-- older versions are never edited, so files already opened keep the list they started with.
create or replace function public.owner_edit_doc_item(p_list text, p_doc text, p_level public.doc_requirement_level, p_condition text default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_cur integer; v_new integer;
begin
  if not public.is_owner() then raise exception 'Only the Owner can edit a document list' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('doc_list:' || p_list, 0));
  select current_version into v_cur from public.doc_lists where code = p_list for update;
  if not found then raise exception 'List not found'; end if;
  if not exists (select 1 from public.doc_list_items where list_code = p_list and version = v_cur and doc_code = p_doc) then
    raise exception 'That document is not on this list';
  end if;
  v_new := v_cur + 1;
  insert into public.doc_list_versions (list_code, version, created_by, change_note)
    values (p_list, v_new, (select auth.uid()), case when p_level is null then 'removed ' || p_doc else 'changed ' || p_doc end);
  insert into public.doc_list_items (list_code, version, doc_code, level, condition_text, replaces_code, sort_order)
    select list_code, v_new, doc_code,
           case when doc_code = p_doc then p_level else level end,
           case when doc_code = p_doc then coalesce(p_condition, condition_text) else condition_text end,
           replaces_code, sort_order
      from public.doc_list_items where list_code = p_list and version = v_cur and (doc_code <> p_doc or p_level is not null);
  update public.doc_lists set current_version = v_new where code = p_list;
  perform public.staff_audit_write('document_rules', null, 'doc_list_edited', null,
    jsonb_build_object('list', p_list, 'doc', p_doc, 'level', p_level, 'new_version', v_new));
  return v_new;
end $$;

revoke all on function public.staff_doc_lists_overview() from public, anon;
revoke all on function public.staff_doc_list_detail(text, text) from public, anon;
revoke all on function public.owner_confirm_doc_list(text) from public, anon;
revoke all on function public.owner_edit_doc_item(text, text, public.doc_requirement_level, text) from public, anon;
grant execute on function public.staff_doc_lists_overview() to authenticated;
grant execute on function public.staff_doc_list_detail(text, text) to authenticated;
grant execute on function public.owner_confirm_doc_list(text) to authenticated;
grant execute on function public.owner_edit_doc_item(text, text, public.doc_requirement_level, text) to authenticated;
