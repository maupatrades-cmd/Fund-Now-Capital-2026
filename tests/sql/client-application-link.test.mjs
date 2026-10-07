import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');

test('application relationships isolate two deals and preserve submitted identities', async () => {
 const db = new PGlite();
 try {
  await db.exec(`create schema auth;
   create function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
   create table profiles(id uuid primary key); create table clients(id uuid primary key);
   create table deals(id uuid primary key, client_id uuid references clients);
   insert into profiles values (auth.uid());
   insert into clients values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
   insert into deals values ('00000000-0000-0000-0000-000000000011',auth.uid()), ('00000000-0000-0000-0000-000000000012',auth.uid()), ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000002');`);
  const sql = await readFile(new URL('../../supabase/migrations/20260810041542_client_canonical_form_answers.sql', import.meta.url),'utf8');
  await db.exec(sql.slice(sql.indexOf('create table public.client_form_responses'),sql.indexOf('create table public.client_form_answers')));
  const start = sql.indexOf('create or replace function public.validate_client_form_response_relationships()');
  await db.exec(sql.slice(start,sql.indexOf('revoke execute',start)));
  await db.exec('create trigger validate before insert or update on client_form_responses for each row execute function validate_client_form_response_relationships()');
  const insert = async deal => (await db.query("insert into client_form_responses(client_id,deal_id,product_code,requested_amount) values(auth.uid(),$1,'working_capital',5000) returning id",[deal])).rows[0].id;
  const first = await insert('00000000-0000-0000-0000-000000000011');
  const second = await insert('00000000-0000-0000-0000-000000000012');
  const unlinked = await insert(null);
  await assert.rejects(insert('00000000-0000-0000-0000-000000000013'),/does not belong/);
  const forDeal = (await db.query("select id from client_form_responses where client_id=auth.uid() and product_code='working_capital' and deal_id=$1 and status<>'superseded'",['00000000-0000-0000-0000-000000000011'])).rows;
  assert.deepEqual(forDeal.map(row=>row.id),[first]);
  assert.notEqual(first,second);
  assert.deepEqual((await db.query('select id from client_form_responses where deal_id is null')).rows.map(row=>row.id),[unlinked]);
  await assert.rejects(db.query('update client_form_responses set deal_id=$1 where id=$2',['00000000-0000-0000-0000-000000000011',unlinked]),/identity are immutable/);
  await db.query("update client_form_responses set status='submitted' where id=$1",[first]);
  await assert.rejects(db.query('update client_form_responses set requested_amount=6000 where id=$1',[first]),/forms are immutable/);
 } finally { await db.close(); }
});

test('client form binds inserts, draft lookup, cache and navigation to selected deal', async () => {
 const page=await readFile(new URL('../../src/pages/client/ClientApplicationPage.tsx',import.meta.url),'utf8');
 assert.match(page,/deal_id: selectedDealId/);
 assert.match(page,/selectedDealId \? query\.eq\("deal_id", selectedDealId\) : query\.is\("deal_id", null\)/);
 assert.match(page,/"client-application-draft", identity\.data\?\.clientId, selectedProduct, selectedDealId/);
 assert.match(page,/new URLSearchParams\(current\)/);
 assert.match(page,/\.neq\("status", "superseded"\)/);
 assert.match(page,/applicationDealBlocked\(selectedDealId/);
 assert.match(page,/await applications\.refetch\(\)/);
 const owner=await readFile(new URL('../../src/components/deals/DealDocumentRequirements.tsx',import.meta.url),'utf8');
 assert.match(owner,/\.eq\("deal_id", dealId\)/);
 assert.doesNotMatch(owner,/productDraft \?\?.*unlinkedChoices/);
});


test('application selection resumes the correct product and requires ambiguous choices', async () => {
 const { resolveApplicationChoice, applicationDealBlocked } = await import('../../src/lib/clientApplicationChoice.ts');
 const invoice = { id: 'invoice', product_code: 'invoice_discounting', status: 'draft' };
 const capital = { id: 'capital', product_code: 'working_capital', status: 'submitted' };
 assert.equal(resolveApplicationChoice([invoice],null,null,false).response.id,'invoice');
 assert.equal(resolveApplicationChoice([invoice,capital],null,null,false).needsChoice,true);
 assert.equal(resolveApplicationChoice([invoice,capital],'capital',null,false).response.id,'capital');
 assert.equal(resolveApplicationChoice([invoice],null,'working_capital',false).needsChoice,true);
 assert.equal(resolveApplicationChoice([invoice],null,'working_capital',true).needsChoice,false);
 assert.equal(resolveApplicationChoice([invoice],'foreign',null,false).needsChoice,true);
 assert.equal(resolveApplicationChoice([invoice,{...invoice,id:'invoice2'}],null,'invoice_discounting',false).needsChoice,true);
 assert.equal(applicationDealBlocked(null,undefined,true,true),false);
 assert.equal(applicationDealBlocked('done',[{dealId:'done',isComplete:true}],false,false),true);
 assert.equal(applicationDealBlocked('open',[{dealId:'open',isComplete:false}],false,false),false);
 assert.equal(applicationDealBlocked('open',undefined,false,true),true);
});


test('explicit repeat requests never reuse old responses and leave new mode after saving', async () => {
 const { resolveApplicationChoice } = await import('../../src/lib/clientApplicationChoice.ts');
 const old = { id:'old',product_code:'working_capital',status:'submitted' };
 for (const rows of [[old],[old,{...old,id:'second',status:'draft'}]]) {
   assert.deepEqual(resolveApplicationChoice(rows,null,'working_capital',true),{ response:undefined, needsChoice:false });
 }
 assert.equal(resolveApplicationChoice([old],'old','working_capital',false).response.id,'old');
 const page=await readFile(new URL('../../src/pages/client/ClientApplicationPage.tsx',import.meta.url),'utf8');
 assert.match(page,/if \(startNew\) return null/);
 assert.match(page,/next\.set\("response", responseId!\); next\.delete\("new"\)/);
 assert.match(page,/changeProduct\(event\.target\.value, true\)/);
 assert.doesNotMatch(page,/filter\(item => !responseChoices/);
});
