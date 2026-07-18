-- B3.1 Document Management upgrade — foundation (SPEC S6 / Roadmap B3). Schema only.
--
-- Turns the thin `documents` table into a governed store: full taxonomy enum
-- (52 types across 8 categories + `other`), audit-truth upload provenance,
-- type-aware version control, period-scoped "pack" support (12-month bank
-- statement packs stay concurrently current), expiry defaults, and a
-- partner-aware RLS matrix that is READY for the Phase D portal but keeps
-- partner writes disabled until then.
--
-- The `documents` table is empty (0 rows, 0 storage objects — confirmed at build
-- time), so the destructive column reshaping below is safe. The zero-downtime FK
-- pattern (NOT VALID here + CREATE INDEX CONCURRENTLY / VALIDATE in the follow-up
-- 20260717131000) is applied anyway, for consistency with the standing policy
-- (CLAUDE.md) — on an empty table it is instant and lock-free.
--
-- Verification (B3.2) is deliberately NOT built here. Expiry ALERT automation
-- (DOCUMENT_EXPIRING_* notifications + pg_cron + email) is the immediately
-- following backend PR — it queries columns this migration creates, so it must
-- land after this is applied. The owner-facing UI is the PR after that.

-- ===========================================================================
-- 1. Enums
-- ===========================================================================
do $$
begin
  -- 8 real categories + `other` catch-all (for the `other` type). The UI surfaces
  -- the 8 named categories as filter chips; `other` is the safety-net bucket.
  if not exists (select 1 from pg_type where typname = 'document_category') then
    create type public.document_category as enum (
      'business','financial','personal','deal','asset',
      'compliance','funder_comms','fnc_business','other'
    );
  end if;

  -- Full front-loaded taxonomy (52 values) so future additions are rare. Grouped
  -- by category; the type→category mapping lives in document_type_category().
  if not exists (select 1 from pg_type where typname = 'document_type') then
    create type public.document_type as enum (
      -- Business
      'cipc_cert','company_profile','tax_clearance','bee_cert','moi',
      'trading_license','shareholder_register','director_appointment',
      -- Financial
      'bank_statement','financial_statements','mgmt_accounts','debtors_ageing',
      'creditors_ageing','cashflow_projection','budget',
      -- Personal
      'id_copy','proof_of_address','anc_contract','personal_financials',
      'spousal_consent','marriage_cert',
      -- Deal
      'application_form','credit_consent','purchase_order','cession','suretyship',
      'personal_guarantee','business_plan','quotation','invoice_doc',
      -- Asset
      'natis','vehicle_license','title_deed','valuation_report',
      'equipment_schedule','livestock_inventory',
      -- Compliance
      'fica_pack','popia_consent','source_of_funds','tax_residency',
      -- Funder communications
      'approval_letter','decline_letter','offer_letter','term_sheet',
      'funder_agreement','submission_cover',
      -- FNC business
      'invoice_sent','commission_agreement','referral_agreement','msa','welcome_pack',
      -- Catch-all
      'other'
    );
  end if;

  -- Who a document came from. Audit-truth (immutable once set).
  if not exists (select 1 from pg_type where typname = 'document_upload_source') then
    create type public.document_upload_source as enum
      ('owner','partner','client','funder');
  end if;

  -- Lifecycle state (distinct from version currency).
  if not exists (select 1 from pg_type where typname = 'document_status') then
    create type public.document_status as enum
      ('active','archived','expired','rejected');
  end if;
end $$;

-- ===========================================================================
-- 2. Taxonomy metadata helpers (single source of truth; hardcoded for B3.1 —
--    a configurable metadata table is deferred to Phase F per the brief).
--    IMMUTABLE so they can back generated columns + CHECK constraints.
-- ===========================================================================

