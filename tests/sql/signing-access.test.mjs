import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const source = name => readFile(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8');
const signer = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';

test('signing RPCs enforce authenticated identity, consent, token lifecycle and all-signers completion', async () => {
  const db = new PGlite();
  try {
    // Minimal isolated schema, never production. SHA-256 uses PostgreSQL's real
    // implementation; the adapter supplies pgcrypto's signature for the RPC.
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema extensions; create schema storage;
      create table storage.objects(bucket_id text, name text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create function extensions.digest(bytea,text) returns bytea language sql immutable as $$ select sha256($1) $$;
      create type agreement_state as enum ('sent','viewed','in_progress','countersign_pending','executed','declined');
      create type signature_method as enum ('typed','drawn','uploaded','system_applied');
      create table agreement_instances(id uuid primary key default gen_random_uuid(), reference text default 'TEST', document_type text default 'nda', title_snapshot text default 'Test', state agreement_state default 'sent', sent_at timestamptz, unsigned_sha256 text, decline_reason text, template_version_id uuid, first_viewed_at timestamptz, signer_signed_at timestamptz, countersign_pending_at timestamptz);
      create table agreement_party_snapshots(id uuid primary key default gen_random_uuid(), agreement_id uuid, profile_id uuid, party_role text default 'signer', legal_name text default 'Synthetic signer', represented_party text, capacity text, is_fnc boolean default false, party_order integer default 1);
      create table signature_requests(id uuid primary key default gen_random_uuid(), agreement_id uuid, party_snapshot_id uuid, token_hash text unique, expires_at timestamptz default now()+interval '1 day', revoked_at timestamptz, consumed_at timestamptz, last_opened_at timestamptz, auth_method text);
      create table legal_document_templates(id uuid primary key default gen_random_uuid());
      create table legal_document_template_versions(id uuid primary key default gen_random_uuid(), template_id uuid, content_markdown text default 'Test agreement', content_sha256 text, version text default '1', effective_date date, source_storage_path text, source_filename text);
      create table agreement_variable_snapshots(agreement_id uuid, variables jsonb, fee_summary jsonb);
      create table consent_records(id uuid primary key default gen_random_uuid(), agreement_id uuid, party_snapshot_id uuid, consent_kind text, notice_version text, accepted boolean, ip_hash text, user_agent_hash text, unique(agreement_id,party_snapshot_id,consent_kind));
      create table signature_artifacts(id uuid primary key default gen_random_uuid(), agreement_id uuid, party_snapshot_id uuid, method signature_method, artifact_sha256 text, storage_path text, adopted_text text);
      create table signature_events(id uuid primary key default gen_random_uuid(), agreement_id uuid, event_type text, party_snapshot_id uuid, signature_method signature_method, ip_hash text, user_agent_hash text, detail jsonb, consent_text_version text);
      grant usage on schema public, auth to authenticated, anon;
    `);
    const original = await source('20260812090100_esign_evidence_backend_rpcs.sql');
    for (const name of ['open_signature_request', 'record_agreement_consent']) {
      const start = original.indexOf('create or replace function public.' + name + '(');
      assert.ok(start >= 0);
      await db.exec(original.slice(start, original.indexOf('end $$;', start) + 7));
      const signature = name === 'open_signature_request' ? '(text)' : '(text,text,text,boolean,text,text)';
      await db.exec(`revoke all on function public.${name}${signature} from public,anon; grant execute on function public.${name}${signature} to authenticated;`);
    }
    const migration = await source('20260816000000_signing_identity_binding.sql');
    await db.exec(migration.slice(0, migration.indexOf('-- Behavioural assertions')));
    await db.exec(await source('20260815193733_signing_packet_read.sql'));
    const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].value;
    const uid = async id => { await db.query("select set_config('test.uid',$1,false)", [id]); };
    const privileged = async fn => {
      await db.exec('reset role');
      try { return await fn(); } finally { await db.exec('set role authenticated'); }
    };
    let sequence = 0;
    const fixture = async (profile = signer, agreement = null) => privileged(async () => {
      if (!agreement) {
        const template = await scalar('insert into legal_document_templates default values returning id as value');
        const version = await scalar('insert into legal_document_template_versions(template_id) values ($1) returning id as value', [template]);
        agreement = await scalar('insert into agreement_instances(template_version_id) values ($1) returning id as value', [version]);
      }
      const party = await scalar('insert into agreement_party_snapshots(agreement_id,profile_id) values ($1,$2) returning id as value', [agreement, profile]);
      const token = (++sequence).toString(16).padStart(64, '0');
      await db.query("insert into signature_requests(agreement_id,party_snapshot_id,token_hash) values ($1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'))", [agreement, party, token]);
      return { agreement, party, token };
    });
    const read = token => scalar('select get_agreement_signing_package($1) as value', [token]);
    const sign = token => scalar("select submit_agreement_signature($1,'typed',null,null,'Synthetic signer') as value", [token]);
    const consent = (token, kind, accepted = true) => db.query("select record_agreement_consent($1,$2,'1',$3)", [token, kind, accepted]);
    const kinds = ['signer_identity','reviewed_document','intent_to_bind','electronic_delivery'];
    const accept = async token => { for (const kind of kinds) await consent(token, kind); };
    const first = await fixture();
    await uid(other);
    await assert.rejects(read(first.token), /belongs to another account/);
    await assert.rejects(sign(first.token), /belongs to another account/);
    await assert.rejects(consent(first.token, kinds[0]), /belongs to another account/);
    await assert.rejects(db.query('select open_signature_request($1)', [first.token]), /belongs to another account/);
    await assert.rejects(db.query('select open_signature_request_packet($1)', [first.token]), /belongs to another account/);
    await assert.rejects(db.query('select resolve_signature_request($1)', [first.token]), /permission denied/);
    await uid('');
    await assert.rejects(read(first.token), /Sign in/);
    await uid(signer);
    assert.equal((await read(first.token)).can_sign, true);
    const packet = await scalar('select open_signature_request_packet($1) as value', [first.token]);
    assert.equal(packet.state, 'viewed');
    for (const key of ['variables','fee_summary','other_parties','token_hash','storage_path']) assert.equal(Object.hasOwn(packet, key), false);
    await assert.rejects(sign(first.token), /acknowledgements/);
    await assert.rejects(read('bad-token'), /Invalid signing token/);
    await assert.rejects(read('f'.repeat(64)), /Signing link not found/);
    const expired = await fixture();
    await privileged(() => db.query("update signature_requests set expires_at=now()-interval '1 day' where party_snapshot_id=$1", [expired.party]));
    await assert.rejects(read(expired.token), /expired/);
    const revoked = await fixture();
    await privileged(() => db.query('update signature_requests set revoked_at=now() where party_snapshot_id=$1', [revoked.party]));
    await assert.rejects(sign(revoked.token), /revoked/);
    const declinedConsent = await fixture();
    await consent(declinedConsent.token, kinds[0], false);
    await accept(declinedConsent.token);
    await assert.rejects(sign(declinedConsent.token), /acknowledgements/);
    const second = await fixture(other, first.agreement);
    await accept(first.token);
    await assert.rejects(db.query("select submit_agreement_signature($1,'typed',null,null,'   ')", [first.token]), /name is required/);
    await assert.rejects(db.query("select submit_agreement_signature($1,'system_applied',null,null,'Name')", [first.token]), /Unsupported signer method/);
    await assert.rejects(db.query("select submit_agreement_signature($1,'uploaded',null,null,'Name')", [first.token]), /image and its fingerprint/);
    const invalidPath = `signature/${other}/${first.agreement}/00000000-0000-0000-0000-000000000099.png`;
    await assert.rejects(db.query("select submit_agreement_signature($1,'uploaded',$2,$3,'Name')", [first.token,'a'.repeat(64),invalidPath]), /does not belong/);
    const validPath = `signature/${signer}/${first.agreement}/00000000-0000-0000-0000-000000000099.png`;
    await assert.rejects(db.query("select submit_agreement_signature($1,'uploaded',$2,$3,'Name')", [first.token,'a'.repeat(64),validPath]), /image was not found/);
    assert.equal((await sign(first.token)).state, 'in_progress');
    await assert.rejects(sign(first.token), /already been used/);
    assert.equal((await read(first.token)).can_sign, false);
    await uid(other);
    await accept(second.token);
    assert.equal((await sign(second.token)).state, 'countersign_pending');
    const external = await fixture(null);
    await db.exec('set role anon');
    await assert.rejects(read(external.token), /permission denied/);
    await assert.rejects(sign(external.token), /permission denied/);
    await db.exec('set role authenticated');
    await uid(other);
    assert.equal((await read(external.token)).can_sign, true);
    await accept(external.token);
    assert.equal((await sign(external.token)).state, 'countersign_pending');
    // The current contract permits an authenticated holder for an unlinked
    // party, but NOT anonymous signing. This test does not broaden that policy.
    const artifacts = await privileged(() => scalar('select count(*)::integer as value from signature_artifacts'));
    assert.equal(artifacts, 3);
    const imageSigner = await fixture(other);
    await accept(imageSigner.token);
    // Match the browser helper's timestamp/random fallback as well as UUID names.
    const imagePath = `signature/${other}/${imageSigner.agreement}/1791378000000-abc123xyz.png`;
    await privileged(() => db.query("insert into storage.objects values ('legal-signature-artifacts',$1)", [imagePath]));
    const imageResult = await scalar("select submit_agreement_signature($1,'drawn',$2,$3,'Name') as value", [imageSigner.token,'b'.repeat(64),imagePath]);
    assert.equal(imageResult.state, 'countersign_pending');
  } finally { await db.close(); }
});
