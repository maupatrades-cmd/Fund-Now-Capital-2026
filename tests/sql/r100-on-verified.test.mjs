import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// R100 on Verified: runs the staff-build migrations, batches 1 to 5b, the legacy R100 lock, Codex's never-applied
// payout workspace and calendar, and the Verified migration against an isolated PostgreSQL (PGlite), switching real
// database roles with auth.uid() claims. It proves the R100 line is created once when the Director verifies a file or
// the Administrator approves it in her absence, the six-month-per-client rule, no line without an agent, the Agent Code
// gate on scheduling, the closed legacy route, and the portal workspace. It does NOT prove the live schema or screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('R100 is created on Verified, once per client in 6 months, and paid only to cleared agents', async () => {
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
    // Legacy R100 lock, its readiness gate, then Codex's payout workspace and calendar (storage stubbed), then Verified.
    await db.exec([
      'alter table public.leads add column attributed_to_partner_id uuid, add column attributed_to_contractor_id uuid, add column attributed_to_lead_referrer_id uuid, add column referral_partner_id uuid;',
      'alter table public.profiles add column if not exists sourced_via_partner_id uuid;',
      'create table public.activity_logs(id bigserial primary key, user_id uuid, user_email text, user_role text, event_type text, entity_type text, entity_id uuid, description text, related_entity_ids jsonb);',
      'create schema if not exists storage;',
      'create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);',
      'create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text); alter table storage.objects enable row level security;',
    ].join('\n'));
    for (const f of ['20260810075057_complete_document_r100_reward.sql', '20260812004005_reward_legal_readiness.sql',
      '20261007161254_r100_reward_payroll_workspace.sql', '20261010205101_r100_submission_fee_payment_calendar.sql',
      '20261021140000_r100_on_verified.sql']) {
      await db.exec(await mig(f));
    }

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    await db.exec('reset role;');
    const L = { a: id(301), b: id(302), c: id(303), d: id(304) };
    await q("insert into public.funding_product_catalog(code, display_name) values ('working_capital','Working capital') on conflict do nothing");
    await q(`insert into public.leads(id, business_name, contact_name, cipc_number, attributed_to_contractor_id) values
      ($1,'Alpha Traders','A','2020/123456/07', null), ($2,'Alpha Traders (again)','A2','2020 123456 07', $5),
      ($3,'No Agent','C',null,null), ($4,'Delta Diesel','D','2019/999999/07', $5)`, [L.a, L.b, L.c, L.d, U.agent]);
    await q(`insert into public.submission_intakes(lead_id, channel, funding_type, created_by, idempotency_key, agent_profile_id)
      values ($1,'direct_agent','working_capital',$5,'idem-key-0001',$6), ($2,'direct_agent','working_capital',$5,'idem-key-0002',null),
             ($3,'direct_agent','working_capital',$5,'idem-key-0003',null), ($4,'direct_agent','working_capital',$5,'idem-key-0004',null)`,
      [L.a, L.b, L.c, L.d, U.coordinator, U.sub]);
    const locks = async () => { await db.exec('reset role;'); return q("select lead_id, beneficiary_profile_id, beneficiary_role, amount, source, eligibility_snapshot->>'via' as via, pay_window_close_on from public.complete_document_reward_locks order by locked_at"); };

    // ---- 1. The Director verifies: one R100 line, for the agent on the file --------------------------------------
    await as(U.owner);
    await q("select public.staff_set_intake_status($1,'verified')", [L.a]);
    let rows = await locks();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].beneficiary_profile_id, U.sub);
    assert.equal(rows[0].beneficiary_role, 'lead_referrer');
    assert.equal(rows[0].amount, '100.00');
    assert.equal(rows[0].source, 'verified');
    assert.equal(rows[0].via, 'director_verified');
    // Back and forward again: still one line for the file.
    await as(U.owner);
    await q("select public.staff_set_intake_status($1,'with_founder','Founder reopened the file to check a page')", [L.a]);
    await q("select public.staff_set_intake_status($1,'verified')", [L.a]);
    assert.equal((await locks()).length, 1, 'never two lines for the same verified file');

    // ---- 2. Same client (same CIPC) inside 6 months: no second R100 ----------------------------------------------
    await as(U.coordinator);
    await q("select public.staff_set_intake_status($1,'complete')", [L.b]);
    await as(U.admin);
    await q("select public.staff_approve_documents_in_absence($1,'Director at the funder meeting all day')", [L.b]);
    assert.equal((await locks()).length, 1, 'one per client per 6 months');
    await db.exec('reset role;');
    assert.ok((await q("select 1 from public.staff_audit_events where entity_id=$1 and event_type='r100_not_due'", [L.b])).length);

    // ---- 3. No agent on the file: no line ------------------------------------------------------------------------
    await as(U.owner);
    await q("select public.staff_set_intake_status($1,'verified')", [L.c]);
    assert.equal((await locks()).length, 1);

    // ---- 4. The Administrator's absence approval releases it too ----------------------------------------------------
    await as(U.coordinator);
    await q("select public.staff_set_intake_status($1,'complete')", [L.d]);
    await as(U.admin);
    await q("select public.staff_approve_documents_in_absence($1,'Director on leave for the day')", [L.d]);
    rows = await locks();
    assert.equal(rows.length, 2);
    assert.equal(rows[1].beneficiary_profile_id, U.agent, 'attribution falls back to the lead');
    assert.equal(rows[1].via, 'administrator_absence_approval');
    await as(U.owner);
    await q("select public.staff_set_intake_status($1,'verified')", [L.d]);
    assert.equal((await locks()).length, 2, 'the Director verifying later does not add a second line');

    // ---- 5. Not payable before the Agent Code ----------------------------------------------------------------------
    await as(U.owner);
    const month = (await one("select to_char(date_trunc('month', (now() at time zone 'Africa/Johannesburg')::date), 'YYYY-MM-DD') as m")).m;
    let batch = (await one('select public.owner_schedule_qualified_reward_batch($1::date, 15) as b', [month])).b;
    assert.equal(batch.scheduled_count, 0, 'no one is cleared yet');
    assert.equal(batch.waiting_for_agent_code, 2);
    await as(U.admin);
    await rejects(() => q("select public.owner_issue_agent_code($1,'FNC-SA-001',current_date)", [U.sub]), /Only the Director/, '42501');
    assert.equal((await q('select * from public.agent_clearances_list()')).length, 0);
    await as(U.owner);
    await rejects(() => q("select public.owner_issue_agent_code($1,'FNC-SC-001',current_date)", [U.coordinator]), /active agents/);
    await rejects(() => q("select public.owner_issue_agent_code($1,'FNC-SA-001',current_date + 1)", [U.sub]), /iFacts cleared/);
    assert.equal((await one("select public.owner_issue_agent_code($1,'fnc-sa-001',current_date) as c", [U.sub])).c, 'FNC-SA-001');
    await rejects(() => q("select public.owner_issue_agent_code($1,'FNC-SA-001',current_date)", [U.agent]), /already in use/);
    batch = (await one('select public.owner_schedule_qualified_reward_batch($1::date, 15) as b', [month])).b;
    assert.equal(batch.scheduled_count, 1, 'only the cleared agent is scheduled');
    assert.equal(batch.waiting_for_agent_code, 1);

    // ---- 6. The portals' rewards card works ------------------------------------------------------------------------
    await as(U.sub);
    const mine = await q('select * from public.qualified_reward_workspace()');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].current_status, 'scheduled');
    assert.equal((await one('select public.my_reward_gate() as g')).g.cleared, true);
    await as(U.agent);
    const agentRows = await q('select * from public.qualified_reward_workspace()');
    assert.equal(agentRows.length, 1);
    assert.equal(agentRows[0].current_status, 'locked', 'earned, waiting for the Agent Code');
    assert.equal((await one('select public.my_reward_gate() as g')).g.cleared, false);

    // ---- 7. The legacy route is closed; history cannot be rewritten ------------------------------------------------
    await as(U.owner);
    await rejects(() => q('select public.owner_lock_complete_document_reward($1,$2,$3)', [id(999), U.agent, 'contractor']), /permission denied/);
    await rejects(() => q('select public.r100_create_for_verified($1,$2,$3)', [L.c, 'director_verified', U.owner]), /permission denied/);
    await db.exec('reset role;');
    await rejects(() => q('update public.complete_document_reward_locks set amount = 100'), /immutable/);
    await rejects(() => q('delete from public.agent_onboarding_clearances'), /append-only/);
    assert.equal((await one("select count(*)::int c from pg_policies where tablename = 'agent_onboarding_clearances'")).c, 0);
  } finally {
    await db.close();
  }
});
