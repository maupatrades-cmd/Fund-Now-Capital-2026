import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Administrator batch 2: runs the staff-build migrations, batch 1 and batch 2 against an isolated PostgreSQL
// (PGlite) with a synthetic prerequisite schema, switching real database roles with auth.uid() claims. It
// proves the database enforces task assignment / accept / decline, the absence approval (audited record
// only) and the outbound-lead routing steps. It does NOT prove the live schema or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Administrator batch 2: task assignment, absence approvals and outbound-lead routing are enforced by the database', async () => {
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
    await db.exec(await mig('20261018120000_administrator_batch2_enums.sql'));
    const profile = (uid, name, role) => `insert into public.profiles(id,email,full_name,role) values ('${uid}','${name}@example.test','${name}','${role}');`;
    await db.exec([
      profile(U.owner, 'Founder', 'owner'), profile(U.coordinator, 'Coordinator', 'coordinator'),
      profile(U.switchboard, 'Switchboard', 'switchboard'), profile(U.admin, 'Administrator', 'administrator'),
      profile(U.partner, 'Partner', 'partner'), profile(U.adminOff, 'AdminOff', 'administrator'),
      profile(U.sb2, 'Reception2', 'switchboard'), profile(U.agent, 'Agent', 'contractor'),
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

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01'], [U.sb2, 'SA-02']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    await db.exec('reset role;');
    // Three files: A Complete with every document, B Complete but (per the stub) missing one, C still New.
    await db.exec("insert into public.funding_product_catalog(code, display_name) values ('working_capital','Working capital') on conflict do nothing;");
    const fileA = id(101); const fileB = id(102); const fileC = id(103);
    for (const [lead, name] of [[fileA, 'Alpha Traders'], [fileB, 'Beta Bakery'], [fileC, 'Gamma Logistics']]) {
      await q("insert into public.leads(id, business_name, contact_name) values ($1,$2,'Contact')", [lead, name]);
      await q("insert into public.submission_intakes(lead_id, channel, funding_type, created_by, idempotency_key) values ($1,'direct_agent','working_capital',$2,$3)",
        [lead, U.coordinator, 'idem-' + lead.slice(-6)]);
    }
    await db.exec("select set_config('fnc.intake_transition','on',false);");
    await q("update public.submission_intakes set workflow_status='complete' where lead_id in ($1,$2)", [fileA, fileB]);
    await db.exec("select set_config('fnc.intake_transition','',false);");
    await q('insert into public.test_missing_docs(lead_id) values ($1)', [fileB]);
    const notices = async (uid, type) => q('select title, body_text from public.notifications where user_id=$1 and event_type=$2 order by created_at', [uid, type]);

    // ---- 1. Tasks: assign, accept, decline -----------------------------------------------------
    await as(U.coordinator);
    await rejects(() => q("select public.staff_create_assigned_task('Call the bank','',null,null,$1)", [U.switchboard]), /Founder or the Administrator/, '42501');
    await as(U.partner);
    await rejects(() => q("select public.staff_create_assigned_task('Call the bank','',null,null,$1)", [U.switchboard]), /Founder or the Administrator/, '42501');
    await as(U.admin);
    await rejects(() => q("select public.staff_create_assigned_task('Call the bank','',null,null,$1)", [U.agent]), /enabled Sales Coordinator or Switchboard/);
    await rejects(() => q("select public.staff_create_assigned_task('Call the bank','',null,null,$1)", [U.admin]), /enabled Sales Coordinator or Switchboard/);
    const due = new Date(Date.now() - 3600_000).toISOString();
    const t1 = (await one("select public.staff_create_assigned_task('Phone Alpha about the lease','Ask for the signed lease','high',$1,$2,$3) as id", [due, U.switchboard, fileA])).id;
    const t2 = (await one("select public.staff_create_assigned_task('Prepare Friday file list','',null,null,$1) as id", [U.coordinator])).id;
    await db.exec('reset role;');
    const ev = await q('select event, actor_role from public.staff_task_events where task_id=$1 order by id', [t1]);
    assert.deepEqual(ev.map((e) => e.event), ['created', 'assigned']);
    assert.ok(ev.every((e) => e.actor_role === 'administrator'), 'history keeps the real role');
    assert.equal((await notices(U.switchboard, 'STAFF_TASK_ASSIGNED')).length, 1, 'the person is told about the task');

    await as(U.switchboard);
    const pending = await q('select * from public.staff_my_pending_tasks()');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].overdue, true, 'overdue flag on the landing page');
    assert.equal(pending[0].assigned_by_name, 'Administrator');
    await as(U.sb2);
    assert.equal((await q('select * from public.staff_task_board()')).filter((t) => t.id === t1).length, 0, 'a named task is not shown to the rest of the desk');
    await rejects(() => q('select public.staff_respond_task($1,true,null)', [t1]), /not given to you/, '42501');
    await as(U.switchboard);
    await q('select public.staff_respond_task($1,true,null)', [t1]);
    await rejects(() => q('select public.staff_respond_task($1,true,null)', [t1]), /not waiting for your answer/);
    await as(U.coordinator);
    await rejects(() => q("select public.staff_respond_task($1,false,'busy')", [t2]), /at least 10/);
    await q("select public.staff_respond_task($1,false,'I am on leave on Friday afternoon')", [t2]);
    // Review fix 6: a declined task leaves the decliner's board and authority.
    assert.equal((await q('select * from public.staff_task_board()')).filter((t) => t.id === t2).length, 0, 'the decliner no longer has the task');
    await rejects(() => q("select public.staff_close_task($1,'done',null)", [t2]), /Only the person this task was given to/, '42501');
    await rejects(() => q("select public.staff_route_task($1,'switchboard','Passing it on')", [t2]), /only route/, '42501');
    // Review fix 1: a colleague on the same desk cannot close a task given to someone else.
    await as(U.sb2);
    await rejects(() => q("select public.staff_close_task($1,'done',null)", [t1]), /Only the person this task was given to/, '42501');
    await rejects(() => q("select public.staff_close_task($1,'cancelled',null)", [t1]), /Only whoever gave this task/, '42501');
    await db.exec('reset role;');
    assert.equal((await notices(U.admin, 'STAFF_TASK_DECLINED')).length, 1, 'the giver is told about the decline');
    await as(U.admin);
    const board = Object.fromEntries((await q('select * from public.staff_task_board()')).map((t) => [t.id, t]));
    assert.equal(board[t1].acceptance, 'accepted');
    assert.equal(board[t2].acceptance, 'declined');
    assert.equal(board[t2].decline_reason, 'I am on leave on Friday afternoon');
    assert.equal(board[t2].given_by_me, true);
    await q("select public.staff_assign_task($1,$2,'Please take this one')", [t2, U.switchboard]);
    assert.equal((await q('select * from public.staff_task_board()')).find((t) => t.id === t2).acceptance, 'pending', 'a reassigned task waits for a new answer');
    // Review fixes 4 and 5: a waiting task cannot be forwarded the old way, and it sorts first for its person.
    await as(U.switchboard);
    await rejects(() => q("select public.staff_route_task($1,'coordinator','Passing it on')", [t2]), /waiting for its person/);
    assert.equal((await q('select * from public.staff_task_board()'))[0].id, t2, 'tasks waiting for your answer come first');
    await q("select public.staff_close_task($1,'done','Called Alpha')", [t1]);
    await as(U.admin);
    await as(U.owner);
    assert.ok((await q('select * from public.staff_task_board()')).some((t) => t.id === t2), 'the Founder sees every task');

    // ---- 2. Documents approved while the Director is away ---------------------------------------
    await as(U.coordinator);
    await rejects(() => q("select public.staff_approve_documents_in_absence($1,'Director at a funder meeting')", [fileA]), /Only the Administrator/, '42501');
    await as(U.admin);
    await rejects(() => q("select public.staff_approve_documents_in_absence($1,'short')", [fileA]), /at least 10/);
    await rejects(() => q("select public.staff_approve_documents_in_absence($1,'Director at a funder meeting')", [fileB]), /still missing: bank_statement/);
    await rejects(() => q("select public.staff_approve_documents_in_absence($1,'Director at a funder meeting')", [fileC]), /only on a Complete file/);
    const appr = (await one("select public.staff_approve_documents_in_absence($1,'Director at a funder meeting') as id", [fileA])).id;
    assert.ok(appr);
    await rejects(() => q("select public.staff_approve_documents_in_absence($1,'Director at a funder meeting')", [fileA]), /already approved/);
    await db.exec('reset role;');
    assert.equal((await one('select workflow_status::text s from public.submission_intakes where lead_id=$1', [fileA])).s, 'complete', 'the approval does not verify the file');
    assert.equal((await one('select approved_role from public.intake_absence_approvals where id=$1', [appr])).approved_role, 'administrator');
    assert.equal((await notices(U.owner, 'DOCUMENTS_APPROVED_IN_ABSENCE')).length, 1, 'the Director is told');
    await rejects(() => q('delete from public.intake_absence_approvals'), /append-only/);
    await as(U.coordinator);
    assert.equal((await q('select * from public.staff_absence_approvals($1)', [fileA])).length, 1);
    await rejects(() => q('select * from public.intake_absence_approvals'), /permission denied/);
    await as(U.switchboard);
    await rejects(() => q('select * from public.staff_absence_approvals($1)', [fileA]), /permission/, '42501');

    // ---- 3. Outbound-lead routing ----------------------------------------------------------------
    await as(U.switchboard);
    const rA = (await one("select public.staff_start_outbound_route($1,'Outbound call from Reception') as id", [fileA])).id;
    const rC = (await one('select public.staff_start_outbound_route($1) as id', [fileC])).id;
    await rejects(() => q('select public.staff_start_outbound_route($1)', [fileA]), /already being routed/);
    await rejects(() => q("select public.staff_move_outbound_route($1,'new_leads','Checked with the team')", [rA]), /cannot move/, '42501');
    assert.equal((await q('select * from public.staff_outbound_routes()')).length, 2, 'Switchboard sees the routes they started');
    await as(U.coordinator);
    await rejects(() => q("select public.staff_move_outbound_route($1,'assigned','Agent recognised the client')", [rA]), /Choose the agent/);
    await rejects(() => q("select public.staff_move_outbound_route($1,'assigned','Agent recognised the client',$2)", [rA, U.switchboard]), /Choose the agent/);
    await q("select public.staff_move_outbound_route($1,'assigned','Agent recognised the client',$2)", [rA, U.agent]);
    await db.exec('reset role;');
    const agentNotice = await notices(U.agent, 'OUTBOUND_LEAD_ROUTED');
    assert.equal(agentNotice.length, 1, 'review fix 2: the team member is told the lead is theirs');
    assert.ok(!agentNotice[0].body_text.includes('recognised'), 'the internal staff note is not shown to them');
    await as(U.coordinator);
    await rejects(() => q("select public.staff_move_outbound_route($1,'new_leads','x')", [rC]), /who you checked with/);
    await q("select public.staff_move_outbound_route($1,'new_leads','Asked all Team Leaders, nobody knows it')", [rC]);
    await q("select public.staff_move_outbound_route($1,'with_administrator')", [rC]);
    await rejects(() => q("select public.staff_move_outbound_route($1,'with_director')", [rC]), /cannot move/, '42501');
    await db.exec('reset role;');
    assert.equal((await notices(U.admin, 'OUTBOUND_LEAD_ROUTED')).length, 1, 'the Administrator is told');
    await as(U.admin);
    await q("select public.staff_move_outbound_route($1,'with_director','Looks like a strong lead')", [rC]);
    await rejects(() => q("select public.staff_move_outbound_route($1,'director_received')", [rC]), /cannot move/, '42501');
    await db.exec('reset role;');
    assert.equal((await notices(U.owner, 'OUTBOUND_LEAD_ROUTED')).length, 1, 'the Director is told');
    await as(U.owner);
    await q("select public.staff_move_outbound_route($1,'director_received','I will call them')", [rC]);
    await as(U.coordinator);
    assert.equal((await q('select * from public.staff_outbound_routes(true)')).length, 0, 'finished routes leave the open list');
    const all = Object.fromEntries((await q('select * from public.staff_outbound_routes(false)')).map((r) => [r.id, r]));
    assert.equal(all[rA].status, 'assigned');
    assert.equal(all[rA].assigned_name, 'Agent');
    assert.deepEqual(all[rC].history.map((h) => h.to), ['with_coordinator', 'new_leads', 'with_administrator', 'with_director', 'director_received']);
    assert.deepEqual(all[rC].history.map((h) => h.role), ['switchboard', 'coordinator', 'coordinator', 'administrator', 'owner'], 'history keeps the real roles');
    await rejects(() => q('select * from public.outbound_lead_routes'), /permission denied/);
    await db.exec('reset role;');
    await rejects(() => q("update public.outbound_lead_routes set status='new_leads'"), /routing functions/);
    await rejects(() => q('delete from public.outbound_lead_route_events'), /append-only/);

    // ---- Nothing names a staff role in a table policy ---------------------------------------------
    assert.equal((await one("select count(*)::int c from pg_policies where qual ilike '%administrator%' or with_check ilike '%administrator%'")).c, 0);
  } finally {
    await db.close();
  }
});
