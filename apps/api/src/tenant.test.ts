import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import type { Request, Response } from 'express';
import { requireSession, tenantScope, tenantSlugForHost } from './middleware/tenant.js';

test('production tenant is derived from the community hostname', () => {
  assert.equal(tenantSlugForHost('community.vybe.com.br', false), 'community');
  assert.equal(tenantSlugForHost('another.vybe.com.br', false), 'another');
  assert.equal(tenantSlugForHost('vybe.com.br', false), undefined);
  assert.equal(tenantSlugForHost('community.example.com', false), undefined);
});

test('development tenant comes from server configuration, not a request parameter', () => {
  assert.equal(tenantSlugForHost('localhost', true, 'community'), 'community');
  assert.equal(tenantSlugForHost('127.0.0.1', true, 'community'), 'community');
  assert.equal(tenantSlugForHost('localhost', true, 'different-community'), 'different-community');
});

test('tenant-scoped queries override any tenant identifier supplied in filters', () => {
  const tenantA = new mongoose.Types.ObjectId();
  const tenantB = new mongoose.Types.ObjectId();
  const query = tenantScope(tenantA, { tenantId: tenantB, postId: new mongoose.Types.ObjectId() });
  assert.ok(query.tenantId.equals(tenantA));
  assert.ok(!query.tenantId.equals(tenantB));
});

test('protected tenant routes reject requests without a tenant session', async () => {
  let statusCode = 0;
  let payload: unknown;
  let calledNext = false;
  const request = { headers: {}, vybeTenant: { _id: new mongoose.Types.ObjectId() } } as unknown as Request;
  const response = {
    status(code: number) { statusCode = code; return this; },
    json(body: unknown) { payload = body; return this; },
  } as unknown as Response;
  await requireSession(request, response, () => { calledNext = true; });
  assert.equal(statusCode, 401);
  assert.deepEqual(payload, { error: 'Sessão necessária.' });
  assert.equal(calledNext, false);
});

test('tenant session guard rejects platform requests without tenant context', async () => {
  let statusCode = 0;
  let calledNext = false;
  const request = { headers: {} } as Request;
  const response = { status(code: number) { statusCode = code; return this; }, json() { return this; } } as unknown as Response;
  await requireSession(request, response, () => { calledNext = true; });
  assert.equal(statusCode, 404);
  assert.equal(calledNext, false);
});
