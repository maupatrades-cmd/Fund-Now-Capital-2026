import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSignal, isForMe, shouldOffer, formatDuration, mediaErrorText, callTopic, roomTopic } from '../src/lib/meet/signal.ts';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-000000000002';

test('signal messages from other browsers are validated', () => {
  assert.deepEqual(parseSignal({ kind: 'ready', from: A }), { kind: 'ready', from: A, to: null });
  assert.equal(parseSignal({ kind: 'offer', from: A, sdp: { type: 'offer', sdp: 'v=0' } })?.sdp?.type, 'offer');
  assert.equal(parseSignal({ kind: 'offer', from: A, sdp: { type: 'answer', sdp: 'v=0' } }), null, 'type must match kind');
  assert.equal(parseSignal({ kind: 'offer', from: A }), null, 'an offer needs an sdp');
  assert.equal(parseSignal({ kind: 'ice', from: A, candidate: null })?.candidate, null);
  assert.equal(parseSignal({ kind: 'ice', from: A, candidate: { candidate: 'x'.repeat(3000) } }), null);
  assert.equal(parseSignal({ kind: 'nope', from: A }), null);
  assert.equal(parseSignal({ kind: 'ready', from: 'not-a-uuid' }), null);
  assert.equal(parseSignal({ kind: 'ready', from: A, to: 'x' }), null);
  assert.equal(parseSignal('string'), null);
  assert.equal(parseSignal({ kind: 'media', from: A, media: { audio: true, video: false, screen: 'no' } }), null);
  assert.deepEqual(parseSignal({ kind: 'media', from: A, media: { audio: true, video: false, screen: true } })?.media,
    { audio: true, video: false, screen: true });
});

test('routing, offer order, durations, topics and error text', () => {
  assert.equal(isForMe({ kind: 'ready', from: A, to: null }, B), true);
  assert.equal(isForMe({ kind: 'ready', from: A, to: A }, B), false);
  assert.equal(isForMe({ kind: 'ready', from: B, to: null }, B), false, 'never my own message');
  assert.equal(shouldOffer(A, B), true);
  assert.equal(shouldOffer(B, A), false);
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(192), '3:12');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(null), '');
  assert.match(mediaErrorText({ name: 'NotAllowedError' }), /blocked/);
  assert.match(mediaErrorText({ name: 'NotReadableError' }), /in use/);
  assert.equal(callTopic(A), `meet:call:${A}`);
  assert.equal(roomTopic(B), `meet:room:${B}`);
});
