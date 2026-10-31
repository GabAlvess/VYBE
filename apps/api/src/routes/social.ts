import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Account, Character, Comment, CommunityEvent, EventRSVP, Follow, Like, Notification, Post, Repost, SavedPost, Story, StoryView } from '../models/Social.js';
import { CommunityAudit } from '../models/CommunityAudit.js';
import { canJoinEvent, canSeeEvent, eventCreationDecision } from './eventPolicy.js';
import { requireSession, tenantScope } from '../middleware/tenant.js';
import { WalletTransaction } from '../models/Wallet.js';
import { EchoAppProfile } from '../models/EchoAppProfile.js';
import { Community } from '../models/Community.js';
import { CommunityJoinRequest } from '../models/CommunityJoinRequest.js';

export const socialRouter = Router();
socialRouter.use(requireSession);
const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads');

function tenantId(request: Request) { return request.vybeTenant!._id; }
function activeCharacter(request: Request) { return request.vybeCharacter!; }
function badRequest(response: Response, message: string) { response.status(400).json({ error: message }); }

async function notifyMentions(tenant: mongoose.Types.ObjectId, content: string, actor: mongoose.Types.ObjectId, targetId: mongoose.Types.ObjectId, type: 'mention' | 'echo_mention' = 'mention') {
  const usernames = [...new Set([...content.matchAll(/@([a-zA-Z0-9._]{3,24})(?![a-zA-Z0-9._])/g)].map((match) => match[1].toLowerCase()))];
  if (!usernames.length) return;
  const accounts = await Account.find({ tenantId: tenant, status: 'active' }).select('_id').lean();
  const mentioned = await Character.find({ tenantId: tenant, accountId: { $in: accounts.map((account) => account._id) }, username: { $in: usernames }, _id: { $ne: actor } }).select('_id').lean();
  if (mentioned.length) await Notification.insertMany(mentioned.map((character) => ({ tenantId: tenant, characterId: character._id, actorId: actor, type, targetId })));
}

function characterJson(character: { _id: mongoose.Types.ObjectId; username: string; displayName: string; communityFunction?: string; bio: string; avatarUrl: string; coverUrl: string; followerCount: number; followingCount: number; postCount: number; verification?: { verifiedAt?: Date; removedAt?: Date } }) {
  return { id: character._id.toString(), username: character.username, displayName: character.displayName, communityFunction: character.communityFunction ?? '', bio: character.bio, avatarUrl: character.avatarUrl, coverUrl: character.coverUrl, followerCount: character.followerCount, followingCount: character.followingCount, postCount: character.postCount, verified: Boolean(character.verification?.verifiedAt && !character.verification.removedAt) };
}

function echoIdentity(character: Parameters<typeof characterJson>[0], profile?: { displayName?: string; bio?: string; avatarUrl?: string }) {
  return { ...characterJson(character), displayName: profile?.displayName || character.displayName, bio: profile ? profile.bio ?? '' : character.bio, avatarUrl: profile?.avatarUrl || character.avatarUrl };
}

function isCommunityAdmin(request: Request) {
  const tenant = request.vybeTenant!;
  const account = request.vybeAccount!;
  const platformSlug = process.env.VYBE_PLATFORM_TENANT_SLUG ?? 'community';
  const configuredPlatformAdmin = tenant.slug === platformSlug
    && (process.env.VYBE_PLATFORM_ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean).includes(account.email.toLowerCase());
  return tenant.admins.some((adminId) => adminId.equals(account._id)) || tenant.moderators.some((staffId) => staffId.equals(account._id)) || configuredPlatformAdmin;
}

function isOwnerOrAdmin(request: Request) {
  const tenant = request.vybeTenant!;
  const account = request.vybeAccount!;
  const platformSlug = process.env.VYBE_PLATFORM_TENANT_SLUG ?? 'community';
  const platformAdmin = tenant.slug === platformSlug && (process.env.VYBE_PLATFORM_ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).includes(account.email.toLowerCase());
  return tenant.ownerAccountId?.equals(account._id) === true || tenant.admins.some((id) => id.equals(account._id)) || platformAdmin;
}

function eventStatusPublic(status: string) { return status === 'approved' || status === 'upcoming'; }
function eventStatusLabel(status: string) { return ({ draft: 'Rascunho', pending_approval: 'Aguardando aprovação', approved: 'Aprovado', upcoming: 'Aprovado', rejected: 'Recusado', cancelled: 'Cancelado', completed: 'Finalizado', changes_requested: 'Ajustes solicitados' } as Record<string, string>)[status] ?? status; }
async function eventSummary(event: any, request: Request) {
  const tenant = tenantId(request);
  const character = activeCharacter(request);
  const [creator, rsvpCount, mine] = await Promise.all([
    event.creatorCharacterId ? Character.findOne(tenantScope(tenant, { _id: event.creatorCharacterId })).lean() : Promise.resolve(null),
    EventRSVP.countDocuments({ tenantId: tenant, eventId: event._id, status: 'going' }),
    EventRSVP.findOne({ tenantId: tenant, eventId: event._id, characterId: character._id }).select('status').lean(),
  ]);
  return { id: event._id.toString(), title: event.title, description: event.description, startsAt: event.startsAt, endsAt: event.endsAt, location: event.location, imageUrl: event.imageUrl, category: event.category ?? 'outro', participantLimit: event.participantLimit ?? null, allowComments: event.allowComments ?? true, status: event.status, statusLabel: eventStatusLabel(event.status), official: Boolean(event.official), rejectedReason: event.rejectedReason ?? '', cancellationReason: event.cancellationReason ?? '', reviewedAt: event.reviewedAt, createdAt: event.createdAt, updatedAt: event.updatedAt, confirmedCount: rsvpCount, going: mine?.status === 'going', rsvpStatus: mine?.status ?? null, canManage: isOwnerOrAdmin(request), canEdit: Boolean(event.creatorCharacterId?.equals(character._id)) || isOwnerOrAdmin(request), creator: creator ? { id: creator._id.toString(), username: creator.username, displayName: creator.displayName, communityFunction: creator.communityFunction ?? '', bio: creator.bio ?? '', avatarUrl: creator.avatarUrl } : null };
}

async function notifyCharacters(tenant: mongoose.Types.ObjectId, actorId: mongoose.Types.ObjectId, targetId: mongoose.Types.ObjectId, type: 'event_created' | 'event_updated' | 'event_cancelled' | 'event_review' | 'event_pending', characterIds?: mongoose.Types.ObjectId[]) {
  const recipients = characterIds ?? (await Character.find({ tenantId: tenant }).select('_id accountId').lean()).map((character) => character._id);
  if (!recipients.length) return;
  const accounts = await Character.find({ tenantId: tenant, _id: { $in: recipients } }).select('_id accountId').lean();
  const activeAccounts = await Account.find({ tenantId: tenant, _id: { $in: accounts.map((item) => item.accountId) }, status: 'active' }).select('_id').lean();
  const activeIds = new Set(activeAccounts.map((item) => item._id.toString()));
  const notified = accounts.filter((item) => activeIds.has(item.accountId.toString())).map((item) => item._id).filter((id) => !id.equals(actorId));
  if (notified.length) await Notification.insertMany(notified.map((characterId) => ({ tenantId: tenant, characterId, actorId, targetId, type })));
}

function eventInput(body: any) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const location = typeof body.location === 'string' ? body.location.trim() : '';
  const startsAt = new Date(body.startsAt);
  const endsAt = body.endsAt ? new Date(body.endsAt) : undefined;
  const category = typeof body.category === 'string' ? body.category : 'outro';
  const participantLimit = body.participantLimit === '' || body.participantLimit == null ? null : Number(body.participantLimit);
  if (title.length < 3 || title.length > 120 || description.length < 10 || description.length > 3000 || location.length < 2 || location.length > 160 || !Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now() || (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt <= startsAt)) || !['social', 'roleplay', 'academico', 'reuniao', 'treinamento', 'plantao', 'festa', 'competicao', 'outro'].includes(category) || (participantLimit !== null && (!Number.isInteger(participantLimit) || participantLimit < 1 || participantLimit > 10000)) || typeof body.allowComments !== 'boolean') return null;
  return { title, description, location, startsAt, ...(endsAt ? { endsAt } : {}), category, participantLimit, allowComments: body.allowComments };
}

