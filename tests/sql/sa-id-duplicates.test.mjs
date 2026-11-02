import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// SA ID duplicates (owner, 30 Oct 2026): runs the 20261102120000 migration against an isolated PostgreSQL (PGlite)
// on a minimal stand-in of the leads / clients / qualify schema, switching real database roles with auth.uid()
// claims. It proves the ID normalisation, the open-lead block (Director vs agent wording), the client block through
// the primary director, the CIPC-clear check, find_lead_duplicates' sa_id rows (never the ID) and qualify_lead's
// SA ID re-point. It does NOT prove the live schema or the screens.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), partner: id(2) };
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

// A Luhn-valid 13-digit SA ID from a 12-digit stem.
const saId = (stem) => {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let n = Number(stem[i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return stem + String((10 - (sum % 10)) % 10);
};

test('SA ID duplicates: no-CIPC leads and clients are blocked on the ID number', async () => {
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0];
  const as = async (uid) => {
    await db.exec('reset role;');
    if (uid) await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  };
  const rejects = async (fn, pattern) => {
    await assert.rejects(fn, (e) => { assert.match(e.message, pattern); assert.equal(e.code, '23505'); return true; });
  };
  const X = saId('800101500908');
  const Y = saId('750505012345');
  const xSpaced = `${X.slice(0, 6)} ${X.slice(6, 10)} ${X.slice(10)}`;
  const xBadLuhn = X.slice(0, 12) + String((Number(X.slice(-1)) + 1) % 10);

  try {
    await db.exec([
      'create role anon; create role authenticated; create schema auth; create schema extensions;',
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
      'create function extensions.similarity(a text, b text) returns real language sql immutable as $$ select case when a = b then 1.0::real else 0.0::real end $$;',
      "create type public.user_role as enum ('owner','partner');",
      "create type public.lead_qualification_stage as enum ('new_lead','under_qualification','qualified','not_qualified');",
      "create type public.stakeholder_role as enum ('signatory','director');",
      "create table public.profiles(id uuid primary key, email text, role public.user_role not null);",
      "create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) $$;",
      "create table public.leads(id uuid primary key default gen_random_uuid(), business_name text not null, contact_name text, contact_email text, contact_cell text, contact_role text, contact_id_number text, cipc_number text, industry_id uuid, sub_industry_id uuid, sector_notes text, physical_address text, referral_partner_id uuid, funding_amount numeric(14,2), funding_purpose jsonb default '[]', funding_timeline text, qualification_stage public.lead_qualification_stage not null default 'new_lead', created_at timestamptz default now());",
      'create table public.clients(id uuid primary key default gen_random_uuid(), business_name text not null, cipc_number text, industry_id uuid, sub_industry_id uuid, sector_notes text, address text, referral_partner_id uuid, created_by uuid, created_at timestamptz not null default now());',
      'create table public.client_contacts(id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id), full_name text not null, email text, phone text, position text, id_number text, is_primary_director boolean not null default false);',
      "create sequence deal_ref; create table public.deals(id uuid primary key default gen_random_uuid(), client_id uuid, lead_id uuid, referral_partner_id uuid, stage text, amount_requested numeric(14,2), funding_purpose jsonb, funding_timeline text, created_by uuid, reference text default 'DEAL-' || nextval('deal_ref'));",
      'create table public.documents(id uuid primary key default gen_random_uuid(), lead_id uuid, client_id uuid);',
      'create table public.client_stakeholders(id uuid primary key default gen_random_uuid(), lead_id uuid, client_id uuid, full_name text, id_type text, id_number text, roles public.stakeholder_role[], cell text, email text, created_by uuid);',
      'create table public.client_stories(id uuid primary key default gen_random_uuid(), lead_id uuid, client_id uuid, business_story text, founder_background text, business_origin text, competitive_edge text, aspirations text, contact_story text, family_context text, personal_interests text, language_preference text, communication_style text, assets_narrative text, initial_assessment text, concerns_flagged text, opportunities_seen text);',
      'create table public.client_story_notes(id uuid primary key default gen_random_uuid(), story_id uuid, text text, author_id uuid);',
      'create table public.activity_logs(id uuid primary key default gen_random_uuid(), occurred_at timestamptz, user_id uuid, user_email text, user_role text, event_type text, entity_type text, entity_id uuid, description text, after_values jsonb, related_entity_ids jsonb);',
      "create function public.lead_required_docs_missing(p uuid) returns text[] language sql stable as $$ select '{}'::text[] $$;",
      'create function public.log_qualification_override(p uuid, m text[]) returns void language sql as $$ select $$;',
      'grant usage on schema public, auth, extensions to authenticated;',
      'grant select, insert, update on public.leads, public.clients, public.client_contacts to authenticated;',
    ].join('\n'));
    await db.exec(`insert into public.profiles values ('${U.owner}','owner@example.test','owner'), ('${U.partner}','partner@example.test','partner');`);
    await db.exec(await mig('20261102120000_sa_id_duplicates.sql'));

    // 1. Normalisation: digits only, 13, Luhn.
    assert.equal((await one('select public.sa_id_normalise($1) v', [xSpaced])).v, X);
    assert.equal((await one('select public.sa_id_normalise($1) v', [xBadLuhn])).v, null);
    assert.equal((await one("select public.sa_id_normalise('12345') v")).v, null);
    assert.equal((await one('select public.sa_id_normalise(null) v')).v, null);

    // 2. Open no-CIPC lead blocks a second one with the same ID, however it is typed.
    await as(U.owner);
    const a = (await one(`insert into public.leads(business_name, contact_name, contact_id_number) values ('Thandi Spaza','Thandi',$1) returning id`, [X])).id;
    await rejects(() => q(`insert into public.leads(business_name, contact_name, contact_id_number) values ('Thandi Trading','Thandi',$1)`, [xSpaced]),
      /A lead already exists for this ID number — Thandi Spaza/);
    // An agent gets the neutral message: no business name, never the ID.
    await as(U.partner);
    await assert.rejects(() => q(`insert into public.leads(business_name, contact_name, contact_id_number) values ('Other','T',$1)`, [X]), (e) => {
      assert.match(e.message, /already been submitted to Fund Now Capital/);
      assert.doesNotMatch(e.message, /Thandi Spaza/);
      assert.ok(!e.message.includes(X));
      return true;
    });
    await as(U.owner);
    // A company lead (CIPC set) with the same director ID is fine; so is a bad-Luhn number.
    await q(`insert into public.leads(business_name, contact_name, contact_id_number, cipc_number) values ('Thandi Holdings','Thandi',$1,'2020/123456/07')`, [X]);
    await q(`insert into public.leads(business_name, contact_name, contact_id_number) values ('Typo Ltd','T',$1)`, [xBadLuhn]);
    // Clearing the CIPC of that company lead makes it a duplicate.
    await rejects(() => q(`update public.leads set cipc_number = null where business_name = 'Thandi Holdings'`), /ID number/);

    // 3. find_lead_duplicates: sa_id block row, never the ID itself.
    const dups = await q('select * from public.find_lead_duplicates($1, null, null, null, null, $2)', ['New Name', xSpaced]);
    const block = dups.find((d) => d.match_kind === 'sa_id');
    assert.equal(block.severity, 'block');
    assert.equal(block.entity_id, a);
    assert.ok(!JSON.stringify(dups).includes(X));
    // With a CIPC on the new lead the ID is not used.
    assert.equal((await q("select * from public.find_lead_duplicates('New Name', '2021/1/07', null, null, null, $1) where match_kind = 'sa_id'", [X])).length, 0);

    // 4. A closed lead no longer blocks; reopening it does.
    await q(`update public.leads set qualification_stage = 'not_qualified' where id = $1`, [a]);
    const b = (await one(`insert into public.leads(business_name, contact_name, contact_id_number) values ('Thandi Spaza 2','Thandi',$1) returning id`, [X])).id;
    await rejects(() => q(`update public.leads set qualification_stage = 'new_lead' where id = $1`, [a]), /ID number/);

    // 5. qualify_lead: new client carries the ID on its primary director; a later lead re-points onto it by SA ID.
    const r1 = (await one('select public.qualify_lead($1) r', [b])).r;
    assert.equal(r1.matched_existing, false);
    const clientX = r1.client_id;
    const c = (await one(`insert into public.leads(business_name, contact_name, contact_id_number) values ('Thandi Catering','Thandi',$1) returning id`, [X])).id;
    const warn = (await q('select * from public.find_lead_duplicates($1, null, null, null, $2, $3)', ['Thandi Catering', c, X]))
      .find((d) => d.match_kind === 'sa_id');
    assert.deepEqual([warn.severity, warn.entity, warn.entity_id], ['warn', 'client', clientX]);
    const r2 = (await one('select public.qualify_lead($1) r', [c])).r;
    assert.equal(r2.match_kind, 'sa_id');
    assert.equal(r2.client_id, clientX);
    assert.equal((await one('select count(*)::int n from public.clients')).n, 1);
    await as(null);
    const log = await one("select description, after_values from public.activity_logs where event_type = 'QUALIFIED_ONTO_EXISTING_CLIENT'");
    assert.match(log.description, /sa_id match/);
    assert.ok(!JSON.stringify(log).includes(X));
    await as(U.owner);

    // 6. Clients: a second no-CIPC client cannot take the same primary director ID.
    const d = (await one("insert into public.clients(business_name) values ('Thandi Again') returning id")).id;
    await rejects(() => q('insert into public.client_contacts(client_id, full_name, id_number, is_primary_director) values ($1,$2,$3,true)', [d, 'Thandi', xSpaced]),
      /A client already exists for this ID number — Thandi Spaza 2/);
    // Not the primary director → allowed; promoting them is then blocked.
    const cc = (await one('insert into public.client_contacts(client_id, full_name, id_number, is_primary_director) values ($1,$2,$3,false) returning id', [d, 'Thandi', X])).id;
    await rejects(() => q('update public.client_contacts set is_primary_director = true where id = $1', [cc]), /ID number/);
    // A different person is fine.
    await q('insert into public.client_contacts(client_id, full_name, id_number, is_primary_director) values ($1,$2,$3,true)', [d, 'Sipho', Y]);
    // A company client with the same director is fine until its CIPC is removed.
    const e = (await one("insert into public.clients(business_name, cipc_number) values ('Thandi Pty', '2019/555555/07') returning id")).id;
    await q('insert into public.client_contacts(client_id, full_name, id_number, is_primary_director) values ($1,$2,$3,true)', [e, 'Thandi', X]);
    await rejects(() => q('update public.clients set cipc_number = null where id = $1', [e]), /same ID number as Thandi Spaza 2/);

    // 7. Internal helpers are closed to signed-in users.
    await assert.rejects(() => q('select public.client_by_sa_id($1)', [X]), /permission denied/);
  } finally {
    await db.close();
  }
});
