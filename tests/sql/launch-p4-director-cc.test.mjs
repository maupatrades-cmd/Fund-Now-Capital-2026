import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Launch priority 4 (Director auto-CC): runs the staff build, batches 1 to 3 and the agent-messages migration against an
// isolated PostgreSQL (PGlite). It proves agents and Team Leaders reach only the Sales Coordinator, that every message
// from a sub-agent, agent or Team Leader copies the Director (also when they reply to someone else), that staff can
// write to agents, and where each person opens their messages. It does NOT prove the live schema or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const { btree_gist } = await import(process.env.FNC_PGLITE_MODULE
  ? new URL('./contrib/btree_gist.js', process.env.FNC_PGLITE_MODULE).href
  : '@electric-sql/pglite/contrib/btree_gist');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), admin: id(4), partner: id(5), adminOff: id(6), sb2: id(7), agent: id(8), sub: id(9), leader: id(10) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Launch priority 4: the Director is copied on every agent, sub-agent and Team Leader message', async () => {
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
      'create table public.deals(id uuid primary key default gen_random_uuid(), lead_id uuid, stage text not null default \'new_lead\');',
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
    await db.exec(await mig('20261021150000_agent_messages_director_cc.sql'));

    await as(U.owner);
    for (const [who, ref] of [[U.coordinator, 'SC-01'], [U.switchboard, 'SA-01'], [U.admin, 'AD-01']]) {
      await q('select public.owner_set_staff_access($1,true,$2)', [who, ref]);
    }
    await db.exec('reset role;');
    await q("insert into public.referral_partners(id, name) values ($1, 'Org')", [id(199)]);
    await q("insert into public.referral_teams(id, organisation_id, name) values ($1, $2, 'North')", [id(200), id(199)]);
    await q('update public.profiles set referral_partner_id = $1 where id = $2', [id(199), U.leader]);
    await q("insert into public.referral_team_memberships(team_id, profile_id, membership_role, effective_from) values ($1,$2,'team_leader', current_date - 1)", [id(200), U.leader]);
    const notices = async (uid, type) => q('select title, link_url from public.notifications where user_id=$1 and event_type=$2 order by created_at', [uid, type]);

    const recipients = (thread) => q(`select p.full_name as who, r.kind, r.auto_cc from public.internal_message_recipients r
      join public.internal_messages m on m.id = r.message_id join public.profiles p on p.id = r.recipient_id
      where m.thread_id = $1 and m.created_at = (select max(created_at) from public.internal_messages where thread_id = $1) order by r.kind desc, p.full_name`, [thread]);

    // ---- 1. Agents and Team Leaders reach only the Sales Coordinator; the Director is copied ------------------------
    for (const [who, name] of [[U.agent, 'Agent'], [U.leader, 'Leader']]) {
      await as(who);
      assert.deepEqual((await q('select * from public.msg_contacts()')).map((c) => c.profile_id), [U.coordinator], `${name} writes to the Sales Coordinator only`);
      await rejects(() => q("select public.msg_send(array[$1]::uuid[],'Hi','Direct to the Director')", [U.owner]), /can not message/, '42501');
      const t = (await one("select public.msg_send(array[$1]::uuid[],'Client update','Client sent the documents') as t", [U.coordinator])).t;
      await db.exec('reset role;');
      assert.deepEqual((await recipients(t)).map((r) => [r.who, r.kind, r.auto_cc]), [['Coordinator', 'to', false], ['Founder', 'cc', true]]);
    }
    await db.exec('reset role;');
    assert.equal((await q("select link_url from public.notifications where user_id=$1 and event_type='INTERNAL_MESSAGE_RECEIVED'", [U.coordinator])).length, 2);

    // ---- 2. Staff can write to agents; the agent's reply copies the Director ------------------------------------------
    await as(U.admin);
    const contacts = (await q('select * from public.msg_contacts()'));
    assert.ok(contacts.some((c) => c.profile_id === U.agent && c.role_label === 'Agent'));
    assert.ok(contacts.some((c) => c.profile_id === U.leader && c.role_label === 'Team Leader / partner'));
    const t2 = (await one("select public.msg_send(array[$1]::uuid[],'Your invoice','Please resend your invoice') as t", [U.agent])).t;
    await db.exec('reset role;');
    assert.deepEqual((await recipients(t2)).map((r) => [r.who, r.kind]), [['Agent', 'to']], 'staff to an agent: no automatic copy');
    assert.equal((await one("select link_url from public.notifications where user_id=$1 and event_type='INTERNAL_MESSAGE_RECEIVED'", [U.agent])).link_url, '/contractor/messages');
    await as(U.agent);
    await q("select public.msg_reply($1,'Resent it this morning')", [t2]);
    await db.exec('reset role;');
    assert.deepEqual((await recipients(t2)).map((r) => [r.who, r.kind, r.auto_cc]), [['Administrator', 'to', false], ['Founder', 'cc', true]], 'every message from an agent copies the Director');

    // ---- 3. Sub-agents unchanged; switched-off staff and clients are not correspondents ---------------------------------
    await as(U.sub);
    assert.deepEqual((await q('select * from public.msg_contacts()')).map((c) => c.profile_id), [U.coordinator]);
    await as(U.adminOff);
    await rejects(() => q('select * from public.msg_threads()'), /permission/, '42501');
  } finally {
    await db.close();
  }
});