async function saveEventImage(value: unknown, slug: string) {
  if (typeof value !== 'string' || value.length > 4_300_000) throw new Error('A capa deve ter no máximo 3 MB.');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Envie uma imagem PNG, JPEG ou WebP válida.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 3 * 1024 * 1024) throw new Error('A capa deve ter no máximo 3 MB.');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : match[1] === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new Error('O arquivo escolhido não corresponde a uma imagem válida.');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const filename = `${randomBytes(16).toString('hex')}.${ext}`;
  await mkdir(resolve(uploadsDirectory, slug), { recursive: true });
  await writeFile(resolve(uploadsDirectory, slug, filename), bytes, { flag: 'wx', mode: 0o600 });
  return `/media/${slug}/${filename}`;
}

function postJson(post: { _id: mongoose.Types.ObjectId; characterId: mongoose.Types.ObjectId; content: string; imageUrl: string; imageUrls?: string[]; kind: 'post' | 'pulse'; likesCount: number; commentsCount: number; createdAt: Date }, author: ReturnType<typeof characterJson> | undefined, liked: boolean, canDelete = false, saved = false, repostCount = 0, reposted = false) {
  const images = post.imageUrls?.length ? post.imageUrls : post.imageUrl ? [post.imageUrl] : [];
  return { id: post._id.toString(), content: post.content, imageUrl: images[0] ?? '', imageUrls: images, kind: post.kind, likesCount: post.likesCount, commentsCount: post.commentsCount, repostCount, reposted, createdAt: post.createdAt, liked, saved, canDelete, author };
}

