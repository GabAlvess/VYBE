import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response, type NextFunction } from 'express';
import mongoose from 'mongoose';
import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from '@vybe/shared';
import { Community } from '../models/Community.js';
import { CommunityRequest } from '../models/CommunityRequest.js';
import { CommunityJoinRequest } from '../models/CommunityJoinRequest.js';
import { Account, Character } from '../models/Social.js';
import { VybeAccount } from '../models/VybeAccount.js';
import { VybeSession } from '../models/VybeSession.js';
import { VybeNotification } from '../models/VybeNotification.js';
import { normalizeJoinUsername, normalizePhotoplayerName, validateJoinAge, validateJoinText, validateJoinUsername } from './communityJoinPolicy.js';
import { requiresJoinApproval } from './communityEntryPolicy.js';

export const platformRouter = Router();
const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads');
const globalAccount = (request: Request) => request.vybeGlobalAccount!;
const fail = (response: Response, status: number, error: string) => response.status(status).json({ error });

function hashPassword(password: string, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
function verifyPassword(password: string, encoded: string) {
  const [salt, storedHash] = encoded.split(':');
  if (!salt || !storedHash) return false;
  const candidate = scryptSync(password, salt, 64); const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
function usernameFrom(value: string) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 24); }
function tokenFrom(request: Request) {
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('vybe_account_session='));
  return cookie ? decodeURIComponent(cookie.slice('vybe_account_session='.length)) : '';
}
function setGlobalCookie(response: Response, token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const domain = process.env.NODE_ENV === 'production' ? '; Domain=.vybe.com.br' : '';
  response.setHeader('Set-Cookie', `vybe_account_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}${domain}`);
}
function clearGlobalCookie(response: Response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const domain = process.env.NODE_ENV === 'production' ? '; Domain=.vybe.com.br' : '';
  response.setHeader('Set-Cookie', `vybe_account_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}${domain}`);
}
async function issueGlobalSession(response: Response, accountId: mongoose.Types.ObjectId) {
  const token = randomBytes(32).toString('base64url');
  await VybeSession.create({ accountId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
  setGlobalCookie(response, token);
}
async function requireGlobal(request: Request, response: Response, next: NextFunction) {
  const token = tokenFrom(request);
  if (!token) { fail(response, 401, 'Entre na sua conta VYBE.'); return; }
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session: any = await VybeSession.findOne({ tokenHash, expiresAt: { $gt: new Date() } });
  const account = session ? await VybeAccount.findOne({ _id: session.accountId, status: 'active' }) : null;
  if (!account) { fail(response, 401, 'Sua sessão VYBE expirou. Entre novamente.'); return; }
  request.vybeGlobalAccount = account;
  next();
}
async function savePhotoplayerImage(value: unknown, slug: string) {
  if (typeof value !== 'string' || value.length > 7_000_000) throw new Error('Envie uma foto de até 5 MB.');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('A foto deve ser JPG, PNG ou WEBP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 16 || bytes.length > 5 * 1024 * 1024) throw new Error('A foto deve ter até 5 MB.');
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
  const valid = extension === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : extension === 'jpg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new Error('O arquivo escolhido não corresponde a uma imagem válida.');
  const filename = `${randomBytes(16).toString('hex')}.${extension}`;
  await mkdir(resolve(uploadsDirectory, slug), { recursive: true });
  await writeFile(resolve(uploadsDirectory, slug, filename), bytes, { flag: 'wx', mode: 0o600 });
  return { filename, extension: extension as 'png' | 'jpg' | 'webp' };
}
function requestJson(row: InstanceType<typeof CommunityJoinRequest>, photoUrl: string) {
  return { id: row._id.toString(), communityId: row.communityId.toString(), communitySlug: row.communitySlug, characterName: row.characterName, requestedUsername: row.requestedUsername, characterAge: row.characterAge, photoplayerName: row.photoplayerName, photoplayerImageUrl: photoUrl, characterDescription: row.characterDescription, customAnswers: row.customAnswers, status: row.status, requestedChanges: row.requestedChanges, adminMessage: row.adminMessage, rejectionReason: row.rejectionReason, createdAt: row.createdAt, reviewedAt: row.reviewedAt };
}

platformRouter.use((request, _response, next) => {
  const host = request.hostname.toLowerCase().replace(/\.$/, '');
  const localPlatformHost = process.env.NODE_ENV === 'development' && ['localhost', '127.0.0.1'].includes(host);
  if (request.vybeTenant && !localPlatformHost) { next('router'); return; }
  next();
});

platformRouter.post('/auth/register', async (request, response) => {
  const { email, password, displayName, termsAccepted, termsVersion, privacyVersion } = request.body ?? {};
  if (termsAccepted !== true || termsVersion !== LEGAL_TERMS_VERSION || privacyVersion !== LEGAL_PRIVACY_VERSION) { fail(response, 400, 'É necessário aceitar os Termos de Uso e a Política de Privacidade atuais.'); return; }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 8 || password.length > 128 || typeof displayName !== 'string' || displayName.trim().length < 2 || displayName.trim().length > 60) { fail(response, 400, 'Informe nome, e-mail válido e senha com pelo menos 8 caracteres.'); return; }
  const normalizedEmail = email.trim().toLowerCase();
  if (await VybeAccount.exists({ email: normalizedEmail })) { fail(response, 409, 'Já existe uma conta VYBE com este e-mail.'); return; }
  const base = usernameFrom(displayName) || 'membro';
  let username = base.length >= 3 ? base : `membro.${base}`;
  if (await VybeAccount.exists({ username })) username = `${username.slice(0, 19)}.${randomBytes(2).toString('hex')}`;
  const acceptedAt = new Date();
  try {
    const account = await VybeAccount.create({ email: normalizedEmail, passwordHash: hashPassword(password), displayName: displayName.trim(), username, avatarUrl: '', status: 'active', termsAcceptedAt: acceptedAt, termsVersion, privacyAcceptedAt: acceptedAt, privacyVersion });
    await issueGlobalSession(response, account._id);
    response.status(201).json({ account: { id: account._id.toString(), email: account.email }, character: { id: account._id.toString(), username: account.username, displayName: account.displayName, bio: '', avatarUrl: account.avatarUrl, coverUrl: '', followerCount: 0, followingCount: 0, postCount: 0, verified: false }, globalAccount: true });
  } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { fail(response, 409, 'Este e-mail ou username já está em uso.'); return; } throw error; }
});

platformRouter.post('/auth/login', async (request, response) => {
  const { email, password } = request.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') { fail(response, 400, 'Informe e-mail e senha.'); return; }
  const account = await VybeAccount.findOne({ email: email.trim().toLowerCase(), status: 'active' });
  if (!account || !verifyPassword(password, account.passwordHash)) { fail(response, 401, 'E-mail ou senha inválidos.'); return; }
  await issueGlobalSession(response, account._id);
  response.json({ account: { id: account._id.toString(), email: account.email }, character: { id: account._id.toString(), username: account.username, displayName: account.displayName, bio: '', avatarUrl: account.avatarUrl, coverUrl: '', followerCount: 0, followingCount: 0, postCount: 0, verified: false }, globalAccount: true });
});

platformRouter.get('/auth/me', requireGlobal, (request, response) => {
  const account = globalAccount(request);
  response.json({ account: { id: account._id.toString(), email: account.email }, character: { id: account._id.toString(), username: account.username, displayName: account.displayName, bio: '', avatarUrl: account.avatarUrl, coverUrl: '', followerCount: 0, followingCount: 0, postCount: 0, verified: false }, globalAccount: true });
});

platformRouter.post('/auth/logout', async (request, response) => {
  const token = tokenFrom(request);
  if (token) await VybeSession.deleteOne({ tokenHash: createHash('sha256').update(token).digest('hex') });
  clearGlobalCookie(response); response.status(204).end();
});

platformRouter.get('/communities', requireGlobal, async (request, response) => {
  const account = globalAccount(request);
  const communities: any[] = await Community.find({ status: 'active', type: 'public' }).select('name slug subdomain description coverUrl logoUrl category memberCount settings').sort({ createdAt: 1 }).limit(100).lean();
  const ids = communities.map((item) => item._id);
  const [memberships, requests] = await Promise.all([
    Account.find({ tenantId: { $in: ids }, status: 'active', $or: [{ globalAccountId: account._id }, { email: account.email }] }).select('tenantId').lean(),
    CommunityJoinRequest.find({ communityId: { $in: ids }, vybeAccountId: account._id }).select('communityId status').lean(),
  ]);
  response.json({ currentTenantSlug: request.vybeTenant?.slug ?? '', communities: communities.map((item) => ({ id: String(item._id), name: item.name, slug: item.slug, subdomain: item.subdomain, description: item.description, coverUrl: item.coverUrl ? `/api/communities/${item.slug}/cover` : '', logoUrl: item.logoUrl, category: item.category, memberCount: item.memberCount, requiresApproval: requiresJoinApproval(item), joinStatus: memberships.some((member) => String(member.tenantId) === String(item._id)) ? 'MEMBER' : requests.find((joinRequest) => String(joinRequest.communityId) === String(item._id))?.status ?? 'NONE' })) });
});

platformRouter.get('/community-requests', requireGlobal, async (request, response) => {
  const account = globalAccount(request);
  const rows = await CommunityRequest.find({ $or: [
    { globalAccountId: account._id },
    { applicantEmail: account.email },
  ] }).sort({ createdAt: -1 }).limit(20).lean();
  response.json(rows.map((row) => ({
    id: String(row._id), rpgName: row.rpgName, slug: row.slug,
    description: row.description, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
    photoUrl: `/api/community-requests/${String(row._id)}/photo`,
  })));
});

platformRouter.get('/community-requests/:requestId/photo', requireGlobal, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(404).end(); return; }
  const account = globalAccount(request);
  const row = await CommunityRequest.findOne({ _id: request.params.requestId, $or: [
    { globalAccountId: account._id },
    { applicantEmail: account.email },
  ] });
  if (!row || !/^[a-z0-9-]+$/.test(row.sourceTenantSlug) || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(row.photoFilename)) { response.status(404).end(); return; }
  response.sendFile(row.photoFilename, { root: resolve(uploadsDirectory, row.sourceTenantSlug) }, (error) => {
    if (error && !response.headersSent) response.status(404).end();
  });
});

