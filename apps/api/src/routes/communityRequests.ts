import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type NextFunction, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { Community } from '../models/Community.js';
import { CommunityAudit } from '../models/CommunityAudit.js';
import { CommunityRequest } from '../models/CommunityRequest.js';
import { CommunityJoinRequest } from '../models/CommunityJoinRequest.js';
import { Account, Character } from '../models/Social.js';
import { VybeAccount } from '../models/VybeAccount.js';
import { VybeSession } from '../models/VybeSession.js';
import { ensureProvisioningCollections, provisionApprovedCommunity } from '../services/communityProvisioning.js';
import { isConfiguredPlatformAdmin } from '../services/platformAdminPolicy.js';
import { requireSession } from '../middleware/tenant.js';

export const communityRequestsRouter = Router();

async function requireCommunityRequester(request: Request, response: Response, next: NextFunction) {
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('vybe_account_session='));
  const token = cookie ? decodeURIComponent(cookie.slice('vybe_account_session='.length)) : '';
  if (!token) { requireSession(request, response, next); return; }
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session = await VybeSession.findOne({ tokenHash, expiresAt: { $gt: new Date() } });
  if (!session) { response.status(401).json({ error: 'Sessão VYBE inválida ou expirada.' }); return; }
  const account = await VybeAccount.findOne({ _id: session.accountId, status: 'active' });
  if (!account) { response.status(401).json({ error: 'Conta VYBE indisponível.' }); return; }
  request.vybeGlobalAccount = account;
  next();
}

communityRequestsRouter.use('/platform', requireSession);

const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads');
const reservedSlugs = new Set(['api', 'www', 'community', 'vybe', 'admin', 'app']);

function slugFrom(name: string) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
}

function isPlatformAdmin(request: Request) {
  const platformSlug = process.env.VYBE_PLATFORM_TENANT_SLUG ?? 'community';
  const tenant = request.vybeTenant;
  const account = request.vybeAccount;
  if (!tenant || !account || tenant.slug !== platformSlug) return false;

  // Platform administrators are configured on the server; display names and
  // character usernames are user editable and must never grant review access.
  return isConfiguredPlatformAdmin(account.email);
}

function denyReview(response: Response) {
  response.status(403).json({ error: 'Somente a administração da VYBE pode revisar solicitações.' });
}

function requestJson(row: InstanceType<typeof CommunityRequest>) {
  return {
    id: row._id.toString(), rpgName: row.rpgName, slug: row.slug,
    description: row.description, status: row.status, createdAt: row.createdAt,
  };
}

communityRequestsRouter.get('/communities', requireSession, async (request, response) => {
  const communities = await Community.find({ status: 'active', type: 'public' })
    .select('name slug subdomain description coverUrl logoUrl category memberCount createdAt settings')
    .sort({ createdAt: 1 }).limit(100).lean();
  const currentTenantId = request.vybeTenant!._id;
  // A member should still be able to find/switch back to the community they
  // are currently signed into, even when its public directory listing is off.
  const visibleCommunities = communities.filter((community) => String(community._id) === currentTenantId.toString()
    || (community.settings?.access?.visibility !== 'private' && community.settings?.privacy?.showInDirectory !== false));
  const communityIds = visibleCommunities.map((community) => community._id);
  const [memberships, joinRequests] = await Promise.all([
    Account.find({ tenantId: { $in: communityIds }, email: request.vybeAccount!.email }).select('tenantId status').lean(),
    CommunityJoinRequest.find({ communityId: { $in: communityIds }, sourceTenantId: currentTenantId, accountId: request.vybeAccount!._id }).select('communityId status').lean(),
  ]);
  response.json({ currentTenantSlug: request.vybeTenant!.slug, communities: visibleCommunities.map((community) => ({
    id: String(community._id), name: community.name, slug: community.slug,
    subdomain: community.subdomain, description: community.description,
    coverUrl: community.coverUrl ? `/api/communities/${community.slug}/cover` : '', logoUrl: community.logoUrl, category: community.category, memberCount: community.memberCount,
    joinStatus: memberships.find((item) => String(item.tenantId) === String(community._id))?.status === 'active' ? 'MEMBER' : joinRequests.find((item) => String(item.communityId) === String(community._id))?.status ?? 'NONE',
  })) });
});

