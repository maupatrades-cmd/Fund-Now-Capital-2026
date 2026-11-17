import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Scanned paper forms (20261117120000): runs the migration against an isolated PostgreSQL (PGlite) on top of small
// stubs of the live helpers it uses (staff_role_of with all six staff roles, staff_actor_role, is_owner,
// staff_text_is_safe, intake_append_only_guard, payroll_is_working_day, activity_logs, storage.objects/buckets), switching
// real database roles with auth.uid() claims. It proves, per role, which forms each may see in the catalogue, upload
// and view; that CEO-only forms are invisible to everyone but the owner; the link each form demands; versioning on
// replace; owner-only delete; ticket-gated storage reads; the activity_logs trail; and the missing-register list.
// It does NOT prove the live storage service, signed URLs or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = {
  owner: id(1), admin: id(2), coordinator: id(3), switchboard: id(4), hr: id(5), fsup: id(6), fcon: id(7),
  partner: id(8), contractor: id(9), sub: id(10), adminOff: id(11), fcon2: id(12),
};
const ROLES = ['owner', 'admin', 'coordinator', 'switchboard', 'hr', 'fsup', 'fcon', 'partner'];
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('scanned forms: catalogue, per-role upload and view, CEO-only invisibility, versions, owner delete, logging', async () => {
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0];
  const as = async (uid) => {
    await db.exec('reset role;');
    if (uid) await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  };
  const rejects = async (fn, pattern) => {
    await assert.rejects(fn, (e) => { assert.match(e.message, pattern); return true; });
  };
  try {
    await db.exec([
      'create role anon; create role authenticated; create schema auth; create schema storage;',
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
      "create type public.user_role as enum ('owner','partner','contractor','client','lead_referrer','switchboard','coordinator','administrator','hr','field_supervisor','field_consultant');",
      "create type public.activity_event_type as enum ('CREATE','UPDATE','DELETE','READ','EXPORT');",
      'create table public.profiles(id uuid primary key, email text, full_name text, role public.user_role not null, is_active boolean not null default true);',
      'create table public.staff_access(profile_id uuid primary key, staff_role public.user_role not null, access_enabled boolean not null default false);',
      "create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) $$;",
      // As live after 20261021131000.
      "create function public.staff_role_of() returns text language sql stable security definer set search_path = '' as $$ select p.role::text from public.profiles p join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role where p.id = (select auth.uid()) and p.is_active and s.access_enabled and p.role::text in ('switchboard','coordinator','administrator','hr','field_supervisor','field_consultant') $$;",
      "create function public.staff_actor_role() returns text language sql stable security definer set search_path = '' as $$ select case when public.is_owner() then 'owner' else public.staff_role_of() end $$;",
      "create function public.staff_text_is_safe(p_text text) returns boolean language sql immutable set search_path = '' as $$ select p_text is null or regexp_replace(p_text, '[\\s-]', '', 'g') !~ '\\d{9,}' $$;",
      "create function public.intake_append_only_guard() returns trigger language plpgsql set search_path = '' as $$ begin raise exception '% is append-only: record a new event instead of changing history', tg_table_name; end $$;",
      "create function public.current_sast_date() returns date language sql stable as $$ select (now() at time zone 'Africa/Johannesburg')::date $$;",
      "create function public.payroll_is_working_day(p_day date) returns boolean language sql stable as $$ select extract(isodow from p_day) < 6 $$;",
      'create table public.clients(id uuid primary key default gen_random_uuid(), business_name text, cipc_number text);',
      'create table public.deals(id uuid primary key default gen_random_uuid(), client_id uuid, reference text, stage text default \'qualifying\', archived_at timestamptz, created_at timestamptz default now());',
      'create table public.activity_logs(id bigserial primary key, occurred_at timestamptz default now(), user_id uuid, user_email text, user_role text, event_type public.activity_event_type not null, entity_type text not null, entity_id uuid, description text, after_values jsonb);',
      'create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);',
      "create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text default (auth.uid())::text);",
      "create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;",
      'alter table storage.objects enable row level security;',
      // Stand-in for the Agent file's staff_save_agent_payee (20261117110000): records the proof reference it gets.
      'create table public.test_payee_calls(profile_id uuid, proof text);',
      "create function public.staff_save_agent_payee(p_profile uuid, p_banking_proof_storage_path text default null) returns uuid language plpgsql security definer set search_path = '' as $$ begin if (select role::text from public.profiles where id = p_profile) = 'partner' then raise exception 'This partner is not linked to a brokerage yet'; end if; insert into public.test_payee_calls values (p_profile, p_banking_proof_storage_path); return p_profile; end $$;",
      'grant usage on schema public, auth, storage to authenticated;',
      'grant select, insert, delete on storage.objects to authenticated;',
    ].join('\n'));
    const people = [
      [U.owner, 'Founder', 'owner'], [U.admin, 'Sinah', 'administrator'], [U.coordinator, 'Koketso', 'coordinator'],
      [U.switchboard, 'Reception', 'switchboard'], [U.hr, 'Sam', 'hr'], [U.fsup, 'FieldSup', 'field_supervisor'],
      [U.fcon, 'FieldCon', 'field_consultant'], [U.partner, 'Partner', 'partner'], [U.contractor, 'Agent', 'contractor'],
      [U.sub, 'SubAgent', 'lead_referrer'], [U.adminOff, 'AdminNoAccess', 'administrator'], [U.fcon2, 'FieldCon2', 'field_consultant'],
    ];
    for (const [uid, name, role] of people) {
      await q('insert into public.profiles(id,email,full_name,role) values ($1,$2,$3,$4)', [uid, `${name}@example.test`, name, role]);
      if (!['owner', 'partner', 'contractor', 'lead_referrer'].includes(role)) {
        await q('insert into public.staff_access(profile_id, staff_role, access_enabled) values ($1,$2,$3)', [uid, role, uid !== U.adminOff]);
      }
    }
    const client = (await one("insert into public.clients(business_name, cipc_number) values ('Mama Mabase JV','2020/123456/07') returning id")).id;
    const otherClient = (await one("insert into public.clients(business_name) values ('Other') returning id")).id;
    const deal = (await one("insert into public.deals(client_id, reference) values ($1,'DEAL-001') returning id", [client])).id;

    await db.exec(await mig('20261117120000_scanned_forms.sql'));

    // ---- 1. Catalogue: who sees which forms -------------------------------------------------------------------------
    const catalogue = async (who) => { await as(U[who]); return (await q('select code, can_upload from public.scanned_form_catalogue_list()')); };
    const codes = async (who) => (await catalogue(who)).map((r) => r.code);
    const uploadable = async (who) => (await catalogue(who)).filter((r) => r.can_upload).map((r) => r.code);
    const CEO = ['FNC-CL-02', 'FNC-CL-03', 'FNC-CL-05', 'FNC-FIN-04', 'FNC-FIN-08', 'FNC-HR-04', 'FNC-HR-05', 'FNC-HR-09'];
    const ownerCodes = await codes('owner');
    assert.equal(ownerCodes.length, 52, 'the owner sees the whole catalogue (49 spec forms + 3 agent onboarding documents)');
    for (const c of CEO) assert.ok(ownerCodes.includes(c));
    for (const who of ROLES.filter((r) => r !== 'owner')) {
      const mine = await codes(who);
      for (const c of CEO) assert.ok(!mine.includes(c), `${who} must not see that ${c} exists`);
    }
    assert.deepEqual(await codes('partner'), [], 'agents see no forms');
    assert.ok((await codes('admin')).includes('FNC-HR-IFC'), 'the Administrator sees iFacts consent (owner, 17 Nov)');
    assert.ok((await uploadable('admin')).includes('FNC-HR-IFC'));
    assert.ok((await uploadable('hr')).includes('FNC-HR-IFC'));
    for (const who of ['coordinator', 'switchboard', 'fsup', 'fcon']) assert.ok(!(await codes(who)).includes('FNC-HR-IFC'), `${who} must not see iFacts consent`);
    assert.deepEqual((await uploadable('switchboard')).sort(), ['FNC-CL-07', 'FNC-LRF-01', 'FNC-OPS-03']);
    assert.deepEqual((await uploadable('fcon')), [], 'field consultants upload nothing');
    for (const c of ['FNC-FM-01', 'FNC-FM-07', 'FNC-OPS-02']) assert.ok((await uploadable('fsup')).includes(c), `Field Supervisor uploads ${c}`);
    for (const c of ['FNC-AG-CON', 'FNC-AG-ID', 'FNC-AG-BANK']) {
      assert.ok((await uploadable('admin')).includes(c));
      assert.ok(!(await codes('coordinator')).includes(c), 'the Coordinator does not see agent ID/bank scans');
    }
    // Staff access switched off = nothing; the catalogue table itself is closed.
    assert.deepEqual(await codes('adminOff'), []);
    await as(U.admin);
    await rejects(() => q('select * from public.scanned_form_catalogue'), /permission denied/);
    await rejects(() => q('select * from public.scanned_forms'), /permission denied/);

    // ---- 2. Upload: storage object first (bucket policy), then register ---------------------------------------------
    let n = 0;
    const put = async (who, code, mime = 'application/pdf') => {
      await as(U[who]);
      n += 1;
      const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
      const path = `${code}/2026/11/${id(9000 + n).replace(/^0{8}/, 'aaaaaaaa')}-1.${ext}`;
      await q("insert into storage.objects(bucket_id, name) values ('scanned-forms', $1)", [path]);
      return { path, file_name: `scan-${n}.${ext}`, mime_type: mime, size_bytes: 120000 };
    };
    const today = (await one('select public.current_sast_date()::text as d')).d;
    const register = async (who, code, link = {}, files = null) => {
      const pages = files ?? [await put(who, code)];
      await as(U[who]);
      return (await one('select public.scanned_form_register($1,$2,$3,$4,$5::date,$6,$7,$8::jsonb) as id',
        [code, link.client ?? null, link.deal ?? null, link.subject ?? null, link.date ?? today, 'Signed T Maupa', link.note ?? null, JSON.stringify(pages)])).id;
    };

    // Storage refuses a form the person may not upload, before any row exists.
    await as(U.coordinator);
    await rejects(() => q("insert into storage.objects(bucket_id, name) values ('scanned-forms', 'FNC-HR-IFC/2026/11/aaaaaaaa-0000-0000-0000-000000000001-1.pdf')"), /row-level security/);
    await as(U.switchboard);
    await rejects(() => q("insert into storage.objects(bucket_id, name) values ('scanned-forms', 'FNC-CL-02/2026/11/aaaaaaaa-0000-0000-0000-000000000002-1.pdf')"), /row-level security/);

    const caf = await register('coordinator', 'FNC-CAF-01', { client, deal });
    const lrf = await register('switchboard', 'FNC-LRF-01', { client });
    const visitor = await register('switchboard', 'FNC-OPS-03');
    const ceoForm = await register('owner', 'FNC-CL-03', { client, deal });
    const ifacts = await register('admin', 'FNC-HR-IFC', { subject: U.contractor });
    const agentId = await register('admin', 'FNC-AG-ID', { subject: U.contractor });
    const leave = await register('hr', 'FNC-HR-02', { subject: U.coordinator });
    const fm01 = await register('fsup', 'FNC-FM-01', { subject: U.fcon });
    const fm07 = await register('fsup', 'FNC-FM-07');
    const minutes = await register('fsup', 'FNC-OPS-02');
    const petty = await register('admin', 'FNC-FIN-06');
    // A scanned bank letter becomes the agent's proof of banking; a failed link never undoes the upload.
    const bank = await register('admin', 'FNC-AG-BANK', { subject: U.contractor });
    await db.exec('reset role;');
    assert.deepEqual(await q('select profile_id, proof from public.test_payee_calls'), [{ profile_id: U.contractor, proof: `scanned-form:${bank}` }]);
    const bankPartner = await register('hr', 'FNC-AG-BANK', { subject: U.partner });
    await db.exec('reset role;');
    assert.match((await one("select after_values->>'bank_proof' as b from public.activity_logs where entity_id=$1", [bankPartner])).b, /^not_linked: This partner is not linked/);

    // The form decides the link.
    await rejects(() => register('coordinator', 'FNC-CAF-01', {}), /Choose the client/);
    await rejects(() => register('coordinator', 'FNC-CAF-01', { client: otherClient, deal }), /does not belong/);
    await rejects(() => register('admin', 'FNC-OPS-04', { client }), /not linked to a person or client/);
    await rejects(() => register('hr', 'FNC-HR-02', { subject: U.contractor }), /cannot be linked/);
    await rejects(() => register('fsup', 'FNC-FM-01', { subject: U.coordinator }), /cannot be linked/);
    await rejects(() => register('admin', 'FNC-AG-ID', {}), /Choose the person/);
    await rejects(() => register('coordinator', 'FNC-HR-IFC', { subject: U.contractor }, []), /permission/);
    await rejects(() => register('fcon', 'FNC-FM-05'), /permission|row-level security/);
    await rejects(() => register('admin', 'FNC-OPS-04', { date: '2099-01-01' }), /future/);
    await rejects(() => register('admin', 'FNC-OPS-04', { note: 'ID 8001015009087' }), /no ID, bank/);
    // Pages must have been uploaded by the caller into the right folder, PDF/JPG/PNG, 20 MB in total.
    const stray = await put('admin', 'FNC-OPS-05');
    await rejects(() => register('admin', 'FNC-OPS-04', {}, [stray]), /unexpected file path/);
    const big = await put('admin', 'FNC-OPS-04');
    await rejects(() => register('admin', 'FNC-OPS-04', {}, [{ ...big, size_bytes: 21000000 }]), /20 MB/);
    await rejects(() => register('admin', 'FNC-OPS-04', {}, [{ ...big, mime_type: 'application/zip' }]), /PDF, JPG and PNG/);
    await rejects(() => register('admin', 'FNC-OPS-04', {}, [{ ...big, path: big.path.replace(/-1\.pdf$/, '-2.pdf') }]), /finished uploading/);
    // Weekly registers are stored as Monday to Sunday.
    await as(U.admin);
    const pettyRow = await one('select period_start, period_end from public.scanned_forms_list(p_form_code => $1)', ['FNC-FIN-06']);
    assert.equal(new Date(pettyRow.period_start).getUTCDay(), 1);

    // ---- 3. Who sees which upload -------------------------------------------------------------------------------------
    const visible = async (who) => { await as(U[who]); return (await q('select id from public.scanned_forms_list()')).map((r) => r.id); };
    const expectations = {
      owner: [caf, lrf, visitor, ceoForm, ifacts, agentId, leave, fm01, fm07, minutes, petty, bank, bankPartner],
      admin: [caf, lrf, visitor, ifacts, agentId, leave, fm01, fm07, minutes, petty, bank, bankPartner],
      coordinator: [caf, lrf, leave],            // client forms + their own leave application (self view)
      switchboard: [lrf, visitor],               // only what they uploaded
      hr: [ifacts, agentId, leave, bank, bankPartner],
      fsup: [fm01, fm07, minutes],               // field forms + what they uploaded
      fcon: [fm01],                              // their own approval form
      partner: [],
    };
    for (const [who, ids] of Object.entries(expectations)) {
      assert.deepEqual((await visible(who)).sort(), [...ids].sort(), `${who} sees exactly these uploads`);
    }
    assert.deepEqual(await visible('adminOff'), []);

    // ---- 4. Opening a page: visibility check, log, ticket; storage needs the ticket ---------------------------------
    await as(U.coordinator);
    const cafFile = (await one('select pages->0->>\'id\' as f from public.scanned_forms_list(p_form_code => $1)', ['FNC-CAF-01'])).f;
    const cafPath = (await one("select public.scanned_form_open_file($1, 'view') as p", [cafFile])).p;
    assert.equal((await q("select name from storage.objects where bucket_id='scanned-forms' and name=$1", [cafPath])).length, 1, 'ticket opens the object');
    await as(U.switchboard);
    assert.equal((await q("select name from storage.objects where bucket_id='scanned-forms' and name=$1", [cafPath])).length, 0, 'no ticket, no read');
    await rejects(() => q("select public.scanned_form_open_file($1, 'download')", [cafFile]), /permission/);
    await as(U.admin);
    const ceoFile = (await one('select id from public.scanned_form_files where form_id=$1', [ceoForm]).catch(() => null));
    assert.equal(ceoFile, null, 'the files table is closed');
    await db.exec('reset role;');
    const ceoFileId = (await one('select id from public.scanned_form_files where form_id=$1', [ceoForm])).id;
    for (const who of ['admin', 'coordinator', 'hr']) {
      await as(U[who]);
      await rejects(() => q("select public.scanned_form_open_file($1, 'view')", [ceoFileId]), /permission/);
      await rejects(() => q('select * from public.scanned_form_versions($1)', [ceoForm]), /permission/);
    }

    // ---- 5. Replace keeps versions; only uploaders of that form may replace -----------------------------------------
    const v2 = await put('coordinator', 'FNC-CAF-01', 'image/jpeg');
    const v2b = await put('coordinator', 'FNC-CAF-01', 'image/png');
    await as(U.coordinator);
    await rejects(() => q('select public.scanned_form_replace($1,$2::jsonb,$3)', [caf, JSON.stringify([v2]), 'x']), /Say why/);
    assert.equal((await one('select public.scanned_form_replace($1,$2::jsonb,$3) as v', [caf, JSON.stringify([v2, v2b]), 'Missing page two'])).v, 2);
    const history = await q('select version, page_no from public.scanned_form_versions($1)', [caf]);
    assert.deepEqual(history.map((r) => `${r.version}:${r.page_no}`), ['2:1', '2:2', '1:1'], 'old version kept');
    await as(U.switchboard);
    const lrfSwap = await put('switchboard', 'FNC-LRF-01');
    await as(U.hr);
    await rejects(() => q('select public.scanned_form_replace($1,$2::jsonb,$3)', [lrf, JSON.stringify([lrfSwap]), 'not mine']), /permission/);
    await db.exec('reset role;');
    await rejects(() => q('update public.scanned_form_files set file_name = $1', ['x']), /append-only/);
    await rejects(() => q('delete from public.scanned_form_files'), /append-only/);

    // ---- 6. Only the owner deletes; the record is hidden but kept --------------------------------------------------
    await as(U.admin);
    await rejects(() => q('select public.owner_delete_scanned_form($1,$2)', [visitor, 'duplicate scan']), /Only the Director/);
    await as(U.owner);
    const paths = (await one('select public.owner_delete_scanned_form($1,$2) as p', [visitor, 'Duplicate scan'])).p;
    assert.equal(paths.length, 1);
    await as(U.switchboard);
    assert.ok(!(await visible('switchboard')).includes(visitor), 'deleted form is hidden');
    await rejects(() => q("delete from storage.objects where bucket_id='scanned-forms' and name=$1 returning name", [paths[0]]).then((r) => { if (r.length === 0) throw new Error('row-level security: nothing deleted'); }), /row-level security/);
    await as(U.owner);
    assert.equal((await q("delete from storage.objects where bucket_id='scanned-forms' and name=$1 returning name", [paths[0]])).length, 1, 'the owner removes the file');
    await db.exec('reset role;');
    assert.ok((await one('select deleted_at from public.scanned_forms where id=$1', [visitor])).deleted_at);
    // An uploader may clear their own page that never got registered.
    await as(U.admin);
    assert.equal((await q("delete from storage.objects where bucket_id='scanned-forms' and name=$1 returning name", [stray.path])).length, 1);

    // ---- 7. Every upload, view, download, replace and delete is in activity_logs -------------------------------------
    await db.exec('reset role;');
    const log = await q("select event_type::text as e, count(*)::int as c from public.activity_logs where entity_type='scanned_form' group by 1");
    const byType = Object.fromEntries(log.map((r) => [r.e, r.c]));
    assert.equal(byType.CREATE, 13);
    assert.equal(byType.READ, 1);
    assert.equal(byType.UPDATE, 1);
    assert.equal(byType.DELETE, 1);
    await as(U.coordinator);
    await q("select public.scanned_form_open_file($1, 'download')", [cafFile]);
    await db.exec('reset role;');
    assert.equal((await one("select count(*)::int c from public.activity_logs where entity_type='scanned_form' and event_type='EXPORT'")).c, 1);
    assert.equal((await one("select user_role from public.activity_logs where entity_type='scanned_form' and event_type='EXPORT'")).user_role, 'coordinator');

    // ---- 8. Missing registers (Administrator landing) ------------------------------------------------------------------
    await db.exec("update public.scanned_form_catalogue set created_at = now() - interval '30 days'");
    await as(U.admin);
    const missing = await q('select form_code, period_start from public.scanned_form_missing_registers()');
    assert.ok(missing.some((m) => m.form_code === 'FNC-OPS-01'), 'daily briefing sheets are missing');
    assert.ok(missing.some((m) => m.form_code === 'FNC-FM-06'), 'last week\'s field report is missing');
    assert.ok(missing.filter((m) => m.form_code === 'FNC-HR-01').length <= 5);
    await as(U.coordinator);
    await rejects(() => q('select * from public.scanned_form_missing_registers()'), /permission/);

    // ---- 9. No anon access; RLS on every new table -------------------------------------------------------------------
    await db.exec('reset role;');
    for (const t of ['scanned_form_catalogue', 'scanned_forms', 'scanned_form_files', 'scanned_form_access_tickets']) {
      assert.equal((await one('select relrowsecurity as r from pg_class where relname=$1', [t])).r, true, `${t} has RLS`);
    }
    for (const fn of ['scanned_forms_list(text,text,date,date,uuid,uuid,uuid,uuid,integer)', 'scanned_form_register(text,uuid,uuid,uuid,date,text,text,jsonb)', 'scanned_form_open_file(uuid,text)']) {
      assert.equal((await one(`select has_function_privilege('anon', 'public.${fn}', 'execute') as x`)).x, false);
    }
  } finally {
    await db.close();
  }
});
