import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Important tasks from the Director (owner, 17 Nov 2026): runs the staff-build migrations through the field roles and
// 20261117130000/131000 against an isolated PostgreSQL (PGlite), switching real database roles with auth.uid() claims.
// It proves the Director (and the Administrator) give tasks to every office role, only the Director marks a task
// Important, an Important task cannot be declined but can be questioned, HR and field roles see only their own tasks
// and complete them, the landing banner and the Director's briefing. It does NOT prove the live schema or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10), fsup: id(11), fcon: id(12), hr: id(13) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Important tasks: the Director gives tasks to any office role and they cannot be declined', async () => {
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
    // The live emit_in_app_notification also invokes the email Edge Function; here it only writes the in-app notice.
    await db.exec("create or replace function public.emit_in_app_notification(p_user_id uuid, p_event public.notification_event_type, p_title text, p_body text, p_link text, p_data jsonb) returns void language plpgsql security definer set search_path = '' as $$ begin if p_user_id is null then return; end if; insert into public.notifications (user_id, event_type, title, body_text, link_url, data, read_status) values (p_user_id, p_event, p_title, p_body, p_link, p_data, false); end $$;");
    await db.exec(await mig('20261117131000_important_tasks.sql'));

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01'], [U.fsup, 'FS-01'], [U.fcon, 'FC-01'], [U.hr, 'HR-01']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    const give = (who, assignee, title, priority = 'normal') => as(who).then(() =>
      q('select public.staff_create_assigned_task($1,null,$2,null,$3) as id', [title, priority, assignee]).then((r) => r[0].id));
    const board = (who, status = 'open') => as(who).then(() => q('select * from public.staff_task_board($1, 100)', [status]));
    const notices = async (uid, ev) => { await db.exec('reset role;'); return (await one('select count(*)::int c from public.notifications where user_id=$1 and event_type=$2', [uid, ev])).c; };

    // ---- 1. The Director gives a task to every office role --------------------------------------------------------
    const given = {};
    for (const [who, role] of [[U.admin, 'administrator'], [U.coordinator, 'coordinator'], [U.switchboard, 'switchboard'],
      [U.hr, 'hr'], [U.fsup, 'field_supervisor'], [U.fcon, 'field_consultant']]) {
      given[role] = await give(U.owner, who, `Important for ${role}`, 'important');
      await db.exec('reset role;');
      const t = await one('select route_to, acceptance, assigned_to, priority from public.staff_tasks where id=$1', [given[role]]);
      assert.deepEqual(t, { route_to: role, acceptance: 'pending', assigned_to: who, priority: 'important' });
      assert.equal(await notices(who, 'STAFF_TASK_IMPORTANT'), 1, `${role} is told (in-app + email path)`);
    }
    await rejects(() => give(U.owner, U.owner, 'For myself'), /enabled member of the office staff/);
    await rejects(() => give(U.owner, U.partner, 'For an agent'), /enabled member of the office staff/);

    // ---- 2. Only the Director marks Important; the Administrator still gives normal tasks to anyone ---------------
    await rejects(() => give(U.admin, U.hr, 'Admin important', 'important'), /Only the Director marks a task Important/, '42501');
    await rejects(() => give(U.admin, U.admin, 'Admin to self'), /cannot give a task to yourself/);
    const adminToField = await give(U.admin, U.fcon, 'Collect flyers', 'high');
    assert.equal(await notices(U.fcon, 'STAFF_TASK_ASSIGNED'), 1);
    await rejects(() => give(U.coordinator, U.hr, 'Coordinator gives'), /Founder or the Administrator/, '42501');
    await as(U.coordinator);
    await rejects(() => q("select public.staff_create_task('Desk important',null,'general','important',null,'switchboard')"), /Only the Director marks a task Important/);

    // ---- 3. An Important task cannot be declined; a question goes to the Director -----------------------------------
    await as(U.hr);
    await rejects(() => q('select public.staff_respond_task($1,false,$2)', [given.hr, 'I am too busy this week to do it']), /cannot be declined/);
    await q('select public.staff_task_ask_question($1,$2)', [given.hr, 'Which month should the register cover?']);
    assert.equal(await notices(U.owner, 'STAFF_TASK_QUESTION'), 1, 'the Director gets the question');
    await as(U.coordinator);
    await rejects(() => q('select public.staff_task_ask_question($1,$2)', [given.hr, 'Can I help with this?']), /not given to you/, '42501');
    await as(U.hr);
    await rejects(() => q('select public.staff_task_ask_question($1,$2)', [given.hr, 'ID 8001015009087 ok?']), /no ID or account numbers/);
    // A normal task can still be declined.
    await as(U.fcon);
    await q('select public.staff_respond_task($1,false,$2)', [adminToField, 'I am on leave until Monday next week']);
    assert.equal(await notices(U.admin, 'STAFF_TASK_DECLINED'), 1);

    // ---- 4. The landing banner and the pending list: Important first --------------------------------------------
    await as(U.hr);
    let banner = await q('select * from public.staff_my_important_tasks()');
    assert.deepEqual(banner.map((b) => [b.title, b.acceptance]), [['Important for hr', 'pending']]);
    const pending = await q('select * from public.staff_my_pending_tasks()');
    assert.equal(pending[0].priority, 'important');
    await q('select public.staff_respond_task($1,true,null)', [given.hr]);
    banner = await q('select * from public.staff_my_important_tasks()');
    assert.equal(banner[0].acceptance, 'accepted', 'stays until done');

    // ---- 5. HR and field roles: own tasks only, and they complete what they accepted ---------------------------------
    assert.deepEqual((await board(U.hr)).map((t) => t.title), ['Important for hr']);
    assert.deepEqual((await board(U.fcon)).map((t) => t.title), ['Important for field_consultant'], 'a declined task leaves their board');
    assert.deepEqual((await board(U.fsup)).map((t) => t.title), ['Important for field_supervisor']);
    await as(U.fsup);
    await rejects(() => q("select public.staff_close_task($1,'done',null)", [given.field_supervisor]), /after accepting it/, '42501');
    await rejects(() => q("select public.staff_close_task($1,'done',null)", [given.hr]), /after accepting it/, '42501');
    await as(U.hr);
    await q("select public.staff_close_task($1,'done','Register filed')", [given.hr]);
    assert.equal((await q('select * from public.staff_my_important_tasks()')).length, 0, 'the banner clears once done');
    // The Switchboard desk does not see a task given to the Coordinator; the Coordinator does not see HR's.
    assert.ok(!(await board(U.switchboard)).some((t) => t.title === 'Important for coordinator'));
    assert.ok(!(await board(U.coordinator, null)).some((t) => t.title === 'Important for hr'));
    await as(U.partner);
    await rejects(() => q('select * from public.staff_task_board()'), /permission/, '42501');
    await rejects(() => q('select * from public.staff_my_important_tasks()'), /permission/, '42501');

    // ---- 6. The Director sees every task she gave, with its state ----------------------------------------------------
    const mine = (await board(U.owner, null)).filter((t) => t.given_by_me);
    assert.equal(mine.length, 6);
    assert.equal(mine[0].priority, 'important');
    const state = Object.fromEntries(mine.map((t) => [t.title, t.status === 'done' ? 'done' : t.acceptance]));
    assert.equal(state['Important for hr'], 'done');
    assert.equal(state['Important for administrator'], 'pending');

    // ---- 7. The Director's briefing lists Important first and counts the overdue ones --------------------------------
    await db.exec('reset role;');
    await db.exec("begin; select set_config('fnc.task_transition','on',true);");
    await q("update public.staff_tasks set due_at = now() - interval '1 hour' where id=$1", [given.switchboard]);
    await db.exec('commit;');
    await as(U.owner);
    const b = (await one('select public.staff_director_briefing() as b')).b;
    assert.equal(b.tasks.important_open, 5);
    assert.equal(b.tasks.important_overdue, 1);
    assert.equal(b.tasks.urgent[0].priority, 'important');

    // ---- 8. History keeps the question and the real roles --------------------------------------------------------------
    await db.exec('reset role;');
    const ev = await q('select event, actor_role from public.staff_task_events where task_id=$1 order by id', [given.hr]);
    assert.deepEqual(ev.map((e) => e.event), ['created', 'assigned', 'question', 'accepted', 'completed']);
    assert.equal(ev.find((e) => e.event === 'question').actor_role, 'hr');
  } finally {
    await db.close();
  }
});
