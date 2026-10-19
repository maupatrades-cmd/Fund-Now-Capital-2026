import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Administrator batch 5a (HR role and commission flow): runs the staff-build migrations, batches 1 to 4, Codex's real
// commission-notice migration and the HR / commission-flow migrations against an isolated PostgreSQL (PGlite),
// switching real database roles with auth.uid() claims. It proves that HR holds nothing by default, the whole route
// (Director → Administrator → Sales Coordinator → agent → HR → Administrator → Director → paid → Administrator → HR →
// agent) with who may take each step, that the agent can only attach their own submitted portal invoice, that the
// paid step follows the Director's recorded payment, and append-only history. It does NOT prove the live schema,
// Codex's payment command or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10), hr: id(11), hrOff: id(12), orgUser: id(13) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Administrator batch 5a: HR role and the commission notice flow are enforced by the database', async () => {
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
      'create table public.deals(id uuid primary key default gen_random_uuid(), lead_id uuid, stage text not null default \'new_lead\', archived_at timestamptz, reference text, client_id uuid);',
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
    await db.exec(await mig('20261019100000_hr_role_enum.sql'));
    const profile = (uid, name, role) => `insert into public.profiles(id,email,full_name,role) values ('${uid}','${name}@example.test','${name}','${role}');`;
    await db.exec([
      profile(U.owner, 'Founder', 'owner'), profile(U.coordinator, 'Coordinator', 'coordinator'),
      profile(U.switchboard, 'Switchboard', 'switchboard'), profile(U.admin, 'Administrator', 'administrator'),
      profile(U.partner, 'Partner', 'partner'), profile(U.adminOff, 'AdminOff', 'administrator'),
      profile(U.sb2, 'Reception2', 'switchboard'), profile(U.agent, 'Agent', 'contractor'),
      profile(U.sub, 'SubAgent', 'lead_referrer'), profile(U.leader, 'Leader', 'partner'),
      profile(U.hr, 'HR', 'hr'), profile(U.hrOff, 'HROff', 'hr'), profile(U.orgUser, 'OrgUser', 'partner'),
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
    // Codex's commission ledger as its own notice test builds it, then Codex's real notice migration.
    const ledger = await mig('20261007095000_owner_commission_editor.sql');
    const ledgerFunction = (name) => { const s = ledger.indexOf(`create or replace function public.${name}(`); return ledger.slice(s, ledger.indexOf('$$;', s) + 3); };
    await db.exec([
      'create table public.owner_commission_entries(id uuid primary key, deal_id uuid, status text, currency text, beneficiary_kind text, beneficiary_profile_id uuid, beneficiary_organisation_id uuid, amount numeric(14,2));',
      'create table public.owner_commission_adjustments(id bigint primary key, entry_id uuid, delta numeric(14,2));',
      'create table public.owner_commission_flags(entry_id uuid, status text);',
      'create table public.owner_commission_deal_totals(deal_id uuid, total_amount numeric(14,2), currency text);',
      'create table public.owner_commission_payments(entry_id uuid primary key, payment_reference text not null, recorded_at timestamptz not null default now());',
      "create table public.contractor_invoices(id uuid primary key, contractor_id uuid, invoice_number text, total_amount numeric(14,2), state text, submitted_at timestamptz);",
      "create table public.partner_invoices(id uuid primary key, referral_partner_id uuid, invoice_number text, total_amount numeric(14,2), state text, submitted_at timestamptz);",
    ].join('\n'));
    for (const name of ['owner_commission_require_owner', 'owner_commission_effective', 'owner_commission_reconciliation']) await db.exec(ledgerFunction(name));
    await db.exec(await mig('20261017210010_restricted_commission_notice_snapshots.sql'));
    await db.exec(await mig('20261019101000_hr_commission_flow.sql'));

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01'], [U.hr, 'HR-01']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    await db.exec('reset role;');
    const notices = async (uid) => q("select title, body_text, link_url from public.notifications where user_id=$1 and event_type='COMMISSION_NOTICE_ROUTED' order by created_at", [uid]);
    const move = (notice, to, note = null, kind = null, inv = null) => q('select public.commission_route_move($1,$2,$3,$4,$5) as s', [notice, to, note, kind, inv]);

    // ---- 1. HR holds nothing by default --------------------------------------------------------------------
    await as(U.hr);
    assert.equal((await one('select public.staff_actor_role() as r')).r, 'hr');
    await rejects(() => q('select * from public.staff_task_board()'), /permission/, '42501');
    await rejects(() => q('select public.staff_director_briefing()'), /Founder or the Administrator/, '42501');
    await rejects(() => q("select public.staff_log_complaint('client','Mr Alpha','Nobody called me back about my file')"), /permission/, '42501');
    await rejects(() => q('select * from public.staff_commission_notices_for_deal($1)', [id(21)]), /access required/);
    const hrContacts = await q('select * from public.msg_contacts()');
    assert.ok(hrContacts.some((c) => c.role_label === 'Administrator'), 'HR uses internal mail with staff');
    await as(U.hrOff);
    assert.equal((await one('select public.staff_actor_role() as r')).r, null, 'HR access is off until the owner switches it on');
    await as(U.admin);
    assert.ok((await q('select * from public.msg_contacts()')).some((c) => c.profile_id === U.hr && c.role_label === 'HR'));
    await q("select public.staff_post_notice('Payroll date','Payslips go out on the 25th',false,array['staff'])");
    await db.exec('reset role;');
    assert.equal((await one("select count(*)::int c from public.staff_notice_recipients where recipient_id=$1", [U.hr])).c, 1, 'HR receives staff notices');

    // ---- 2. The Director issues (Codex) and sends the notice --------------------------------------------------
    await q("insert into public.clients(id, business_name) values ($1,'Client business')", [id(20)]);
    await q("insert into public.deals(id, reference, client_id) values ($1,'FNC-001',$2)", [id(21), id(20)]);
    await q("insert into public.owner_commission_entries values ($1,$2,'approved','ZAR','agent',$3,null,100)", [id(22), id(21), U.agent]);
    await q("insert into public.owner_commission_deal_totals values ($1,100,'ZAR')", [id(21)]);
    await q("insert into public.contractor_invoices values ($1,$2,'CI-001',90,'submitted',now()), ($3,$2,'CI-002',100,'submitted',now()), ($4,$2,'CI-003',100,'draft',null), ($5,$6,'CI-OTHER',100,'submitted',now())",
      [id(31), U.agent, id(32), id(33), id(34), U.coordinator]);
    await as(U.owner);
    const notice = (await one('select public.owner_issue_commission_notice($1,100) as id', [id(22)])).id;
    const unsent = await q('select * from public.commission_routes_board()');
    assert.equal(unsent.length, 1);
    assert.equal(unsent[0].status, 'not_sent');
    await as(U.admin);
    await rejects(() => q('select public.owner_send_commission_notice($1)', [notice]), /Only the Director/, '42501');
    assert.equal((await q('select * from public.commission_routes_board()')).length, 0, 'the Administrator sees it once sent');
    await as(U.owner);
    assert.equal((await one('select public.owner_send_commission_notice($1) as s', [notice])).s, 'with_administrator');
    await rejects(() => q('select public.owner_send_commission_notice($1)', [notice]), /already in the flow/);
    await db.exec('reset role;');
    assert.equal((await notices(U.admin))[0].title, 'Commission notice: Client business');

    // ---- 3. Administrator → Sales Coordinator → agent ----------------------------------------------------------
    await as(U.hr);
    assert.equal((await q('select * from public.commission_routes_board()')).length, 0, 'HR does not see the notice leg');
    await as(U.agent);
    assert.equal((await q('select * from public.my_commission_notices()')).length, 0, 'the agent sees it only once the Coordinator sends it');
    await as(U.coordinator);
    await rejects(() => move(notice, 'with_coordinator'), /cannot move/, '42501');
    await as(U.switchboard);
    await rejects(() => q('select * from public.commission_routes_board()'), /permission/, '42501');
    await as(U.admin);
    const adminRow = (await q('select * from public.commission_routes_board()'))[0];
    assert.deepEqual(adminRow.next_steps, ['with_coordinator']);
    assert.equal(adminRow.commission_amount, '100.00');
    await move(notice, 'with_coordinator');
    await as(U.coordinator);
    await move(notice, 'with_agent');
    await db.exec('reset role;');
    assert.match((await notices(U.agent))[0].body_text, /Send your invoice from your portal/);
    assert.equal((await notices(U.agent))[0].link_url, '/contractor/commissions');

    // ---- 4. The agent sends their own portal invoice; HR checks it ----------------------------------------------
    await as(U.partner);
    assert.equal((await q('select * from public.my_commission_notices()')).length, 0);
    await rejects(() => move(notice, 'invoice_with_hr', null, 'contractor', id(32)), /permission/, '42501');
    await rejects(() => q('select * from public.my_commission_invoice_options($1)', [notice]), /not found/);
    await as(U.agent);
    const mine = await q('select * from public.my_commission_notices()');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, 'with_agent');
    assert.deepEqual(Object.keys(mine[0]).filter((k) => /fee|funder|gross|pool|tier/i.test(k)), [], 'the agent sees only their own amount');
    const opts = (await q('select * from public.my_commission_invoice_options($1)', [notice])).map((o) => o.invoice_number).sort();
    assert.deepEqual(opts, ['CI-001', 'CI-002'], 'only the agent\'s own submitted invoices');
    await rejects(() => move(notice, 'invoice_with_hr'), /Choose the invoice/);
    await rejects(() => move(notice, 'invoice_with_hr', null, 'contractor', id(34)), /your own invoices/);
    await rejects(() => move(notice, 'invoice_with_hr', null, 'contractor', id(33)), /your own invoices/); // a draft is not sent yet
    await move(notice, 'invoice_with_hr', null, 'contractor', id(31));
    await as(U.hr);
    const hrRow = (await q('select * from public.commission_routes_board()'))[0];
    assert.equal(hrRow.invoice_number, 'CI-001');
    assert.equal(hrRow.amounts_match, false, 'R90 invoice against a R100 notice');
    await rejects(() => move(notice, 'with_agent', 'no'), /Say why/);
    await move(notice, 'with_agent', 'Invoice is R90, the notice is R100');
    await as(U.agent);
    assert.equal((await q('select * from public.my_commission_notices()'))[0].sent_back_note, 'Invoice is R90, the notice is R100');
    await move(notice, 'invoice_with_hr', null, 'contractor', id(32));
    await as(U.hr);
    assert.equal((await q('select * from public.commission_routes_board()'))[0].amounts_match, true);
    await rejects(() => move(notice, 'invoice_with_director'), /cannot move/, '42501');
    await move(notice, 'invoice_with_administrator');
    await as(U.admin);
    await move(notice, 'invoice_with_director');

    // ---- 5. The Director pays (Codex's payment record), proof goes back to the agent -------------------------
    await as(U.admin);
    await rejects(() => move(notice, 'paid_with_administrator'), /cannot move/, '42501');
    await as(U.owner);
    await rejects(() => move(notice, 'paid_with_administrator'), /Record the payment/);
    await db.exec('reset role;');
    await q("insert into public.owner_commission_payments(entry_id, payment_reference) values ($1,'EFT-REF-77')", [id(22)]);
    await as(U.owner);
    await move(notice, 'paid_with_administrator');
    await as(U.agent);
    assert.equal((await q('select * from public.my_commission_notices()'))[0].paid_reference, null, 'the agent sees the proof only once HR sends it');
    await as(U.admin);
    await move(notice, 'paid_with_hr');
    await as(U.hr);
    await move(notice, 'closed');
    await rejects(() => move(notice, 'closed'), /cannot move/);
    await as(U.agent);
    const done = (await q('select * from public.my_commission_notices()'))[0];
    assert.equal(done.status, 'closed');
    assert.equal(done.paid_reference, 'EFT-REF-77');
    await db.exec('reset role;');
    assert.match((await notices(U.agent)).at(-1).body_text, /has been paid/);
    assert.equal((await one('select count(*)::int c from public.commission_notice_route_events where commission_notice_id=$1', [notice])).c, 11, 'start, 2 hand-overs, invoice, send-back, invoice again, 3 hand-overs, paid, closed');
    await as(U.owner);
    assert.equal((await q('select * from public.commission_routes_board()'))[0].history.length, 11);

    // ---- 6. History is append-only; nothing changes a route outside the flow ----------------------------------
    await db.exec('reset role;');
    await rejects(() => q("update public.commission_notice_routes set status='with_agent'"), /only through the commission flow/);
    await rejects(() => q('delete from public.commission_notice_routes'), /cannot be deleted/);
    await rejects(() => q("update public.commission_notice_route_events set note='x'"), /append-only/);
    await as(U.agent);
    await rejects(() => q('select * from public.commission_notice_routes'), /permission denied/);
    assert.equal((await one("select count(*)::int c from pg_policies where tablename in ('commission_notice_routes','commission_notice_route_events')")).c, 0);
  } finally {
    await db.close();
  }
});
