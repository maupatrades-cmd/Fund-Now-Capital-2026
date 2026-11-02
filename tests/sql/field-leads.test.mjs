import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Launch priority 3 (field leads): runs the staff-build migrations, the field-role / targets migration and the field-lead
// migrations against an isolated PostgreSQL (PGlite), switching real database roles with auth.uid() claims. It proves
// field staff capture leads attributed to themselves, see only what they should, that each workflow step can only be
// made by the named role and is logged with the real role, that Ready for sale writes the R150 / R100 lead fees once,
// that the Sales Coordinator confirms and the Administrator approves them, that conversion opens a normal client file,
// and that the field targets count real numbers. It does NOT prove the live schema or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10), fsup: id(11), fcon: id(12), fcon2: id(13), fsup2: id(14) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Launch priority 3: field leads, the lead workflow and lead fees are enforced by the database', async () => {
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
    await db.exec(await mig('20261021130000_field_roles_enum.sql'));
    await db.exec(await mig('20261102105000_field_leads_enums.sql'));
    const profile = (uid, name, role) => `insert into public.profiles(id,email,full_name,role) values ('${uid}','${name}@example.test','${name}','${role}');`;
    await db.exec([
      profile(U.owner, 'Founder', 'owner'), profile(U.coordinator, 'Coordinator', 'coordinator'),
      profile(U.switchboard, 'Switchboard', 'switchboard'), profile(U.admin, 'Administrator', 'administrator'),
      profile(U.partner, 'Partner', 'partner'), profile(U.adminOff, 'AdminOff', 'administrator'),
      profile(U.sb2, 'Reception2', 'switchboard'), profile(U.agent, 'Agent', 'contractor'),
      profile(U.sub, 'SubAgent', 'lead_referrer'), profile(U.leader, 'Leader', 'partner'),
      profile(U.fsup, 'FieldSup', 'field_supervisor'), profile(U.fcon, 'FieldCon', 'field_consultant'),
      profile(U.fcon2, 'FieldCon2', 'field_consultant'), profile(U.fsup2, 'FieldSup2', 'field_supervisor'),
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
    await db.exec(await mig('20261021131000_field_roles_landing_targets.sql'));

    await db.exec(await mig('20261102110000_field_leads.sql'));

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01'], [U.fsup, 'FS-01'], [U.fcon, 'FC-01'], [U.fcon2, 'FC-02']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    await db.exec('reset role;');
    await q("insert into public.funding_product_catalog(code, display_name) values ('working_capital','Working capital') on conflict do nothing");
    await q("insert into public.clients(business_name, cipc_number) values ('Old Client','2019/111111/07')");
    const capture = (name, extra = {}) => one(
      'select public.staff_capture_field_lead($1,$2,$3,$4,$5,$6,$7,$8) as r',
      [name, extra.contact ?? 'Thandi', extra.cell ?? '0821234567', extra.email ?? null, extra.cipc ?? null, extra.area ?? 'Soweto', extra.note ?? null, extra.key ?? `key-${name}-0001`]);
    const notices = async (uid, ev) => q('select title from public.notifications where user_id=$1 and event_type=$2 order by created_at', [uid, ev]);

    // ---- 1. Capture: field roles only, attributed, idempotent, duplicates refused --------------------------------
    await as(U.switchboard);
    await rejects(() => capture('Nope'), /Only field consultants/, '42501');
    await as(U.fcon);
    const a = (await capture('Alpha Spaza', { cipc: '2021/222222/07' })).r;
    assert.equal(a.status, 'created');
    assert.equal((await capture('Alpha Spaza', { cipc: '2021/222222/07' })).r.lead_id, a.lead_id, 'a retry returns the same lead');
    assert.equal((await capture('Beta Copy', { cipc: '2021 222222 07', key: 'key-beta-0002' })).r.status, 'already_registered', 'same CIPC, written differently');
    assert.equal((await capture('Old Client Again', { cipc: '2019/111111/07', key: 'key-old-0003' })).r.status, 'already_registered', 'already an FNC client');
    await rejects(() => capture('No Contact', { cell: '', key: 'key-none-0004' }), /cell number or an email/);
    await rejects(() => capture('Leaky', { note: 'ID 8001015009087', key: 'key-leak-0005' }), /ID or account-length/);
    await as(U.fcon2);
    const b = (await capture('Gamma Motors', { cell: '0839998888', key: 'key-gamma-0006' })).r;
    await as(U.fsup);
    const c = (await capture('Delta Salon', { cell: '0711112222', key: 'key-delta-0007' })).r;
    await db.exec('reset role;');
    const track = await one('select captured_by, captured_role, status from public.field_lead_tracks where lead_id=$1', [a.lead_id]);
    assert.deepEqual({ ...track }, { captured_by: U.fcon, captured_role: 'field_consultant', status: 'captured' });
    assert.equal((await one('select entered_by from public.leads where id=$1', [a.lead_id])).entered_by, U.fcon, 'the lead record is attributed too');
    assert.equal((await notices(U.coordinator, 'FIELD_LEAD_UPDATED')).length, 3, 'the Sales Coordinator hears about each new field lead');
    await rejects(() => q("update public.field_lead_tracks set status='ready_for_sale' where lead_id=$1", [a.lead_id]), /only through the field-lead functions/);
    await rejects(() => q('delete from public.field_lead_tracks where lead_id=$1', [a.lead_id]), /cannot be deleted/);

    // ---- 2. Visibility -----------------------------------------------------------------------------------------
    await as(U.fcon);
    assert.deepEqual((await q('select business_name from public.staff_field_leads(true)')).map((r) => r.business_name), ['Alpha Spaza'], 'own leads only');
    await as(U.fsup);
    assert.equal((await q('select * from public.staff_field_leads(true)')).length, 3, 'the Field Supervisor sees the field team');
    await as(U.coordinator);
    assert.equal((await q('select * from public.staff_field_leads(true)')).length, 3);
    await as(U.switchboard);
    await rejects(() => q('select * from public.staff_field_leads(true)'), /permission/, '42501');

    // ---- 3. One step at a time, by the named role ----------------------------------------------------------------
    const move = (lead, to, note = null, who = null) => one('select public.staff_move_field_lead($1,$2,$3,$4) as r', [lead, to, note, who]);
    await as(U.fcon);
    await rejects(() => move(a.lead_id, 'assigned', null, U.fcon), /cannot move this lead from captured to assigned/, '42501');
    await rejects(() => move(a.lead_id, 'contacted'), /cannot move/, '42501');
    await as(U.coordinator);
    await rejects(() => move(a.lead_id, 'contacted'), /cannot move/, '42501');
    await rejects(() => move(a.lead_id, 'assigned', null, U.partner), /Choose an active field consultant/);
    await rejects(() => move(a.lead_id, 'assigned', null, U.fsup2), /Choose an active field consultant/); // access not enabled
    assert.equal((await move(a.lead_id, 'assigned', 'Back to the consultant who met them', U.fcon)).r, 'assigned');
    assert.equal((await move(b.lead_id, 'new_leads')).r, 'new_leads');
    await as(U.admin);
    assert.equal((await move(b.lead_id, 'assigned', null, U.coordinator)).r, 'assigned', 'the Administrator can assign from New Leads');
    await as(U.fcon2);
    await rejects(() => move(b.lead_id, 'contacted'), /cannot move/, '42501');
    await as(U.fcon);
    assert.equal((await move(a.lead_id, 'contacted', 'Visited the shop')).r, 'contacted');
    await rejects(() => move(a.lead_id, 'converted'), /cannot move/, '42501');
    assert.equal((await move(a.lead_id, 'ready_for_sale')).r, 'ready_for_sale');
    await db.exec('reset role;');
    const ev = await q('select actor_role, from_status, to_status from public.field_lead_events where lead_id=$1 order by id', [a.lead_id]);
    assert.deepEqual(ev.map((e) => `${e.actor_role}:${e.from_status ?? '-'}>${e.to_status}`),
      ['field_consultant:->captured', 'coordinator:captured>assigned', 'field_consultant:assigned>contacted', 'field_consultant:contacted>ready_for_sale']);
    const evB = await q('select actor_role from public.field_lead_events where lead_id=$1 and to_status=$2', [b.lead_id, 'assigned']);
    assert.equal(evB[0].actor_role, 'administrator', 'logged with the real role');
    assert.equal((await notices(U.fcon, 'FIELD_LEAD_UPDATED')).length, 1, 'told when a lead is given to them');
    await assert.rejects(() => q('update public.field_lead_events set note=$1', ['x']));

    // ---- 4. Lead fees: once per lead, confirm then approve -------------------------------------------------------
    let fees = await q('select fee_kind, beneficiary_id, amount, status from public.field_lead_fees where lead_id=$1 order by fee_kind', [a.lead_id]);
    assert.deepEqual(fees.map((f) => [f.fee_kind, f.beneficiary_id, Number(f.amount), f.status]),
      [['consultant_lead_fee', U.fcon, 150, 'pending'], ['supervisor_lead_fee', U.fsup, 100, 'pending']], 'R150 to the consultant, R100 to the only enabled supervisor');
    assert.equal((await notices(U.fcon, 'LEAD_FEE_STATUS_CHANGED')).length, 1);
    await as(U.fcon);
    await rejects(() => move(a.lead_id, 'dropped', 'no'), /reason/);
    // The Field Supervisor's own capture: assigned to them, they mark it.
    await as(U.coordinator);
    await move(c.lead_id, 'assigned', null, U.fsup);
    await as(U.fsup);
    await move(c.lead_id, 'contacted');
    await move(c.lead_id, 'ready_for_sale');
    await db.exec('reset role;');
    fees = await q('select fee_kind, beneficiary_id from public.field_lead_fees where lead_id=$1', [c.lead_id]);
    assert.deepEqual(fees.map((f) => [f.fee_kind, f.beneficiary_id]), [['supervisor_lead_fee', U.fsup]], 'no consultant fee on a supervisor\'s own lead');

    const feeA = (await one("select id from public.field_lead_fees where lead_id=$1 and fee_kind='consultant_lead_fee'", [a.lead_id])).id;
    const decide = (fee, d, note = null) => one('select public.staff_decide_lead_fee($1,$2,$3) as r', [fee, d, note]);
    await as(U.fcon);
    await rejects(() => decide(feeA, 'confirm'), /own lead fee/, '42501');
    assert.deepEqual((await q('select amount, status from public.my_lead_fees()')).map((r) => [Number(r.amount), r.status]), [[150, 'pending']], 'own rand amounts only');
    await rejects(() => q('select * from public.staff_lead_fees(null)'), /permission/, '42501');
    await as(U.admin);
    await rejects(() => decide(feeA, 'approve'), /cannot approve a lead fee that is pending/, '42501');
    await as(U.coordinator);
    assert.equal((await decide(feeA, 'confirm')).r, 'confirmed');
    await rejects(() => decide(feeA, 'approve'), /cannot approve/, '42501');
    await as(U.admin);
    assert.equal((await decide(feeA, 'approve')).r, 'approved');
    await rejects(() => decide(feeA, 'reject', 'Changed my mind'), /cannot reject/, '42501');
    await db.exec('reset role;');
    assert.deepEqual((await q('select to_status from public.field_lead_fee_events where fee_id=$1 order by id', [feeA])).map((r) => r.to_status), ['pending', 'confirmed', 'approved']);
    await rejects(() => q('update public.field_lead_fees set amount=1500 where id=$1', [feeA]), /only through the field-lead functions/);
    assert.equal((await notices(U.fcon, 'LEAD_FEE_STATUS_CHANGED')).length, 2, 'told when it is approved');

    // ---- 5. Converted opens a normal client file -------------------------------------------------------------------
    await as(U.fcon);
    await rejects(() => q("select public.staff_convert_field_lead($1,'working_capital')", [a.lead_id]), /Only the Sales Coordinator/, '42501');
    await as(U.coordinator);
    await rejects(() => q("select public.staff_convert_field_lead($1,'working_capital')", [b.lead_id]), /ready for sale/);
    await rejects(() => q("select public.staff_convert_field_lead($1,'nope')", [a.lead_id]), /funding type/);
    await q("select public.staff_convert_field_lead($1,'working_capital',250000)", [a.lead_id]);
    await rejects(() => q("select public.staff_convert_field_lead($1,'working_capital')", [a.lead_id]), /ready for sale/);
    await db.exec('reset role;');
    const file = await one('select channel, agent_profile_id, workflow_status, affiliation_snapshot from public.submission_intakes where lead_id=$1', [a.lead_id]);
    assert.equal(file.channel, 'direct_agent');
    assert.equal(file.agent_profile_id, null, 'no agent on a field-team file');
    assert.equal(file.workflow_status, 'new');
    assert.equal(file.affiliation_snapshot.source, 'field_lead');
    assert.equal(Number((await one('select funding_amount from public.leads where id=$1', [a.lead_id])).funding_amount), 250000);
    assert.equal((await one('select status from public.field_lead_tracks where lead_id=$1', [a.lead_id])).status, 'converted');

    // ---- 6. Drop with a reason; the landing page; targets ----------------------------------------------------------
    await as(U.coordinator);
    await move(b.lead_id, 'dropped', 'Client not interested');
    await rejects(() => move(b.lead_id, 'assigned', null, U.fcon2), /cannot move this lead from dropped/, '42501');
    await as(U.fcon);
    const sum = await one('select * from public.my_field_lead_summary()');
    assert.deepEqual([sum.captured_mtd, sum.ready_mtd, sum.open_leads, Number(sum.fees_pending), Number(sum.fees_approved)], [1, 1, 0, 0, 150]);
    const t = Object.fromEntries((await q('select * from public.my_targets()')).map((r) => [r.metric_key, r]));
    assert.equal(Number(t.leads_captured.actual), 1);
    assert.equal(Number(t.ready_for_sale.actual), 1);
    await as(U.fsup);
    const s = Object.fromEntries((await q('select * from public.my_targets()')).map((r) => [r.metric_key, r]));
    assert.deepEqual([s.active_consultants, s.team_leads, s.team_ready_for_sale].map((r) => Number(r.actual)), [2, 3, 2]);
    assert.equal((await one('select * from public.my_field_lead_summary()')).captured_mtd, 3, 'the team\'s numbers');
    await as(U.coordinator);
    await rejects(() => q('select * from public.my_field_lead_summary()'), /permission/, '42501');
    await db.exec('reset role; set role anon;');
    await rejects(() => q('select * from public.staff_field_leads(true)'), /permission denied/);
  } finally {
    await db.close();
  }
});
