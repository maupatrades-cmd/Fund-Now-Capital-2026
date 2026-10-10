import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const sqlFile = name => readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8');
test('real commission writer supports Path A, Path B, refresh and immutable settled evidence', async () => {
 const db = new PGlite();
 try {
 await db.exec([
 "create role anon; create role authenticated;",
 "create table profiles(id uuid primary key,sourced_via_partner_id uuid);",
 "create table leads(id uuid primary key,sourced_by_lead_refer_id uuid);",
 "create table deals(id uuid primary key,lead_id uuid,referral_partner_id uuid);",
 "create table commission_records(id uuid primary key default gen_random_uuid(),deal_id uuid,referral_partner_id uuid,owner_share numeric(14,2),partner_share numeric(14,2),status text);",
 "create function is_owner() returns boolean language sql as $$select current_setting('test.owner',true)='true'$$;",
 "create type lead_referrer_commission_state as enum('earned','settled','void');",
 "create table lead_referrer_commission_records(id uuid primary key default gen_random_uuid(),deal_id uuid,lead_refer_id uuid,doctor_partner_id uuid not null,commission_record_id uuid,doctor_earning numeric(14,2),owner_share_snapshot numeric(14,2),tier int,tier_pct numeric(10,4),lr_earning numeric(14,2),owner_net_after_lr numeric(14,2),closed_deal_count int,status lead_referrer_commission_state,earned_at timestamptz,updated_at timestamptz,notes text);",
 "create unique index lrc_deal_lr on lead_referrer_commission_records(deal_id,lead_refer_id) where status <> 'void';",
 "select set_config('test.owner','true',false);"
 ].join('\n'));
 const base = await sqlFile('20260810240000_lead_referrer_commission_engine.sql');
 for(const name of ['lead_referrer_tier','lead_referrer_tier_pct','calculate_lead_referrer_earning']) {
  const start = base.indexOf('create or replace function public.'+name+'(');
  const end = base.indexOf('$$;',start)+3;
  assert.ok(start>=0 && end>start);
  await db.exec(base.slice(start,end));
 }
 const migration = await sqlFile('20261007161245_lead_referrer_path_a_support.sql');
 await db.exec(migration.slice(0,migration.indexOf('-- Assertions')));
 const scalar = async (sql,args=[]) => (await db.query(sql,args)).rows[0].value;
 for(const channel of ['A','B']) {
  const lr=await scalar('select gen_random_uuid() as value');
  const deal=await scalar('select gen_random_uuid() as value');
  const lead=await scalar('select gen_random_uuid() as value');
  const partner=channel==='B'?await scalar('select gen_random_uuid() as value'):null;
  await db.query('insert into profiles values ($1,$2)',[lr,partner]);
  await db.query('insert into leads values ($1,$2)',[lead,lr]);
  await db.query('insert into deals values ($1,$2,$3)',[deal,lead,partner]);
  await db.query("insert into commission_records(deal_id,referral_partner_id,owner_share,partner_share,status) values ($1,$2,$3,$4,'earned')",[deal,partner,channel==='A'?60000:42000,channel==='A'?0:18000]);
  const write = () => scalar('select write_lead_referrer_commission($1,$2) as value',[deal,lr]);
  const first = await write();
  assert.equal(first.path,channel);
  assert.equal(first.lr_earning,channel==='A'?15000:4500);
  assert.equal((await write()).was_created,false);
  await db.query("insert into commission_records(deal_id,referral_partner_id,owner_share,partner_share,status) values ($1,$2,6000,$3,'earned')",[deal,partner,channel==='A'?0:2000]);
  assert.equal((await write()).was_refreshed,true);
  const before=(await db.query('select * from lead_referrer_commission_records where deal_id=$1',[deal])).rows[0];
  await db.query("update lead_referrer_commission_records set status='settled' where deal_id=$1",[deal]);
  await db.query('update commission_records set owner_share=owner_share+1000 where deal_id=$1',[deal]);
  assert.equal((await write()).reason,'already_settled');
  const after=(await db.query('select * from lead_referrer_commission_records where deal_id=$1',[deal])).rows[0];
  assert.equal(after.lr_earning,before.lr_earning);
  assert.equal(after.owner_share_snapshot,before.owner_share_snapshot);
 }
 await db.exec("select set_config('test.owner','false',false)");
 await assert.rejects(db.exec('select write_lead_referrer_commission(gen_random_uuid(),gen_random_uuid())'),/Only the owner/);
 } finally { await db.close(); }
});
