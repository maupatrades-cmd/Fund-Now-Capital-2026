import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Launch priority 2 (staff logins and landing pages): runs the staff-build migrations, batches 1 to 5b and the field-role
// / targets migration against an isolated PostgreSQL (PGlite), switching real database roles with auth.uid() claims. It
// proves the Field Supervisor and field consultant logins hold nothing by default, get notices and targets, that the
// Administrator's work is now recorded with the real role, and that only the Director sees and sets every role's
// targets. It does NOT prove the live schema or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10), fsup: id(11), fcon: id(12) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Launch priority 2: field logins, history role and targets are enforced by the database', async () => {
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
    const profile = (uid, name, role) => `insert into public.profiles(id,email,full_name,role) values ('${uid}','${name}@example.test','${name}','${role}');`;
    await db.exec([
      profile(U.owner, 'Founder', 'owner'), profile(U.coordinator, 'Coordinator', 'coordinator'),
      profile(U.switchboard, 'Switchboard', 'switchboard'), profile(U.admin, 'Administrator', 'administrator'),
      profile(U.partner, 'Partner', 'partner'), profile(U.adminOff, 'AdminOff', 'administrator'),
      profile(U.sb2, 'Reception2', 'switchboard'), profile(U.agent, 'Agent', 'contractor'),
      profile(U.sub, 'SubAgent', 'lead_referrer'), profile(U.leader, 'Leader', 'partner'),
      profile(U.fsup, 'FieldSup', 'field_supervisor'), profile(U.fcon, 'FieldCon', 'field_consultant'),
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

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01'], [U.fsup, 'FS-01']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    await rejects(() => q("select public.owner_set_staff_access($1,true,'X')", [U.partner]), /not a staff role/);

    // ---- 1. Field logins hold nothing by default -----------------------------------------------------------------
    await as(U.fcon);
    assert.equal((await one('select public.staff_actor_role() as r')).r, null, 'switched off until the owner enables it');
    await as(U.fsup);
    assert.equal((await one('select public.staff_actor_role() as r')).r, 'field_supervisor');
    await rejects(() => q('select * from public.staff_task_board()'), /permission/, '42501');
    await rejects(() => q('select public.staff_director_briefing()'), /Founder or the Administrator/, '42501');
    await rejects(() => q('select * from public.admin_fee_invoices_list(false)'), /Administrator or the Director/, '42501');
    const t = await q('select * from public.my_targets()');
    assert.deepEqual(t.map((r) => r.metric_key), ['active_consultants', 'team_leads', 'team_ready_for_sale', 'daily_field_report']);
    assert.ok(t.every((r) => r.status === 'proposed'));
    await as(U.admin);
    await q("select public.staff_post_notice('Training week','Training runs 9 to 13 November',false,array['staff'])");
    await db.exec('reset role;');
    assert.equal((await one('select count(*)::int c from public.staff_notice_recipients where recipient_id=$1', [U.fsup])).c, 1, 'field staff receive staff notices');

    // ---- 2. The Administrator's work is recorded with the real role ------------------------------------------------
    await as(U.admin);
    await q("select public.staff_create_task('Phone the client back','',  'general','normal',null,'coordinator')");
    await as(U.coordinator);
    await q("select public.staff_create_task('Chase the bank statements','','general','normal',null,'coordinator')");
    await db.exec('reset role;');
    const roles = Object.fromEntries((await q('select title, created_role from public.staff_tasks')).map((r) => [r.title, r.created_role]));
    assert.equal(roles['Phone the client back'], 'administrator', 'no longer saved as the Sales Coordinator');
    assert.equal(roles['Chase the bank statements'], 'coordinator');
    const ev = await q("select e.actor_role from public.staff_task_events e join public.staff_tasks t on t.id = e.task_id where t.title = 'Phone the client back'");
    assert.ok(ev.length && ev.every((e) => e.actor_role === 'administrator'));

    // ---- 3. Targets: month-to-date actuals, the Director's overview -------------------------------------------------
    await q("insert into public.funding_product_catalog(code, display_name) values ('working_capital','Working capital') on conflict do nothing");
    await q("insert into public.leads(id, business_name, contact_name) values ($1,'Alpha Traders','A'), ($2,'Beta Bakery','B')", [id(301), id(302)]);
    await q(`insert into public.submission_intakes(lead_id, channel, funding_type, created_by, idempotency_key)
             values ($1,'direct_agent','working_capital',$3,'idem-key-0001'), ($2,'direct_agent','working_capital',$4,'idem-key-0002')`, [id(301), id(302), U.switchboard, U.coordinator]);
    await as(U.switchboard);
    const sb = Object.fromEntries((await q('select * from public.my_targets()')).map((r) => [r.metric_key, r]));
    assert.equal(Number(sb.leads_captured.actual), 1, 'own leads only');
    assert.equal(Number(sb.leads_captured.target), 30);
    assert.equal(sb.missed_calls_2h.actual, null, 'not tracked yet');
    await as(U.coordinator);
    const sc = Object.fromEntries((await q('select * from public.my_targets()')).map((r) => [r.metric_key, r]));
    assert.equal(Number(sc.files_opened.actual), 2, 'office-wide');
    await rejects(() => q('select * from public.owner_targets_overview()'), /Only the Director/, '42501');
    await rejects(() => q("select public.owner_set_role_target('coordinator','files_opened',50)"), /Only the Director/, '42501');
    await as(U.owner);
    const all = await q('select * from public.owner_targets_overview()');
    assert.deepEqual([...new Set(all.map((r) => r.role))].sort(), ['administrator', 'coordinator', 'field_supervisor', 'switchboard']);
    await q("select public.owner_set_role_target('coordinator','files_opened',60)");
    await rejects(() => q("select public.owner_set_role_target('coordinator','nope',1)"), /Target not found/);
    await as(U.coordinator);
    assert.equal((await q('select * from public.my_targets()')).find((r) => r.metric_key === 'files_opened').status, 'confirmed');
    await rejects(() => q('select * from public.role_targets'), /permission denied/);
    await rejects(() => q("select public.role_target_actual('files_opened', null, 'office')"), /permission denied/);
  } finally {
    await db.close();
  }
});
