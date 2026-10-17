import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Team diaries (Batch 1b): runs the staff-build migrations, the Administrator migrations and the two team-diary
// migrations against an isolated PostgreSQL (PGlite), switching real database roles with auth.uid() claims.
// It proves who may book, move and cancel, the time rules, that every change queues exactly one client email
// (older unsent ones superseded), the in-app notices, and that a team member sees only their own diary. It
// does NOT prove the live schema, the Edge Function's email send, or multi-session concurrency.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), agent: id(7), subagent: id(8), partner2: id(9) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Team diaries: booking, moves, cancellations, client emails and access are enforced by the database', async () => {
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
      'create table public.profiles(id uuid primary key, email text, full_name text, role public.user_role not null default \'partner\', referral_partner_id uuid, sourced_via_partner_id uuid, is_active boolean not null default true, phone_number text, created_at timestamptz not null default now());',
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
    await db.exec(await mig('20261018100000_team_diary_enum.sql'));
    const profile = (uid, name, role) => `insert into public.profiles(id,email,full_name,role) values ('${uid}','${name}@example.test','${name}','${role}');`;
    await db.exec([
      profile(U.owner, 'Founder', 'owner'), profile(U.coordinator, 'Coordinator', 'coordinator'),
      profile(U.switchboard, 'Switchboard', 'switchboard'), profile(U.admin, 'Administrator', 'administrator'),
      profile(U.partner, 'Partner', 'partner'), profile(U.adminOff, 'AdminOff', 'administrator'),
      profile(U.agent, 'Agent', 'contractor'), profile(U.subagent, 'SubAgent', 'lead_referrer'), profile(U.partner2, 'Partner2', 'partner'),
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

    // Email sending is out of scope here: an empty Vault makes invoke_send_team_appointment_email a no-op.
    await db.exec("create schema if not exists vault; create table vault.decrypted_secrets(name text, decrypted_secret text);");
    await db.exec(await mig('20261018101000_team_diaries.sql'));
    await db.exec("update public.profiles set phone_number = '071 555 0101' where id = '" + U.agent + "';");

    const sast = (daysAhead, hour, min = 0) => {
      const d = new Date(); d.setUTCDate(d.getUTCDate() + daysAhead); d.setUTCHours(hour - 2, min, 0, 0); return d.toISOString();
    };
    const dayWith = (dow, from = 3) => { for (let o = from; o < from + 14; o++) if (new Date(sast(o, 12)).getUTCDay() === dow) return o; };
    const TUE = dayWith(2); const WED = dayWith(3); const SAT = dayWith(6);

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    const book = (over = {}) => {
      const a = { member: U.agent, name: 'Thabo Client', email: 'Thabo@Example.test', phone: '082 000 1111', reason: 'Discuss working capital for the bakery',
                  s: sast(TUE, 10), e: sast(TUE, 11), key: 'k-' + Math.random().toString(36).slice(2, 12), ...over };
      return one('select public.team_book_appointment($1,$2,$3,$4,$5,$6,$7,null,$8) as r', [a.member, a.name, a.email, a.phone, a.reason, a.s, a.e, a.key]).then((x) => x.r);
    };
    const rejects = async (fn, pattern, code) => {
      await assert.rejects(fn, (e) => { assert.match(e.message, pattern); if (code) assert.equal(e.code, code); return true; });
    };

    // ---- Who can book -----------------------------------------------------------------------------
    await as(U.coordinator);
    const members = await q('select * from public.team_diary_members()');
    assert.deepEqual(members.map((m) => m.member_type).sort(), ['Direct agent', 'Partner', 'Partner', 'Sub-agent'], 'agents, sub-agents and partners are bookable; staff and the owner are not');
    const first = await book();
    assert.equal(first.status, 'created');
    await as(U.switchboard);
    const reception = await book({ member: U.subagent, s: sast(WED, 9), e: sast(WED, 9, 45), name: 'Lerato Client', email: 'lerato@example.test' });
    assert.equal(reception.status, 'created', 'Reception books on a team diary');
    await as(U.admin);
    await book({ member: U.partner, s: sast(WED, 14), e: sast(WED, 15), name: 'Partner Client', email: 'pc@example.test' });
    await as(U.partner);
    await rejects(() => book({ member: U.partner2 }), /Only the Founder, the Administrator/, '42501');
    await as(U.adminOff);
    await rejects(() => book({ member: U.agent, s: sast(WED, 10), e: sast(WED, 11) }), /Only the Founder, the Administrator/, '42501');

    // ---- Rules -----------------------------------------------------------------------------------
    await as(U.coordinator);
    await rejects(() => book({ s: sast(TUE, 10, 30), e: sast(TUE, 11, 30) }), /overlaps/);
    await rejects(() => book({ s: sast(TUE, 16, 30), e: sast(TUE, 17, 30) }), /08:00 and 17:00/);
    await rejects(() => book({ s: sast(SAT, 10), e: sast(SAT, 11) }), /weekends/);
    await rejects(() => book({ email: 'not-an-email' }), /valid client email/);
    await rejects(() => book({ reason: 'short' }), /reason/);
    await rejects(() => book({ reason: 'ID 8001015009087 call back please' }), /ID or account-length/);
    await rejects(() => book({ member: U.coordinator }), /active direct agent/);
    const keyed = await book({ s: sast(WED, 11), e: sast(WED, 12), key: 'replay-key-1' });
    const dup = await book({ s: sast(WED, 11), e: sast(WED, 12), key: 'replay-key-1' });
    assert.equal(dup.status, 'existing', 'a double click returns the same appointment');
    assert.equal(dup.appointment_id, keyed.appointment_id);

    // ---- Emails and notices ------------------------------------------------------------------------
    await db.exec('reset role;');
    const emails = async (id) => q('select kind, status, recipient_email from public.team_appointment_emails where appointment_id=$1 order by revision', [id]);
    assert.deepEqual(await emails(first.appointment_id), [{ kind: 'booked', status: 'queued', recipient_email: 'thabo@example.test' }]);
    const agentNotes = await q("select title, link_url from public.notifications where user_id=$1 and event_type='TEAM_APPOINTMENT_CHANGED'", [U.agent]);
    assert.ok(agentNotes.some((n) => n.title === 'New appointment booked for you' && n.link_url === '/contractor/appointments'), 'the agent is told, with a link to their portal');
    const payload = (await one("select public.team_appointment_email_payload(id) p from public.team_appointment_emails where appointment_id=$1", [first.appointment_id])).p;
    assert.equal(payload.member_name, 'Agent');
    assert.equal(payload.member_phone, '071 555 0101');
    assert.equal(payload.member_email, 'Agent@example.test');
    assert.equal(payload.kind, 'booked');

    // ---- The team member's own view and changes -----------------------------------------------------
    await as(U.agent);
    const mine = await q('select * from public.team_appointments_list(null,$1,$2)', [sast(-1, 0), sast(30, 0)]);
    assert.ok(mine.length >= 2 && mine.every((r) => r.member_id === U.agent), 'an agent sees only their own diary');
    const peek = await q('select * from public.team_appointments_list($1,$2,$3)', [U.subagent, sast(-1, 0), sast(30, 0)]);
    assert.ok(peek.every((r) => r.member_id === U.agent), 'asking for another member still shows only your own');
    await rejects(() => q('select * from public.team_appointments'), /permission denied/);
    await rejects(() => q('select * from public.team_diary_members()'), /permission/, '42501');
    await q("select public.team_move_appointment($1,$2,$3,'Client asked for later')", [first.appointment_id, sast(TUE, 13), sast(TUE, 14)]);
    await as(U.subagent);
    await rejects(() => q("select public.team_cancel_appointment($1,'Not mine to cancel')", [first.appointment_id]), /cannot change/, '42501');
    await rejects(() => q('select * from public.team_appointment_email_payload($1)', [first.appointment_id]), /permission denied/);
    await as(U.coordinator);
    await q("select public.team_cancel_appointment($1,'Client went with another lender')", [first.appointment_id]);
    await rejects(() => q("select public.team_move_appointment($1,$2,$3,'Too late now')", [first.appointment_id, sast(TUE, 15), sast(TUE, 16)]), /future scheduled/);

    await db.exec('reset role;');
    const after = await emails(first.appointment_id);
    assert.deepEqual(after.map((e) => [e.kind, e.status]), [['booked', 'superseded'], ['moved', 'superseded'], ['cancelled', 'queued']],
      'each change queues one client email and replaces the unsent older one');
    const coordNotes = await q("select title from public.notifications where user_id=$1 and event_type='TEAM_APPOINTMENT_CHANGED'", [U.coordinator]);
    assert.ok(coordNotes.some((n) => n.title === 'Team appointment moved'), 'the booker is told when the agent moves it');
    const agentAfter = await q("select title from public.notifications where user_id=$1 and event_type='TEAM_APPOINTMENT_CHANGED' order by created_at", [U.agent]);
    assert.ok(agentAfter.some((n) => n.title === 'Appointment cancelled'));
    assert.ok(!agentAfter.some((n) => n.title === 'Appointment moved'), 'the agent is not notified of their own move');
    const changes = await q('select kind, actor_role from public.team_appointment_changes where appointment_id=$1 order by created_at', [first.appointment_id]);
    assert.deepEqual(changes.map((c) => [c.kind, c.actor_role]), [['booked', 'coordinator'], ['moved', 'team_member'], ['cancelled', 'coordinator']]);
    await rejects(() => q("update public.team_appointment_changes set reason='x'"), /append-only/);

    // ---- Sender claim is single-use --------------------------------------------------------------------
    const queued = (await one("select id from public.team_appointment_emails where appointment_id=$1 and status='queued'", [first.appointment_id])).id;
    await db.exec('set role service_role;');
    await q('select public.claim_team_appointment_email($1)', [queued]);
    await rejects(() => q('select public.claim_team_appointment_email($1)', [queued]), /not claimable/);
    await q("select public.record_team_appointment_email_result($1,'sent','re_123',null)", [queued]);
    await db.exec('reset role;');
    assert.equal((await one('select status from public.team_appointment_emails where id=$1', [queued])).status, 'sent');
  } finally {
    await db.close();
  }
});
