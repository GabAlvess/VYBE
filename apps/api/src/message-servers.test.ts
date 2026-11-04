import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MessageServer, MessageServerCategory, MessageServerChannel, MessageServerMember, MessageServerMessage, MessageServerPost, MessageServerPostReply } from './models/MessageServer.js';
import { allMessageServerPermissions, MessageServerAudit, MessageServerBan, MessageServerConfig, MessageServerCustomRole, MessageServerInvite, MessageServerRestriction } from './models/MessageServerAdmin.js';
import { canAccessMessageServer, canAccessMessageServerPrivateChannel, canGrantMessageServerPermissions, canManageMessageServer, canManageMessageServerCustomRole, canManageMessageServerHierarchy, canReorderMessageServerRoles, messageServerTopRolePosition, reorderedMessageServerRolePositions, validMessageServerColor, validMessageServerName, validMessageServerTag } from './routes/messageServerPolicy.js';

const id = () => new mongoose.Types.ObjectId();

test('message servers have separate IDs and isolated collections for all server data', () => {
  const tenantId = id(); const serverId = id(); const ownerAccountId = id(); const profileId = id(); const categoryId = id(); const channelId = id();
  const server = new MessageServer({ tenantId, ownerAccountId, ownerProfileId: profileId, name: 'Clube VYBE', privacy: 'private' });
  const member = new MessageServerMember({ tenantId, serverId, accountId: ownerAccountId, profileId, role: 'owner' });
  const category = new MessageServerCategory({ tenantId, serverId, name: 'Comunidade', createdByAccountId: ownerAccountId });
  const channel = new MessageServerChannel({ tenantId, serverId, categoryId, name: 'geral', createdByAccountId: ownerAccountId });
  const message = new MessageServerMessage({ tenantId, serverId, channelId, authorAccountId: ownerAccountId, authorProfileId: profileId, authorName: 'Gabriela', authorUsername: 'gabriela', content: 'Olá' });
  for (const document of [server, member, category, channel, message]) assert.equal(document.validateSync(), undefined);
  assert.notEqual(server._id.toString(), tenantId.toString());
  assert.equal(MessageServer.collection.collectionName, 'message_servers');
  assert.equal(MessageServerMember.collection.collectionName, 'message_server_members');
  assert.equal(MessageServerCategory.collection.collectionName, 'message_server_categories');
  assert.equal(MessageServerChannel.collection.collectionName, 'message_server_channels');
  assert.equal(MessageServerMessage.collection.collectionName, 'message_server_messages');
});

test('only server owners and explicitly authorized admins can manage server channels', () => {
  assert.equal(canManageMessageServer('owner'), true);
  assert.equal(canManageMessageServer('admin'), true);
  assert.equal(canManageMessageServer('member'), false);
  assert.equal(canManageMessageServer(undefined), false);
});

test('private server access requires membership in the current community context', () => {
  assert.equal(canAccessMessageServer('tenant-a', 'tenant-a', 'account-a', 'account-a'), true);
  assert.equal(canAccessMessageServer('tenant-a', 'tenant-b', 'account-a', 'account-a'), false);
  assert.equal(canAccessMessageServer('tenant-a', 'tenant-a', 'account-b', 'account-a'), false);
});

test('server creation accepts only a real name and privacy is private-only', () => {
  assert.equal(validMessageServerName('My server'), true);
  assert.equal(validMessageServerName('a'), false);
  assert.equal(validMessageServerName('x'.repeat(61)), false);
  assert.equal(validMessageServerName(undefined), false);
  assert.deepEqual(MessageServer.schema.path('privacy')?.options.enum, ['private']);
});

test('server administration data uses isolated server-scoped collections', () => {
  const tenantId = id(); const serverId = id(); const actorId = id();
  const config = new MessageServerConfig({ tenantId, serverId, tag: 'LUMN', tagColor: '#246B6E' });
  const role = new MessageServerCustomRole({ tenantId, serverId, name: 'Equipe', color: '#17494B', permissions: ['manage_invites'], createdByAccountId: actorId });
  const invite = new MessageServerInvite({ tenantId, serverId, tokenHash: 'a'.repeat(64), createdByAccountId: actorId });
  const ban = new MessageServerBan({ tenantId, serverId, accountId: id(), profileId: id(), reason: 'Motivo válido', moderatorAccountId: actorId });
  const restriction = new MessageServerRestriction({ tenantId, serverId, accountId: id(), profileId: id(), reason: 'Motivo válido', moderatorAccountId: actorId, mutedUntil: new Date(Date.now() + 60_000) });
  const audit = new MessageServerAudit({ tenantId, serverId, actorAccountId: actorId, action: 'role.created', details: { name: 'Equipe' } });
  for (const document of [config, role, invite, ban, restriction, audit]) assert.equal(document.validateSync(), undefined);
  assert.equal(MessageServerConfig.collection.collectionName, 'message_server_configs');
  assert.equal(MessageServerCustomRole.collection.collectionName, 'message_server_roles');
  assert.equal(MessageServerInvite.collection.collectionName, 'message_server_invites');
  assert.equal(MessageServerBan.collection.collectionName, 'message_server_bans');
  assert.equal(MessageServerRestriction.collection.collectionName, 'message_server_restrictions');
  assert.equal(MessageServerAudit.collection.collectionName, 'message_server_audit');
  assert.equal(MessageServerConfig.schema.indexes().some(([keys, options]) => (keys as Record<string, number>).tenantId === 1 && (keys as Record<string, number>).serverId === 1 && options?.unique === true), true);
});