communityRequestsRouter.get('/communities/:slug/cover', async (request, response) => {
  const slug = request.params.slug;
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) { response.status(404).end(); return; }
  const community = await Community.findOne({ slug, subdomain: slug, status: 'active', type: 'public' }).exec();
  const filename = community?.coverUrl.match(/^\/media\/[a-z0-9-]+\/([a-f0-9]{32}\.(?:png|jpg|webp))$/)?.[1];
  if (!community || !filename || community.coverUrl !== `/media/${slug}/${filename}`) { response.status(404).end(); return; }
  response.sendFile(filename, { root: resolve(uploadsDirectory, slug) }, (error) => {
    if (error && !response.headersSent) response.status(404).end();
  });
});

communityRequestsRouter.get('/community-requests', requireCommunityRequester, async (request, response) => {
  const filter = request.vybeGlobalAccount
    ? { globalAccountId: request.vybeGlobalAccount._id }
    : { sourceTenantId: request.vybeTenant!._id, accountId: request.vybeAccount!._id };
  const rows = await CommunityRequest.find(filter).sort({ createdAt: -1 }).limit(20).lean();
  response.json(rows.map((row) => ({
    id: String(row._id), rpgName: row.rpgName, slug: row.slug,
    description: row.description, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
    photoUrl: `/api/community-requests/${String(row._id)}/photo`,
  })));
});

communityRequestsRouter.get('/community-requests/:requestId/photo', requireCommunityRequester, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(404).end(); return; }
  const ownerFilter = request.vybeGlobalAccount
    ? { globalAccountId: request.vybeGlobalAccount._id }
    : { sourceTenantId: request.vybeTenant!._id, accountId: request.vybeAccount!._id };
  const row = await CommunityRequest.findOne({ _id: request.params.requestId, ...ownerFilter });
  if (!row || !/^[a-z0-9-]+$/.test(row.sourceTenantSlug) || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(row.photoFilename)) { response.status(404).end(); return; }
  response.sendFile(row.photoFilename, { root: resolve(uploadsDirectory, row.sourceTenantSlug) }, (error) => {
    if (error && !response.headersSent) response.status(404).end();
  });
});

communityRequestsRouter.post('/community-requests', requireCommunityRequester, async (request, response) => {
  const rpgName = typeof request.body?.rpgName === 'string' ? request.body.rpgName.trim() : '';
  const description = typeof request.body?.description === 'string' ? request.body.description.trim() : '';
  const photo = typeof request.body?.photo === 'string' ? request.body.photo : '';
  if (rpgName.length < 2 || rpgName.length > 80) {
    response.status(400).json({ error: 'O nome do RPG deve ter entre 2 e 80 caracteres.' }); return;
  }
  if (description.length < 10 || description.length > 500) {
    response.status(400).json({ error: 'Conte um pouco sobre o RPG (de 10 a 500 caracteres).' }); return;
  }
  const imageMatch = photo.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!imageMatch) { response.status(400).json({ error: 'Escolha uma imagem PNG, JPG ou WebP para a capa.' }); return; }
  const imageBytes = Buffer.from(imageMatch[2], 'base64');
  if (imageBytes.byteLength < 16 || imageBytes.byteLength > 3 * 1024 * 1024) {
    response.status(400).json({ error: 'A imagem deve ter no máximo 3 MB.' }); return;
  }
  const extension = imageMatch[1] === 'jpeg' ? 'jpg' : imageMatch[1];
  const signatureMatches = extension === 'png'
    ? imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : extension === 'jpg' ? imageBytes[0] === 0xff && imageBytes[1] === 0xd8 && imageBytes[2] === 0xff
      : imageBytes.subarray(0, 4).toString() === 'RIFF' && imageBytes.subarray(8, 12).toString() === 'WEBP';
  if (!signatureMatches) { response.status(400).json({ error: 'O arquivo escolhido não corresponde a uma imagem válida.' }); return; }

  const slug = slugFrom(rpgName);
  if (slug.length < 3 || reservedSlugs.has(slug)) {
    response.status(400).json({ error: 'Este nome não pode ser usado como endereço de comunidade.' }); return;
  }
  if (await Community.exists({ $or: [{ slug }, { subdomain: slug }] })) {
    response.status(409).json({ error: 'Já existe uma comunidade com o endereço gerado para esse nome.' }); return;
  }
  if (await CommunityRequest.exists({ slug, status: 'pending' })) {
    response.status(409).json({ error: 'Já existe uma solicitação aguardando aprovação para este RPG.' }); return;
  }

  const tenant = request.vybeTenant!;
  const account = request.vybeAccount;
  const character = request.vybeCharacter;
  const globalAccount = request.vybeGlobalAccount;
  const filename = `${randomBytes(16).toString('hex')}.${extension}`;
  const tenantDirectory = resolve(uploadsDirectory, tenant.slug);
  await mkdir(tenantDirectory, { recursive: true });
  await writeFile(resolve(tenantDirectory, filename), imageBytes, { flag: 'wx', mode: 0o600 });
  const row = await CommunityRequest.create({
    sourceTenantId: tenant._id, sourceTenantSlug: tenant.slug,
    ...(account ? { accountId: account._id } : {}), ...(character ? { characterId: character._id } : {}),
    ...(globalAccount ? { globalAccountId: globalAccount._id } : {}),
    applicantEmail: globalAccount?.email ?? account!.email,
    applicantName: globalAccount?.displayName ?? character!.displayName,
    applicantUsername: globalAccount?.username ?? character!.username,
    rpgName, slug, description, photoFilename: filename, photoExtension: extension, status: 'pending',
  });
  response.status(201).json(requestJson(row));
});

