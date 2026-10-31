import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { Community } from '../models/Community.js';
import { CommunityAudit } from '../models/CommunityAudit.js';
import { CommunityRequest } from '../models/CommunityRequest.js';
import { CommunityJoinRequest } from '../models/CommunityJoinRequest.js';
import { Account, Character } from '../models/Social.js';

export const communityRequestsRouter = Router();

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
  const configuredAdmins = (process.env.VYBE_PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return tenant.admins.some((adminId) => adminId.equals(account._id))
    || configuredAdmins.includes(account.email.toLowerCase());
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

communityRequestsRouter.get('/communities', async (request, response) => {
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

communityRequestsRouter.get('/community-requests', async (request, response) => {
  const rows = await CommunityRequest.find({
    sourceTenantId: request.vybeTenant!._id,
    accountId: request.vybeAccount!._id,
  }).sort({ createdAt: -1 }).limit(20).lean();
  response.json(rows.map((row) => ({
    id: String(row._id), rpgName: row.rpgName, slug: row.slug,
    description: row.description, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
    photoUrl: `/api/community-requests/${String(row._id)}/photo`,
  })));
});

communityRequestsRouter.get('/community-requests/:requestId/photo', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(404).end(); return; }
  const row = await CommunityRequest.findOne({
    _id: request.params.requestId,
    sourceTenantId: request.vybeTenant!._id,
    accountId: request.vybeAccount!._id,
  });
  if (!row || !/^[a-z0-9-]+$/.test(row.sourceTenantSlug) || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(row.photoFilename)) { response.status(404).end(); return; }
  response.sendFile(row.photoFilename, { root: resolve(uploadsDirectory, row.sourceTenantSlug) }, (error) => {
    if (error && !response.headersSent) response.status(404).end();
  });
});

communityRequestsRouter.post('/community-requests', async (request, response) => {
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
  const filename = `${randomBytes(16).toString('hex')}.${extension}`;
  const tenantDirectory = resolve(uploadsDirectory, tenant.slug);
  await mkdir(tenantDirectory, { recursive: true });
  await writeFile(resolve(tenantDirectory, filename), imageBytes, { flag: 'wx', mode: 0o600 });
  const row = await CommunityRequest.create({
    sourceTenantId: tenant._id, sourceTenantSlug: tenant.slug,
    accountId: request.vybeAccount!._id, characterId: request.vybeCharacter!._id,
    rpgName, slug, description, photoFilename: filename, photoExtension: extension, status: 'pending',
  });
  response.status(201).json(requestJson(row));
});

communityRequestsRouter.get('/platform/community-requests', async (request, response) => {
  if (!isPlatformAdmin(request)) { denyReview(response); return; }
  const rows = await CommunityRequest.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(100).lean();
  const characterIds = rows.map((row) => row.characterId);
  const tenantIds = [...new Set(rows.map((row) => row.sourceTenantId.toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const characters = await Character.find({ _id: { $in: characterIds }, tenantId: { $in: tenantIds } }).select('displayName username tenantId').lean();
  const characterMap = new Map(characters.map((character) => [`${character.tenantId}:${character._id}`, character]));
  response.json(rows.map((row) => {
    const character = characterMap.get(`${row.sourceTenantId}:${row.characterId}`);
    return {
      ...requestJson(row), sourceTenantSlug: row.sourceTenantSlug,
      applicant: character ? { displayName: character.displayName, username: character.username } : null,
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
  const applicantAccount = await Account.findOne({ _id: row.accountId, tenantId: row.sourceTenantId }).select('email').lean();
  let createdCommunityId: mongoose.Types.ObjectId | undefined;
  try {
    await mkdir(destinationDirectory, { recursive: true });
    await copyFile(sourcePhoto, destinationPhoto);
    const community = await Community.create({
      name: row.rpgName, slug: row.slug, subdomain: row.slug, description: row.description,
      coverUrl: `/media/${row.slug}/${row.photoFilename}`,
      type: 'public', entry: 'open', status: 'active', memberCount: 0, admins: [], ownerEmail: applicantAccount?.email ?? '',
      brand: { primary: '#16815D', dark: '#0D6248', medium: '#35A67A', soft: '#F2FAF6', lilac: '#DDF3EA', white: '#FFFFFF', graphite: '#1F2422' },
      rules: ['Respeite os personagens e as histórias da comunidade.', 'Mantenha as conversas dentro do tema do RPG.', 'Siga as orientações da equipe de moderação.'],
    });
    createdCommunityId = community._id;
    row.status = 'approved';
    row.reviewedBy = request.vybeAccount!._id;
    row.reviewedAt = reviewedAt;
    await row.save();
    response.json({ id: row._id.toString(), status: row.status, communityId: community._id.toString() });
  } catch (error) {
    if (createdCommunityId) await Community.deleteOne({ _id: createdCommunityId }).catch(() => undefined);
    await rm(destinationPhoto, { force: true }).catch(() => undefined);
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
      response.status(409).json({ error: 'O endereço de comunidade já está em uso.' }); return;
    }
    throw error;
  }
});
