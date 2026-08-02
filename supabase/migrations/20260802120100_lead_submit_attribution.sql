-- LEAD-SUBMIT lane — lead submission attribution + partner/contractor RLS.
--
-- Partners (Doctor / Bright Destiny) and FNC direct contractors submit leads
-- that land in the owner's existing qualification inbox. This migration adds the
-- attribution columns those submissions set, the RLS that lets each submitter
-- see ONLY their own leads + documents (POPIA cross-role isolation — a partner
-- never sees a contractor's leads and vice-versa), and the storage policy that
-- lets them attach supporting documents to their own leads.
--
-- Reuses the existing leads + documents tables and the owner qualification
-- pipeline — nothing is rebuilt. The owner keeps full access via the existing
-- is_owner() ALL policies; these are purely additive SELECT/INSERT policies.

-- ---------------------------------------------------------------------------
-- 1. Attribution columns on leads
-- ---------------------------------------------------------------------------
-- attributed_to_partner_id / attributed_to_contractor_id hold the auth user id
-- of the submitter (auth.uid()), mirroring the existing entered_by/qualified_by
-- columns (both uuid → auth.users). A lead has at most one set — the submitting
-- RPC sets exactly one; owner-entered leads leave both NULL. RLS keys directly
-- off "= auth.uid()", so the value is the auth user id, not a referral_partners
-- id (contractors have no referral_partners row at all).
alter table public.leads
  add column if not exists attributed_to_partner_id uuid,
  add column if not exists attributed_to_contractor_id uuid;

comment on column public.leads.attributed_to_partner_id is
  'Auth user id of the referral partner who submitted this lead via partner_submit_lead (RLS scopes their own-lead visibility). NULL for owner/contractor leads.';
comment on column public.leads.attributed_to_contractor_id is
  'Auth user id of the FNC contractor who submitted this lead via contractor_submit_lead (RLS scopes their own-lead visibility). NULL for owner/partner leads.';

-- FKs added NOT VALID then VALIDATE-d (CLAUDE.md standing rule for FK columns on
-- a table with existing data — no write-blocking scan). ON DELETE SET NULL keeps
-- historical leads if a submitter's auth user is ever removed, exactly like
-- entered_by/qualified_by.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_attributed_to_partner_id_fkey') then
    alter table public.leads
      add constraint leads_attributed_to_partner_id_fkey
      foreign key (attributed_to_partner_id) references auth.users(id) on delete set null
      not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_attributed_to_contractor_id_fkey') then
    alter table public.leads
      add constraint leads_attributed_to_contractor_id_fkey
      foreign key (attributed_to_contractor_id) references auth.users(id) on delete set null
      not valid;
  end if;
end $$;

alter table public.leads validate constraint leads_attributed_to_partner_id_fkey;
alter table public.leads validate constraint leads_attributed_to_contractor_id_fkey;

-- Partial indexes back the RLS predicates (attributed_to_* = auth.uid()). Plain
-- CREATE INDEX is used deliberately: the leads table is tiny (single-digit rows),
-- so the write-blocking-lock concern the CONCURRENTLY rule addresses does not
-- apply, and CONCURRENTLY cannot run inside a migration transaction. Revisit with
-- a CONCURRENTLY rebuild only if leads ever grows large.
create index if not exists leads_attributed_to_partner_id_idx
  on public.leads (attributed_to_partner_id) where attributed_to_partner_id is not null;
create index if not exists leads_attributed_to_contractor_id_idx
  on public.leads (attributed_to_contractor_id) where attributed_to_contractor_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Ownership helper — caller_owns_lead(lead_id)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can read leads regardless of the caller's own RLS.
-- Used by the documents + storage policies to answer "did the current
-- partner/contractor submit this lead?". The caller's CURRENT profiles.role is
-- part of the check (mirroring current_partner_id()'s `role = 'partner'` guard),
-- so if the owner revokes a submitter's role — even while their auth account
-- stays enabled — their document read/insert/delete + storage access is revoked
-- immediately, not just their portal UI. Belt-and-braces grants: authenticated
-- only, never anon/public (audit FIX-A posture).
create or replace function public.caller_owns_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.leads l
    join public.profiles p on p.id = (select auth.uid())
    where l.id = p_lead_id
      and (
        (p.role = 'partner' and l.attributed_to_partner_id = p.id)
        or (p.role = 'contractor' and l.attributed_to_contractor_id = p.id)
      )
  );
$$;

revoke all on function public.caller_owns_lead(uuid) from public, anon;
grant execute on function public.caller_owns_lead(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. leads RLS — submitter reads own leads only
-- ---------------------------------------------------------------------------
-- Additive SELECT policies. Owner keeps full access via leads_owner_all.
-- Cross-role isolation is structural: a partner's leads carry
-- attributed_to_partner_id (never the contractor column), so the partner policy
-- can only ever match the partner's own submissions. Each policy also requires
-- the caller's CURRENT profiles.role — so revoking a submitter's role (while
-- their auth account stays enabled) revokes their lead visibility immediately,
-- mirroring current_partner_id()'s role guard. The profiles subquery reads the
-- caller's own row (profiles_select_own RLS permits it).
drop policy if exists leads_partner_read_own on public.leads;
create policy leads_partner_read_own on public.leads
  for select to authenticated
  using (
    attributed_to_partner_id = (select auth.uid())
    and (select p.role from public.profiles p where p.id = (select auth.uid())) = 'partner'
  );

drop policy if exists leads_contractor_read_own on public.leads;
create policy leads_contractor_read_own on public.leads
  for select to authenticated
  using (
    attributed_to_contractor_id = (select auth.uid())
    and (select p.role from public.profiles p where p.id = (select auth.uid())) = 'contractor'
  );

-- ---------------------------------------------------------------------------
-- 4. documents RLS — submitter reads + inserts docs for own leads
-- ---------------------------------------------------------------------------
-- SELECT: a submitter sees documents attached to a lead they submitted. The
-- structured-PII exclusion list is mirrored from documents_partner_read_own_uploads
-- so a submitter can never read PII-class documents even on their own lead (the
-- owner may attach e.g. a bank statement before qualifying). In practice a
-- submitter only uploads non-PII types via the form, but the exclusion is kept
-- as a hard backstop.
drop policy if exists documents_lead_submitter_read on public.documents;
create policy documents_lead_submitter_read on public.documents
  for select to authenticated
  using (
    lead_id is not null
    and public.caller_owns_lead(lead_id)
    and document_type <> all (array[
      'bank_statement', 'mgmt_accounts', 'debtors_ageing', 'creditors_ageing',
      'financial_statements', 'personal_financials', 'source_of_funds'
    ]::public.document_type[])
  );

-- INSERT: a submitter attaches a document to a lead they submitted. uploaded_by
-- is pinned to the caller (audit-truth), and lead_id must be the only owning
-- entity (matches documents_owner_entity_ck + documents_lead_deal_orthogonal).
-- storage_path is bound to the lead's own folder (`leads/{lead_id}/…`, the
-- useUploadDocument convention) so a row can never point at an arbitrary or
-- foreign bucket object and surface as a false/broken supporting document.
drop policy if exists documents_lead_submitter_insert on public.documents;
create policy documents_lead_submitter_insert on public.documents
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and lead_id is not null
    and client_id is null
    and deal_id is null
    and public.caller_owns_lead(lead_id)
    and storage_path like 'leads/' || lead_id::text || '/%'
  );

