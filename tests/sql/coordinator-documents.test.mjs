import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Sales Coordinator client documents (owner decision 19 Nov 2026: "she must upload statements"). Runs the two 20261119
// migrations against an isolated PostgreSQL (PGlite) on a minimal stand-in schema, switching real database roles with
// auth.uid() claims. It proves the Sales Coordinator can upload, register, list and open (logged) lead and client
// documents including bank statements, cannot delete or change them, that every other staff role, partners and a
// switched-off coordinator are refused, and that the intake receipt is recorded. It does NOT prove the live schema, the
// storage service or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coord: id(2), coordOff: id(3), switchboard: id(4), hr: id(5), field: id(6), partner: id(7), admin: id(8) };
const LEAD = id(101), LEAD_ARCH = id(102), CLIENT = id(201), PARTNER_ORG = id(301);
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('The Sales Coordinator uploads and opens client documents; everyone else is refused', async () => {
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args)).at(0);
  const as = async (uid) => {
    await db.exec('reset role;');
    if (uid) await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  };
  const rejects = async (fn, pattern) => assert.rejects(fn, (e) => { assert.match(e.message, pattern); return true; });
  try {
    await db.exec([
      'create role anon; create role authenticated; create schema auth; create schema storage;',
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
      "create type public.user_role as enum ('owner','partner','contractor','client','lead_referrer','switchboard','coordinator','administrator','hr','field_supervisor','field_consultant');",
      "create type public.document_type as enum ('cipc_cert','bank_statement','mgmt_accounts','debtors_ageing','creditors_ageing','financial_statements','personal_financials','source_of_funds','other');",
      "create type public.document_upload_source as enum ('owner','partner','client','funder','contractor','lead_referrer');",
      "create type public.document_category as enum ('company','financial','other');",
      "create type public.document_status as enum ('active','archived','expired','rejected');",
      "create type public.document_verification_status as enum ('unverified','accepted','rejected');",
      'create table public.profiles(id uuid primary key, role public.user_role not null, is_active boolean not null default true, full_name text, email text);',
      'create table public.staff_access(profile_id uuid primary key, staff_role public.user_role not null, access_enabled boolean not null default true);',
      "create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) $$;",
      `create function public.staff_role_of() returns text language sql stable security definer set search_path='' as $$
         select p.role::text from public.profiles p join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
          where p.id = (select auth.uid()) and p.is_active and s.access_enabled
            and p.role::text in ('switchboard','coordinator','administrator','hr','field_supervisor','field_consultant') $$;`,
      "create function public.staff_actor_role() returns text language sql stable security definer set search_path='' as $$ select coalesce(public.staff_role_of(), case when public.is_owner() then 'owner' end) $$;",
      'create table public.staff_audit_events(id bigint generated always as identity primary key, entity_type text, entity_id uuid, event_type text, actor_id uuid, actor_role text, reason text, detail jsonb);',
      `create function public.staff_audit_write(p_entity_type text, p_entity_id uuid, p_event_type text, p_reason text default null, p_detail jsonb default '{}'::jsonb)
         returns bigint language plpgsql security definer set search_path='' as $$ declare v bigint; begin
         insert into public.staff_audit_events(entity_type, entity_id, event_type, actor_id, actor_role, reason, detail)
         values (p_entity_type, p_entity_id, p_event_type, (select auth.uid()), public.staff_actor_role(), p_reason, p_detail) returning id into v; return v; end $$;`,
      "create function public.document_type_is_period_scoped(p public.document_type) returns boolean language sql immutable as $$ select p in ('bank_statement','mgmt_accounts') $$;",
      'create table public.leads(id uuid primary key, business_name text, referral_partner_id uuid);',
      'create table public.clients(id uuid primary key, business_name text, referral_partner_id uuid);',
      'create table public.deals(id uuid primary key default gen_random_uuid(), lead_id uuid, client_id uuid);',
      'create table public.submission_intakes(lead_id uuid primary key, archived_at timestamptz);',
      `create table public.intake_document_receipts(id uuid primary key default gen_random_uuid(), lead_id uuid not null, document_type public.document_type,
         received_via text not null, file_label text, original_filename text, document_id uuid, received_at timestamptz default now(),
         received_by uuid not null, received_by_role text not null);`,
      `create table public.documents(id uuid primary key default gen_random_uuid(), client_id uuid, lead_id uuid, deal_id uuid, referral_partner_id uuid,
         filename text, storage_path text, document_type public.document_type not null, category public.document_category not null default 'other',
         upload_source public.document_upload_source not null default 'owner', file_size_bytes bigint, mime_type text, uploaded_by uuid default auth.uid(),
         period_start date, period_end date, expiry_date date, version_number int not null default 1, is_current_version boolean not null default true,
         status public.document_status not null default 'active', verification_status public.document_verification_status not null default 'unverified',
         notes text, created_at timestamptz not null default now());`,
      'create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text default (auth.uid())::text);',
      "create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;",
      'alter table public.documents enable row level security; alter table storage.objects enable row level security;',
      'create policy documents_owner_all on public.documents for all to authenticated using (public.is_owner()) with check (public.is_owner());',
      // The live owner storage policies and the "read what you uploaded" policy, unchanged by this build.
      "create policy documents_bucket_owner_insert on storage.objects for insert to authenticated with check (bucket_id = 'documents' and public.is_owner());",
      "create policy documents_bucket_owner_select on storage.objects for select to authenticated using (bucket_id = 'documents' and public.is_owner());",
      "create policy documents_bucket_partner_select on storage.objects for select to authenticated using (bucket_id = 'documents' and owner_id = (auth.uid())::text);",
      'grant usage on schema public, auth, storage to authenticated;',
      'grant select, insert, update, delete on public.documents to authenticated;',
      'grant select, insert, delete on storage.objects to authenticated;',
    ].join('\n'));
    // The enum migration adds 'staff'; the main migration must run after it is committed.
    await db.exec(await mig('20261119100000_staff_document_source_enum.sql'));
    await db.exec(await mig('20261119101000_coordinator_documents.sql'));

    for (const [uid, role, enabled] of [[U.owner, 'owner'], [U.coord, 'coordinator', true], [U.coordOff, 'coordinator', false],
      [U.switchboard, 'switchboard', true], [U.hr, 'hr', true], [U.field, 'field_consultant', true], [U.partner, 'partner'],
      [U.admin, 'administrator', true]]) {
      await q('insert into public.profiles(id, role, full_name) values ($1,$2,$3)', [uid, role, role]);
      if (enabled !== undefined) await q('insert into public.staff_access(profile_id, staff_role, access_enabled) values ($1,$2,$3)', [uid, role, enabled]);
    }
    await q("insert into public.leads(id, business_name, referral_partner_id) values ($1,'Lead Co',$2), ($3,'Archived Co',null)", [LEAD, PARTNER_ORG, LEAD_ARCH]);
    await q("insert into public.clients(id, business_name) values ($1,'Client Co')", [CLIENT]);
    await q('insert into public.submission_intakes(lead_id, archived_at) values ($1, null), ($2, now())', [LEAD, LEAD_ARCH]);
    await q('insert into public.deals(lead_id, client_id) values ($1,$2)', [LEAD, CLIENT]);

    const put = async (uid, kind, entity, doc, file = 'bank.pdf') => {
      await as(uid);
      const path = `${kind}s/${entity}/${doc}/${file}`;
      await q("insert into storage.objects(bucket_id, name) values ('documents', $1)", [path]);
      return path;
    };
    const add = (doc, kind, entity, path, type = 'bank_statement', period = ['2026-10-01', '2026-10-31']) =>
      q('select public.coordinator_add_document($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as id',
        [doc, kind, entity, path.split('/').at(-1), path, type, 2048, 'application/pdf', period[0], period[1]]);

    // 1. The Sales Coordinator uploads a bank statement for a lead in the intake: row (staff provenance), receipt, audit.
    const D1 = id(901);
    const p1 = await put(U.coord, 'lead', LEAD, D1);
    assert.equal((await add(D1, 'lead', LEAD, p1)).at(0).id, D1);
    await as(null);
    const row = await one('select upload_source::text s, uploaded_by, referral_partner_id, lead_id, client_id from public.documents where id = $1', [D1]);
    assert.deepEqual([row.s, row.uploaded_by, row.referral_partner_id, row.lead_id, row.client_id], ['staff', U.coord, PARTNER_ORG, LEAD, null]);
    const rc = await one('select received_via, document_id, received_by, received_by_role, document_type::text t from public.intake_document_receipts');
    assert.deepEqual([rc.received_via, rc.document_id, rc.received_by, rc.received_by_role, rc.t], ['secure_upload', D1, U.coord, 'coordinator', 'bank_statement']);
    assert.equal((await one("select count(*)::int c from public.staff_audit_events where event_type = 'document_uploaded' and actor_role = 'coordinator'")).c, 1);

    // 2. A client document; an archived lead gets no receipt.
    const D2 = id(902);
    const p2 = await put(U.coord, 'client', CLIENT, D2, 'cipc.pdf');
    await add(D2, 'client', CLIENT, p2, 'cipc_cert', [null, null]);
    const D3 = id(903);
    const p3 = await put(U.coord, 'lead', LEAD_ARCH, D3, 'cipc.pdf');
    await add(D3, 'lead', LEAD_ARCH, p3, 'cipc_cert', [null, null]);
    await as(null);
    assert.equal((await one('select count(*)::int c from public.intake_document_receipts')).c, 1, 'no receipt on an archived submission');

    // 3. Registration checks.
    const D4 = id(904);
    const p4 = await put(U.coord, 'lead', LEAD, D4);
    await rejects(() => add(D4, 'lead', LEAD, p4, 'bank_statement', [null, null]), /which month or period/);
    await rejects(() => add(D4, 'lead', LEAD, `leads/${LEAD}/${id(999)}/bank.pdf`), /not where this document belongs/);
    await rejects(() => add(id(905), 'lead', LEAD, `leads/${LEAD}/${id(905)}/bank.pdf`), /Upload the file first/);
    await rejects(() => q("select public.coordinator_add_document($1,'lead',$2,'x.docx',$3,'other',10,'application/msword')", [D4, LEAD, p4]), /Only PDF, JPG and PNG/);

    // 4. List: the lead shows its own and its client's documents.
    await as(U.coord);
    const listed = (await q("select id from public.coordinator_list_documents('lead', $1)", [LEAD])).map((r) => r.id).sort();
    assert.deepEqual(listed, [D1, D2].sort());
    assert.deepEqual((await q("select id from public.coordinator_list_documents('client', $1)", [CLIENT])).map((r) => r.id), [D2]);

    // 5. Open: only with a live ticket, and every open is logged (bank statements flagged as financial).
    await as(null);
    const ownerPath = `leads/${LEAD}/${id(906)}/owner-bank.pdf`;
    await q("insert into storage.objects(bucket_id, name, owner_id) values ('documents', $1, $2)", [ownerPath, U.owner]);
    await q("insert into public.documents(id, lead_id, filename, storage_path, document_type, uploaded_by) values ($1,$2,'owner-bank.pdf',$3,'bank_statement',$4)", [id(906), LEAD, ownerPath, U.owner]);
    await as(U.coord);
    assert.equal((await q('select 1 from storage.objects where name = $1', [ownerPath])).length, 0, 'no read without a ticket');
    assert.equal((await one("select public.coordinator_open_document($1,'view') as p", [id(906)])).p, ownerPath);
    assert.equal((await q('select 1 from storage.objects where name = $1', [ownerPath])).length, 1, 'read with a live ticket');
    await as(null);
    const opened = await one("select actor_role, detail from public.staff_audit_events where event_type = 'document_viewed'");
    assert.equal(opened.actor_role, 'coordinator');
    assert.equal(opened.detail.financial, true);
    await db.exec('update public.document_access_tickets set expires_at = now() - interval \'1 minute\'');
    await as(U.coord);
    assert.equal((await q('select 1 from storage.objects where name = $1', [ownerPath])).length, 0, 'an expired ticket gives no read');

    // 6. She cannot delete or change documents (owner-only); she may clean up only her own unregistered file.
    assert.equal((await q('delete from public.documents where id = $1 returning id', [D1])).length, 0);
    assert.equal((await q("update public.documents set verification_status = 'accepted' where id = $1 returning id", [D1])).length, 0);
    assert.equal((await q('delete from storage.objects where name = $1 returning id', [p1])).length, 0, 'registered file stays');
    assert.equal((await q('delete from storage.objects where name = $1 returning id', [p4])).length, 1, 'unregistered own file can be removed');

    // 7. Everyone else is refused: other staff roles, a switched-off coordinator, a partner.
    for (const uid of [U.switchboard, U.hr, U.field, U.admin, U.coordOff, U.partner]) {
      await as(uid);
      await rejects(() => q("insert into storage.objects(bucket_id, name) values ('documents', $1)", [`leads/${LEAD}/${id(950)}/x.pdf`]), /row-level security/);
      await rejects(() => q("select public.coordinator_list_documents('lead', $1)", [LEAD]), /permission/);
      await rejects(() => q("select public.coordinator_open_document($1,'view')", [D1]), /permission/);
      await rejects(() => add(id(951), 'lead', LEAD, p1), /Only the Sales Coordinator/);
      assert.equal((await q('select 1 from public.documents')).length, 0, 'no direct read of documents');
    }

    // 8. The Director still has full access.
    await as(U.owner);
    assert.equal((await one('select count(*)::int c from public.documents')).c, 4);

    // 9. Grants.
    await as(null);
    for (const fn of ['public.coordinator_add_document(uuid,text,uuid,text,text,public.document_type,bigint,text,date,date,text)',
      'public.coordinator_list_documents(text,uuid)', 'public.coordinator_open_document(uuid,text)']) {
      assert.equal((await one(`select has_function_privilege('anon','${fn}','execute') as x`)).x, false, fn);
    }
  } finally {
    await db.close();
  }
});
