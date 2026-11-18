import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Owner diary (owner, 18 Nov 2026): runs the staff-build, field-diary and owner-diary migrations against an isolated
// PostgreSQL (PGlite), switching real database roles with auth.uid() claims. It proves the new event types, that a
// Personal event is always private, that a 'manage_diary' grantee fills in the Director's diary but sees a Personal
// event only as a busy block and can never touch it, that a non-grantee or an expired / revoked grant is refused, and
// that the field-meetings layer is the Director's only. It does NOT prove the live schema or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { hr: id(15), owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10), fsup: id(11), fcon: id(12), fcon2: id(13), fsup2: id(14) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Owner diary: event types, Personal privacy and the manage_diary delegate are enforced by the database', async () => {
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
      profile(U.hr, 'HRPerson', 'hr'),
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
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01'], [U.fsup, 'FS-01'], [U.fcon, 'FC-01'], [U.fcon2, 'FC-02'], [U.hr, 'HR-01']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    await db.exec('reset role;');
    await db.exec(await mig('20261118120000_field_diary_enum.sql'));
    await db.exec(await mig('20261118121000_field_diary.sql'));

    // Live columns and helpers the owner-diary functions use, which the shared harness does not build.
    await db.exec([
      'alter table public.owner_calendar_events add column client_id uuid, add column deal_id uuid, add column task_id uuid;',
      'alter table public.deals add column reference text, add column client_id uuid;',
      "create table public.owner_tasks(id uuid primary key default gen_random_uuid(), title text, notes text, due_at timestamptz, priority text, client_id uuid, lead_id uuid, deal_id uuid, assigned_to uuid, created_by uuid, task_kind text, status text not null default 'open', completed_at timestamptz, completed_by uuid, blocker_reason text);",
      "create or replace function public.calendar_reference_is_visible(a uuid default null, b uuid default null, c uuid default null) returns boolean language sql stable as $$ select public.is_owner() $$;",
      "create or replace function public.calendar_is_presentation_window(s timestamptz, e timestamptz) returns boolean language sql immutable as $$ select e > s $$;",
    ].join('\n'));
    await db.exec(await mig('20261118130000_owner_diary.sql'));

    const at = (day, hh, mm = 0) => `2030-02-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+02:00`;
    const ownerCreate = (title, cat, s, e, vis = 'private', pub = null) => one(
      'select * from public.owner_create_calendar_event($1,$2,$3,$4,$5,$6,null,null,null,null,false)', [title, cat, s, e, vis, pub]);
    const delegateCreate = (title, cat, s, e, vis = 'private') => one(
      'select public.staff_diary_create_event($1,$2,$3,$4,$5,$6,$7) as id', [U.owner, title, cat, s, e, vis, vis === 'public' ? 'Public label' : null]);
    const events = () => q('select * from public.staff_diary_events($1,$2,$3)', [U.owner, at(1, 0), at(28, 0)]);
    const grant = async (who, perm, to = null) => {
      await as(U.owner);
      const r = await one('select public.owner_set_calendar_grant($1,$2,$3,$4) as id', [U.owner, who, perm, to]);
      return r.id;
    };

    // 1. The Director's new event types; Personal is forced private whatever is sent.
    await as(U.owner);
    for (const [i, cat] of ['meeting', 'travel', 'other'].entries()) {
      const ev = await ownerCreate(`Type ${cat}`, cat, at(2 + i, 9), at(2 + i, 10), 'busy');
      assert.equal(ev.category, cat);
      assert.equal(ev.visibility, 'busy');
    }
    const personal = await ownerCreate('Doctor appointment', 'personal', at(5, 9), at(5, 10), 'public', 'Leaked label');
    assert.equal(personal.visibility, 'private');
    assert.equal(personal.public_title, null);
    await rejects(() => ownerCreate('Bad type', 'holiday', at(6, 9), at(6, 10)), /Unsupported event category/);
    await as(null);
    await rejects(() => q("update public.owner_calendar_events set visibility='busy' where id=$1", [personal.id]), /personal_private_ck/);
    await as(U.owner);
    await rejects(() => q("select public.owner_set_calendar_grant($1,$2,'bogus')", [U.owner, U.coordinator]), /calendar_grants_permission_check/);

    // 2. A non-grantee (the Coordinator) and an HR person without a grant are refused.
    for (const who of [U.coordinator, U.hr, U.partner, U.fcon]) {
      await as(who);
      await rejects(() => events(), /permission/, '42501');
      await rejects(() => delegateCreate('Not allowed', 'meeting', at(10, 9), at(10, 10)), /permission/, '42501');
      assert.equal((await q('select * from public.staff_diary_calendars()')).length, 0);
    }

    // 3. A live manage_diary grant (the Coordinator here) fills in the diary; Personal is a busy block only.
    const g = await grant(U.coordinator, 'manage_diary');
    await as(U.coordinator);
    assert.deepEqual((await q('select calendar_owner_id from public.staff_diary_calendars()')).map((r) => r.calendar_owner_id), [U.owner]);
    const seen = await events();
    const busy = seen.find((r) => r.id === personal.id);
    assert.equal(busy.title, 'Busy');
    assert.equal(busy.category, null);
    assert.equal(busy.notes, null);
    assert.equal(busy.is_personal, true);
    assert.equal(busy.can_change, false);
    const created = await delegateCreate('Board meeting', 'meeting', at(11, 9), at(11, 10));
    await rejects(() => delegateCreate('Overlaps', 'other', at(11, 9, 30), at(11, 11)), /overlaps/i);
    await rejects(() => delegateCreate('My personal', 'personal', at(12, 9), at(12, 10)), /Personal/, '42501');
    await rejects(() => q("select public.staff_diary_update_event($1,'Changed','meeting',$2,$3)", [personal.id, at(5, 9), at(5, 10)]), /Personal/, '42501');
    await rejects(() => q("select public.staff_diary_update_event($1,'Changed','personal',$2,$3)", [created.id, at(11, 9), at(11, 10)]), /Personal/, '42501');
    await rejects(() => q("select public.staff_diary_cancel_event($1,'Not mine to cancel')", [personal.id]), /Personal/, '42501');
    await q("select public.staff_diary_update_event($1,'Board meeting moved','travel',$2,$3)", [created.id, at(13, 9), at(13, 10)]);
    await rejects(() => q("select public.staff_diary_cancel_event($1,'x')", [created.id]), /Say why/);
    await q("select public.staff_diary_cancel_event($1,'Director is travelling')", [created.id]);
    await as(null);
    const row = await one('select category, status, created_by from public.owner_calendar_events where id=$1', [created.id]);
    assert.deepEqual(row, { category: 'travel', status: 'cancelled', created_by: U.coordinator });
    const changes = (await q('select kind, actor_role from public.calendar_event_changes where event_id=$1 order by id', [created.id]));
    assert.deepEqual(changes.map((c) => c.kind), ['created', 'rescheduled', 'cancelled']);
    assert.ok(changes.every((c) => c.actor_role === 'coordinator'));
    const audit = await q("select event_type, actor_role from public.staff_audit_events where entity_id=$1 order by id", [created.id]);
    assert.deepEqual(audit.map((a) => a.event_type), ['diary_event_created', 'diary_event_updated', 'diary_event_cancelled']);
    const told = await q("select title from public.notifications where user_id=$1 and event_type='DIARY_BOOKING_CHANGED'", [U.owner]);
    assert.ok(told.length >= 3, 'the Director is told of the delegate changes');

    // 4. Revoked and expired grants are refused.
    await as(U.owner);
    await q("select public.owner_revoke_calendar_grant($1,'No longer needed')", [g]);
    await as(U.coordinator);
    await rejects(() => events(), /permission/, '42501');
    await as(null);
    await q("insert into public.calendar_grants(calendar_owner_id, grantee_id, permission, effective_from, effective_to, granted_by) values ($1,$2,'manage_diary', current_date - 10, current_date - 1, $1)", [U.owner, U.switchboard]);
    await as(U.switchboard);
    await rejects(() => events(), /permission/, '42501');
    assert.equal((await q('select * from public.staff_diary_calendars()')).length, 0);

    // 5. The field-meetings layer is the Director's only.
    await as(U.fsup);
    await q("select public.field_meeting_book($1,'Client visit',$2,$3)", [U.fcon, at(14, 9), at(14, 10)]);
    await as(U.owner);
    const layer = await q('select * from public.owner_field_meetings_range($1,$2)', [at(1, 0), at(28, 0)]);
    assert.deepEqual(layer.map((m) => m.title), ['Client visit']);
    assert.equal(layer[0].owner_name, 'FieldCon');
    for (const who of [U.admin, U.fsup, U.coordinator]) {
      await as(who);
      await rejects(() => q('select * from public.owner_field_meetings_range($1,$2)', [at(1, 0), at(28, 0)]), /permission/, '42501');
    }
    await as(U.owner);
    await rejects(() => q('select * from public.owner_field_meetings_range($1,$2)', [at(1, 0), '2030-12-01T00:00:00+02:00']), /two months/);
  } finally {
    await db.close();
  }
});
