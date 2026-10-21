import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Administrator batch 5c (payslips and the payroll cycle): runs the staff-build migrations, batches 1 to 5b, the HR
// role and the payroll migrations against an isolated PostgreSQL (PGlite), switching real database roles with
// auth.uid() claims. It proves the pay-day and pro-rata rules, who may move a cycle (only the Director closes and
// pays), the payslip route Administrator -> Director -> Administrator -> HR -> staff member, who sees salaries,
// server-side totals, fixed lines after draft and append-only history. It does NOT prove the live schema or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10), hr: id(11) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Administrator batch 5c: payroll cycles and payslips are enforced by the database', async () => {
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
    await db.exec(await mig('20261019100000_hr_role_enum.sql'));
    await db.exec(await mig('20261021120000_payroll_enums.sql'));
    const profile = (uid, name, role) => `insert into public.profiles(id,email,full_name,role) values ('${uid}','${name}@example.test','${name}','${role}');`;
    await db.exec([
      profile(U.owner, 'Founder', 'owner'), profile(U.coordinator, 'Coordinator', 'coordinator'),
      profile(U.switchboard, 'Switchboard', 'switchboard'), profile(U.admin, 'Administrator', 'administrator'),
      profile(U.partner, 'Partner', 'partner'), profile(U.adminOff, 'AdminOff', 'administrator'),
      profile(U.sb2, 'Reception2', 'switchboard'), profile(U.agent, 'Agent', 'contractor'),
      profile(U.sub, 'SubAgent', 'lead_referrer'), profile(U.leader, 'Leader', 'partner'), profile(U.hr, 'HR', 'hr'),
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
    await db.exec(await mig('20261020090000_admin_fees.sql'));
    // Batch 5a's HR role plumbing (its section 1) and its staff_enabled_in_role helper; the commission-flow tables it
    // also creates need Codex's tables, which this harness does not build.
    const hrFlow = await mig('20261019101000_hr_commission_flow.sql');
    await db.exec(hrFlow.slice(0, hrFlow.indexOf('-- 2. Commission flow (owner spec section 4)')));
    const enabled = hrFlow.slice(hrFlow.indexOf('create or replace function public.staff_enabled_in_role('));
    await db.exec(enabled.slice(0, enabled.indexOf('revoke all on function public.staff_enabled_in_role(text)')));
    await db.exec(await mig('20261021121000_payroll_payslips.sql'));

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01'], [U.hr, 'HR-01']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    await db.exec('reset role;');
    await q("insert into public.business_holidays(holiday_date, label) values ('2026-12-25','Christmas Day'), ('2026-12-26','Day of Goodwill')");
    const notices = async (uid) => q("select title, body_text from public.notifications where user_id=$1 and event_type='PAYSLIP_STATUS_CHANGED' order by created_at", [uid]);
    const slipRow = async (cycle, payslip) => (await q('select * from public.payroll_payslips($1)', [cycle])).find((s) => s.payslip_id === payslip);

    // ---- 1. Pay-day and pro-rata rules ------------------------------------------------------------------------
    assert.equal((await one("select public.payroll_pay_date('2026-12-01')::text as d")).d, '2026-12-24', '27 Dec is a Sunday; 25 and 26 are public holidays');
    assert.equal((await one("select public.payroll_pay_date('2026-11-01')::text as d")).d, '2026-11-27');
    assert.equal((await one("select public.payroll_pay_date('2027-02-01')::text as d")).d, '2027-02-26', '27 Feb 2027 is a Saturday');
    assert.equal((await one("select public.payroll_pro_rata(7500, '2026-11-09', '2026-11-01') as a")).a, '5714.29', 'Office Administrator, about R5,700');
    assert.equal((await one("select public.payroll_pro_rata(6000, '2026-11-09', '2026-11-01') as a")).a, '4571.43', 'Sales Coordinator, about R4,570');
    assert.equal((await one("select public.payroll_pro_rata(6000, null, '2026-11-01') as a")).a, '6000.00');
    await as(U.admin);
    await rejects(() => q("select public.payroll_pro_rata(1,null,'2026-11-01')"), /permission denied/);

    // ---- 2. Opening a cycle -----------------------------------------------------------------------------------------
    for (const who of [U.coordinator, U.switchboard, U.hr, U.partner]) {
      await as(who);
      await rejects(() => q('select public.payroll_open_cycle(current_date)'), /Administrator or the Director/, '42501');
    }
    await as(U.admin);
    const cyc = (await one("select public.payroll_open_cycle(date_trunc('month', current_date)::date) as id")).id;
    assert.equal((await one("select public.payroll_open_cycle(date_trunc('month', current_date)::date) as id")).id, cyc, 'idempotent');
    const c0 = (await q('select * from public.payroll_cycles_list()'))[0];
    assert.equal(c0.status, 'open');
    assert.equal(c0.payslips, 4, 'one draft payslip per enabled staff member (Admin, Coordinator, Switchboard, HR), none for the Director');
    const slips = Object.fromEntries((await q('select * from public.payroll_payslips($1)', [cyc])).map((s) => [s.profile_id, s]));
    const coordSlip = slips[U.coordinator].payslip_id;

    // ---- 3. Preparing a payslip ---------------------------------------------------------------------------------
    await as(U.coordinator);
    await rejects(() => q("select public.payslip_add_line($1,'incentive','File fees',75)", [coordSlip]), /Administrator or the Director/, '42501');
    await rejects(() => q('select * from public.payroll_payslips($1)', [cyc]), /permission/, '42501');
    await as(U.admin);
    await rejects(() => q("select public.payslip_move($1,'awaiting_director')", [coordSlip]), /at least one line/);
    await q('select public.payslip_add_salary_line($1, 6000, null)', [coordSlip]);
    await q("select public.payslip_add_line($1,'incentive','File fees: 3 closed files',75)", [coordSlip]);
    await q("select public.payslip_add_line($1,'deduction','UIF',60)", [coordSlip]);
    await rejects(() => q("select public.payslip_add_line($1,'deduction','UIF',-60)", [coordSlip]), /more than R0/);
    await rejects(() => q("select public.payslip_add_line($1,'bonus','x',10)", [coordSlip]), /Choose the kind/);
    await q("select public.payslip_add_line($1,'allowance','Typo line',1)", [coordSlip]);
    const typoLine = (await slipRow(cyc, coordSlip)).lines.find((l) => l.label === 'Typo line').line_id;
    await q("select public.payslip_remove_line($1,'Entered by mistake')", [typoLine]);
    const prepared = await slipRow(cyc, coordSlip);
    assert.equal(prepared.gross, '6075.00');
    assert.equal(prepared.deductions, '60.00');
    assert.equal(prepared.net, '6015.00');
    assert.equal(prepared.lines.length, 3);

    // ---- 4. The route: Administrator -> Director -> Administrator -> HR -> staff member ----------------------------
    await q("select public.payslip_move($1,'awaiting_director')", [coordSlip]);
    await rejects(() => q("select public.payslip_add_line($1,'incentive','Late fee',25)", [coordSlip]), /no longer a draft/);
    await rejects(() => q("select public.payslip_move($1,'approved')", [coordSlip]), /cannot move/, '42501');
    await db.exec('reset role;');
    assert.equal((await notices(U.owner))[0].body_text, 'Ready for your approval.');
    await as(U.owner);
    await rejects(() => q("select public.payslip_move($1,'draft','no')", [coordSlip]), /Say why/);
    await q("select public.payslip_move($1,'draft','Add the R25 for the Sasol file')", [coordSlip]);
    await as(U.admin);
    await q("select public.payslip_add_line($1,'incentive','File fee: Sasol file',25)", [coordSlip]);
    await q("select public.payslip_move($1,'awaiting_director')", [coordSlip]);
    await as(U.hr);
    assert.equal((await q('select * from public.payroll_payslips($1)', [cyc])).length, 0, 'HR sees a payslip only once it reaches HR');
    await rejects(() => q('select public.payslip_document($1)', [coordSlip]), /Payslip not found/);
    await as(U.owner);
    await q("select public.payslip_move($1,'approved')", [coordSlip]);
    await as(U.hr);
    await rejects(() => q("select public.payslip_move($1,'with_hr')", [coordSlip]), /cannot move/, '42501');
    await as(U.admin);
    await q("select public.payslip_move($1,'with_hr')", [coordSlip]);
    await as(U.hr);
    const hrView = await q('select * from public.payroll_payslips($1)', [cyc]);
    assert.equal(hrView.length, 1);
    assert.equal(hrView[0].net, '6040.00');
    await as(U.coordinator);
    assert.equal((await q('select * from public.my_payslips()')).length, 0, 'not distributed yet');
    await rejects(() => q('select public.payslip_document($1)', [coordSlip]), /Payslip not found/);
    await as(U.hr);
    await q("select public.payslip_move($1,'distributed')", [coordSlip]);
    await as(U.coordinator);
    const mine = await q('select * from public.my_payslips()');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].net, '6040.00');
    const doc = (await one('select public.payslip_document($1) as d', [coordSlip])).d;
    assert.equal(doc.lines.length, 4);
    assert.equal(doc.can_acknowledge, true);
    await as(U.switchboard);
    await rejects(() => q('select public.payslip_document($1)', [coordSlip]), /Payslip not found/);
    await rejects(() => q("select public.payslip_move($1,'acknowledged')", [coordSlip]), /cannot move/);
    await as(U.coordinator);
    await q("select public.payslip_move($1,'acknowledged')", [coordSlip]);
    await db.exec('reset role;');
    assert.match((await notices(U.coordinator))[0].title, /^Your payslip for /);

    // ---- 5. The cycle: only the Director closes and pays --------------------------------------------------------------
    await as(U.hr);
    await q("select public.payroll_move_cycle($1,'calculating')", [cyc]);
    await as(U.admin);
    await q("select public.payroll_move_cycle($1,'query_window')", [cyc]);
    await rejects(() => q("select public.payroll_move_cycle($1,'closed')", [cyc]), /cannot move/, '42501');
    await as(U.coordinator);
    await rejects(() => q("select public.payroll_move_cycle($1,'calculating')", [cyc]), /permission/, '42501');
    await as(U.owner);
    await rejects(() => q("select public.payroll_move_cycle($1,'closed')", [cyc]), /Approve or finish every payslip/);
    for (const s of Object.values(slips)) {
      if (s.payslip_id === coordSlip) continue;
      await as(U.admin);
      await q('select public.payslip_add_salary_line($1, 5000, null)', [s.payslip_id]);
      await q("select public.payslip_move($1,'awaiting_director')", [s.payslip_id]);
      await as(U.owner);
      await q("select public.payslip_move($1,'approved')", [s.payslip_id]);
    }
    await q("select public.payroll_move_cycle($1,'closed')", [cyc]);
    await as(U.admin);
    await rejects(() => q("select public.payroll_move_cycle($1,'paid')", [cyc]), /cannot move/, '42501');
    await rejects(() => q("select public.payslip_add_line($1,'incentive','Too late',10)", [slips[U.admin].payslip_id]), /closed|no longer a draft/);
    await as(U.owner);
    await q("select public.payroll_move_cycle($1,'paid','Paid from FNB')", [cyc]);
    assert.equal((await q('select * from public.payroll_cycles_list()'))[0].status, 'paid');

    // ---- 6. History cannot be rewritten --------------------------------------------------------------------------
    await db.exec('reset role;');
    await rejects(() => q("update public.payslips set status='draft' where id=$1", [coordSlip]), /only through the payroll functions/);
    await rejects(() => q("update public.payroll_cycles set status='open'"), /only through the payroll functions/);
    await rejects(() => q('delete from public.payslip_lines'), /cannot be deleted/);
    await rejects(() => q('update public.payslip_lines set amount = 1'), /removed, once/);
    await rejects(() => q('delete from public.payslip_events'), /append-only/);
    await rejects(() => q('delete from public.payroll_cycle_events'), /append-only/);
    assert.equal((await one('select count(*)::int c from public.payslip_events where payslip_id=$1', [coordSlip])).c, 7);
    await as(U.admin);
    await rejects(() => q('select * from public.payslips'), /permission denied/);
    assert.equal((await one("select count(*)::int c from pg_policies where tablename in ('payroll_cycles','payroll_cycle_events','payslips','payslip_lines','payslip_events')")).c, 0);
  } finally {
    await db.close();
  }
});
