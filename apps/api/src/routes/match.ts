import { Router, type NextFunction, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { Account, Character, Notification } from '../models/Social.js';
import { Match, MatchBlock, MatchMessage, MatchProfile, MatchReaction } from '../models/Match.js';
import { Conversation, ConversationMessage } from '../models/Conversation.js';
import { requireSession } from '../middleware/tenant.js';
import { canAccessMatch, canonicalProfilePair, createsMutualMatch, isPositiveMatchReaction, matchDiscoveryFilter, matchFeatureIsEnabled, validMatchAge, type MatchReactionType } from './matchPolicy.js';
import { getOrCreateMatchConversation } from './conversationService.js';
import { emitToProfiles } from '../realtime/chatWebSocket.js';
import { isVerificationActive, VERIFIED_MATCH_BOOST } from '../services/verifiedSocialBenefits.js';
import { resolveProfileCustomization } from '../services/profileCustomization.js';

export const matchRouter = Router();
matchRouter.use(requireSession);
matchRouter.use((request: Request, response: Response, next: NextFunction) => {
  if (!matchFeatureIsEnabled(request.vybeTenant!)) { response.status(403).json({ error: 'O VYBE Match está desativado nesta comunidade.' }); return; }
  next();
});

const tenantId = (request: Request) => request.vybeTenant!._id;
const currentId = (request: Request) => request.vybeCharacter!._id;
const isObjectId = (value: unknown): value is string => typeof value === 'string' && mongoose.isValidObjectId(value);
const positiveTypes = ['like', 'star'];

function identityJson(character: { _id: mongoose.Types.ObjectId; username: string; displayName: string; bio: string; avatarUrl: string; verification?: { status?: string; verifiedAt?: Date; activatedAt?: Date; expiresAt?: Date | null; removedAt?: Date }; profileCustomization?: { nameColor?: string; primaryFontId?: string; secondaryFontId?: string; nameFont?: string; fontId?: string; avatarFrame?: string; profileTheme?: string }; profileCustomizations?: Partial<{ MATCH: { nameColor?: string; primaryFontId?: string; secondaryFontId?: string; nameFont?: string; fontId?: string; avatarFrame?: string; profileTheme?: string } }> }) {
  const verified = isVerificationActive(character.verification);
  return { id: character._id.toString(), username: character.username, displayName: character.displayName, bio: character.bio, avatarUrl: character.avatarUrl, verified, ...(verified ? { profileCustomization: resolveProfileCustomization(character.profileCustomizations, character.profileCustomization, 'MATCH') } : {}) };
}

function profileJson(profile: InstanceType<typeof MatchProfile> | null, character: NonNullable<Request['vybeCharacter']>) {
  return {
    enabled: profile?.enabled ?? false,
    age: profile?.age ?? null,
    bio: profile?.bio ?? '',
    location: profile?.location ?? '',
    interests: profile?.interests ?? [],
    photos: profile?.photos?.length ? profile.photos : character.avatarUrl ? [character.avatarUrl] : [],
  };
}

async function isBlocked(tenant: mongoose.Types.ObjectId, left: mongoose.Types.ObjectId, right: mongoose.Types.ObjectId) {
  return Boolean(await MatchBlock.exists({ tenantId: tenant, $or: [{ blockerId: left, blockedId: right }, { blockerId: right, blockedId: left }] }));
}

async function storeMatchPhoto(value: unknown, slug: string, existing: string[]) {
  if (typeof value !== 'string') throw new Error('Foto inválida.');
  if (existing.includes(value) && (value === existing[existing.length - 1] || new RegExp(`^/media/${slug}/[a-f0-9]{32}\\.(png|jpg|webp)$`).test(value))) return value;
  if (value.length > 2_900_000) throw new Error('Cada foto deve ter no máximo 2 MB.');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Envie uma foto PNG, JPEG ou WebP válida.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Cada foto deve ter no máximo 2 MB.');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : match[1] === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new Error('O arquivo escolhido não corresponde a uma foto válida.');
  const { randomBytes } = await import('node:crypto');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const uploads = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads', slug);
  await mkdir(uploads, { recursive: true });
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
  const filename = `${randomBytes(16).toString('hex')}.${extension}`;
  await writeFile(resolve(uploads, filename), bytes, { flag: 'wx', mode: 0o600 });
  return `/media/${slug}/${filename}`;
}

async function matchSummary(match: InstanceType<typeof Match>, tenant: mongoose.Types.ObjectId, viewerId: mongoose.Types.ObjectId) {
  const otherId = match.profileAId.equals(viewerId) ? match.profileBId : match.profileAId;
  if (await isBlocked(tenant, viewerId, otherId)) return null;
  const conversation = await getOrCreateMatchConversation(tenant, match._id, match.profileAId, match.profileBId);
  const viewerParticipant = conversation.participants.find((item) => item.profileId.equals(viewerId));
  const [character, profile, latest, unreadCount] = await Promise.all([
    Character.findOne({ _id: otherId, tenantId: tenant }).lean(),
    MatchProfile.findOne({ characterId: otherId, tenantId: tenant }).lean(),
    ConversationMessage.findOne({ conversationId: conversation._id, tenantId: tenant }).sort({ createdAt: -1 }).lean(),
    ConversationMessage.countDocuments({ conversationId: conversation._id, tenantId: tenant, senderProfileId: otherId, ...(viewerParticipant?.lastReadAt ? { createdAt: { $gt: viewerParticipant.lastReadAt } } : {}) }),
  ]);
  if (!character) return null;
  if (!await Account.exists({ _id: character.accountId, tenantId: tenant, status: 'active' })) return null;
  return {
    id: match._id.toString(),
    profile: { ...identityJson(character), age: profile?.age ?? null, bio: profile?.bio || character.bio, location: profile?.location ?? '', interests: profile?.interests ?? [], photos: profile?.photos?.length ? profile.photos : character.avatarUrl ? [character.avatarUrl] : [] },
    latestMessage: latest ? { content: latest.content, createdAt: latest.createdAt, own: latest.senderProfileId.equals(viewerId) } : null,
    unreadCount,
    createdAt: match.createdAt,
  };
}

async function activeMatchFor(request: Request, matchId: string) {
  const tenant = tenantId(request);
  if (!isObjectId(matchId)) return null;
  const match = await Match.findOne({ _id: matchId, tenantId: tenant, status: 'active' });
  if (!match) return null;
  if (!canAccessMatch(match, currentId(request), await isBlocked(tenant, match.profileAId, match.profileBId))) return null;
  return match;
}

matchRouter.get('/profile', async (request, response) => {
  const character = request.vybeCharacter!;
  const profile = await MatchProfile.findOne({ tenantId: tenantId(request), characterId: character._id });
  response.json({ identity: identityJson(character), profile: profileJson(profile, character) });
});

matchRouter.patch('/profile', async (request, response) => {
  const tenant = tenantId(request);
  const character = request.vybeCharacter!;
  const body = request.body ?? {};
  const current = await MatchProfile.findOne({ tenantId: tenant, characterId: character._id });
  const age = Object.hasOwn(body, 'age') ? body.age : current?.age ?? null;
  const enabled = Object.hasOwn(body, 'enabled') ? body.enabled : current?.enabled ?? false;
  if (typeof enabled !== 'boolean') { response.status(400).json({ error: 'Escolha se seu perfil aparecerá no Match.' }); return; }
  if (!validMatchAge(age)) { response.status(400).json({ error: 'Idade: informe um número inteiro entre 18 e 120 anos.' }); return; }
  const bio = Object.hasOwn(body, 'bio') ? body.bio : current?.bio ?? '';
  const location = Object.hasOwn(body, 'location') ? body.location : current?.location ?? '';
  const interests = Object.hasOwn(body, 'interests') ? body.interests : current?.interests ?? [];
  if (typeof location !== 'string' || !location.trim() || location.trim().length > 100) { response.status(400).json({ error: 'Localização: informe sua localização, com até 100 caracteres.' }); return; }
  if (typeof bio !== 'string' || !bio.trim() || bio.trim().length > 500) { response.status(400).json({ error: 'Sobre você: escreva uma breve apresentação, com até 500 caracteres.' }); return; }
  if (!Array.isArray(interests) || interests.length > 12 || interests.some((item: unknown) => typeof item !== 'string' || item.trim().length < 1 || item.trim().length > 32)) { response.status(400).json({ error: 'Revise os interesses: informe até 12 itens com até 32 caracteres.' }); return; }
  const photos = Object.hasOwn(body, 'photos') ? body.photos : current?.photos ?? [];
  if (!Array.isArray(photos) || photos.length > 6 || photos.some((photo: unknown) => typeof photo !== 'string' || !photo.trim())) { response.status(400).json({ error: 'Fotos: escolha até 6 fotos válidas para o perfil.' }); return; }
  const photosToSave = photos.length ? photos : character.avatarUrl ? [character.avatarUrl] : [];
  if (!photosToSave.length) { response.status(400).json({ error: 'Fotos: adicione pelo menos uma foto ao perfil.' }); return; }
  let savedPhotos: string[];
  try { savedPhotos = await Promise.all(photosToSave.map((photo: string) => storeMatchPhoto(photo, request.vybeTenant!.slug, [...(current?.photos ?? []), character.avatarUrl]))); }
  catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Não foi possível salvar as fotos.' }); return; }
  const profile = await MatchProfile.findOneAndUpdate({ tenantId: tenant, characterId: character._id }, { $set: { enabled, age, bio: bio.trim(), location: location.trim(), interests: [...new Set(interests.map((item: string) => item.trim()))], photos: savedPhotos } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
  response.json({ identity: identityJson(character), profile: profileJson(profile, character) });
});

matchRouter.get('/discovery', async (request, response) => {
  const tenant = tenantId(request);
  const me = currentId(request);
  const own = await MatchProfile.findOne({ tenantId: tenant, characterId: me }).lean();
  if (!own?.enabled || !validMatchAge(own.age)) { response.json({ enabled: false, profiles: [] }); return; }
  const [reactions, blocks, matches, activeAccounts] = await Promise.all([
    MatchReaction.find({ tenantId: tenant, fromProfileId: me }).select('toProfileId').lean(),
    MatchBlock.find({ tenantId: tenant, $or: [{ blockerId: me }, { blockedId: me }] }).lean(),
    Match.find({ tenantId: tenant, status: { $in: ['active', 'blocked'] }, $or: [{ profileAId: me }, { profileBId: me }] }).lean(),
    Account.find({ tenantId: tenant, status: 'active' }).select('_id').lean(),
  ]);
  const excluded = new Map<string, mongoose.Types.ObjectId>();
  for (const reaction of reactions) excluded.set(reaction.toProfileId.toString(), reaction.toProfileId);
  for (const block of blocks) { const id = block.blockerId.equals(me) ? block.blockedId : block.blockerId; excluded.set(id.toString(), id); }
  for (const match of matches) { const id = match.profileAId.equals(me) ? match.profileBId : match.profileAId; excluded.set(id.toString(), id); }
  const accountIds = activeAccounts.map((account) => account._id);
  const profiles = await MatchProfile.find(matchDiscoveryFilter(tenant, me, [...excluded.values()])).sort({ updatedAt: -1 }).limit(40).lean();
  const validProfiles = profiles.filter((profile) => profile.age && validMatchAge(profile.age));
  const characters = await Character.find({ tenantId: tenant, accountId: { $in: accountIds }, _id: { $in: validProfiles.map((profile) => profile.characterId) } }).lean();
  const characterMap = new Map(characters.map((item) => [item._id.toString(), item]));
  const cards = validProfiles.flatMap((profile) => {
    const person = characterMap.get(profile.characterId.toString());
    if (!person) return [];
    return [{ ...identityJson(person), age: profile.age, bio: profile.bio || person.bio, location: profile.location, interests: profile.interests, photos: profile.photos.length ? profile.photos : person.avatarUrl ? [person.avatarUrl] : [] }];
  });
  const profileUpdatedAt = new Map(validProfiles.map((profile) => [profile.characterId.toString(), profile.updatedAt.getTime()]));
  cards.sort((left, right) => {
    const score = (card: typeof cards[number]) => {
      const updatedAt = profileUpdatedAt.get(card.id) ?? 0;
      const recency = 1 / (1 + Math.max(0, Date.now() - updatedAt) / (7 * 24 * 60 * 60 * 1000));
      return recency * (card.verified ? 1 + VERIFIED_MATCH_BOOST : 1);
    };
    return score(right) - score(left);
  });
  response.json({ enabled: true, profiles: cards });
});

matchRouter.post('/reactions', async (request, response) => {
  const tenant = tenantId(request);
  const fromId = currentId(request);
  const { toProfileId, type } = request.body ?? {};
  if (!isObjectId(toProfileId) || !['like', 'star', 'pass'].includes(type)) { response.status(400).json({ error: 'Ação ou perfil inválido.' }); return; }
  const own = await MatchProfile.findOne({ tenantId: tenant, characterId: fromId, enabled: true });
  if (!own || !validMatchAge(own.age)) { response.status(403).json({ error: 'Ative seu perfil do Match antes de reagir.' }); return; }
  const targetId = new mongoose.Types.ObjectId(toProfileId);
  const target = await MatchProfile.findOne({ tenantId: tenant, characterId: targetId, enabled: true, age: { $gte: 18, $lte: 120 } });
  if (!target || targetId.equals(fromId)) { response.status(404).json({ error: 'Perfil não disponível no Match.' }); return; }
  const targetCharacter = await Character.findOne({ _id: targetId, tenantId: tenant }).select('accountId').lean();
  if (!targetCharacter || !await Account.exists({ tenantId: tenant, _id: targetCharacter.accountId, status: 'active' })) { response.status(404).json({ error: 'Perfil não disponível no Match.' }); return; }
  if (await isBlocked(tenant, fromId, targetId)) { response.status(403).json({ error: 'Esta interação não está disponível.' }); return; }
  const reactionType = type as MatchReactionType;
  const pair = canonicalProfilePair(fromId, targetId);
  const priorActiveMatch = await Match.exists({ tenantId: tenant, ...pair, status: 'active' });
  const matchResult: { value: InstanceType<typeof Match> | null } = { value: null };
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await MatchReaction.updateOne({ tenantId: tenant, fromProfileId: fromId, toProfileId: targetId }, { $set: { type: reactionType } }, { upsert: true, session });
      if (!isPositiveMatchReaction(reactionType)) return;
      const reverse = await MatchReaction.findOne({ tenantId: tenant, fromProfileId: targetId, toProfileId: fromId, type: { $in: positiveTypes } }).session(session).lean();
      if (!reverse || !createsMutualMatch(reactionType, reverse.type as MatchReactionType)) return;
      matchResult.value = await Match.findOneAndUpdate({ tenantId: tenant, ...pair }, { $setOnInsert: { tenantId: tenant, ...pair, status: 'active' } }, { upsert: true, new: true, setDefaultsOnInsert: true, session });
    });
    if (isPositiveMatchReaction(reactionType)) {
      const reverse = await MatchReaction.findOne({ tenantId: tenant, fromProfileId: targetId, toProfileId: fromId, type: { $in: positiveTypes } }).lean();
      if (reverse && createsMutualMatch(reactionType, reverse.type as MatchReactionType) && matchResult.value?.status !== 'active') {
        await session.withTransaction(async () => {
          matchResult.value = await Match.findOneAndUpdate({ tenantId: tenant, ...pair }, { $setOnInsert: { tenantId: tenant, ...pair, status: 'active' } }, { upsert: true, new: true, setDefaultsOnInsert: true, session });
        });
      }
    }
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
    matchResult.value = await Match.findOne({ tenantId: tenant, ...pair, status: 'active' });
  } finally { await session.endSession(); }
  const match = matchResult.value?.status === 'active' ? await matchSummary(matchResult.value, tenant, fromId) : null;
  if (match && !priorActiveMatch) {
    const counterpart = await Character.findOne({ _id: targetId, tenantId: tenant }).select('_id').lean();
    if (counterpart) {
      const notifications = [{ characterId: fromId, actorId: targetId }, { characterId: targetId, actorId: fromId }];
      const outcomes = await Promise.all(notifications.map((item) => Notification.updateOne({ tenantId: tenant, seedKey: `match:${match.id}:${item.characterId.toString()}` }, { $setOnInsert: { tenantId: tenant, characterId: item.characterId, actorId: item.actorId, type: 'match_created', targetId: matchResult.value!._id, seedKey: `match:${match.id}:${item.characterId.toString()}` } }, { upsert: true }).catch(() => null)));
      if (outcomes.some((outcome: any) => outcome?.upsertedCount)) emitToProfiles(tenant.toString(), [fromId, targetId], { type: 'match:new', matchId: match.id });
    }
  }
  response.json({ reaction: reactionType, match });
});