async function feedResponse(request: Request, response: Response, kind: 'post' | 'pulse') {
  if (!request.vybeTenant!.settings?.features?.[kind === 'pulse' ? 'pulse' : 'feed']) { response.status(403).json({ error: `O ${kind === 'pulse' ? 'Echo' : 'Social'} está desativado nesta comunidade.` }); return; }
  const tenant = tenantId(request);
  const character = activeCharacter(request);
  const tab = typeof request.query.tab === 'string' ? request.query.tab : 'for-you';
  let authorIds: mongoose.Types.ObjectId[] | undefined;
  if (tab === 'following') {
    const follows = await Follow.find({ tenantId: tenant, followerId: character._id }).select('followedId').lean();
    authorIds = follows.map((follow) => follow.followedId);
    authorIds.push(character._id);
  }
  const activeAccounts = await Account.find({ tenantId: tenant, status: 'active' }).select('_id').lean();
  const activeCharacters = await Character.find({ tenantId: tenant, accountId: { $in: activeAccounts.map((account) => account._id) } }).distinct('_id');
  const visibleAuthorIds = authorIds ? authorIds.filter((id) => activeCharacters.some((activeId) => activeId.equals(id))) : activeCharacters;
  const query: Record<string, unknown> = tenantScope(tenant, {
    kind: kind === 'post' ? 'post' : 'pulse',
  });
  query.characterId = { $in: visibleAuthorIds };
  const posts = await Post.find(query).sort({ createdAt: -1 }).limit(50).lean();
  const ids = [...new Set(posts.map((post) => post.characterId.toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const authors = await Character.find({ _id: { $in: ids }, tenantId: tenant }).lean();
  const authorMap = new Map(authors.map((author) => [author._id.toString(), author]));
  const echoProfiles = kind === 'pulse' ? await EchoAppProfile.find({ tenantId: tenant, characterId: { $in: ids } }).lean() : [];
  const echoProfileMap = new Map(echoProfiles.map((profile) => [profile.characterId.toString(), profile]));
  const postIds = posts.map((post) => post._id);
  const [likedPosts, savedPosts, reposts] = await Promise.all([
    Like.find({ tenantId: tenant, characterId: character._id, postId: { $in: postIds } }).select('postId').lean(),
    SavedPost.find({ tenantId: tenant, characterId: character._id, postId: { $in: postIds } }).select('postId').lean(),
    Repost.aggregate([
      { $match: { tenantId: tenant, postId: { $in: postIds } } },
      { $group: { _id: '$postId', count: { $sum: 1 }, mine: { $sum: { $cond: [{ $eq: ['$characterId', character._id] }, 1, 0] } } } },
    ]),
  ]);
  const likedSet = new Set(likedPosts.map((like) => like.postId.toString()));
  const savedSet = new Set(savedPosts.map((item) => item.postId.toString()));
  const repostMap = new Map(reposts.map((item) => [item._id.toString(), { count: item.count as number, mine: (item.mine as number) > 0 }]));
  const admin = isCommunityAdmin(request);
  response.json(posts.map((post) => {
    const author = authorMap.get(post.characterId.toString());
    const repost = repostMap.get(post._id.toString());
    const identity = author ? kind === 'pulse' ? echoIdentity(author, echoProfileMap.get(author._id.toString())) : characterJson(author) : undefined;
    return postJson(post, identity, likedSet.has(post._id.toString()), admin || author?.accountId.equals(request.vybeAccount!._id) === true, savedSet.has(post._id.toString()), repost?.count ?? 0, repost?.mine ?? false);
  }));
}

socialRouter.get('/feed', (request, response) => feedResponse(request, response, 'post'));
socialRouter.get('/pulso', (request, response) => feedResponse(request, response, 'pulse'));

socialRouter.get('/echo/trends', async (request, response) => {
  if (!request.vybeTenant!.settings?.features?.pulse) { response.status(403).json({ error: 'O Echo está desativado nesta comunidade.' }); return; }
  const tenant = tenantId(request);
  const recent = await Post.find(tenantScope(tenant, { kind: 'pulse', createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } })).select('content').limit(1000).lean();
  const counts = new Map<string, number>();
  for (const post of recent) for (const match of post.content.matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) {
    const tag = match[1].toLocaleLowerCase('pt-BR'); counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  response.json([...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([tag, count]) => ({ tag, count })));
});

socialRouter.get('/echo/explore', async (request, response) => {
  if (!request.vybeTenant!.settings?.features?.pulse) { response.status(403).json({ error: 'O Echo está desativado nesta comunidade.' }); return; }
  const tenant = tenantId(request); const current = activeCharacter(request);
  const q = typeof request.query.q === 'string' ? request.query.q.trim().replace(/^#/, '').slice(0, 80) : '';
  const activeAccounts = await Account.find({ tenantId: tenant, status: 'active' }).select('_id').lean();
  const activeIds = activeAccounts.map((item) => item._id);
  const expression = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const selector: Record<string, unknown> = tenantScope(tenant, { kind: 'pulse', characterId: { $in: activeIds } });
  if (expression) {
    const [matchingPeople, matchingEchoProfiles] = await Promise.all([
      Character.find(tenantScope(tenant, { accountId: { $in: activeIds }, $or: [{ displayName: expression }, { username: expression }] })).select('_id').lean(),
      EchoAppProfile.find({ tenantId: tenant, displayName: expression }).select('characterId').lean(),
    ]);
    const matchingIds = [...new Set([...matchingPeople.map((item) => item._id.toString()), ...matchingEchoProfiles.map((item) => item.characterId.toString())])].map((id) => new mongoose.Types.ObjectId(id));
    selector.$or = [{ content: expression }, { characterId: { $in: matchingIds } }];
  }
  const posts = await Post.find(selector).sort({ likesCount: -1, createdAt: -1 }).limit(60).lean();
  const authors = await Character.find(tenantScope(tenant, { _id: { $in: posts.map((post) => post.characterId) }, accountId: { $in: activeIds } })).lean();
  const authorMap = new Map(authors.map((item) => [item._id.toString(), item]));
  const echoProfiles = await EchoAppProfile.find({ tenantId: tenant, characterId: { $in: authors.map((item) => item._id) } }).lean();
  const echoProfileMap = new Map(echoProfiles.map((item) => [item.characterId.toString(), item]));
  const ids = posts.map((item) => item._id);
  const [likes, saves, follows, reposts] = await Promise.all([
    Like.find({ tenantId: tenant, characterId: current._id, postId: { $in: ids } }).select('postId').lean(),
    SavedPost.find({ tenantId: tenant, characterId: current._id, postId: { $in: ids } }).select('postId').lean(),
    Follow.find({ tenantId: tenant, followerId: current._id }).select('followedId').lean(),
    Repost.aggregate([
      { $match: { tenantId: tenant, postId: { $in: ids } } },
      { $group: { _id: '$postId', count: { $sum: 1 }, mine: { $sum: { $cond: [{ $eq: ['$characterId', current._id] }, 1, 0] } } } },
    ]),
  ]);
  const likedSet = new Set(likes.map((item) => item.postId.toString())); const savedSet = new Set(saves.map((item) => item.postId.toString()));
  const followedSet = new Set(follows.map((item) => item.followedId.toString()));
  const repostMap = new Map(reposts.map((item) => [item._id.toString(), { count: item.count as number, mine: (item.mine as number) > 0 }]));
  const peopleSelector: Record<string, unknown> = tenantScope(tenant, { _id: { $ne: current._id }, accountId: { $in: activeIds } });
  if (expression) peopleSelector.$or = [{ displayName: expression }, { username: expression }];
  const suggested = await Character.find(peopleSelector).sort({ followerCount: -1, createdAt: -1 }).limit(4).lean();
  const suggestedProfiles = await EchoAppProfile.find({ tenantId: tenant, characterId: { $in: suggested.map((item) => item._id) } }).lean();
  const suggestedProfileMap = new Map(suggestedProfiles.map((item) => [item.characterId.toString(), item]));
  const people = suggested.map((item) => ({ ...echoIdentity(item, suggestedProfileMap.get(item._id.toString())), following: followedSet.has(item._id.toString()) }));
  response.json({ people, posts: posts.flatMap((post) => { const author = authorMap.get(post.characterId.toString()); const repost = repostMap.get(post._id.toString()); return author ? [postJson(post, echoIdentity(author, echoProfileMap.get(author._id.toString())), likedSet.has(post._id.toString()), author.accountId.equals(request.vybeAccount!._id) || isCommunityAdmin(request), savedSet.has(post._id.toString()), repost?.count ?? 0, repost?.mine ?? false)] : []; }) });
});

socialRouter.get('/echo/profile', async (request, response) => {
  if (request.vybeTenant!.settings?.features?.pulse === false) { response.status(403).json({ error: 'O Echo está desativado nesta comunidade.' }); return; }
  const character = activeCharacter(request);
  const profile = await EchoAppProfile.findOne({ tenantId: tenantId(request), characterId: character._id }).lean();
  response.json({ profile: echoIdentity(character, profile ?? undefined) });
});

socialRouter.patch('/echo/profile', async (request, response) => {
  if (request.vybeTenant!.settings?.features?.pulse === false) { response.status(403).json({ error: 'O Echo está desativado nesta comunidade.' }); return; }
  const tenant = tenantId(request);
  const character = activeCharacter(request);
  const current = await EchoAppProfile.findOne({ tenantId: tenant, characterId: character._id });
  const displayName = typeof request.body?.displayName === 'string' ? request.body.displayName.trim() : current?.displayName || character.displayName;
  const bio = typeof request.body?.bio === 'string' ? request.body.bio.trim() : current?.bio ?? character.bio;
  if (!displayName || displayName.length > 60 || bio.length > 300) { badRequest(response, 'O nome deve ter até 60 caracteres e a bio, até 300.'); return; }
  let avatarUrl = current?.avatarUrl ?? '';
  if (Object.hasOwn(request.body ?? {}, 'photo')) {
    if (request.body.photo === null) avatarUrl = '';
    else {
      try { avatarUrl = await saveEventImage(request.body.photo, request.vybeTenant!.slug); }
      catch (error) { badRequest(response, error instanceof Error ? error.message : 'Não foi possível salvar a foto.'); return; }
    }
  }
  const profile = await EchoAppProfile.findOneAndUpdate({ tenantId: tenant, characterId: character._id }, { $set: { displayName, bio, avatarUrl } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
  response.json({ profile: echoIdentity(character, profile) });
});

socialRouter.get('/echo/profile/:username', async (request, response) => {
  if (!request.vybeTenant!.settings?.features?.pulse) { response.status(403).json({ error: 'O Echo está desativado nesta comunidade.' }); return; }
  const tenant = tenantId(request); const current = activeCharacter(request);
  const character = await Character.findOne(tenantScope(tenant, { username: String(request.params.username).toLowerCase() })).lean();
  if (!character) { response.status(404).json({ error: 'Perfil não encontrado nesta comunidade.' }); return; }
  const account = await Account.findOne({ _id: character.accountId, tenantId: tenant, status: 'active' }).select('_id').lean();
  if (!account) { response.status(404).json({ error: 'Perfil não encontrado nesta comunidade.' }); return; }
  const echoProfile = await EchoAppProfile.findOne({ tenantId: tenant, characterId: character._id }).lean();
  const identity = { ...echoIdentity(character, echoProfile ?? undefined), own: character.accountId.equals(request.vybeAccount!._id) };
  const follows = await Follow.exists({ tenantId: tenant, followerId: current._id, followedId: character._id });
  const posts = await Post.find(tenantScope(tenant, { characterId: character._id, kind: 'pulse' })).sort({ createdAt: -1 }).limit(50).lean();
  const ids = posts.map((item) => item._id);
  const [likes, saves, reposts] = await Promise.all([
    Like.find({ tenantId: tenant, characterId: current._id, postId: { $in: ids } }).select('postId').lean(),
    SavedPost.find({ tenantId: tenant, characterId: current._id, postId: { $in: ids } }).select('postId').lean(),
    Repost.aggregate([
      { $match: { tenantId: tenant, postId: { $in: ids } } },
      { $group: { _id: '$postId', count: { $sum: 1 }, mine: { $sum: { $cond: [{ $eq: ['$characterId', current._id] }, 1, 0] } } } },
    ]),
  ]);
  const likedSet = new Set(likes.map((item) => item.postId.toString())); const savedSet = new Set(saves.map((item) => item.postId.toString()));
  const repostMap = new Map(reposts.map((item) => [item._id.toString(), { count: item.count as number, mine: (item.mine as number) > 0 }]));
  response.json({ profile: { ...identity, following: Boolean(follows) }, posts: posts.map((post) => { const repost = repostMap.get(post._id.toString()); return postJson(post, identity, likedSet.has(post._id.toString()), character.accountId.equals(request.vybeAccount!._id) || isCommunityAdmin(request), savedSet.has(post._id.toString()), repost?.count ?? 0, repost?.mine ?? false); }) });
});

socialRouter.post('/posts', async (request, response) => createPost(request, response, 'post'));
socialRouter.post('/pulso', async (request, response) => createPost(request, response, 'pulse'));

socialRouter.put('/posts/:postId/repost', async (request, response) => {
  if (!request.vybeTenant!.settings?.features?.pulse) { response.status(403).json({ error: 'O Echo está desativado nesta comunidade.' }); return; }
  if (!mongoose.isValidObjectId(request.params.postId)) { badRequest(response, 'Echo inválido.'); return; }
  const tenant = tenantId(request); const character = activeCharacter(request);
  const post = await Post.findOne(tenantScope(tenant, { _id: request.params.postId, kind: 'pulse' }));
  if (!post) { response.status(404).json({ error: 'Echo não encontrado nesta comunidade.' }); return; }
  const comment = typeof request.body?.comment === 'string' ? request.body.comment.trim() : '';
  if (comment.length > 500) { badRequest(response, 'O comentário do repost deve ter até 500 caracteres.'); return; }
  await Repost.updateOne({ tenantId: tenant, postId: post._id, characterId: character._id }, { $setOnInsert: { tenantId: tenant, postId: post._id, characterId: character._id, comment } }, { upsert: true });
  if (!post.characterId.equals(character._id)) await Notification.updateOne({ tenantId: tenant, characterId: post.characterId, actorId: character._id, type: 'repost', targetId: post._id }, { $set: { createdAt: new Date(), readAt: undefined }, $setOnInsert: { tenantId: tenant, characterId: post.characterId, actorId: character._id, type: 'repost', targetId: post._id } }, { upsert: true });
  response.json({ reposted: true, repostCount: await Repost.countDocuments({ tenantId: tenant, postId: post._id }) });
});

socialRouter.delete('/posts/:postId/repost', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.postId)) { badRequest(response, 'Echo inválido.'); return; }
  const tenant = tenantId(request); const character = activeCharacter(request);
  await Repost.deleteOne({ tenantId: tenant, postId: request.params.postId, characterId: character._id });
  response.json({ reposted: false });
});

async function createPost(request: Request, response: Response, kind: 'post' | 'pulse') {
  if (!request.vybeTenant!.settings?.features?.[kind === 'pulse' ? 'pulse' : 'feed']) { response.status(403).json({ error: `O ${kind === 'pulse' ? 'Echo' : 'Social'} está desativado nesta comunidade.` }); return; }
  const content = typeof request.body?.content === 'string' ? request.body.content.trim() : '';
  const configuredLimit = request.vybeTenant!.settings?.moderation?.maxPostLength ?? 5000;
  const limit = kind === 'pulse' ? Math.min(500, configuredLimit) : configuredLimit;
  const imageInputs: string[] = Array.isArray(request.body?.images)
    ? request.body.images
    : typeof request.body?.image === 'string' && request.body.image ? [request.body.image] : [];
  if (imageInputs.length > 4 || imageInputs.some((image) => typeof image !== 'string')) { badRequest(response, 'Escolha até 4 imagens para a publicação.'); return; }
  if (content.length > limit || (!content && !imageInputs.length) || (kind === 'post' && !imageInputs.length)) { badRequest(response, `Adicione uma imagem${kind === 'post' ? '' : ' ou escreva um texto'} e use até ${limit} caracteres na legenda.`); return; }
  const imageUrls: string[] = [];
  try {
    for (const image of imageInputs) imageUrls.push(await saveEventImage(image, request.vybeTenant!.slug));
  } catch (error) {
    badRequest(response, error instanceof Error ? error.message : 'Envie imagens PNG, JPEG ou WebP válidas de até 3 MB cada.'); return;
  }
  const tenant = tenantId(request);
  const character = activeCharacter(request);
  const owner = await Character.findOne({ _id: character._id, tenantId: tenant, accountId: request.vybeAccount!._id });
  if (!owner) { response.status(403).json({ error: 'Esta identidade não pertence à sua conta nesta comunidade.' }); return; }
  const post = await Post.create({ tenantId: tenant, characterId: owner._id, content, imageUrl: imageUrls[0] ?? '', imageUrls, kind });
  await Character.updateOne({ _id: owner._id, tenantId: tenant, accountId: request.vybeAccount!._id }, { $inc: { postCount: 1 } });
  await notifyMentions(tenant, content, owner._id, post._id, kind === 'pulse' ? 'echo_mention' : 'mention');
  response.status(201).json(postJson(post, characterJson(owner), false, true));
}

socialRouter.delete('/posts/:postId', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.postId)) { badRequest(response, 'Publicação inválida.'); return; }
  const tenant = tenantId(request);
  const post = await Post.findOne({ _id: request.params.postId, tenantId: tenant });
  if (!post) { response.status(404).json({ error: 'Publicação não encontrada nesta comunidade.' }); return; }
  const author = await Character.findOne({ _id: post.characterId, tenantId: tenant }).select('accountId').lean();
  const ownPost = Boolean(author?.accountId.equals(request.vybeAccount!._id));
  if (!ownPost && !isCommunityAdmin(request)) { response.status(403).json({ error: 'Você só pode excluir suas próprias publicações.' }); return; }

  await Post.deleteOne({ _id: post._id, tenantId: tenant });
  await Promise.all([
    Like.deleteMany({ tenantId: tenant, postId: post._id }),
    Comment.deleteMany({ tenantId: tenant, postId: post._id }),
    SavedPost.deleteMany({ tenantId: tenant, postId: post._id }),
    Repost.deleteMany({ tenantId: tenant, postId: post._id }),
    Notification.deleteMany({ tenantId: tenant, targetId: post._id, type: { $in: ['like', 'comment', 'echo_reply', 'repost', 'mention'] } }),
    Character.updateOne({ _id: post.characterId, tenantId: tenant, postCount: { $gt: 0 } }, { $inc: { postCount: -1 } }),
  ]);
  response.status(204).end();
});