-- type → category
create or replace function public.document_type_category(p_type public.document_type)
returns public.document_category
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'cipc_cert' then 'business'
    when 'company_profile' then 'business'
    when 'tax_clearance' then 'business'
    when 'bee_cert' then 'business'
    when 'moi' then 'business'
    when 'trading_license' then 'business'
    when 'shareholder_register' then 'business'
    when 'director_appointment' then 'business'
    when 'bank_statement' then 'financial'
    when 'financial_statements' then 'financial'
    when 'mgmt_accounts' then 'financial'
    when 'debtors_ageing' then 'financial'
    when 'creditors_ageing' then 'financial'
    when 'cashflow_projection' then 'financial'
    when 'budget' then 'financial'
    when 'id_copy' then 'personal'
    when 'proof_of_address' then 'personal'
    when 'anc_contract' then 'personal'
    when 'personal_financials' then 'personal'
    when 'spousal_consent' then 'personal'
    when 'marriage_cert' then 'personal'
    when 'application_form' then 'deal'
    when 'credit_consent' then 'deal'
    when 'purchase_order' then 'deal'
    when 'cession' then 'deal'
    when 'suretyship' then 'deal'
    when 'personal_guarantee' then 'deal'
    when 'business_plan' then 'deal'
    when 'quotation' then 'deal'
    when 'invoice_doc' then 'deal'
    when 'natis' then 'asset'
    when 'vehicle_license' then 'asset'
    when 'title_deed' then 'asset'
    when 'valuation_report' then 'asset'
    when 'equipment_schedule' then 'asset'
    when 'livestock_inventory' then 'asset'
    when 'fica_pack' then 'compliance'
    when 'popia_consent' then 'compliance'
    when 'source_of_funds' then 'compliance'
    when 'tax_residency' then 'compliance'
    when 'approval_letter' then 'funder_comms'
    when 'decline_letter' then 'funder_comms'
    when 'offer_letter' then 'funder_comms'
    when 'term_sheet' then 'funder_comms'
    when 'funder_agreement' then 'funder_comms'
    when 'submission_cover' then 'funder_comms'
    when 'invoice_sent' then 'fnc_business'
    when 'commission_agreement' then 'fnc_business'
    when 'referral_agreement' then 'fnc_business'
    when 'msa' then 'fnc_business'
    when 'welcome_pack' then 'fnc_business'
    else 'other'
  end::public.document_category;
$$;

