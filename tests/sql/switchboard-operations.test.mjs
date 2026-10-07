import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Batch 2 staff build: executes the Batch 1 and Batch 2 staff-build migrations against an
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

test('switchboard operations (calls, handover, tasks, checklist, diary) are enforced by the database', async () => {
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
      'create table public.clients(id uuid primary key default gen_random_uuid(), business_name text, registration_number text);',
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
      '20261007093000_submission_intake_core.sql', '20261007094000_submission_intake_rpcs.sql', '20261007100000_switchboard_operations.sql']) {
      await db.exec(await mig(f));
    }


    await as(U.owner);
    await q("select public.owner_set_staff_access($1,true,'FNC-EMP-SC-01')", [U.coordinator]);
    await q("select public.owner_set_staff_access($1,true,'FNC-EMP-SA-01')", [U.switchboard]);
    // switchboardOff stays without owner activation.
    await as(U.switchboard);
    const lead = (await one("select public.staff_register_intake('Acme','Thandi','0820000001','a@x.test','2020/111111/07','working_capital',250000,'Stock','direct_agent'::public.submission_channel,null,null,$1,null,'b2-key-1') as r", [U.direct])).r.lead_id;
    assert.ok(lead);

    // ---- Call log ---------------------------------------------------------
    const log = (over = {}) => {
      const a = { dir: 'inbound', kind: 'new_enquirer', name: 'Thandi', phone: '0820000001', biz: 'Acme', topic: 'new_enquiry',
        summary: 'Asked about working capital', outcome: 'resolved', cb: null, lead: null, corrects: null, ...over };
      return one('select public.staff_log_call($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as id',
        [a.dir, a.kind, a.name, a.phone, a.biz, a.topic, a.summary, a.outcome, a.cb, a.lead, a.corrects]).then((x) => x.id);
    };
    const call1 = await log({ lead });
    await rejects(() => log({ summary: 'ID is 8001015009087' }), /staff_text_is_safe|violates check/);
    await rejects(() => log({ outcome: 'callback_needed' }), /violates check/);
    const cbCall = await log({ outcome: 'callback_needed', cb: new Date(Date.now() - 3600e3).toISOString(), name: 'Sipho' });
    await rejects(() => log({ lead: id(999) }), /Submission not found/);
    await as(U.switchboardOff);
    await rejects(() => log(), /permission/, '42501');
    await rejects(() => q('select * from public.staff_call_log_list()'), /permission/, '42501');
    await as(U.partner1);
    await rejects(() => log(), /permission/, '42501');
    assert.equal((await q('select * from public.switchboard_call_logs')).length, 0, 'partners cannot read call logs');
    await as(U.coordinator);
    assert.equal((await q('select * from public.staff_call_log_list()')).length, 2);
    assert.equal((await q('select * from public.switchboard_call_logs')).length, 0, 'coordinator reads only through the projection');
    await as(U.owner);
    assert.equal((await q('select * from public.switchboard_call_logs')).length, 2);
    await db.exec('reset role;');
    await rejects(() => db.query("update public.switchboard_call_logs set summary='x'"), /append-only/);
    await rejects(() => db.query('delete from public.switchboard_call_logs'), /append-only/);
    await as(U.switchboard);
    await log({ corrects: cbCall, outcome: 'resolved', name: 'Sipho' });
    const diary = (await one('select public.staff_diary() as d')).d;
    assert.equal(diary.callbacks_due.length, 0, 'a corrected callback drops out of the diary');

    // ---- Tasks and routing --------------------------------------------------
    const task = (over = {}) => {
      const a = { title: 'Chase bank statements', notes: null, kind: 'document_chase', prio: 'normal', due: new Date(Date.now() - 3600e3).toISOString(), to: 'coordinator', lead, call: null, ...over };
      return one('select public.staff_create_task($1,$2,$3,$4,$5,$6,$7,$8) as id', [a.title, a.notes, a.kind, a.prio, a.due, a.to, a.lead, a.call]).then((x) => x.id);
    };
    const t1 = await task({ call: call1 });
    await rejects(() => task({ to: 'switchboard' }), /cannot route a task to switchboard/, '42501');
    await rejects(() => task({ kind: 'founder_decision', to: 'coordinator' }), /violates check|cannot route|founder/);
    await rejects(() => task({ notes: 'acct 1234567890123' }), /violates check/);
    const founder = await task({ kind: 'founder_decision', to: 'owner', title: 'Decide on exception' });
    await db.exec('reset role;');
    await rejects(() => db.query("update public.staff_tasks set status='done'"), /only through the task functions/);
    await as(U.coordinator);
    assert.equal((await q("select * from public.staff_task_list('open')")).length, 1, 'coordinator sees tasks routed to them, not the Owner decision');
    await rejects(() => q("select public.staff_close_task($1,'done')", [founder]), /Only the Owner/, '42501');
    await rejects(() => q("select public.staff_route_task($1,'switchboard','back to desk')", [founder]), /founder decision stays|only route tasks that are with you/);
    await q("select public.staff_route_task($1,'switchboard','Desk to ring client')", [t1]);
    await rejects(() => q("select public.staff_route_task($1,'owner','')", [t1]), /reason is required/);
    await as(U.switchboard);
    assert.equal((await q("select * from public.staff_task_list('open')")).filter((r) => r.id === t1).length, 1);
    assert.equal((await q("select * from public.staff_task_list('open')")).filter((r) => r.id === founder).length, 1, 'creator still sees what they escalated');
    await rejects(() => q("select public.staff_close_task($1,'done')", [founder]), /Only the Owner/, '42501');
    await q("select public.staff_close_task($1,'done','Rang, docs promised')", [t1]);
    await rejects(() => q("select public.staff_close_task($1,'done')", [t1]), /cannot be changed/);
    await as(U.owner);
    await q("select public.staff_close_task($1,'done','Decided')", [founder]);
    const events = await q('select event from public.staff_task_events where task_id=$1 order by id', [t1]);
    assert.deepEqual(events.map((e) => e.event), ['created', 'routed', 'completed']);

    // ---- Handover ---------------------------------------------------------
    await as(U.switchboard);
    const ho = (await one("select public.staff_write_handover('morning','Two callbacks open','[{\"text\":\"Ring Sipho\"}]'::jsonb) as id")).id;
    await rejects(() => q("select public.staff_write_handover('morning','again')"), /already written/);
    await rejects(() => q('select public.staff_acknowledge_handover($1)', [ho]), /own handover/);
    await as(U.coordinator);
    assert.equal((await one('select public.staff_diary() as d')).d.unacknowledged_handovers, 1);
    await q('select public.staff_acknowledge_handover($1)', [ho]);
    await rejects(() => q('select public.staff_acknowledge_handover($1)', [ho]), /only once/);
    assert.equal((await q('select * from public.staff_handover_list()'))[0].acknowledged_by_name, 'coordinator');

    // ---- Document checklist (type names only) -------------------------------
    await as(U.switchboard);
    await q("select public.staff_record_document_receipt($1,'cipc_cert','whatsapp_business')", [lead]);
    const list = await q('select * from public.staff_document_checklist($1)', [lead]);
    assert.deepEqual(list.map((r) => [r.document_type, r.received]), [['bank_statement', false], ['cipc_cert', true], ['id_copy', false]]);
    assert.deepEqual(Object.keys(list[0]).sort(), ['document_type', 'flagged_suspicious', 'last_received_at', 'received', 'received_count', 'requirement']);
    await as(U.partner1);
    await rejects(() => q('select * from public.staff_document_checklist($1)', [lead]), /permission/, '42501');

    // ---- Nothing new is readable or writable directly -----------------------
    await as(U.coordinator);
    for (const t of ['staff_tasks', 'staff_task_events', 'staff_shift_handovers', 'switchboard_call_logs']) {
      assert.equal((await q(`select * from public.${t}`)).length, 0, `${t} is owner-only for direct reads`);
      await rejects(() => q(`insert into public.${t} default values`), /permission denied|row-level|null value/);
    }
  } finally {
    await db.close();
  }
});