platformRouter.post('/community-requests', requireGlobal, async (request, response) => {
  const account = globalAccount(request);
  const rpgName = typeof request.body?.rpgName === 'string' ? request.body.rpgName.trim() : '';
  const description = typeof request.body?.description === 'string' ? request.body.description.trim() : '';
  const photo = typeof request.body?.photo === 'string' ? request.body.photo : '';
  if (rpgName.length < 2 || rpgName.length > 80) { fail(response, 400, 'O nome da comunidade deve ter entre 2 e 80 caracteres.'); return; }
  if (description.length < 10 || description.length > 500) { fail(response, 400, 'Conte um pouco sobre a comunidade (de 10 a 500 caracteres).'); return; }
  const imageMatch = photo.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!imageMatch) { fail(response, 400, 'Escolha uma imagem PNG, JPG ou WebP para a capa.'); return; }
  const imageBytes = Buffer.from(imageMatch[2], 'base64');
  if (imageBytes.byteLength < 16 || imageBytes.byteLength > 3 * 1024 * 1024) { fail(response, 400, 'A imagem deve ter no máximo 3 MB.'); return; }
  const extension = imageMatch[1] === 'jpeg' ? 'jpg' : imageMatch[1];
  const signatureMatches = extension === 'png'
    ? imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : extension === 'jpg' ? imageBytes[0] === 0xff && imageBytes[1] === 0xd8 && imageBytes[2] === 0xff
      : imageBytes.subarray(0, 4).toString() === 'RIFF' && imageBytes.subarray(8, 12).toString() === 'WEBP';
  if (!signatureMatches) { fail(response, 400, 'O arquivo escolhido não corresponde a uma imagem válida.'); return; }
  const slug = rpgName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  if (slug.length < 3 || new Set(['api', 'www', 'community', 'vybe', 'admin', 'app']).has(slug)) { fail(response, 400, 'Este nome não pode ser usado como endereço de comunidade.'); return; }
  if (await Community.exists({ $or: [{ slug }, { subdomain: slug }] })) { fail(response, 409, 'Já existe uma comunidade com o endereço gerado para esse nome.'); return; }
  if (await CommunityRequest.exists({ slug, status: 'pending' })) { fail(response, 409, 'Já existe uma solicitação aguardando aprovação para este nome.'); return; }
  const sourceTenant = request.vybeTenant ?? await Community.findOne({ slug: process.env.VYBE_PLATFORM_TENANT_SLUG ?? 'community', status: 'active' });
  if (!sourceTenant) { fail(response, 503, 'Não foi possível registrar a solicitação agora. Tente novamente.'); return; }
  const filename = `${randomBytes(16).toString('hex')}.${extension}`;
  const sourceDirectory = resolve(uploadsDirectory, sourceTenant.slug);
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(resolve(sourceDirectory, filename), imageBytes, { flag: 'wx', mode: 0o600 });
  try {
    const row = await CommunityRequest.create({
      sourceTenantId: sourceTenant._id, sourceTenantSlug: sourceTenant.slug,
      globalAccountId: account._id, applicantEmail: account.email,
      applicantName: account.displayName, applicantUsername: account.username,
      rpgName, slug, description, photoFilename: filename, photoExtension: extension, status: 'pending',
    });
    response.status(201).json({ id: String(row._id), rpgName: row.rpgName, slug: row.slug, description: row.description, status: row.status, createdAt: row.createdAt });
  } catch (error) {
    await rm(resolve(sourceDirectory, filename), { force: true });
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { fail(response, 409, 'Já existe uma solicitação aguardando aprovação para este nome.'); return; }
    throw error;
  }
});

