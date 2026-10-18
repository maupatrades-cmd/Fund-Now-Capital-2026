import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Administrator batch 1: runs the staff-build migrations and the two Administrator migrations against an
// isolated PostgreSQL (PGlite) with a synthetic prerequisite schema, switching real database roles with
// auth.uid() claims. It proves the database enforces the role, the Founder-diary booking windows, the
// Important / after-hours approvals, the booking notices and meeting notes. It does NOT prove the live
// schema, the notification bell in a browser, or multi-session concurrency.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Administrator role, booking windows, approvals, notices and meeting notes are enforced by the database', async () => {
  const db = new PGlite({ extensions: { btree_gist } });
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
      "create type public.user_role as enum ('owner','partner','contractor','client','lead_referrer');",
      "create type public.document_type as enum ('cipc_cert','tax_clearance','bank_statement','id_copy','proof_of_address','other');",
      "create type public.notification_event_type as enum ('FOLLOW_UP_DUE');",
      "create type public.notification_delivery_status as enum ('pending','delivered','skipped','failed');",
      'create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;',
      'create function public.current_sast_date() returns date language sql stable as $$ select (now() at time zone \'Africa/Johannesburg\')::date $$;',
      "create table public.referral_partners(id uuid primary key default gen_random_uuid(), name text not null unique, contact_email text, contact_phone text, is_active boolean not null default true, notes text, created_at timestamptz default now(), updated_at timestamptz default now());",
      'create table public.profiles(id uuid primary key, email text, full_name text, role public.user_role not null default \'partner\', referral_partner_id uuid, sourced_via_partner_id uuid, is_active boolean not null default true, created_at timestamptz not null default now());',
      "create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) $$;",
      'create table public.funding_product_catalog(code text primary key, display_name text not null, is_active boolean not null default true);',
      'create table public.document_requirement_rules(id uuid primary key default gen_random_uuid(), rule_scope text, product_code text, document_type public.document_type, requirement text, is_active boolean default true);',
      "create table public.leads(id uuid primary key default gen_random_uuid(), business_name text not null, contact_name text not null, contact_cell text, contact_email text, cipc_number text, funding_amount numeric(14,2), funding_purpose jsonb not null default '[]', entered_by uuid, created_at timestamptz not null default now());",
      'create table public.clients(id uuid primary key default gen_random_uuid(), business_name text, cipc_number text);',
      'create table public.deals(id uuid primary key default gen_random_uuid(), lead_id uuid, stage text not null default \'new_lead\');',
      'create table public.documents(id uuid primary key default gen_random_uuid(), lead_id uuid, document_type public.document_type, is_current_version boolean default true);',
      'create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid, event_type public.notification_event_type, title text, body_text text, link_url text, data jsonb, read_status boolean, read_at timestamptz, created_at timestamptz default now());',
      'create table public.notification_deliveries(id uuid primary key default gen_random_uuid(), notification_id uuid, channel text, delivery_status public.notification_delivery_status, sent_at timestamptz, delivered_at timestamptz);',
      "create function public.check_notification_channel_enabled(p_user uuid, p_event public.notification_event_type, p_channel text) returns boolean language sql stable as $$ select true $$;",
      'alter table public.profiles enable row level security;',
      'create policy profiles_owner_all on public.profiles for all to authenticated using (public.is_owner()) with check (public.is_owner());',
      'create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());',
      'grant usage on schema public, auth to authenticated;',
      'grant select, update on public.profiles to authenticated;',
      'grant select on public.referral_partners, public.leads, public.deals, public.documents, public.clients to authenticated;',
    ].join('\n'));
    await db.exec(await mig('20261007090000_staff_roles_enum.sql'));
    await db.exec(await mig('20261018090000_administrator_role_enum.sql'));
    const profile = (uid, name, role) => `insert into public.profiles(id,email,full_name,role) values ('${uid}','${name}@example.test','${name}','${role}');`;
    await db.exec([
      profile(U.owner, 'Founder', 'owner'), profile(U.coordinator, 'Coordinator', 'coordinator'),
      profile(U.switchboard, 'Switchboard', 'switchboard'), profile(U.admin, 'Administrator', 'administrator'),
      profile(U.partner, 'Partner', 'partner'), profile(U.adminOff, 'AdminOff', 'administrator'),
      profile(U.sb2, 'Reception2', 'switchboard'),
    ].join('\n'));
    await db.exec('alter default privileges in schema public grant all on tables to authenticated;');
    await db.exec([
      'create extension btree_gist; create role service_role;',
      "create table public.owner_availability_slots(id uuid primary key default gen_random_uuid(), owner_id uuid not null, starts_at timestamptz not null, ends_at timestamptz not null, allowed_booking_types text[] not null default '{consultation,call}', is_open boolean not null default true);",
      "create table public.crm_bookings(id uuid primary key default gen_random_uuid(), slot_id uuid not null references public.owner_availability_slots(id), status text not null default 'requested');",
      "create table public.owner_calendar_events(id uuid primary key default gen_random_uuid(), owner_id uuid not null, title text not null, category text not null, starts_at timestamptz not null, ends_at timestamptz not null, visibility text not null default 'private', public_title text, private_notes text, lead_id uuid, booking_id uuid, status text not null default 'scheduled', created_by uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (ends_at > starts_at), check (visibility <> 'public' or public_title is not null));",
      "alter table public.owner_calendar_events add constraint owner_calendar_events_no_overlap exclude using gist (owner_id with =, tstzrange(starts_at, ends_at, '[)') with &&) where (status = 'scheduled');",
      "create function public.calendar_is_consultation_window(s timestamptz, e timestamptz) returns boolean language sql immutable as $$ select e > s $$;", // as live: 20260816214614 lifted the consultation hours
      'alter table public.owner_calendar_events enable row level security; alter table public.owner_availability_slots enable row level security; alter table public.crm_bookings enable row level security;',
    ].join('\n'));
    for (const f of ['20261007091000_staff_access_and_audit.sql', '20261007092000_organisation_team_structure.sql',
      '20261007093000_submission_intake_core.sql', '20261007094000_submission_intake_rpcs.sql', '20261007100000_switchboard_operations.sql',
      '20261007101000_staff_intake_lookups.sql', '20261007102000_calendar_delegation.sql',
      '20261010051353_calendar_notice_revision_guard.sql', '20261007210000_sc4_founder_open_slots.sql',
      '20261007211000_sc4_time_request_categories.sql', '20261018091000_administrator_batch1.sql']) {
      await db.exec(await mig(f));
    }

    const sast = (daysAhead, hour, min = 0) => {
      const d = new Date(); d.setUTCDate(d.getUTCDate() + daysAhead); d.setUTCHours(hour - 2, min, 0, 0); return d.toISOString();
    };
    const dayWith = (dow, from = 3) => { for (let o = from; o < from + 14; o++) if (new Date(sast(o, 12)).getUTCDay() === dow) return o; };
    const TUE = dayWith(2); const WED = dayWith(3); const THU = dayWith(4); const SAT = dayWith(6);
    const founder = U.owner;

    // ---- Role and access --------------------------------------------------------------
    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01'], [U.sb2, 'SA-02']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    for (const p of ['create', 'view_availability', 'change_own']) {
      await q('select public.owner_set_calendar_grant($1,$2,$3)', [founder, U.coordinator, p]);
      await q('select public.owner_set_calendar_grant($1,$2,$3)', [founder, U.switchboard, p]);
    }
    await as(U.admin);
    assert.equal((await one('select public.staff_actor_role() r')).r, 'administrator');
    // Coordinator-only screens (check-ins) open for the Administrator; Owner-only ones stay closed.
    assert.ok(Array.isArray(await q("select * from public.staff_checkin_list('open')")), 'Administrator carries Coordinator authority');
    await rejects(() => q("select public.owner_set_calendar_grant($1,$2,'create')", [founder, U.switchboard]), /Only the owner/, '42501');
    const adminGrants = await q('select permission from public.staff_my_calendar_grants() where calendar_owner_id=$1', [founder]);
    assert.deepEqual(adminGrants.map((g) => g.permission).sort(), ['change_own', 'create', 'manage_others', 'view_availability'], 'all four rights on the Founder diary, no grant needed');
    await as(U.adminOff);
    assert.equal((await one('select public.staff_actor_role() r')).r, null, 'an Administrator who is not switched on has no authority');
    await rejects(() => q('select * from public.staff_my_calendar_grants()'), /permission/, '42501');

    // ---- Booking windows ------------------------------------------------------------------
    const create = (over = {}) => {
      const a = { cal: founder, title: 'Planning', cat: 'call', s: sast(TUE, 9), e: sast(TUE, 10), vis: 'busy', key: 'k-' + Math.random().toString(36).slice(2, 12), ...over };
      return one("select public.staff_create_calendar_event($1,$2,$3,$4,$5,$6,null,'Agenda',null,null,null,$7) as r",
        [a.cal, a.title, a.cat, a.s, a.e, a.vis, a.key]).then((x) => x.r);
    };
    await as(U.admin);
    const adminBooking = await create({ title: 'Admin planning', s: sast(TUE, 9), e: sast(TUE, 10) });
    assert.equal(adminBooking.status, 'created', 'Administrator books 09:00 without the Founder opening a slot');
    await rejects(() => create({ s: sast(TUE, 15), e: sast(TUE, 16) }), /booking window .* 08:30 to 14:00/);
    await rejects(() => create({ s: sast(TUE, 8, 0), e: sast(TUE, 8, 30) }), /08:30 to 14:00/);
    const adminConsult = await create({ cat: 'consultation', title: 'Client consultation', s: sast(TUE, 15), e: sast(TUE, 16) });
    assert.equal(adminConsult.status, 'created', 'consultations run to 17:00');
    assert.equal((await create({ cat: 'consultation', title: 'Morning consultation', s: sast(THU, 10), e: sast(THU, 11) })).status, 'created',
      'the owner allows morning consultations from the Administrator and the Coordinator');
    await rejects(() => create({ cat: 'presentation', s: sast(THU, 12), e: sast(THU, 13) }), /14:00 to 17:00/);
    await as(U.coordinator);
    await create({ title: 'Coordinator call', s: sast(TUE, 11), e: sast(TUE, 12) });
    await rejects(() => create({ s: sast(TUE, 16, 30), e: sast(TUE, 17, 30) }), /08:30 to 14:00/);
    await as(U.switchboard);
    await create({ title: 'Early call', s: sast(WED, 8), e: sast(WED, 8, 45) });
    assert.equal((await create({ cat: 'consultation', title: 'Reception lead consultation', s: sast(WED, 9, 30), e: sast(WED, 10, 15) })).status, 'created',
      'Reception books a morning consultation for an outbound lead');
    await create({ title: 'Late call', s: sast(WED, 16), e: sast(WED, 17) });
    await rejects(() => create({ s: sast(WED, 17, 30), e: sast(WED, 18) }), /08:00 to 17:00/);
    await rejects(() => create({ s: sast(SAT, 10), e: sast(SAT, 11) }), /weekends/);
    await as(U.owner);
    await create({ title: 'Founder evening', s: sast(WED, 18), e: sast(WED, 19) });

    // ---- Notices: Founder notified, Administrator CC'd, actor not notified -------------------
    await db.exec('reset role;');
    const notes = async (uid) => q("select title, body_text, link_url from public.notifications where user_id=$1 and event_type='DIARY_BOOKING_CHANGED' order by created_at, title", [uid]);
    const ownerNotes = await notes(U.owner);
    const adminNotes = await notes(U.admin);
    assert.ok(ownerNotes.some((n) => n.body_text.startsWith('Admin planning')), 'Founder is told about the Administrator booking');
    assert.ok(!adminNotes.some((n) => n.body_text.startsWith('Admin planning')), 'the actor is not notified of their own booking');
    assert.ok(adminNotes.some((n) => n.title === 'Diary: booking created (CC)' && n.body_text.startsWith('Coordinator call')), 'Administrator is CC\'d on the Coordinator booking');
    assert.ok(adminNotes.some((n) => n.body_text.startsWith('Founder evening')), 'Administrator is CC\'d on the Founder\'s own booking');
    assert.ok(!ownerNotes.some((n) => n.body_text.startsWith('Founder evening')), 'Founder is not notified of their own booking');
    assert.equal((await one("select count(*)::int c from public.notifications where user_id=$1", [U.adminOff])).c, 0, 'a switched-off Administrator gets nothing');
    assert.equal((await one("select count(*)::int c from public.notification_deliveries where channel='in_app' and delivery_status='delivered'")).c,
      (await one("select count(*)::int c from public.notifications")).c);

    // ---- Moves keep the window; moves and cancels notify ---------------------------------------
    await as(U.admin);
    await rejects(() => q("select public.staff_reschedule_calendar_event($1,$2,$3,'Founder asked')", [adminBooking.event_id, sast(TUE, 16, 15), sast(TUE, 16, 45)]), /08:30 to 14:00/);
    await q("select public.staff_reschedule_calendar_event($1,$2,$3,'Founder asked')", [adminBooking.event_id, sast(TUE, 12, 30), sast(TUE, 13, 30)]);
    await q("select public.staff_cancel_calendar_event($1,'Not needed now')", [adminConsult.event_id]);
    await db.exec('reset role;');
    const after = await notes(U.owner);
    assert.ok(after.some((n) => n.title === 'Diary: booking moved'));
    assert.ok(after.some((n) => n.title === 'Diary: booking cancelled'));

    // ---- Diary titles for the Administrator -------------------------------------------------------
    await as(U.coordinator);
    const priv = await create({ title: 'Private chat', vis: 'private', s: sast(TUE, 13, 45), e: sast(TUE, 13, 59) }).catch(() => null);
    await as(U.admin);
    const diary = Object.fromEntries((await q('select * from public.staff_calendar_diary($1,$2,$3)', [founder, sast(Math.min(TUE, WED) - 1, 0), sast(Math.max(TUE, WED) + 1, 0)])).map((r) => [r.display_title, r]));
    assert.ok(diary['Coordinator call'], 'Administrator sees the real title of a Busy booking');
    assert.ok(diary['Founder evening']);
    if (priv) assert.ok(diary.Private, 'Private stays Private');
    assert.equal(diary['Coordinator call'].can_change, true, 'Administrator can manage others\' bookings');

    // ---- Important / after-hours requests and approvals ------------------------------------------------
    await as(U.coordinator);
    const req = (s, e, reason = 'Client can only meet after work') =>
      one("select public.staff_request_founder_time($1,'call',$2,$3,$4) as id", [founder, s, e, reason]).then((x) => x.id);
    const afterHours = await req(sast(TUE, 17, 30), sast(TUE, 18, 30));
    const important = await req(sast(WED, 15), sast(WED, 15, 45), 'Urgent pack review with a funder deadline');
    await rejects(() => req(sast(TUE, 18, 30), sast(TUE, 19, 30)), /08:00 and 19:00/);
    await rejects(() => req(sast(SAT, 10), sast(SAT, 11)), /weekends/);
    await rejects(() => req(sast(TUE, 17, 30), sast(TUE, 18), 'short'), /at least 10/);
    await rejects(() => one("select public.staff_request_founder_time($1,'presentation',$2,$3,'Investor deck walkthrough') as id", [founder, sast(TUE, 11), sast(TUE, 12)]), /Presentations start from 14:00/);
    const morningConsult = (await one("select public.staff_request_founder_time($1,'consultation',$2,$3,'Client only free this morning') as id", [founder, sast(THU, 8), sast(THU, 8, 25)])).id;
    await db.exec('reset role;');
    assert.equal((await one('select kind from public.calendar_time_requests where id=$1', [afterHours])).kind, 'after_hours');
    assert.equal((await one('select kind from public.calendar_time_requests where id=$1', [important])).kind, 'important');
    await as(U.switchboard);
    await rejects(() => q('select public.owner_decide_time_request($1,true,null)', [afterHours]), /Founder or the Administrator/, '42501');
    assert.equal((await q('select * from public.staff_time_requests(null)')).length, 0, 'Switchboard only sees its own requests');
    await as(U.admin);
    assert.equal((await q("select * from public.staff_time_requests('pending')")).length, 3, 'Administrator sees every request');
    assert.ok((await one('select public.owner_decide_time_request($1,true,null) as e', [morningConsult])).e, 'a morning consultation request can be approved');
    const ev = (await one('select public.owner_decide_time_request($1,true,null) as e', [afterHours])).e;
    assert.ok(ev, 'Administrator approves and the time is booked');
    await db.exec('reset role;');
    assert.equal((await one('select created_by from public.owner_calendar_events where id=$1', [ev])).created_by, U.coordinator, 'the requester owns the approved booking');
    await as(U.admin);
    const own = (await one("select public.staff_request_founder_time($1,'call',$2,$3,'Late meeting the Founder asked for') as id", [founder, sast(WED, 17, 15), sast(WED, 17, 45)])).id;
    await rejects(() => q('select public.owner_decide_time_request($1,true,null)', [own]), /your own request/, '42501');
    await as(U.owner);
    assert.ok((await one('select public.owner_decide_time_request($1,true,null) as e', [own])).e, 'the Founder decides the Administrator\'s own request');
    await q("select public.owner_decide_time_request($1,false,'Not this week, sorry')", [important]);

    // Any enabled staff member may ask for Founder time without a grant; the Administrator decides
    // requests on the Founder's diary only.
    await as(U.sb2);
    assert.equal((await q('select * from public.staff_founder_calendar()'))[0].calendar_owner_id, founder);
    const noGrant = (await one("select public.staff_request_founder_time($1,'call',$2,$3,'Caller wants the Founder after five') as id", [founder, sast(THU, 17, 30), sast(THU, 18)])).id;
    assert.ok(noGrant, 'Reception without a diary grant can still send a request');
    await as(U.owner);
    await q("select public.owner_set_calendar_grant($1,$2,'create')", [U.coordinator, U.sb2]);
    await as(U.sb2);
    const otherDiary = (await one("select public.staff_request_founder_time($1,'call',$2,$3,'Coordinator diary request test') as id", [U.coordinator, sast(THU, 17, 30), sast(THU, 18)])).id;
    await as(U.admin);
    await rejects(() => q('select public.owner_decide_time_request($1,true,null)', [otherDiary]), /Founder's diary only/, '42501');
    await as(U.partner);
    await rejects(() => q('select * from public.staff_founder_calendar()'), /permission/, '42501');

    // ---- Meeting notes --------------------------------------------------------------------------------
    await as(U.admin);
    await q("select public.staff_add_meeting_note($1,'Agreed next steps with the client')", [ev]);
    await rejects(() => q("select public.staff_add_meeting_note($1,'ID 8001015009087')", [ev]), /ID or account-length/);
    await as(U.coordinator);
    await rejects(() => q("select public.staff_add_meeting_note($1,'Trying to write')", [ev]), /Founder or the Administrator/, '42501');
    await rejects(() => q('select * from public.staff_meeting_notes($1)', [ev]), /Founder or the Administrator/, '42501');
    await rejects(() => q('select * from public.calendar_meeting_notes'), /permission denied/);
    await as(U.owner);
    const list = await q('select * from public.staff_meeting_notes($1)', [ev]);
    assert.equal(list.length, 1);
    assert.equal(list[0].author_name, 'Administrator');
    await db.exec('reset role;');
    await rejects(() => q("update public.calendar_meeting_notes set note='changed'"), /append-only/);

    // ---- Nothing grants the Administrator a table policy -------------------------------------------------
    assert.equal((await one("select count(*)::int c from pg_policies where qual ilike '%administrator%' or with_check ilike '%administrator%'")).c, 0);
    await as(U.partner);
    await rejects(() => q('select * from public.staff_my_calendar_grants()'), /permission/, '42501');
  } finally {
    await db.close();
  }
});
