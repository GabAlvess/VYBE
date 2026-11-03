import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { CommunityChannel, CommunityMessage, CommunityMessageReport, DirectMessage, DirectTyping, type ChannelKind, type ChannelPosting } from '../models/Chat.js';
import { CommunityAudit } from '../models/CommunityAudit.js';
import { Account, Character, Notification } from '../models/Social.js';
import { Conversation, ConversationBlock, ConversationMessage } from '../models/Conversation.js';
import { Match, MatchBlock } from '../models/Match.js';
import { requireSession, tenantScope } from '../middleware/tenant.js';
import { emitToCommunity, emitToProfiles } from '../realtime/chatWebSocket.js';

export const chatRouter = Router();
chatRouter.use(requireSession);
chatRouter.use((request, response, next) => {
  const settings = request.vybeTenant!.settings?.features;
  const directMessage = request.path.startsWith('/messages');
  if (directMessage && settings?.messages === false) { response.status(403).json({ error: 'Mensagens estão desativadas nesta comunidade.' }); return; }
  if (!directMessage && settings?.conversations === false) { response.status(403).json({ error: 'Conversas estão desativadas nesta comunidade.' }); return; }
  next();
});

function tenantId(request: Request) { return request.vybeTenant!._id; }
function characterId(request: Request) { return request.vybeCharacter!._id; }
function isStaff(request: Request) { const tenant = request.vybeTenant!; const account = request.vybeAccount!; return tenant.admins.some((id) => id.equals(account._id)) || tenant.moderators.some((id) => id.equals(account._id)); }
export function canReadChannel(isPrivate: boolean, staff: boolean) { return !isPrivate || staff; }
export function canPostChannel(posting: ChannelPosting, staff: boolean) { return posting === 'members' || staff; }
function sendError(response: Response, status: number, error: string) { response.status(status).json({ error }); }
function channelJson(channel: { _id: mongoose.Types.ObjectId; name: string; category: string; description: string; kind: ChannelKind; posting: ChannelPosting; private: boolean }) {
  return { id: channel._id.toString(), name: channel.name, category: channel.category, description: channel.description, kind: channel.kind, posting: channel.posting, private: channel.private };
}
function characterJson(character: { _id: mongoose.Types.ObjectId; username: string; displayName: string; avatarUrl: string; verification?: { status?: string; verifiedAt?: Date; activatedAt?: Date; expiresAt?: Date | null; removedAt?: Date } }) {
  return { id: character._id.toString(), username: character.username, displayName: character.displayName, avatarUrl: character.avatarUrl, verified: (character.verification?.status === 'ACTIVE' || (!character.verification?.status && Boolean(character.verification?.verifiedAt))) && (!character.verification?.expiresAt || character.verification.expiresAt > new Date()) && !character.verification?.removedAt };
}

chatRouter.get('/conversations/channels', async (request, response) => {
  const tenant = tenantId(request);
  const filter = tenantScope(tenant, isStaff(request) ? {} : { private: false });
  const channels = await CommunityChannel.find(filter).lean();
  channels.sort((left, right) => {
    return left.category.localeCompare(right.category, 'pt-BR') || left.name.localeCompare(right.name, 'pt-BR');
  });
  response.json(channels.map(channelJson));
});