platformRouter.get('/communities/:slug/cover', async (request, response) => {
  const community: any = await Community.findOne({ slug: request.params.slug, status: 'active', type: 'public' }).select('slug coverUrl').lean();
  const filename = community?.coverUrl.match(/^\/media\/[a-z0-9-]+\/([a-f0-9]{32}\.(?:png|jpg|webp))$/)?.[1];
  if (!community || !filename) { response.status(404).end(); return; }
  response.sendFile(filename, { root: resolve(uploadsDirectory, community.slug) }, (error) => { if (error && !response.headersSent) response.status(404).end(); });
});

platformRouter.get('/communities/:slug/join-info', requireGlobal, async (request, response) => {
  const community: any = await Community.findOne({ slug: request.params.slug, status: 'active', type: 'public' }).select('name slug subdomain logoUrl coverUrl entry settings').lean();
  if (!community) { fail(response, 404, 'Comunidade não encontrada.'); return; }
  const account = globalAccount(request);
  const [member, joinRequest] = await Promise.all([
    Account.findOne({ tenantId: community._id, status: 'active', $or: [{ globalAccountId: account._id }, { email: account.email }] }).select('_id').lean(),
    CommunityJoinRequest.findOne({ communityId: community._id, vybeAccountId: account._id }),
  ]);
  const requestPhoto = joinRequest ? `/api/community-join-requests/${joinRequest._id}/photo` : '';
  response.json({ community: { id: String(community._id), name: community.name, slug: community.slug, subdomain: community.subdomain, logoUrl: community.logoUrl, coverUrl: community.coverUrl }, account: { displayName: account.displayName, username: account.username, avatarUrl: account.avatarUrl }, minimumAge: community.settings?.characters?.minimumAge ?? 18, usernameMinLength: community.settings?.characters?.usernameMinLength ?? 3, usernameMaxLength: community.settings?.characters?.usernameMaxLength ?? 24, customQuestions: community.settings?.characters?.customFields ?? [], requiresApproval: requiresJoinApproval(community), membershipStatus: member ? 'MEMBER' : 'NONE', request: joinRequest ? requestJson(joinRequest, requestPhoto) : null });
});

