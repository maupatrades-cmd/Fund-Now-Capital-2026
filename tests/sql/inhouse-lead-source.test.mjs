import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// In-house lead source (18 Nov 2026): the core intake migrations, then 20261118170000-173000.
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

test('Fund Now Capital (in-house) lead source: employee, office, online referral', async () => {
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

    for (const f of ['20261118170000_inhouse_channel_enum.sql']) await db.exec(await mig(f));
    await db.exec(await mig('20261118171000_inhouse_lead_source.sql'));
    // CONCURRENTLY must run one statement at a time, outside a transaction.
    for (const stmt of (await mig('20261118172000_inhouse_lead_source_indexes.sql')).split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
      await db.exec(stmt + ';');
    }
    await db.exec(await mig('20261118173000_inhouse_lead_source_validate.sql'));

    await as(U.owner);
    await q("select public.owner_set_staff_access($1,true,'FNC-EMP-SC-01')", [U.coordinator]);
    await q("select public.owner_set_staff_access($1,true,'FNC-EMP-SA-01')", [U.switchboard]);

    await as(U.coordinator);
    let n = 0;
    const reg = (channel, inhouse = {}, over = {}) => {
      n += 1;
      const a = { name: `Inhouse Biz ${n}`, cipc: `2021/${String(200000 + n)}/07`, cell: `08300000${String(n).padStart(2, '0')}`,
        email: `in${n}@x.test`, org: null, team: null, agent: null, ...over };
      return one(`select public.staff_register_intake($1,'Contact',$2,$3,$4,'working_capital',100000,'Stock',$5::public.submission_channel,
        $6,$7,$8,null,$9,$10,$11,$12,$13) as r`,
        [a.name, a.cell, a.email, a.cipc, channel, a.org, a.team, a.agent, `inhouse-key-${n}`,
         inhouse.kind ?? null, inhouse.staff ?? null, inhouse.office ?? null, inhouse.name ?? null]).then((x) => x.r);
    };
    const intake = async (leadId) => {
      await db.exec('reset role;');
      const row = await one('select si.*, l.attributed_to_lead_referrer_id, l.attributed_to_contractor_id, l.attributed_to_partner_id from public.submission_intakes si join public.leads l on l.id = si.lead_id where si.lead_id = $1', [leadId]).catch(async () =>
        one('select si.* from public.submission_intakes si where si.lead_id = $1', [leadId]));
      await as(U.coordinator);
      return row;
    };

    // Lookups list the Fund Now Capital people (Director + enabled staff, never agents) and the three offices.
    const L = (await one('select public.staff_intake_lookups() as r')).r;
    assert.deepEqual(L.fnc_offices.map((o) => o.code).sort(), ['bryanston', 'burgersfort', 'polokwane']);
    const people = L.fnc_people.map((p) => p.profile_id);
    assert.ok(people.includes(U.owner) && people.includes(U.coordinator) && people.includes(U.switchboard));
    assert.ok(!people.includes(U.switchboardOff), 'staff without enabled access are not listed');
    assert.ok(!people.includes(U.partner1) && !people.includes(U.direct), 'agents and partners are not Fund Now Capital people');

    // (a) employee
    const emp = await reg('inhouse', { kind: 'employee', staff: U.switchboard });
    assert.equal(emp.status, 'created');
    let row = await intake(emp.lead_id);
    assert.equal(row.channel, 'inhouse');
    assert.equal(row.inhouse_kind, 'employee');
    assert.equal(row.inhouse_staff_id, U.switchboard);
    assert.equal(row.agent_profile_id, null, 'an in-house lead credits no agent');
    assert.equal(row.organisation_id, null);
    assert.equal(row.team_id, null);
    assert.equal(row.affiliation_snapshot.inhouse_label, 'Fund Now Capital — switchboard');
    const director = await reg('inhouse', { kind: 'employee', staff: U.owner });
    assert.equal(director.status, 'created', 'the Director counts as a Fund Now Capital employee');
    // (b) office
    const off = await reg('inhouse', { kind: 'office', office: 'polokwane' });
    row = await intake(off.lead_id);
    assert.equal(row.inhouse_office_code, 'polokwane');
    assert.equal(row.affiliation_snapshot.inhouse_label, 'Fund Now Capital Polokwane');
    assert.equal(row.agent_profile_id, null);
    // (c) online / direct referral
    const onl = await reg('inhouse', { kind: 'online', name: '  Mpho from Facebook  ' });
    row = await intake(onl.lead_id);
    assert.equal(row.inhouse_referrer_name, 'Mpho from Facebook');
    assert.equal(row.affiliation_snapshot.inhouse_label, 'Online / direct referral — Mpho from Facebook');
    assert.equal(row.agent_profile_id, null);

    // The queue shows the readable source.
    const queue = await q('select lead_id, channel, source_label, agent_name from public.staff_intake_queue()');
    const label = (id) => queue.find((r) => r.lead_id === id);
    assert.equal(label(off.lead_id).source_label, 'Fund Now Capital Polokwane');
    assert.equal(label(onl.lead_id).agent_name, null);

    // Invalid sources are refused.
    await rejects(() => reg('inhouse', {}), /Choose where the Fund Now Capital lead came from/);
    await rejects(() => reg('inhouse', { kind: 'office', office: 'durban' }), /active Fund Now Capital office/);
    await rejects(() => reg('inhouse', { kind: 'employee', staff: U.switchboardOff }), /active Fund Now Capital employee/);
    await rejects(() => reg('inhouse', { kind: 'employee', staff: U.partner1 }), /active Fund Now Capital employee/);
    await rejects(() => reg('inhouse', { kind: 'employee' }), /active Fund Now Capital employee/);
    await rejects(() => reg('inhouse', { kind: 'online' }), /Type who referred them/);
    await rejects(() => reg('inhouse', { kind: 'online', name: 'A' }), /Type who referred them/);
    await rejects(() => reg('inhouse', { kind: 'online', name: 'x'.repeat(121) }), /Type who referred them/);
    await rejects(() => reg('inhouse', { kind: 'office', office: 'polokwane', name: 'Extra' }), /only the office/);
    await rejects(() => reg('inhouse', { kind: 'employee', staff: U.coordinator }, { agent: U.direct }), /cannot carry an agent/);
    await rejects(() => reg('inhouse', { kind: 'office', office: 'polokwane' }, { org: org1 }), /cannot carry an agent, organisation or team/);
    // Offices are maintained through SQL (no app write path); deactivate one as the database admin.
    await db.exec("reset role; update public.fnc_offices set is_active = false where code = 'bryanston';");
    await as(U.coordinator);
    await rejects(() => reg('inhouse', { kind: 'office', office: 'bryanston' }), /active Fund Now Capital office/);

    // Other channels: unchanged, and never carry an in-house source.
    const direct = await reg('direct_agent', {}, { agent: U.direct });
    assert.equal(direct.status, 'created');
    row = await intake(direct.lead_id);
    assert.equal(row.inhouse_kind, null);
    assert.equal(row.agent_profile_id, U.direct);
    await rejects(() => reg('direct_agent', { kind: 'office', office: 'polokwane' }, { agent: U.direct }), /Only a Fund Now Capital \(in-house\) lead/);
    const partnerLead = await reg('referral_partner', {}, { org: org1 });
    assert.equal(partnerLead.status, 'created');

    // The database itself refuses a malformed in-house row.
    await db.exec('reset role;');
    await rejects(() => q("update public.submission_intakes set inhouse_kind = 'office' where lead_id = $1", [direct.lead_id]),
      /Attribution is fixed at registration/);
    await db.exec("select set_config('fnc.intake_attribution_correction','on',false);");
    await rejects(() => q("update public.submission_intakes set inhouse_kind = 'office' where lead_id = $1", [direct.lead_id]),
      /inhouse_shape_ck|violates check/);
    await db.exec("select set_config('fnc.intake_attribution_correction','off',false);");

    // The Owner cannot correct a lead INTO in-house; correcting away from in-house clears the source.
    await as(U.owner);
    await rejects(() => q("select public.owner_correct_intake_attribution($1,'inhouse',null,null,null,'Moving it in-house for a test')", [direct.lead_id]),
      /cannot be corrected into Fund Now Capital/);
    await q("select public.owner_correct_intake_attribution($1,'direct_agent',null,null,$2,'Actually came through this direct agent')", [onl.lead_id, U.direct]);
    row = await intake(onl.lead_id);
    assert.equal(row.channel, 'direct_agent');
    assert.equal(row.inhouse_kind, null);
    assert.equal(row.inhouse_referrer_name, null);

    // Partners and switched-off staff cannot read the office list.
    await as(U.partner1);
    assert.equal((await q('select * from public.fnc_offices')).length, 0);
    await as(U.coordinator);
    assert.ok((await q('select * from public.fnc_offices')).length >= 2);
  } finally {
    await db.close();
  }
});
