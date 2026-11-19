import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Lead agents (19 Nov 2026): contractors as direct agents, the field team channel, owner correction into field, the
// printable lead sheet. Core intake migrations, the in-house migrations, then 20261119090000-093000.
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
  contractor: id(11), contractorOff: id(12), contractorOrg: id(13), fieldC: id(14), fieldS: id(15), fieldOff: id(16), fieldNoAccess: id(17),
};
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Lead agents: contractors, field team, correction into field, lead sheet', async () => {
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
    await db.exec(await mig('20261021130000_field_roles_enum.sql'));
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
      // A contractor with no name on file (as live): listed by email.
      `insert into public.profiles(id,email,full_name,role) values ('${U.contractor}','contractor@example.test',null,'contractor');`,
      profile(U.contractorOff, 'contractor_off', 'contractor'),
      `update public.profiles set is_active = false where id = '${U.contractorOff}';`,
      profile(U.contractorOrg, 'contractor_org', 'contractor', org1),
      profile(U.fieldC, 'Matenchi', 'field_consultant'),
      profile(U.fieldS, 'Moses', 'field_supervisor'),
      profile(U.fieldOff, 'Field_off', 'field_consultant'),
      profile(U.fieldNoAccess, 'Field_noaccess', 'field_consultant'),
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

    // Field staff access (later migrations widen staff_access to every staff role; set it directly here).
    await db.exec(`alter table public.staff_access drop constraint staff_access_role_ck;
      insert into public.staff_access(profile_id, staff_role, access_enabled) values
        ('${U.fieldC}','field_consultant',true),('${U.fieldS}','field_supervisor',true),
        ('${U.fieldOff}','field_consultant',false);`);
    for (const f of ['20261118170000_inhouse_channel_enum.sql']) await db.exec(await mig(f));
    await db.exec(await mig('20261118171000_inhouse_lead_source.sql'));
    // CONCURRENTLY must run one statement at a time, outside a transaction.
    for (const stmt of (await mig('20261118172000_inhouse_lead_source_indexes.sql')).split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
      await db.exec(stmt + ';');
    }
    await db.exec(await mig('20261118173000_inhouse_lead_source_validate.sql'));
    await db.exec(await mig('20261119090000_field_channel_enum.sql'));
    await db.exec(await mig('20261119091000_lead_agents.sql'));
    for (const stmt of (await mig('20261119092000_lead_agents_index.sql')).split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
      await db.exec(stmt + ';');
    }
    await db.exec(await mig('20261119093000_lead_agents_validate.sql'));

    await as(U.owner);
    await q("select public.owner_set_staff_access($1,true,'FNC-EMP-SC-01')", [U.coordinator]);
    await q("select public.owner_set_staff_access($1,true,'FNC-EMP-SA-01')", [U.switchboard]);

    await as(U.coordinator);
    let n = 0;
    const reg = (channel, over = {}) => {
      n += 1;
      const a = { name: `Agent Biz ${n}`, cipc: `2022/${String(300000 + n)}/07`, cell: `08400000${String(n).padStart(2, '0')}`,
        email: `ag${n}@x.test`, org: null, team: null, agent: null, kind: null, staff: null, office: null, refName: null,
        field: null, ...over };
      return one(`select public.staff_register_intake($1,'Contact',$2,$3,$4,'working_capital',250000,'Stock',$5::public.submission_channel,
        $6,$7,$8,null,$9,$10,$11,$12,$13,$14) as r`,
        [a.name, a.cell, a.email, a.cipc, channel, a.org, a.team, a.agent, `agents-key-${n}`,
         a.kind, a.staff, a.office, a.refName, a.field]).then((x) => x.r);
    };
    const intake = async (leadId) => {
      await db.exec('reset role;');
      const row = await one('select * from public.submission_intakes where lead_id = $1', [leadId]);
      await as(U.coordinator);
      return row;
    };

    // Lookups: independent lead-referrers AND contractors (no name -> email); the field team (enabled access only).
    const L = (await one('select public.staff_intake_lookups() as r')).r;
    const directIds = L.direct_agents.map((a) => a.profile_id);
    assert.ok(directIds.includes(U.direct) && directIds.includes(U.contractor));
    assert.ok(!directIds.includes(U.contractorOff), 'inactive contractors are not listed');
    assert.ok(!directIds.includes(U.contractorOrg), 'a contractor under an organisation is not an independent agent');
    assert.equal(L.direct_agents.find((a) => a.profile_id === U.contractor).name, 'contractor@example.test');
    const fieldIds = L.field_team.map((a) => a.profile_id).sort();
    assert.deepEqual(fieldIds, [U.fieldC, U.fieldS].sort(), 'only the enabled field team is listed');

    // (1) A contractor is a direct agent.
    const c = await reg('direct_agent', { agent: U.contractor });
    assert.equal(c.status, 'created');
    let row = await intake(c.lead_id);
    assert.equal(row.channel, 'direct_agent');
    assert.equal(row.agent_profile_id, U.contractor);
    assert.equal(row.field_agent_id, null);
    await rejects(() => reg('direct_agent', { agent: U.contractorOff }), /Active agent not found/);
    await rejects(() => reg('direct_agent', { agent: U.contractorOrg }), /independent lead-referrer or contractor/);
    await rejects(() => reg('referral_partner', { org: org1, agent: U.contractorOrg }), /captured on the Direct agent channel/);
    // Lead-referrer direct agents are unchanged.
    assert.equal((await reg('direct_agent', { agent: U.direct })).status, 'created');

    // (2) The field team channel.
    const f = await reg('field', { field: U.fieldC });
    assert.equal(f.status, 'created');
    row = await intake(f.lead_id);
    assert.equal(row.channel, 'field');
    assert.equal(row.field_agent_id, U.fieldC);
    assert.equal(row.agent_profile_id, null, 'a field lead credits no agent');
    assert.equal(row.organisation_id, null);
    assert.equal(row.affiliation_snapshot.field_agent_name, 'Matenchi');
    assert.equal((await reg('field', { field: U.fieldS })).status, 'created', 'the Field Supervisor can be the one the sale is for');
    await rejects(() => reg('field', {}), /Choose the field consultant/);
    await rejects(() => reg('field', { field: U.fieldOff }), /active field consultant or Field Supervisor/);
    await rejects(() => reg('field', { field: U.fieldNoAccess }), /active field consultant or Field Supervisor/);
    await rejects(() => reg('field', { field: U.partner1 }), /active field consultant or Field Supervisor/);
    await rejects(() => reg('field', { field: U.coordinator }), /active field consultant or Field Supervisor/);
    await rejects(() => reg('field', { field: U.fieldC, agent: U.direct }), /field team lead cannot carry an agent/);
    await rejects(() => reg('field', { field: U.fieldC, org: org1 }), /field team lead cannot carry an agent/);
    await rejects(() => reg('direct_agent', { agent: U.direct, field: U.fieldC }), /Only a field team lead carries a field consultant/);
    await rejects(() => reg('field', { field: U.fieldC, kind: 'office', office: 'polokwane' }), /Only a Fund Now Capital \(in-house\) lead/);

    // In-house is unchanged.
    const inh = await reg('inhouse', { kind: 'employee', staff: U.switchboard });
    assert.equal(inh.status, 'created');
    row = await intake(inh.lead_id);
    assert.equal(row.inhouse_staff_id, U.switchboard);
    assert.equal(row.field_agent_id, null);

    // Queue labels.
    const queue = await q('select lead_id, source_label from public.staff_intake_queue()');
    const lab = (id) => queue.find((r) => r.lead_id === id).source_label;
    assert.equal(lab(f.lead_id), 'Field team — Matenchi');
    assert.equal(lab(inh.lead_id), 'Fund Now Capital — switchboard');
    assert.equal(lab(c.lead_id), null);

    // The database refuses a malformed field row and keeps the field person fixed at registration.
    await db.exec('reset role;');
    await rejects(() => q('update public.submission_intakes set field_agent_id = $2 where lead_id = $1', [f.lead_id, U.fieldS]),
      /Attribution is fixed at registration/);
    await db.exec("select set_config('fnc.intake_attribution_correction','on',false);");
    await rejects(() => q('update public.submission_intakes set field_agent_id = $2 where lead_id = $1', [c.lead_id, U.fieldS]),
      /field_shape_ck|violates check/);
    await db.exec("select set_config('fnc.intake_attribution_correction','off',false);");

    // (3) Owner correction: an in-house -> employee lead captured as a workaround moves INTO the field team.
    await as(U.owner);
    await rejects(() => q("select public.owner_correct_intake_attribution($1,'field',null,null,null,'Field consultant sale captured in-house')", [inh.lead_id]),
      /Choose the field consultant/);
    await rejects(() => q("select public.owner_correct_intake_attribution($1,'field',null,null,null,'Field consultant sale captured in-house',$2)", [inh.lead_id, U.fieldOff]),
      /active field consultant or Field Supervisor/);
    await rejects(() => q("select public.owner_correct_intake_attribution($1,'direct_agent',null,null,$2,'Wrong field person on direct',$3)", [inh.lead_id, U.direct, U.fieldC]),
      /Only a field team lead carries a field consultant/);
    await q("select public.owner_correct_intake_attribution($1,'field',null,null,null,'Field consultant sale captured in-house',$2)", [inh.lead_id, U.fieldC]);
    row = await intake(inh.lead_id);
    assert.equal(row.channel, 'field');
    assert.equal(row.field_agent_id, U.fieldC);
    assert.equal(row.inhouse_kind, null);
    assert.equal(row.inhouse_staff_id, null);
    await db.exec('reset role;');
    const audit = await one("select reason, detail from public.staff_audit_events where entity_id = $1 and event_type = 'attribution_corrected' order by id desc limit 1", [inh.lead_id]);
    assert.equal(audit.detail.previous_inhouse_kind, 'employee');
    assert.equal(audit.detail.previous_inhouse_staff_id, U.switchboard);
    // The old 6-argument call still works, and correcting away from field clears the field person.
    await as(U.owner);
    await q("select public.owner_correct_intake_attribution($1,'direct_agent',null,null,$2,'Actually the contractor brought it')", [f.lead_id, U.contractor]);
    row = await intake(f.lead_id);
    assert.equal(row.channel, 'direct_agent');
    assert.equal(row.field_agent_id, null);
    assert.equal(row.agent_profile_id, U.contractor);
    // Correcting into in-house stays refused.
    await as(U.owner);
    await rejects(() => q("select public.owner_correct_intake_attribution($1,'inhouse',null,null,null,'Moving it in-house for a test')", [c.lead_id]),
      /cannot be corrected into Fund Now Capital/);
    // Only the Director corrects.
    await as(U.coordinator);
    await rejects(() => q("select public.owner_correct_intake_attribution($1,'field',null,null,null,'Coordinator tries a correction',$2)", [c.lead_id, U.fieldC]),
      /permission/);

    // (4) The printable lead sheet: queue roles only, printable fields only.
    const sheet = (await one('select public.staff_intake_sheet($1) as r', [inh.lead_id])).r;
    assert.equal(sheet.source_label, 'Field team — Matenchi');
    assert.equal(sheet.funding_type_label, 'Working capital');
    assert.equal(Number(sheet.requested_amount), 250000);
    assert.equal(sheet.captured_by_name, 'coordinator');
    assert.equal(sheet.reference, inh.lead_id.slice(0, 8).toUpperCase());
    assert.ok(Array.isArray(sheet.missing_documents));
    assert.ok(!('contact_id_number' in sheet) && !JSON.stringify(Object.keys(sheet)).includes('bank'), 'no ID or bank fields');
    await as(U.switchboard);
    assert.equal((await one('select public.staff_intake_sheet($1) as r', [c.lead_id])).r.agent_name, 'contractor@example.test');
    await as(U.owner);
    assert.ok((await one('select public.staff_intake_sheet($1) as r', [c.lead_id])).r.business_name);
    for (const who of [U.partner1, U.fieldC, U.switchboardOff, U.direct]) {
      await as(who);
      await rejects(() => q('select public.staff_intake_sheet($1)', [c.lead_id]), /permission/);
    }
    await as(U.coordinator);
    await rejects(() => q('select public.staff_intake_sheet($1)', [id(999)]), /Submission not found/);
  } finally {
    await db.close();
  }
});
