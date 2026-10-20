import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Administrator batch 5b (admin fees): runs the staff-build migrations, batches 1 to 4 and the admin-fee migration
// against an isolated PostgreSQL (PGlite), switching real database roles with auth.uid() claims. It proves who may
// issue invoices and capture payments, money validation, numbering, duplicate references, matching with the
// automatic receipt, no over-payment, set-aside, daily reconciliation, the Director-only invoice details, the Friday
// count and append-only history. It does NOT prove the live schema or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Administrator batch 5b: admin-fee invoices, receipts and reconciliation are enforced by the database', async () => {
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
    await db.exec(await mig('20261020090000_admin_fees.sql'));

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    await db.exec('reset role;');
    const lead1 = id(301); const lead2 = id(302);
    await q("insert into public.funding_product_catalog(code, display_name) values ('working_capital','Working capital') on conflict do nothing");
    await q("insert into public.leads(id, business_name, contact_name) values ($1,'Alpha Traders','A'), ($2,'Beta Bakery','B'), ($3,'No File','C')", [lead1, lead2, id(303)]);
    await q(`insert into public.submission_intakes(lead_id, channel, funding_type, created_by, idempotency_key)
             values ($1,'direct_agent','working_capital',$3,'idem-key-0001'), ($2,'direct_agent','working_capital',$3,'idem-key-0002')`, [lead1, lead2, U.coordinator]);
    const issue = (lead, amount, key, due = 'current_date + 7') =>
      q(`select public.admin_fee_issue_invoice($1,'Alpha Traders (Pty) Ltd','accounts@alpha.test','Admin fee: application file',$2,${due},$3) as id`, [lead, amount, key]);

    // ---- 1. Who may issue -------------------------------------------------------------------------------------
    for (const who of [U.coordinator, U.switchboard, U.partner]) {
      await as(who);
      await rejects(() => issue(lead1, '1500', 'key-00000001'), /Administrator or the Director/, '42501');
      await rejects(() => q("select public.admin_fee_record_payment('yoco',100,current_date,'YOCO-0')"), /Administrator or the Director/, '42501');
    }
    await as(U.admin);
    for (const bad of ['0', '-5', '1.234', 'NaN', '1000000']) await rejects(() => issue(lead1, bad, `key-bad-${bad}xx`), /admin fee in Rands/);
    await rejects(() => issue(id(303), '1500', 'key-00000002'), /Client file not found/);
    await rejects(() => issue(lead1, '1500', 'key-00000003', 'current_date - 1'), /due date/);
    const inv1 = (await one("select id from (select public.admin_fee_issue_invoice($1,'Alpha Traders (Pty) Ltd','accounts@alpha.test','Admin fee: application file',1500,current_date + 7,'key-00000004') as id) x", [lead1])).id;
    assert.equal((await issue(lead1, '1500', 'key-00000004'))[0].id, inv1, 'a retry with the same key returns the same invoice');
    const inv2 = (await issue(lead2, '800', 'key-00000005'))[0].id;
    const list = Object.fromEntries((await q('select * from public.admin_fee_invoices_list(false)')).map((r) => [r.invoice_id, r]));
    assert.equal(list[inv1].invoice_number, 'ADM-0001');
    assert.equal(list[inv2].invoice_number, 'ADM-0002');
    assert.equal(list[inv1].status, 'unpaid');
    assert.equal(list[inv1].amount, '1500.00');

    // ---- 2. Payments: capture, duplicates, suggestions -----------------------------------------------------------
    const p1 = (await one("select public.admin_fee_record_payment('yoco',1000,current_date,'YOCO-TX-881','Mr Alpha') as id")).id;
    const p2 = (await one("select public.admin_fee_record_payment('eft',500,current_date,'ADM-0001 Alpha') as id")).id;
    await rejects(() => q("select public.admin_fee_record_payment('eft',500,current_date,'  adm-0001 alpha ')"), /already been captured/);
    await rejects(() => q("select public.admin_fee_record_payment('cash',500,current_date,'CASH-1')"), /Yoco \(card\) or EFT/);
    await rejects(() => q("select public.admin_fee_record_payment('eft',500,current_date + 1,'EFT-FUTURE')"), /last 90 days/);
    const p3 = (await one("select public.admin_fee_record_payment('eft',10,current_date,'EFT-STRAY-10') as id")).id;
    const pays = Object.fromEntries((await q('select * from public.admin_fee_payments_list(null, true)')).map((r) => [r.payment_id, r]));
    assert.equal(pays[p2].suggested_invoice_number, 'ADM-0001', 'the reference names the invoice');
    assert.equal(pays[p1].suggested_invoice_number, null, 'no unique amount match for R1000');

    // ---- 3. Matching, receipt, no over-payment ----------------------------------------------------------------
    assert.equal((await one('select public.admin_fee_match($1,$2) as s', [p1, inv1])).s, 'part_paid');
    await rejects(() => q('select public.admin_fee_match($1,$2)', [p1, inv2]), /already matched/);
    assert.equal((await one('select public.admin_fee_match($1,$2) as s', [p2, inv1])).s, 'paid');
    await rejects(() => q('select public.admin_fee_match($1,$2)', [p3, inv1]), /more than the balance/);
    const paid = (await q('select * from public.admin_fee_invoices_list(false)')).find((r) => r.invoice_id === inv1);
    assert.equal(paid.status, 'paid');
    assert.equal(paid.balance, '0.00');
    assert.equal(paid.receipt_number, 'RCT-0001');
    await rejects(() => q("select public.admin_fee_unmatch($1,'Wrong invoice')", [p2]), /receipt has been issued/);
    await rejects(() => q("select public.admin_fee_void_invoice($1,'Client cancelled')", [inv1]), /payments matched/);

    // ---- 4. Daily reconciliation ----------------------------------------------------------------------------------
    await rejects(() => q('select public.admin_fee_reconcile_day(current_date)'), /1 payment\(s\) on that day still need/);
    await rejects(() => q("select public.admin_fee_exclude_payment($1,'no')", [p3]), /Give a reason/);
    await q("select public.admin_fee_exclude_payment($1,'Not an admin fee: client refund test')", [p3]);
    await rejects(() => q('select public.admin_fee_match($1,$2)', [p3, inv2]), /set aside/);
    assert.ok((await one("select public.admin_fee_reconcile_day(current_date, 'Yoco and bank statement checked') as at")).at);
    await rejects(() => q('select public.admin_fee_reconcile_day(current_date)'), /already reconciled/);
    const today = (await q('select * from public.admin_fee_days(3)'))[0];
    assert.equal(today.payments, 3);
    assert.equal(today.unmatched, 0);
    assert.equal(today.total_received, '1500.00', 'the set-aside payment is not counted');
    assert.equal(today.changed_after, false);
    await q("select public.admin_fee_record_payment('eft',800,current_date,'Beta ADM-0002')");
    assert.equal((await q('select * from public.admin_fee_days(3)'))[0].changed_after, true, 'a late capture flags the reconciled day');

    // ---- 5. Void, invoice details, print document -------------------------------------------------------------
    await rejects(() => q("select public.admin_fee_void_invoice($1,'x')", [inv2]), /reason/);
    await q("select public.admin_fee_void_invoice($1,'Client went elsewhere')", [inv2]);
    assert.equal((await q('select * from public.admin_fee_invoices_list(true)')).length, 0, 'no open invoices left');
    await rejects(() => q("select public.owner_save_admin_fee_settings('{\"legal_name\":\"FNC\"}'::jsonb)"), /Only the Director/, '42501');
    await as(U.owner);
    await rejects(() => q("select public.owner_save_admin_fee_settings('{\"account_number\":\"12ab\"}'::jsonb)"), /check constraint/);
    await q(`select public.owner_save_admin_fee_settings('{"legal_name":"Fund Now Capital (Pty) Ltd","bank_name":"Test Bank","account_number":"1234 5678 90","branch_code":"250655","yoco_link":"https://pay.yoco.com/fnc"}'::jsonb)`);
    await as(U.admin);
    const doc = (await one('select public.admin_fee_document($1) as d', [inv1])).d;
    assert.equal(doc.invoice.invoice_number, 'ADM-0001');
    assert.equal(doc.invoice.status, 'paid');
    assert.equal(doc.receipt.receipt_number, 'RCT-0001');
    assert.equal(doc.payments.length, 2);
    assert.equal(doc.settings.account_number, '1234567890');
    const fri = (await one('select public.staff_files_progress_report() as r')).r;
    assert.deepEqual(fri.admin_fees_paid, { not_tracked: false, month: 1, week: 1 });
    await as(U.coordinator);
    await rejects(() => q('select public.admin_fee_document($1)', [inv1]), /Administrator or the Director/, '42501');

    // ---- 6. History cannot be rewritten --------------------------------------------------------------------------
    await db.exec('reset role;');
    await rejects(() => q('update public.admin_fee_invoices set amount = 1 where id = $1', [inv1]), /cannot be changed/);
    await rejects(() => q('delete from public.admin_fee_invoices'), /cannot be deleted/);
    await rejects(() => q("update public.admin_fee_payments set amount = 1 where id = $1", [p1]), /cannot be changed/);
    await rejects(() => q('delete from public.admin_fee_receipts'), /append-only/);
    await rejects(() => q('delete from public.admin_fee_reconciliations'), /append-only/);
    await as(U.admin);
    await rejects(() => q('select * from public.admin_fee_invoices'), /permission denied/);
    await rejects(() => q('select public.admin_fee_paid($1)', [inv1]), /permission denied/);
    assert.equal((await one("select count(*)::int c from pg_policies where tablename like 'admin_fee_%'")).c, 0);
  } finally {
    await db.close();
  }
});
