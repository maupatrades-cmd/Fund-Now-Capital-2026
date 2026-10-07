import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Batch 1 staff build: executes the five staff-build migrations against an
// isolated PostgreSQL (PGlite) with a minimal synthetic prerequisite schema and
// switches between real database roles with auth.uid() claims. It proves the
// database enforces authority; it does NOT prove the live schema, Supabase
// Storage policies, or multi-session concurrency (see the Batch 1 handover).
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = {
  owner: id(1), coordinator: id(2), switchboard: id(3), switchboardOff: id(4),
  partner1: id(5), partner2: id(6), teamLeader: id(7), agentOrg1: id(8), agentOrg2: id(9), direct: id(10),
};
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('staff roles, organisations and intake are enforced by the database', async () => {
  const db = new PGlite();
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
      'create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;',
      'create function public.current_sast_date() returns date language sql stable as $$ select (now() at time zone \'Africa/Johannesburg\')::date $$;',
      "create table public.referral_partners(id uuid primary key default gen_random_uuid(), name text not null unique, contact_email text, contact_phone text, is_active boolean not null default true, notes text, created_at timestamptz default now(), updated_at timestamptz default now());",
      'create table public.profiles(id uuid primary key, email text, full_name text, role public.user_role not null default \'partner\', referral_partner_id uuid, sourced_via_partner_id uuid, is_active boolean not null default true);',
      "create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) $$;",
      'create table public.funding_product_catalog(code text primary key, display_name text not null, is_active boolean not null default true);',
      'create table public.document_requirement_rules(id uuid primary key default gen_random_uuid(), rule_scope text, product_code text, document_type public.document_type, requirement text, is_active boolean default true);',
      "create table public.leads(id uuid primary key default gen_random_uuid(), business_name text not null, contact_name text not null, contact_cell text, contact_email text, cipc_number text, funding_amount numeric(14,2), funding_purpose jsonb not null default '[]', entered_by uuid, created_at timestamptz not null default now());",
      'create table public.clients(id uuid primary key default gen_random_uuid(), business_name text, cipc_number text);',
      'create table public.deals(id uuid primary key default gen_random_uuid(), lead_id uuid, stage text not null default \'new_lead\');',
      'create table public.documents(id uuid primary key default gen_random_uuid(), lead_id uuid, document_type public.document_type, is_current_version boolean default true);',
      'alter table public.profiles enable row level security;',
      'create policy profiles_owner_all on public.profiles for all to authenticated using (public.is_owner()) with check (public.is_owner());',
      'create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());',
      'grant usage on schema public, auth to authenticated;',
      'grant select, update on public.profiles to authenticated;',
      'grant select on public.referral_partners to authenticated;',
      'grant select on public.leads, public.deals, public.documents, public.clients to authenticated;',
      "insert into public.referral_partners(id,name) values ('" + id(101) + "','Seed Org One'),('" + id(102) + "','Seed Org Two');",
    ].join('\n'));
    const org1 = id(101);
    const org2 = id(102);
    const profile = (uid, name, role, partner = null, via = null) =>
      `insert into public.profiles(id,email,full_name,role,referral_partner_id,sourced_via_partner_id) values ('${uid}','${name}@example.test','${name}','${role}',${partner ? `'${partner}'` : 'null'},${via ? `'${via}'` : 'null'});`;
    // Owner-provisioned fixtures; staff roles are added after the enum migration.
    await db.exec(await mig('20261007090000_staff_roles_enum.sql'));
    await db.exec([
      profile(U.owner, 'owner', 'owner'),
      profile(U.coordinator, 'coordinator', 'coordinator'),
      profile(U.switchboard, 'switchboard', 'switchboard'),
      profile(U.switchboardOff, 'switchboard_off', 'switchboard'),
      profile(U.partner1, 'partner_one', 'partner', org1),
      profile(U.partner2, 'partner_two', 'partner', org2),
      profile(U.teamLeader, 'team_leader', 'lead_referrer', null, org1),
      profile(U.agentOrg1, 'agent_org1', 'lead_referrer', null, org1),
      profile(U.agentOrg2, 'agent_org2', 'lead_referrer', null, org2),
      profile(U.direct, 'direct_agent', 'lead_referrer'),
      "insert into public.funding_product_catalog(code,display_name) values ('working_capital','Working capital');",
      "insert into public.document_requirement_rules(rule_scope,product_code,document_type,requirement) values ('product_baseline','working_capital','cipc_cert','required'),('product_baseline','working_capital','bank_statement','required'),('product_baseline','working_capital','id_copy','optional');",
    ].join('\n'));
    // Supabase grants new public tables to `authenticated` by default; RLS (and
    // the explicit revokes in the migrations) is what actually restricts them.
    await db.exec('alter default privileges in schema public grant all on tables to authenticated;');
    for (const f of ['20261007091000_staff_access_and_audit.sql', '20261007092000_organisation_team_structure.sql',
      '20261007093000_submission_intake_core.sql', '20261007094000_submission_intake_rpcs.sql']) {
      await db.exec(await mig(f));
    }

    // ---- Staff access gate ------------------------------------------------
    await as(U.coordinator);
    await rejects(() => q('select public.owner_set_staff_access($1,true)', [U.coordinator]), /Only the owner/, '42501');
    await as(U.owner);
    await q("select public.owner_set_staff_access($1,true,'FNC-EMP-SC-01')", [U.coordinator]);
    await q("select public.owner_set_staff_access($1,true,'FNC-EMP-SA-01')", [U.switchboard]);
    await rejects(() => q('select public.owner_set_staff_access($1,true)', [U.partner1]), /not a staff role/);
    assert.equal((await one('select public.staff_actor_role() as r')).r, 'owner');
    await as(U.coordinator);
    assert.equal((await one('select public.staff_actor_role() as r')).r, 'coordinator');
    await as(U.switchboardOff);
    assert.equal((await one('select public.staff_actor_role() as r')).r, null, 'role without owner activation has no authority');
    await rejects(() => q('select * from public.staff_intake_queue()'), /permission/, '42501');

    // ---- No self-escalation -----------------------------------------------
    await as(U.coordinator);
    assert.equal((await db.query("update public.profiles set role='owner' where id=$1", [U.coordinator])).affectedRows, 0);
    assert.equal((await q('select role::text from public.profiles where id=$1', [U.coordinator]))[0].role, 'coordinator');
    assert.equal((await db.query('update public.staff_access set access_enabled=true where profile_id=$1', [U.switchboardOff])).affectedRows, 0);
    await db.exec('reset role; alter table public.profiles disable row level security;'); // trigger is the second line of defence
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${U.switchboard}',false);`);
    await rejects(() => db.query("update public.profiles set role='owner' where id=$1", [U.switchboard]), /Only the owner can change a role/, '42501');
    await rejects(() => db.query('update public.profiles set is_active=false where id=$1', [U.coordinator]), /Only the owner/, '42501');
    await db.exec('reset role; alter table public.profiles enable row level security;');
    await as(U.owner);
    await q("update public.profiles set role='partner' where id=$1", [U.switchboardOff]);
    await q("update public.profiles set role='switchboard' where id=$1", [U.switchboardOff]);
    // A role change switches operational access off until the owner re-enables it.
    await q("select public.owner_set_staff_access($1,true)", [U.switchboardOff]);
    await q("update public.profiles set role='coordinator' where id=$1", [U.switchboardOff]);
    assert.equal((await one('select access_enabled from public.staff_access where profile_id=$1', [U.switchboardOff])).access_enabled, false);
    await q("update public.profiles set role='switchboard' where id=$1", [U.switchboardOff]);

    // ---- Organisations, teams, memberships --------------------------------
    await as(U.owner);
    await rejects(() => q("select public.owner_create_organisation('Bad Brand',null,null,'{\"is_admin\":true}'::jsonb)"), /branding_config_ck|violates check/);
    const newOrg = (await one("select public.owner_create_organisation('Second Organisation','ops@example.test',null,'{\"primary_color\":\"#112233\"}'::jsonb) as id")).id;
    assert.ok(newOrg, 'owner can create another referral organisation without a deploy');
    const alpha = (await one("select public.owner_create_team($1,'Alpha') as id", [org1])).id;
    const beta = (await one("select public.owner_create_team($1,'Beta') as id", [org2])).id;
    await q("select public.owner_add_team_member($1,$2,'team_leader',current_date - 30,null,'FNC-PARTNER v1')", [alpha, U.teamLeader]);
    await q("select public.owner_add_team_member($1,$2,'member',current_date - 30)", [alpha, U.agentOrg1]);
    await q("select public.owner_add_team_member($1,$2,'team_leader',current_date - 30)", [beta, U.agentOrg2]);
    await rejects(() => q("select public.owner_add_team_member($1,$2,'member',current_date)", [alpha, U.agentOrg2]), /different organisation/);
    await rejects(() => q("select public.owner_add_team_member($1,$2,'member',current_date)", [alpha, U.direct]), /different organisation/);
    await rejects(() => q("select public.owner_add_team_member($1,$2,'team_leader',current_date)", [alpha, U.agentOrg1]), /overlapping|already has/);
    await rejects(() => q("select public.owner_add_team_member($1,$2,'member',current_date)", [alpha, U.coordinator]), /Only partner or lead-referrer/);
    await rejects(() => q("update public.referral_team_memberships set team_id=$1", [beta]), /Only effective_to may change/);

    // ---- Intake registration ----------------------------------------------
    await as(U.switchboard);
    const register = (over = {}) => {
      const a = { name: 'Acme Trading', contact: 'Thandi', cell: '0820000001', email: 'a@x.test', cipc: '2020/111111/07', type: 'working_capital',
        amount: 250000, purpose: 'Stock', channel: 'team', org: null, team: alpha, agent: U.agentOrg1, claimed: 'Said she is Sipho', key: 'key-000001', ...over };
      return one('select public.staff_register_intake($1,$2,$3,$4,$5,$6,$7,$8,$9::public.submission_channel,$10,$11,$12,$13,$14) as r',
        [a.name, a.contact, a.cell, a.email, a.cipc, a.type, a.amount, a.purpose, a.channel, a.org, a.team, a.agent, a.claimed, a.key]).then((x) => x.r);
    };
    const created = await register();
    assert.equal(created.status, 'created');
    const leadId = created.lead_id;
    const replay = await register();
    assert.equal(replay.status, 'existing');
    assert.equal(replay.lead_id, leadId, 'idempotent replay returns the same file');
    await rejects(() => register({ key: 'key-000002', cipc: '2021/222222/07', agent: U.agentOrg2 }), /not an active member/);
    await rejects(() => register({ key: 'key-000003', cipc: '2021/333333/07', channel: 'direct_agent', team: null, org: org1, agent: null }), /direct-agent submission cannot carry/);
    await rejects(() => register({ key: 'key-000004', cipc: '2021/444444/07', channel: 'direct_agent', team: null, agent: U.agentOrg1 }), /independent lead-referrer/);
    await rejects(() => register({ key: 'key-000005', cipc: '2021/555555/07', channel: 'referral_partner', team: null, org: org1, agent: U.agentOrg2 }), /does not belong to the stated organisation/);
    await rejects(() => register({ key: 'key-000006', cipc: '2021/666666/07', amount: -1 }), /cannot be negative/);
    await rejects(() => register({ key: 'key-000007', cipc: '2021/777777/07', type: 'nonexistent' }), /funding type/);
    const direct = await register({ key: 'key-000008', name: 'Direct Co', cipc: '2021/888888/07', cell: '0820000009', email: 'd@x.test', channel: 'direct_agent', team: null, agent: U.direct, claimed: null });
    assert.equal(direct.status, 'created');
    const referral = await register({ key: 'key-000009', name: 'Referral Co', cipc: '2021/999999/07', cell: '0820000010', email: 'r@x.test', channel: 'referral_partner', team: null, org: org1, agent: null });
    assert.equal(referral.status, 'created');

    await as(null);
    const stored = await one('select entered_by from public.leads where id=$1', [leadId]);
    assert.equal(stored.entered_by, U.switchboard);
    const snap = await one('select affiliation_snapshot, team_leader_profile_id from public.submission_intakes where lead_id=$1', [leadId]);
    assert.equal(snap.team_leader_profile_id, U.teamLeader, 'leader frozen at registration');
    assert.equal(snap.affiliation_snapshot.team_leader_agreement_version_ref, 'FNC-PARTNER v1');

    // Registration conflict (same CIPC): no second file, Owner review flag only.
    await as(U.switchboard);
    const conflict = await register({ key: 'key-000010', channel: 'referral_partner', team: null, org: org1, agent: null, name: 'Acme Other', cell: '0820000099', email: 'z@x.test' });
    assert.equal(conflict.status, 'registration_conflict_flagged');
    assert.equal(conflict.lead_id, null);
    assert.deepEqual(Object.keys(conflict.flags), ['registration_conflict'], 'staff learn only that a conflict exists');
    await as(U.owner);
    assert.equal((await q("select 1 from public.intake_review_flags where flag_kind='registration_conflict' and status='open'")).length, 1);
    assert.equal((await q('select 1 from public.leads where cipc_number=$1', ['2020/111111/07'])).length, 1);

    // ---- Relationship-scoped reads: no cross-organisation access ----------
    const visible = async (uid) => { await as(uid); return (await q('select lead_id from public.submission_intakes order by registered_at')).map((r) => r.lead_id); };
    assert.deepEqual(await visible(U.partner2), [], 'partner of another organisation sees nothing');
    assert.deepEqual(await visible(U.agentOrg2), []);
    assert.deepEqual(await visible(U.direct), [direct.lead_id], 'direct agent sees only their own direct file');
    assert.deepEqual((await visible(U.agentOrg1)), [leadId], 'agent sees only files they are registered on');
    assert.deepEqual((await visible(U.teamLeader)), [leadId], 'Team Leader sees their own team');
    assert.deepEqual((await visible(U.partner1)).sort(), [leadId, referral.lead_id].sort(), 'partner sees own organisation files');
    assert.deepEqual(await visible(U.coordinator), [], 'staff have no direct table reads');
    assert.deepEqual(await visible(U.switchboard), []);
    await as(U.partner2);
    assert.deepEqual((await q('select name from public.referral_teams')).map((r) => r.name), ['Beta']);
    await as(U.agentOrg1);
    assert.deepEqual((await q('select name from public.referral_teams')).map((r) => r.name), ['Alpha']);
    for (const t of ['submission_introducing_parties', 'intake_review_flags', 'intake_document_receipts', 'staff_audit_events']) {
      await as(U.partner1);
      assert.equal((await q(`select 1 from public.${t}`)).length, 0, `${t} is owner-only`);
    }
    for (const uid of [U.partner1, U.switchboardOff, U.coordinator]) {
      await as(uid);
      if (uid !== U.coordinator) await rejects(() => q('select * from public.staff_intake_queue()'), /permission/, '42501');
      await rejects(() => db.query("insert into public.submission_intakes(lead_id) values (gen_random_uuid())"), /permission denied/);
    }

    // ---- Workflow authority -------------------------------------------------
    await as(U.switchboard);
    await rejects(() => q("select public.staff_set_intake_status($1,'documents_incomplete')", [leadId]), /permission/, '42501');
    await rejects(() => q("select public.staff_archive_intake($1,'withdrawn','client withdrew the request')", [leadId]), /permission/, '42501');
    await rejects(() => q('select public.staff_assign_intake($1,$2)', [leadId, U.coordinator]), /permission/, '42501');
    await rejects(() => q("select public.owner_resolve_intake_review_flag(gen_random_uuid(),'dismissed','not the same company')"), /permission/, '42501');

    const rcpt = (type, via = 'secure_upload') =>
      one("select public.staff_record_document_receipt($1,$2::public.document_type,$3,'label','file.pdf',null) as r", [leadId, type, via]).then((x) => x.r);
    const r1 = await rcpt('cipc_cert', 'email');
    assert.deepEqual(Object.keys(r1).sort(), ['document_type', 'receipt_id', 'received_at'], 'receipt returns metadata only: no url, path or preview');
    await as(U.coordinator);
    await rejects(() => q("select public.staff_set_intake_status($1,'complete')", [leadId]), /required documents not yet received \(bank_statement\)/);
    await as(U.switchboard);
    const r2 = await rcpt('bank_statement');
    await q("select public.staff_flag_document_suspicious($1,'Metadata looks edited, do not forward')", [r2.receipt_id]);
    await as(U.coordinator);
    await rejects(() => q("select public.staff_set_intake_status($1,'complete')", [leadId]), /bank_statement/, undefined);
    await rejects(() => q('select public.owner_clear_document_flag($1,$2)', [r2.receipt_id, 'checked with the bank']), /permission/, '42501');
    await as(U.owner);
    await q("select public.owner_clear_document_flag($1,'Confirmed with the bank directly')", [r2.receipt_id]);
    await as(U.coordinator);
    await rejects(() => q("select public.staff_set_intake_status($1,'verified')", [leadId]), /not permitted for your role/, '42501');
    const done = (await one("select public.staff_set_intake_status($1,'complete') as r", [leadId])).r;
    assert.ok(done.first_complete_at);
    await q("select public.staff_set_intake_status($1,'with_founder')", [leadId]);
    await rejects(() => q("select public.staff_set_intake_status($1,'complete')", [leadId]), /reason of at least 10/);
    await q("select public.staff_set_intake_status($1,'complete','Sent back to re-check the CIPC page')", [leadId]);
    await q("select public.staff_set_intake_status($1,'with_founder')", [leadId]);
    await as(U.owner);
    await q("select public.staff_set_intake_status($1,'verified')", [leadId]);
    await as(U.coordinator);
    await rejects(() => q("select public.staff_set_intake_status($1,'complete','trying to move it back down')", [leadId]), /not permitted for your role/, '42501');
    await rejects(() => q("select public.staff_archive_intake($1,'withdrawn','Client withdrew the request')", [leadId]), /Only the Owner can archive a verified/, '42501');
    await as(U.owner);
    await rejects(() => q("select public.staff_set_intake_status($1,'documents_incomplete')", [leadId]), /reason of at least 10/);
    await q("select public.staff_set_intake_status($1,'documents_incomplete','Bank statement replaced after fraud check')", [leadId]);
    const reversed = await one('select first_complete_at, workflow_status::text as s from public.submission_intakes where lead_id=$1', [leadId]);
    assert.equal(reversed.s, 'documents_incomplete');
    assert.equal(new Date(reversed.first_complete_at).getTime(), new Date(done.first_complete_at).getTime(), 'first Complete timestamp survives reversal');
    await q("select public.staff_set_intake_status($1,'complete')", [leadId]);
    assert.equal(new Date((await one('select first_complete_at from public.submission_intakes where lead_id=$1', [leadId])).first_complete_at).getTime(),
      new Date(done.first_complete_at).getTime(), 're-completing keeps the original timestamp');
    assert.ok((await q("select 1 from public.staff_audit_events where event_type='complete_reversed' and entity_id=$1", [leadId])).length >= 1);

    // Protected columns: even a superuser statement cannot move them.
    await as(null);
    await rejects(() => db.query("update public.submission_intakes set first_complete_at=now() where lead_id=$1", [leadId]), /protected/);
    await rejects(() => db.query("update public.submission_intakes set workflow_status='verified' where lead_id=$1", [leadId]), /only through the staff workflow RPCs/);
    await rejects(() => db.query("update public.submission_intakes set agent_profile_id=null where lead_id=$1", [leadId]), /Attribution is fixed/);
    await rejects(() => db.query('delete from public.submission_intakes where lead_id=$1', [leadId]), /cannot be deleted/);

    // ---- Assignment never changes attribution -------------------------------
    await as(U.coordinator);
    await q('select public.staff_assign_intake($1,$2)', [leadId, U.switchboard]);
    await rejects(() => q('select public.staff_assign_intake($1,$2)', [leadId, U.partner1]), /enabled staff member/);
    await as(null);
    const afterAssign = await one('select operational_assignee_id, agent_profile_id, team_id from public.submission_intakes where lead_id=$1', [leadId]);
    assert.equal(afterAssign.operational_assignee_id, U.switchboard);
    assert.equal(afterAssign.agent_profile_id, U.agentOrg1);
    assert.equal(afterAssign.team_id, alpha);

    // ---- Archive / reversal --------------------------------------------------
    await as(U.coordinator);
    await rejects(() => q("select public.staff_archive_intake($1,'duplicate','short')", [direct.lead_id]), /at least 10/);
    await q("select public.staff_archive_intake($1,'duplicate','Same company as an existing file')", [direct.lead_id]);
    await rejects(() => q("select public.staff_set_intake_status($1,'documents_incomplete')", [direct.lead_id]), /archived/);
    await rejects(() => q("select public.owner_reverse_intake_archive($1,'Archived by mistake in error')", [direct.lead_id]), /permission/, '42501');
    await as(U.owner);
    await q("select public.owner_reverse_intake_archive($1,'Archived by mistake in error')", [direct.lead_id]);
    assert.ok((await q("select 1 from public.staff_audit_events where event_type in ('archived','archive_reversed') and entity_id=$1", [direct.lead_id])).length === 2, 'archive and reversal both retained');

    // ---- Introducing parties (separate from money) --------------------------
    await as(U.switchboard);
    await q("select public.staff_add_introducing_party($1,'agent',$2)", [leadId, U.agentOrg1]);
    await q("select public.staff_add_introducing_party($1,'organisation',null,$2)", [leadId, org1]);
    await q("select public.staff_add_introducing_party($1,'external',null,null,'Walk-in referrer')", [leadId]);
    await q("select public.staff_add_introducing_party($1,'team_leader',$2)", [leadId, U.teamLeader]);
    await rejects(() => q("select public.staff_add_introducing_party($1,'agent',$2)", [leadId, U.agentOrg1]), /duplicate key|unique/);
    await rejects(() => q("select public.staff_add_introducing_party($1,'team_leader',$2)", [leadId, U.agentOrg1]), /not an active Team Leader/);
    await rejects(() => q("select public.staff_add_introducing_party($1,'agent',$2)", [leadId, U.coordinator]), /active partner or lead-referrer/);
    await as(U.switchboard);
    const partyId = (await one("select public.staff_add_introducing_party($1,'external',null,null,'Second walk-in') as id", [leadId])).id;
    await rejects(() => q("select public.staff_remove_introducing_party($1,'entered twice by mistake')", [partyId]), /permission/, '42501');
    await as(U.coordinator);
    await q("select public.staff_remove_introducing_party($1,'entered twice by mistake')", [partyId]);
    await as(null);
    await rejects(() => db.query('delete from public.submission_introducing_parties where id=$1', [partyId]), /never deleted/);
    await rejects(() => db.query("update public.submission_introducing_parties set external_name='x' where id=$1", [partyId]), /removed introducing party cannot be changed/);

    // ---- Owner attribution correction keeps history --------------------------
    await as(U.coordinator);
    await rejects(() => q("select public.owner_correct_intake_attribution($1,'referral_partner',$2,null,$3,'Introduced through the partner directly')", [leadId, org1, U.agentOrg1]), /permission/, '42501');
    await as(U.owner);
    await q("select public.owner_correct_intake_attribution($1,'referral_partner',$2,null,$3,'Introduced through the partner directly')", [leadId, org1, U.agentOrg1]);
    const corr = await one("select detail from public.staff_audit_events where event_type='attribution_corrected' and entity_id=$1", [leadId]);
    assert.equal(corr.detail.previous.team_id, alpha, 'previous attribution preserved in the audit trail');

    // ---- Safe projections ----------------------------------------------------
    await as(U.switchboard);
    const queue = await q('select * from public.staff_intake_queue(null, false, 5000, 0)');
    assert.ok(queue.length >= 2 && queue.length <= 100);
    const cols = Object.keys(queue[0]).join(',');
    for (const banned of ['commission', 'funder', 'bank', 'id_number', 'split', 'payout', 'credit']) {
      assert.ok(!cols.includes(banned), `queue exposes no ${banned} field`);
    }
    const detail = (await one('select public.staff_intake_detail($1) as d', [leadId])).d;
    assert.ok(detail.history.length >= 5);
    assert.ok(!JSON.stringify(detail).match(/storage|signed_url|commission|funder/i));
    assert.ok(detail.receipts.every((r) => !('path' in r) && !('url' in r)));
    await as(U.partner1);
    await rejects(() => q('select public.staff_intake_detail($1)', [leadId]), /permission/, '42501');

    // ---- Append-only audit ---------------------------------------------------
    await as(U.coordinator);
    assert.equal((await q('select 1 from public.staff_audit_events')).length, 0, 'staff cannot read the raw audit ledger');
    await as(U.owner);
    assert.ok((await q('select 1 from public.staff_audit_events')).length > 10);
    await as(null);
    await rejects(() => db.query("update public.staff_audit_events set reason='rewritten'"), /append-only/);
    await rejects(() => db.query('delete from public.staff_audit_events'), /append-only/);
    await rejects(() => db.exec('truncate public.staff_audit_events'), /append-only/);
    await rejects(() => db.query("update public.intake_document_receipts set file_label='x'"), /append-only/);
    await rejects(() => db.query('delete from public.intake_document_flag_events'), /append-only/);

    // ---- No new storage access for staff -------------------------------------
    for (const f of ['20261007090000_staff_roles_enum.sql', '20261007091000_staff_access_and_audit.sql', '20261007092000_organisation_team_structure.sql',
      '20261007093000_submission_intake_core.sql', '20261007094000_submission_intake_rpcs.sql']) {
      assert.ok(!/storage\.objects|storage\.buckets/.test(await mig(f)), `${f} adds no storage policy: staff stay at zero storage read/write`);
    }
  } finally {
    await db.close();
  }
});