socialRouter.put('/posts/:postId/like', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.postId)) { badRequest(response, 'Publicação inválida.'); return; }
  const tenant = tenantId(request);
  const character = activeCharacter(request);
  const post = await Post.findOne(tenantScope(tenant, { _id: request.params.postId }));
  if (!post) { response.status(404).json({ error: 'Publicação não encontrada nesta comunidade.' }); return; }
  try {
    await Like.create({ tenantId: tenant, postId: post._id, characterId: character._id });
    await Post.updateOne({ _id: post._id, tenantId: tenant }, { $inc: { likesCount: 1 } });
    if (!post.characterId.equals(character._id)) await Notification.create({ tenantId: tenant, characterId: post.characterId, actorId: character._id, type: post.kind === 'pulse' ? 'echo_like' : 'like', targetId: post._id });
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
  }
  const updated = await Post.findOne({ _id: post._id, tenantId: tenant }).lean();
  response.json({ liked: true, likesCount: updated?.likesCount ?? post.likesCount });
});

socialRouter.delete('/posts/:postId/like', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.postId)) { badRequest(response, 'Publicação inválida.'); return; }
  const tenant = tenantId(request);
  const character = activeCharacter(request);
  const removed = await Like.findOneAndDelete({ tenantId: tenant, postId: request.params.postId, characterId: character._id });
  if (removed) await Post.updateOne({ _id: request.params.postId, tenantId: tenant, likesCount: { $gt: 0 } }, { $inc: { likesCount: -1 } });
  const post = await Post.findOne({ _id: request.params.postId, tenantId: tenant }).select('likesCount').lean();
  if (!post) { response.status(404).json({ error: 'Publicação não encontrada nesta comunidade.' }); return; }
  response.json({ liked: false, likesCount: post.likesCount });
});

socialRouter.put('/posts/:postId/save', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.postId)) { badRequest(response, 'Publicação inválida.'); return; }
  const tenant = tenantId(request);
  const post = await Post.findOne(tenantScope(tenant, { _id: request.params.postId })).select('_id').lean();
  if (!post) { response.status(404).json({ error: 'Publicação não encontrada nesta comunidade.' }); return; }
  await SavedPost.updateOne({ tenantId: tenant, postId: post._id, characterId: activeCharacter(request)._id }, { $setOnInsert: { tenantId: tenant, postId: post._id, characterId: activeCharacter(request)._id } }, { upsert: true });
  response.json({ saved: true });
});

socialRouter.delete('/posts/:postId/save', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.postId)) { badRequest(response, 'Publicação inválida.'); return; }
  const tenant = tenantId(request);
  await SavedPost.deleteOne({ tenantId: tenant, postId: request.params.postId, characterId: activeCharacter(request)._id });
  response.json({ saved: false });
});

socialRouter.get('/posts/:postId/comments', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.postId)) { badRequest(response, 'Publicação inválida.'); return; }
  const tenant = tenantId(request);
  const post = await Post.findOne(tenantScope(tenant, { _id: request.params.postId })).select('_id').lean();
  if (!post) { response.status(404).json({ error: 'Publicação não encontrada nesta comunidade.' }); return; }
  const comments = await Comment.find({ tenantId: tenant, postId: post._id }).sort({ createdAt: 1 }).limit(100).lean();
  const authorIds = comments.map((comment) => comment.characterId);
  const authors = await Character.find({ _id: { $in: authorIds }, tenantId: tenant }).lean();
  const authorMap = new Map(authors.map((author) => [author._id.toString(), author]));
  response.json(comments.map((comment) => ({ id: comment._id.toString(), content: comment.content, createdAt: comment.createdAt, replyToCommentId: comment.replyToCommentId?.toString() ?? null, author: authorMap.has(comment.characterId.toString()) ? characterJson(authorMap.get(comment.characterId.toString())!) : null, own: comment.characterId.equals(activeCharacter(request)._id) })));
});