-- Period-scoped types: multiple concurrent periods of the same type both stay
-- current (SA funders require a rolling 12-month bank-statement pack). Supersede
-- keys on (entity, type, period_start, period_end) for these; everything else
-- keys on (entity, type) — classic version control.
create or replace function public.document_type_is_period_scoped(p_type public.document_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type in (
    'bank_statement','financial_statements','mgmt_accounts',
    'debtors_ageing','creditors_ageing','cashflow_projection'
  );
$$;

-- Default expiry per type (owner may override at insert; null = owner sets
-- manually / no expiry). Pure function of its args → IMMUTABLE.
create or replace function public.document_default_expiry(
  p_type        public.document_type,
  p_upload_date date,
  p_period_end  date
)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'bank_statement'       then (p_period_end  + interval '3 months')::date
    when 'proof_of_address'     then (p_upload_date + interval '3 months')::date
    when 'tax_clearance'        then (p_upload_date + interval '12 months')::date
    when 'bee_cert'             then (p_upload_date + interval '12 months')::date
    when 'fica_pack'            then (p_upload_date + interval '12 months')::date
    when 'financial_statements' then (p_period_end  + interval '12 months')::date
    -- cipc_cert / moi / title_deed / popia_consent / anc_contract → no expiry.
    -- everything else → null (owner sets manually).
    else null
  end;
$$;

-- ===========================================================================
-- 3. Reshape `documents`
--    (empty table — drop-and-recreate the columns that change type/name)
-- ===========================================================================

-- The old partner SELECT policy references doc_type; drop it before the column.
drop policy if exists "documents_partner_read_own" on public.documents;

-- Rename file_name → filename (consistency).
alter table public.documents rename column file_name to filename;

-- doc_type (text) → document_type (enum). Empty table, so drop + add is clean.
alter table public.documents drop column if exists doc_type;
alter table public.documents add column document_type public.document_type not null;

-- New scalar columns.
alter table public.documents
  add column upload_source   public.document_upload_source not null default 'owner',
  add column lead_id         uuid,
  add column period_start    date,
  add column period_end      date,
  add column expiry_date     date,
  add column version_number  integer not null default 1,
  add column is_current_version boolean not null default true,
  add column superseded_by   uuid,
  add column status          public.document_status not null default 'active',
  add column received_from   text,
  add column notes           text,
  add column tags            text[],
  add column shared_with     text[],
  add column updated_at      timestamptz not null default now();

-- uploaded_by becomes audit-truth: caller-defaulted + NOT NULL. It already
-- carries an FK to profiles(id) (profiles.id === auth.users.id, and joining
-- profiles is what the UI needs for the owner/partner "uploaded by" badge). We
-- keep the profiles reference but swap ON DELETE SET NULL → RESTRICT so this
-- audit column can never be nulled out from under a document.
alter table public.documents alter column uploaded_by set default auth.uid();
update public.documents set uploaded_by = auth.uid() where uploaded_by is null; -- no-op (empty)
alter table public.documents alter column uploaded_by set not null;
alter table public.documents drop constraint if exists documents_uploaded_by_fkey;

-- Generated columns (STORED). Computed by the engine → cannot drift, cannot be
-- tampered with. owning_entity_id unifies lead- and client-owned documents so
-- version/supersede logic works either way.
alter table public.documents
  add column owning_entity_id uuid
    generated always as (coalesce(client_id, lead_id)) stored,
  add column is_period_scoped boolean
    generated always as (public.document_type_is_period_scoped(document_type)) stored,
  add column category public.document_category
    generated always as (public.document_type_category(document_type)) stored;

-- ===========================================================================
-- 4. Constraints
-- ===========================================================================

-- CHECK constraints in this section are added inline (not deferred to a
-- validation migration) because the table is empty at migration time — there are
-- no existing rows to validate against, so the write-blocking table scan the
-- NOT VALID + VALIDATE pattern avoids does not exist here. When we ever backfill
-- legacy documents in a future POPIA pass, follow the standard NOT VALID +
-- VALIDATE pattern strictly.
--
-- CHECK below enforces (lead_id XOR client_id). deal_id is INTENTIONALLY EXCLUDED — a document can attach to a client AND a deal simultaneously (e.g., bank statement on client Fepa Sechaba that's part of DEAL-002 submission pack). Deal-side attachment workflow is Phase E3.
alter table public.documents drop constraint if exists documents_link_ck;
alter table public.documents
  add constraint documents_owner_entity_ck
    check (num_nonnulls(lead_id, client_id) = 1);

-- Period-scoped types must carry a period; non-period types may not. Enforced
-- via the IMMUTABLE metadata function so it can never disagree with supersede
-- logic. (Empty table → added VALID inline.)
alter table public.documents
  add constraint documents_period_scope_ck
    check (
      case
        when public.document_type_is_period_scoped(document_type)
          then period_start is not null
           and period_end is not null
           and period_start <= period_end
        else period_start is null and period_end is null
      end
    );

-- FK constraints added NOT VALID (validated in the follow-up migration).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_uploaded_by_fkey') then
    alter table public.documents add constraint documents_uploaded_by_fkey
      foreign key (uploaded_by) references public.profiles(id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_lead_id_fkey') then
    -- RESTRICT (not CASCADE): governed documents must not silently vanish when a
    -- lead is deleted — the owner deals with them explicitly first.
    alter table public.documents add constraint documents_lead_id_fkey
      foreign key (lead_id) references public.leads(id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_superseded_by_fkey') then
    -- DEFERRABLE INITIALLY DEFERRED: the versioning trigger sets a prior row's
    -- superseded_by = new.id from a BEFORE INSERT trigger, i.e. before the new row
    -- is written. A non-deferrable self-FK would reject that mid-transaction; with
    -- the check deferred to COMMIT, the new row exists by then and the FK holds.
    alter table public.documents add constraint documents_superseded_by_fkey
      foreign key (superseded_by) references public.documents(id)
      on delete set null deferrable initially deferred not valid;
  end if;
end $$;

-- ===========================================================================
-- 5. Triggers
-- ===========================================================================

-- 5a. updated_at maintenance (house helper).
drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- 5b. Immutability on UPDATE:
--       * uploaded_by / upload_source — audit-truth; can NEVER change, any role.
--       * version_number — managed by the versioning trigger at INSERT; never
--         changed by anything afterwards, so it is hard-locked (no bypass).
--       * is_current_version / superseded_by — managed by the versioning trigger's
--         internal supersede UPDATE. That path sets the transaction-local flag
--         `fnc.documents_superseding`; a direct owner UPDATE (flag off) is blocked.
--     Deliberately NOT locked (owner-editable): document_type (reclassification),
--     expiry_date, status, notes, tags, verification fields (B3.2), and
--     period_start / period_end / lead_id / client_id (the B3.2 lead→client
--     migration path moves ownership; period corrections are allowed).
create or replace function public.documents_prevent_audit_rewrite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_superseding boolean :=
    coalesce(current_setting('fnc.documents_superseding', true) = 'on', false);
begin
  if new.uploaded_by is distinct from old.uploaded_by then
    raise exception 'documents.uploaded_by is immutable (audit-truth) and cannot be changed';
  end if;
  if new.upload_source is distinct from old.upload_source then
    raise exception 'documents.upload_source is immutable (audit-truth) and cannot be changed';
  end if;
  if new.version_number is distinct from old.version_number then
    raise exception 'documents.version_number is versioning-managed and cannot be changed directly';
  end if;
  if not v_superseding then
    if new.is_current_version is distinct from old.is_current_version then
      raise exception 'documents.is_current_version is versioning-managed and cannot be changed directly';
    end if;
    if new.superseded_by is distinct from old.superseded_by then
      raise exception 'documents.superseded_by is versioning-managed and cannot be changed directly';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_immutable_audit on public.documents;
create trigger documents_immutable_audit
  before update on public.documents
  for each row execute function public.documents_prevent_audit_rewrite();

-- 5c. Version control + supersede + default expiry, evaluated at the DB layer so
--     it is race-safe (the partial unique indexes in the follow-up migration are
--     the hard guarantee; this trigger keeps at most one current version per key
--     by pre-flipping prior versions to is_current_version=false).
--
--     NOTE: generated columns (owning_entity_id, is_period_scoped) are computed
--     AFTER before-triggers, so we recompute their inputs into locals here.
create or replace function public.documents_apply_versioning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owning uuid    := coalesce(new.client_id, new.lead_id);
  v_period boolean := public.document_type_is_period_scoped(new.document_type);
  v_next   integer;
begin
  -- Serialize version allocation for this supersede key so two concurrent
  -- same-key inserts can't both read the same max(version_number) and race (one
  -- would otherwise fail the partial-unique index instead of superseding). Coarse
  -- by design — keyed on entity+type (not period) — which only over-serializes
  -- (e.g. two different bank-statement periods) and never under-locks. The '|'
  -- separator avoids concat ambiguity. Transaction-scoped: released at commit.
  perform pg_advisory_xact_lock(
    hashtext(v_owning::text || '|' || new.document_type::text)
  );

  -- Default expiry unless the owner supplied one.
  if new.expiry_date is null then
    new.expiry_date := public.document_default_expiry(
      new.document_type,
      coalesce(new.created_at::date, current_date),
      new.period_end
    );
  end if;

  -- Bracket the internal supersede UPDATEs with the trusted-operation flag so the
  -- immutability trigger permits is_current_version/superseded_by changes ONLY on
  -- this path (direct owner UPDATEs of those columns stay blocked).
  perform set_config('fnc.documents_superseding', 'on', true);

  if v_period then
    select coalesce(max(d.version_number), 0) + 1
      into v_next
      from public.documents d
     where d.owning_entity_id = v_owning
       and d.document_type    = new.document_type
       and d.period_start is not distinct from new.period_start
       and d.period_end   is not distinct from new.period_end;

    update public.documents d
       set is_current_version = false,
           superseded_by      = new.id
     where d.owning_entity_id = v_owning
       and d.document_type    = new.document_type
       and d.period_start is not distinct from new.period_start
       and d.period_end   is not distinct from new.period_end
       and d.is_current_version;
  else
    select coalesce(max(d.version_number), 0) + 1
      into v_next
      from public.documents d
     where d.owning_entity_id = v_owning
       and d.document_type    = new.document_type;

    update public.documents d
       set is_current_version = false,
           superseded_by      = new.id
     where d.owning_entity_id = v_owning
       and d.document_type    = new.document_type
       and d.is_current_version;
  end if;

  perform set_config('fnc.documents_superseding', 'off', true);

  new.version_number     := v_next;
  new.is_current_version := true;
  return new;
end;
$$;

drop trigger if exists documents_versioning on public.documents;
create trigger documents_versioning
  before insert on public.documents
  for each row execute function public.documents_apply_versioning();

-- ===========================================================================
-- 6. RLS matrix (partner-aware from day one)
-- ===========================================================================
-- documents_owner_all (FOR ALL using is_owner()) is unchanged and still grants
-- the owner full CRUD. Below we replace the partner surface.

-- Partner SELECT: ONLY their own partner-sourced uploads, and NEVER document
-- types containing structured client transaction/financial PII — even if the
-- partner uploaded them as a temporary conduit, they must not become a permanent
-- viewer of that PII (CLAUDE.md rule 7, extended). In B3.1 partners cannot upload
-- yet, so this resolves to zero rows for them ("RLS ready, portal later").
drop policy if exists "documents_partner_read_own_uploads" on public.documents;
create policy "documents_partner_read_own_uploads" on public.documents
  for select to authenticated
  using (
    public.current_partner_id() is not null
    and uploaded_by = (select auth.uid())
    and upload_source = 'partner'
    and document_type <> all (array[
      'bank_statement',
      'mgmt_accounts',
      'debtors_ageing',
      'creditors_ageing',
      'financial_statements',
      'personal_financials',
      'source_of_funds'
    ]::public.document_type[])
  );

-- Partner INSERT: structurally present but DISABLED until the Phase D portal.
-- Phase D flips WITH CHECK to the intended predicate below:
--   uploaded_by = (select auth.uid())
--   and upload_source = 'partner'
--   and exists (
--     select 1 from public.clients c
--     where c.id = client_id
--       and c.referral_partner_id = public.current_partner_id()
--   )
drop policy if exists "documents_partner_insert" on public.documents;
create policy "documents_partner_insert" on public.documents
  for insert to authenticated
  with check (false);  -- Disabled until Phase D partner portal ships

-- (Partner UPDATE / DELETE: intentionally no policy — not permitted in B3.1.)

-- ===========================================================================
-- 6b. Storage bucket RLS — mirror the table matrix onto storage.objects so file
--     access can never diverge from document-row access. The owner already has
--     full CRUD on the 'documents' bucket (20260713120800). Here we add the
--     partner surface so it matches the table:
--       * partner SELECT — only objects they uploaded (storage.objects.owner =
--         auth.uid()), mirroring the table's uploaded_by = auth.uid() rule. In
--         B3.1 partners cannot upload, so this reads zero objects (RLS ready).
--       * partner INSERT — structurally present but DISABLED (WITH CHECK false)
--         until Phase D, mirroring documents_partner_insert. Phase D flips the
--         check to validate the scoped storage path
--         {owning_entity_type}/{owning_entity_id}/{document_id}/{filename} — e.g.
--         require (storage.foldername(name))[1] in ('clients','leads') and the
--         owning entity to be one the partner referred (join current_partner_id()).
--     Partner UPDATE / DELETE on the bucket: intentionally no policy in B3.1.
--     (Path convention itself is set by the upload helper in the UI PR.)
-- ===========================================================================
drop policy if exists "documents_bucket_partner_select" on storage.objects;
create policy "documents_bucket_partner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and owner = (select auth.uid()));

drop policy if exists "documents_bucket_partner_insert" on storage.objects;
create policy "documents_bucket_partner_insert" on storage.objects
  for insert to authenticated
  with check (false);  -- Disabled until Phase D partner portal ships

-- Reload PostgREST so the storage RLS changes are picked up immediately
-- (standing rule 9).
notify pgrst, 'reload schema';

-- ===========================================================================
-- 7. In-migration assertions (production check — the whole migration rolls back
--    if any assertion fails).
-- ===========================================================================

-- 7a. Trigger + constraint assertions. These need a real owning entity (FK), so
--     they run against a client if one exists and skip gracefully on a fresh/CI
--     DB (replay-safe). All test rows are deleted before commit.
do $$
declare
  v_client uuid;
  v_owner  uuid;
  v_a uuid; v_b uuid; v_c uuid;
  v_bool boolean;
begin
  select id into v_client from public.clients limit 1;
  select id into v_owner  from public.profiles where role = 'owner' limit 1;
  if v_client is null or v_owner is null then
    raise notice 'B3.1 trigger/constraint assertions skipped (no client/owner — fresh/CI DB)';
    return;
  end if;

  -- (i) Non-period supersede: two CIPC certs for the same client → v1 archived,
  --     v2 current + version 2, v1.superseded_by = v2.
  insert into public.documents (client_id, document_type, filename, storage_path, uploaded_by, upload_source)
  values (v_client, 'cipc_cert', 'b31-a.pdf', 'b31/'||gen_random_uuid(), v_owner, 'owner')
  returning id into v_a;
  insert into public.documents (client_id, document_type, filename, storage_path, uploaded_by, upload_source)
  values (v_client, 'cipc_cert', 'b31-b.pdf', 'b31/'||gen_random_uuid(), v_owner, 'owner')
  returning id into v_b;

  if (select is_current_version from public.documents where id = v_a) then
    raise exception 'B3.1 assert FAIL: prior CIPC version still current after supersede';
  end if;
  if not (select is_current_version from public.documents where id = v_b) then
    raise exception 'B3.1 assert FAIL: new CIPC version is not current';
  end if;
  if (select version_number from public.documents where id = v_b) <> 2 then
    raise exception 'B3.1 assert FAIL: expected version_number 2 on supersede';
  end if;
  if (select superseded_by from public.documents where id = v_a) is distinct from v_b then
    raise exception 'B3.1 assert FAIL: superseded_by not pointed at newer version';
  end if;

  -- (ii) Period-scoped concurrency: two bank statements for DIFFERENT periods
  --      both stay current.
  insert into public.documents (client_id, document_type, filename, storage_path, uploaded_by, upload_source, period_start, period_end)
  values (v_client, 'bank_statement', 'b31-bs1.pdf', 'b31/'||gen_random_uuid(), v_owner, 'owner', date '2026-01-01', date '2026-01-31')
  returning id into v_a;
  insert into public.documents (client_id, document_type, filename, storage_path, uploaded_by, upload_source, period_start, period_end)
  values (v_client, 'bank_statement', 'b31-bs2.pdf', 'b31/'||gen_random_uuid(), v_owner, 'owner', date '2026-02-01', date '2026-02-28')
  returning id into v_c;
  if not (select is_current_version from public.documents where id = v_a)
     or not (select is_current_version from public.documents where id = v_c) then
    raise exception 'B3.1 assert FAIL: concurrent bank-statement periods should both stay current';
  end if;
  -- default expiry = period_end + 3 months (2026-01-31 + 3mo = 2026-04-30 in
  -- Postgres — the day clamps to the last day of April, it is NOT 2026-04-01).
  if (select expiry_date from public.documents where id = v_a) <> date '2026-04-30' then
    raise exception 'B3.1 assert FAIL: bank_statement default expiry (period_end + 3mo) wrong';
  end if;

  -- (iii) Immutability: uploaded_by / upload_source cannot change; a normal edit can.
  v_bool := false;
  begin
    update public.documents set uploaded_by = gen_random_uuid() where id = v_c;
  exception when others then v_bool := true;
  end;
  if not v_bool then raise exception 'B3.1 assert FAIL: uploaded_by was mutable'; end if;

  v_bool := false;
  begin
    update public.documents set upload_source = 'partner' where id = v_c;
  exception when others then v_bool := true;
  end;
  if not v_bool then raise exception 'B3.1 assert FAIL: upload_source was mutable'; end if;

  update public.documents set notes = 'edit ok' where id = v_c;  -- must NOT raise

  -- (iv) CHECK: neither-nor and both owning entities are rejected.
  v_bool := false;
  begin
    insert into public.documents (document_type, filename, storage_path, uploaded_by, upload_source)
    values ('other', 'b31-bad.pdf', 'b31/'||gen_random_uuid(), v_owner, 'owner');  -- no client_id, no lead_id
  exception when check_violation then v_bool := true;
  end;
  if not v_bool then raise exception 'B3.1 assert FAIL: document with no owning entity was accepted'; end if;

  -- (v) CHECK: period-scoped type without a period is rejected.
  v_bool := false;
  begin
    insert into public.documents (client_id, document_type, filename, storage_path, uploaded_by, upload_source)
    values (v_client, 'bank_statement', 'b31-noperiod.pdf', 'b31/'||gen_random_uuid(), v_owner, 'owner');
  exception when check_violation then v_bool := true;
  end;
  if not v_bool then raise exception 'B3.1 assert FAIL: period-scoped type without period was accepted'; end if;

  -- Cleanup — table must return to empty (production check).
  delete from public.documents where storage_path like 'b31/%';
  raise notice 'B3.1 trigger/constraint assertions passed';
end $$;

-- 7b. RLS matrix simulation. Needs role-switching + the named test users, so it
--     runs only where they exist (live DB) and skips on a fresh/CI DB. Seed rows
--     are inserted as the migration role (RLS-bypassing) and removed before commit.
do $$
declare
  v_owner   uuid;
  v_partner uuid;
  v_client  uuid;
  v_doc     uuid;
  v_count   integer;
  v_blocked boolean;
begin
  select id into v_owner   from auth.users where email = 'business.lekgoro@gmail.com';
  select id into v_partner from auth.users where email = 'queenasdice@gmail.com';
  select id into v_client  from public.clients limit 1;
  if v_owner is null or v_partner is null or v_client is null then
    raise notice 'B3.1 RLS simulation skipped (test users/client absent — fresh/CI DB)';
    return;
  end if;

  insert into public.documents (client_id, document_type, filename, storage_path, uploaded_by, upload_source)
  values (v_client, 'cipc_cert', 'b31-rls.pdf', 'b31rls/'||gen_random_uuid(), v_owner, 'owner')
  returning id into v_doc;

  -- Partner sees ONLY own uploads → this owner-uploaded doc is invisible.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.documents where id = v_doc;
  reset role;
  if v_count <> 0 then
    raise exception 'B3.1 RLS FAIL: partner saw an owner-uploaded document';
  end if;

  -- Owner sees it.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.documents where id = v_doc;
  reset role;
  if v_count <> 1 then
    raise exception 'B3.1 RLS FAIL: owner could not see the document';
  end if;

  -- Partner INSERT is blocked (WITH CHECK false).
  v_blocked := false;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  begin
    insert into public.documents (client_id, document_type, filename, storage_path, uploaded_by, upload_source)
    values (v_client, 'id_copy', 'b31-rls-blocked.pdf', 'b31rls/'||gen_random_uuid(), v_partner, 'partner');
  exception
    when insufficient_privilege or check_violation then v_blocked := true;
  end;
  reset role;
  if not v_blocked then
    raise exception 'B3.1 RLS FAIL: partner INSERT was permitted (should be disabled until Phase D)';
  end if;

  delete from public.documents where storage_path like 'b31rls/%';
  raise notice 'B3.1 RLS simulation passed';
end $$;

-- ===========================================================================
-- 8. Comments + PostgREST reload
-- ===========================================================================
comment on column public.documents.uploaded_by is
  'Audit-truth: the profile that uploaded this document. Immutable (documents_prevent_audit_rewrite). Defaults to auth.uid().';
comment on column public.documents.upload_source is
  'Audit-truth: owner/partner/client/funder provenance. Immutable.';
comment on column public.documents.owning_entity_id is
  'Generated coalesce(client_id, lead_id) — unifies lead- and client-owned docs for version/supersede keys.';
comment on column public.documents.is_period_scoped is
  'Generated from document_type. True → supersede keys on (entity,type,period); concurrent periods stay current.';
comment on column public.documents.is_current_version is
  'The latest version for its supersede key. Prior versions are flipped false by documents_apply_versioning.';

notify pgrst, 'reload schema';
