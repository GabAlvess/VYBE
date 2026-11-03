import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { Account, Character, Notification } from '../models/Social.js';
import { DirectMessage } from '../models/Chat.js';
import { Conversation, ConversationBlock, ConversationMessage } from '../models/Conversation.js';
import { MessageAppProfile } from '../models/MessageAppProfile.js';
import { Match, MatchBlock } from '../models/Match.js';
import { requireSession } from '../middleware/tenant.js';
import { canAccessConversation, canDeleteMessage, canManageConversation, canSendDirect, conversationDirectKey, isActiveParticipant } from './conversationPolicy.js';
import { getOrCreateMatchConversation } from './conversationService.js';
import { emitToProfiles } from '../realtime/chatWebSocket.js';

export const messagesAppRouter = Router();
messagesAppRouter.use(requireSession);
messagesAppRouter.use((request, response, next) => { if (request.vybeTenant!.settings?.features?.messages === false) { response.status(403).json({ error: 'Mensagens estão desativadas nesta comunidade.' }); return; } next(); });
const tenantId = (request: Request) => request.vybeTenant!._id;
const selfId = (request: Request) => request.vybeCharacter!._id;
const validId = (value: unknown): value is string => typeof value === 'string' && mongoose.isValidObjectId(value);
function characterJson(item: { _id: mongoose.Types.ObjectId; username: string; displayName: string; avatarUrl: string; bio?: string }) { return { id: item._id.toString(), username: item.username, displayName: item.displayName, avatarUrl: item.avatarUrl, bio: item.bio ?? '' }; }
function messageIdentity(character: { _id: mongoose.Types.ObjectId; username: string; displayName: string; avatarUrl: string; bio?: string }, profile?: { displayName?: string; bio?: string; avatarUrl?: string; statusMessage?: string }) {
  return { ...characterJson(character), displayName: profile?.displayName || character.displayName, avatarUrl: profile ? profile.avatarUrl ?? '' : character.avatarUrl, bio: profile ? profile.bio ?? '' : character.bio ?? '', statusMessage: profile?.statusMessage ?? '' };
}
function memberQuery(request: Request) { return { tenantId: tenantId(request), participants: { $elemMatch: { profileId: selfId(request), leftAt: { $exists: false } } } }; }
async function accessibleConversation(request: Request, id: unknown) {
  if (!validId(id)) return null;
  const conversation = await Conversation.findOne({ _id: id, tenantId: tenantId(request) });
  return conversation && canAccessConversation(conversation.tenantId, tenantId(request), conversation.participants, selfId(request)) ? conversation : null;
}
async function blocked(tenant: mongoose.Types.ObjectId, a: mongoose.Types.ObjectId, b: mongoose.Types.ObjectId) { return Boolean(await Promise.all([ConversationBlock.exists({ tenantId: tenant, $or: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] }), MatchBlock.exists({ tenantId: tenant, $or: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] })]).then((items)=>items.some(Boolean))); }
async function importLegacyDirects(request: Request) {
  const tenant = tenantId(request); const me = selfId(request);
  const legacy = await DirectMessage.find({ tenantId: tenant, $or: [{ senderId: me }, { recipientId: me }] }).sort({ createdAt: 1 }).limit(1500).lean();
  const partners = [...new Set(legacy.map((message) => (message.senderId.equals(me) ? message.recipientId : message.senderId).toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const accountIds = new Set((await Character.find({ tenantId: tenant, _id: { $in: partners } }).select('accountId').lean()).map((item) => item.accountId.toString()));
  const activeAccounts = new Set((await Account.find({ tenantId: tenant, status: 'active' }).select('_id').lean()).map((item) => item._id.toString()));
  for (const partnerId of partners) {
    const character = await Character.findOne({ _id: partnerId, tenantId: tenant }).select('accountId').lean();
    if (!character || !accountIds.has(character.accountId.toString()) || !activeAccounts.has(character.accountId.toString())) continue;
    const key = conversationDirectKey(me, partnerId);
    const conversation = await Conversation.findOneAndUpdate({ tenantId: tenant, kind: 'direct', directKey: key }, { $setOnInsert: { tenantId: tenant, kind: 'direct', directKey: key, createdBy: me, participants: [{ profileId: me, role: 'member' }, { profileId: partnerId, role: 'member' }] } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    const pairMessages = legacy.filter((message) => (message.senderId.equals(me) && message.recipientId.equals(partnerId)) || (message.senderId.equals(partnerId) && message.recipientId.equals(me)));
    if (pairMessages.length) await ConversationMessage.bulkWrite(pairMessages.map((message) => ({ updateOne: { filter: { tenantId: tenant, legacyMessageId: message._id }, update: { $setOnInsert: { tenantId: tenant, conversationId: conversation._id, senderProfileId: message.senderId, content: message.content, messageType: 'text', legacyMessageId: message._id, readAt: message.readAt, createdAt: message.createdAt, updatedAt: message.updatedAt } }, upsert: true } })));
    const latest = pairMessages.at(-1);
    if (latest) await Conversation.updateOne({ _id: conversation._id, tenantId: tenant }, { $max: { lastMessageAt: latest.createdAt } });
    const lastReadAt = pairMessages.filter((message) => message.recipientId.equals(me) && message.readAt).at(-1)?.readAt;
    if (lastReadAt) await Conversation.updateOne({ _id: conversation._id, tenantId: tenant }, { $max: { 'participants.$[viewer].lastReadAt': lastReadAt } }, { arrayFilters: [{ 'viewer.profileId': me }] });
  }
}
async function attachmentFrom(value: unknown, slug: string) {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.dataUrl !== 'string' || item.dataUrl.length > 7_200_000 || typeof item.name !== 'string') throw new Error('Anexo inválido ou maior que 5 MB.');
  const match = item.dataUrl.match(/^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Formato de anexo inválido.');
  const mimeType = match[1].toLowerCase();
  const allowed = new Set(['image/png','image/jpeg','image/webp','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','application/zip']);
  if (!allowed.has(mimeType)) throw new Error('Este tipo de arquivo não é permitido.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('O anexo deve ter até 5 MB.');
  const signatures: Record<string, (buffer: Buffer) => boolean> = {
    'image/png': (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    'image/jpeg': (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    'image/webp': (buffer) => buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP',
    'image/gif': (buffer) => ['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString()),
    'application/pdf': (buffer) => buffer.subarray(0,5).toString() === '%PDF-',
    'application/zip': (buffer) => buffer[0] === 0x50 && buffer[1] === 0x4b,
  };
  if (signatures[mimeType] && !signatures[mimeType](bytes)) throw new Error('O conteúdo do arquivo não corresponde ao tipo informado.');
  const extensionByMime: Record<string,string> = { 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','application/pdf':'pdf','application/msword':'doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx','application/vnd.ms-excel':'xls','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx','text/plain':'txt','application/zip':'zip' };
  const uploads = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads', slug);
  await mkdir(uploads, { recursive: true });
  const filename = `message-${randomBytes(18).toString('hex')}.${extensionByMime[mimeType]}`;
  await writeFile(resolve(uploads, filename), bytes, { flag: 'wx', mode: 0o600 });
  return { url: `/media/${slug}/${filename}`, name: item.name.trim().slice(0,180) || `arquivo.${extensionByMime[mimeType]}`, mimeType, size: bytes.length };
}
function messageJson(message: any, me: mongoose.Types.ObjectId) {
  const storedAttachment = message.deletedAt ? null : message.attachment;
  const attachment = storedAttachment && typeof storedAttachment.url === 'string' && storedAttachment.url
    ? { url: storedAttachment.url, name: storedAttachment.name ?? '', mimeType: storedAttachment.mimeType ?? '', size: storedAttachment.size ?? 0 }
    : null;
  return { id: message._id.toString(), senderProfileId: message.senderProfileId.toString(), own: message.senderProfileId.equals(me), content: message.deletedAt ? 'Mensagem removida.' : message.content, messageType: message.messageType, attachment, replyToMessageId: message.replyToMessageId?.toString() ?? null, favorite: message.favoriteBy?.some((id: mongoose.Types.ObjectId) => id.equals(me)) ?? false, favoriteCount: message.favoriteBy?.length ?? 0, deleted: Boolean(message.deletedAt), readAt: message.readAt ?? null, createdAt: message.createdAt };
}
async function summary(request: Request, conversation: any) {
  const me = selfId(request);
  const others = conversation.participants.filter((p: any) => !p.profileId.equals(me) && !p.leftAt);
  const ids = others.map((p: any) => p.profileId);
  const [people, customProfiles] = await Promise.all([
    Character.find({ tenantId: tenantId(request), _id: { $in: ids } }).lean(),
    MessageAppProfile.find({ tenantId: tenantId(request), characterId: { $in: ids } }).lean(),
  ]);
  const profileMap = new Map(customProfiles.map((profile) => [profile.characterId.toString(), profile]));
  const map = new Map(people.map((person) => [person._id.toString(), messageIdentity(person, profileMap.get(person._id.toString()))]));
  const last = await ConversationMessage.findOne({ tenantId: tenantId(request), conversationId: conversation._id }).sort({ createdAt: -1 }).lean();
  const participant = conversation.participants.find((p: any) => p.profileId.equals(me));
  const typing = conversation.participants.some((p: any) => !p.profileId.equals(me) && !p.leftAt && p.typingAt && Date.now() - new Date(p.typingAt).getTime() < 7000);
  const unreadCount = await ConversationMessage.countDocuments({ tenantId: tenantId(request), conversationId: conversation._id, senderProfileId: { $ne: me }, ...(participant?.lastReadAt ? { createdAt: { $gt: participant.lastReadAt } } : {}) });
  const directPerson = map.get(ids[0]?.toString());
  const match = conversation.matchId ? await Match.findOne({ _id: conversation.matchId, tenantId: tenantId(request), status: 'active' }).lean() : null;
  const peerLastReadAt = conversation.kind === 'direct' ? conversation.participants.find((p: any) => !p.profileId.equals(me) && !p.leftAt)?.lastReadAt ?? null : null;
  const peerId = conversation.kind === 'direct' ? others[0]?.profileId : null;
  const [blockedByMe, blockedByThem] = peerId ? await Promise.all([
    ConversationBlock.exists({ tenantId: tenantId(request), blockerId: me, blockedId: peerId }),
    ConversationBlock.exists({ tenantId: tenantId(request), blockerId: peerId, blockedId: me }),
  ]) : [false, false];
  return { id: conversation._id.toString(), kind: conversation.kind, name: conversation.kind === 'group' ? conversation.name : directPerson?.displayName ?? 'Conversa', description: conversation.description, photoUrl: conversation.kind === 'group' ? conversation.photoUrl : directPerson?.avatarUrl ?? '', participants: others.map((p: any) => ({ ...(map.get(p.profileId.toString()) ?? { id: p.profileId.toString(), username: '', displayName: 'Membro', avatarUrl: '', bio: '', statusMessage: '' }), role: p.role })), lastMessage: last ? (last.attachment?.name || last.content || (last.messageType === 'image' ? 'Imagem' : 'Arquivo')) : '', lastMessageAt: last?.createdAt ?? conversation.updatedAt, unreadCount, muted: Boolean(participant?.mutedAt), favorite: Boolean(participant?.favorite), typing, peerLastReadAt, blockedByMe: Boolean(blockedByMe), blockedByThem: Boolean(blockedByThem), currentRole: participant?.role ?? 'member', matchId: match?._id.toString() ?? null, createdBy: conversation.createdBy.toString() };
}

messagesAppRouter.get('/profile', async (request, response) => {
  const character = request.vybeCharacter!;
  const profile = await MessageAppProfile.findOne({ tenantId: tenantId(request), characterId: character._id }).lean();
  response.json({ identity: messageIdentity(character, profile ?? undefined) });
});

messagesAppRouter.patch('/profile', async (request, response) => {
  const character = request.vybeCharacter!;
  const tenant = tenantId(request);
  const current = await MessageAppProfile.findOne({ tenantId: tenant, characterId: character._id });
  const displayName = typeof request.body?.displayName === 'string' ? request.body.displayName.trim() : current?.displayName ?? '';
  const bio = typeof request.body?.bio === 'string' ? request.body.bio.trim() : current?.bio ?? '';
  const statusMessage = typeof request.body?.statusMessage === 'string' ? request.body.statusMessage.trim() : current?.statusMessage ?? '';
  if (!displayName || displayName.length > 60 || bio.length > 300 || statusMessage.length > 80) { response.status(400).json({ error: 'Revise o nome, a apresentação e o recado do perfil.' }); return; }
  let avatarUrl = current?.avatarUrl ?? '';
  if (Object.hasOwn(request.body ?? {}, 'photo')) {
    if (request.body.photo === null) avatarUrl = '';
    else {
      try {
        const photo = await attachmentFrom(request.body.photo, request.vybeTenant!.slug);
        if (!photo?.mimeType.startsWith('image/')) throw new Error('Escolha uma imagem para a foto do perfil.');
        avatarUrl = photo.url;
      } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Não foi possível salvar a foto.' }); return; }
    }
  }
  const profile = await MessageAppProfile.findOneAndUpdate({ tenantId: tenant, characterId: character._id }, { $set: { displayName, bio, statusMessage, avatarUrl } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
  response.json({ identity: messageIdentity(character, profile) });
});

messagesAppRouter.get('/people', async (request, response) => {
  const q = typeof request.query.q === 'string' ? request.query.q.trim().slice(0,80) : '';
  const self = selfId(request);
  const accounts = await Account.find({ tenantId: tenantId(request), status: 'active' }).select('_id').lean();
  const selector: Record<string, unknown> = { tenantId: tenantId(request), accountId: { $in: accounts.map((x) => x._id) }, _id: { $ne: self } };
  if (q) { const safe = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); selector.$or = [{ displayName: safe }, { username: safe }]; }
  const people = await Character.find(selector).sort({ displayName: 1 }).limit(40).lean();
  const profiles = await MessageAppProfile.find({ tenantId: tenantId(request), characterId: { $in: people.map((person) => person._id) } }).lean();
  const profileMap = new Map(profiles.map((profile) => [profile.characterId.toString(), profile]));
  response.json(people.map((person) => messageIdentity(person, profileMap.get(person._id.toString()))));
});

messagesAppRouter.get('/conversations', async (request, response) => {
  await importLegacyDirects(request);
  const activeMatches = await Match.find({ tenantId: tenantId(request), status: 'active', $or: [{ profileAId: selfId(request) }, { profileBId: selfId(request) }] }).lean();
  await Promise.all(activeMatches.map((match) => getOrCreateMatchConversation(tenantId(request), match._id, match.profileAId, match.profileBId)));
  const conversations = await Conversation.find(memberQuery(request)).sort({ lastMessageAt: -1 }).limit(150).lean();
  response.json(await Promise.all(conversations.map((item) => summary(request, item))));
});

messagesAppRouter.get('/summary', async (request, response) => {
  await importLegacyDirects(request);
  const conversations = await Conversation.find(memberQuery(request)).sort({ lastMessageAt: -1 }).limit(30).lean();
  const items = await Promise.all(conversations.map(async (conversation) => {
    const item = await summary(request, conversation);
    const peer = item.participants[0];
    return { character: { id: conversation.kind === 'group' ? conversation._id.toString() : peer?.id ?? conversation._id.toString(), username: conversation.kind === 'group' ? '' : peer?.username ?? '', displayName: item.name, avatarUrl: item.photoUrl, verified: false }, lastMessage: item.lastMessage, createdAt: item.lastMessageAt, unreadCount: item.unreadCount };
  }));
  response.json(items);
});

messagesAppRouter.post('/direct', async (request, response) => {
  const targetId = request.body?.profileId;
  if (!validId(targetId) || targetId === selfId(request).toString()) { response.status(400).json({ error: 'Selecione uma pessoa válida.' }); return; }
  const tenant = tenantId(request); const other = new mongoose.Types.ObjectId(targetId);
  const account = await Character.findOne({ _id: other, tenantId: tenant }).select('accountId').lean();
  if (!account || !await Account.exists({ _id: account.accountId, tenantId: tenant, status: 'active' })) { response.status(404).json({ error: 'Pessoa não encontrada nesta comunidade.' }); return; }
  if (await blocked(tenant, selfId(request), other)) { response.status(403).json({ error: 'Esta conversa não está disponível.' }); return; }
  const key = conversationDirectKey(selfId(request), other);
  const conversation = await Conversation.findOneAndUpdate({ tenantId: tenant, kind: 'direct', directKey: key }, { $setOnInsert: { tenantId: tenant, kind: 'direct', directKey: key, createdBy: selfId(request), participants: [{ profileId: selfId(request), role: 'member' }, { profileId: other, role: 'member' }] } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  response.status(200).json(await summary(request, conversation));
});

messagesAppRouter.post('/groups', async (request, response) => {
  const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
  const description = typeof request.body?.description === 'string' ? request.body.description.trim() : '';
  const ids: string[] = Array.isArray(request.body?.memberIds) ? [...new Set<string>(request.body.memberIds.filter((id: unknown): id is string => validId(id)))] : [];
  ids.push(selfId(request).toString());
  if (name.length < 2 || name.length > 80 || description.length > 500 || ids.length < 2 || ids.length > 100) { response.status(400).json({ error: 'Informe nome e pelo menos mais uma pessoa da comunidade.' }); return; }
  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
  const characters = await Character.find({ tenantId: tenantId(request), _id: { $in: objectIds } }).select('_id accountId').lean();
  const active = await Account.find({ tenantId: tenantId(request), status: 'active', _id: { $in: characters.map((item) => item.accountId) } }).select('_id').lean();
  const activeAccounts = new Set(active.map((x) => x._id.toString()));
  const memberIds = characters.filter((item) => activeAccounts.has(item.accountId.toString())).map((x) => x._id);
  if (memberIds.length !== objectIds.length) { response.status(400).json({ error: 'Todos os participantes precisam ser membros ativos desta comunidade.' }); return; }
  let photo;
  try { photo = await attachmentFrom(request.body?.photo, request.vybeTenant!.slug); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Foto de grupo inválida.' }); return; }
  if (photo && !photo.mimeType.startsWith('image/')) { response.status(400).json({ error: 'A foto do grupo precisa ser uma imagem.' }); return; }
  const conversation = await Conversation.create({ tenantId: tenantId(request), kind: 'group', name, description, photoUrl: photo?.url ?? '', createdBy: selfId(request), participants: memberIds.map((profileId) => ({ profileId, role: profileId.equals(selfId(request)) ? 'admin' : 'member' })) });
  response.status(201).json(await summary(request, conversation));
});

messagesAppRouter.get('/conversations/:conversationId', async (request, response) => {
  const conversation = await accessibleConversation(request, request.params.conversationId);
  if (!conversation) { response.status(404).json({ error: 'Conversa não encontrada.' }); return; }
  const me = selfId(request); const current = conversation.participants.find((p) => p.profileId.equals(me)); const readAt = new Date();
  current!.lastReadAt = readAt; current!.typingAt = undefined; await conversation.save();
  if (conversation.kind === 'direct') await ConversationMessage.updateMany({ tenantId: tenantId(request), conversationId: conversation._id, senderProfileId: { $ne: me }, deletedAt: { $exists: false }, readAt: { $exists: false } }, { $set: { readAt } });
  const messages = await ConversationMessage.find({ tenantId: tenantId(request), conversationId: conversation._id }).sort({ createdAt: 1 }).limit(500).lean();
  const replyIds = [...new Set(messages.flatMap((item) => item.replyToMessageId ? [item.replyToMessageId.toString()] : []))].map((id) => new mongoose.Types.ObjectId(id));
  const replies = await ConversationMessage.find({ tenantId: tenantId(request), conversationId: conversation._id, _id: { $in: replyIds } }).lean();
  const replyMap = new Map(replies.map((item) => [item._id.toString(), item]));
  response.json({ conversation: await summary(request, conversation), messages: messages.map((item) => ({ ...messageJson(item, me), reply: item.replyToMessageId && replyMap.has(item.replyToMessageId.toString()) ? messageJson(replyMap.get(item.replyToMessageId.toString()), me) : null })) });
});

messagesAppRouter.post('/conversations/:conversationId/typing', async (request, response) => {
  const conversation = await accessibleConversation(request, request.params.conversationId);
  if (!conversation) { response.status(404).json({ error: 'Conversa não encontrada.' }); return; }
  const participant = conversation.participants.find((p) => p.profileId.equals(selfId(request)) && !p.leftAt)!;
  participant.typingAt = request.body?.typing === true ? new Date() : undefined;
  await conversation.save();
  emitToProfiles(tenantId(request).toString(), conversation.participants.filter((item) => !item.profileId.equals(selfId(request)) && !item.leftAt).map((item) => item.profileId), { type: 'typing', conversationId: conversation._id.toString(), profileId: selfId(request).toString(), typing: Boolean(participant.typingAt) });
  response.json({ typing: Boolean(participant.typingAt) });
});

messagesAppRouter.post('/conversations/:conversationId/messages', async (request, response) => {
  const conversation = await accessibleConversation(request, request.params.conversationId);
  if (!conversation) { response.status(404).json({ error: 'Conversa não encontrada.' }); return; }
  const me = selfId(request); const content = typeof request.body?.content === 'string' ? request.body.content.trim().slice(0,4000) : '';
  let attachment;
  try { attachment = await attachmentFrom(request.body?.attachment, request.vybeTenant!.slug); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Anexo inválido.' }); return; }
  if (!content && !attachment) { response.status(400).json({ error: 'Escreva uma mensagem ou anexe um arquivo.' }); return; }
  const recipients = conversation.participants.filter((p) => !p.profileId.equals(me) && !p.leftAt).map((p) => p.profileId);
  const isBlocked = conversation.kind === 'direct' && recipients.length === 1 ? await blocked(tenantId(request), me, recipients[0]) : false;
  if (!canSendDirect(conversation.kind, recipients.length, isBlocked)) { response.status(403).json({ error: 'Esta conversa está bloqueada.' }); return; }
  const replyToMessageId = validId(request.body?.replyToMessageId) ? new mongoose.Types.ObjectId(request.body.replyToMessageId) : undefined;
  if (replyToMessageId && !await ConversationMessage.exists({ tenantId: tenantId(request), conversationId: conversation._id, _id: replyToMessageId })) { response.status(400).json({ error: 'A mensagem respondida não pertence a esta conversa.' }); return; }
  const message = await ConversationMessage.create({ tenantId: tenantId(request), conversationId: conversation._id, senderProfileId: me, content, messageType: attachment ? attachment.mimeType.startsWith('image/') ? 'image' : 'file' : 'text', attachment, replyToMessageId });
  const senderParticipant = conversation.participants.find((p) => p.profileId.equals(me)); if (senderParticipant) senderParticipant.typingAt = undefined;
  conversation.lastMessageAt = message.createdAt; await conversation.save();
  const notifyIds = conversation.participants.filter((participant) => !participant.profileId.equals(me) && !participant.leftAt && !participant.mutedAt).map((participant) => participant.profileId);
  if (notifyIds.length) await Notification.insertMany(notifyIds.map((characterId) => ({ tenantId: tenantId(request), characterId, actorId: me, type: 'message' as const, targetId: message._id })));
  emitToProfiles(tenantId(request).toString(), conversation.participants.filter((participant) => !participant.leftAt && !participant.profileId.equals(me)).map((participant) => participant.profileId), { type: 'message:new', conversationId: conversation._id.toString(), messageId: message._id.toString() });
  if (conversation.kind === 'direct' && recipients[0]) {
    emitToProfiles(tenantId(request).toString(), [me], { type: 'direct:message', otherProfileId: recipients[0].toString(), messageId: message._id.toString() });
    emitToProfiles(tenantId(request).toString(), [recipients[0]], { type: 'direct:message', otherProfileId: me.toString(), messageId: message._id.toString() });
  }
  response.status(201).json(messageJson(message, me));
});

messagesAppRouter.post('/conversations/:conversationId/messages/:messageId/favorite', async (request, response) => {
  const conversation = await accessibleConversation(request, request.params.conversationId);
  if (!conversation || !validId(request.params.messageId)) { response.status(404).json({ error: 'Mensagem não encontrada.' }); return; }
  const message = await ConversationMessage.findOne({ _id: request.params.messageId, tenantId: tenantId(request), conversationId: conversation._id });
  if (!message) { response.status(404).json({ error: 'Mensagem não encontrada.' }); return; }
  const me = selfId(request); const index = message.favoriteBy.findIndex((id) => id.equals(me));
  if (index >= 0) message.favoriteBy.splice(index, 1); else message.favoriteBy.push(me);
  await message.save(); response.json({ favorite: index < 0 });
});

messagesAppRouter.delete('/conversations/:conversationId/messages/:messageId', async (request, response) => {
  const conversation = await accessibleConversation(request, request.params.conversationId);
  if (!conversation || !validId(request.params.messageId)) { response.status(404).json({ error: 'Mensagem não encontrada.' }); return; }
  const message = await ConversationMessage.findOne({ _id: request.params.messageId, tenantId: tenantId(request), conversationId: conversation._id });
  if (!message) { response.status(404).json({ error: 'Mensagem não encontrada.' }); return; }
  if (!canDeleteMessage(message.senderProfileId.toString(), selfId(request).toString(), message.createdAt)) { response.status(403).json({ error: 'Você só pode apagar suas mensagens nos primeiros 5 minutos.' }); return; }
  if (!message.deletedAt) { message.content = ''; message.attachment = undefined; message.messageType = 'text'; message.deletedAt = new Date(); await message.save(); }
  response.json(messageJson(message, selfId(request)));
});

messagesAppRouter.patch('/conversations/:conversationId/preferences', async (request, response) => {
  const conversation = await accessibleConversation(request, request.params.conversationId);
  if (!conversation) { response.status(404).json({ error: 'Conversa não encontrada.' }); return; }
  const participant = conversation.participants.find((item) => item.profileId.equals(selfId(request)))!;
  if (typeof request.body?.muted === 'boolean') participant.mutedAt = request.body.muted ? new Date() : undefined;
  if (typeof request.body?.favorite === 'boolean') participant.favorite = request.body.favorite;
  await conversation.save(); response.json({ muted: Boolean(participant.mutedAt), favorite: Boolean(participant.favorite) });
});

messagesAppRouter.post('/conversations/:conversationId/participants', async (request, response) => {
  const conversation = await accessibleConversation(request, request.params.conversationId);
  if (!conversation || conversation.kind !== 'group') { response.status(404).json({ error: 'Grupo não encontrado.' }); return; }
  const me = conversation.participants.find((p) => p.profileId.equals(selfId(request)) && !p.leftAt);
  if (!me || !canManageConversation(me.role, isActiveParticipant(conversation.participants, selfId(request)))) { response.status(403).json({ error: 'Somente administradores podem adicionar participantes.' }); return; }
  const ids: string[] = Array.isArray(request.body?.profileIds) ? [...new Set<string>(request.body.profileIds.filter((id: unknown): id is string => validId(id)))] : [];
  const members = await Character.find({ tenantId: tenantId(request), _id: { $in: ids } }).select('_id accountId').lean();
  const active = await Account.find({ tenantId: tenantId(request), status: 'active', _id: { $in: members.map((p) => p.accountId) } }).select('_id').lean();
  const activeAccounts = new Set(active.map((p) => p._id.toString())); const valid = members.filter((p) => activeAccounts.has(p.accountId.toString()));
  if (valid.length !== ids.length) { response.status(400).json({ error: 'Participantes precisam ser membros ativos desta comunidade.' }); return; }
  for (const item of valid) { const found = conversation.participants.find((p) => p.profileId.equals(item._id)); if (found) found.leftAt = undefined; else conversation.participants.push({ profileId: item._id, role: 'member', joinedAt: new Date() }); }
  await conversation.save(); response.json(await summary(request, conversation));
});

messagesAppRouter.patch('/groups/:conversationId', async (request, response) => {
  const conversation = await accessibleConversation(request, request.params.conversationId);
  if (!conversation || conversation.kind !== 'group') { response.status(404).json({ error: 'Grupo não encontrado.' }); return; }
  const self = conversation.participants.find((p) => p.profileId.equals(selfId(request)) && !p.leftAt);
  if (!self || self.role !== 'admin') { response.status(403).json({ error: 'Somente administradores podem editar este grupo.' }); return; }
  if (typeof request.body?.name === 'string') { const name=request.body.name.trim(); if (name.length<2||name.length>80) { response.status(400).json({error:'O nome deve ter entre 2 e 80 caracteres.'});return;} conversation.name=name; }
  if (typeof request.body?.description === 'string') { const description=request.body.description.trim(); if (description.length>500) { response.status(400).json({error:'A descrição deve ter até 500 caracteres.'});return;} conversation.description=description; }
  if (Object.hasOwn(request.body ?? {}, 'photo')) {
    try { const photo=await attachmentFrom(request.body.photo,request.vybeTenant!.slug); if(photo&&!photo.mimeType.startsWith('image/')) throw new Error('A foto do grupo precisa ser uma imagem.'); conversation.photoUrl=photo?.url??''; }
    catch(error) { response.status(400).json({error:error instanceof Error?error.message:'Foto inválida.'});return; }
  }
  await conversation.save(); response.json(await summary(request,conversation));
});

messagesAppRouter.patch('/groups/:conversationId/participants/:profileId', async (request, response) => {
  const conversation = await accessibleConversation(request, request.params.conversationId);
  if (!conversation || conversation.kind !== 'group' || !validId(request.params.profileId)) { response.status(404).json({ error: 'Grupo ou participante não encontrado.' }); return; }
  const self = conversation.participants.find((p) => p.profileId.equals(selfId(request)) && !p.leftAt);
  if (!self || self.role !== 'admin') { response.status(403).json({ error: 'Somente administradores podem gerenciar participantes.' }); return; }
  const targetId = new mongoose.Types.ObjectId(request.params.profileId);
  const target = conversation.participants.find((p) => p.profileId.equals(targetId) && !p.leftAt);
  if (!target) { response.status(404).json({ error: 'Participante não encontrado no grupo.' }); return; }
  const action=request.body?.action;
  if (!['admin','member','remove'].includes(action)) { response.status(400).json({error:'Ação inválida.'});return; }
  if (action==='remove') { if(target.role==='admin'&&conversation.participants.filter((p)=>p.role==='admin'&&!p.leftAt).length===1){response.status(400).json({error:'O grupo precisa manter pelo menos um administrador.'});return;} target.leftAt=new Date(); }
  else target.role=action;
  await conversation.save(); response.json(await summary(request,conversation));
});

messagesAppRouter.post('/conversations/:conversationId/leave', async (request, response) => {
  const conversation = await accessibleConversation(request, request.params.conversationId);
  if (!conversation || conversation.kind !== 'group') { response.status(404).json({ error: 'Grupo não encontrado.' }); return; }
  const participant = conversation.participants.find((p) => p.profileId.equals(selfId(request)) && !p.leftAt)!; participant.leftAt = new Date(); await conversation.save(); response.json({ left: true });
});

messagesAppRouter.post('/conversations/:conversationId/block', async (request, response) => {
  const conversation = await accessibleConversation(request, request.params.conversationId);
  if (!conversation || conversation.kind !== 'direct') { response.status(404).json({ error: 'Conversa individual não encontrada.' }); return; }
  const other = conversation.participants.find((p) => !p.profileId.equals(selfId(request)))?.profileId;
  if (!other) { response.status(404).json({ error: 'Contato não encontrado.' }); return; }
  await ConversationBlock.updateOne({ tenantId: tenantId(request), blockerId: selfId(request), blockedId: other }, { $setOnInsert: { tenantId: tenantId(request), blockerId: selfId(request), blockedId: other } }, { upsert: true });
  await MatchBlock.updateOne({ tenantId: tenantId(request), blockerId: selfId(request), blockedId: other }, { $setOnInsert: { tenantId: tenantId(request), blockerId: selfId(request), blockedId: other } }, { upsert: true });
  await Match.updateMany({ tenantId: tenantId(request), status: 'active', $or: [{ profileAId: selfId(request), profileBId: other }, { profileAId: other, profileBId: selfId(request) }] }, { $set: { status: 'blocked' } });
  response.json({ blocked: true });
});

messagesAppRouter.post('/conversations/:conversationId/unblock', async (request, response) => {
  const conversation = await accessibleConversation(request, request.params.conversationId);
  if (!conversation || conversation.kind !== 'direct') { response.status(404).json({ error: 'Conversa individual não encontrada.' }); return; }
  const other = conversation.participants.find((p) => !p.profileId.equals(selfId(request)))?.profileId;
  if (!other) { response.status(404).json({ error: 'Contato não encontrado.' }); return; }
  await Promise.all([
    ConversationBlock.deleteOne({ tenantId: tenantId(request), blockerId: selfId(request), blockedId: other }),
    MatchBlock.deleteOne({ tenantId: tenantId(request), blockerId: selfId(request), blockedId: other }),
  ]);
  response.json({ blocked: false });
});