socialRouter.post('/posts/:postId/comments', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.postId)) { badRequest(response, 'Publicação inválida.'); return; }
  const content = typeof request.body?.content === 'string' ? request.body.content.trim() : '';
  if (!content || content.length > 1000) { badRequest(response, 'O comentário deve ter entre 1 e 1000 caracteres.'); return; }
  const tenant = tenantId(request);
  const post = await Post.findOne(tenantScope(tenant, { _id: request.params.postId }));
  if (!post) { response.status(404).json({ error: 'Publicação não encontrada nesta comunidade.' }); return; }
  const replyToCommentId = typeof request.body?.replyToCommentId === 'string' && mongoose.isValidObjectId(request.body.replyToCommentId) ? new mongoose.Types.ObjectId(request.body.replyToCommentId) : undefined;
  if (request.body?.replyToCommentId && !replyToCommentId) { badRequest(response, 'Resposta inválida.'); return; }
  const parentComment = replyToCommentId ? await Comment.findOne({ _id: replyToCommentId, tenantId: tenant, postId: post._id }).select('characterId').lean() : null;
  if (replyToCommentId && !parentComment) { response.status(404).json({ error: 'A resposta original não pertence a este Echo.' }); return; }
  const character = activeCharacter(request);
  const comment = await Comment.create({ tenantId: tenant, postId: post._id, characterId: character._id, content, ...(replyToCommentId ? { replyToCommentId } : {}) });
  await Post.updateOne({ _id: post._id, tenantId: tenant }, { $inc: { commentsCount: 1 } });
  const replyRecipient = parentComment?.characterId ?? post.characterId;
  if (!replyRecipient.equals(character._id)) await Notification.create({ tenantId: tenant, characterId: replyRecipient, actorId: character._id, type: post.kind === 'pulse' ? 'echo_reply' : 'comment', targetId: post._id });
  await notifyMentions(tenant, content, character._id, post._id, post.kind === 'pulse' ? 'echo_mention' : 'mention');
  response.status(201).json({ id: comment._id.toString(), content: comment.content, createdAt: comment.createdAt, replyToCommentId: comment.replyToCommentId?.toString() ?? null, author: characterJson(character), own: true });
});

socialRouter.delete('/comments/:commentId', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.commentId)) { badRequest(response, 'Comentário inválido.'); return; }
  const tenant = tenantId(request);
  const comment = await Comment.findOneAndDelete({ _id: request.params.commentId, tenantId: tenant, characterId: activeCharacter(request)._id });
  if (!comment) { response.status(404).json({ error: 'Comentário não encontrado ou não pertence a você nesta comunidade.' }); return; }
  await Post.updateOne({ _id: comment.postId, tenantId: tenant, commentsCount: { $gt: 0 } }, { $inc: { commentsCount: -1 } });
  response.status(204).end();
});

socialRouter.post('/characters/:username/follow', async (request, response) => {
  const tenant = tenantId(request);
  const follower = activeCharacter(request);
  const target = await Character.findOne(tenantScope(tenant, { username: request.params.username.toLowerCase() }));
  if (!target) { response.status(404).json({ error: 'Perfil não encontrado nesta comunidade.' }); return; }
  if (target._id.equals(follower._id)) { badRequest(response, 'Você não pode seguir seu próprio perfil.'); return; }
  try {
    await Follow.create({ tenantId: tenant, followerId: follower._id, followedId: target._id });
    await Character.updateOne({ _id: follower._id, tenantId: tenant }, { $inc: { followingCount: 1 } });
    await Character.updateOne({ _id: target._id, tenantId: tenant }, { $inc: { followerCount: 1 } });
    await Notification.create({ tenantId: tenant, characterId: target._id, actorId: follower._id, type: 'follow', targetId: follower._id });
  } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error; }
  response.json({ following: true });
});

socialRouter.delete('/characters/:username/follow', async (request, response) => {
  const tenant = tenantId(request);
  const follower = activeCharacter(request);
  const target = await Character.findOne(tenantScope(tenant, { username: request.params.username.toLowerCase() }));
  if (!target) { response.status(404).json({ error: 'Perfil não encontrado nesta comunidade.' }); return; }
  const removed = await Follow.findOneAndDelete({ tenantId: tenant, followerId: follower._id, followedId: target._id });
  if (removed) {
    await Character.updateOne({ _id: follower._id, tenantId: tenant, followingCount: { $gt: 0 } }, { $inc: { followingCount: -1 } });
    await Character.updateOne({ _id: target._id, tenantId: tenant, followerCount: { $gt: 0 } }, { $inc: { followerCount: -1 } });
  }
  response.json({ following: false });
});

