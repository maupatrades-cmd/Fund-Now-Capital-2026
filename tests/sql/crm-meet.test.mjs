import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// In-CRM calls and meetings (owner, 24 Nov 2026): runs the two meet migrations against an isolated PostgreSQL (PGlite)
// with minimal stand-ins for profiles, staff_access, notifications, activity_logs and Realtime's messages table, switching
// real database roles with auth.uid() claims. It proves who may contact whom, the call lifecycle (idempotent), the
// 8-person meeting cap, that only invitees join, and the Realtime topic authorization. It does NOT prove the live schema,
// Supabase Realtime itself, or WebRTC in a browser.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coord: id(2), admin: id(3), fcon: id(4), fconOff: id(5), partner: id(6), contractor: id(7),
  sub: id(8), client: id(9), s1: id(10), s2: id(11), s3: id(12), s4: id(13), s5: id(14), s6: id(15), s7: id(16), s8: id(17) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('CRM calls and meetings: contact rules, call lifecycle, meeting cap and Realtime topics', async () => {
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
      'create role anon; create role authenticated; create schema auth; create schema realtime;',
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
      "create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic',true),'') $$;",
      'create table realtime.messages(id bigserial primary key, topic text, payload jsonb);',
      'alter table realtime.messages enable row level security;',
      "create type public.user_role as enum ('owner','partner','contractor','client','lead_referrer','administrator','coordinator','switchboard','hr','field_supervisor','field_consultant');",
      "create type public.notification_event_type as enum ('FOLLOW_UP_DUE');",
      "create type public.notification_delivery_status as enum ('pending','delivered','skipped','failed');",
      "create type public.activity_event_type as enum ('CREATE','UPDATE');",
      "create table public.profiles(id uuid primary key, email text, full_name text, role public.user_role not null, is_active boolean not null default true);",
      'create table public.staff_access(profile_id uuid primary key, staff_role public.user_role not null, access_enabled boolean not null);',
      "create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) $$;",
      'create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid, event_type public.notification_event_type, title text, body_text text, link_url text, data jsonb, read_status boolean, read_at timestamptz, created_at timestamptz default now());',
      'create table public.notification_deliveries(id uuid primary key default gen_random_uuid(), notification_id uuid, channel text, delivery_status public.notification_delivery_status, sent_at timestamptz, delivered_at timestamptz);',
      'create function public.check_notification_channel_enabled(p_user uuid, p_event public.notification_event_type, p_channel text) returns boolean language sql stable as $$ select true $$;',
      'create table public.activity_logs(id bigserial, user_id uuid, user_email text, user_role text, event_type public.activity_event_type, entity_type text, entity_id uuid, description text);',
      'grant usage on schema public, auth, realtime to authenticated;',
      'grant select, insert on realtime.messages to authenticated; grant usage on sequence realtime.messages_id_seq to authenticated;',
    ].join('\n'));
    const p = (uid, name, role, active = true) => `insert into public.profiles values ('${uid}','${name}@x.test','${name}','${role}',${active});`;
    const sa = (uid, role, on = true) => `insert into public.staff_access values ('${uid}','${role}',${on});`;
    await db.exec([
      p(U.owner, 'Director', 'owner'), p(U.coord, 'Koketso', 'coordinator'), sa(U.coord, 'coordinator'),
      p(U.admin, 'Sinah', 'administrator'), sa(U.admin, 'administrator'),
      p(U.fcon, 'Faith', 'field_consultant'), sa(U.fcon, 'field_consultant'),
      p(U.fconOff, 'Dlad', 'field_consultant'), sa(U.fconOff, 'field_consultant', false),
      p(U.partner, 'Doctor', 'partner'), p(U.contractor, 'Treasure', 'contractor'), p(U.sub, 'Gloria', 'lead_referrer'),
      p(U.client, 'Client', 'client'),
      ...['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map((k) => p(U[k], k, 'switchboard') + sa(U[k], 'switchboard')),
    ].join('\n'));
    await db.exec(await mig('20261124090000_meet_enum.sql'));
    await db.exec(await mig('20261124091000_crm_meet.sql'));

    // Contact matrix.
    const can = async (a, b) => (await one('select public.meet_can_contact($1,$2) as ok', [a, b])).ok;
    assert.equal(await can(U.coord, U.admin), true, 'staff to staff');
    assert.equal(await can(U.owner, U.contractor), true, 'Director to an agent');
    assert.equal(await can(U.contractor, U.owner), true, 'agent to the Director');
    assert.equal(await can(U.partner, U.fcon), true, 'agent to staff');
    assert.equal(await can(U.partner, U.contractor), false, 'agent to agent refused');
    assert.equal(await can(U.sub, U.partner), false, 'sub-agent to partner refused');
    assert.equal(await can(U.coord, U.fconOff), false, 'switched-off staff refused');
    assert.equal(await can(U.coord, U.client), false, 'clients are not in calls');
    assert.equal(await can(U.coord, U.coord), false, 'not yourself');

    // Calls: start / answer / end, idempotent; missed call tells the callee.
    await as(U.coord);
    const call = (await one('select public.meet_start_call($1,false) as id', [U.partner])).id;
    await rejects(() => q('select public.meet_start_call($1)', [U.fconOff]), /cannot call this person/);
    await as(U.contractor);
    await rejects(() => q('select public.meet_start_call($1)', [U.sub]), /cannot call this person/);
    await rejects(() => q('select public.meet_answer_call($1)', [call]), /Call not found/);
    // Realtime: the parties may use meet:call:<id>, others may not.
    const topicOk = async (uid, topic) => {
      await as(uid);
      await db.exec(`select set_config('realtime.topic','${topic}',false);`);
      return (await one('select public.meet_can_use_topic(realtime.topic()) as ok')).ok;
    };
    assert.equal(await topicOk(U.partner, `meet:call:${call}`), true);
    assert.equal(await topicOk(U.contractor, `meet:call:${call}`), false);
    assert.equal(await topicOk(U.client, 'meet:presence'), false);
    assert.equal(await topicOk(U.admin, 'meet:presence'), true);
    assert.equal(await topicOk(U.admin, 'notifications:anything'), false);
    // RLS on realtime.messages: an outsider cannot read or write the call's topic.
    await as(U.contractor);
    await db.exec(`select set_config('realtime.topic','meet:call:${call}',false);`);
    await rejects(() => q("insert into realtime.messages(topic,payload) values ($1,'{}')", [`meet:call:${call}`]), /row-level security/);
    await as(U.partner);
    await db.exec(`select set_config('realtime.topic','meet:call:${call}',false);`);
    await q("insert into realtime.messages(topic,payload) values ($1,'{}')", [`meet:call:${call}`]);
    assert.equal((await one('select public.meet_answer_call($1) as s', [call])).s, 'answered');
    assert.equal((await one('select public.meet_answer_call($1) as s', [call])).s, 'answered', 'answering twice is harmless');
    assert.equal((await one('select public.meet_end_call($1) as s', [call])).s, 'ended');
    assert.equal((await one('select public.meet_end_call($1) as s', [call])).s, 'ended', 'ending twice is harmless');
    await as(null);
    const ended = await one('select status, duration_seconds from public.meet_calls where id = $1', [call]);
    assert.equal(ended.status, 'ended');
    assert.ok(ended.duration_seconds >= 0);
    assert.equal(Number((await one("select count(*) n from public.activity_logs where entity_type='meet_call'")).n), 1);

    await as(U.owner);
    const missed = (await one('select public.meet_start_call($1,true) as id', [U.admin])).id;
    assert.equal((await one('select public.meet_end_call($1) as s', [missed])).s, 'missed');
    await as(null);
    assert.equal(Number((await one("select count(*) n from public.notifications where user_id=$1 and event_type='MEET_MISSED_CALL'", [U.admin])).n), 1);
    assert.equal(await topicOk(U.admin, `meet:call:${missed}`), false, 'a finished call channel is closed');
    await as(U.admin);
    const declined = await (async () => { await as(U.coord); return (await one('select public.meet_start_call($1) as id', [U.admin])).id; })();
    await as(U.admin);
    assert.equal((await one('select public.meet_answer_call($1,false) as s', [declined])).s, 'declined');
    // A ringing call older than 60 s becomes missed when calls are next touched.
    await as(U.coord);
    const stale = (await one('select public.meet_start_call($1) as id', [U.fcon])).id;
    await as(null);
    await db.exec(`update public.meet_calls set started_at = now() - interval '2 minutes' where id = '${stale}'`);
    await as(U.fcon);
    await q('select public.meet_list_my()');
    await as(null);
    assert.equal((await one('select status from public.meet_calls where id=$1', [stale])).status, 'missed');
    // RLS: you read only your own calls; the Director reads all.
    await as(U.fcon);
    assert.equal(Number((await one('select count(*) n from public.meet_calls')).n), 1);
    await as(U.owner);
    assert.equal(Number((await one('select count(*) n from public.meet_calls')).n), 4);

    // Meetings: agents cannot host; up to 7 invitees; only invitees join; cap 8 in the room; host ends for all.
    await as(U.partner);
    await rejects(() => q("select public.meet_create_meeting('Team', now(), 30, $1)", [[U.coord]]), /Only Fund Now Capital staff/);
    await as(U.coord);
    await rejects(() => q("select public.meet_create_meeting('Big', now(), 30, $1)", [[U.s1, U.s2, U.s3, U.s4, U.s5, U.s6, U.s7, U.s8]]), /up to 8 people/);
    await rejects(() => q("select public.meet_create_meeting('Bad', now(), 30, $1)", [[U.fconOff]]), /cannot invite/);
    const meeting = (await one("select public.meet_create_meeting('Monday huddle', now() + interval '1 hour', 30, $1) as id",
      [[U.admin, U.partner, U.contractor, U.fcon]])).id;
    await as(null);
    assert.equal(Number((await one("select count(*) n from public.notifications where event_type='MEET_INVITE'")).n), 4);
    await as(U.sub);
    await rejects(() => q('select public.meet_join_meeting($1)', [meeting]), /not invited/);
    assert.equal(await topicOk(U.sub, `meet:room:${meeting}`), false);
    assert.equal(await topicOk(U.contractor, `meet:room:${meeting}`), true);
    await as(U.contractor);
    const joined = await one('select public.meet_join_meeting($1) as j', [meeting]);
    assert.equal(joined.j.is_host, false);
    await as(U.partner);
    await rejects(() => q('select public.meet_end_meeting($1)', [meeting]), /Only the host/);
    // Fill an instant meeting to the cap.
    await as(U.coord);
    const room = (await one('select public.meet_create_meeting($1, null, 60, $2, true) as id',
      ['Meet now', [U.s1, U.s2, U.s3, U.s4, U.s5, U.s6, U.s7]])).id;
    for (const k of ['coord', 's1', 's2', 's3', 's4', 's5', 's6', 's7']) { await as(U[k]); await q('select public.meet_join_meeting($1)', [room]); }
    await as(null);
    await db.exec(`insert into public.meet_participants(meeting_id, profile_id) values ('${room}','${U.s8}')`);
    await as(U.s8);
    await rejects(() => q('select public.meet_join_meeting($1)', [room]), /meeting is full/);
    await as(U.s1);
    await q('select public.meet_leave_meeting($1)', [room]);
    await as(U.s8);
    await q('select public.meet_join_meeting($1)', [room]);
    await as(U.coord);
    assert.equal((await one('select public.meet_end_meeting($1) as s', [room])).s, 'ended');
    assert.equal((await one('select public.meet_end_meeting($1) as s', [room])).s, 'ended');
    assert.equal(await topicOk(U.s2, `meet:room:${room}`), false, 'an ended meeting room is closed');
    await as(U.s8);
    await rejects(() => q('select public.meet_join_meeting($1)', [room]), /has ended/);
    // People list: agents see staff and the Director only.
    await as(U.partner);
    const people = (await q('select profile_id from public.meet_people(null)')).map((r) => r.profile_id);
    assert.ok(people.includes(U.owner) && people.includes(U.coord));
    assert.ok(!people.includes(U.contractor) && !people.includes(U.sub) && !people.includes(U.fconOff));
    // Outsiders: a client cannot use calls at all.
    await as(U.client);
    await rejects(() => q('select public.meet_list_my()'), /Calls and meetings are for/);
  } finally {
    await db.close();
  }
});
