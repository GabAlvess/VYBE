import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { Community } from './models/Community.js';
import { VybeNotification } from './models/VybeNotification.js';
import { buildNewCommunityFromRequest, buildOwnerRecords, SYSTEM_COMMUNITY_DEFAULTS } from './services/communityProvisioning.js';

test('nova comunidade usa somente os dados propostos e defaults globais', () => {
  const first = new Community(buildNewCommunityFromRequest({
    rpgName: 'Lumen Santé', slug: 'lumen-sante', description: 'Hospital e comunidade acadêmica', photoFilename: 'a'.repeat(32) + '.webp',
  }));
  const second = new Community(buildNewCommunityFromRequest({
    rpgName: 'Bellmont', slug: 'bellmont', description: 'Universidade Bellmont', photoFilename: 'b'.repeat(32) + '.png',
  }));

  assert.equal(first.name, 'Lumen Santé');
  assert.equal(first.description, 'Hospital e comunidade acadêmica');
  assert.equal(first.coverUrl, `/media/lumen-sante/${'a'.repeat(32)}.webp`);
  assert.equal(first.logoUrl, '');
  assert.equal(first.wallpaperUrl, '');
  assert.equal(first.memberCount, 1);
  assert.deepEqual(first.admins, []);
  assert.deepEqual(first.moderators, []);
  assert.deepEqual(first.rules, []);
  assert.equal(first.ownerAccountId, undefined);
  assert.equal(first.settings?.characters?.minimumAge, 18);
  assert.equal(first.settings?.access?.visibility, 'public');
  assert.equal(first.settings?.features?.feed, true);
  for (const contentCollection of ['posts', 'stories', 'messages', 'groups', 'events', 'news', 'disciplines', 'teachers', 'students', 'jobs', 'applications', 'wallets', 'transactions', 'notifications', 'matches', 'likes', 'auditLogs']) {
    assert.equal(Object.hasOwn(first.toObject(), contentCollection), false, `${contentCollection} must not be copied into the tenant document`);
  }
  assert.notEqual(first.settings, second.settings);
  assert.notEqual(first.brand, second.brand);
  assert.deepEqual(first.brand?.toObject(), SYSTEM_COMMUNITY_DEFAULTS.brand);
  assert.deepEqual(first.settings?.characters?.customFields, []);
});

test('Owner recebe registros locais novos em cada tenant, mantendo somente a conta global compartilhada', () => {
  const globalAccountId = new mongoose.Types.ObjectId();
  const firstTenantId = new mongoose.Types.ObjectId();
  const secondTenantId = new mongoose.Types.ObjectId();
  const firstOwnerId = new mongoose.Types.ObjectId();
  const secondOwnerId = new mongoose.Types.ObjectId();
  const first = buildOwnerRecords({ tenantId: firstTenantId, accountId: firstOwnerId, globalAccountId, email: 'owner@example.com', passwordHash: 'hash', displayName: 'Ana', username: 'ana' });
  const second = buildOwnerRecords({ tenantId: secondTenantId, accountId: secondOwnerId, globalAccountId, email: 'owner@example.com', passwordHash: 'hash', displayName: 'Ana', username: 'ana' });

  assert(first.account.tenantId.equals(firstTenantId));
  assert(first.character.tenantId.equals(firstTenantId));
  assert(first.character.accountId.equals(firstOwnerId));
  assert.notEqual(first.account._id.toString(), second.account._id.toString());
  assert.notEqual(first.character.accountId.toString(), second.character.accountId.toString());
  assert(first.account.globalAccountId?.equals(second.account.globalAccountId!));
  assert.equal(first.character.bio, '');
  assert.equal(first.character.avatarUrl, '');
});

test('notificação de aprovação de comunidade pode existir sem solicitação de entrada', () => {
  const notification = new VybeNotification({
    accountId: new mongoose.Types.ObjectId(), communityId: new mongoose.Types.ObjectId(),
    communityRequestId: new mongoose.Types.ObjectId(), type: 'community_creation_update',
    status: 'APPROVED', message: 'Comunidade aprovada.',
  });
  assert.equal(notification.validateSync(), undefined);
});
