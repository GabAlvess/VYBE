import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { Comment, Notification, Post, Repost } from './models/Social.js';
import { tenantScope } from './middleware/tenant.js';
import { EchoAppProfile } from './models/EchoAppProfile.js';

test('Echo keeps legacy post kind while preserving tenant boundaries', () => {
  const tenant = new mongoose.Types.ObjectId();
  const filter = tenantScope(tenant, { kind: 'pulse', characterId: new mongoose.Types.ObjectId() });
  assert.equal(filter.tenantId, tenant);
  assert.equal(filter.kind, 'pulse');
  assert.deepEqual(Post.schema.path('kind').options.enum, ['post', 'pulse']);
});

test('reposts are unique per community, post and identity', () => {
  const indexes = Repost.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.tenantId === 1 && keys.postId === 1 && keys.characterId === 1 && options.unique === true));
});

test('Echo replies can form threads and have dedicated notification types', () => {
  assert.ok(Comment.schema.path('replyToCommentId'));
  const types = Notification.schema.path('type').options.enum as string[];
  assert.ok(types.includes('echo_like'));
  assert.ok(types.includes('echo_reply'));
  assert.ok(types.includes('repost'));
});

test('perfil do Echo tem personalização separada e unicidade por comunidade e identidade', () => {
  const unique = EchoAppProfile.schema.indexes().some(([keys, options]) =>
    Boolean(options?.unique) && keys.tenantId === 1 && keys.characterId === 1);
  assert.equal(unique, true);
  const profile = new EchoAppProfile({ tenantId: new mongoose.Types.ObjectId(), characterId: new mongoose.Types.ObjectId(), displayName: 'Echo name', bio: 'Echo bio', avatarUrl: '/media/community/photo.png' });
  assert.equal(profile.validateSync(), undefined);
});
