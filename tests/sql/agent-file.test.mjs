import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Agent file: the agent-code-onboarding harness (staff build, R100, HR, the onboarding checklist), then the payee profile
// table + backend (Vault and pgcrypto stubbed in an "extensions"/"vault" schema) and 20261117110000/111000, against an
// isolated PostgreSQL (PGlite) with real database roles and auth.uid() claims. It proves the Office Administrator, HR
// and the Director capture an agent's details and bank details on the agent's behalf, the Administrator reads masked
// only, HR and the Director see full numbers, the capturer cannot verify, other roles are refused, and sub-agents get
// their own payee slot. It does NOT prove the live schema or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');
const { pgcrypto } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/pgcrypto.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/pgcrypto');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10), hr: id(11) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Agent file: staff capture details and bank details on the agent\'s behalf; full numbers stay with HR and the Director', async () => {
  const db = new PGlite({ extensions: { btree_gist, pgcrypto } });
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
    await db.exec(await mig('20261117100000_admin_marks_onboarding.sql'));
    await db.exec(`insert into public.profiles(id,email,full_name,role) values ('${U.hr}','hr@example.test','Sam HR','hr');
      insert into public.staff_access(profile_id, staff_role, access_enabled, contract_reference) values ('${U.hr}','hr',true,'HR-01');`);

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    await db.exec('reset role;');

    // ---- Payee profile foundation as live (Builds 2 + 3.1), with Vault / pgcrypto / storage stubs ------------------------
    const saIdSrc = await mig('20261102120000_sa_id_duplicates.sql');
    const saStart = saIdSrc.indexOf('create or replace function public.sa_id_normalise');
    const saGrant = 'grant execute on function public.sa_id_normalise(text) to authenticated;';
    const saEnd = saIdSrc.indexOf(saGrant) + saGrant.length;
    await db.exec([
      'create schema extensions; create extension pgcrypto schema extensions;',
      'create schema vault; create table vault.secrets(name text primary key, secret text, description text);',
      'create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;',
      "create function vault.create_secret(p_secret text, p_name text, p_desc text) returns uuid language plpgsql as $$ begin insert into vault.secrets values (p_name, p_secret, p_desc); return gen_random_uuid(); end $$;",
      "create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;",
      "create type public.activity_event_type as enum ('CREATE','UPDATE','DELETE','STATUS_CHANGE','PERMISSION_CHANGE');",
      'alter table public.activity_logs add column if not exists after_values jsonb;',
      'alter table public.profiles add column if not exists phone_number text;',
      'create table public.notification_preferences(user_id uuid, event_type public.notification_event_type, in_app_enabled boolean, email_enabled boolean, primary key (user_id, event_type));',
      "create function public.emit_in_app_notification(p_user uuid, p_event public.notification_event_type, p_title text, p_body text, p_link text, p_data jsonb) returns void language plpgsql as $$ begin null; end $$;",
      "create function public.partner_profile_id(p uuid) returns uuid language sql stable security definer set search_path = '' as $$ select x.id from public.profiles x where x.referral_partner_id = p and x.role = 'partner' limit 1 $$;",
      "create or replace function public.current_partner_id() returns uuid language sql stable security definer set search_path = '' as $$ select p.referral_partner_id from public.profiles p where p.id = (select auth.uid()) and p.role = 'partner' $$;",
      saIdSrc.slice(saStart, saEnd),
    ].join('\n'));
    await db.exec(await mig('20260807220000_shared_payee_payment_profiles.sql'));
    await db.exec(await mig('20260810120000_payee_profile_events.sql'));
    await db.exec(await mig('20260810120100_payee_profile_backend.sql'));
    await db.exec(await mig('20261117110000_agent_file.sql'));
    // Part 2 runs outside a transaction, one statement at a time (CREATE INDEX CONCURRENTLY), as it must live.
    for (const stmt of (await mig('20261117111000_agent_file_payee_index.sql')).replace(/^--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)) {
      await db.query(stmt);
    }

    const ACCOUNT = '62012345678';
    const SA_ID = '8001015009087';
    const file = (who, profile) => as(who).then(() => one('select public.staff_get_agent_file($1) as f', [profile]).then((r) => r.f));
    const details = (who, profile, a = {}) => as(who).then(() => q('select public.staff_save_agent_details($1,$2,$3,$4,$5,$6)',
      [profile, a.name ?? null, a.phone ?? null, a.address ?? null, a.contract ?? null, a.id ?? null]));
    const bank = (who, profile, a = {}) => as(who).then(() => one(
      'select public.staff_save_agent_payee($1,$2,$3,$4,$5::public.payee_bank_account_type,$6,$7,$8::public.payee_vat_status,$9,$10) as id',
      [profile, a.holder ?? null, a.bank ?? null, a.branch ?? null, a.type ?? null, a.account ?? null, a.tax ?? null, a.vat ?? null, a.vatNo ?? null, a.proof ?? null]).then((r) => r.id));
    const sensitive = (who, profile) => as(who).then(() => one('select * from public.staff_get_agent_sensitive($1)', [profile]));

    // ---- 1. Details: the Office Administrator captures them; validation; email untouched ---------------------------------
    await details(U.admin, U.agent, { name: 'Thabo Agent', phone: '082 123 4567', address: '1 Main Road, Soweto', contract: 'DRA-01', id: SA_ID });
    await rejects(() => details(U.admin, U.agent, { id: '8001015009088' }), /valid 13-digit SA ID/);
    await rejects(() => details(U.admin, U.agent, { contract: 'XYZ' }), /SAA-01 .* or DRA-01/);
    await rejects(() => details(U.admin, U.agent, { phone: '12' }), /10 to 15 digits/);
    await rejects(() => details(U.admin, U.agent, { address: 'Account 62012345678 at the bank' }), /no ID or bank numbers/);
    await rejects(() => details(U.admin, U.agent, {}), /Nothing to save/);
    await rejects(() => details(U.admin, U.coordinator, { name: 'Not an agent' }), /active agents, sub-agents and Team Leaders/);
    await db.exec('reset role;');
    const prof = await one('select full_name, phone_number, email from public.profiles where id=$1', [U.agent]);
    assert.deepEqual(prof, { full_name: 'Thabo Agent', phone_number: '0821234567', email: 'Agent@example.test' });
    const stored = await one("select contract_type, id_number_ciphertext is not null as enc, position(convert_to($2, 'UTF8') in id_number_ciphertext) as plain from public.agent_details where profile_id=$1", [U.agent, SA_ID]);
    assert.equal(stored.contract_type, 'DRA-01');
    assert.equal(stored.enc, true);
    assert.equal(stored.plain, 0, 'the ID number is stored encrypted');

    // ---- 2. Bank details on the agent's behalf: incomplete without proof, then sent to the Director ------------------------
    const payee = await bank(U.admin, U.agent, { holder: 'T Agent', bank: 'Capitec', branch: '470010', type: 'savings', account: ACCOUNT });
    await db.exec('reset role;');
    let row = await one('select verification_status, captured_by, captured_by_role, contractor_id, account_last_four from public.payee_payment_profiles where id=$1', [payee]);
    assert.deepEqual(row, { verification_status: 'incomplete', captured_by: U.admin, captured_by_role: 'administrator', contractor_id: U.agent, account_last_four: '5678' });
    await rejects(() => bank(U.admin, U.agent, { branch: '12345' }), /exactly 6 digits/);
    await rejects(() => bank(U.admin, U.agent, { vat: 'registered' }), /VAT number is required/);
    assert.equal(await bank(U.admin, U.agent, { proof: 'forms/agent-bank-letter.pdf' }), payee, 'one profile per agent');
    await db.exec('reset role;');
    assert.equal((await one('select verification_status from public.payee_payment_profiles where id=$1', [payee])).verification_status, 'pending_verification');
    assert.equal((await one("select count(*)::int c from public.notifications where user_id=$1 and event_type='PAYEE_PROFILE_SUBMITTED'", [U.owner])).c, 1, 'the Director is asked to verify');

    // ---- 3. The Administrator reads masked only; HR and the Director see full numbers ---------------------------------------
    const f = await file(U.admin, U.agent);
    assert.equal(f.bank.account_last_four, '5678');
    assert.equal(f.has_id_number, true);
    assert.equal(f.contract_type, 'DRA-01');
    assert.equal(f.can_view_sensitive, false);
    assert.equal(f.bank.captured_by_role, 'administrator');
    assert.ok(!JSON.stringify(f).includes(ACCOUNT) && !JSON.stringify(f).includes(SA_ID), 'the file carries no full numbers');
    await rejects(() => sensitive(U.admin, U.agent), /Only HR or the Director/, '42501');
    const hrView = await sensitive(U.hr, U.agent);
    assert.deepEqual([hrView.id_number, hrView.account_number], [SA_ID, ACCOUNT]);
    assert.equal((await sensitive(U.owner, U.agent)).account_number, ACCOUNT);
    assert.equal((await file(U.hr, U.agent)).can_view_sensitive, true);

    // ---- 4. The capturer does not verify: only the Director does; a later edit undoes the verification -----------------
    await as(U.admin);
    await rejects(() => q('select public.set_payee_payment_verification($1,true)', [payee]), /Only the owner/);
    await as(U.owner);
    await q('select public.set_payee_payment_verification($1,true)', [payee]);
    await bank(U.hr, U.agent, { branch: '250655' });
    await db.exec('reset role;');
    row = await one('select verification_status, verified_by, captured_by_role from public.payee_payment_profiles where id=$1', [payee]);
    assert.deepEqual(row, { verification_status: 'pending_verification', verified_by: null, captured_by_role: 'hr' });

    // ---- 5. Everyone else is refused; no direct table access ---------------------------------------------------------------
    for (const who of [U.coordinator, U.switchboard, U.agent, U.sub, U.adminOff]) {
      await rejects(() => file(who, U.agent), /Only the Director, HR or the Office Administrator/, '42501');
      await rejects(() => bank(who, U.agent, { branch: '250655' }), /Only the Director, HR or the Office Administrator/, '42501');
      await rejects(() => details(who, U.agent, { name: 'Someone else' }), /Only the Director, HR or the Office Administrator/, '42501');
      await rejects(() => sensitive(who, U.agent), /Only HR or the Director/, '42501');
    }
    await as(U.admin);
    await rejects(() => q('select * from public.payee_payment_profiles'), /permission denied/);
    await rejects(() => q('select * from public.agent_details'), /permission denied/);
    await rejects(() => q('select public.agent_file_actor_role()'), /permission denied/);

    // ---- 6. Sub-agents get their own payee slot; partners need a linked brokerage ------------------------------------------
    const subPayee = await bank(U.admin, U.sub, { holder: 'S Agent', bank: 'FNB', branch: '250655', type: 'cheque', account: '1234567890', proof: 'forms/sub-bank.pdf' });
    assert.equal(await bank(U.admin, U.sub, { holder: 'S. Agent' }), subPayee);
    await db.exec('reset role;');
    assert.equal((await one('select lead_referrer_id from public.payee_payment_profiles where id=$1', [subPayee])).lead_referrer_id, U.sub);
    await as(U.sub);
    assert.equal((await one('select account_last_four from public.get_my_payee_payment_profile()')).account_last_four, '7890', 'the sub-agent sees their own masked profile');
    await rejects(() => bank(U.admin, U.leader, { bank: 'ABSA' }), /not linked to a brokerage/);
    await db.exec('reset role;');
    const brokerage = (await one("insert into public.referral_partners(name) values ('Bright Destiny') returning id")).id;
    await q('update public.profiles set referral_partner_id=$1 where id=$2', [brokerage, U.leader]);
    const leaderPayee = await bank(U.admin, U.leader, { bank: 'ABSA' });
    await db.exec('reset role;');
    assert.equal((await one('select referral_partner_id from public.payee_payment_profiles where id=$1', [leaderPayee])).referral_partner_id, brokerage);
    await as(U.owner);
    const kinds = Object.fromEntries((await q('select id, subject_kind from public.list_payee_payment_profiles_owner()')).map((r) => [r.id, r.subject_kind]));
    assert.deepEqual([kinds[payee], kinds[subPayee], kinds[leaderPayee]], ['contractor', 'sub_agent', 'partner']);

    // ---- 7. Structure and audit: one subject, validated constraints, unique sub-agent slot, numbers never logged -------
    await db.exec('reset role;');
    await rejects(() => q('insert into public.payee_payment_profiles(contractor_id, lead_referrer_id) values ($1,$2)', [U.agent, U.sub]), /one_subject_ck/);
    assert.equal((await one("select count(*)::int c from pg_constraint where conname in ('payee_payment_profiles_lead_referrer_fk','payee_payment_profiles_captured_by_fk','payee_payment_profiles_one_subject_ck') and convalidated")).c, 3);
    assert.ok(await one("select 1 as x from pg_indexes where indexname='payee_payment_profiles_lead_referrer_uniq'"));
    const audit = await q("select event_type, actor_role, detail::text as detail from public.staff_audit_events where entity_type='agent_file' order by id");
    assert.ok(audit.some((a) => a.event_type === 'agent_details_saved' && a.actor_role === 'administrator'));
    assert.ok(audit.some((a) => a.event_type === 'agent_bank_details_captured'));
    assert.equal(audit.filter((a) => a.event_type === 'agent_sensitive_viewed').length, 2);
    assert.ok(audit.every((a) => !a.detail.includes(ACCOUNT) && !a.detail.includes(SA_ID)), 'audit holds no full numbers');
    for (const fn of ['staff_get_agent_file(uuid)', 'staff_save_agent_details(uuid,text,text,text,text,text)', 'staff_get_agent_sensitive(uuid)']) {
      assert.equal((await one(`select has_function_privilege('anon','public.${fn}','execute') as x`)).x, false, fn);
    }
  } finally {
    await db.close();
  }
});
