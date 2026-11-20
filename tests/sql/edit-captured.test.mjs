import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Staff correct capture mistakes (19 Nov 2026): staff_correct_agent / staff_agent_type_state /
// staff_correct_intake_details (20261119110000-111000). A synthetic schema that mirrors the live columns these functions
// touch (checked read-only against live on 19 Nov), with the live staff_role_of / staff_actor_role / staff_audit_write
// bodies and a stand-in for the intake guard's funding-type lock. It proves who may correct what and that the audit is
// written; it does not prove the live schema end to end.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = {
  owner: id(1), admin: id(2), coord: id(3), switchboard: id(4), hr: id(5), field: id(6), adminOff: id(7),
  direct: id(20), sub: id(21), leader: id(22), busy: id(23), staffTarget: id(24), partnerUser: id(25), directPayee: id(26),
};
const ORG = id(100);
const ORG_OFF = id(101);
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('Staff correct agent type / name and captured lead details', async () => {
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0];
  const as = async (uid) => {
    await db.exec('reset role;');
    if (uid) await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  };
  const rejects = async (fn, pattern) => assert.rejects(fn, (e) => { assert.match(e.message, pattern); return true; });
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create type public.user_role as enum ('owner','partner','contractor','client','lead_referrer','switchboard','coordinator','administrator','hr','field_supervisor','field_consultant');
      create type public.notification_event_type as enum ('AGENT_ADDED');
      create type public.activity_event_type as enum ('CREATE','UPDATE','PERMISSION_CHANGE');
      create type public.lead_qualification_stage as enum ('new_lead','under_qualification','qualified','not_qualified');
      create table public.referral_partners(id uuid primary key, name text not null, is_active boolean not null default true);
      create table public.profiles(id uuid primary key, email text, full_name text, phone_number text, role public.user_role not null,
        referral_partner_id uuid, sourced_via_partner_id uuid, is_active boolean not null default true, updated_at timestamptz);
      create table public.staff_access(profile_id uuid primary key, staff_role public.user_role not null, access_enabled boolean not null);
      create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$
        select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) $$;
      create function public.staff_role_of() returns text language sql stable security definer set search_path='' as $$
        select p.role::text from public.profiles p join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
         where p.id = (select auth.uid()) and p.is_active and s.access_enabled
           and p.role::text in ('switchboard','coordinator','administrator','hr','field_supervisor','field_consultant') $$;
      create function public.staff_actor_role() returns text language sql stable security definer set search_path='' as $$
        select case when public.is_owner() then 'owner' else public.staff_role_of() end $$;
      create table public.staff_audit_events(id bigserial primary key, entity_type text, entity_id uuid, event_type text,
        actor_id uuid, actor_role text, reason text, detail jsonb);
      create function public.staff_audit_write(p_entity_type text, p_entity_id uuid, p_event_type text, p_reason text default null,
        p_detail jsonb default '{}'::jsonb) returns bigint language plpgsql security definer set search_path='' as $$
        declare v bigint; begin
          insert into public.staff_audit_events(entity_type,entity_id,event_type,actor_id,actor_role,reason,detail)
          values (p_entity_type,p_entity_id,p_event_type,(select auth.uid()),public.staff_actor_role(),p_reason,coalesce(p_detail,'{}'))
          returning id into v; return v; end $$;
      create table public.notifications(id bigserial primary key, user_id uuid, event_type public.notification_event_type,
        title text, body_text text, link_url text, data jsonb);
      create function public.staff_notify(p_user uuid, p_event public.notification_event_type, p_title text, p_body text,
        p_link text, p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
        begin insert into public.notifications(user_id,event_type,title,body_text,link_url,data)
              values (p_user,p_event,p_title,p_body,p_link,p_data); end $$;
      create table public.activity_logs(id bigserial primary key, user_id uuid, user_email text, user_role text,
        event_type public.activity_event_type, entity_type text, entity_id uuid, description text,
        changed_fields jsonb, before_values jsonb, after_values jsonb);
      create table public.partner_lead_referrers(id uuid primary key default gen_random_uuid(), profile_id uuid unique,
        referral_partner_id uuid, display_name text check (length(btrim(display_name)) between 2 and 160), status text,
        invited_by uuid, updated_at timestamptz);
      create table public.agent_details(profile_id uuid primary key, contract_type text, updated_by uuid, updated_by_role text,
        updated_at timestamptz);
      create table public.payee_payment_profiles(id uuid primary key default gen_random_uuid(), referral_partner_id uuid,
        contractor_id uuid, lead_referrer_id uuid, check (num_nonnulls(referral_partner_id, contractor_id, lead_referrer_id) = 1));
      create table public.leads(id uuid primary key default gen_random_uuid(), business_name text, contact_name text,
        contact_cell text, contact_email text, cipc_number text, funding_amount numeric(14,2), funding_purpose jsonb default '[]',
        qualification_stage public.lead_qualification_stage not null default 'new_lead',
        attributed_to_contractor_id uuid, attributed_to_lead_referrer_id uuid, sourced_by_lead_refer_id uuid);
      create unique index leads_cipc_uq on public.leads (cipc_number);
      create table public.deals(id uuid primary key default gen_random_uuid(), lead_id uuid);
      create table public.funding_product_catalog(code text primary key, is_active boolean not null default true);
      create table public.submission_intakes(lead_id uuid primary key, agent_profile_id uuid, team_leader_profile_id uuid,
        funding_type text, created_by uuid);
      -- Stand-in for submission_intakes_guard: the funding type is registration attribution.
      create function public.si_guard() returns trigger language plpgsql as $$ begin
        if new.funding_type is distinct from old.funding_type
           and coalesce(current_setting('fnc.intake_attribution_correction', true), '') <> 'on' then
          raise exception 'Attribution is fixed at registration'; end if; return new; end $$;
      create trigger si_guard before update on public.submission_intakes for each row execute function public.si_guard();
      create table public.submission_introducing_parties(id uuid primary key default gen_random_uuid(), lead_id uuid, profile_id uuid, removed_at timestamptz);
      create table public.referral_team_memberships(id uuid primary key default gen_random_uuid(), profile_id uuid);
      create table public.commission_records(id uuid primary key default gen_random_uuid(), contractor_id uuid);
      create table public.lead_referrer_commission_records(id uuid primary key default gen_random_uuid(), lead_refer_id uuid);
      create table public.complete_document_reward_locks(id uuid primary key default gen_random_uuid(), beneficiary_profile_id uuid);
      create table public.owner_commission_entries(id uuid primary key default gen_random_uuid(), beneficiary_profile_id uuid);
      create table public.contractor_invoices(id uuid primary key default gen_random_uuid(), contractor_id uuid);
      grant usage on schema public, auth to authenticated;
      grant select on all tables in schema public to authenticated;

      insert into public.referral_partners(id,name,is_active) values ('${ORG}','Bright Destiny',true),('${ORG_OFF}','Old Org',false);
      insert into public.profiles(id,email,full_name,role,referral_partner_id,sourced_via_partner_id,is_active) values
        ('${U.owner}','owner@x','Owner','owner',null,null,true),
        ('${U.admin}','admin@x','Sinah','administrator',null,null,true),
        ('${U.adminOff}','adminoff@x','Off','administrator',null,null,true),
        ('${U.coord}','coord@x','Koketso','coordinator',null,null,true),
        ('${U.switchboard}','sb@x','Switch','switchboard',null,null,true),
        ('${U.hr}','hr@x','HR','hr',null,null,true),
        ('${U.field}','field@x','Field','field_consultant',null,null,true),
        ('${U.direct}','direct@x','Sarah Mphtulo','contractor',null,null,true),
        ('${U.sub}','sub@x','Gloria','lead_referrer',null,'${ORG}',true),
        ('${U.leader}','leader@x','Doctor','partner','${ORG}',null,true),
        ('${U.busy}','busy@x','Busy Agent','contractor',null,null,true),
        ('${U.directPayee}','dp@x','Payee Agent','contractor',null,null,true),
        ('${U.staffTarget}','st@x','Staff Person','coordinator',null,null,true),
        ('${U.partnerUser}','pu@x','Pulane','partner','${ORG}',null,true);
      insert into public.staff_access values ('${U.admin}','administrator',true),('${U.adminOff}','administrator',false),
        ('${U.coord}','coordinator',true),('${U.switchboard}','switchboard',true),('${U.hr}','hr',true),
        ('${U.field}','field_consultant',true),('${U.staffTarget}','coordinator',true);
      insert into public.partner_lead_referrers(profile_id,referral_partner_id,display_name,status) values ('${U.sub}','${ORG}','Gloria','active');
      insert into public.agent_details(profile_id,contract_type) values ('${U.direct}','DRA-01');
      insert into public.payee_payment_profiles(contractor_id) values ('${U.directPayee}');
      insert into public.funding_product_catalog(code) values ('working_capital'),('asset_finance');
    `);
    await db.exec(await mig('20261119110000_agent_corrected_enum.sql'));
    await db.exec(await mig('20261119111000_correct_captured_details.sql'));

    const correct = (p, name, phone, type, org, reason) =>
      q('select public.staff_correct_agent($1,$2,$3,$4,$5,$6)', [p, name, phone, type, org, reason]);

    // ---- Agents ---------------------------------------------------------------------------------------------------
    await as(U.admin);
    const st = (await one('select public.staff_agent_type_state($1) as s', [U.direct])).s;
    assert.equal(st.type, 'direct');
    assert.equal(st.type_locked, false);

    // Direct -> Sub-agent under Bright Destiny, with a name fix.
    await correct(U.direct, 'Sarah Mphuthulo', null, 'sub', ORG, 'Added as Direct by mistake');
    await as(null);
    let p = await one('select role::text, sourced_via_partner_id, referral_partner_id, full_name from public.profiles where id=$1', [U.direct]);
    assert.deepEqual([p.role, p.sourced_via_partner_id, p.referral_partner_id, p.full_name], ['lead_referrer', ORG, null, 'Sarah Mphuthulo']);
    assert.equal((await one('select referral_partner_id from public.partner_lead_referrers where profile_id=$1', [U.direct])).referral_partner_id, ORG);
    assert.equal((await one('select contract_type from public.agent_details where profile_id=$1', [U.direct])).contract_type, 'SAA-01');
    const log = await one("select event_type::text e, before_values b, after_values a, user_role from public.activity_logs where entity_id=$1 order by id desc limit 1", [U.direct]);
    assert.equal(log.e, 'PERMISSION_CHANGE');
    assert.equal(log.b.role, 'contractor');
    assert.equal(log.a.role, 'lead_referrer');
    assert.equal(log.user_role, 'administrator');
    const audit = await one("select actor_role, reason, detail from public.staff_audit_events where entity_id=$1 and event_type='agent_corrected'", [U.direct]);
    assert.equal(audit.actor_role, 'administrator');
    assert.equal(audit.detail.before.type, 'direct');
    assert.equal(audit.detail.after.type, 'sub');
    const note = await one('select user_id, event_type::text e from public.notifications order by id desc limit 1');
    assert.deepEqual([note.user_id, note.e], [U.owner, 'AGENT_DETAILS_CORRECTED']);

    // Sub-agent -> Direct agent: membership removed, contract type follows.
    await as(U.admin);
    await correct(U.direct, null, null, 'direct', null, 'Was right the first time');
    await as(null);
    p = await one('select role::text, sourced_via_partner_id from public.profiles where id=$1', [U.direct]);
    assert.deepEqual([p.role, p.sourced_via_partner_id], ['contractor', null]);
    assert.equal((await q('select 1 from public.partner_lead_referrers where profile_id=$1', [U.direct])).length, 0);
    assert.equal((await one('select contract_type from public.agent_details where profile_id=$1', [U.direct])).contract_type, 'DRA-01');

    // Bank details follow a Direct -> Sub-agent change.
    await as(U.admin);
    await correct(U.directPayee, null, null, 'sub', ORG, 'Sub-agent of Bright Destiny');
    await as(null);
    const pp = await one('select contractor_id, lead_referrer_id from public.payee_payment_profiles');
    assert.deepEqual([pp.contractor_id, pp.lead_referrer_id], [null, U.directPayee]);
    // ...but a change to Team Leader is refused while bank details are on file.
    await as(U.admin);
    await rejects(() => correct(U.directPayee, null, null, 'team_leader', ORG, 'Make Team Leader'), /Bank details are on file/);

    // Refusals: validation, organisation, attributions, staff/owner targets.
    await rejects(() => correct(U.direct, null, null, 'sub', null, 'no org'), /active organisation/);
    await rejects(() => correct(U.direct, null, null, 'sub', ORG_OFF, 'old org'), /active organisation/);
    await rejects(() => correct(U.direct, null, null, 'direct', ORG, 'org on direct'), /no organisation/);
    await rejects(() => correct(U.direct, 'X', null, null, null, 'bad name'), /2 to 120/);
    await rejects(() => correct(U.direct, null, '123', null, null, 'bad cell'), /10 to 15 digits/);
    await rejects(() => correct(U.direct, 'Sarah Mphtulo', null, null, null, 'abc'), /at least 5 characters/);
    await rejects(() => correct(U.direct, null, null, null, null, 'nothing at all'), /Nothing to change/);
    await rejects(() => correct(U.staffTarget, null, null, 'direct', null, 'not an agent'), /Only an agent/);
    await rejects(() => correct(U.owner, null, null, 'direct', null, 'not an agent'), /Only an agent/);
    await as(null);
    await db.exec(`insert into public.leads(id,business_name,contact_name) values ('${id(500)}','Busy Biz','C');
      insert into public.submission_intakes(lead_id,agent_profile_id,funding_type,created_by) values ('${id(500)}','${U.busy}','working_capital','${U.coord}');`);
    await as(U.admin);
    await rejects(() => correct(U.busy, null, null, 'sub', ORG, 'Wrong type'), /already has leads/);
    assert.equal((await one('select public.staff_agent_type_state($1) as s', [U.busy])).s.type_locked, true);
    // A name fix is still allowed for an agent with leads.
    await correct(U.busy, 'Busy Agent Mokoena', '0821234567', null, null, 'Surname missing');
    await as(null);
    assert.equal((await one("select event_type::text e from public.activity_logs where entity_id=$1 order by id desc limit 1", [U.busy])).e, 'UPDATE');

    // Who may correct agents: Director yes (no self-notice); coordinator, switchboard, HR, field, disabled admin, partner no.
    await as(U.owner);
    const before = (await one('select count(*)::int n from public.notifications')).n;
    await correct(U.leader, 'Doctor Masobota Moloi', null, null, null, 'Full name');
    await as(null);
    assert.equal((await one('select count(*)::int n from public.notifications')).n, before, 'the Director is not notified of her own change');
    for (const who of [U.coord, U.switchboard, U.hr, U.field, U.adminOff, U.partnerUser]) {
      await as(who);
      await rejects(() => correct(U.direct, 'Someone Else', null, null, null, 'not allowed'), /Only the Director or the Office Administrator/);
      await rejects(() => q('select public.staff_agent_type_state($1)', [U.direct]), /Only the Director or the Office Administrator/);
    }

    // ---- Captured leads ---------------------------------------------------------------------------------------------
    await as(null);
    const L1 = id(600); const L2 = id(601); const L3 = id(602);
    await db.exec(`insert into public.leads(id,business_name,contact_name,contact_cell,contact_email,cipc_number,funding_amount) values
        ('${L1}','Wrong Biz','Contct','0821111111','a@x.test','2020/111111/07',100000),
        ('${L2}','Other Biz','C2',null,null,'2020/222222/07',50000),
        ('${L3}','Client Biz','C3',null,null,null,1000);
      insert into public.submission_intakes(lead_id,funding_type,created_by) values
        ('${L1}','working_capital','${U.switchboard}'),('${L2}','working_capital','${U.coord}'),('${L3}','working_capital','${U.coord}');
      insert into public.deals(lead_id) values ('${L3}');`);
    const fix = (lead, o, reason = 'Typed it wrong') =>
      q('select public.staff_correct_intake_details($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [lead, o.biz ?? null, o.contact ?? null, o.cell ?? null, o.email ?? null, o.cipc ?? null, o.amount ?? null,
         o.purpose ?? null, o.ftype ?? null, reason]);

    // The capturer (Switchboard) corrects their own lead, including the funding type.
    await as(U.switchboard);
    await fix(L1, { biz: 'Right Biz (Pty) Ltd', contact: 'Contact', amount: 150000, purpose: 'Stock', ftype: 'asset_finance' });
    await as(null);
    const l = await one('select business_name, contact_name, funding_amount::text a, funding_purpose from public.leads where id=$1', [L1]);
    assert.deepEqual([l.business_name, l.contact_name, l.a, l.funding_purpose], ['Right Biz (Pty) Ltd', 'Contact', '150000.00', ['Stock']]);
    assert.equal((await one('select funding_type from public.submission_intakes where lead_id=$1', [L1])).funding_type, 'asset_finance');
    const la = await one("select actor_role, reason, detail from public.staff_audit_events where entity_id=$1 and event_type='details_corrected'", [L1]);
    assert.equal(la.actor_role, 'switchboard');
    assert.equal(la.detail.before.business_name, 'Wrong Biz');
    assert.equal(la.detail.after.business_name, 'Right Biz (Pty) Ltd');
    assert.equal(la.detail.before.funding_type, 'working_capital');
    assert.equal(la.detail.after.funding_type, 'asset_finance');
    // ...but Switchboard cannot correct a lead someone else captured.
    await as(U.switchboard);
    await rejects(() => fix(L2, { biz: 'Nope Biz' }), /Only whoever captured this lead/);
    // Coordinator, Administrator and the Director can.
    await as(U.coord);
    await fix(L2, { cell: '082 222 2222', email: 'C2@X.TEST' });
    await as(U.admin);
    await fix(L2, { contact: 'Contact Two' });
    await as(U.owner);
    await fix(L2, { amount: 60000 });
    await as(null);
    const l2 = await one('select contact_cell, contact_email, contact_name, funding_amount::text a from public.leads where id=$1', [L2]);
    assert.deepEqual([l2.contact_cell, l2.contact_email, l2.contact_name, l2.a], ['0822222222', 'c2@x.test', 'Contact Two', '60000.00']);
    // HR, field, partner refused; converted leads refused; validation; the CIPC unique block still applies.
    for (const who of [U.hr, U.field, U.partnerUser]) {
      await as(who);
      await rejects(() => fix(L2, { biz: 'Nope Biz' }), /Only whoever captured this lead/);
    }
    await as(U.coord);
    await rejects(() => fix(L3, { biz: 'Client Biz Two' }), /already a client/);
    await as(null);
    await db.exec(`update public.leads set qualification_stage = 'qualified' where id = '${L2}';`);
    await as(U.coord);
    await rejects(() => fix(L2, { biz: 'Qualified Biz' }), /already a client/);
    await rejects(() => fix(L1, { email: 'not-an-email' }), /valid email/);
    await rejects(() => fix(L1, { ftype: 'unknown_type' }), /Unknown or inactive funding type/);
    await rejects(() => fix(L1, { amount: -1 }), /cannot be negative/);
    await rejects(() => fix(L1, { biz: 'Right Biz (Pty) Ltd' }), /Nothing to change/);
    await rejects(() => fix(L1, { cipc: '2020/222222/07' }), /duplicate key|unique/);
    await rejects(() => fix(L1, { biz: 'Again Biz' }, 'abc'), /at least 5 characters/);
  } finally {
    await db.close();
  }
});