communityRequestsRouter.get('/platform/community-requests', async (request, response) => {
  if (!isPlatformAdmin(request)) { denyReview(response); return; }
  const rows = await CommunityRequest.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(100).lean();
  const characterIds = rows.flatMap((row) => row.characterId ? [row.characterId] : []);
  const globalAccountIds = rows.flatMap((row) => row.globalAccountId ? [row.globalAccountId] : []);
  const tenantIds = [...new Set(rows.map((row) => row.sourceTenantId.toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const [characters, globalAccounts] = await Promise.all([
    Character.find({ _id: { $in: characterIds }, tenantId: { $in: tenantIds } }).select('displayName username tenantId').lean(),
    VybeAccount.find({ _id: { $in: globalAccountIds } }).select('displayName username').lean(),
  ]);
  const characterMap = new Map(characters.map((character) => [`${character.tenantId}:${character._id}`, character]));
  const globalAccountMap = new Map(globalAccounts.map((account) => [String(account._id), account]));
  response.json(rows.map((row) => {
    const character = row.characterId ? characterMap.get(`${row.sourceTenantId}:${row.characterId}`) : undefined;
    const globalAccount = row.globalAccountId ? globalAccountMap.get(String(row.globalAccountId)) : undefined;
    return {
      ...requestJson(row), sourceTenantSlug: row.sourceTenantSlug,
      applicant: character ? { displayName: character.displayName, username: character.username }
        : globalAccount ? { displayName: globalAccount.displayName, username: globalAccount.username }
          : { displayName: row.applicantName, username: row.applicantUsername },
      photoUrl: `/api/platform/community-requests/${String(row._id)}/photo`,
    };
  }));
});

communityRequestsRouter.get('/platform/communities', async (request, response) => {
  if (!isPlatformAdmin(request)) { denyReview(response); return; }
  const rows = await Community.find({ status: { $ne: 'deleted' } })
    .select('name slug subdomain description coverUrl memberCount status createdAt')
    .sort({ createdAt: 1 }).lean();
  response.json(rows.map((row) => ({
    id: String(row._id), name: row.name, slug: row.slug, subdomain: row.subdomain,
    description: row.description, coverUrl: row.coverUrl, memberCount: row.memberCount,
    status: row.status,
  })));
});

communityRequestsRouter.patch('/platform/communities/:communityId', async (request, response) => {
  if (!isPlatformAdmin(request)) { denyReview(response); return; }
  if (!mongoose.isValidObjectId(request.params.communityId)) { response.status(404).json({ error: 'Comunidade não encontrada.' }); return; }
  const status = request.body?.status;
  if (status !== 'active' && status !== 'archived' && status !== 'suspended') { response.status(400).json({ error: 'Status inválido para a comunidade.' }); return; }
  const platformSlug = process.env.VYBE_PLATFORM_TENANT_SLUG ?? 'community';
  const community = await Community.findById(request.params.communityId);
  if (!community || community.status === 'deleted') { response.status(404).json({ error: 'Comunidade não encontrada.' }); return; }
  if (community.slug === platformSlug) { response.status(400).json({ error: 'A comunidade principal da VYBE não pode ser arquivada.' }); return; }
  community.status = status;
  await community.save();
  await CommunityAudit.create({ tenantId: community._id, actorId: request.vybeAccount!._id, action: `platform.community.${status}`, details: { communityName: community.name, status } });
  response.json({ id: community._id.toString(), status: community.status });
});

communityRequestsRouter.delete('/platform/communities/:communityId', async (request, response) => {
  if (!isPlatformAdmin(request)) { denyReview(response); return; }
  if (!mongoose.isValidObjectId(request.params.communityId)) { response.status(404).json({ error: 'Comunidade não encontrada.' }); return; }
  const community = await Community.findById(request.params.communityId);
  if (!community || community.status === 'deleted') { response.status(404).json({ error: 'Comunidade não encontrada.' }); return; }
  const platformSlug = process.env.VYBE_PLATFORM_TENANT_SLUG ?? 'community';
  if (community.slug === platformSlug) { response.status(400).json({ error: 'A comunidade principal da VYBE não pode ser excluída.' }); return; }
  community.status = 'deleted';
  await community.save();
  await CommunityAudit.create({ tenantId: community._id, actorId: request.vybeAccount!._id, action: 'platform.community.deleted', details: { communityName: community.name } });
  response.json({ id: community._id.toString(), status: community.status });
});

communityRequestsRouter.get('/platform/community-requests/:requestId/photo', async (request, response) => {
  if (!isPlatformAdmin(request)) { denyReview(response); return; }
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(404).end(); return; }
  const row = await CommunityRequest.findOne({ _id: request.params.requestId, status: 'pending' });
  if (!row || !/^[a-z0-9-]+$/.test(row.sourceTenantSlug)) { response.status(404).end(); return; }
  response.sendFile(row.photoFilename, { root: resolve(uploadsDirectory, row.sourceTenantSlug) }, (error) => {
    if (error && !response.headersSent) response.status(404).end();
  });
});

communityRequestsRouter.patch('/platform/community-requests/:requestId', async (request, response) => {
  if (!isPlatformAdmin(request)) { denyReview(response); return; }
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(404).json({ error: 'Solicitação não encontrada.' }); return; }
  const decision = request.body?.decision;
  if (decision !== 'approve' && decision !== 'reject') { response.status(400).json({ error: 'Escolha aprovar ou recusar a solicitação.' }); return; }
  const row = await CommunityRequest.findOne({ _id: request.params.requestId, status: 'pending' });
  if (!row) { response.status(404).json({ error: 'Solicitação não encontrada ou já revisada.' }); return; }
  const reviewedAt = new Date();
  if (decision === 'reject') {
    row.status = 'rejected';
    row.reviewedBy = request.vybeAccount!._id;
    row.reviewedAt = reviewedAt;
    await row.save();
    response.json({ id: row._id.toString(), status: row.status });
    return;
  }

  if (await Community.exists({ $or: [{ slug: row.slug }, { subdomain: row.slug }] })) {
    response.status(409).json({ error: 'O endereço desta comunidade já foi utilizado. Recuse esta solicitação e peça um novo nome ao responsável.' }); return;
  }
  const destinationDirectory = resolve(uploadsDirectory, row.slug);
  const sourcePhoto = resolve(uploadsDirectory, row.sourceTenantSlug, row.photoFilename);
  const destinationPhoto = resolve(destinationDirectory, row.photoFilename);
  let copiedPhoto = false;
  try {
    await ensureProvisioningCollections();
    await mkdir(destinationDirectory, { recursive: true });
    await copyFile(sourcePhoto, destinationPhoto);
    copiedPhoto = true;
    const session = await mongoose.startSession();
    let community: InstanceType<typeof Community> | undefined;
    try {
      await session.withTransaction(async () => {
        const pendingRequest = await CommunityRequest.findOne({ _id: row._id, status: 'pending' }).session(session);
        if (!pendingRequest) throw new Error('Solicitação não encontrada ou já revisada.');
        community = await provisionApprovedCommunity(pendingRequest, request.vybeAccount!._id, session);
        pendingRequest.status = 'approved';
        pendingRequest.reviewedBy = request.vybeAccount!._id;
        pendingRequest.reviewedAt = reviewedAt;
        await pendingRequest.save({ session });
      });
    } finally {
      await session.endSession();
    }
    if (!community) throw new Error('A aprovação não criou a comunidade.');
    row.status = 'approved';
    row.reviewedBy = request.vybeAccount!._id;
    row.reviewedAt = reviewedAt;
    response.json({ id: row._id.toString(), status: row.status, communityId: community._id.toString() });
  } catch (error) {
    if (copiedPhoto) await rm(destinationPhoto, { force: true }).catch(() => undefined);
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
      response.status(409).json({ error: 'O endereço de comunidade já está em uso.' }); return;
    }
    if (error instanceof Error && error.message === 'Solicitação não encontrada ou já revisada.') {
      response.status(404).json({ error: error.message }); return;
    }
    throw error;
  }
});
