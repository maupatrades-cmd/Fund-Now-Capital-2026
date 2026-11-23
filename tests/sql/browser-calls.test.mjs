import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Calls inside the CRM (owner, 23 Nov 2026): runs 20261123100000_browser_calls.sql against an isolated PostgreSQL
// (PGlite) with minimal stand-ins for profiles / clients / client_contacts / leads / deals / activity_logs. Proves:
// only the Director can prepare a call; SA numbers are normalised to E.164 (0821234567 -> +27821234567); a missing or
// invalid number gives a clear error; a target is claimed once, only before it expires and only by the person who
// prepared it; status updates are idempotent and log the call once; crm_calls is invisible to anyone but the Director.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coord: id(2), consultant: id(3), nophone: id(4), client: id(10), lead: id(20), badlead: id(21) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Browser calls: owner-only prepare, E.164, one-time claim, idempotent status, owner-only call log', async () => {
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0];
  const as = async (uid) => {
    await db.exec('reset role;');
    if (uid) await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  };
  const rejects = async (fn, pattern) => assert.rejects(fn, (e) => { assert.match(e.message, pattern); return true; });
  try {
    await db.exec([
      'create role anon; create role authenticated; create role service_role; create schema auth;',
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
      "create type public.user_role as enum ('owner','coordinator','field_consultant');",
      "create type public.activity_event_type as enum ('CREATE','UPDATE');",
      'create table public.profiles(id uuid primary key, email text, full_name text, role public.user_role not null, phone_number text);',
      "create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) $$;",
      'create table public.clients(id uuid primary key, business_name text);',
      'create table public.client_contacts(id uuid primary key default gen_random_uuid(), client_id uuid, full_name text, phone text, is_primary_director boolean, created_at timestamptz default now());',
      'create table public.leads(id uuid primary key, business_name text, contact_cell text);',
      'create table public.deals(id uuid primary key default gen_random_uuid(), client_id uuid, lead_id uuid, created_at timestamptz default now());',
      'create table public.activity_logs(id uuid primary key default gen_random_uuid(), occurred_at timestamptz default now(), user_id uuid, user_email text, user_role text, event_type public.activity_event_type, entity_type text, entity_id uuid, description text);',
      'grant usage on schema public, auth to authenticated, service_role;',
    ].join('\n'));
    await db.exec(`insert into public.profiles values
      ('${U.owner}','o@x.test','Founder','owner','0820000001'),
      ('${U.coord}','c@x.test','Koketso','coordinator','0820000002'),
      ('${U.consultant}','f@x.test','Faith Mbethe','field_consultant','082 123 4567'),
      ('${U.nophone}','n@x.test','No Phone','field_consultant',null);
      insert into public.clients values ('${U.client}','Acme (Pty) Ltd');
      insert into public.client_contacts(client_id, full_name, phone, is_primary_director) values ('${U.client}','Dir','+27 11 555 0101', true);
      insert into public.leads values ('${U.lead}','Lead Co','27731234567'), ('${U.badlead}','Bad Co','12345');`);
    await db.exec(await mig('20261123100000_browser_calls.sql'));

    // Normalisation and masking.
    assert.equal((await one("select public.phone_to_e164('0821234567') v")).v, '+27821234567');
    assert.equal((await one("select public.phone_to_e164('082 123 4567') v")).v, '+27821234567');
    assert.equal((await one("select public.phone_to_e164('27821234567') v")).v, '+27821234567');
    assert.equal((await one("select public.phone_to_e164('0027821234567') v")).v, '+27821234567');
    assert.equal((await one("select public.phone_to_e164('+44 20 7946 0958') v")).v, '+442079460958');
    assert.equal((await one("select public.phone_to_e164('12345') v")).v, null);
    assert.equal((await one("select public.phone_mask('+27821234567') v")).v, '+27 82 *** **67');

    // Only the Director prepares calls.
    await as(U.coord);
    await rejects(() => q(`select public.prepare_call(p_profile_id => '${U.consultant}')`), /Only the Director/);
    await as(null);
    await db.exec('set role anon;');
    await rejects(() => q(`select public.prepare_call(p_profile_id => '${U.consultant}')`), /permission denied|Only the Director/);

    await as(U.owner);
    await rejects(() => q('select public.prepare_call()'), /Choose one person, client or lead/);
    await rejects(() => q(`select public.prepare_call(p_profile_id => '${U.nophone}')`), /no phone number on file for No Phone/);
    await rejects(() => q(`select public.prepare_call(p_lead_id => '${U.badlead}')`), /not a valid number/);
    const p = (await one(`select public.prepare_call(p_profile_id => '${U.consultant}') r`)).r;
    assert.equal(p.display_name, 'Faith Mbethe');
    assert.equal(p.masked_number, '+27 82 *** **67');
    assert.ok(!JSON.stringify(p).includes('821234567'), 'the full number never goes back to the browser');
    const c = (await one(`select public.prepare_call(p_client_id => '${U.client}') r`)).r;
    assert.equal(c.masked_number, '+27 11 *** **01');
    const l = (await one(`select public.prepare_call(p_lead_id => '${U.lead}') r`)).r;
    assert.equal(l.display_name, 'Lead Co');

    // Twilio side (service role): claim once, only by the preparer, only before expiry.
    await as(null);
    await db.exec('set role authenticated;');
    await rejects(() => q(`select public.claim_call_target('${p.call_target_id}','CA1','${U.owner}')`), /permission denied/);
    await rejects(() => q("select public.record_call_status('CA1','completed',10)"), /permission denied/);
    await as(null);
    await db.exec('set role service_role;');
    assert.equal((await one(`select public.claim_call_target('${p.call_target_id}','CA1','${U.coord}') v`)).v, null, 'another identity cannot use the target');
    assert.equal((await one(`select public.claim_call_target('${p.call_target_id}','CA1','${U.owner}') v`)).v, '+27821234567');
    assert.equal((await one(`select public.claim_call_target('${p.call_target_id}','CA2','${U.owner}') v`)).v, null, 'used once only');
    await as(null);
    await db.exec(`update public.call_targets set expires_at = now() - interval '1 second' where id = '${c.call_target_id}';`);
    await db.exec('set role service_role;');
    assert.equal((await one(`select public.claim_call_target('${c.call_target_id}','CA3','${U.owner}') v`)).v, null, 'expired');

    // Status: idempotent, final once, one activity log line.
    assert.equal((await one("select public.record_call_status('CA1','ringing') v")).v, 'ringing');
    assert.equal((await one("select public.record_call_status('CA1','in-progress') v")).v, 'in-progress');
    assert.equal((await one("select public.record_call_status('CA1','completed',192) v")).v, 'completed');
    assert.equal((await one("select public.record_call_status('CA1','completed',192) v")).v, 'already_final');
    assert.equal((await one("select public.record_call_status('CA1','failed') v")).v, 'already_final');
    assert.equal((await one("select public.record_call_status('CA9','completed') v")).v, 'unknown_call');
    await as(null);
    const logs = await q("select description from public.activity_logs where entity_type = 'call'");
    assert.deepEqual(logs.map((r) => r.description), ['Call to Faith Mbethe — 3 min 12 s, completed']);
    const call = await one('select status, duration_seconds, answered_at is not null answered, to_masked from public.crm_calls');
    assert.deepEqual(call, { status: 'completed', duration_seconds: 192, answered: true, to_masked: '+27 82 *** **67' });

    // The call log is the Director's only.
    await as(U.coord);
    assert.equal((await q('select * from public.crm_calls')).length, 0);
    await rejects(() => q('select * from public.list_calls()'), /permission/);
    await rejects(() => q(`select public.set_call_note('${p.call_target_id}','x')`), /permission/);
    await rejects(() => q('select * from public.call_targets'), /permission denied/);
    await as(U.owner);
    assert.equal((await q('select * from public.crm_calls')).length, 1);
    const listed = await q(`select target_name, to_masked from public.list_calls('profile','${U.consultant}',10)`);
    assert.deepEqual(listed, [{ target_name: 'Faith Mbethe', to_masked: '+27 82 *** **67' }]);
    await q(`select public.set_call_note('${p.call_target_id}','Agreed to send statements')`);
    assert.equal((await one('select note from public.list_calls()')).note, 'Agreed to send statements');
    await rejects(() => q(`select public.set_call_note('${c.call_target_id}','x')`), /Call not found/);
  } finally {
    await db.close();
  }
});