-- ---------------------------------------------------------------------------
-- 5. storage RLS — submitter uploads to own lead's document folder
-- ---------------------------------------------------------------------------
-- The client uploads to path `leads/{lead_id}/{doc_id}/{filename}` (the existing
-- useUploadDocument convention). Allow the INSERT only when segment 2 is a lead
-- the caller submitted. Owner uploads keep flowing through
-- documents_bucket_owner_insert; partner insert was previously CHECK(false).
drop policy if exists documents_bucket_submitter_insert on storage.objects;
create policy documents_bucket_submitter_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'leads'
    and public.caller_owns_lead(((storage.foldername(name))[2])::uuid)
  );

-- Tight-scoped DELETE so the upload's best-effort rollback actually removes the
-- orphaned object when the documents-row insert fails (otherwise the object
-- leaks — real storage cost + possible client PII persisting past intent). A
-- submitter may delete ONLY a file they uploaded (owner = auth.uid()) under a
-- lead they submitted. Storage policies are permissive (OR-ed), so this composes
-- cleanly with documents_bucket_owner_delete — the owner can still delete
-- anything; the submitter is confined to their own uploads under their own leads.
drop policy if exists documents_bucket_submitter_delete on storage.objects;
create policy documents_bucket_submitter_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and owner = (select auth.uid())
    and (storage.foldername(name))[1] = 'leads'
    and public.caller_owns_lead(((storage.foldername(name))[2])::uuid)
  );

-- ---------------------------------------------------------------------------
-- 6. Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  -- columns
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'leads'
        and column_name in ('attributed_to_partner_id', 'attributed_to_contractor_id')) <> 2 then
    raise exception 'attribution columns missing on leads';
  end if;

  -- FKs validated (convalidated = true)
  if exists (
    select 1 from pg_constraint
    where conname in ('leads_attributed_to_partner_id_fkey', 'leads_attributed_to_contractor_id_fkey')
      and not convalidated
  ) then
    raise exception 'attribution FKs not validated';
  end if;

  -- RLS policies present
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'leads'
        and policyname in ('leads_partner_read_own', 'leads_contractor_read_own')) <> 2 then
    raise exception 'leads submitter SELECT policies missing';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'documents'
        and policyname in ('documents_lead_submitter_read', 'documents_lead_submitter_insert')) <> 2 then
    raise exception 'documents submitter policies missing';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('documents_bucket_submitter_insert', 'documents_bucket_submitter_delete')) <> 2 then
    raise exception 'storage submitter INSERT/DELETE policies missing';
  end if;

  -- helper grants: authenticated yes, anon no
  if not has_function_privilege('authenticated', 'public.caller_owns_lead(uuid)', 'execute') then
    raise exception 'caller_owns_lead not executable by authenticated';
  end if;
  if has_function_privilege('anon', 'public.caller_owns_lead(uuid)', 'execute') then
    raise exception 'caller_owns_lead must not be executable by anon';
  end if;
end $$;