test('space preferences have safe defaults, remain server-scoped, and support idempotent welcome messages', () => {
  const tenantId = id(); const serverA = id(); const serverB = id();
  const configA = new MessageServerConfig({ tenantId, serverId: serverA });
  const configB = new MessageServerConfig({ tenantId, serverId: serverB });
  assert.equal(configA.validateSync(), undefined);
  assert.equal(configB.validateSync(), undefined);
  assert.equal(configA.welcomeEnabled, false);
  assert.equal(configA.startChannelMode, 'last');
  assert.equal(configA.defaultNotifications, 'mentions');
  assert.equal(configA.groupMembersByRole, false);
  assert.equal(configA.showRoleColors, true);
  assert.equal(configA.antiSpamEnabled, false);
  assert.notEqual(configA.serverId.toString(), configB.serverId.toString());
  assert.equal(MessageServerMessage.schema.indexes().some(([keys, options]) => (keys as Record<string, number>).systemEventKey === 1 && options?.unique === true && Boolean(options?.partialFilterExpression)), true);
});

test('members can retain personal notification defaults and last channel without changing the space config', () => {
  const member = new MessageServerMember({ tenantId: id(), serverId: id(), accountId: id(), profileId: id(), role: 'member', notificationPreference: 'muted', lastChannelId: id() });
  assert.equal(member.validateSync(), undefined);
  assert.equal(member.notificationPreference, 'muted');
  assert.ok(member.lastChannelId);
});

test('publication channels, posts, replies, attachments and pins are persisted per channel', () => {
  const tenantId=id();const serverId=id();const channelId=id();const authorAccountId=id();const authorProfileId=id();const categoryId=id();
  const channel=new MessageServerChannel({tenantId,serverId,categoryId,name:'informativos',kind:'posts',posting:'staff',repliesEnabled:true,permissionOverrides:[{permission:'create_posts',state:'deny'},{roleId:id(),permission:'create_posts',state:'allow'}],createdByAccountId:authorAccountId});
  const post=new MessageServerPost({tenantId,serverId,channelId,authorAccountId,authorProfileId,authorName:'Ana',title:'Calendário',content:'Datas importantes',pinnedAt:new Date(),pinnedByAccountId:authorAccountId,cover:{url:'/media/test/message-file.png',name:'capa.png',mimeType:'image/png',size:120}});
  const reply=new MessageServerPostReply({tenantId,serverId,channelId,postId:post._id,authorAccountId,authorProfileId,authorName:'Ana',content:'Entendido'});
  for(const model of [channel,post,reply])assert.equal(model.validateSync(),undefined);
  assert.equal(channel.kind,'posts');assert.equal(channel.repliesEnabled,true);assert.equal(channel.permissionOverrides?.length,2);assert.equal(post.pinnedByAccountId?.toString(),authorAccountId.toString());assert.equal(reply.postId.toString(),post._id.toString());
  assert.equal(MessageServerPost.collection.collectionName,'message_server_posts');assert.equal(MessageServerPostReply.collection.collectionName,'message_server_post_replies');
  assert.ok(MessageServerPost.schema.indexes().some(([keys])=>(keys as Record<string,number>).channelId===1));
  assert.ok(MessageServerPostReply.schema.indexes().some(([keys])=>(keys as Record<string,number>).postId===1));
});

test('server tags, colors, and role hierarchy have strict validation', () => {
  assert.equal(validMessageServerTag('LUMN'), true);
  assert.equal(validMessageServerTag('A'), false);
  assert.equal(validMessageServerTag('LUMN1'), false);
  assert.equal(validMessageServerTag('LU!'), false);
  assert.equal(validMessageServerTag(''), true);
  assert.equal(validMessageServerColor('#8D86C9'), true);
  assert.equal(validMessageServerColor('#8D86C'), false);
  assert.equal(canManageMessageServerHierarchy('owner', 0, 'admin', 500), true);
  assert.equal(canManageMessageServerHierarchy('admin', 500, 'member', 499), true);
  assert.equal(canManageMessageServerHierarchy('member', 40, 'member', 40), false);
  assert.equal(canManageMessageServerHierarchy('member', 40, 'member', 41), false);
  assert.equal(canManageMessageServerHierarchy('owner', 1000, 'owner', 1000), false);
  assert.equal(canManageMessageServerHierarchy('admin', 500, 'admin', 500), false);
});