platformRouter.get('/communities/:slug/join-availability', requireGlobal, async (request, response) => {
  const community: any = await Community.findOne({ slug: request.params.slug, status: 'active' }).select('_id').lean();
  if (!community) { fail(response, 404, 'Comunidade não encontrada.'); return; }
  const username = typeof request.query.username === 'string' ? normalizeJoinUsername(request.query.username) : '';
  const photoplayer = typeof request.query.photoplayer === 'string' ? normalizePhotoplayerName(request.query.photoplayer) : '';
  const account = globalAccount(request);
  const [usernameUsed, photoUsed, usernameRequested, photoRequested] = await Promise.all([
    username ? Character.exists({ tenantId: community._id, username }) : false,
    photoplayer ? Character.exists({ tenantId: community._id, normalizedPhotoplayerName: photoplayer }) : false,
    username ? CommunityJoinRequest.exists({ communityId: community._id, vybeAccountId: { $ne: account._id }, normalizedUsername: username, status: { $in: ['PENDING', 'NEEDS_INFORMATION'] } }) : false,
    photoplayer ? CommunityJoinRequest.exists({ communityId: community._id, vybeAccountId: { $ne: account._id }, normalizedPhotoplayerName: photoplayer, status: { $in: ['PENDING', 'NEEDS_INFORMATION'] } }) : false,
  ]);
  response.json({ usernameAvailable: username ? !usernameUsed && !usernameRequested : null, photoplayerAvailable: photoplayer ? !photoUsed && !photoRequested : null });
});

