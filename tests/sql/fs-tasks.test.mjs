import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Field team tasks (owner, 17 Nov 2026): runs the staff-build migrations through 20261117150000 and then
// 20261118100000/101000 against an isolated PostgreSQL (PGlite), switching real database roles with auth.uid() claims.
// It proves the task-giving matrix (Director and Administrator -> anyone; Sales Coordinator -> Field Supervisor and
// field consultants; Field Supervisor -> field consultants; nobody else), that the Give task picker lists exactly the
// allowed people, that Important stays Director-only, and that a marketing-materials request from the field goes to
// the Office Administrator (or the Director when no Administrator is enabled) and the requester sees its state.
// It does NOT prove the live schema or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10), fsup: id(11), fcon: id(12), hr: id(13), admin2: id(14), fcon2: id(15) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Field team tasks: who gives tasks to whom, and marketing-materials requests', async () => {
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
    await db.exec(await mig('20261019100000_hr_role_enum.sql'));
    await db.exec(await mig('20261117130000_important_tasks_enums.sql'));
    const profile = (uid, name, role) => `insert into public.profiles(id,email,full_name,role) values ('${uid}','${name}@example.test','${name}','${role}');`;
    await db.exec([
      profile(U.owner, 'Founder', 'owner'), profile(U.coordinator, 'Coordinator', 'coordinator'),
      profile(U.switchboard, 'Switchboard', 'switchboard'), profile(U.admin, 'Administrator', 'administrator'),
      profile(U.partner, 'Partner', 'partner'), profile(U.adminOff, 'AdminOff', 'administrator'),
      profile(U.sb2, 'Reception2', 'switchboard'), profile(U.agent, 'Agent', 'contractor'),
      profile(U.sub, 'SubAgent', 'lead_referrer'), profile(U.leader, 'Leader', 'partner'),
      profile(U.fsup, 'FieldSup', 'field_supervisor'), profile(U.fcon, 'FieldCon', 'field_consultant'),
      profile(U.hr, 'HRPerson', 'hr'), profile(U.admin2, 'SecondAdmin', 'administrator'),
      profile(U.fcon2, 'FieldCon2', 'field_consultant'),
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
    // The live emit_in_app_notification also invokes the email Edge Function; here it only writes the in-app notice.
    await db.exec("create or replace function public.emit_in_app_notification(p_user_id uuid, p_event public.notification_event_type, p_title text, p_body text, p_link text, p_data jsonb) returns void language plpgsql security definer set search_path = '' as $$ begin if p_user_id is null then return; end if; insert into public.notifications (user_id, event_type, title, body_text, link_url, data, read_status) values (p_user_id, p_event, p_title, p_body, p_link, p_data, false); end $$;");
    await db.exec(await mig('20261117131000_important_tasks.sql'));
    await db.exec(await mig('20261117140000_important_tasks_owner_cancel.sql'));
    await db.exec(await mig('20261117150000_allow_numbers_in_staff_text.sql'));
    await db.exec(await mig('20261118100000_materials_request_kind.sql'));
    await db.exec(await mig('20261118101000_field_task_matrix_materials.sql'));

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01'], [U.fsup, 'FS-01'], [U.fcon, 'FC-01'], [U.hr, 'HR-01'], [U.admin2, 'AD-02'], [U.fcon2, 'FC-02']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    const give = (who, assignee, title, priority = 'normal') => as(who).then(() =>
      q('select public.staff_create_assigned_task($1,null,$2,null,$3) as id', [title, priority, assignee]).then((r) => r[0].id));
    const board = (who, status = 'open') => as(who).then(() => q('select * from public.staff_task_board($1, 100)', [status]));
    const notices = async (uid, ev) => { await db.exec('reset role;'); return (await one('select count(*)::int c from public.notifications where user_id=$1 and event_type=$2', [uid, ev])).c; };
    const picker = (who) => as(who).then(() => q('select * from public.staff_task_assignable_people()'))
      .then((r) => r.map((p) => p.profile_id).sort());
    const sorted = (...ids) => [...ids].sort();
    const everyone = [U.admin, U.admin2, U.coordinator, U.switchboard, U.hr, U.fsup, U.fcon, U.fcon2];

    // ---- 1. The matrix: who may give a task to whom ---------------------------------------------------------------
    const allowed = {
      owner: everyone,
      admin: everyone.filter((u) => u !== U.admin),
      coordinator: [U.fsup, U.fcon, U.fcon2],
      fsup: [U.fcon, U.fcon2],
    };
    for (const [giver, targets] of Object.entries(allowed)) {
      assert.deepEqual(await picker(U[giver]), sorted(...targets), `${giver}'s picker lists exactly the allowed people`);
      for (const to of everyone) {
        if (to === U[giver]) continue;
        if (targets.includes(to)) {
          const tid = await give(U[giver], to, `From ${giver}`);
          await db.exec('reset role;');
          const t = await one('select assigned_to, assigned_by, acceptance from public.staff_tasks where id=$1', [tid]);
          assert.deepEqual(t, { assigned_to: to, assigned_by: U[giver], acceptance: 'pending' });
        } else {
          await rejects(() => give(U[giver], to, `From ${giver}`), /cannot give a task to that person/, '42501');
        }
      }
    }
    // Nobody else gives tasks to a named person, and their picker is refused.
    for (const giver of ['switchboard', 'hr', 'fcon']) {
      await rejects(() => picker(U[giver]), /permission/, '42501');
      await rejects(() => give(U[giver], U.fcon2, `From ${giver}`), /Only the Director, the Administrator, the Sales Coordinator or the Field Supervisor/, '42501');
    }
    await rejects(() => picker(U.partner), /permission/, '42501');
    // A disabled Administrator is neither listed nor can be given a task.
    assert.ok(!(await picker(U.owner)).includes(U.adminOff));
    await rejects(() => give(U.coordinator, U.adminOff, 'To a disabled admin'), /enabled member of the office staff/);
    await rejects(() => give(U.coordinator, U.coordinator, 'Self'), /enabled member|yourself|that person/);

    // ---- 2. Important stays Director-only; re-giving stays with the Director and the Administrator ---------------
    await rejects(() => give(U.coordinator, U.fsup, 'Coord important', 'important'), /Only the Director marks a task Important/, '42501');
    await rejects(() => give(U.fsup, U.fcon, 'FS important', 'important'), /Only the Director marks a task Important/, '42501');
    const fsTask = await give(U.fsup, U.fcon, 'Visit the Mabopane stall', 'high');
    assert.ok((await notices(U.fcon, 'STAFF_TASK_ASSIGNED')) >= 1, 'the consultant is told');
    await as(U.fsup);
    await rejects(() => q('select public.staff_assign_task($1,$2,null)', [fsTask, U.fcon2]), /Founder or the Administrator/, '42501');
    await as(U.coordinator);
    await rejects(() => q('select public.staff_assign_task($1,$2,null)', [fsTask, U.fcon2]), /Founder or the Administrator/, '42501');

    // ---- 3. The consultant accepts and completes; the Field Supervisor sees it under the tasks they gave ------------
    await as(U.fcon);
    await q('select public.staff_respond_task($1,true,null)', [fsTask]);
    await q("select public.staff_close_task($1,'done','Stall visited')", [fsTask]);
    const fsGiven = (await board(U.fsup, null)).filter((t) => t.given_by_me);
    assert.equal(fsGiven.find((t) => t.id === fsTask).status, 'done');
    assert.ok(fsGiven.every((t) => [U.fcon, U.fcon2].includes(t.assigned_to)));
    // The Field Supervisor may cancel a task they gave (still open).
    const toCancel = await give(U.fsup, U.fcon2, 'Hand out forms');
    await as(U.fsup);
    await q("select public.staff_close_task($1,'cancelled','Not needed')", [toCancel]);

    // ---- 4. Marketing-materials request goes to the Office Administrator ----------------------------------------
    const request = (who, items, qty, needed, area = null, note = null) => as(who).then(() =>
      q('select public.staff_request_materials($1,$2,$3::date,$4,$5) as id', [items, qty, needed, area, note]).then((r) => r[0].id));
    await db.exec('reset role;');
    const today = (await one('select public.current_sast_date()::text d')).d;
    const later = (await one('select (public.current_sast_date() + 7)::text d')).d;
    const yesterday = (await one('select (public.current_sast_date() - 1)::text d')).d;
    const beforeA1 = await notices(U.admin, 'STAFF_TASK_ASSIGNED');
    const beforeA2 = await notices(U.admin2, 'STAFF_TASK_ASSIGNED');
    const beforeOwner = await notices(U.owner, 'STAFF_TASK_ASSIGNED');
    const mat = await request(U.fsup, 'A5 flyers', '500', later, 'Soshanguve Block H', 'Call 0821234567 on arrival');
    await db.exec('reset role;');
    const m = await one("select title, notes, task_kind, priority, route_to, assigned_to, assigned_by, acceptance, created_by, created_role, (due_at at time zone 'Africa/Johannesburg')::text due from public.staff_tasks where id=$1", [mat]);
    assert.equal(m.title, 'Marketing materials: A5 flyers');
    assert.equal(m.task_kind, 'materials_request');
    assert.equal(m.priority, 'normal');
    assert.deepEqual([m.route_to, m.assigned_to, m.assigned_by, m.acceptance], ['administrator', U.admin, U.fsup, 'pending'],
      'given to the first enabled Administrator');
    assert.deepEqual([m.created_by, m.created_role], [U.fsup, 'field_supervisor']);
    assert.equal(m.due, `${later} 17:00:00`);
    assert.match(m.notes, /Quantity: 500/);
    assert.match(m.notes, /Deliver to \/ area: Soshanguve Block H/);
    assert.match(m.notes, /Note: Call 0821234567 on arrival/, 'numbers are allowed in free text');
    assert.equal(await notices(U.admin, 'STAFF_TASK_ASSIGNED'), beforeA1 + 1, 'the assigned Administrator is told');
    assert.equal(await notices(U.admin2, 'STAFF_TASK_ASSIGNED'), beforeA2 + 1, 'every enabled Administrator is told');
    assert.equal(await notices(U.adminOff, 'STAFF_TASK_ASSIGNED'), 0, 'a disabled Administrator is not');
    assert.equal(await notices(U.owner, 'STAFF_TASK_ASSIGNED'), beforeOwner, 'the Director is not, while an Administrator is enabled');
    const ev = await q('select event, to_route from public.staff_task_events where task_id=$1 order by id', [mat]);
    assert.deepEqual(ev.map((e) => [e.event, e.to_route]), [['created', 'administrator'], ['assigned', 'administrator']]);

    // The requester sees it pending, then accepted, then done.
    const reqState = async (who) => (await board(who, null)).find((t) => t.id === mat);
    assert.equal((await reqState(U.fsup)).acceptance, 'pending');
    assert.ok((await board(U.admin)).some((t) => t.id === mat), 'the Administrator has it on their board');
    await as(U.admin);
    await q('select public.staff_respond_task($1,true,null)', [mat]);
    assert.equal((await reqState(U.fsup)).acceptance, 'accepted');
    await as(U.admin);
    await q("select public.staff_close_task($1,'done','Dropped at the office')", [mat]);
    const done = await reqState(U.fsup);
    assert.deepEqual([done.status, done.acceptance], ['done', 'accepted']);
    // A field consultant requests too; another consultant does not see it, and the second Administrator cannot
    // complete one given to the first.
    const mat2 = await request(U.fcon, 'Branded T-shirts', '10 (size L)', today);
    assert.equal((await board(U.fcon2, null)).find((t) => t.id === mat2), undefined);
    assert.ok((await board(U.fcon, null)).some((t) => t.id === mat2));
    await as(U.admin2);
    await rejects(() => q("select public.staff_close_task($1,'done',null)", [mat2]), /after accepting it/, '42501');
    await db.exec('reset role;');
    assert.equal((await one('select created_role from public.staff_tasks where id=$1', [mat2])).created_role, 'field_consultant');

    // Validation, and who may request.
    await rejects(() => request(U.fsup, 'Flyers', '100', yesterday), /today or later/);
    await rejects(() => request(U.fsup, 'X', '100', later), /Say what you need/);
    await rejects(() => request(U.fsup, 'Flyers', '  ', later), /how many/);
    await rejects(() => request(U.fsup, 'Flyers', '100', later, 'a'.repeat(161)), /area under 160/);
    for (const who of [U.owner, U.admin, U.coordinator, U.switchboard, U.hr, U.partner]) {
      await rejects(() => request(who, 'Flyers', '100', later), /Only the Field Supervisor and field consultants/, '42501');
    }

    // ---- 5. With no enabled Administrator the request waits on the Director's desk -------------------------------
    await as(U.owner);
    await q('select public.owner_set_staff_access($1,false)', [U.admin]);
    await q('select public.owner_set_staff_access($1,false)', [U.admin2]);
    const ownerBefore = await notices(U.owner, 'STAFF_TASK_ASSIGNED');
    const mat3 = await request(U.fsup, 'Pull-up banner', '1', later);
    await db.exec('reset role;');
    const m3 = await one('select route_to, assigned_to, assigned_by, acceptance from public.staff_tasks where id=$1', [mat3]);
    assert.deepEqual(m3, { route_to: 'owner', assigned_to: null, assigned_by: null, acceptance: null });
    assert.equal(await notices(U.owner, 'STAFF_TASK_ASSIGNED'), ownerBefore + 1, 'the Director is told');
    assert.ok((await board(U.owner)).some((t) => t.id === mat3));
    assert.ok((await board(U.fsup)).some((t) => t.id === mat3), 'the requester still sees it');
    // The Director can hand it to an Administrator later, through the normal task flow.
    await as(U.owner);
    await q('select public.owner_set_staff_access($1,true,$2)', [U.admin2, 'AD-02']);
    await q('select public.staff_assign_task($1,$2,null)', [mat3, U.admin2]);
    await db.exec('reset role;');
    assert.equal((await one('select assigned_to from public.staff_tasks where id=$1', [mat3])).assigned_to, U.admin2);
  } finally {
    await db.close();
  }
});
