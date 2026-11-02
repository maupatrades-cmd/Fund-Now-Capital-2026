import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Agent Code onboarding: the same harness as r100-on-verified (staff build, batches 1 to 5b, the R100 workspace and the
// Verified migration), then HR as its own enabled staff role and 20261102090000/100000, against an isolated PostgreSQL
// (PGlite) with real database roles and auth.uid() claims. It proves HR's four-document checklist and iFacts date, the
// Sales Coordinator's gated Agent Code, the Director's override with a reason, who may see the list, and the 30-day R100
// forfeit (never scheduled, shown as forfeited, not revived by a late code). It does NOT prove the live schema or screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10), hr: id(11) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('HR checklist gates the Sales Coordinator\'s Agent Code; the Director overrides with a reason; R100 forfeits after 30 days', async () => {
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

    // HR as its own enabled staff role (as live after 20261019101000 / 20261021131000), then this change.
    await db.exec(await mig('20261019100000_hr_role_enum.sql'));
    await db.exec([
      'alter table public.staff_access drop constraint if exists staff_access_role_ck;',
      "alter table public.staff_access add constraint staff_access_role_ck check (staff_role::text in ('switchboard','coordinator','administrator','hr'));",
      "create or replace function public.staff_role_of() returns text language sql stable security definer set search_path = '' as $$ select p.role::text from public.profiles p join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role where p.id = (select auth.uid()) and p.is_active and s.access_enabled and p.role::text in ('switchboard','coordinator','administrator','hr') $$;",
    ].join('\n'));
    await db.exec(await mig('20261102090000_agent_code_enums.sql'));
    await db.exec(await mig('20261102100000_agent_code_onboarding.sql'));
    await db.exec(`insert into public.profiles(id,email,full_name,role) values ('${U.hr}','hr@example.test','Sam HR','hr');
      insert into public.staff_access(profile_id, staff_role, access_enabled, contract_reference) values ('${U.hr}','hr',true,'HR-01');`);

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    const mark = (who, item, received = true, date = null, note = null) => as(who).then(() =>
      q('select public.hr_mark_onboarding_item($1,$2,$3,$4::date,$5)', [U.sub, item, received, date, note]));
    const issue = (who, profile, code, date = null, reason = null) => as(who).then(() =>
      q('select public.staff_issue_agent_code($1,$2,$3::date,$4) as c', [profile, code, date, reason]));
    const notices = async (uid, ev) => { await db.exec('reset role;'); return (await one('select count(*)::int c from public.notifications where user_id=$1 and event_type=$2', [uid, ev])).c; };
    await db.exec('reset role;');
    const today = (await one('select public.current_sast_date()::text as d')).d;

    // ---- 1. Only HR or the Director ticks the checklist ----------------------------------------------------------------
    await rejects(() => mark(U.coordinator, 'signed_contract'), /Only HR or the Director/, '42501');
    await rejects(() => mark(U.switchboard, 'signed_contract'), /Only HR or the Director/, '42501');
    await rejects(() => mark(U.sub, 'signed_contract'), /Only HR or the Director/, '42501');
    await as(U.hr);
    await rejects(() => q("select public.hr_mark_onboarding_item($1,'signed_contract',true)", [U.coordinator]), /active agents/);
    await rejects(() => mark(U.hr, 'passport'), /Unknown onboarding item/);
    await rejects(() => mark(U.hr, 'bank_letter', true, today), /only recorded when iFacts has cleared/);
    await rejects(() => mark(U.hr, 'ifacts_cleared', true, null), /date iFacts cleared/);
    await rejects(() => mark(U.hr, 'certified_id', true, null, 'ID 8001015009087 checked'), /no ID, bank/);

    // ---- 2. The Sales Coordinator cannot issue before the checklist is complete ---------------------------------------
    await rejects(() => issue(U.coordinator, U.sub, 'FNC-SA-001'), /HR has not yet marked/);
    await rejects(() => issue(U.admin, U.sub, 'FNC-SA-001'), /HR has not yet marked/);
    for (const item of ['signed_contract', 'certified_id', 'bank_letter']) await mark(U.hr, item);
    await rejects(() => mark(U.hr, 'bank_letter'), /Nothing to change/);
    await mark(U.hr, 'ifacts_consent', true, null, 'Consent form signed at the office');
    assert.equal(await notices(U.coordinator, 'AGENT_ONBOARDING_READY'), 0, 'not ready until iFacts clears');
    await rejects(() => issue(U.coordinator, U.sub, 'FNC-SA-001'), /HR has not yet marked/);
    await mark(U.owner, 'ifacts_cleared', true, today);
    assert.equal(await notices(U.coordinator, 'AGENT_ONBOARDING_READY'), 1, 'the Coordinator is told once it is ready');
    assert.equal(await notices(U.admin, 'AGENT_ONBOARDING_READY'), 1, 'the Office Administrator is told too');
    // A tick taken back makes it not ready again; ticking it again tells the Coordinator again.
    await mark(U.hr, 'bank_letter', false, null, 'Wrong bank letter, waiting for the right one');
    await rejects(() => issue(U.coordinator, U.sub, 'FNC-SA-001'), /HR has not yet marked/);
    await mark(U.hr, 'bank_letter');
    assert.equal(await notices(U.coordinator, 'AGENT_ONBOARDING_READY'), 2);

    // ---- 3. Who sees the list ------------------------------------------------------------------------------------------
    for (const who of [U.owner, U.hr, U.admin, U.coordinator]) {
      await as(who);
      const row = (await q('select * from public.agent_onboarding_list() where profile_id=$1', [U.sub]))[0];
      assert.equal(row.ready, true);
      assert.ok(row.signed_contract_at && row.certified_id_at && row.bank_letter_at && row.ifacts_consent_at);
    }
    for (const who of [U.switchboard, U.sub, U.agent]) {
      await as(who);
      await rejects(() => q('select * from public.agent_onboarding_list()'), /permission/, '42501');
    }

    // ---- 4. The Sales Coordinator issues it, with HR's iFacts date; the checklist then closes --------------------------
    await rejects(() => issue(U.switchboard, U.sub, 'FNC-SA-001'), /Sales Coordinator, the Office Administrator or the Director/, '42501');
    await rejects(() => issue(U.hr, U.sub, 'FNC-SA-001'), /Sales Coordinator, the Office Administrator or the Director/, '42501');
    assert.equal((await issue(U.coordinator, U.sub, 'fnc-sa-001'))[0].c, 'FNC-SA-001');
    await rejects(() => issue(U.coordinator, U.sub, 'FNC-SA-002'), /already has an Agent Code/);
    await rejects(() => mark(U.hr, 'signed_contract', false), /checklist is closed/);
    assert.equal(await notices(U.sub, 'AGENT_CODE_ISSUED'), 1, 'the agent is told');
    await db.exec('reset role;');
    assert.equal((await one('select ifacts_cleared_on::text d from public.agent_onboarding_clearances where profile_id=$1', [U.sub])).d, today);
    assert.equal((await one("select actor_role from public.staff_audit_events where entity_id=$1 and event_type='agent_code_issued'", [U.sub])).actor_role, 'coordinator');

    // ---- 5. The Director overrides an incomplete checklist, only with a reason -----------------------------------------
    await rejects(() => issue(U.owner, U.agent, 'FNC-DA-001', today), /give a reason/);
    await rejects(() => issue(U.owner, U.agent, 'FNC-DA-001', null, 'Director met the agent in person'), /date iFacts cleared/);
    await rejects(() => issue(U.owner, U.agent, 'FNC-SA-001', today, 'Director met the agent in person'), /already in use/);
    assert.equal((await issue(U.owner, U.agent, 'FNC-DA-001', today, 'Director met the agent in person'))[0].c, 'FNC-DA-001');
    await db.exec('reset role;');
    assert.equal((await one("select reason from public.staff_audit_events where entity_id=$1 and event_type='agent_code_issued_override'", [U.agent])).reason, 'Director met the agent in person');
    // The Team page route still works for the Director only.
    await as(U.coordinator);
    await rejects(() => q("select public.owner_issue_agent_code($1,'FNC-TL-001',current_date)", [U.leader]), /Only the Director/, '42501');

    // ---- 6. R100 forfeits when no Agent Code follows within 30 days of the submission ----------------------------------
    const L = { late: id(401), fresh: id(402) };
    await db.exec('reset role;');
    await q("insert into public.funding_product_catalog(code, display_name) values ('working_capital','Working capital') on conflict do nothing");
    await q(`insert into public.leads(id, business_name, contact_name, cipc_number) values ($1,'Late Logistics','E','2018/111111/07'), ($2,'Fresh Farms','F','2017/222222/07')`, [L.late, L.fresh]);
    await q(`insert into public.submission_intakes(lead_id, channel, funding_type, created_by, idempotency_key, agent_profile_id)
      values ($1,'direct_agent','working_capital',$3,'idem-key-0101',$4), ($2,'direct_agent','working_capital',$3,'idem-key-0102',$5)`,
      [L.late, L.fresh, U.coordinator, U.leader, U.partner]);
    await db.exec('alter table public.submission_intakes disable trigger user;');
    await q("update public.submission_intakes set registered_at = now() - interval '40 days' where lead_id = $1", [L.late]);
    await db.exec('alter table public.submission_intakes enable trigger user;');
    await as(U.owner);
    await q("select public.staff_set_intake_status($1,'verified')", [L.late]);
    await q("select public.staff_set_intake_status($1,'verified')", [L.fresh]);
    await as(U.leader);
    assert.equal((await q('select * from public.qualified_reward_workspace()'))[0].current_status, 'forfeited');
    await as(U.partner);
    assert.equal((await q('select * from public.qualified_reward_workspace()'))[0].current_status, 'locked', 'inside 30 days: still pending');
    // A code issued now, after the deadline, does not revive the late line; the fresh one is paid.
    for (const [p, code] of [[U.leader, 'FNC-TL-001'], [U.partner, 'FNC-PA-001']]) {
      await issue(U.owner, p, code, today, 'Director cleared this agent today');
    }
    await as(U.owner);
    const month = (await one("select to_char(date_trunc('month', (now() at time zone 'Africa/Johannesburg')::date), 'YYYY-MM-DD') as m")).m;
    const batch = (await one('select public.owner_schedule_qualified_reward_batch($1::date, 15) as b', [month])).b;
    assert.equal(batch.scheduled_count, 1, 'the fresh line; never the forfeited one');
    assert.equal(batch.forfeited, 1);
    assert.equal(batch.waiting_for_agent_code, 0);
    await as(U.leader);
    assert.equal((await q('select * from public.qualified_reward_workspace()'))[0].current_status, 'forfeited');
    await as(U.partner);
    assert.equal((await q('select * from public.qualified_reward_workspace()'))[0].current_status, 'scheduled');
    await db.exec('reset role;');
    assert.equal((await one("select count(*)::int c from public.staff_audit_events where event_type='r100_forfeited'")).c, 1);
    // Scheduling again records no second forfeit.
    await as(U.owner);
    await q('select public.owner_schedule_qualified_reward_batch($1::date, 15)', [month]);
    await db.exec('reset role;');
    assert.equal((await one('select count(*)::int c from public.r100_forfeitures')).c, 1);

    // ---- 7. Evidence cannot be rewritten; internal helpers are closed ----------------------------------------------------
    await rejects(() => q('delete from public.agent_onboarding_checklist_events'), /append-only/);
    await rejects(() => q('update public.r100_forfeitures set deadline = current_date'), /append-only/);
    await as(U.owner);
    for (const fn of ['public.agent_onboarding_state($1)', 'public.r100_is_forfeited($1)', 'public.r100_forfeit_deadline($1)']) {
      await rejects(() => q(`select ${fn}`, [U.sub]), /permission denied/);
    }
    await rejects(() => q('select public.r100_record_forfeitures()'), /permission denied/);
    await db.exec('reset role;');
    for (const t of ['agent_onboarding_checklist_events', 'r100_forfeitures']) {
      assert.equal((await one('select relrowsecurity r from pg_class where relname=$1', [t])).r, true);
      assert.equal((await one('select count(*)::int c from pg_policies where tablename=$1', [t])).c, 0);
    }
  } finally {
    await db.close();
  }
});
