import assert from 'node:assert/strict';
import test from 'node:test';
import { isConfiguredPlatformAdmin } from './services/platformAdminPolicy.js';

test('PLATFORM_ADMIN is granted only by the configured platform allowlist', () => {
  assert.equal(isConfiguredPlatformAdmin('  ADMIN@VYBE.COM ', 'owner@vybe.com, admin@vybe.com'), true);
  assert.equal(isConfiguredPlatformAdmin('community-owner@vybe.com', 'admin@vybe.com'), false);
  assert.equal(isConfiguredPlatformAdmin('admin@vybe.com', ''), false);
});