matchRouter.get('/matches', async (request, response) => {
  const tenant = tenantId(request);
  const me = currentId(request);
  const matches = await Match.find({ tenantId: tenant, status: 'active', $or: [{ profileAId: me }, { profileBId: me }] }).sort({ updatedAt: -1 }).limit(100);
  const summaries = await Promise.all(matches.map((match) => matchSummary(match, tenant, me)));
  response.json(summaries.filter(Boolean));
});

matchRouter.post('/profiles/:profileId/block', async (request, response) => {
  const tenant = tenantId(request);
  const me = currentId(request);
  if (!isObjectId(request.params.profileId) || request.params.profileId === me.toString()) { response.status(400).json({ error: 'Perfil inválido.' }); return; }
  const otherId = new mongoose.Types.ObjectId(request.params.profileId);
  const target = await MatchProfile.findOne({ tenantId: tenant, characterId: otherId });
  const character = await Character.findOne({ _id: otherId, tenantId: tenant }).select('accountId').lean();
  if (!target || !character || !await Account.exists({ _id: character.accountId, tenantId: tenant, status: 'active' })) { response.status(404).json({ error: 'Perfil não encontrado nesta comunidade.' }); return; }
  const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
    await MatchBlock.updateOne({ tenantId: tenant, blockerId: me, blockedId: otherId }, { $setOnInsert: { tenantId: tenant, blockerId: me, blockedId: otherId } }, { upsert: true, session });
    await Match.updateOne({ tenantId: tenant, $or: [{ profileAId: me, profileBId: otherId }, { profileAId: otherId, profileBId: me }], status: 'active' }, { $set: { status: 'blocked' } }, { session });
  }); } finally { await session.endSession(); }
  response.json({ blocked: true });
});

