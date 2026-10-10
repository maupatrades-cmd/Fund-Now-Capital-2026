import assert from 'node:assert/strict';
import test from 'node:test';
import { checklistVerificationStatus } from '../src/lib/documents.ts';

test('only current, active, unexpired documents retain their verification', () => {
  const today = new Date(2026, 9, 7, 16, 30);
  const accepted = { is_current_version: true, status: 'active', verification_status: 'accepted', expiry_date: null };
  const state = patch => checklistVerificationStatus({ ...accepted, ...patch }, today);
  assert.equal(state({}), 'accepted');
  assert.equal(state({ expiry_date: '2026-10-07' }), 'accepted');
  assert.equal(state({ expiry_date: '2026-10-06' }), 'rejected');
  assert.equal(state({ status: 'expired' }), 'rejected');
  assert.equal(state({ status: 'rejected' }), 'rejected');
  assert.equal(state({ status: 'archived' }), undefined);
  assert.equal(state({ is_current_version: false }), undefined);
  assert.equal(state({ verification_status: 'unverified' }), 'unverified');
  assert.equal(checklistVerificationStatus(undefined, today), undefined);
});