socialRouter.get('/explore/characters', async (request, response) => {
  const tenant = tenantId(request);
  const current = activeCharacter(request);
  const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
  const activeAccounts = await Account.find({ tenantId: tenant, status: 'active' }).select('_id').lean();
  const selector: Record<string, unknown> = tenantScope(tenant, { _id: { $ne: current._id }, accountId: { $in: activeAccounts.map((account) => account._id) } });
  if (query) selector.$or = [{ displayName: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { username: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
  const [popular, newest, followed] = await Promise.all([
    Character.find(selector).sort({ followerCount: -1 }).limit(8).lean(),
    Character.find(selector).sort({ createdAt: -1 }).limit(8).lean(),
    Follow.find({ tenantId: tenant, followerId: current._id }).select('followedId').lean(),
  ]);
  const followedSet = new Set(followed.map((item) => item.followedId.toString()));
  response.json({ popular: popular.map((character) => ({ ...characterJson(character), following: followedSet.has(character._id.toString()) })), newest: newest.map((character) => ({ ...characterJson(character), following: followedSet.has(character._id.toString()) })) });
});

socialRouter.get('/explore', async (request, response) => {
  const tenant = tenantId(request);
  const current = activeCharacter(request);
  const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 100) : '';
  const activeAccounts = await Account.find({ tenantId: tenant, status: 'active' }).select('_id').lean();
  const activeIds = activeAccounts.map((account) => account._id);
  const expression = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const characterQuery: Record<string, unknown> = tenantScope(tenant, { accountId: { $in: activeIds }, _id: { $ne: current._id } });
  if (expression) characterQuery.$or = [{ displayName: expression }, { username: expression }];
  const people = await Character.find(characterQuery).sort({ followerCount: -1, createdAt: -1 }).limit(24).lean();
  const followed = await Follow.find({ tenantId: tenant, followerId: current._id }).select('followedId').lean();
  const followedSet = new Set(followed.map((item) => item.followedId.toString()));
  const imageFilter = { $or: [{ imageUrl: { $ne: '' } }, { imageUrls: { $exists: true, $ne: [] } }] };
  const contentQuery: Record<string, unknown> = tenantScope(tenant, { kind: 'post', characterId: { $in: activeIds }, ...imageFilter });
  if (expression) {
    const matchingPeople = await Character.find(tenantScope(tenant, { accountId: { $in: activeIds }, $or: [{ displayName: expression }, { username: expression }] })).select('_id').lean();
    contentQuery.$and = [imageFilter, { $or: [{ content: expression }, { characterId: { $in: matchingPeople.map((item) => item._id) } }] }];
  }
  const posts = await Post.find(contentQuery).sort({ createdAt: -1 }).limit(60).lean();
  const authorIds = [...new Set(posts.map((post) => post.characterId.toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const authors = await Character.find(tenantScope(tenant, { _id: { $in: authorIds }, accountId: { $in: activeIds } })).lean();
  const authorMap = new Map(authors.map((author) => [author._id.toString(), author]));
  const postIds = posts.map((post) => post._id);
  const [liked, saved] = await Promise.all([
    Like.find({ tenantId: tenant, characterId: current._id, postId: { $in: postIds } }).select('postId').lean(),
    SavedPost.find({ tenantId: tenant, characterId: current._id, postId: { $in: postIds } }).select('postId').lean(),
  ]);
  const likedSet = new Set(liked.map((item) => item.postId.toString()));
  const savedSet = new Set(saved.map((item) => item.postId.toString()));
  response.json({ people: people.map((person) => ({ ...characterJson(person), following: followedSet.has(person._id.toString()) })), posts: posts.flatMap((post) => {
    const author = authorMap.get(post.characterId.toString());
    return author ? [postJson(post, characterJson(author), likedSet.has(post._id.toString()), author.accountId.equals(request.vybeAccount!._id) || isCommunityAdmin(request), savedSet.has(post._id.toString()))] : [];
  }) });
});

socialRouter.get('/characters/:username', async (request, response) => {
  const tenant = tenantId(request);
  const character = await Character.findOne(tenantScope(tenant, { username: request.params.username.replace(/^@/, '').toLowerCase() }));
  if (!character) { response.status(404).json({ error: 'Perfil não encontrado nesta comunidade.' }); return; }
  if (!await Account.exists({ _id: character.accountId, tenantId: tenant, status: 'active' })) { response.status(404).json({ error: 'Perfil não encontrado nesta comunidade.' }); return; }
  const posts = await Post.find({ tenantId: tenant, characterId: character._id, kind: 'post', $or: [{ imageUrl: { $ne: '' } }, { imageUrls: { $exists: true, $ne: [] } }] }).sort({ createdAt: -1 }).limit(60).lean();
  const follow = await Follow.exists({ tenantId: tenant, followerId: activeCharacter(request)._id, followedId: character._id });
  const [liked, saved] = await Promise.all([
    Like.find({ tenantId: tenant, characterId: activeCharacter(request)._id, postId: { $in: posts.map((post) => post._id) } }).select('postId').lean(),
    SavedPost.find({ tenantId: tenant, characterId: activeCharacter(request)._id, postId: { $in: posts.map((post) => post._id) } }).select('postId').lean(),
  ]);
  const likedSet = new Set(liked.map((item) => item.postId.toString()));
  const savedSet = new Set(saved.map((item) => item.postId.toString()));
  const ownProfile = character.accountId.equals(request.vybeAccount!._id);
  const canDelete = ownProfile || isCommunityAdmin(request);
  response.json({ character: { ...characterJson(character), own: ownProfile, following: Boolean(follow) }, posts: posts.map((post) => postJson(post, characterJson(character), likedSet.has(post._id.toString()), canDelete, savedSet.has(post._id.toString()))) });
});

socialRouter.get('/characters/:username/followers', async (request, response) => {
  const tenant = tenantId(request);
  const target = await Character.findOne(tenantScope(tenant, { username: request.params.username.toLowerCase() })).select('_id').lean();
  if (!target) { response.status(404).json({ error: 'Perfil não encontrado nesta comunidade.' }); return; }
  const relations = await Follow.find({ tenantId: tenant, followedId: target._id }).select('followerId').limit(200).lean();
  const characters = await Character.find({ _id: { $in: relations.map((item) => item.followerId) }, tenantId: tenant }).lean();
  response.json(characters.map(characterJson));
});

socialRouter.get('/characters/:username/following', async (request, response) => {
  const tenant = tenantId(request);
  const target = await Character.findOne(tenantScope(tenant, { username: request.params.username.toLowerCase() })).select('_id').lean();
  if (!target) { response.status(404).json({ error: 'Perfil não encontrado nesta comunidade.' }); return; }
  const relations = await Follow.find({ tenantId: tenant, followerId: target._id }).select('followedId').limit(200).lean();
  const characters = await Character.find({ _id: { $in: relations.map((item) => item.followedId) }, tenantId: tenant }).lean();
  response.json(characters.map(characterJson));
});

socialRouter.get('/stories', async (request, response) => {
  if (!request.vybeTenant!.settings?.features?.stories) { response.status(403).json({ error: 'Stories estão desativados nesta comunidade.' }); return; }
  const tenant = tenantId(request);
  const activeAccounts = await Account.find({ tenantId: tenant, status: 'active' }).select('_id').lean();
  const activeCharacters = await Character.find({ tenantId: tenant, accountId: { $in: activeAccounts.map((account) => account._id) } }).distinct('_id');
  const stories = await Story.find({ tenantId: tenant, characterId: { $in: activeCharacters }, expiresAt: { $gt: new Date() } }).sort({ createdAt: 1 }).lean();
  const characterIds = [...new Set(stories.map((story) => story.characterId.toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const characters = await Character.find({ tenantId: tenant, _id: { $in: characterIds } }).lean();
  const viewers = await StoryView.find({ tenantId: tenant, viewerCharacterId: activeCharacter(request)._id, storyId: { $in: stories.map((story) => story._id) } }).select('storyId').lean();
  const viewed = new Set(viewers.map((item) => item.storyId.toString()));
  const characterMap = new Map(characters.map((item) => [item._id.toString(), item]));
  const groups = new Map<string, { character: ReturnType<typeof characterJson>; own: boolean; unseen: boolean; stories: Array<{ id: string; imageUrl: string; createdAt: Date }> }>();
  for (const story of stories) {
    const author = characterMap.get(story.characterId.toString());
    if (!author) continue;
    const id = author._id.toString();
    if (!groups.has(id)) groups.set(id, { character: characterJson(author), own: author._id.equals(activeCharacter(request)._id), unseen: false, stories: [] });
    const group = groups.get(id)!;
    group.stories.push({ id: story._id.toString(), imageUrl: story.imageUrl, createdAt: story.createdAt });
    if (!viewed.has(story._id.toString()) && !group.own) group.unseen = true;
  }
  response.json([...groups.values()].sort((left, right) => Number(right.unseen) - Number(left.unseen)));
});

socialRouter.post('/stories', async (request, response) => {
  if (!request.vybeTenant!.settings?.features?.stories) { response.status(403).json({ error: 'Stories estão desativados nesta comunidade.' }); return; }
  const tenant = tenantId(request);
  const image = typeof request.body?.image === 'string' ? request.body.image : '';
  if (!image) { badRequest(response, 'Escolha uma imagem para publicar seu story.'); return; }
  const owner = await Character.findOne({ _id: activeCharacter(request)._id, tenantId: tenant, accountId: request.vybeAccount!._id });
  if (!owner) { response.status(403).json({ error: 'Esta identidade não pertence a uma conta ativa desta comunidade.' }); return; }
  let imageUrl: string;
  try { imageUrl = await saveEventImage(image, request.vybeTenant!.slug); }
  catch (error) { badRequest(response, error instanceof Error ? error.message : 'Envie uma imagem válida de até 3 MB.'); return; }
  const story = await Story.create({ tenantId: tenant, characterId: owner._id, imageUrl, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
  response.status(201).json({ id: story._id.toString(), imageUrl: story.imageUrl, createdAt: story.createdAt, expiresAt: story.expiresAt });
});

socialRouter.post('/stories/:storyId/view', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.storyId)) { badRequest(response, 'Story inválido.'); return; }
  const tenant = tenantId(request);
  const story = await Story.findOne({ _id: request.params.storyId, tenantId: tenant, expiresAt: { $gt: new Date() } }).select('_id characterId').lean();
  if (!story) { response.status(404).json({ error: 'Story não encontrado nesta comunidade.' }); return; }
  if (!story.characterId.equals(activeCharacter(request)._id)) await StoryView.updateOne({ tenantId: tenant, storyId: story._id, viewerCharacterId: activeCharacter(request)._id }, { $setOnInsert: { tenantId: tenant, storyId: story._id, viewerCharacterId: activeCharacter(request)._id } }, { upsert: true });
  response.status(204).end();
});

socialRouter.get('/events/manage', async (request, response) => {
  if (!isOwnerOrAdmin(request)) { response.status(403).json({ error: 'Somente Owner/Admin pode administrar eventos.' }); return; }
  if (request.vybeTenant!.settings?.features?.events === false) { response.status(403).json({ error: 'Eventos estão desativados nesta comunidade.' }); return; }
  const statuses = ['pending_approval', 'approved', 'upcoming', 'completed', 'rejected', 'cancelled', 'changes_requested'];
  const status = typeof request.query.status === 'string' && statuses.includes(request.query.status) ? request.query.status : undefined;
  const statusQuery = status === 'approved' ? { status: { $in: ['approved', 'upcoming'] } } : status === 'completed' ? { $or: [{ status: 'completed' }, { status: { $in: ['approved', 'upcoming'] }, startsAt: { $lt: new Date() } }] } : status ? { status } : {};
  const query: Record<string, unknown> = tenantScope(tenantId(request), statusQuery);
  const events = await CommunityEvent.find(query).sort({ startsAt: 1, createdAt: -1 }).limit(100).lean();
  response.json(await Promise.all(events.map((event) => eventSummary(event, request))));
});

socialRouter.get('/events', async (request, response) => {
  if (request.vybeTenant!.settings?.features?.events === false) { response.status(403).json({ error: 'Eventos estão desativados nesta comunidade.' }); return; }
  const tenant = tenantId(request);
  const current = activeCharacter(request);
  const view = typeof request.query.view === 'string' ? request.query.view : 'upcoming';
  let filter: Record<string, unknown> = eventStatusPublic('approved') ? { status: { $in: ['approved', 'upcoming'] } } : {};
  if (view === 'past') filter = { status: { $in: ['approved', 'upcoming', 'completed'] }, startsAt: { $lt: new Date() } };
  else if (view === 'mine') {
    const rsvps = await EventRSVP.find({ tenantId: tenant, characterId: current._id, status: { $in: ['going', 'maybe', 'not_going'] } }).select('eventId').lean();
    filter = { $or: [{ creatorCharacterId: current._id }, { _id: { $in: rsvps.map((item) => item.eventId) } }] };
  }
  else if (view === 'going') {
    const rsvps = await EventRSVP.find({ tenantId: tenant, characterId: current._id, status: { $in: ['going', 'maybe', 'not_going'] } }).select('eventId').lean();
    filter = { _id: { $in: rsvps.map((item) => item.eventId) }, status: { $in: ['approved', 'upcoming'] } };
  } else filter.startsAt = { $gte: new Date() };
  const from = typeof request.query.from === 'string' ? new Date(request.query.from) : null;
  const to = typeof request.query.to === 'string' ? new Date(request.query.to) : null;
  if (from && Number.isFinite(from.getTime()) && to && Number.isFinite(to.getTime()) && to > from) filter = { status: { $in: ['approved', 'upcoming'] }, startsAt: { $gte: from, $lt: to } };
  const requestedLimit = Number(request.query.limit);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 100;
  const events = await CommunityEvent.find(tenantScope(tenant, filter)).sort({ startsAt: view === 'past' ? -1 : 1 }).limit(limit).lean();
  response.json(await Promise.all(events.map((event) => eventSummary(event, request))));
});

socialRouter.post('/events', async (request, response) => {
  const community = request.vybeTenant!;
  if (community.settings?.features?.events === false) { response.status(403).json({ error: 'Eventos estão desativados nesta comunidade.' }); return; }
  const input = eventInput(request.body ?? {});
  if (!input) { badRequest(response, 'Revise título, descrição, data futura, local, categoria e limite de participantes.'); return; }
  const account = request.vybeAccount!;
  const character = activeCharacter(request);
  const ownerAdmin = isOwnerOrAdmin(request);
  const moderator = community.moderators.some((id) => id.equals(account._id));
  const owner = community.ownerAccountId?.equals(account._id) === true || community.admins[0]?.equals(account._id) === true;
  // Any active community member may submit an event. Only Owner/Admin submissions
  // are published immediately; every other submission waits for their approval.
  const creationDecision = eventCreationDecision('any_pending', owner, ownerAdmin && !owner, moderator);
  let imageUrl = '';
  if (request.body?.image) { try { imageUrl = await saveEventImage(request.body.image, community.slug); } catch (error) { badRequest(response, error instanceof Error ? error.message : 'Capa inválida.'); return; } }
  const approved = creationDecision === 'approved';
  const event = await CommunityEvent.create({ tenantId: community._id, creatorCharacterId: character._id, ...input, imageUrl, official: approved && request.body?.official === true, status: approved ? 'approved' : 'pending_approval', reviewedBy: approved ? account._id : undefined, reviewedAt: approved ? new Date() : undefined });
  if (approved) await notifyCharacters(community._id, character._id, event._id, 'event_created');
  else {
    const adminAccounts = [community.ownerAccountId, ...community.admins].filter((id): id is mongoose.Types.ObjectId => Boolean(id));
    const adminCharacters = await Character.find({ tenantId: community._id, accountId: { $in: adminAccounts } }).select('_id').lean();
    await notifyCharacters(community._id, character._id, event._id, 'event_pending', adminCharacters.map((item) => item._id));
  }
  await CommunityAudit.create({ tenantId: community._id, actorId: account._id, action: approved ? 'event.created.approved' : 'event.created.pending', details: { eventId: event._id.toString(), title: event.title, startsAt: event.startsAt } });
  response.status(201).json(await eventSummary(event.toObject(), request));
});

socialRouter.get('/events/:eventId/participants', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.eventId)) { badRequest(response, 'Evento inválido.'); return; }
  const tenant = tenantId(request);
  const event = await CommunityEvent.findOne(tenantScope(tenant, { _id: request.params.eventId }));
  if (!event) { response.status(404).json({ error: 'Evento não encontrado nesta comunidade.' }); return; }
  if (!canSeeEvent(event.status, isCommunityAdmin(request), Boolean(event.creatorCharacterId?.equals(activeCharacter(request)._id)))) { response.status(404).json({ error: 'Evento não encontrado nesta comunidade.' }); return; }
  const rsvps = await EventRSVP.find({ tenantId: tenant, eventId: event._id, status: 'going' }).sort({ createdAt: 1 }).lean();
  const characters = await Character.find(tenantScope(tenant, { _id: { $in: rsvps.map((item) => item.characterId) } })).select('username displayName avatarUrl').lean();
  response.json(characters.map((person) => ({ id: person._id.toString(), username: person.username, displayName: person.displayName, avatarUrl: person.avatarUrl })));
});

socialRouter.get('/events/:eventId', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.eventId)) { badRequest(response, 'Evento inválido.'); return; }
  const event = await CommunityEvent.findOne(tenantScope(tenantId(request), { _id: request.params.eventId })).lean();
  if (!event || !canSeeEvent(event.status, isCommunityAdmin(request), Boolean(event.creatorCharacterId?.equals(activeCharacter(request)._id)))) { response.status(404).json({ error: 'Evento não encontrado nesta comunidade.' }); return; }
  response.json(await eventSummary(event, request));
});

socialRouter.put('/events/:eventId/rsvp', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.eventId)) { badRequest(response, 'Evento inválido.'); return; }
  const tenant = tenantId(request);
  const event = await CommunityEvent.findOne(tenantScope(tenant, { _id: request.params.eventId, status: { $in: ['approved', 'upcoming'] } }));
  if (!event) { response.status(404).json({ error: 'Evento aprovado não encontrado nesta comunidade.' }); return; }
  const character = activeCharacter(request);
  const status = request.body?.status;
  if (!['going', 'maybe', 'not_going', 'cancelled'].includes(status)) { badRequest(response, 'Escolha Vou, Em dúvida ou Não vou.'); return; }
  const going = status === 'going';
  if (going && event.participantLimit) {
    const existing = await EventRSVP.exists({ tenantId: tenant, eventId: event._id, characterId: character._id, status: 'going' });
    const count = await EventRSVP.countDocuments({ tenantId: tenant, eventId: event._id, status: 'going' });
    if (!canJoinEvent(count, event.participantLimit, Boolean(existing))) { response.status(409).json({ error: 'Este evento atingiu o limite de participantes.' }); return; }
  }
  await EventRSVP.findOneAndUpdate({ tenantId: tenant, eventId: event._id, characterId: character._id }, { $set: { status } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  response.json({ going, status, confirmedCount: await EventRSVP.countDocuments({ tenantId: tenant, eventId: event._id, status: 'going' }) });
});

