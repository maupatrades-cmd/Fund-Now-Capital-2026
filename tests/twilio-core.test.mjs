import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  buildVoiceAccessToken, computeTwilioSignature, dialTwiml, publicFunctionUrl, validateTwilioSignature,
} from '../supabase/functions/_shared/twilio-core.js';

// Calls inside the CRM (owner, 23 Nov 2026): the pure Twilio helpers used by the twilio-voice-* Edge Functions.
// Proves the request-signature check against Twilio's published example and that the access token is a correctly
// signed HS256 JWT with an outgoing-only Voice grant. It does NOT call Twilio.

const docParams = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
const docUrl = 'https://mycompany.com/myapp.php?foo=1&bar=2';

test("signature matches Twilio's documented example", async () => {
  assert.equal(await computeTwilioSignature('12345', docUrl, docParams), '0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  assert.equal(await validateTwilioSignature('12345', '0/KCTR6DLpKmkAf8muzZqo1nDgQ=', docUrl, docParams), true);
});

test('signature is refused when anything changes', async () => {
  const good = '0/KCTR6DLpKmkAf8muzZqo1nDgQ=';
  assert.equal(await validateTwilioSignature('wrong-token', good, docUrl, docParams), false);
  assert.equal(await validateTwilioSignature('12345', good, docUrl + '&x=1', docParams), false);
  assert.equal(await validateTwilioSignature('12345', good, docUrl, { ...docParams, To: '+27821234567' }), false);
  assert.equal(await validateTwilioSignature('12345', '', docUrl, docParams), false);
  assert.equal(await validateTwilioSignature('', good, docUrl, docParams), false);
});

test('access token is a signed HS256 JWT with an outgoing-only voice grant', async () => {
  const token = await buildVoiceAccessToken({
    accountSid: 'ACtest', apiKeySid: 'SKtest', apiKeySecret: 'secret', twimlAppSid: 'APtest',
    identity: '00000000-0000-0000-0000-000000000001', nowSeconds: 1_800_000_000,
  });
  const [h, p, s] = token.split('.');
  const decode = (x) => JSON.parse(Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  assert.deepEqual(decode(h), { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' });
  const payload = decode(p);
  assert.equal(payload.iss, 'SKtest');
  assert.equal(payload.sub, 'ACtest');
  assert.equal(payload.jti, 'SKtest-1800000000');
  assert.equal(payload.exp - payload.iat, 3600);
  assert.deepEqual(payload.grants, {
    identity: '00000000-0000-0000-0000-000000000001',
    voice: { incoming: { allow: false }, outgoing: { application_sid: 'APtest' } },
  });
  const expected = createHmac('sha256', 'secret').update(`${h}.${p}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(s, expected);
  await assert.rejects(() => buildVoiceAccessToken({ accountSid: 'AC', apiKeySid: 'SK', apiKeySecret: '', twimlAppSid: 'AP', identity: 'x' }));
});

test('dial TwiML never records and escapes values', () => {
  const xml = dialTwiml({ callerId: '+27100000000', e164: '+27821234567', statusUrl: 'https://x/s', actionUrl: 'https://x/s?kind=dial-action&a=1' });
  assert.match(xml, /record="do-not-record"/);
  assert.match(xml, /<Number [^>]*>\+27821234567<\/Number>/);
  assert.match(xml, /action="https:\/\/x\/s\?kind=dial-action&amp;a=1"/);
  assert.equal(publicFunctionUrl('https://p.supabase.co/', 'twilio-voice-twiml', '?a=1'), 'https://p.supabase.co/functions/v1/twilio-voice-twiml?a=1');
});
