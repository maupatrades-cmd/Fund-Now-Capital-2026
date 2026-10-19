import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Administrator batch 4 (reports): runs the staff-build migrations, batches 1 to 3 and the reports migrations against an
// isolated PostgreSQL (PGlite), switching real database roles with auth.uid() claims. It proves the complaints log
// (escalated at once, same-day acknowledgement, who may resolve), manual and 24-hour escalations to the Director,
// who may read the three reports and what they count, and append-only history. It does NOT prove the live schema,
// the cron schedule or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Administrator batch 4: complaints, escalations and reports are enforced by the database', async () => {
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
      'create table public.deals(id uuid primary key default gen_random_uuid(), lead_id uuid, stage text not null default \'new_lead\', archived_at timestamptz);',
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
    await db.exec(await mig('20261018120000_administrator_batch2_enums.sql'));
    await db.exec(await mig('20261019080000_staff_comms_enums.sql'));
    await db.exec(await mig('20261019090000_staff_reports_enums.sql'));
    const profile = (uid, name, role) => `insert into public.profiles(id,email,full_name,role) values ('${uid}','${name}@example.test','${name}','${role}');`;
    await db.exec([
      profile(U.owner, 'Founder', 'owner'), profile(U.coordinator, 'Coordinator', 'coordinator'),
      profile(U.switchboard, 'Switchboard', 'switchboard'), profile(U.admin, 'Administrator', 'administrator'),
      profile(U.partner, 'Partner', 'partner'), profile(U.adminOff, 'AdminOff', 'administrator'),
      profile(U.sb2, 'Reception2', 'switchboard'), profile(U.agent, 'Agent', 'contractor'),
      profile(U.sub, 'SubAgent', 'lead_referrer'), profile(U.leader, 'Leader', 'partner'),
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

    // Batch 2 needs the catalogue receipt column and a stub for the catalogue Complete gate (the real one
    // lives in the catalogue cut-over, which needs tables this harness does not build).
    await db.exec([
      'alter table public.intake_document_receipts add column if not exists doc_code text;',
      'create table public.test_missing_docs(lead_id uuid primary key);',
      "create or replace function public.intake_required_docs_missing(p_lead_id uuid) returns text[] language sql stable as $$ select case when exists (select 1 from public.test_missing_docs m where m.lead_id = p_lead_id) then array['bank_statement'] else '{}'::text[] end $$;",
    ].join('\n'));
    await db.exec(await mig('20261018121000_administrator_batch2.sql'));
    await db.exec(await mig('20261018130000_administrator_batch2_review_fixes.sql'));
    await db.exec(await mig('20261019070000_founder_admin_check_fix.sql'));
    await db.exec(await mig('20261019081000_staff_comms.sql'));
    await db.exec(await mig('20261019091000_staff_reports.sql'));

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    await db.exec('reset role;');
    const notices = async (uid, type) => q('select title from public.notifications where user_id=$1 and event_type=$2 order by created_at', [uid, type]);

    // Two files opened today (registration time is set by the server): one assigned, one already Complete.
    const lead1 = id(301); const lead2 = id(302);
    await q("insert into public.funding_product_catalog(code, display_name) values ('working_capital','Working capital') on conflict do nothing");
    await q("insert into public.leads(id, business_name, contact_name) values ($1,'Alpha Traders','A'), ($2,'Beta Bakery','B')", [lead1, lead2]);
    await q(`insert into public.submission_intakes(lead_id, channel, funding_type, created_by, idempotency_key, registered_at, operational_assignee_id, first_complete_at, workflow_status)
             values ($1,'direct_agent','working_capital',$3,'idem-key-0001', now(), $4, null, 'new'),
                    ($2,'direct_agent','working_capital',$3,'idem-key-0002', now() - interval '1 day', null, now(), 'complete')`, [lead1, lead2, U.coordinator, U.coordinator]);
    await db.exec("begin; set local fnc.intake_transition = 'on';");
    await q("update public.submission_intakes set workflow_status='complete' where lead_id=$1", [lead2]);
    await db.exec('commit;');
    await q("insert into public.staff_audit_events(entity_type, entity_id, event_type, actor_id, actor_role, detail) values ('submission_intake',$1,'assignee_changed',$2,'coordinator', jsonb_build_object('to',$3::text))", [lead1, U.coordinator, U.coordinator]);
    await q("insert into public.intake_document_receipts(lead_id, document_type, received_via, file_label, received_by, received_by_role) values ($1,'bank_statement','email','March',$2,'coordinator'),($1,'cipc_cert','email','CIPC',$2,'coordinator')", [lead1, U.coordinator]);
    await q("insert into public.deals(lead_id, stage) values ($1,'submitted'), ($2,'funded')", [lead1, lead2]);

    // ---- 1. Complaints ---------------------------------------------------------------------------
    await as(U.partner);
    await rejects(() => q("select public.staff_log_complaint('client','Mr Alpha','Nobody called me back about my file')"), /permission/, '42501');
    await as(U.switchboard);
    await rejects(() => q("select public.staff_log_complaint('supplier','Mr Alpha','Nobody called me back about my file')"), /Say who complained/);
    await rejects(() => q("select public.staff_log_complaint('client','Mr Alpha','My ID is 8001015009087 please call')"), /ID or account-length/);
    const c1 = (await one("select public.staff_log_complaint('client','Mr Alpha','Nobody called me back about my file',$1) as id", [lead1])).id;
    await db.exec('reset role;');
    assert.equal((await notices(U.owner, 'STAFF_ESCALATION_RAISED'))[0].title, 'Escalated to you: Complaint from client Mr Alpha', 'a complaint goes to the Director at once');
    assert.match((await notices(U.admin, 'STAFF_ESCALATION_RAISED'))[0].title, /\(copy\)/, 'the Administrator is copied');
    assert.equal((await notices(U.switchboard, 'STAFF_ESCALATION_RAISED')).length, 0, 'never the person who logged it');
    await as(U.switchboard);
    await rejects(() => q("select public.staff_complaint_step($1,'acknowledged','Called him back')", [c1]), /Say how/);
    await rejects(() => q("select public.staff_complaint_step($1,'resolved','Sorted out')", [c1]), /Founder or the Administrator/, '42501');
    assert.ok((await one("select public.staff_complaint_step($1,'acknowledged','Called him back','phone') as at", [c1])).at);
    await rejects(() => q("select public.staff_complaint_step($1,'acknowledged','Again','phone')", [c1]), /already acknowledged/);
    const sbList = await q('select * from public.staff_complaints_list(true)');
    assert.equal(sbList.length, 1);
    assert.equal(sbList[0].acknowledged_late, false, 'acknowledged the same day');
    assert.equal(sbList[0].can_resolve, false);
    await as(U.coordinator);
    assert.equal((await q('select * from public.staff_complaints_list(false)')).length, 0, 'other staff only see complaints they logged');
    const c2 = (await one("select public.staff_log_complaint('agent','Agent Smith','My commission notice is late again', null, now() - interval '2 days') as id")).id;
    await as(U.admin);
    const all = await q('select * from public.staff_complaints_list(true)');
    assert.equal(all.length, 2);
    assert.equal(all.find((c) => c.complaint_id === c2).acknowledged_late, true, 'not acknowledged on the day it came in');
    await rejects(() => q("select public.staff_complaint_step($1,'resolved','Paid it')", [c2]), /Acknowledge the complaint before/);
    await q("select public.staff_complaint_step($1,'resolved','Director phoned him; apology accepted')", [c1]);
    assert.equal((await q('select * from public.staff_complaints_list(true)')).length, 1);
    await db.exec('reset role;');
    await rejects(() => q("update public.staff_complaints set details='changed'"), /append-only/);
    await rejects(() => q('delete from public.staff_complaint_events'), /append-only/);

    // ---- 2. Escalations ----------------------------------------------------------------------------
    await as(U.coordinator);
    await rejects(() => q("select public.staff_escalate('short')"), /Write a note/);
    const m1 = (await one("select public.staff_escalate('Client threatens to go to a competitor', $1) as id", [lead1])).id;
    await rejects(() => q('select * from public.staff_escalation_board()'), /Founder or the Administrator/, '42501');
    await rejects(() => q("select public.staff_resolve_escalation($1,'Done')", [m1]), /Founder or the Administrator/, '42501');
    await rejects(() => q('select * from public.staff_escalations'), /permission denied/);
    await as(U.partner);
    await rejects(() => q("select public.staff_escalate('Partner trying to escalate here')"), /permission/, '42501');
    await rejects(() => q('select public.staff_director_briefing()'), /Founder or the Administrator/, '42501');
    // A task open for more than 24 hours is escalated by the sweep, once.
    await db.exec('reset role;');
    await q("insert into public.staff_tasks(id, title, route_to, assigned_to, created_by, created_role, created_at, due_at, priority, task_kind) values ($1,'Chase Alpha bank statements','coordinator',$2,$3,'administrator', now() - interval '30 hours', now() - interval '2 hours', 'high', 'general'), ($4,'Fresh task','switchboard',null,$3,'administrator', now(), null, 'normal', 'general'), ($5,'Founder decision','owner',null,$3,'administrator', now() - interval '3 days', null, 'normal', 'founder_decision')", [id(401), U.coordinator, U.admin, id(402), id(403)]);
    assert.equal((await one('select public.staff_escalate_overdue() as n')).n, 1, 'only the task open for over 24 hours, never the Founder\'s own decisions');
    assert.equal((await one('select public.staff_escalate_overdue() as n')).n, 0, 'never twice');
    assert.equal((await notices(U.owner, 'STAFF_ESCALATION_RAISED')).at(-1).title, '1 task not resolved within 24 hours');
    await as(U.coordinator);
    await rejects(() => q("select public.staff_escalate('Escalating this task again', null, $1)", [id(401)]), /already escalated/);
    await as(U.admin);
    await rejects(() => q('select public.staff_escalate_overdue()'), /permission denied/);
    const board = await q('select * from public.staff_escalation_board(true)');
    assert.equal(board.length, 4, 'two complaints, one manual, one task');
    const auto = board.find((b) => b.automatic);
    assert.equal(auto.title, 'Task: Chase Alpha bank statements');
    assert.match(auto.note, /^Not resolved within 24 hours\. With Coordinator\./);
    assert.equal(board.find((b) => b.escalation_id === m1).business_name, 'Alpha Traders');
    await q("select public.staff_resolve_escalation($1,'Spoke to the client, staying with us')", [m1]);
    await rejects(() => q("select public.staff_resolve_escalation($1,'Again')", [m1]), /already closed/);
    assert.equal((await q('select * from public.staff_escalation_board(true)')).length, 3);
    assert.equal((await q('select * from public.staff_escalation_board(false)')).length, 4);

    // ---- 3. Reports ----------------------------------------------------------------------------------
    const brief = (await one('select public.staff_director_briefing() as r')).r;
    assert.equal(brief.tasks.open, 3);
    assert.equal(brief.tasks.overdue, 1);
    assert.equal(brief.tasks.urgent[0].title, 'Chase Alpha bank statements');
    assert.equal(brief.urgent.escalations_open, 3);
    assert.equal(brief.urgent.complaints_open, 1);
    assert.equal(brief.urgent.complaints_unacknowledged, 1);
    const eod = (await one('select public.staff_end_of_day_report() as r')).r;
    assert.deepEqual(eod.files_opened.map((f) => f.business_name).sort(), ['Alpha Traders', 'Beta Bakery']);
    assert.equal(eod.documents_received.count, 2);
    assert.equal(eod.files_completed, 1);
    assert.equal(eod.leads_assigned[0].assigned_to, 'Coordinator');
    assert.equal(eod.tasks.outstanding, 3);
    assert.equal(eod.tasks.created, 1);
    const fri = (await one('select public.staff_files_progress_report() as r')).r;
    assert.equal(fri.target, 60);
    assert.equal(fri.files_opened_month, 2);
    assert.equal(fri.documents_complete_month, 1);
    assert.equal(fri.admin_fees_paid.not_tracked, true);
    assert.deepEqual(fri.deals_in_progress, { submitted: 1 }, 'funded deals are not "in progress"');
    // Field names only (free text such as a complaint may mention anything).
    const keys = []; const walk = (v) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) keys.push(k); walk(x); } };
    walk([brief, eod, fri]);
    assert.deepEqual(keys.filter((k) => /fee|funder|commission|amount|rand|money/i.test(k)), ['admin_fees_paid'], 'no money and no funders in any report');
    await as(U.switchboard);
    await rejects(() => q('select public.staff_end_of_day_report()'), /Founder or the Administrator/, '42501');
    await as(U.owner);
    assert.ok((await one('select public.staff_files_progress_report() as r')).r);
    await db.exec('reset role;');
    await rejects(() => q("update public.staff_escalations set note='changed'"), /append-only/);
    await rejects(() => q('delete from public.staff_escalation_resolutions'), /append-only/);
    assert.equal((await one("select count(*)::int c from pg_policies where tablename in ('staff_complaints','staff_complaint_events','staff_escalations','staff_escalation_resolutions')")).c, 0);
  } finally {
    await db.close();
  }
});
