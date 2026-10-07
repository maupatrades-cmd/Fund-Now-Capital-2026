import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Owner-only manual commission editor. Isolated PostgreSQL (PGlite) with a
// synthetic prerequisite schema; proves the database rules, not the live schema.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), coordinator: id(2), switchboard: id(3), partner: id(4), agent: id(5), leader: id(6) };
const mig = (n) => readFile(new URL(`../../supabase/migrations/${n}`, import.meta.url), 'utf8');

test('commission is entered, reconciled, approved, adjusted and paid only by the Owner', async () => {
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0];
  const as = async (uid) => { await db.exec('reset role;'); if (uid) await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`); };
  const rejects = (fn, re, code) => assert.rejects(fn, (e) => { assert.match(e.message, re); if (code) assert.equal(e.code, code); return true; });
  try {
    await db.exec([
      'create role anon; create role authenticated; create schema auth;',
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
      "create type public.user_role as enum ('owner','partner','contractor','client','lead_referrer');",
      'create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;',
      "create function public.current_sast_date() returns date language sql stable as $$ select (now() at time zone 'Africa/Johannesburg')::date $$;",
      "create table public.referral_partners(id uuid primary key default gen_random_uuid(), name text not null unique, contact_email text, contact_phone text, is_active boolean not null default true, notes text, created_at timestamptz default now(), updated_at timestamptz default now());",
      "create table public.profiles(id uuid primary key, email text, full_name text, role public.user_role not null default 'partner', referral_partner_id uuid, sourced_via_partner_id uuid, is_active boolean not null default true);",
      "create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) $$;",
      'create table public.deals(id uuid primary key default gen_random_uuid());',
      'grant usage on schema public, auth to authenticated;',
      "insert into public.referral_partners(id,name) values ('" + id(101) + "','Org One');",
    ].join('\n'));
    await db.exec(await mig('20261007090000_staff_roles_enum.sql'));
    const p = (uid, role, partner = null) => `insert into public.profiles(id,full_name,role,referral_partner_id) values ('${uid}','${role}','${role}',${partner ? `'${partner}'` : 'null'});`;
    await db.exec([p(U.owner, 'owner'), p(U.coordinator, 'coordinator'), p(U.switchboard, 'switchboard'), p(U.partner, 'partner', id(101)),
      `insert into public.profiles(id,full_name,role,sourced_via_partner_id) values ('${U.agent}','agent','lead_referrer','${id(101)}'),('${U.leader}','leader','lead_referrer','${id(101)}');`].join('\n'));
    await db.exec('alter default privileges in schema public grant all on tables to authenticated;');
    for (const f of ['20261007091000_staff_access_and_audit.sql', '20261007092000_organisation_team_structure.sql', '20261007095000_owner_commission_editor.sql']) await db.exec(await mig(f));
    const deal = (await one('insert into public.deals default values returning id')).id;
    const deal2 = (await one('insert into public.deals default values returning id')).id;
    const save = (over = {}) => {
      const a = { entry: null, deal, kind: 'agent', profile: U.agent, org: null, name: null, ccy: 'ZAR', amount: 600, basis: 'Owner decision', pct: null, reason: null, ...over };
      return one('select public.owner_save_commission_entry($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as id', [a.entry, a.deal, a.kind, a.profile, a.org, a.name, a.ccy, a.amount, a.basis, a.pct, a.reason]).then((r) => r.id);
    };

    // Staff and other roles: nothing at all.
    for (const uid of [U.coordinator, U.switchboard, U.partner, U.agent]) {
      await as(uid);
      await rejects(() => q("select public.owner_set_commission_total($1,'ZAR',1000)", [deal]), /Only the owner/, '42501');
      await rejects(() => save(), /Only the owner/, '42501');
      assert.equal((await q('select 1 from public.owner_commission_entries')).length, 0);
      await rejects(() => db.query("insert into public.owner_commission_entries(deal_id,beneficiary_kind,beneficiary_name,amount,entered_by) values ($1,'external_payee','x',1,$2)", [deal, uid]), /permission denied/);
    }

    await as(U.owner);
    await q("select public.owner_set_commission_total($1,'ZAR',1000,'Owner states total')", [deal]);
    const a = await save();
    await rejects(() => save(), /duplicate key|unique/, '23505'); // no duplicate allocation
    const b = await save({ kind: 'external_payee', profile: null, name: 'Walk-in payee', amount: 300 });
    let r = (await one('select public.owner_commission_reconciliation($1) as r', [deal])).r;
    assert.equal(Number(r.difference), 100);
    assert.equal(r.reconciled, false);
    await rejects(() => q('select public.owner_approve_commission_entries($1)', [deal]), /do not reconcile/);
    await rejects(() => save({ entry: b, kind: 'external_payee', profile: null, name: 'Walk-in payee', amount: 400 }), /reason of at least 10/);
    await save({ entry: b, kind: 'external_payee', profile: null, name: 'Walk-in payee', amount: 400, reason: 'Owner corrected the payee amount' });
    await rejects(() => save({ kind: 'agent', profile: U.partner, deal: deal2 }), /active partner or lead-referrer/);
    const flag = (await one("select public.owner_flag_commission_entry($1,'agreement_conflict','Differs from the written band; owner to review') as id", [a])).id;
    await rejects(() => q('select public.owner_approve_commission_entries($1)', [deal]), /open commission flags/);
    await q("select public.owner_resolve_commission_flag($1,'Owner reviewed the agreement and accepts')", [flag]);

    // Automatic jobs cannot change status or amounts by direct writes.
    await as(null);
    await rejects(() => db.query("update public.owner_commission_entries set status='approved', approved_at=now() where id=$1", [a]), /only through the Owner commission RPCs/);
    await as(U.owner);
    const ok = (await one('select public.owner_approve_commission_entries($1) as r', [deal])).r;
    assert.equal(ok.approved, 2);
    await rejects(() => save({ entry: a, reason: 'Trying to rewrite approved history' }), /Only a draft entry can be edited/);
    await as(null);
    await rejects(() => db.query('update public.owner_commission_entries set amount=1 where id=$1', [a]), /is history/);
    await rejects(() => db.query('delete from public.owner_commission_entries where id=$1', [a]), /never deleted/);
    await as(U.owner);
    await rejects(() => q("select public.owner_set_commission_total($1,'ZAR',2000)", [deal]), /cannot change once an entry is approved/);

    // Approval is not payment; payment needs a reference.
    await rejects(() => q("select public.owner_mark_commission_entry_paid($1,'')", [a]), /payment reference/);
    await q("select public.owner_mark_commission_entry_paid($1,'EFT-0001')", [a]);
    await rejects(() => q("select public.owner_mark_commission_entry_paid($1,'EFT-0002')", [a]), /Only an approved entry/);

    // Corrections are append-only adjustments; history stays.
    await rejects(() => q("select public.owner_adjust_commission_entry($1,-50,'short')", [a]), /adjustments_reason_ck|violates/);
    const adj = (await one("select public.owner_adjust_commission_entry($1,-50,'Owner corrected after review') as r", [a])).r;
    assert.equal(Number(adj.effective_amount), 550);
    assert.equal(Number((await one('select amount from public.owner_commission_entries where id=$1', [a])).amount), 600, 'original amount preserved');
    r = (await one('select public.owner_commission_reconciliation($1) as r', [deal])).r;
    assert.equal(Number(r.difference), 50, 'adjustment is reported as a difference for the Owner, not auto-fixed');
    await as(null);
    await rejects(() => db.query("update public.owner_commission_adjustments set reason='x'"), /append-only/);
    await rejects(() => db.query('delete from public.owner_commission_adjustments'), /append-only/);

    // Draft void keeps the row; every action is in the audit ledger.
    await as(U.owner);
    const c = await save({ deal: deal2, kind: 'organisation', profile: null, org: id(101), amount: 10 });
    await q("select public.owner_void_commission_entry($1,'Entered against the wrong deal')", [c]);
    assert.equal((await one('select status from public.owner_commission_entries where id=$1', [c])).status, 'void');
    const events = (await q("select event_type from public.staff_audit_events where entity_type='owner_commission_entry'")).map((e) => e.event_type);
    for (const t of ['commission_total_set', 'commission_entry_created', 'commission_entry_amended', 'commission_flag_raised',
      'commission_flag_acknowledged', 'commission_entries_approved', 'commission_entry_paid', 'commission_entry_adjusted', 'commission_entry_voided']) {
      assert.ok(events.includes(t), `audit has ${t}`);
    }
  } finally { await db.close(); }
});
