import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Sub-agent document uploads (16 Nov 2026): runs the real lead-submit attribution migration (caller_owns_lead and the
// documents + storage submitter policies) and the two 20261116 migrations against an isolated PostgreSQL (PGlite),
// switching real database roles with auth.uid() claims. It proves a sub-agent can attach a document (storage object +
// documents row) to a lead attributed to them and not to anyone else's lead, never reads back a bank statement, and that
// partner and contractor behaviour is unchanged. It does NOT prove the live schema, the storage service or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), partner: id(2), contractor: id(3), sub: id(4), sub2: id(5) };
const L = { sub: id(101), sub2: id(102), partner: id(103), contractor: id(104) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Sub-agents attach documents to their own leads only; partner and contractor rules unchanged', async () => {
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const as = async (uid) => {
    await db.exec('reset role;');
    if (uid) await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  };
  const rejects = async (fn, pattern) => assert.rejects(fn, (e) => { assert.match(e.message, pattern); return true; });
  try {
    await db.exec([
      'create role anon; create role authenticated; create schema auth; create schema storage;',
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
      'create table auth.users(id uuid primary key);',
      "create type public.user_role as enum ('owner','partner','contractor','client','lead_referrer');",
      "create type public.document_type as enum ('cipc_cert','bank_statement','mgmt_accounts','debtors_ageing','creditors_ageing','financial_statements','personal_financials','source_of_funds','other');",
      "create type public.document_upload_source as enum ('owner','partner','client','funder','contractor');",
      'create table public.profiles(id uuid primary key, role public.user_role not null, is_active boolean not null default true);',
      "create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) $$;",
      'create table public.leads(id uuid primary key, business_name text not null, attributed_to_lead_referrer_id uuid);',
      "create table public.documents(id uuid primary key default gen_random_uuid(), lead_id uuid, client_id uuid, deal_id uuid, filename text, storage_path text, document_type public.document_type not null default 'other', upload_source public.document_upload_source not null default 'owner', uploaded_by uuid default auth.uid(), file_size_bytes bigint, mime_type text);",
      'create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());',
      "create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;",
      'alter table public.leads enable row level security; alter table public.documents enable row level security; alter table storage.objects enable row level security;',
      'create policy leads_owner_all on public.leads for all to authenticated using (public.is_owner()) with check (public.is_owner());',
      'create policy documents_owner_all on public.documents for all to authenticated using (public.is_owner()) with check (public.is_owner());',
      'create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());',
      'alter table public.profiles enable row level security;',
      'grant usage on schema public, auth, storage to authenticated;',
      'grant select on public.profiles, public.leads to authenticated;',
      'grant select, insert on public.documents to authenticated;',
      'grant select, insert, delete on storage.objects to authenticated;',
    ].join('\n'));
    await db.exec(await mig('20260802120100_lead_submit_attribution.sql'));
    await db.exec(await mig('20261116085000_lead_referrer_documents_enum.sql'));
    await db.exec(await mig('20261116090000_lead_referrer_documents.sql'));

    for (const [uid, role] of [[U.owner, 'owner'], [U.partner, 'partner'], [U.contractor, 'contractor'], [U.sub, 'lead_referrer'], [U.sub2, 'lead_referrer']]) {
      await q('insert into auth.users(id) values ($1)', [uid]);
      await q('insert into public.profiles(id, role) values ($1, $2)', [uid, role]);
    }
    await q("insert into public.leads(id, business_name, attributed_to_lead_referrer_id) values ($1,'Sub Co',$2), ($3,'Sub2 Co',$4)", [L.sub, U.sub, L.sub2, U.sub2]);
    await q("insert into public.leads(id, business_name, attributed_to_partner_id) values ($1,'Partner Co',$2)", [L.partner, U.partner]);
    await q("insert into public.leads(id, business_name, attributed_to_contractor_id) values ($1,'Contractor Co',$2)", [L.contractor, U.contractor]);

    // The same two steps the portal's attachFile takes: storage object first, then the documents row.
    const upload = async (uid, lead, source, type = 'other') => {
      await as(uid);
      const path = `leads/${lead}/${id(900 + Math.floor(Math.random() * 99))}/file.pdf`;
      await q("insert into storage.objects(bucket_id, name) values ('documents', $1)", [path]);
      const rows = await q('insert into public.documents(lead_id, filename, storage_path, upload_source, document_type) values ($1,$2,$3,$4,$5) returning id',
        [lead, 'file.pdf', path, source, type]);
      return rows.length;
    };

    // 1. A sub-agent attaches to their own lead, with honest provenance.
    assert.equal(await upload(U.sub, L.sub, 'lead_referrer'), 1);
    await as(U.sub);
    assert.equal((await q('select count(*)::int c from public.documents')).at(0).c, 1, 'sees own lead document');
    assert.equal((await q("select public.caller_owns_lead($1) as x", [L.sub])).at(0).x, true);

    // 2. Not another sub-agent's lead, nor a partner's.
    await rejects(() => upload(U.sub, L.sub2, 'lead_referrer'), /row-level security/);
    await rejects(() => upload(U.sub, L.partner, 'lead_referrer'), /row-level security/);
    await as(U.sub2);
    assert.equal((await q('select count(*)::int c from public.documents')).at(0).c, 0, 'sub2 sees nothing of sub');

    // 3. A bank statement the Director attaches to the sub-agent's own lead is never readable by them (owner-only,
    //    CLAUDE.md rule 7). The portal only uploads type 'other'.
    await as(U.owner);
    await q("insert into public.documents(lead_id, filename, storage_path, upload_source, document_type) values ($1,'bank.pdf',$2,'owner','bank_statement')",
      [L.sub, `leads/${L.sub}/x/bank.pdf`]);
    await as(U.sub);
    assert.deepEqual((await q('select document_type::text t from public.documents order by t')).map((r) => r.t), ['other']);
    await as(U.owner);
    assert.equal((await q('select count(*)::int c from public.documents')).at(0).c, 2, 'the owner sees both');

    // 4. Partner and contractor unchanged: own lead yes, each other's no.
    assert.equal(await upload(U.partner, L.partner, 'partner'), 1);
    assert.equal(await upload(U.contractor, L.contractor, 'contractor'), 1);
    await rejects(() => upload(U.partner, L.contractor, 'partner'), /row-level security/);
    await rejects(() => upload(U.contractor, L.sub, 'contractor'), /row-level security/);

    // 5. Role revoked → access revoked at once.
    await as(null);
    await q("update public.profiles set role = 'client' where id = $1", [U.sub]);
    await as(U.sub);
    assert.equal((await q('select count(*)::int c from public.documents')).at(0).c, 0);
    await rejects(() => upload(U.sub, L.sub, 'lead_referrer'), /row-level security/);

    // 6. Grants as before.
    await as(null);
    assert.equal((await q("select has_function_privilege('anon','public.caller_owns_lead(uuid)','execute') as x")).at(0).x, false);
    assert.equal((await q("select has_function_privilege('authenticated','public.caller_owns_lead(uuid)','execute') as x")).at(0).x, true);
  } finally {
    await db.close();
  }
});
