import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { insertUnicodeText, VERIFICATION_PRICE_BRL } from '@vybe/shared';
import { canTransitionVerification, VerificationRequest } from './models/VerificationRequest.js';
import { tenantScope } from './middleware/tenant.js';

test('emoji/text insertion preserves surrounding Unicode and places the cursor after insertion', () => {
  const result = insertUnicodeText('Olá mundo', ' 💚', 4, 4);
  assert.deepEqual(result, { value: 'Olá  💚mundo', cursor: 7 });
  assert.equal(insertUnicodeText('A👩‍👩‍👧‍👦B', '✨', 1, 1).value, 'A✨👩‍👩‍👧‍👦B');
});

test('emoji insertion replaces only the selected range and clamps invalid cursor positions', () => {
  assert.deepEqual(insertUnicodeText('Bom dia!', '✨', 4, 7), { value: 'Bom ✨!', cursor: 5 });
  assert.deepEqual(insertUnicodeText('abc', '😂', 40, 40), { value: 'abc😂', cursor: 5 });
});

test('verification request keeps a single configured one-time BRL price', () => {
  assert.equal(VERIFICATION_PRICE_BRL, 29.9);
  const request = new VerificationRequest({ tenantId: new mongoose.Types.ObjectId(), characterId: new mongoose.Types.ObjectId(), accountId: new mongoose.Types.ObjectId(), adminCharacterId: new mongoose.Types.ObjectId() });
  assert.equal(request.amount, 29.9);
  assert.equal(request.currency, 'BRL');
  assert.equal(request.status, 'PENDING');
});

test('verification approval requires payment confirmation and only follows allowed states', () => {
  assert.equal(canTransitionVerification('PENDING', 'CONTACTED'), true);
  assert.equal(canTransitionVerification('CONTACTED', 'AWAITING_PAYMENT'), true);
  assert.equal(canTransitionVerification('AWAITING_PAYMENT', 'PAID'), true);
  assert.equal(canTransitionVerification('PAID', 'APPROVED'), true);
  assert.equal(canTransitionVerification('PENDING', 'APPROVED'), false);
  assert.equal(canTransitionVerification('APPROVED', 'PENDING'), false);
});

test('verification tenant scope always binds lookup to one community', () => {
  const tenant = new mongoose.Types.ObjectId();
  const query = tenantScope(tenant, { characterId: new mongoose.Types.ObjectId(), active: true });
  assert.equal(query.tenantId, tenant);
  assert.equal(query.active, true);
});