platformRouter.post('/communities/:slug/join', requireGlobal, async (request, response) => {
  const community: any = await Community.findOne({ slug: request.params.slug, status: 'active', type: 'public' });
  if (!community) { fail(response, 404, 'Comunidade não encontrada.'); return; }
  const account = globalAccount(request);
  if (requiresJoinApproval(community)) { fail(response, 403, 'Esta comunidade exige uma ficha de entrada e aprovação da administração.'); return; }
  if (await Account.exists({ tenantId: community._id, status: 'active', $or: [{ globalAccountId: account._id }, { email: account.email }] })) { response.json({ joined: true, subdomain: community.subdomain }); return; }
  let username = account.username;
  if (await Character.exists({ tenantId: community._id, username })) username = `${username.slice(0, 18)}.${randomBytes(2).toString('hex')}`;
  let createdAccountId: mongoose.Types.ObjectId | undefined;
  let createdCharacterId: mongoose.Types.ObjectId | undefined;
  try {
    const localAccount = await Account.create({ tenantId: community._id, globalAccountId: account._id, email: account.email, passwordHash: hashPassword(randomBytes(64).toString('hex')), status: 'active', termsAcceptedAt: account.termsAcceptedAt, termsVersion: account.termsVersion, privacyAcceptedAt: account.privacyAcceptedAt, privacyVersion: account.privacyVersion });
    createdAccountId = localAccount._id;
    const localCharacter = await Character.create({ tenantId: community._id, accountId: localAccount._id, username, displayName: account.displayName, bio: '', avatarUrl: account.avatarUrl });
    createdCharacterId = localCharacter._id;
    community.memberCount += 1; await community.save();
  } catch (error) {
    if (createdCharacterId) await Character.deleteOne({ _id: createdCharacterId, tenantId: community._id });
    if (createdAccountId) await Account.deleteOne({ _id: createdAccountId, tenantId: community._id });
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { fail(response, 409, 'Seu perfil inicial entrou em conflito com um perfil existente. Tente novamente.'); return; }
    throw error;
  }
  response.status(201).json({ joined: true, subdomain: community.subdomain });
});

