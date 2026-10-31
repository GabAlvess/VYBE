import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Conversation, ConversationBlock, ConversationMessage } from './models/Conversation.js';
import { canAccessConversation, canDeleteMessage, canManageConversation, canSendDirect, conversationDirectKey, isActiveParticipant, isUnreadMessage } from './routes/conversationPolicy.js';

const id = () => new mongoose.Types.ObjectId();

test('DIRECT key is stable for both participants and prevents duplicate conversations', () => {
  const a = id(); const b = id();
  assert.equal(conversationDirectKey(a,b), conversationDirectKey(b,a));
  assert.ok(Conversation.schema.indexes().some(([keys,options]) => keys.tenantId === 1 && keys.directKey === 1 && options?.unique));
});
test('conversation access requires current community and active participation', () => {
  const tenant = id(); const otherTenant = id(); const me = id(); const participant = { profileId: me, role: 'member' as const, joinedAt: new Date() };
  assert.equal(canAccessConversation(tenant,tenant,[participant],me),true);
  assert.equal(canAccessConversation(otherTenant,tenant,[participant],me),false);
  assert.equal(canAccessConversation(tenant,tenant,[{...participant,leftAt:new Date()}],me),false);
});
test('non-members cannot read group chats and removed members lose access', () => {
  const me = id(); const someoneElse = id(); const members = [{ profileId: someoneElse, role: 'member' as const, joinedAt: new Date() }];
  assert.equal(isActiveParticipant(members,me),false);
  assert.equal(isActiveParticipant([...members,{profileId:me,role:'member',joinedAt:new Date()}],me),true);
});
test('DIRECT conversations are blocked when either side has blocked the other', () => {
  assert.equal(canSendDirect('direct',1,true),false);
  assert.equal(canSendDirect('direct',1,false),true);
  assert.equal(canSendDirect('group',5,false),true);
  assert.ok(ConversationBlock.schema.indexes().some(([keys,options]) => keys.tenantId===1 && keys.blockerId===1 && keys.blockedId===1 && options?.unique));
});
test('only active group admins can manage group membership', () => {
  assert.equal(canManageConversation('admin',true),true);
  assert.equal(canManageConversation('member',true),false);
  assert.equal(canManageConversation('admin',false),false);
});
test('unread messages exclude own messages and messages already read', () => {
  const earlier = new Date('2026-01-01T10:00:00Z'); const later = new Date('2026-01-01T10:01:00Z');
  assert.equal(isUnreadMessage(later,earlier),true);
  assert.equal(isUnreadMessage(earlier,later),false);
  assert.equal(isUnreadMessage(later,earlier,true),false);
});
test('only the sender can delete a message during the first five minutes', () => {
  const sentAt=new Date('2026-01-01T10:00:00Z');const withinLimit=new Date('2026-01-01T10:04:59Z');const expired=new Date('2026-01-01T10:05:01Z');
  assert.equal(canDeleteMessage('a','a',sentAt,withinLimit),true);
  assert.equal(canDeleteMessage('b','a',sentAt,withinLimit),false);
  assert.equal(canDeleteMessage('a','a',sentAt,expired),false);
});
test('conversation messages persist community, sender, content type, reply, and favorites', () => {
  const message = new ConversationMessage({ tenantId:id(), conversationId:id(), senderProfileId:id(), messageType:'text', content:'Olá', favoriteBy:[id()] });
  assert.equal(message.validateSync(),undefined);
  assert.ok(ConversationMessage.schema.indexes().some(([keys]) => keys.tenantId===1 && keys.conversationId===1 && keys.createdAt===1));
});
test('groups and direct chats share the conversation model but distinguish type', () => {
  const base = { tenantId:id(), createdBy:id(), participants:[{profileId:id(),role:'admin',joinedAt:new Date()}] };
  assert.equal(new Conversation({...base,kind:'group',name:'Residentes'}).validateSync(),undefined);
  assert.equal(new Conversation({...base,kind:'direct',directKey:conversationDirectKey(id(),id())}).validateSync(),undefined);
});