chatRouter.post('/conversations/channels', async (request, response) => {
  if (!isStaff(request)) { sendError(response, 403, 'Somente a equipe da comunidade pode criar canais.'); return; }
  const { name, category, description, kind, posting, private: isPrivate } = request.body ?? {};
  if (typeof name !== 'string' || !/^[a-z0-9-]{2,40}$/.test(name) || typeof category !== 'string' || category.trim().length < 2 || category.trim().length > 60 || !['text', 'announcement', 'roleplay', 'restricted'].includes(kind) || !['members', 'staff', 'restricted'].includes(posting) || typeof isPrivate !== 'boolean') {
    sendError(response, 400, 'Dados do canal inválidos.'); return;
  }
  try {
    const channel = await CommunityChannel.create({ tenantId: tenantId(request), name, category: category.trim(), description: typeof description === 'string' ? description.trim().slice(0, 240) : '', kind, posting, private: isPrivate, createdBy: characterId(request) });
    await CommunityAudit.create({ tenantId: tenantId(request), actorId: request.vybeAccount!._id, action: 'channels.created', details: { channelId: channel._id.toString(), name: channel.name, category: channel.category, kind: channel.kind } });
    response.status(201).json(channelJson(channel));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { sendError(response, 409, 'Já existe um canal com esse nome nesta comunidade.'); return; }
    throw error;
  }
});

chatRouter.patch('/conversations/channels/:channelId', async (request, response) => {
  if (!isStaff(request)) { sendError(response, 403, 'Somente a equipe da comunidade pode alterar canais.'); return; }
  if (!mongoose.isValidObjectId(request.params.channelId)) { sendError(response, 400, 'Canal inválido.'); return; }
  const { name, category, description, kind, posting, private: isPrivate } = request.body ?? {};
  if (typeof name !== 'string' || !/^[a-z0-9-]{2,40}$/.test(name) || typeof category !== 'string' || category.trim().length < 2 || category.trim().length > 60 || typeof description !== 'string' || description.length > 240 || !['text', 'announcement', 'roleplay', 'restricted'].includes(kind) || !['members', 'staff', 'restricted'].includes(posting) || typeof isPrivate !== 'boolean') {
    sendError(response, 400, 'Dados do canal inválidos.'); return;
  }
  const channel = await CommunityChannel.findOne(tenantScope(tenantId(request), { _id: request.params.channelId }));
  if (!channel) { sendError(response, 404, 'Canal não encontrado nesta comunidade.'); return; }
  const previous = { name: channel.name, category: channel.category, kind: channel.kind, posting: channel.posting, private: channel.private };
  channel.name = name;
  channel.category = category.trim();
  channel.description = description.trim();
  channel.kind = kind;
  channel.posting = posting;
  channel.private = isPrivate;
  try {
    await channel.save();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { sendError(response, 409, 'Já existe um canal com esse nome nesta comunidade.'); return; }
    throw error;
  }
  await CommunityAudit.create({ tenantId: tenantId(request), actorId: request.vybeAccount!._id, action: 'channels.updated', details: { channelId: channel._id.toString(), previous, current: { name, category: channel.category, kind, posting, private: isPrivate } } });
  response.json(channelJson(channel));
});

