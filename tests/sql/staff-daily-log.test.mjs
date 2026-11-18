import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Staff daily log (owner, 18 Nov 2026): runs the Director's daily-log migration and the staff extension against an
// isolated PostgreSQL (PGlite) with minimal stand-ins (profiles, staff_access, is_owner, staff_role_of, activity_logs,
// notifications via staff_notify, business_holidays). It proves every enabled staff member gets a log PRIVATE to them
// (nobody else, not even the Director, can read it via the RPCs or the table), that partners and switched-off staff
// are refused, that the activity entry carries the real role and never the text, and that the 16:30 reminder goes once
// per person per day only to staff who have not written, never on weekends or business holidays. It does NOT prove
// the live schema, the cron job (20261118162000) or the screen.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), admin: id(2), coord: id(3), field: id(4), off: id(5), partner: id(6) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Staff daily log: private per person, refused for others, reminder once per weekday', async () => {
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
      "create type public.user_role as enum ('owner','partner','administrator','coordinator','switchboard','hr','field_supervisor','field_consultant');",
      "create type public.activity_event_type as enum ('CREATE','UPDATE','DELETE');",
      "create type public.notification_event_type as enum ('STAFF_TASK_ASSIGNED');",
      "create function public.current_sast_date() returns date language sql stable as $$ select (now() at time zone 'Africa/Johannesburg')::date $$;",
      "create table public.profiles(id uuid primary key, email text, full_name text, role public.user_role not null, is_active boolean not null default true);",
      'create table public.staff_access(profile_id uuid primary key references public.profiles(id), staff_role public.user_role not null, access_enabled boolean not null default true, created_at timestamptz not null default now());',
      "create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) $$;",
      `create function public.staff_role_of() returns text language sql stable security definer set search_path='' as $$
         select p.role::text from public.profiles p join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
          where p.id = (select auth.uid()) and p.is_active and s.access_enabled
            and p.role::text in ('switchboard','coordinator','administrator','hr','field_supervisor','field_consultant') $$;`,
      'create table public.activity_logs(id uuid primary key default gen_random_uuid(), occurred_at timestamptz not null default now(), user_id uuid, user_email text, user_role text, event_type public.activity_event_type not null, entity_type text not null, entity_id uuid, description text, before_values jsonb, after_values jsonb);',
      'create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid, event_type public.notification_event_type, title text, body_text text, link_url text, data jsonb, created_at timestamptz default now());',
      `create function public.staff_notify(p_user uuid, p_event public.notification_event_type, p_title text, p_body text, p_link text, p_data jsonb)
         returns void language sql security definer set search_path='' as $$
         insert into public.notifications(user_id,event_type,title,body_text,link_url,data) values (p_user,p_event,p_title,p_body,p_link,p_data) $$;`,
      'create table public.business_holidays(holiday_date date primary key, label text not null);',
      'grant usage on schema public, auth to authenticated;',
    ].join('\n'));
    await db.exec(`insert into public.profiles(id,email,full_name,role) values
      ('${U.owner}','owner@example.test','Founder','owner'),
      ('${U.admin}','admin@example.test','Admin','administrator'),
      ('${U.coord}','coord@example.test','Coord','coordinator'),
      ('${U.field}','field@example.test','Field','field_consultant'),
      ('${U.off}','off@example.test','Switched Off','hr'),
      ('${U.partner}','partner@example.test','Partner','partner');
      insert into public.staff_access(profile_id,staff_role,access_enabled) values
      ('${U.admin}','administrator',true),('${U.coord}','coordinator',true),('${U.field}','field_consultant',true),('${U.off}','hr',false);`);
    await db.exec(await mig('20261118140000_owner_daily_log.sql'));
    await db.exec(await mig('20261118160000_daily_log_reminder_enum.sql'));
    await db.exec(await mig('20261118161000_staff_daily_log.sql'));

    const today = (await one('select public.current_sast_date()::text d')).d;

    // Partner, switched-off staff and anonymous callers are refused on every RPC.
    for (const uid of [U.partner, U.off, null]) {
      await as(uid);
      await rejects(() => q('select * from public.owner_daily_log_get($1::date)', [today]), /permission to use the daily log/, '42501');
      await rejects(() => q('select public.owner_daily_log_save($1::date,$2,$3,$4)', [today, 'x', null, null]), /permission/, '42501');
      await rejects(() => q('select * from public.owner_daily_log_list($1::date,$2::date)', [today, today]), /permission/, '42501');
      await rejects(() => q('select * from public.owner_daily_log_activity($1::date)', [today]), /permission/, '42501');
    }

    // Each person writes their own entry.
    const write = async (uid, text) => { await as(uid); await one('select public.owner_daily_log_save($1::date,$2,$3,$4) s', [today, text, 'did', null]); };
    await write(U.owner, 'Director private');
    await write(U.admin, 'Admin private');
    await write(U.coord, 'Coord private');

    // Everyone sees only their own entry, through the RPCs and the table itself.
    for (const [uid, mine] of [[U.owner, 'Director private'], [U.admin, 'Admin private'], [U.coord, 'Coord private']]) {
      await as(uid);
      assert.equal((await one('select * from public.owner_daily_log_get($1::date)', [today])).what_happened, mine);
      const listed = await q('select what_happened from public.owner_daily_log_list($1::date,$2::date)', [today, today]);
      assert.deepEqual(listed.map((r) => r.what_happened), [mine]);
      const rows = await q('select owner_id::text o, what_happened from public.owner_daily_logs');
      assert.deepEqual(rows.map((r) => r.what_happened), [mine], 'RLS shows only the caller\'s own rows');
      // Writing someone else's row directly is refused.
      const other = uid === U.owner ? U.admin : U.owner;
      await rejects(() => q(`insert into public.owner_daily_logs(owner_id,log_date,what_happened) values ('${other}','${today}','sneaky')`), /row-level security/);
      assert.equal((await q(`update public.owner_daily_logs set what_happened = 'hack' where owner_id = '${other}' returning 1`)).length, 0);
    }

    // The activity entries carry the writer's real role and never the text.
    await as(null);
    const logs = await q("select user_id::text u, user_role, description from public.activity_logs where entity_type = 'daily_log' order by user_role");
    assert.deepEqual(logs.map((r) => r.user_role), ['administrator', 'coordinator', 'owner']);
    for (const r of logs) assert.match(r.description, /^Daily log updated for \d{4}-\d{2}-\d{2}$/);

    // Reminder: a weekday with no holiday. Only enabled staff who have not written get one (field consultant here);
    // the Director, partners and switched-off staff never do. A second run sends nothing.
    const weekday = (await one(`select d::text d from generate_series(current_date + 1, current_date + 7, interval '1 day') d
                                 where extract(isodow from d) = 3 limit 1`)).d;
    const at = (day, hhmm) => `(('${day}'::date)::timestamp + time '${hhmm}') at time zone 'Africa/Johannesburg'`;
    // Make the admin "write" on that day so only coord + field are due.
    await db.exec(`insert into public.owner_daily_logs(owner_id,log_date,what_happened) values ('${U.admin}','${weekday}','wrote it');
                   insert into public.owner_daily_logs(owner_id,log_date,what_happened) values ('${U.coord}','${weekday}',null);`);
    const sent = await one(`select public.send_daily_log_reminders(${at(weekday, '16:30')}) n`);
    assert.equal(sent.n, 2, 'coordinator (empty entry) and field consultant are reminded');
    const told = await q("select user_id::text u, link_url from public.notifications where event_type = 'DAILY_LOG_REMINDER' order by user_id");
    assert.deepEqual(told.map((r) => r.u), [U.coord, U.field]);
    assert.ok(told.every((r) => r.link_url === '/staff/daily-log'));
    assert.equal((await one(`select public.send_daily_log_reminders(${at(weekday, '16:45')}) n`)).n, 0, 'once per person per day');

    // Weekend and business holiday: nothing.
    const saturday = (await one(`select d::text d from generate_series(current_date + 1, current_date + 7, interval '1 day') d
                                  where extract(isodow from d) = 6 limit 1`)).d;
    assert.equal((await one(`select public.send_daily_log_reminders(${at(saturday, '16:30')}) n`)).n, 0);
    const thursday = (await one(`select ('${weekday}'::date + 1)::text d`)).d;
    await db.exec(`insert into public.business_holidays(holiday_date,label) values ('${thursday}','Test holiday')`);
    assert.equal((await one(`select public.send_daily_log_reminders(${at(thursday, '16:30')}) n`)).n, 0);

    // The sweep is server-only.
    await as(U.admin);
    await rejects(() => q('select public.send_daily_log_reminders()'), /permission denied/);
    await rejects(() => q('select * from public.daily_log_reminders_sent'), /permission denied/);
  } finally {
    await db.close();
  }
});
