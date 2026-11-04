import assert from 'node:assert/strict';
import test from 'node:test';
import { requiresJoinApproval } from './routes/communityEntryPolicy.js';
import { VybeAccount } from './models/VybeAccount.js';
import { Account, Character } from './models/Social.js';

test('VYBE account identity is global while community accounts and profiles remain tenant-scoped', () => {
  assert.equal(VybeAccount.schema.path('tenantId'), undefined);
  assert.ok(Account.schema.path('tenantId'));
  assert.ok(Account.schema.path('globalAccountId'));
  assert.ok(Character.schema.path('tenantId'));
});

test('public communities allow immediate entry even when a legacy approval flag remains', () => {
  assert.equal(requiresJoinApproval({ entry: 'open', settings: { access: { visibility: 'public', approvalRequired: false } } }), false);
  assert.equal(requiresJoinApproval({ entry: 'approval', settings: { access: { visibility: 'public', approvalRequired: true } } }), false);
});

test('private and controlled communities require an approved application', () => {
  assert.equal(requiresJoinApproval({ entry: 'open', settings: { access: { visibility: 'private', approvalRequired: false } } }), true);
  assert.equal(requiresJoinApproval({ entry: 'open', settings: { access: { visibility: 'controlled', approvalRequired: false } } }), true);
  assert.equal(requiresJoinApproval({ entry: 'approval', settings: { access: { visibility: 'public', approvalRequired: false } } }), false);
  assert.equal(requiresJoinApproval({ entry: 'approval' }), true);
});