chatRouter.get('/conversations/channels/:channelId/messages', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.channelId)) { sendError(response, 400, 'Canal inválido.'); return; }
  const tenant = tenantId(request);
  const channel = await CommunityChannel.findOne(tenantScope(tenant, { _id: request.params.channelId }));
  if (!channel || !canReadChannel(channel.private, isStaff(request))) { sendError(response, 404, 'Canal não encontrado nesta comunidade.'); return; }
  const messages = await CommunityMessage.find(tenantScope(tenant, { channelId: channel._id })).sort({ createdAt: -1 }).limit(60).lean();
  const ids = [...new Set(messages.map((message) => message.characterId.toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const authors = await Character.find(tenantScope(tenant, { _id: { $in: ids } })).lean();
  const authorMap = new Map(authors.map((author) => [author._id.toString(), author]));
  response.json(messages.reverse().map((message) => ({ id: message._id.toString(), content: message.deletedAt ? 'Esta mensagem foi removida.' : message.content, deleted: Boolean(message.deletedAt), own: message.characterId.equals(characterId(request)), createdAt: message.createdAt, author: authorMap.has(message.characterId.toString()) ? characterJson(authorMap.get(message.characterId.toString())!) : null })));
});

chatRouter.post('/conversations/channels/:channelId/messages', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.channelId)) { sendError(response, 400, 'Canal inválido.'); return; }
  const content = typeof request.body?.content === 'string' ? request.body.content.trim() : '';
  if (!content || content.length > 2000) { sendError(response, 400, 'A mensagem deve ter entre 1 e 2.000 caracteres.'); return; }
  const tenant = tenantId(request);
  const channel = await CommunityChannel.findOne(tenantScope(tenant, { _id: request.params.channelId }));
  if (!channel || !canReadChannel(channel.private, isStaff(request))) { sendError(response, 404, 'Canal não encontrado nesta comunidade.'); return; }
  if (!canPostChannel(channel.posting, isStaff(request))) { sendError(response, 403, 'Você não tem permissão para publicar neste canal.'); return; }
  const message = await CommunityMessage.create({ tenantId: tenant, channelId: channel._id, characterId: characterId(request), content });
  const event = { type: 'channel:message', channelId: channel._id.toString() };
  if (channel.private) {
    const staffAccounts = [...request.vybeTenant!.admins, ...request.vybeTenant!.moderators];
    const staffProfiles = await Character.find(tenantScope(tenant, { accountId: { $in: staffAccounts } })).select('_id').lean();
    emitToProfiles(tenant.toString(), staffProfiles.map((profile) => profile._id), event);
  } else emitToCommunity(tenant.toString(), event);
  response.status(201).json({ id: message._id.toString(), content: message.content, deleted: false, own: true, createdAt: message.createdAt, author: characterJson(request.vybeCharacter!) });
});

chatRouter.delete('/conversations/messages/:messageId', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.messageId)) { sendError(response, 400, 'Mensagem inválida.'); return; }
  const tenant = tenantId(request);
  const message = await CommunityMessage.findOne(tenantScope(tenant, { _id: request.params.messageId }));
  if (!message) { sendError(response, 404, 'Mensagem não encontrada nesta comunidade.'); return; }
  const own = message.characterId.equals(characterId(request));
  if (!own && !isStaff(request)) { sendError(response, 403, 'Você não pode remover esta mensagem.'); return; }
  if (!message.deletedAt) { message.deletedAt = new Date(); message.deletedBy = characterId(request); await message.save(); }
  response.status(204).end();
});

chatRouter.post('/conversations/messages/:messageId/report', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.messageId)) { sendError(response, 400, 'Mensagem inválida.'); return; }
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) { sendError(response, 400, 'Descreva o motivo da denúncia.'); return; }
  const tenant = tenantId(request);
  const message = await CommunityMessage.findOne(tenantScope(tenant, { _id: request.params.messageId }));
  if (!message) { sendError(response, 404, 'Mensagem não encontrada nesta comunidade.'); return; }
  await CommunityMessageReport.updateOne(tenantScope(tenant, { messageId: message._id, reporterId: characterId(request) }), { $setOnInsert: { reason, status: 'open' } }, { upsert: true });
  response.status(201).json({ reported: true });
});

chatRouter.get('/conversations/members', async (request, response) => {
  if (request.vybeTenant!.settings?.privacy?.showMembers === false && !isStaff(request)) { response.status(403).json({ error: 'A lista de membros está oculta nesta comunidade.' }); return; }
  const tenant = tenantId(request);
  const members = await Character.find(tenantScope(tenant)).sort({ displayName: 1 }).limit(100).lean();
  response.json(members.map((member) => ({ ...characterJson(member), online: member._id.equals(characterId(request)) })));
});