socialRouter.patch('/events/:eventId', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.eventId)) { badRequest(response, 'Evento inválido.'); return; }
  const tenant = tenantId(request);
  const event = await CommunityEvent.findOne(tenantScope(tenant, { _id: request.params.eventId }));
  if (!event) { response.status(404).json({ error: 'Evento não encontrado nesta comunidade.' }); return; }
  const character = activeCharacter(request);
  const staff = isOwnerOrAdmin(request);
  if (!staff && !event.creatorCharacterId?.equals(character._id)) { response.status(403).json({ error: 'Você não pode editar este evento.' }); return; }
  const input = eventInput({ ...event.toObject(), ...request.body });
  if (!input) { badRequest(response, 'Revise os dados do evento.'); return; }
  const importantChanged = event.startsAt.getTime() !== input.startsAt.getTime() || event.location !== input.location;
  Object.assign(event, input);
  if (!staff && ['changes_requested', 'draft'].includes(event.status)) event.status = 'pending_approval';
  if (typeof request.body?.image === 'string' && request.body.image) { try { event.imageUrl = await saveEventImage(request.body.image, request.vybeTenant!.slug); } catch (error) { badRequest(response, error instanceof Error ? error.message : 'Capa inválida.'); return; } }
  await event.save();
  await CommunityAudit.create({ tenantId: tenant, actorId: request.vybeAccount!._id, action: 'event.edited', details: { eventId: event._id.toString(), importantChanged } });
  if (eventStatusPublic(event.status) && importantChanged) {
    const participants = await EventRSVP.find({ tenantId: tenant, eventId: event._id, status: 'going' }).select('characterId').lean();
    await notifyCharacters(tenant, character._id, event._id, 'event_updated', participants.map((item) => item.characterId));
  }
  response.json(await eventSummary(event.toObject(), request));
});

