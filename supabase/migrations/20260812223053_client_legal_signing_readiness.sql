-- Client portal legal-document signing readiness.
-- Stores no legal wording and creates no competing template registry.

create table public.client_legal_document_readiness (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  deal_id uuid references public.deals(id) on delete restrict,
  document_key text not null check (document_key in ('client_mandate', 'authority_and_consent', 'client_nda')),
  template_id uuid not null references public.official_form_templates(id) on delete restrict,
  generated_snapshot_id uuid references public.generated_document_snapshots(id) on delete restrict,
  status text not null default 'preparing' check (status in (
    'preparing', 'ready_to_sign', 'client_signed', 'awaiting_fnc_countersign',
    'complete', 'declined', 'expired', 'superseded'
  )),
  requires_fnc_countersign boolean not null default false,
  client_signed_at timestamptz,
  fnc_countersigned_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_legal_readiness_signing_consistency check (
    client_signed_at is null or status in ('client_signed', 'awaiting_fnc_countersign', 'complete', 'superseded')
  ),
  constraint client_legal_readiness_countersign_consistency check (
    fnc_countersigned_at is null or (requires_fnc_countersign and client_signed_at is not null)
  ),
  constraint client_legal_readiness_complete_consistency check (
    completed_at is null or (
      status in ('complete', 'superseded') and client_signed_at is not null
      and (not requires_fnc_countersign or fnc_countersigned_at is not null)
    )
  )
);

comment on table public.client_legal_document_readiness is
  'Client-safe readiness linked to owner-approved templates and immutable generated snapshots. No legal wording, editable fees, signature tokens or internal review notes.';

create unique index client_legal_readiness_scope_uniq
  on public.client_legal_document_readiness (
    client_id, coalesce(deal_id, '00000000-0000-0000-0000-000000000000'::uuid), document_key
  ) where status <> 'superseded';

create index client_legal_readiness_client_idx
  on public.client_legal_document_readiness (client_id, updated_at desc);

create or replace function public.validate_client_legal_document_readiness()
returns trigger language plpgsql set search_path = '' as $$
declare v_template public.official_form_templates;
begin
  select * into v_template from public.official_form_templates where id = new.template_id;
  if v_template.id is null or not v_template.is_active or v_template.template_kind <> 'legal' then
    raise exception 'An active, owner-approved legal template is required';
  end if;
  if new.deal_id is not null and not exists (
    select 1 from public.deals d where d.id = new.deal_id and d.client_id = new.client_id
  ) then raise exception 'Deal does not belong to the selected client'; end if;
  if new.generated_snapshot_id is not null and not exists (
    select 1 from public.generated_document_snapshots s
    where s.id = new.generated_snapshot_id and s.client_id = new.client_id
      and s.template_id = new.template_id and (new.deal_id is null or s.deal_id = new.deal_id)
  ) then raise exception 'Generated snapshot does not match the client, deal and template'; end if;
  if new.status <> 'preparing' and new.generated_snapshot_id is null then
    raise exception 'A generated snapshot is required before signing can begin';
  end if;
  if new.document_key = 'client_mandate' then new.requires_fnc_countersign := true; end if;
  new.updated_at := now();
  return new;
end; $$;

create trigger validate_client_legal_document_readiness
  before insert or update on public.client_legal_document_readiness
  for each row execute function public.validate_client_legal_document_readiness();

alter table public.client_legal_document_readiness enable row level security;
create policy client_legal_readiness_owner_all on public.client_legal_document_readiness
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy client_legal_readiness_client_read on public.client_legal_document_readiness
  for select to authenticated using (
    (select auth.uid()) is not null and client_id = (select public.current_client_id())
  );

revoke all on table public.client_legal_document_readiness from public, anon, authenticated;
grant select, insert, update on table public.client_legal_document_readiness to authenticated;
revoke all on function public.validate_client_legal_document_readiness() from public, anon, authenticated;

do $$ begin
  if not (select relrowsecurity from pg_class where oid = 'public.client_legal_document_readiness'::regclass) then
    raise exception 'Client legal readiness RLS must be enabled';
  end if;
  if has_table_privilege('anon', 'public.client_legal_document_readiness', 'SELECT')
     or has_table_privilege('authenticated', 'public.client_legal_document_readiness', 'DELETE') then
    raise exception 'Client legal readiness grants are excessive';
  end if;
end $$;

notify pgrst, 'reload schema';