platformRouter.post('/communities/:slug/join-requests', requireGlobal, async (request, response) => {
  const community: any = await Community.findOne({ slug: request.params.slug, status: 'active', type: 'public' });
  if (!community) { fail(response, 404, 'Comunidade não encontrada.'); return; }
  const account = globalAccount(request); const body = request.body ?? {};
  const questions: Array<{ key: string; label: string; required: boolean }> = community.settings?.characters?.customFields ?? [];
  const values = body.customAnswers && typeof body.customAnswers === 'object' && !Array.isArray(body.customAnswers) ? body.customAnswers as Record<string, unknown> : {};
  if (Object.keys(values).some((key) => !questions.some((question) => question.key === key))) { fail(response, 400, 'As perguntas da comunidade mudaram. Atualize a ficha.'); return; }
  const customAnswers = [];
  for (const question of questions) { const value = typeof values[question.key] === 'string' ? (values[question.key] as string).trim() : ''; if (question.required && !value) { fail(response, 400, `Preencha “${question.label}”.`); return; } if (value.length > 500) { fail(response, 400, `A resposta “${question.label}” deve ter no máximo 500 caracteres.`); return; } if (value) customAnswers.push({ key: question.key, label: question.label, value }); }
  const characterName = typeof body.characterName === 'string' ? body.characterName.trim() : '';
  const username = normalizeJoinUsername(body.username ?? ''); const age = body.age;
  const photoplayerName = typeof body.photoplayerName === 'string' ? body.photoplayerName.trim().replace(/\s+/g, ' ') : '';
  const normalizedPhotoplayerName = normalizePhotoplayerName(photoplayerName);
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const minUsername = community.settings?.characters?.usernameMinLength ?? 3; const maxUsername = community.settings?.characters?.usernameMaxLength ?? 24; const minimumAge = community.settings?.characters?.minimumAge ?? 18;
  if (!validateJoinText(characterName, 2, 60)) { fail(response, 400, 'Informe o nome do personagem.'); return; }
  if (!validateJoinUsername(username, minUsername, maxUsername)) { fail(response, 400, `O username deve ter de ${minUsername} a ${maxUsername} caracteres válidos.`); return; }
  if (!validateJoinAge(age, minimumAge)) { fail(response, 400, `Seu personagem não atende à idade mínima de ${minimumAge} anos.`); return; }
  if (!validateJoinText(photoplayerName, 2, 100)) { fail(response, 400, 'Informe o nome do photoplayer.'); return; }
  if (!validateJoinText(description, 10, 1000)) { fail(response, 400, 'Conte um pouco sobre seu personagem.'); return; }
  if (body.confirmed !== true) { fail(response, 400, 'Confirme que as informações estão corretas e respeitam as regras.'); return; }
  if (await Account.exists({ tenantId: community._id, status: 'active', $or: [{ globalAccountId: account._id }, { email: account.email }] })) { fail(response, 409, 'Você já faz parte desta comunidade.'); return; }
  const oldRequest: any = await CommunityJoinRequest.findOne({ communityId: community._id, vybeAccountId: account._id });
  if (oldRequest?.status === 'PENDING' || oldRequest?.status === 'APPROVED') { fail(response, 409, oldRequest.status === 'PENDING' ? 'Sua solicitação já aguarda análise.' : 'Sua entrada já foi aprovada.'); return; }
  if (await Character.exists({ tenantId: community._id, username })) { fail(response, 409, 'Este username já está em uso nesta comunidade.'); return; }
  if (await Character.exists({ tenantId: community._id, normalizedPhotoplayerName })) { fail(response, 409, 'Este photoplayer já está em uso nesta comunidade.'); return; }
  const duplicate = await CommunityJoinRequest.exists({ communityId: community._id, vybeAccountId: { $ne: account._id }, status: { $in: ['PENDING', 'NEEDS_INFORMATION'] }, $or: [{ normalizedUsername: username }, { normalizedPhotoplayerName }] });
  if (duplicate) { fail(response, 409, 'Username ou photoplayer já está reservado em outra solicitação.'); return; }
  let image: { filename: string; extension: 'png' | 'jpg' | 'webp' };
  if (typeof body.photoplayerImage === 'string' && body.photoplayerImage) { try { image = await savePhotoplayerImage(body.photoplayerImage, community.slug); } catch (error) { fail(response, 400, error instanceof Error ? error.message : 'Não foi possível validar a foto.'); return; } }
  else if (oldRequest?.status === 'NEEDS_INFORMATION' && !oldRequest.requestedChanges.includes('photoplayer')) image = { filename: oldRequest.photoplayerImageFilename, extension: oldRequest.photoplayerImageExtension };
  else { fail(response, 400, 'Envie a foto do photoplayer.'); return; }
  const record = { communityId: community._id, communitySlug: community.slug, accountId: account._id, vybeAccountId: account._id, characterName, requestedUsername: username, normalizedUsername: username, characterAge: age, photoplayerName, normalizedPhotoplayerName, photoplayerImageFilename: image.filename, photoplayerImageExtension: image.extension, characterDescription: description, customAnswers, status: 'PENDING' as const, requestedChanges: [], adminMessage: '', rejectionReason: '', reviewedAt: undefined, reviewedBy: undefined };
  const row = oldRequest ? Object.assign(oldRequest, record) : new CommunityJoinRequest(record);
  await row.save(); response.status(201).json(requestJson(row, `/api/community-join-requests/${row._id}/photo`));
});