socialRouter.post('/events/:eventId/review', async (request, response) => {
  if (!isOwnerOrAdmin(request)) { response.status(403).json({ error: 'Somente Owner/Admin pode revisar eventos.' }); return; }
  if (!mongoose.isValidObjectId(request.params.eventId)) { badRequest(response, 'Evento inválido.'); return; }
  const decision = request.body?.decision;
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
  if (!['approve', 'reject', 'request_changes'].includes(decision) || (decision !== 'approve' && reason.length < 5) || reason.length > 500) { badRequest(response, 'Informe uma decisão e, para recusar ou solicitar ajuste, um motivo com pelo menos 5 caracteres.'); return; }
  const tenant = tenantId(request);
  const event = await CommunityEvent.findOne(tenantScope(tenant, { _id: request.params.eventId, status: { $in: ['pending_approval', 'changes_requested'] } }));
  if (!event) { response.status(404).json({ error: 'Evento pendente não encontrado nesta comunidade.' }); return; }
  event.reviewedBy = request.vybeAccount!._id;
  event.reviewedAt = new Date();
  event.rejectedReason = decision === 'approve' ? '' : reason;
  event.status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'changes_requested';
  if (decision === 'approve') event.official = request.body?.official === true;
  await event.save();
  const actor = activeCharacter(request);
  await CommunityAudit.create({ tenantId: tenant, actorId: request.vybeAccount!._id, action: `event.${decision === 'request_changes' ? 'changes_requested' : decision === 'approve' ? 'approved' : 'rejected'}`, details: { eventId: event._id.toString(), title: event.title, reason } });
  await notifyCharacters(tenant, actor._id, event._id, 'event_review', [event.creatorCharacterId]);
  if (decision === 'approve') await notifyCharacters(tenant, actor._id, event._id, 'event_created');
  response.json(await eventSummary(event.toObject(), request));
});

socialRouter.post('/events/:eventId/cancel', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.eventId)) { badRequest(response, 'Evento inválido.'); return; }
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 500) { badRequest(response, 'Informe o motivo do cancelamento (5 a 500 caracteres).'); return; }
  const tenant = tenantId(request);
  const event = await CommunityEvent.findOne(tenantScope(tenant, { _id: request.params.eventId }));
  if (!event) { response.status(404).json({ error: 'Evento não encontrado nesta comunidade.' }); return; }
  const actor = activeCharacter(request);
  if (!isOwnerOrAdmin(request) && !event.creatorCharacterId?.equals(actor._id)) { response.status(403).json({ error: 'Você não pode cancelar este evento.' }); return; }
  if (event.status === 'cancelled' || event.status === 'completed') { badRequest(response, 'Este evento já foi encerrado.'); return; }
  event.status = 'cancelled'; event.cancellationReason = reason; event.cancelledAt = new Date(); event.cancelledBy = request.vybeAccount!._id;
  await event.save();
  await CommunityAudit.create({ tenantId: tenant, actorId: request.vybeAccount!._id, action: 'event.cancelled', details: { eventId: event._id.toString(), title: event.title, reason } });
  const participants = await EventRSVP.find({ tenantId: tenant, eventId: event._id, status: 'going' }).select('characterId').lean();
  await notifyCharacters(tenant, actor._id, event._id, 'event_cancelled', participants.map((item) => item.characterId));
  response.json(await eventSummary(event.toObject(), request));
});

socialRouter.get('/notifications', async (request, response) => {
  const tenant = tenantId(request);
  const requestedLimit = Number(request.query.limit);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, Math.floor(requestedLimit))) : 50;
  const notifications = await Notification.find({ tenantId: tenant, characterId: activeCharacter(request)._id }).sort({ createdAt: -1 }).limit(limit).lean();
  const actorIds = notifications.map((notification) => notification.actorId);
  const actors = await Character.find({ _id: { $in: actorIds }, tenantId: tenant }).lean();
  const actorMap = new Map(actors.map((actor) => [actor._id.toString(), actor]));
  const eventTypes = ['event_created', 'event_updated', 'event_cancelled', 'event_review', 'event_pending'];
  const eventIds = notifications.filter((item) => eventTypes.includes(item.type)).map((item) => item.targetId);
  const events = await CommunityEvent.find(tenantScope(tenant, { _id: { $in: eventIds } })).select('title').lean();
  const eventMap = new Map(events.map((event) => [event._id.toString(), event.title]));
  const bankTypes = ['bank_transfer_received', 'bank_admin_credit_received'];
  const bankTransactions = await WalletTransaction.find(tenantScope(tenant, { _id: { $in: notifications.filter((item) => bankTypes.includes(item.type)).map((item) => item.targetId) } })).select('amountCents description').lean();
  const bankMap = new Map((bankTransactions as unknown as Array<{ _id: mongoose.Types.ObjectId; amountCents: number; description: string }>).map((item) => [item._id.toString(), item]));
  const joinUpdates = await CommunityJoinRequest.find({ _id: { $in: notifications.filter((item) => item.type === 'community_join_update').map((item) => item.targetId) }, sourceTenantId: tenant, accountId: request.vybeAccount!._id }).select('communityId status adminMessage rejectionReason').lean();
  const joinCommunityIds = joinUpdates.map((item) => item.communityId);
  const joinCommunities = await Community.find({ _id: { $in: joinCommunityIds } }).select('name').lean();
  const joinCommunityMap = new Map(joinCommunities.map((item) => [String(item._id), item.name]));
  const joinUpdateMap = new Map(joinUpdates.map((item) => [String(item._id), { status: item.status, communityName: joinCommunityMap.get(String(item.communityId)) ?? 'comunidade', message: item.status === 'NEEDS_INFORMATION' ? item.adminMessage : item.status === 'REJECTED' ? item.rejectionReason : '' }]));
  response.json(notifications.map((item) => ({ id: item._id.toString(), type: item.type, targetId: item.targetId.toString(), eventTitle: eventMap.get(item.targetId.toString()) ?? '', amountCents: bankMap.get(item.targetId.toString())?.amountCents ?? null, description: bankMap.get(item.targetId.toString())?.description ?? '', joinUpdate: joinUpdateMap.get(item.targetId.toString()) ?? null, communityId: tenant.toString(), readAt: item.readAt, createdAt: item.createdAt, actor: actorMap.has(item.actorId.toString()) ? characterJson(actorMap.get(item.actorId.toString())!) : null })));
});

socialRouter.patch('/notifications/read', async (request, response) => {
  const echoTypes = ['follow', 'echo_like', 'echo_mention', 'repost', 'echo_reply'];
  const scope = request.query.scope === 'echo' ? { type: { $in: echoTypes } } : {};
  const result = await Notification.updateMany({ tenantId: tenantId(request), characterId: activeCharacter(request)._id, readAt: { $exists: false }, ...scope }, { $set: { readAt: new Date() } });
  response.json({ updated: result.modifiedCount });
});