test('owner remains above every custom role and can reorder the full server hierarchy', () => {
  const roles = [{ id: 'senior', position: 30 }, { id: 'moderator', position: 20 }, { id: 'junior', position: 10 }];
  assert.equal(messageServerTopRolePosition('owner', roles.map((role) => role.position)), Number.MAX_SAFE_INTEGER);
  assert.equal(canManageMessageServerHierarchy('owner', Number.MAX_SAFE_INTEGER, 'owner', Number.MAX_SAFE_INTEGER), false);
  assert.equal(canManageMessageServerHierarchy('owner', Number.MAX_SAFE_INTEGER, 'member', 999), true);
  assert.equal(canReorderMessageServerRoles('owner', Number.MAX_SAFE_INTEGER, roles, ['junior', 'senior', 'moderator']), true);
  assert.deepEqual([...reorderedMessageServerRolePositions('owner', Number.MAX_SAFE_INTEGER, roles, ['junior', 'senior', 'moderator'])!], [['junior', 3], ['senior', 2], ['moderator', 1]]);
});

test('the highest of several assigned roles determines a member rank', () => {
  assert.equal(messageServerTopRolePosition('member', [5, 20, 12]), 20);
  assert.equal(canManageMessageServerHierarchy('member', 20, 'member', 12), true);
  assert.equal(canManageMessageServerHierarchy('member', 20, 'member', 20), false);
  assert.equal(canManageMessageServerHierarchy('member', 20, 'member', 21), false);
});

test('moderators can reorder only lower roles and cannot cross or displace equal and higher roles', () => {
  const roles = [{ id: 'senior', position: 30 }, { id: 'actor', position: 20 }, { id: 'moderator', position: 10 }, { id: 'junior', position: 5 }];
  assert.equal(canReorderMessageServerRoles('member', 20, roles, ['senior', 'actor', 'junior', 'moderator']), true);
  assert.deepEqual([...reorderedMessageServerRolePositions('member', 20, roles, ['senior', 'actor', 'junior', 'moderator'])!], [['senior', 30], ['actor', 20], ['junior', 10], ['moderator', 5]]);
  assert.equal(canReorderMessageServerRoles('member', 20, roles, ['actor', 'senior', 'moderator', 'junior']), false);
  assert.equal(canReorderMessageServerRoles('member', 20, roles, ['senior', 'moderator', 'actor', 'junior']), false);
  assert.equal(canReorderMessageServerRoles('member', 20, roles, ['senior', 'actor', 'junior', 'junior']), false);
});

test('rank alone does not grant permissions and delegated role managers cannot elevate privileges', () => {
  assert.equal(canManageMessageServerCustomRole('member', 20, 10), true);
  assert.equal(canManageMessageServerCustomRole('member', 20, 20), false);
  assert.equal(canGrantMessageServerPermissions('member', ['kick_members'], ['kick_members']), true);
  assert.equal(canGrantMessageServerPermissions('member', ['kick_members'], ['kick_members', 'ban_members']), false);
  assert.equal(canGrantMessageServerPermissions('owner', [], ['ban_members']), true);
});

test('server role permission catalog is complete, persisted, and rejects unknown permissions', () => {
  const required = ['manage_server','create_channels','edit_channels','manage_categories','manage_roles','manage_invites','view_audit','manage_nicknames','kick_members','ban_members','restrict_members','revoke_restrictions','view_channels','send_messages','send_images','send_gifs','attach_files','react','manage_messages','pin_messages','create_posts','reply_posts','manage_posts','pin_posts','mention_roles','connect_voice','speak','mute_members','disconnect_members','manage_voice_permissions','manage_voice_channels'];
  for (const permission of required) assert.ok(allMessageServerPermissions.includes(permission as typeof allMessageServerPermissions[number]));
  const role = new MessageServerCustomRole({ tenantId: id(), serverId: id(), name: 'Equipe', createdByAccountId: id(), permissions: ['manage_categories','revoke_restrictions','send_images'] });
  assert.equal(role.validateSync(), undefined);
  assert.ok(role.permissions.includes('manage_categories'));
  const invalid = new MessageServerCustomRole({ tenantId: id(), serverId: id(), name: 'Equipe inválida', createdByAccountId: id(), permissions: ['grant_everything'] });
  assert.ok(invalid.validateSync()?.errors.permissions);
});

test('private channel access stays role-specific unless a built-in administrator grants access', () => {
  assert.equal(canAccessMessageServerPrivateChannel('member', ['medical'], ['medical']), true);
  assert.equal(canAccessMessageServerPrivateChannel('member', ['general'], ['medical']), false);
  assert.equal(canAccessMessageServerPrivateChannel('member', ['general'], ['medical'], true), true);
  assert.equal(canAccessMessageServerPrivateChannel('admin', [], ['medical']), true);
  assert.equal(canAccessMessageServerPrivateChannel('owner', [], []), true);
});
