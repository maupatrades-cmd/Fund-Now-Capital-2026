import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const migration = await readFile(new URL('../../supabase/migrations/20261010095939_commission_payment_route_guard.sql', import.meta.url), 'utf8');

// Minimal prerequisite tables: exercises the real route migration and triggers,
// not the complete invoice RPCs or multi-session PostgreSQL concurrency.
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create table public.deals(id uuid primary key default gen_random_uuid());
    create table public.commission_records(id uuid primary key default gen_random_uuid(), deal_id uuid not null references deals, status text not null, settled_at timestamptz);
    create table public.owner_commission_entries(id uuid primary key default gen_random_uuid(), deal_id uuid not null references deals, status text not null, paid_at timestamptz);
  `);
  return db;
}
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
const deal = async db => (await one(db, 'insert into deals default values returning id')).id;
const install = db => db.exec(`begin; ${migration} commit;`);

test('first paid ledger blocks the other route, preserves reversals and isolates deals', async () => {
  const db = await fixture();
  try {
    const a = await deal(db), b = await deal(db), c = await deal(db);
    // Existing reversed payments still count as payment history.
    await db.query("insert into commission_records(deal_id,status,settled_at) values ($1,'void',now())", [c]);
    await install(db);
    await db.query("insert into owner_commission_entries(deal_id,status,paid_at) values ($1,'paid',now())", [a]);
    // Multiple manual beneficiaries for the same deal are valid.
    await db.query("insert into owner_commission_entries(deal_id,status,paid_at) values ($1,'paid',now())", [a]);
    await db.query("insert into commission_records(deal_id,status) values ($1,'earned')", [a]);
    await assert.rejects(() => db.query("update commission_records set status='settled',settled_at=now() where deal_id=$1", [a]), /manual.*automatic.*blocked/);
    assert.equal((await one(db, 'select status from commission_records where deal_id=$1', [a])).status, 'earned');
    await db.query("insert into commission_records(deal_id,status,settled_at) values ($1,'settled',now())", [b]);
    const manual = (await one(db, "insert into owner_commission_entries(deal_id,status) values ($1,'approved') returning id", [b])).id;
    await assert.rejects(() => db.query("update owner_commission_entries set status='paid',paid_at=now() where id=$1", [manual]), /automatic.*manual.*blocked/);
    await db.query("update commission_records set status='void' where deal_id=$1", [b]);
    await assert.rejects(() => db.query("update owner_commission_entries set status='paid',paid_at=now() where id=$1", [manual]), /blocked/);
    await assert.rejects(() => db.query("insert into owner_commission_entries(deal_id,status,paid_at) values ($1,'paid',now())", [c]), /blocked/);
    assert.equal(Number((await one(db, 'select count(*) as n from commission_payment_routes')).n), 3);
    await assert.rejects(() => db.exec('delete from commission_payment_routes'), /permanent payment evidence/);
    await assert.rejects(() => db.exec("update commission_payment_routes set route='manual'"), /permanent payment evidence/);
    await db.exec('set role authenticated;');
    await assert.rejects(() => db.exec('select * from commission_payment_routes'), /permission denied/);
    await assert.rejects(() => db.exec('delete from commission_payment_routes'), /permission denied/);
    await assert.rejects(() => db.exec('select public.enforce_commission_payment_route()'), /permission denied/);
  } finally { await db.close(); }
});

test('ambiguous historical payments stop migration without leaving a partial install', async () => {
  const db = await fixture();
  try {
    const d = await deal(db);
    await db.query("insert into commission_records(deal_id,status,settled_at) values ($1,'settled',now())", [d]);
    await db.query("insert into owner_commission_entries(deal_id,status,paid_at) values ($1,'paid',now())", [d]);
    await assert.rejects(() => install(db), /Existing payments use both commission ledgers/);
    await db.exec('rollback;');
    assert.equal((await one(db, "select to_regclass('public.commission_payment_routes') as name")).name, null);
    assert.equal((await one(db, 'select status from owner_commission_entries')).status, 'paid');
  } finally { await db.close(); }
});

test('a failed transaction cannot reserve a route or leave an invoice marked paid', async () => {
  const db = await fixture();
  try {
    await install(db);
    const d = await deal(db);
    await db.exec('begin;');
    await db.query("insert into owner_commission_entries(deal_id,status,paid_at) values ($1,'paid',now())", [d]);
    await db.exec('rollback;');
    assert.equal(Number((await one(db, 'select count(*) as n from commission_payment_routes')).n), 0);
    await db.query("insert into commission_records(deal_id,status,settled_at) values ($1,'settled',now())", [d]);
    await db.exec("create table invoice_fixture(state text); insert into invoice_fixture values ('approved');");
    await db.exec("begin; update invoice_fixture set state='paid';");
    await assert.rejects(() => db.query("insert into owner_commission_entries(deal_id,status,paid_at) values ($1,'paid',now())", [d]), /blocked/);
    await db.exec('rollback;');
    assert.equal((await one(db, 'select state from invoice_fixture')).state, 'approved');
  } finally { await db.close(); }
});
