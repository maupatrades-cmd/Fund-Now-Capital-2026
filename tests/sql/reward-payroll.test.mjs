import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const owner = '00000000-0000-0000-0000-000000000001';
const beneficiary = '00000000-0000-0000-0000-000000000002';
const reward = '00000000-0000-0000-0000-000000000003';
test('payroll executes retries, carry-forward, payment guards and beneficiary privacy', async () => {
 const db = new PGlite();
 try {
 await db.exec([
 "create role anon; create role authenticated; create schema auth; create schema storage;",
 "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
 "create table public.profiles(id uuid primary key, full_name text, role text, sourced_via_partner_id uuid);",
 "create function public.is_owner() returns boolean language sql stable security definer as $$ select coalesce((select role='owner' from public.profiles where id=auth.uid()),false) $$;",
 "create table public.leads(id uuid primary key, referral_partner_id uuid);",
 "create table public.complete_document_reward_locks(id uuid primary key, deal_id uuid, lead_id uuid, beneficiary_profile_id uuid references public.profiles(id), beneficiary_role text, amount numeric(14,2), locked_at timestamptz default now(), cutoff_date date);",
 "create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);",
 "create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;",
 "grant usage on schema public,auth,storage to authenticated;",
 "grant select on public.profiles,public.complete_document_reward_locks to authenticated;",
 "insert into public.profiles values ('"+owner+"','Owner','owner',null), ('"+beneficiary+"','Beneficiary','contractor',null);",
 "insert into public.complete_document_reward_locks(id,beneficiary_profile_id,beneficiary_role,amount,cutoff_date) values ('"+reward+"','"+beneficiary+"','contractor',100,'2026-10-22');",
 "select set_config('request.jwt.claim.sub','"+owner+"',false);"
 ].join('\n'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261007161254_r100_reward_payroll_workspace.sql',import.meta.url),'utf8'));
 const scalar = async (sql, args=[]) => (await db.query(sql,args)).rows[0].value;
 const schedule = async (month,day=25) => scalar('select public.owner_schedule_qualified_reward_batch($1::date,$2::integer) as value',[month,day]);
 const action = async (type,key,reason='Owner private reason') => scalar('select public.owner_record_qualified_reward_action($1::uuid,$2,$3,$4) as value',[reward,type,reason,key]);
 const pay = async batch => scalar('select public.owner_mark_qualified_reward_batch_paid($1::uuid,$2,$3) as value',[batch,'EFT-TEST','rewards/'+batch+'/proof.pdf']);
 const proof = async batch => db.query('insert into storage.objects(bucket_id,name) values ($1,$2)',['qualified-reward-proofs','rewards/'+batch+'/proof.pdf']);
 const october = await schedule('2026-10-01');
 assert.equal(october.scheduled_count,1);
 assert.equal((await schedule('2026-10-01')).scheduled_count,0);
 assert.equal((await schedule('2026-10-01',30)).scheduled_count,0);
 const held = await action('held','hold-1');
 assert.equal(await action('held','hold-1'),held);
 await assert.rejects(action('released','hold-1'),/Idempotency key/);
 await action('released','release-1');
 await action('carried_forward','carry-1');
 assert.equal((await schedule('2026-10-01',30)).scheduled_count,0);
 const november = await schedule('2026-11-01');
 assert.equal(november.scheduled_count,1);
 await assert.rejects(pay(october.batch_id),/Upload proof/);
 await proof(october.batch_id);
 await assert.rejects(pay(october.batch_id), /no payable rewards/);
 assert.equal(await scalar("select status as value from qualified_reward_payout_batches where id=$1", [october.batch_id]), "scheduled");
 assert.equal(await scalar("select count(*)::int as value from qualified_reward_payout_events where event_type='paid'"),0);
 assert.equal((await schedule('2026-10-01')).scheduled_count,0);
 await proof(november.batch_id);
 await action('held','hold-2');
 await assert.rejects(pay(november.batch_id), /no payable rewards/);
 await action('released','release-2');
 assert.equal((await pay(november.batch_id)).paid_count,1);
 assert.equal((await pay(november.batch_id)).already_paid,true);
 await assert.rejects(action('carried_forward','carry-paid'),/current state/);
 await assert.rejects(schedule('2026-11-01'),/Only a scheduled batch/);
 await assert.rejects(db.exec("update qualified_reward_payout_events set reason='changed'"),/append-only/);
 await db.exec("set role authenticated; select set_config('request.jwt.claim.sub','"+beneficiary+"',false);");
 assert.equal((await db.query('select * from qualified_reward_payout_events')).rows.length,0);
 const workspace = (await db.query('select * from qualified_reward_workspace()')).rows;
 assert.equal(workspace.length,1);
 assert.equal(workspace[0].current_status,'paid');
 assert.equal(workspace[0].batch_id,november.batch_id);
 assert.equal(workspace[0].proof_storage_path,null);
 await assert.rejects(schedule('2026-12-01'),/Only the owner/);
 await db.exec("reset role; select set_config('request.jwt.claim.sub','"+owner+"',false);");
 const reversed = await action('reversed','reverse-1');
 assert.equal(await action('reversed','reverse-1'),reversed);
 await assert.rejects(action('held','hold-reversed'),/current state/);
 const empty = await schedule('2026-12-01');
 assert.equal(empty.scheduled_count,0);
 await proof(empty.batch_id);
 await assert.rejects(pay(empty.batch_id), /no payable rewards/);
 assert.equal(await scalar("select max(id::text)::uuid as value from (values ('00000000-0000-0000-0000-000000000001'::uuid)) fixture(id)"),owner);
 } finally { await db.close(); }
});
