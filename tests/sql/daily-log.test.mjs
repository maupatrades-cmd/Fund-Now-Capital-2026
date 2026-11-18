import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Owner daily log (owner, 18 Nov 2026): runs the daily-log migration against an isolated PostgreSQL (PGlite) with a
// minimal stand-in for profiles / is_owner / activity_logs, switching real database roles with auth.uid() claims. It
// proves the journal is owner-only on every RPC and on the table itself, that future days are refused, that a save
// upserts one row per day, that the activity panel shows only the owner's own rows for that SAST day, and that the
// activity log entry written on save never carries the journal text. It does NOT prove the live schema or the screen.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), admin: id(2), partner: id(3) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Daily log: owner-only, one entry per day, no future days, activity panel and log entry are safe', async () => {
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0];
  const as = async (uid) => {
    await db.exec('reset role;');
    if (uid) await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  };
  const rejects = async (fn, pattern, code) => {
    await assert.rejects(fn, (e) => {
      assert.match(e.message, pattern);
      if (code) assert.equal(e.code, code);
      return true;
    });
  };
  try {
    await db.exec([
      'create role anon; create role authenticated; create schema auth;',
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
      "create type public.user_role as enum ('owner','partner','administrator');",
      "create type public.activity_event_type as enum ('CREATE','UPDATE','DELETE');",
      "create function public.current_sast_date() returns date language sql stable as $$ select (now() at time zone 'Africa/Johannesburg')::date $$;",
      "create table public.profiles(id uuid primary key, email text, full_name text, role public.user_role not null, is_active boolean not null default true);",
      "create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) $$;",
      'create table public.activity_logs(id uuid primary key default gen_random_uuid(), occurred_at timestamptz not null default now(), user_id uuid, user_email text, user_role text, event_type public.activity_event_type not null, entity_type text not null, entity_id uuid, description text, before_values jsonb, after_values jsonb);',
      'grant usage on schema public, auth to authenticated;',
    ].join('\n'));
    await db.exec(`insert into public.profiles(id,email,full_name,role) values
      ('${U.owner}','owner@example.test','Founder','owner'),
      ('${U.admin}','admin@example.test','Admin','administrator'),
      ('${U.partner}','partner@example.test','Partner','partner');`);
    await db.exec(await mig('20261118140000_owner_daily_log.sql'));

    const today = (await one('select public.current_sast_date()::text d')).d;
    const yesterday = (await one('select (public.current_sast_date() - 1)::text d')).d;
    const tomorrow = (await one('select (public.current_sast_date() + 1)::text d')).d;

    // Seed CRM activity: owner today (twice), owner yesterday, admin today.
    await db.exec(`insert into public.activity_logs(occurred_at,user_id,event_type,entity_type,description) values
      ((('${today}'::date)::timestamp + time '09:00') at time zone 'Africa/Johannesburg','${U.owner}','UPDATE','deal','Moved DEAL-001 to Approved'),
      ((('${today}'::date)::timestamp + time '15:30') at time zone 'Africa/Johannesburg','${U.owner}','CREATE','client','Created client Acme'),
      ((('${yesterday}'::date)::timestamp + time '23:30') at time zone 'Africa/Johannesburg','${U.owner}','UPDATE','deal','Yesterday late work'),
      ((('${today}'::date)::timestamp + time '10:00') at time zone 'Africa/Johannesburg','${U.admin}','CREATE','scanned_form','Admin upload');`);

    // Non-owners are refused on every RPC and see nothing in the table.
    for (const uid of [U.admin, U.partner]) {
      await as(uid);
      await rejects(() => q('select * from public.owner_daily_log_get($1::date)', [today]), /Only the Director/, '42501');
      await rejects(() => q('select public.owner_daily_log_save($1::date,$2,$3,$4)', [today, 'x', 'y', 'z']), /Only the Director/, '42501');
      await rejects(() => q('select * from public.owner_daily_log_list($1::date,$2::date)', [yesterday, today]), /Only the Director/, '42501');
      await rejects(() => q('select * from public.owner_daily_log_activity($1::date)', [today]), /Only the Director/, '42501');
      await rejects(() => q(`insert into public.owner_daily_logs(owner_id,log_date,what_happened) values ('${uid}','${today}','sneaky')`), /row-level security/);
    }
    await as(null);
    await rejects(() => q('select * from public.owner_daily_log_get($1::date)', [today]), /Only the Director/, '42501');

    // Owner: empty day, save, read back, upsert (still one row), clear a field.
    await as(U.owner);
    const empty = await one('select * from public.owner_daily_log_get($1::date)', [today]);
    assert.equal(empty.what_happened, null);
    assert.equal(empty.saved_at, null);
    const secret = 'Met the funder about the R2,500,000 deal; private thoughts';
    await one('select public.owner_daily_log_save($1::date,$2,$3,$4) s', [today, secret, 'Called three clients\nSigned a contract', 'Follow up Mama Mabase']);
    let got = await one('select * from public.owner_daily_log_get($1::date)', [today]);
    assert.equal(got.what_happened, secret);
    assert.equal(got.what_i_did, 'Called three clients\nSigned a contract');
    assert.ok(got.saved_at);
    await one('select public.owner_daily_log_save($1::date,$2,$3,$4) s', [today, secret + ' (edited)', '', 'Follow up']);
    got = await one('select * from public.owner_daily_log_get($1::date)', [today]);
    assert.equal(got.what_i_did, null, 'clearing a box is allowed');
    assert.equal(got.notes_for_tomorrow, 'Follow up');
    assert.equal((await one('select count(*)::int n from public.owner_daily_logs')).n, 1, 'one row per day');

    // Earlier days are fine; future days are refused.
    await one('select public.owner_daily_log_save($1::date,$2,$3,$4) s', [yesterday, 'Yesterday', null, null]);
    await rejects(() => q('select public.owner_daily_log_save($1::date,$2,$3,$4)', [tomorrow, 'x', null, null]), /today or an earlier day/);
    await rejects(() => q('select public.owner_daily_log_save($1::date,$2,$3,$4)', [today, 'x'.repeat(8001), null, null]), /8000/);

    // List: newest first, range limits.
    const list = await q('select log_date::text d from public.owner_daily_log_list($1::date,$2::date)', [yesterday, today]);
    assert.deepEqual(list.map((r) => r.d), [today, yesterday]);
    await rejects(() => q('select * from public.owner_daily_log_list($1::date,$2::date)', [today, yesterday]), /valid range/);
    await rejects(() => q("select * from public.owner_daily_log_list(current_date - 400, current_date)"), /up to a year/);

    // Activity panel: only the owner's rows for that SAST day, oldest first; daily-log saves left out.
    const act = await q('select description from public.owner_daily_log_activity($1::date)', [today]);
    assert.deepEqual(act.map((r) => r.description), ['Moved DEAL-001 to Approved', 'Created client Acme']);

    // The log entries written on save name the date only and never carry the journal text.
    await as(null);
    const logs = await q("select event_type::text e, description, coalesce(after_values::text,'') a from public.activity_logs where entity_type = 'daily_log' order by occurred_at");
    // Autosave throttle: the second save of the same day within 30 minutes writes no extra entry.
    assert.deepEqual(logs.map((r) => r.e), ['CREATE', 'CREATE']);
    for (const r of logs) {
      assert.match(r.description, /^Daily log updated for \d{4}-\d{2}-\d{2}$/);
      assert.ok(!r.description.includes('funder') && !r.a.includes('funder'), 'journal text never logged');
    }
  } finally {
    await db.close();
  }
});
