import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const migration = await readFile(new URL('../../supabase/migrations/20261017210010_restricted_commission_notice_snapshots.sql', import.meta.url), 'utf8');
const sourceLedger = await readFile(new URL('../../supabase/migrations/20261007095000_owner_commission_editor.sql', import.meta.url), 'utf8');
const ledgerFunction = name => {
  const start = sourceLedger.indexOf(`create or replace function public.${name}(`);
  const end = sourceLedger.indexOf('$$;', start) + 3;
  assert.ok(start >= 0 && end > start, `actual ledger function ${name} exists`);
  return sourceLedger.slice(start, end);
};

test('approved allocation snapshots expose only Rands and safe identity to active authorised staff', async () => {
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const as = async uid => db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid ?? ''}',false); set role authenticated;`);
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated;
      create table profiles(id uuid primary key, role text, is_active boolean default true, full_name text);
      create table staff_access(profile_id uuid,staff_role text,access_enabled boolean);
      create table clients(id uuid primary key,business_name text);
      create table deals(id uuid primary key,reference text,client_id uuid,gross_commission numeric);
      create table referral_partners(id uuid primary key,name text);
      create table owner_commission_entries(id uuid primary key,deal_id uuid,status text,currency text,
        beneficiary_kind text,beneficiary_profile_id uuid,beneficiary_organisation_id uuid,amount numeric(14,2));
      create table owner_commission_adjustments(id bigint primary key,entry_id uuid,delta numeric(14,2));
      create table owner_commission_flags(entry_id uuid,status text);
      create table owner_commission_deal_totals(deal_id uuid,total_amount numeric(14,2),currency text);
      create table audit(event_type text);
      create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$
        select exists(select 1 from public.profiles where id=auth.uid() and role='owner' and is_active is true) $$;
      create function staff_audit_write(text,uuid,text,text,jsonb) returns void language sql as $$ insert into public.audit values ($3) $$;
      insert into profiles(id,role,full_name) values
        ('${id(1)}','owner','Owner'),('${id(2)}','coordinator','Coordinator'),('${id(3)}','administrator','Admin'),
        ('${id(4)}','partner','Partner'),('${id(5)}','switchboard','Reception'),('${id(6)}','client','Client'),
        ('${id(7)}','coordinator','Disabled'),('${id(8)}','coordinator','Not enabled'),('${id(9)}','administrator','Mismatched');
      update profiles set is_active=false where id='${id(7)}';
      insert into staff_access values ('${id(2)}','coordinator',true),('${id(3)}','administrator',true),
        ('${id(5)}','switchboard',true),('${id(7)}','coordinator',true),('${id(8)}','coordinator',false),('${id(9)}','coordinator',true);
      insert into clients values ('${id(20)}','Client business');
      insert into deals values ('${id(21)}','FNC-001','${id(20)}',999999);
      insert into owner_commission_entries values ('${id(22)}','${id(21)}','approved','ZAR','agent','${id(4)}',null,100);
      insert into owner_commission_deal_totals values ('${id(21)}',100,'ZAR');
      alter default privileges in schema public grant all on tables to authenticated;
    `);
    for (const name of ['owner_commission_require_owner','owner_commission_effective','owner_commission_reconciliation']) {
      await db.exec(ledgerFunction(name));
    }
    await db.exec(migration);
    for (const uid of [null,id(4),id(5),id(6),id(7),id(8),id(9),id(99)]) {
      await as(uid);
      await assert.rejects(q('select * from staff_commission_notices_for_deal($1)',[id(21)]), /access required/);
      await assert.rejects(q('select * from staff_commission_notice($1)',[id(22)]), /access required/);
      await assert.rejects(q('select owner_issue_commission_notice($1,100)',[id(22)]), /Only an active Owner/);
    }
    await as(id(1));
    for (const amount of ['99','100.001','NaN',null]) {
      await assert.rejects(q('select owner_issue_commission_notice($1,$2)',[id(22),amount]), /amount changed/);
    }
    for (const invalidTotal of ["update owner_commission_deal_totals set total_amount=99",
      "update owner_commission_deal_totals set total_amount=100,currency='USD'",
      'delete from owner_commission_deal_totals']) {
      await db.exec(`reset role; ${invalidTotal};`);
      await as(id(1));
      await assert.rejects(q('select owner_issue_commission_notice($1,100)',[id(22)]),/Reconcile/);
    }
    await db.exec(`reset role;
      insert into owner_commission_deal_totals values('${id(21)}',100,'ZAR');
      insert into owner_commission_entries values('${id(23)}','${id(21)}','draft','ZAR','agent','${id(4)}',null,0);
    `);
    await as(id(1));
    await assert.rejects(q('select owner_issue_commission_notice($1,100)',[id(22)]),/Reconcile/,'even a zero-value draft requires approval');
    await db.exec(`reset role;
      delete from owner_commission_entries where id='${id(23)}';
      insert into deals values('${id(31)}','FNC-OTHER','${id(20)}',999999);
      insert into owner_commission_entries values('${id(32)}','${id(31)}','approved','ZAR','agent','${id(4)}',null,50);
      insert into owner_commission_flags values('${id(32)}','open');
    `);
    await as(id(1));
    const notice = (await q('select owner_issue_commission_notice($1,100) as id',[id(22)]))[0].id;
    assert.ok(notice,'an open flag on another deal does not block issuance');
    assert.equal((await q('select owner_issue_commission_notice($1,100) as id',[id(22)]))[0].id,notice,'retry uses same notice');
    const expectedKeys = ['beneficiary_kind','beneficiary_name','beneficiary_organisation_id','beneficiary_profile_id',
      'client_name','commission_amount','commission_notice_id','currency','deal_reference','is_current','issued_at'];
    for (const uid of [id(1),id(2),id(3)]) {
      await as(uid);
      const [row] = await q('select * from staff_commission_notice($1)',[notice]);
      assert.deepEqual(Object.keys(row).sort(),expectedKeys.sort());
      assert.equal(row.commission_amount,'100.00'); assert.equal(row.client_name,'Client business'); assert.equal(row.is_current,true);
      assert.equal((await q('select * from staff_commission_notices_for_deal($1)',[id(21)])).length,1);
      await assert.rejects(q('select * from commission_notice_snapshots'),/permission denied/);
      if (uid !== id(1)) await assert.rejects(q('select owner_issue_commission_notice($1,100)',[id(22)]),/Only an active Owner/);
    }
    await db.exec(`reset role; insert into owner_commission_adjustments values(1,'${id(22)}',20);`);
    await as(id(1));
    await assert.rejects(q('select owner_issue_commission_notice($1,120)',[id(22)]),/Reconcile/,
      'actual ledger reconciliation rejects an adjustment that exceeds the stated total');
    await as(id(2));
    let [old] = await q('select * from staff_commission_notice($1)',[notice]);
    assert.equal(old.commission_amount,'100.00'); assert.equal(old.is_current,false);
    await db.exec(`reset role; insert into owner_commission_adjustments values(2,'${id(22)}',-20);`);
    await as(id(2));
    assert.equal((await q('select * from staff_commission_notice($1)',[notice]))[0].is_current,false,
      'restoring the old amount cannot revive an old revision');
    await db.exec(`reset role; insert into owner_commission_adjustments values(3,'${id(22)}',20);`);
    await as(id(1));
    await db.exec(`reset role; update owner_commission_deal_totals set total_amount=120;`);
    await as(id(1));
    const next = (await q('select owner_issue_commission_notice($1,120) as id',[id(22)]))[0].id;
    assert.notEqual(next,notice);
    await db.exec(`reset role; insert into owner_commission_flags values('${id(22)}','open');`);
    await as(id(1));
    await assert.rejects(q('select owner_issue_commission_notice($1,120)',[id(22)]),/Reconcile/);
    assert.equal((await q('select * from staff_commission_notice($1)',[next]))[0].is_current,false);
    await db.exec(`reset role; delete from owner_commission_flags; update owner_commission_entries set status='paid';`);
    await as(id(1));
    assert.equal((await q('select * from staff_commission_notice($1)',[next]))[0].is_current,true,
      'payment preserves the historical approved allocation notice, without exposing payment data');
    await assert.rejects(q('select owner_issue_commission_notice($1,120)',[id(22)]),/approved ZAR/);
    await db.exec('reset role;');
    for (const sql of ['update commission_notice_snapshots set commission_amount=1','delete from commission_notice_snapshots','truncate commission_notice_snapshots']) {
      await assert.rejects(q(sql),/immutable/);
    }
    assert.equal((await q('select * from audit')).length,2);
    await as(id(3));
    await db.exec(`reset role; update staff_access set access_enabled=false where profile_id='${id(3)}';`);
    await as(id(3));
    await assert.rejects(q('select * from staff_commission_notice($1)',[next]),/access required/);
  } finally { await db.close(); }
});