chatRouter.get('/messages/summary', async (request, response) => {
  const tenant = tenantId(request);
  const self = characterId(request);
  const messages = await DirectMessage.find(tenantScope(tenant, { $or: [{ senderId: self }, { recipientId: self }] })).sort({ createdAt: -1 }).limit(80).lean();
  const partnerIds = [...new Set(messages.map((message) => (message.senderId.equals(self) ? message.recipientId : message.senderId).toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const partners = await Character.find(tenantScope(tenant, { _id: { $in: partnerIds } })).lean();
  const partnerMap = new Map(partners.map((person) => [person._id.toString(), person]));
  const latest = new Map<string, typeof messages[number]>();
  for (const message of messages) {
    const other = message.senderId.equals(self) ? message.recipientId : message.senderId;
    if (!latest.has(other.toString())) latest.set(other.toString(), message);
  }
  const unreadCounts = await DirectMessage.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    { $match: { tenantId: tenant, recipientId: self, readAt: { $exists: false } } },
    { $group: { _id: '$senderId', count: { $sum: 1 } } },
  ]);
  const unreadBySender = new Map(unreadCounts.map((item) => [item._id.toString(), item.count]));
  response.json([...latest.entries()].map(([id, message]) => ({ character: partnerMap.has(id) ? characterJson(partnerMap.get(id)!) : null, lastMessage: message.content, createdAt: message.createdAt, unreadCount: unreadBySender.get(id) ?? 0 })).filter((item) => item.character).slice(0, 4));
});

chatRouter.get('/messages', async (request, response) => {
  const tenant = tenantId(request);
  const self = characterId(request);
  const messages = await DirectMessage.find(tenantScope(tenant, { $or: [{ senderId: self }, { recipientId: self }] })).sort({ createdAt: -1 }).limit(500).lean();
  const partnerIds = [...new Set(messages.map((message) => (message.senderId.equals(self) ? message.recipientId : message.senderId).toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const partners = await Character.find(tenantScope(tenant, { _id: { $in: partnerIds } })).lean();
  const partnerMap = new Map(partners.map((person) => [person._id.toString(), person]));
  const latest = new Map<string, typeof messages[number]>();
  for (const message of messages) { const other = message.senderId.equals(self) ? message.recipientId : message.senderId; if (!latest.has(other.toString())) latest.set(other.toString(), message); }
  const unreadCounts = await DirectMessage.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    { $match: { tenantId: tenant, recipientId: self, readAt: { $exists: false } } },
    { $group: { _id: '$senderId', count: { $sum: 1 } } },
  ]);
  const unreadBySender = new Map(unreadCounts.map((item) => [item._id.toString(), item.count]));
  response.json([...latest.entries()].map(([id, message]) => ({ character: partnerMap.has(id) ? characterJson(partnerMap.get(id)!) : null, lastMessage: message.content, createdAt: message.createdAt, unreadCount: unreadBySender.get(id) ?? 0 })).filter((item) => item.character));
});

chatRouter.get('/messages/:username', async (request, response) => {
  const tenant = tenantId(request);
  const self = characterId(request);
  const partner = await Character.findOne(tenantScope(tenant, { username: request.params.username.toLowerCase() })).lean();
  if (!partner || partner._id.equals(self)) { sendError(response, 404, 'Personagem não encontrado para iniciar uma conversa.'); return; }
  await DirectMessage.updateMany(tenantScope(tenant, { senderId: partner._id, recipientId: self, readAt: { $exists: false } }), { $set: { readAt: new Date() } });
  const messages = await DirectMessage.find(tenantScope(tenant, { $or: [{ senderId: self, recipientId: partner._id }, { senderId: partner._id, recipientId: self }] })).sort({ createdAt: 1 }).limit(200).lean();
  const typing = await DirectTyping.exists(tenantScope(tenant, { senderId: partner._id, recipientId: self, expiresAt: { $gt: new Date() } }));
  response.json({ character: characterJson(partner), typing: Boolean(typing), messages: messages.map((message) => ({ id: message._id.toString(), content: message.content, createdAt: message.createdAt, own: message.senderId.equals(self), readAt: message.readAt ?? null })) });
});

chatRouter.post('/messages/typing', async (request, response) => {
  const tenant = tenantId(request);
  const self = characterId(request);
  const username = typeof request.body?.toUsername === 'string' ? request.body.toUsername.toLowerCase() : '';
  const typing = request.body?.typing === true;
  if (!username) { sendError(response, 400, 'Informe a conversa para atualizar o indicador de digitação.'); return; }
  const recipient = await Character.findOne(tenantScope(tenant, { username })).select('_id').lean();
  if (!recipient || recipient._id.equals(self)) { sendError(response, 404, 'Destinatário indisponível nesta comunidade.'); return; }
  const scope = tenantScope(tenant, { senderId: self, recipientId: recipient._id });
  if (typing) {
    await DirectTyping.updateOne(scope, { $set: { expiresAt: new Date(Date.now() + 10_000) } }, { upsert: true });
  } else {
    await DirectTyping.deleteOne(scope);
  }
  emitToProfiles(tenant.toString(), [recipient._id], { type: 'direct:typing', otherProfileId: self.toString(), typing });
  response.status(204).end();
});

chatRouter.post('/messages', async (request, response) => {
  const tenant = tenantId(request);
  const self = characterId(request);
  const username = typeof request.body?.toUsername === 'string' ? request.body.toUsername.toLowerCase() : '';
  const content = typeof request.body?.content === 'string' ? request.body.content.trim() : '';
  if (!username || !content || content.length > 2000) { sendError(response, 400, 'Informe destinatário e mensagem (até 2.000 caracteres).'); return; }
  const recipient = await Character.findOne(tenantScope(tenant, { username }));
  if (!recipient || recipient._id.equals(self)) { sendError(response, 404, 'Destinatário indisponível nesta comunidade.'); return; }
  if (!await Account.exists({ _id: recipient.accountId, tenantId: tenant, status: 'active' })) { sendError(response, 404, 'Destinatário indisponível nesta comunidade.'); return; }
  const blocked = await Promise.all([
    ConversationBlock.exists({ tenantId: tenant, $or: [{ blockerId: self, blockedId: recipient._id }, { blockerId: recipient._id, blockedId: self }] }),
    MatchBlock.exists({ tenantId: tenant, $or: [{ blockerId: self, blockedId: recipient._id }, { blockerId: recipient._id, blockedId: self }] }),
  ]);
  if (blocked.some(Boolean)) { sendError(response, 403, 'Esta conversa está bloqueada.'); return; }
  const directKey = [self.toString(), recipient._id.toString()].sort().join(':');
  const conversation = await Conversation.findOneAndUpdate({ tenantId: tenant, kind: 'direct', directKey }, { $setOnInsert: { tenantId: tenant, kind: 'direct', directKey, createdBy: self, participants: [{ profileId: self, role: 'member' }, { profileId: recipient._id, role: 'member' }] } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const message = await ConversationMessage.create({ tenantId: tenant, conversationId: conversation._id, senderProfileId: self, content, messageType: 'text' });
  conversation.lastMessageAt = message.createdAt; await conversation.save();
  const targetParticipant = conversation.participants.find((participant) => participant.profileId.equals(recipient._id));
  if (!targetParticipant?.mutedAt) await Notification.create({ tenantId: tenant, characterId: recipient._id, actorId: self, type: 'message', targetId: message._id });
  emitToProfiles(tenant.toString(), [self], { type: 'direct:message', otherProfileId: recipient._id.toString(), messageId: message._id.toString() });
  emitToProfiles(tenant.toString(), [recipient._id], { type: 'direct:message', otherProfileId: self.toString(), messageId: message._id.toString() });
  const match = await Match.findOne({ tenantId: tenant, status: 'active', $or: [{ profileAId: self, profileBId: recipient._id }, { profileAId: recipient._id, profileBId: self }] }).lean();
  response.status(201).json({ id: message._id.toString(), content: message.content, createdAt: message.createdAt, own: true, ...(match ? { matchId: match._id.toString() } : {}) });
});