platformRouter.get('/my/community-join-requests', requireGlobal, async (request, response) => {
  const rows = await CommunityJoinRequest.find({ vybeAccountId: globalAccount(request)._id }).sort({ updatedAt: -1 }).limit(50).lean();
  response.json(rows.map((row) => ({ ...row, id: String(row._id), communityId: String(row.communityId), photoUrl: `/api/community-join-requests/${String(row._id)}/photo` })));
});

platformRouter.get('/notifications', requireGlobal, async (request, response) => {
  const rows = await VybeNotification.find({ accountId: globalAccount(request)._id }).sort({ createdAt: -1 }).limit(30).lean();
  const communities = await Community.find({ _id: { $in: rows.map((row) => row.communityId) } }).select('name slug').lean();
  const communityMap = new Map(communities.map((item) => [String(item._id), { name: item.name, slug: item.slug }]));
  response.json(rows.map((row) => ({ id: String(row._id), type: row.type, status: row.status, message: row.message, createdAt: row.createdAt, communityName: communityMap.get(String(row.communityId))?.name ?? 'Comunidade', communitySlug: communityMap.get(String(row.communityId))?.slug ?? '' })));
});

platformRouter.get('/community-join-requests/:id/photo', requireGlobal, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.id)) { response.status(404).end(); return; }
  const row: any = await CommunityJoinRequest.findOne({ _id: request.params.id, vybeAccountId: globalAccount(request)._id }).select('communitySlug photoplayerImageFilename').lean();
  if (!row || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(row.photoplayerImageFilename)) { response.status(404).end(); return; }
  response.sendFile(row.photoplayerImageFilename, { root: resolve(uploadsDirectory, row.communitySlug) }, (error) => { if (error && !response.headersSent) response.status(404).end(); });
});
