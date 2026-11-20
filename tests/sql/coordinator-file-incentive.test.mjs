import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Coordinator file incentive (owner, 19-20 Nov 2026): R29 per file the Director moves to Submitted (first time a deal
// linked to the lead reaches Submitted or any later stage, never Declined), credited to the coordinator handling or
// capturing it; the Director's monthly sign-off, and the incentive line on the coordinator's payslip one month in arrears. Reuses the
// payroll harness. It does NOT prove the live schema or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10), hr: id(11), fsup: id(12), fcon: id(13), fconOff: id(14) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Coordinator R29 per submitted file: report, sign-off, payslip line', async () => {
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
      "create type public.deal_stage as enum ('new_lead','qualifying','document_collection','deal_review','submitted','in_credit','approved_quote_received','client_deciding','verification_kyc','contract_signed','advance_pending','funded','invoiced','commission_paid','declined');",
      "create table public.deals(id uuid primary key default gen_random_uuid(), reference text, lead_id uuid, client_id uuid, stage public.deal_stage not null default 'new_lead', archived_at timestamptz);",
      'create table public.deal_stage_history(id uuid primary key default gen_random_uuid(), deal_id uuid not null, from_stage public.deal_stage, to_stage public.deal_stage not null, changed_by uuid, changed_at timestamptz not null default now());',
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
    await db.exec(await mig('20261021130000_field_roles_enum.sql'));
    const profile = (uid, name, role) => `insert into public.profiles(id,email,full_name,role) values ('${uid}','${name}@example.test','${name}','${role}');`;
    await db.exec([
      profile(U.owner, 'Founder', 'owner'), profile(U.coordinator, 'Coordinator', 'coordinator'),
      profile(U.switchboard, 'Switchboard', 'switchboard'), profile(U.admin, 'Administrator', 'administrator'),
      profile(U.partner, 'Partner', 'partner'), profile(U.adminOff, 'AdminOff', 'administrator'),
      profile(U.sb2, 'Reception2', 'switchboard'), profile(U.agent, 'Agent', 'contractor'),
      profile(U.sub, 'SubAgent', 'lead_referrer'), profile(U.leader, 'Leader', 'partner'), profile(U.hr, 'HR', 'hr'), profile(U.fsup, 'FieldSup', 'field_supervisor'),
      profile(U.fcon, 'FieldCon', 'field_consultant'), profile(U.fconOff, 'FieldConOff', 'field_consultant'),
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
    await db.exec(await mig('20261021131000_field_roles_landing_targets.sql'));
    await db.exec(await mig('20261102130000_payroll_field_roles.sql'));

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.admin, 'AD-01'], [U.hr, 'HR-01'], [U.fsup, 'FS-01'], [U.fcon, 'FC-01']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    await db.exec('reset role;');
    await db.exec(await mig('20261119120000_coordinator_file_incentive.sql'));
    await db.exec(await mig('20261119121000_file_rewards_and_report.sql'));

    // M = last month (paid on this month's cycle), N = this month (Johannesburg).
    const M = (await one("select to_char(date_trunc('month', public.current_sast_date()) - interval '1 month', 'YYYY-MM') as m")).m;
    const N = (await one("select to_char(date_trunc('month', public.current_sast_date()), 'YYYY-MM') as m")).m;
    // Files. Deals move through deal_stage_history; the first reach of Submitted or later counts once.
    //   L1: captured by the Coordinator, deal reaches Submitted in M (then In credit)  -> counts in M.
    //   L2: captured by the Coordinator, deal only reaches Deal review in M            -> does not count.
    //   L3: captured by the Coordinator, Deal review -> In credit (skips Submitted) in M -> counts in M.
    //   L4: captured and handled by Switchboard                                         -> no coordinator, no R29.
    //   L5: captured by the Coordinator, reaches Submitted this month (N)               -> counts in N.
    //   L6: captured by Switchboard, handled by the Coordinator, Submitted in M         -> counts for the Coordinator.
    //   L7: captured by the Coordinator, deal declined straight away                   -> does not count.
    const L = { l1: id(101), l2: id(102), l3: id(103), l4: id(104), l5: id(105), l6: id(106), l7: id(107) };
    await db.exec("insert into public.funding_product_catalog(code, display_name) values ('working_capital','Working capital');");
    await db.exec('alter table public.submission_intakes disable trigger user;');
    for (const [lead, name, by, handler] of [[L.l1,'Alpha',U.coordinator,null],[L.l2,'Bravo',U.coordinator,null],
      [L.l3,'Charlie',U.coordinator,null],[L.l4,'Delta',U.switchboard,U.switchboard],[L.l5,'Echo',U.coordinator,null],
      [L.l6,'Foxtrot',U.switchboard,U.coordinator],[L.l7,'Golf',U.coordinator,null]]) {
      await q('insert into public.leads(id, business_name, contact_name) values ($1,$2,$3)', [lead, name, 'Contact']);
      await q("insert into public.submission_intakes(lead_id, channel, funding_type, created_by, idempotency_key, operational_assignee_id) values ($1,'direct_agent','working_capital',$2,$3,$4)",
        [lead, by, 'idem-' + name, handler]);
    }
    await db.exec('alter table public.submission_intakes enable trigger user;');
    const deal = async (lead, ref, moves) => {
      const d = (await one('insert into public.deals(reference, lead_id) values ($1,$2) returning id', [ref, lead])).id;
      let from = 'qualifying';
      for (const [to, at] of moves) {
        await q('insert into public.deal_stage_history(deal_id, from_stage, to_stage, changed_at) values ($1,$2,$3,$4)', [d, from, to, at]);
        await q('update public.deals set stage = $2 where id = $1', [d, to]);
        from = to;
      }
      return d;
    };
    await deal(L.l1, 'DEAL-101', [['submitted', `${M}-10 09:00+02`], ['in_credit', `${M}-20 09:00+02`]]);
    await deal(L.l2, 'DEAL-102', [['deal_review', `${M}-10 09:00+02`]]);
    await deal(L.l3, 'DEAL-103', [['deal_review', `${M}-09 09:00+02`], ['in_credit', `${M}-11 09:00+02`]]);
    await deal(L.l4, 'DEAL-104', [['submitted', `${M}-10 09:00+02`]]);
    await deal(L.l5, 'DEAL-105', [['submitted', `${N}-01 09:00+02`]]);
    await deal(L.l6, 'DEAL-106', [['submitted', `${M}-12 09:00+02`]]);
    await deal(L.l7, 'DEAL-107', [['declined', `${M}-12 09:00+02`]]);

    // Rates: R35 for October (the 10 Oct rule), R29 from November (owner, 19 Nov).
    assert.equal((await one("select public.staff_incentive_rate('coordinator_qualifying_file', '2026-10-15') as r")).r, '35.00');
    assert.equal((await one("select public.staff_incentive_rate('coordinator_qualifying_file', '2026-11-20') as r")).r, '29.00');
    assert.equal((await one("select public.staff_incentive_rate('coordinator_qualifying_file', '2026-09-01') as r")).r, null);

    const rateN = Number((await one("select public.staff_incentive_rate('coordinator_qualifying_file', $1) as r", [`${N}-01`])).r);
    const rateM = Number((await one("select public.staff_incentive_rate('coordinator_qualifying_file', $1) as r", [`${M}-01`])).r);
    // The coordinator sees only her own qualifying files, at the month's rate.
    await as(U.coordinator);
    const nov = (await one('select public.staff_qualifying_files($1) as r', [`${N}-01`])).r;
    assert.equal(Number(nov.rate_per_file), rateN);
    assert.equal(nov.count, 1);
    assert.equal(Number(nov.estimate_total), rateN);
    assert.deepEqual(nov.files.map((f) => f.lead_id), [L.l5]);
    const oct = (await one('select public.staff_qualifying_files($1) as r', [`${M}-01`])).r;
    assert.deepEqual(oct.files.map((f) => f.lead_id), [L.l1, L.l3, L.l6],
      'Submitted (or a later stage) counts, once; Deal review only and Declined do not; handled-by-her counts');
    assert.equal(oct.files[0].deal_reference, 'DEAL-101');
    // She cannot ask for someone else's.
    const octOther = (await one('select public.staff_qualifying_files($1, $2) as r', [`${M}-01`, U.switchboard])).r;
    assert.deepEqual(octOther.files.map((f) => f.lead_id), [L.l1, L.l3, L.l6], 'a coordinator always sees her own');
    // She cannot sign off, apply lines, or read the tables.
    await rejects(() => q('select public.owner_signoff_qualifying_files($1,$2)', [`${M}-01`, U.coordinator]), /Only the Director/);
    await rejects(() => q('select * from public.qualifying_file_signoffs'), /permission denied/);
    await rejects(() => q('select * from public.staff_incentive_rates'), /permission denied/);

    // The Administrator cannot sign off either.
    await as(U.admin);
    await rejects(() => q('select public.owner_signoff_qualifying_files($1,$2)', [`${M}-01`, U.coordinator]), /Only the Director/);

    // The Director: the report covers every handler; open the November payroll cycle (October's files are paid there).
    await as(U.owner);
    const all = (await one('select public.staff_qualifying_files($1) as r', [`${M}-01`])).r;
    assert.deepEqual(all.files.map((f) => f.lead_id).sort(), [L.l1, L.l3, L.l6].sort(),
      'the Director sees every coordinator; a file no coordinator captured or handled earns no R29');
    assert.equal(all.status, 'estimate_until_founder_sign_off');
    // A month that has not ended, and an empty month, cannot be signed off.
    await rejects(() => q('select public.owner_signoff_qualifying_files(public.current_sast_date(), $1)', [U.coordinator]), /once it has ended/);
    await rejects(() => q('select public.owner_signoff_qualifying_files($1,$2)', ['2026-09-01', U.coordinator]), /no submitted files|No rate/);

    // The payroll cycle for November is opened from the Administrator's side; a payslip line needs a sign-off first.
    await db.exec("reset role; update public.profiles set created_at = now();");
    await as(U.admin);
    const cycle = (await one("select public.payroll_open_cycle(date_trunc('month', public.current_sast_date())::date) as id")).id;
    await db.exec('reset role;');
    const cycleMonth = (await one('select pay_month from public.payroll_cycles where id = $1', [cycle])).pay_month;
    const fileMonth = `${M}-01`;
    await as(U.admin);
    assert.equal((await one('select public.payroll_apply_qualifying_files($1) as n', [cycle])).n, 0, 'no line before the Director signs off');
    await db.exec('reset role;');
    const slip = (await one('select id from public.payslips where cycle_id = $1 and profile_id = $2', [cycle, U.coordinator]));
    assert.ok(slip, 'the coordinator has a payslip in the cycle');

    // The Director signs off: the snapshot is stored and the line goes straight onto the draft payslip.
    await as(U.owner);
    const so = (await one('select public.owner_signoff_qualifying_files($1,$2) as r', [fileMonth, U.coordinator])).r;
    assert.equal(so.already_signed_off, false);
    assert.equal(so.count, 3);
    const rate = rateM;
    assert.equal(Number(so.total), 3 * Number(rate));
    assert.equal(so.added_to_payslip, true);
    await db.exec('reset role;');
    const lines = await q("select kind, amount, label from public.payslip_lines where payslip_id = $1 and removed_at is null", [slip.id]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].kind, 'incentive');
    assert.equal(Number(lines[0].amount), 3 * Number(rate));
    assert.match(lines[0].label, /Files submitted/);

    // Idempotent: signing off again and applying again add nothing.
    await as(U.owner);
    assert.equal((await one('select public.owner_signoff_qualifying_files($1,$2) as r', [fileMonth, U.coordinator])).r.already_signed_off, true);
    assert.equal((await one('select public.payroll_apply_qualifying_files($1) as n', [cycle])).n, 0);
    await db.exec('reset role;');
    assert.equal((await q('select id from public.payslip_lines where payslip_id = $1 and removed_at is null', [slip.id])).length, 1, 'never paid twice');

    // A sign-off is fixed.
    await rejects(() => q('update public.qualifying_file_signoffs set file_count = 9'), /cannot be changed/);
    await rejects(() => q('delete from public.qualifying_file_signoffs'), /cannot be deleted/);

    // The report now says it is signed off and on the payslip.
    await as(U.coordinator);
    const after = (await one('select public.staff_qualifying_files($1) as r', [fileMonth])).r;
    assert.equal(after.status, 'signed_off');
    assert.equal(after.signoffs[0].on_payslip, true);
    // ---- R100 chooser (owner, 20 Nov): the Director picks who gets the R100 for any file --------------------------
    const dealOf = async (ref) => (await one('select id from public.deals where reference = $1', [ref])).id;
    const d1 = await dealOf('DEAL-101'); const d2 = await dealOf('DEAL-102'); const d3 = await dealOf('DEAL-103');
    await as(U.coordinator);
    await rejects(() => q('select public.owner_set_file_reward($1,null,null,$2,null)', [d1, U.agent]), /Only the Director/, '42501');
    await rejects(() => q("select public.owner_files_report($1,'all')", [`${M}-01`]), /Only the Director/, '42501');
    await rejects(() => q('select * from public.file_reward_assignments'), /permission denied/);
    await as(U.owner);
    // Search any file and anyone who can receive it.
    const found = await q("select * from public.owner_file_search('Alph')");
    assert.ok(found.some((r) => r.kind === 'deal' && r.deal_id === d1), 'deals are found by business name');
    const people = await q("select * from public.owner_reward_people_search('Agent')");
    assert.equal(people.find((p) => p.profile_id === U.agent).kind, 'agent');
    assert.ok(!(await q("select * from public.owner_reward_people_search('Founder')")).length, 'the Director is not a beneficiary');
    // Choose an agent, then replace with a typed outside name: history kept, one current.
    const r1 = (await one('select public.owner_set_file_reward($1,null,null,$2,null,$3) as id', [d1, U.agent, 'Brought the client'])).id;
    const r2 = (await one("select public.owner_set_file_reward($1,null,null,null,'Thabo Outside','Typed name') as id", [d1])).id;
    await db.exec('reset role;');
    const hist = await q('select id, is_current, beneficiary_kind from public.file_reward_assignments where deal_id = $1 order by chosen_at', [d1]);
    assert.deepEqual(hist.map((h) => [h.id, h.is_current, h.beneficiary_kind]), [[r1, false, 'agent'], [r2, true, 'outside']]);
    await rejects(() => q("update public.file_reward_assignments set beneficiary_name = 'X' where id = $1", [r1]), /cannot be changed/);
    await rejects(() => q('delete from public.file_reward_assignments'), /cannot be deleted/);
    await as(U.owner);
    // Pay it; a paid R100 cannot move to someone else.
    await q("select public.owner_mark_file_reward_paid($1, public.current_sast_date(), 'EFT 123')", [r2]);
    await rejects(() => q('select public.owner_set_file_reward($1,null,null,$2,null)', [d1, U.agent]), /already paid/);
    // Lead level for a lead with no deal; a lead with a deal goes through its deal.
    await db.exec("reset role; insert into public.leads(id, business_name, contact_name) values ('" + id(108) + "','Hotel','C');");
    await as(U.owner);
    await q("select public.owner_set_file_reward(null,$1,null,$2,null)", [id(108), U.sub]);
    await rejects(() => q('select public.owner_set_file_reward(null,$1,null,$2,null)', [L.l1, U.agent]), /already has a deal/);
    await rejects(() => q('select public.owner_set_file_reward($1,$2,null,$3,null)', [d1, L.l1, U.agent]), /Choose one file/);
    await rejects(() => q('select public.owner_set_file_reward($1,null,null,$2,null)', [d3, U.owner]), /cannot receive/);
    // Staff R100 goes on the payslip in the cycle after the month it was chosen (made last month here).
    await db.exec('reset role;');
    await q("insert into public.file_reward_assignments(file_key, deal_id, lead_id, beneficiary_kind, beneficiary_profile_id, beneficiary_name, chosen_by, chosen_at) values ($1,$1,$2,'staff',$3,'Coordinator',$4,$5)",
      [d2, L.l2, U.coordinator, U.owner, `${M}-15 10:00+02`]);
    await as(U.admin);
    assert.equal((await one('select public.payroll_apply_file_rewards($1) as n', [cycle])).n, 1);
    assert.equal((await one('select public.payroll_apply_file_rewards($1) as n', [cycle])).n, 0, 'never twice');
    await db.exec('reset role;');
    const rLine = await one("select amount, label from public.payslip_lines where payslip_id = $1 and label like 'R100 file reward%' and removed_at is null", [slip.id]);
    assert.equal(Number(rLine.amount), 100);
    // ---- Files report ---------------------------------------------------------------------------------------------
    await as(U.owner);
    const rep = (await one("select public.owner_files_report($1,'all') as r", [`${M}-01`])).r;
    const refs = rep.rows.map((x) => x.deal_reference).sort();
    assert.deepEqual(refs, ['DEAL-101', 'DEAL-102', 'DEAL-103', 'DEAL-104', 'DEAL-106'],
      'every deal first submitted in the month, plus files whose R100 was chosen in the month');
    const row1 = rep.rows.find((x) => x.deal_reference === 'DEAL-101');
    assert.equal(row1.in_credit, true);
    assert.equal(row1.r29.handler, 'Coordinator');
    assert.equal(row1.r29.signed_off, true);
    assert.equal(row1.r100.status, 'paid');
    assert.equal(rep.rows.find((x) => x.deal_reference === 'DEAL-104').r29, null, 'no coordinator, no R29');
    assert.equal(rep.rows.find((x) => x.deal_reference === 'DEAL-102').r100.status, 'on_payslip');
    assert.equal(rep.r29_count, 3);
    const credit = (await one("select public.owner_files_report($1,'in_credit') as r", [`${M}-01`])).r;
    assert.deepEqual(credit.rows.map((x) => x.deal_reference).sort(), ['DEAL-101', 'DEAL-103'], 'the In credit filter');
    await rejects(() => q("select public.owner_files_report($1,'bogus')", [`${M}-01`]), /Choose all/);
    void cycleMonth;
  } finally {
    await db.close();
  }
});
