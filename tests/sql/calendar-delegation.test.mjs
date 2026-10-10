import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Batch 3 staff build: executes the Batch 1, 2 and 3 staff-build migrations against an
// isolated PostgreSQL (PGlite) with a minimal synthetic prerequisite schema and
// switches between real database roles with auth.uid() claims. It proves the
// database enforces authority; it does NOT prove the live schema, Supabase
// Storage policies, or multi-session concurrency (see the Batch 1 handover).
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = {
  owner: id(1), coordinator: id(2), switchboard: id(3), switchboardOff: id(4),
  partner1: id(5), partner2: id(6), teamLeader: id(7), agentOrg1: id(8), agentOrg2: id(9), direct: id(10),
};
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('delegated calendars, conflict protection, confirmations and check-ins are enforced by the database', async () => {
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
      'create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;',
      'create function public.current_sast_date() returns date language sql stable as $$ select (now() at time zone \'Africa/Johannesburg\')::date $$;',
      "create table public.referral_partners(id uuid primary key default gen_random_uuid(), name text not null unique, contact_email text, contact_phone text, is_active boolean not null default true, notes text, created_at timestamptz default now(), updated_at timestamptz default now());",
      'create table public.profiles(id uuid primary key, email text, full_name text, role public.user_role not null default \'partner\', referral_partner_id uuid, sourced_via_partner_id uuid, is_active boolean not null default true);',
      "create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) $$;",
      'create table public.funding_product_catalog(code text primary key, display_name text not null, is_active boolean not null default true);',
      'create table public.document_requirement_rules(id uuid primary key default gen_random_uuid(), rule_scope text, product_code text, document_type public.document_type, requirement text, is_active boolean default true);',
      "create table public.leads(id uuid primary key default gen_random_uuid(), business_name text not null, contact_name text not null, contact_cell text, contact_email text, cipc_number text, funding_amount numeric(14,2), funding_purpose jsonb not null default '[]', entered_by uuid, created_at timestamptz not null default now());",
      'create table public.clients(id uuid primary key default gen_random_uuid(), business_name text, cipc_number text);',
      'create table public.deals(id uuid primary key default gen_random_uuid(), lead_id uuid, stage text not null default \'new_lead\');',
      'create table public.documents(id uuid primary key default gen_random_uuid(), lead_id uuid, document_type public.document_type, is_current_version boolean default true);',
      'alter table public.profiles enable row level security;',
      'create policy profiles_owner_all on public.profiles for all to authenticated using (public.is_owner()) with check (public.is_owner());',
      'create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());',
      'grant usage on schema public, auth to authenticated;',
      'grant select, update on public.profiles to authenticated;',
      'grant select on public.referral_partners to authenticated;',
      'grant select on public.leads, public.deals, public.documents, public.clients to authenticated;',
      "insert into public.referral_partners(id,name) values ('" + id(101) + "','Seed Org One'),('" + id(102) + "','Seed Org Two');",
    ].join('\n'));
    const org1 = id(101);
    const org2 = id(102);
    const profile = (uid, name, role, partner = null, via = null) =>
      `insert into public.profiles(id,email,full_name,role,referral_partner_id,sourced_via_partner_id) values ('${uid}','${name}@example.test','${name}','${role}',${partner ? `'${partner}'` : 'null'},${via ? `'${via}'` : 'null'});`;
    // Owner-provisioned fixtures; staff roles are added after the enum migration.
    await db.exec(await mig('20261007090000_staff_roles_enum.sql'));
    await db.exec([
      profile(U.owner, 'owner', 'owner'),
      profile(U.coordinator, 'coordinator', 'coordinator'),
      profile(U.switchboard, 'switchboard', 'switchboard'),
      profile(U.switchboardOff, 'switchboard_off', 'switchboard'),
      profile(U.partner1, 'partner_one', 'partner', org1),
      profile(U.partner2, 'partner_two', 'partner', org2),
      profile(U.teamLeader, 'team_leader', 'lead_referrer', null, org1),
      profile(U.agentOrg1, 'agent_org1', 'lead_referrer', null, org1),
      profile(U.agentOrg2, 'agent_org2', 'lead_referrer', null, org2),
      profile(U.direct, 'direct_agent', 'lead_referrer'),
      "insert into public.funding_product_catalog(code,display_name) values ('working_capital','Working capital');",
      "insert into public.document_requirement_rules(rule_scope,product_code,document_type,requirement) values ('product_baseline','working_capital','cipc_cert','required'),('product_baseline','working_capital','bank_statement','required'),('product_baseline','working_capital','id_copy','optional');",
    ].join('\n'));
    // Supabase grants new public tables to `authenticated` by default; RLS (and
    // the explicit revokes in the migrations) is what actually restricts them.
    await db.exec('alter default privileges in schema public grant all on tables to authenticated;');
    await db.exec([
      'create extension btree_gist; create role service_role;',
      "create table public.owner_availability_slots(id uuid primary key default gen_random_uuid(), owner_id uuid not null, starts_at timestamptz not null, ends_at timestamptz not null, is_open boolean not null default true);",
      "create table public.crm_bookings(id uuid primary key default gen_random_uuid(), slot_id uuid not null references public.owner_availability_slots(id), status text not null default 'requested');",
      "create table public.owner_calendar_events(id uuid primary key default gen_random_uuid(), owner_id uuid not null, title text not null, category text not null, starts_at timestamptz not null, ends_at timestamptz not null, visibility text not null default 'private', public_title text, private_notes text, lead_id uuid, booking_id uuid, status text not null default 'scheduled', created_by uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (ends_at > starts_at), check (visibility <> 'public' or public_title is not null));",
      "alter table public.owner_calendar_events add constraint owner_calendar_events_no_overlap exclude using gist (owner_id with =, tstzrange(starts_at, ends_at, '[)') with &&) where (status = 'scheduled');",
      "create function public.calendar_is_consultation_window(s timestamptz, e timestamptz) returns boolean language sql immutable as $$ select (s at time zone 'Africa/Johannesburg')::time >= time '14:00' and (e at time zone 'Africa/Johannesburg')::time <= time '20:00' $$;",
      'alter table public.owner_calendar_events enable row level security; alter table public.owner_availability_slots enable row level security; alter table public.crm_bookings enable row level security;',
    ].join('\n'));
    for (const f of ['20261007091000_staff_access_and_audit.sql', '20261007092000_organisation_team_structure.sql',
      '20261007093000_submission_intake_core.sql', '20261007094000_submission_intake_rpcs.sql', '20261007100000_switchboard_operations.sql', '20261007101000_staff_intake_lookups.sql', '20261007102000_calendar_delegation.sql']) {
      await db.exec(await mig(f));
    }



    // ---- Fixtures -----------------------------------------------------------
    const sast = (daysAhead, hour, min = 0) => {
      const d = new Date(); d.setUTCDate(d.getUTCDate() + daysAhead); d.setUTCHours(hour - 2, min, 0, 0); return d.toISOString();
    };
    const dayWith = (dow, from = 3) => { for (let o = from; o < from + 14; o++) if (new Date(sast(o, 12)).getUTCDay() === dow) return o; };
    const TUE = dayWith(2); const SAT = dayWith(6);
    const founder = U.owner;

    await as(U.owner);
    await q("select public.owner_set_staff_access($1,true,'FNC-EMP-SC-01')", [U.coordinator]);
    await q("select public.owner_set_staff_access($1,true,'FNC-EMP-SA-01')", [U.switchboard]);
    const grant = (who, perm, cal = founder) => one('select public.owner_set_calendar_grant($1,$2,$3) as id', [cal, who, perm]).then((x) => x.id);
    await rejects(() => grant(U.switchboardOff, 'create'), /enabled staff member/);
    await rejects(() => grant(U.coordinator, 'delete_everything'), /violates check/);
    const gManage = await grant(U.coordinator, 'manage_others');
    await grant(U.coordinator, 'create'); await grant(U.coordinator, 'view_availability'); await grant(U.coordinator, 'change_own');
    await rejects(() => grant(U.coordinator, 'create'), /already granted/);
    const gSbCreate = await grant(U.switchboard, 'create'); await grant(U.switchboard, 'view_availability'); await grant(U.switchboard, 'change_own');
    await as(U.coordinator);
    await rejects(() => q('select public.owner_set_calendar_grant($1,$2,$3)', [founder, U.switchboardOff, 'create']), /Only the owner/, '42501');

    // ---- Availability: busy/open only, per-calendar scoping ----------------------
    await as(U.switchboard);
    const av = await q('select * from public.calendar_availability($1,$2,$3)', [founder, sast(TUE - 1, 0), sast(TUE + 1, 0)]);
    assert.deepEqual(Object.keys(av.length ? av[0] : { kind: 1, starts_at: 1, ends_at: 1 }).sort(), ['ends_at', 'kind', 'starts_at']);
    await rejects(() => q('select * from public.calendar_availability($1,$2,$3)', [U.teamLeader, sast(TUE, 0), sast(TUE + 1, 0)]), /calendar permission/, '42501');
    await as(U.partner1);
    await rejects(() => q('select * from public.calendar_availability($1,$2,$3)', [founder, sast(TUE, 0), sast(TUE + 1, 0)]), /calendar permission/, '42501');
    await as(U.switchboardOff);
    await rejects(() => q('select * from public.calendar_availability($1,$2,$3)', [founder, sast(TUE, 0), sast(TUE + 1, 0)]), /calendar permission/, '42501');

    // ---- Create: rules, buffer, weekends, holidays, idempotency ---------------------
    await as(U.switchboard);
    const create = (over = {}) => {
      const a = { cal: founder, title: 'Pack review', cat: 'call', s: sast(TUE, 10), e: sast(TUE, 11), vis: 'busy', pub: null, agenda: 'Review the pack', lead: null,
        email: null, name: null, key: 'k-' + Math.random().toString(36).slice(2, 12), ...over };
      return one('select public.staff_create_calendar_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r',
        [a.cal, a.title, a.cat, a.s, a.e, a.vis, a.pub, a.agenda, a.lead, a.email, a.name, a.key]).then((x) => x.r);
    };
    const first = await create({ email: 'Attendee@Example.test', name: 'Attendee', key: 'idem-key-0001' });
    assert.equal(first.status, 'created');
    const replay = await create({ email: 'Attendee@Example.test', key: 'idem-key-0001' });
    assert.equal(replay.status, 'existing');
    assert.equal(replay.event_id, first.event_id, 'retry returns the same booking');
    await as(U.owner);
    assert.equal((await one('select count(*)::int c from public.staff_audit_events where event_type = $1', ['booking_created'])).c, 1);
    await as(U.switchboard);
    await rejects(() => create({ s: sast(TUE, 11, 10), e: sast(TUE, 12) }), /overlaps another booking or its buffer/);
    await rejects(() => create({ s: sast(TUE, 10, 30), e: sast(TUE, 11, 30) }), /overlaps another booking or its buffer/);
    const second = await create({ s: sast(TUE, 11, 15), e: sast(TUE, 12), vis: 'private' });
    assert.equal(second.status, 'created');
    await rejects(() => create({ s: sast(TUE, 6), e: sast(TUE, 7) }), /business hours/);
    await rejects(() => create({ s: sast(SAT, 10), e: sast(SAT, 11) }), /weekends/);
    await rejects(() => create({ s: sast(TUE, 14), e: sast(TUE, 15), agenda: 'ID 8001015009087' }), /ID or account-length/);
    await rejects(() => create({ s: sast(TUE, 14), e: sast(TUE, 15), vis: 'public' }), /safe public title/);
    await rejects(() => create({ s: sast(TUE, 14), e: sast(TUE, 15), key: 'short' }), /idempotency key/);
    await rejects(() => create({ s: sast(TUE, 14), e: sast(TUE, 15), lead: id(999) }), /Submission not found/);
    await rejects(() => create({ s: sast(TUE, 14), e: sast(TUE, 15), email: 'not-an-email' }), /not valid/);
    await rejects(() => create({ s: sast(-1, 10), e: sast(-1, 11) }), /future interval/);
    await rejects(() => create({ cal: U.teamLeader, s: sast(TUE, 14), e: sast(TUE, 15) }), /calendar permission/, '42501');
    await as(U.owner);
    await q("select public.owner_set_business_holiday($1,'Synthetic holiday')", [sast(TUE + 1, 12).slice(0, 10)]);
    await as(U.switchboard);
    await rejects(() => create({ s: sast(TUE + 1, 10), e: sast(TUE + 1, 11) }), /public holiday|weekends/);
    // The database exclusion constraint is the backstop behind the advisory lock.
    await db.exec('reset role;');
    await rejects(() => db.query("insert into public.owner_calendar_events(owner_id,title,category,starts_at,ends_at,created_by) select owner_id,'x','call',starts_at,ends_at,created_by from public.owner_calendar_events where id=$1", [first.event_id]), /no_overlap|conflicting key/);

    // ---- Diary: titles only where allowed, change rights -----------------------------
    await as(U.owner);
    const pub = await one("select public.staff_create_calendar_event($1,'Founder public meeting','presentation',$2,$3,'public','Investor briefing','Notes',null,null,null,'owner-key-0001') as r", [founder, sast(TUE, 15), sast(TUE, 16)]);
    await as(U.coordinator);
    const diary = await q('select * from public.staff_calendar_diary($1,$2,$3)', [founder, sast(TUE - 1, 0), sast(TUE + 2, 0)]);
    const byId = Object.fromEntries(diary.map((r) => [r.event_id, r]));
    assert.equal(byId[first.event_id].display_title, 'Busy', 'busy event from another person reads Busy');
    assert.equal(byId[second.event_id].display_title, 'Private');
    assert.equal(byId[pub.r.event_id].display_title, 'Investor briefing');
    assert.equal(byId[first.event_id].can_change, true, 'manage_others can change it');
    assert.equal(byId[first.event_id].is_mine, false);
    await as(U.switchboard);
    const sbDiary = Object.fromEntries((await q('select * from public.staff_calendar_diary($1,$2,$3)', [founder, sast(TUE - 1, 0), sast(TUE + 2, 0)])).map((r) => [r.event_id, r]));
    assert.equal(sbDiary[first.event_id].display_title, 'Pack review', 'own booking shows its title');
    assert.equal(sbDiary[pub.r.event_id].can_change, false, 'cannot change the Owner event');
    assert.equal(sbDiary[pub.r.event_id].lead_id, null);

    // ---- Change rights --------------------------------------------------------
    await db.exec('reset role;');
    await db.exec(await mig('20261010051353_calendar_notice_revision_guard.sql'));
    const initialNotice = (await one('select id from public.calendar_confirmation_outbox where event_id=$1', [first.event_id])).id;
    await q('select * from public.claim_calendar_confirmation($1)', [initialNotice]);
    await as(U.switchboard);
    await rejects(() => q("select public.staff_reschedule_calendar_event($1,$2,$3,'Moved')", [pub.r.event_id, sast(TUE, 16, 30), sast(TUE, 17, 30)]), /permission to change/, '42501');
    await rejects(() => q("select public.staff_reschedule_calendar_event($1,$2,$3,'')", [first.event_id, sast(TUE, 16, 30), sast(TUE, 17, 30)]), /reason is required/);
    const moved = (await one("select public.staff_reschedule_calendar_event($1,$2,$3,'Client asked') as r", [first.event_id, sast(TUE, 13), sast(TUE, 14)])).r;
    assert.equal(moved.notices_queued, 1);
    await as(U.owner);
    const notices = await q("select revision, kind, status from public.calendar_confirmation_outbox where event_id=$1 order by revision", [first.event_id]);
    assert.deepEqual(notices.map((n) => [n.revision, n.kind, n.status]), [[1, 'confirmation', 'superseded'], [2, 'confirmation', 'queued']], 'claimed stale notice superseded, initial confirmation retained until delivery');
    await db.exec('reset role;');
    await rejects(() => q("select * from public.record_calendar_confirmation_result($1,'sent','stale-provider-result')", [initialNotice]), /not processing|not claimed|processing/);
    await as(U.coordinator);
    await q("select public.staff_cancel_calendar_event($1,'Duplicate booking')", [second.event_id]);
    await rejects(() => q("select public.staff_cancel_calendar_event($1,'again')", [second.event_id]), /Only a scheduled booking/);
    await as(U.owner);
    await q("select public.owner_revoke_calendar_grant($1,'Contract query')", [gManage]);
    await as(U.coordinator);
    await rejects(() => q("select public.staff_reschedule_calendar_event($1,$2,$3,'Late move')", [first.event_id, sast(TUE, 14, 30), sast(TUE, 15, 0)]), /permission to change/, '42501');
    await as(U.switchboard);
    await q("select public.staff_reschedule_calendar_event($1,$2,$3,'Own booking move')", [first.event_id, sast(TUE, 12), sast(TUE, 13)]);
    await as(U.owner);
    await q("select public.owner_revoke_calendar_grant($1,'End of cover')", [gSbCreate]);
    await as(U.switchboard);
    await rejects(() => create({ s: sast(TUE, 17), e: sast(TUE, 17, 30) }), /calendar permission/, '42501');
    await db.exec('reset role;');
    await rejects(() => db.query("update public.calendar_event_changes set reason='x'"), /append-only/);
    assert.equal((await one('select count(*)::int c from public.calendar_event_changes where event_id=$1', [first.event_id])).c, 3);

    // ---- Confirmations: once only, claim guard, no overstatement ---------------------
    await as(U.owner);
    const live = (await one("select id from public.calendar_confirmation_outbox where event_id=$1 and status='queued'", [first.event_id])).id;
    await db.exec('reset role;');
    await q('select * from public.claim_calendar_confirmation($1)', [live]);
    await rejects(() => q('select * from public.claim_calendar_confirmation($1)', [live]), /not claimable/);
    await q("select * from public.record_calendar_confirmation_result($1,'failed',null,'Provider down')", [live]);
    await q('select * from public.claim_calendar_confirmation($1)', [live]);
    await q("select * from public.record_calendar_confirmation_result($1,'sent','ext-1')", [live]);
    assert.equal((await one('select status, attempts from public.calendar_confirmation_outbox where id=$1', [live])).attempts, 2);
    await rejects(() => q('select * from public.claim_calendar_confirmation($1)', [live]), /not claimable/); // a sent notice is never re-sent
    await rejects(() => q("insert into public.calendar_confirmation_outbox(event_id,revision,kind,recipient_email,due_by) select event_id,revision,kind,recipient_email,due_by from public.calendar_confirmation_outbox where id=$1", [live]), /calendar_confirmation_once_uq|duplicate key/);

    // ---- Short notice is flagged and needs recorded handling ----------------------------
    await as(U.owner);
    await q("select public.owner_set_calendar_grant($1,$2,'manage_others')", [founder, U.coordinator]);
    const soon = (await one("select public.staff_create_calendar_event($1,'Urgent call','urgent',now() + interval '3 hours',now() + interval '4 hours','busy',null,'Urgent',null,'x@example.test',null,'owner-key-0002') as r", [founder])).r;
    assert.equal(soon.short_notice, true);
    await as(U.coordinator);
    const needs = (await q('select * from public.staff_calendar_diary($1,now(),now() + interval \'2 days\')', [founder])).find((r) => r.event_id === soon.event_id);
    assert.equal(needs.needs_short_notice_handling, true);
    await q("select public.staff_record_short_notice_handling($1,'Phoned the attendee')", [needs.confirmation_id]);
    const handled = (await q('select * from public.staff_calendar_diary($1,now(),now() + interval \'2 days\')', [founder])).find((r) => r.event_id === soon.event_id);
    assert.equal(handled.needs_short_notice_handling, false);
    await rejects(() => q("select public.staff_record_short_notice_handling($1,'again?')", [live]), /not short-notice/);

    // ---- Check-in reminders ------------------------------------------------------
    await as(U.owner);
    const cOrg = (await one("select public.owner_create_organisation('Checkin Org','c@example.test',null,'{}'::jsonb) as id")).id;
    const cTeam = (await one("select public.owner_create_team($1,'Checkin Team') as id", [id(101)])).id;
    const mem = (await one("select public.owner_add_team_member($1,$2,'team_leader',current_date - 30) as id", [cTeam, U.agentOrg1])).id;
    const made = (await one('select public.owner_run_checkin_generation() as n')).n;
    assert.ok(made >= 2, 'a team reminder and organisation reminders are created');
    assert.equal((await one('select public.owner_run_checkin_generation() as n')).n, 0, 'rerun creates no duplicates');
    await as(U.coordinator);
    const open = await q("select * from public.staff_checkin_list('open')");
    const teamReminder = open.find((r) => r.subject_kind === 'team' && r.subject_name === 'Checkin Team');
    assert.equal(teamReminder.cadence, 'weekly');
    assert.equal(teamReminder.leader_name, 'agent_org1');
    await q("select public.staff_complete_checkin($1,'Spoke to the Team Leader')", [teamReminder.id]);
    await rejects(() => q("select public.staff_complete_checkin($1,'again')", [teamReminder.id]), /already closed/);
    await as(U.switchboard);
    await rejects(() => q("select * from public.staff_checkin_list('open')"), /permission/, '42501');
    await as(U.owner);
    await q('select public.owner_end_team_membership($1, current_date - 1)', [mem]);
    await q('select public.owner_run_checkin_generation()');
    assert.equal((await one("select count(*)::int c from public.staff_checkin_reminders where subject_id=$1 and status='open'", [cTeam])).c, 0, 'a team without a leader stops generating');

    // ---- Task completion returns to the originating call ---------------------------------
    await as(U.switchboard);
    const call = (await one("select public.staff_log_call('inbound','referral_agent','Agent A','0820000001',null,'document_followup','Asked for status','routed',null,null,null) as id")).id;
    const tid = (await one("select public.staff_create_task('Chase statements',null,'document_chase','normal',null,'coordinator',null,$1) as id", [call])).id;
    await as(U.coordinator);
    await q("select public.staff_close_task($1,'done','Statements chased')", [tid]);
    await as(U.switchboard);
    const back = await q('select * from public.staff_call_tasks($1)', [call]);
    assert.equal(back.length, 1);
    assert.equal(back[0].status, 'done');
    assert.equal(back[0].completed_by_name, 'coordinator');

    // ---- No direct table access --------------------------------------------------
    await as(U.coordinator);
    for (const t of ['calendar_grants', 'calendar_settings', 'business_holidays', 'calendar_delegated_requests', 'calendar_event_changes', 'calendar_confirmation_outbox', 'staff_checkin_reminders']) {
      assert.equal((await q(`select * from public.${t}`)).length, 0, `${t} is owner-only for direct reads`);
      await rejects(() => q(`insert into public.${t} default values`), /permission denied|row-level|null value|violates/);
    }
  } finally {
    await db.close();
  }
});
