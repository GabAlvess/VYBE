import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { tenantScope } from './middleware/tenant.js';
import { canPostChannel, canReadChannel } from './routes/chat.js';

test('channel and message filters always use the current tenant', () => {
  const currentTenant = new mongoose.Types.ObjectId();
  const suppliedTenant = new mongoose.Types.ObjectId();
  const filter = tenantScope(currentTenant, { tenantId: suppliedTenant, channelId: new mongoose.Types.ObjectId() });
  assert.equal(filter.tenantId, currentTenant);
});

test('private channels are hidden from regular members', () => {
  assert.equal(canReadChannel(true, false), false);
  assert.equal(canReadChannel(true, true), true);
  assert.equal(canReadChannel(false, false), true);
});

test('announcement and restricted posting require community staff', () => {
  assert.equal(canPostChannel('members', false), true);
  assert.equal(canPostChannel('staff', false), false);
  assert.equal(canPostChannel('restricted', false), false);
  assert.equal(canPostChannel('staff', true), true);
});