matchRouter.get('/matches/:matchId/messages', async (request, response) => {
  const match = await activeMatchFor(request, request.params.matchId);
  if (!match) { response.status(404).json({ error: 'Conversa de Match não encontrada.' }); return; }
  const me = currentId(request);
  const conversation = await getOrCreateMatchConversation(tenantId(request), match._id, match.profileAId, match.profileBId);
  const messages = await ConversationMessage.find({ tenantId: tenantId(request), conversationId: conversation._id }).sort({ createdAt: 1 }).limit(200).lean();
  const viewer = conversation.participants.find((item) => item.profileId.equals(me));
  const other = conversation.participants.find((item) => !item.profileId.equals(me));
  const readAt = new Date();
  if (viewer) { viewer.lastReadAt = readAt; await conversation.save(); }
  response.json(messages.map((message) => ({ id: message._id.toString(), senderProfileId: message.senderProfileId.toString(), recipientProfileId: other?.profileId.toString(), content: message.content, createdAt: message.createdAt, readAt: message.senderProfileId.equals(me) && other?.lastReadAt && other.lastReadAt > message.createdAt ? other.lastReadAt : null, own: message.senderProfileId.equals(me) })));
});

matchRouter.post('/matches/:matchId/messages', async (request, response) => {
  const match = await activeMatchFor(request, request.params.matchId);
  if (!match) { response.status(404).json({ error: 'Conversa de Match não encontrada.' }); return; }
  const me = currentId(request);
  const recipientId = match.profileAId.equals(me) ? match.profileBId : match.profileAId;
  const content = typeof request.body?.content === 'string' ? request.body.content.trim() : '';
  if (!content || content.length > 1000) { response.status(400).json({ error: 'Escreva uma mensagem de até 1.000 caracteres.' }); return; }
  const [sender, recipient] = await Promise.all([
    Character.findOne({ _id: me, tenantId: tenantId(request), accountId: request.vybeAccount!._id }).select('_id').lean(),
    Character.findOne({ _id: recipientId, tenantId: tenantId(request) }).select('accountId').lean(),
  ]);
  const recipientActive = recipient && await Account.exists({ _id: recipient.accountId, tenantId: tenantId(request), status: 'active' });
  if (!sender || !recipientActive) { response.status(403).json({ error: 'Esta conversa não está disponível.' }); return; }
  const conversation = await getOrCreateMatchConversation(tenantId(request), match._id, match.profileAId, match.profileBId);
  const messageResult: { value: InstanceType<typeof ConversationMessage> | null } = { value: null };
  let denied = false;
  const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
    const latestMatch = await Match.findOne({ _id: match._id, tenantId: tenantId(request), status: 'active', $or: [{ profileAId: me }, { profileBId: me }] }).session(session);
    if (!latestMatch) { denied = true; return; }
    if (await MatchBlock.exists({ tenantId: tenantId(request), $or: [{ blockerId: me, blockedId: recipientId }, { blockerId: recipientId, blockedId: me }] }).session(session)) { denied = true; return; }
    await Match.updateOne({ _id: latestMatch._id, tenantId: tenantId(request), status: 'active' }, { $set: { updatedAt: new Date() } }, { session });
    const [created] = await ConversationMessage.create([{ tenantId: tenantId(request), conversationId: conversation._id, senderProfileId: me, content, messageType: 'text' }], { session });
    await Conversation.updateOne({ _id: conversation._id, tenantId: tenantId(request) }, { $set: { lastMessageAt: created.createdAt } }, { session });
    messageResult.value = created;
  }); } finally { await session.endSession(); }
  const message = messageResult.value;
  if (denied || !message) { response.status(403).json({ error: 'Esta conversa não está disponível.' }); return; }
  const recipientParticipant = conversation.participants.find((item) => item.profileId.equals(recipientId));
  if (!recipientParticipant?.mutedAt) await Notification.create({ tenantId: tenantId(request), characterId: recipientId, actorId: me, type: 'message', targetId: message._id });
  emitToProfiles(tenantId(request).toString(), [recipientId], { type: 'match:message', matchId: match._id.toString(), conversationId: conversation._id.toString(), messageId: message._id.toString() });
  response.status(201).json({ id: message._id.toString(), senderProfileId: me.toString(), recipientProfileId: recipientId.toString(), content: message.content, createdAt: message.createdAt, readAt: null, own: true });
});

matchRouter.post('/matches/:matchId/block', async (request, response) => {
  const tenant = tenantId(request);
  if (!isObjectId(request.params.matchId)) { response.status(400).json({ error: 'Match inválido.' }); return; }
  const match = await Match.findOne({ _id: request.params.matchId, tenantId: tenant, $or: [{ profileAId: currentId(request) }, { profileBId: currentId(request) }] });
  if (!match) { response.status(404).json({ error: 'Match não encontrado.' }); return; }
  const otherId = match.profileAId.equals(currentId(request)) ? match.profileBId : match.profileAId;
  const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
    await MatchBlock.updateOne({ tenantId: tenant, blockerId: currentId(request), blockedId: otherId }, { $setOnInsert: { tenantId: tenant, blockerId: currentId(request), blockedId: otherId } }, { upsert: true, session });
    await Match.updateOne({ _id: match._id, tenantId: tenant }, { $set: { status: 'blocked' } }, { session });
  }); } finally { await session.endSession(); }
  response.status(204).end();
});
