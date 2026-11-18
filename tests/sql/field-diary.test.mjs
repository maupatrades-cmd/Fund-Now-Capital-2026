import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Field diary (owner, 17 Nov 2026): runs the staff-build and field-role migrations, then the field-diary migrations,
// against an isolated PostgreSQL (PGlite), switching real database roles with auth.uid() claims. It proves who may see
// and book on which field diary, that one person's meetings never overlap, that cancelling needs a reason, that every
// change is audited and that the person is told when someone else books or cancels on their diary. It does NOT prove
// the live schema or the screens.
// and that the field targets count real numbers. It does NOT prove the live schema or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10), fsup: id(11), fcon: id(12), fcon2: id(13), fsup2: id(14) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Field diary: visibility, booking rights, overlap and cancel are enforced by the database', async () => {
  const db = new PGlite({ extensions: { btree_gist } });
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0];
  let current = null;
  const as = async (uid) => {
    current = uid;
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
    await db.exec(await mig('20261118120000_field_diary_enum.sql'));
    await db.exec(await mig('20261118121000_field_diary.sql'));

    // Fixed future dates (SAST) so the test never depends on today's date.
    const at = (day, hh, mm = 0) => `2030-01-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+02:00`;
    const book = (person, title, s, e, extra = {}) => one(
      'select public.field_meeting_book($1,$2,$3,$4,$5,$6,$7,$8) as id',
      [person, title, s, e, extra.kind ?? 'client', extra.loc ?? null, extra.lead ?? null, extra.note ?? null]);
    const list = (person, from = '2030-01-07', to = '2030-01-13', cancelled = false) =>
      q('select * from public.field_meetings_list($1,$2,$3,$4)', [person, from, to, cancelled]);
    const people = async () => (await q('select profile_id from public.field_diary_people()')).map((r) => r.profile_id);
    // Notices are read as the database superuser, then the test's current user is put back.
    const notices = async (uid) => {
      const who = current;
      await as(null);
      const rows = await q("select title, body_text from public.notifications where user_id=$1 and event_type='FIELD_MEETING_UPDATED' order by created_at", [uid]);
      await as(who);
      return rows;
    };
    const setStatus = (mid, s, r) => one('select public.field_meeting_set_status($1,$2,$3) as s', [mid, s, r]);
    const LEAD = '00000000-0000-0000-0000-0000000000aa';
    await q("insert into public.leads(id, business_name, contact_name) values ($1,'Delta Bakery','Sipho')", [LEAD]);

    // ---- 1. Who may open which diary --------------------------------------------------------------------------
    await as(U.fcon);
    assert.deepEqual(await people(), [U.fcon], 'a consultant sees only their own diary');
    await as(U.fsup);
    const sup = await people();
    assert.equal(sup[0], U.fsup, 'own diary first');
    assert.deepEqual([...sup].sort(), [U.fsup, U.fcon, U.fcon2].sort(), 'the supervisor sees consultants, not the other supervisor');
    await as(U.admin);
    assert.equal((await people()).length, 4, 'the Administrator sees every field diary');
    await as(U.owner);
    assert.equal((await people()).length, 4, 'the Director sees every field diary');
    for (const who of [U.coordinator, U.switchboard, U.partner]) {
      await as(who);
      await rejects(() => people(), /permission/, '42501');
    }

    // ---- 2. Booking: own diary, overlap refused, validation ------------------------------------------------------
    await as(U.fcon);
    const m1 = (await book(null, 'Visit Delta Bakery', at(7, 9), at(7, 10), { loc: 'Soweto', lead: LEAD })).id;
    await book(U.fcon, 'Team check-in', at(7, 10), at(7, 10, 30), { kind: 'internal' }); // end-to-start touching is fine
    await rejects(() => book(U.fcon, 'Clash', at(7, 9, 30), at(7, 11)), /overlaps another meeting/);
    await rejects(() => book(U.fcon, 'Backwards', at(7, 11), at(7, 10)), /end after it starts/);
    await rejects(() => book(U.fcon, 'Too long', at(7, 6), at(7, 19)), /at most 12 hours/);
    await rejects(() => book(U.fcon, 'x', at(8, 9), at(8, 10)), /title/);
    await rejects(() => book(U.fcon2, 'Not mine', at(8, 9), at(8, 10)), /permission/, '42501');
    await rejects(() => list(U.fcon2), /permission/, '42501');
    const mine = await list(U.fcon);
    assert.equal(mine.length, 2);
    assert.equal(mine[0].business_name, 'Delta Bakery');
    assert.equal(mine[0].created_role, 'field_consultant');
    assert.equal((await notices(U.fcon)).length, 0, 'no notice when you book your own diary');

    // ---- 3. The supervisor books on a consultant's diary; the consultant is told --------------------------------
    await as(U.fsup);
    await rejects(() => book(U.fcon, 'Clash too', at(7, 9, 15), at(7, 9, 45)), /overlaps/);
    const m3 = (await book(U.fcon, 'Joint visit', at(8, 14), at(8, 15), { loc: 'Alex' })).id;
    assert.equal((await list(U.fcon)).length, 3, "the supervisor sees the consultant's week");
    await book(U.fsup, 'Own planning', at(8, 14), at(8, 15)); // another person's diary does not clash
    await rejects(() => book(U.fsup2, 'Other sup', at(9, 9), at(9, 10)), /permission/, '42501');
    const n = await notices(U.fcon);
    assert.equal(n.length, 1);
    assert.match(n[0].title, /Joint visit/);
    await as(U.admin);
    await book(U.fcon2, 'Admin booked', at(9, 9), at(9, 10));
    assert.equal((await notices(U.fcon2)).length, 1, 'an Administrator booking also tells the person');
    await as(U.switchboard);
    await rejects(() => book(U.fcon, 'Reception', at(9, 9), at(9, 10)), /permission/, '42501');

    // ---- 4. Done / cancel ---------------------------------------------------------------------------------------
    await as(U.fcon);
    await rejects(() => setStatus(m1, 'cancelled', null), /Say why/);
    await rejects(() => setStatus(m1, 'moved', null), /done or cancelled/);
    assert.equal((await setStatus(m1, 'done', null)).s, 'done');
    await rejects(() => setStatus(m1, 'cancelled', 'Client away'), /Only a scheduled/);
    await as(U.fcon2);
    await rejects(() => setStatus(m3, 'done', null), /permission/, '42501');
    await as(U.fsup);
    await setStatus(m3, 'cancelled', 'Client postponed');
    assert.equal((await notices(U.fcon)).length, 2, "cancelling on someone else's diary tells them");
    await as(U.fcon);
    assert.equal((await list(U.fcon)).length, 2, 'cancelled meetings are hidden by default');
    const all = await list(U.fcon, '2030-01-07', '2030-01-13', true);
    assert.equal(all.find((r) => r.id === m3).cancel_reason, 'Client postponed');
    await book(U.fcon, 'Rebooked', at(8, 14), at(8, 15)); // the cancelled slot is free again
    await rejects(() => list(U.fcon, '2030-01-01', '2030-04-01'), /two months/);

    // ---- 5. Audit, and no direct table access -------------------------------------------------------------------
    await db.exec('reset role;');
    const audit = await q("select event_type, actor_role from public.staff_audit_events where entity_type='field_meeting' order by occurred_at");
    assert.ok(audit.some((r) => r.event_type === 'field_meeting_booked' && r.actor_role === 'field_supervisor'));
    assert.ok(audit.some((r) => r.event_type === 'field_meeting_done' && r.actor_role === 'field_consultant'));
    assert.ok(audit.some((r) => r.event_type === 'field_meeting_cancelled'));
    await as(U.fcon);
    await rejects(() => q('select * from public.field_meetings'), /permission denied/);
    await rejects(() => q("update public.field_meetings set title = 'x'"), /permission denied/);
    await db.exec('reset role; set role anon;');
    await rejects(() => q('select * from public.field_diary_people()'), /permission denied/);
  } finally {
    await db.close();
  }
});
