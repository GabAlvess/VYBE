import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from '@vybe/shared';
import { Community, type CommunityDocument } from '../models/Community.js';
import { communityRequestsRouter } from './communityRequests.js';
import { communityJoinRequestsRouter } from './communityJoinRequests.js';
import { Account, Character, Session, type AccountDocument } from '../models/Social.js';
import { clearGlobalSessionCookie, clearSessionCookie, hashSessionToken, requireSession, requireTenant, setSessionCookie } from '../middleware/tenant.js';
import { socialRouter } from './social.js';
import { chatRouter } from './chat.js';
import { communitySettingsRouter } from './communitySettings.js';
import { matchRouter } from './match.js';
import { messagesAppRouter } from './messagesApp.js';
import { bankRouter } from './bank.js';
import { academicRouter } from './academic.js';
import { newsRouter } from './news.js';
import { isCommunityOwner, isPlatformAppCreator } from './communityAdminPolicy.js';
import { CommunitySanction } from '../models/CommunitySanction.js';
import { VybeSession } from '../models/VybeSession.js';
import { VybeAccount } from '../models/VybeAccount.js';
import { communityReportsRouter } from './communityReports.js';

export const tenantRouter = Router();
tenantRouter.use(requireTenant);
const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads');

function sessionCharacter(request: Request) {
  return request.vybeCharacter!;
}

function sessionTenant(request: Request) {
  return request.vybeTenant!;
}

async function claimCommunityOwnership(community: CommunityDocument, user: AccountDocument) {
  if (!community.ownerEmail || community.ownerEmail.toLowerCase() !== user.email.toLowerCase()) return;
  if (community.ownerAccountId && !community.ownerAccountId.equals(user._id)) return;
  community.ownerAccountId = user._id;
  if (!community.admins.some((id) => id.equals(user._id))) community.admins.push(user._id);
  await community.save();
}

function publicCharacter(character: { _id: mongoose.Types.ObjectId; username: string; displayName: string; communityFunction?: string; bio: string; age?: number; photoplayerName?: string; photoplayerImageUrl?: string; avatarUrl: string; coverUrl: string; followerCount: number; followingCount: number; postCount: number; verification?: { verifiedAt?: Date; removedAt?: Date } }) {
  return { id: character._id.toString(), username: character.username, displayName: character.displayName, communityFunction: character.communityFunction ?? '', bio: character.bio, age: character.age, photoplayerName: character.photoplayerName ?? '', photoplayerImageUrl: character.photoplayerImageUrl ?? '', avatarUrl: character.avatarUrl, coverUrl: character.coverUrl, followerCount: character.followerCount, followingCount: character.followingCount, postCount: character.postCount, verified: Boolean(character.verification?.verifiedAt && !character.verification.removedAt) };
}

async function issueSession(request: Request, response: Response, accountId: mongoose.Types.ObjectId, characterId: mongoose.Types.ObjectId) {
  const token = randomBytes(32).toString('base64url');
  await Session.create({ tenantId: sessionTenant(request)._id, accountId, characterId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
  setSessionCookie(response, token);
}

function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password: string, encoded: string) {
  const [salt, storedHash] = encoded.split(':');
  if (!salt || !storedHash) return false;
  const candidate = scryptSync(password, salt, 64);
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

function usernameFrom(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 24);
}

function sendError(response: Response, status: number, message: string) {
  response.status(status).json({ error: message });
}

async function saveProfileImage(value: unknown, tenantSlug: string) {
  if (typeof value !== 'string' || value.length > 3_000_000) throw new Error('Escolha uma imagem válida de até 2 MB.');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    const safeStoredMedia = new RegExp(`^/media/${tenantSlug}/[a-f0-9]{32}\\.(png|jpg|webp)$`);
    if (value === '' || safeStoredMedia.test(value)) return value;
    throw new Error('A imagem deve estar no formato PNG, JPEG ou WebP.');
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Cada imagem deve ter no máximo 2 MB.');
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
  const validSignature = extension === 'png'
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : extension === 'jpg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!validSignature) throw new Error('O arquivo escolhido não corresponde a uma imagem válida.');
  const filename = `${randomBytes(16).toString('hex')}.${extension}`;
  await mkdir(resolve(uploadsDirectory, tenantSlug), { recursive: true });
  await writeFile(resolve(uploadsDirectory, tenantSlug, filename), bytes, { flag: 'wx', mode: 0o600 });
  return `/media/${tenantSlug}/${filename}`;
}

tenantRouter.get('/community', async (request, response) => {
  const tenant = sessionTenant(request);
  const adminCharacter = tenant.settings?.privacy?.showAdmins !== false && tenant.admins.length
    ? await Character.findOne({ tenantId: tenant._id, accountId: { $in: tenant.admins } }).sort({ createdAt: 1 })
    : null;
  response.json({ id: tenant._id.toString(), name: tenant.name, slug: tenant.slug, subdomain: tenant.subdomain, description: tenant.description, coverUrl: tenant.coverUrl, wallpaperUrl: tenant.wallpaperUrl ?? '', logoUrl: tenant.logoUrl, type: tenant.type, entry: tenant.entry, status: tenant.status, brand: tenant.brand, settings: { features: tenant.settings?.features }, rules: tenant.rules, memberCount: tenant.memberCount, administrators: adminCharacter ? [publicCharacter(adminCharacter)] : [] });
});

tenantRouter.post('/auth/register', async (request, response) => {
  const tenant = sessionTenant(request);
  const { email, password, displayName, username, bio, termsAccepted, termsVersion, privacyVersion } = request.body ?? {};
  if (termsAccepted !== true || termsVersion !== LEGAL_TERMS_VERSION || privacyVersion !== LEGAL_PRIVACY_VERSION) {
    sendError(response, 400, 'É necessário aceitar a versão atual dos Termos de Uso e da Política de Privacidade.'); return;
  }
  if (bio !== undefined && (typeof bio !== 'string' || bio.length > 1000)) { sendError(response, 400, 'A bio pode ter até 1.000 caracteres.'); return; }
  if (tenant.settings?.characters?.requireBio && (typeof bio !== 'string' || bio.trim().length < 3)) { sendError(response, 400, 'Esta comunidade exige uma bio de pelo menos 3 caracteres.'); return; }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 8 || password.length > 128 || typeof displayName !== 'string' || displayName.trim().length < 2 || displayName.trim().length > 60) {
    sendError(response, 400, 'Informe nome, e-mail válido e senha com pelo menos 8 caracteres.'); return;
  }
  const normalizedEmail = email.trim().toLowerCase();
  const ownerBootstrap = tenant.ownerEmail?.toLowerCase() === normalizedEmail && !tenant.ownerAccountId;
  if (!ownerBootstrap) { sendError(response, 403, 'Crie sua conta VYBE no site principal e escolha uma comunidade para entrar.'); return; }
  if (await Account.exists({ tenantId: tenant._id, email: normalizedEmail })) { sendError(response, 409, 'Já existe uma conta com este e-mail nesta comunidade.'); return; }
  const baseUsername = usernameFrom(typeof username === 'string' ? username : displayName) || 'personagem';
  let characterUsername = baseUsername;
  const usernameRules = tenant.settings?.characters;
  if (characterUsername.length < (usernameRules?.usernameMinLength ?? 3) || characterUsername.length > (usernameRules?.usernameMaxLength ?? 24)) { sendError(response, 400, `O username deve ter entre ${usernameRules?.usernameMinLength ?? 3} e ${usernameRules?.usernameMaxLength ?? 24} caracteres.`); return; }
  while (await Character.exists({ tenantId: tenant._id, username: characterUsername })) characterUsername = `${baseUsername.slice(0, 19)}${randomBytes(2).toString('hex')}`;
  let account: InstanceType<typeof Account> | null = null;
  try {
    const acceptedAt = new Date();
    account = await Account.create({ tenantId: tenant._id, email: normalizedEmail, passwordHash: hashPassword(password), status: 'active', termsAcceptedAt: acceptedAt, termsVersion: LEGAL_TERMS_VERSION, privacyAcceptedAt: acceptedAt, privacyVersion: LEGAL_PRIVACY_VERSION });
    const character = await Character.create({ tenantId: tenant._id, accountId: account._id, username: characterUsername, displayName: displayName.trim(), bio: typeof bio === 'string' ? bio.trim() : '' });
    await claimCommunityOwnership(tenant, account);
    tenant.memberCount += 1;
    await tenant.save();
    await issueSession(request, response, account._id, character._id);
    response.status(201).json({ account: { id: account._id.toString(), email: account.email }, character: publicCharacter(character) });
  } catch (error) {
    if (account) await Account.deleteOne({ _id: account._id, tenantId: tenant._id });
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { sendError(response, 409, 'Este nome de personagem já está em uso.'); return; }
    throw error;
  }
});

tenantRouter.post('/auth/login', async (request, response) => {
  const tenant = sessionTenant(request);
  const { email, password } = request.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') { sendError(response, 400, 'Informe e-mail e senha.'); return; }
  const normalizedEmail = email.trim().toLowerCase();
  const globalAccount = await VybeAccount.findOne({ email: normalizedEmail, status: 'active' });
  if (globalAccount && verifyPassword(password, globalAccount.passwordHash)) {
    const memberAccount = await Account.findOne({ tenantId: tenant._id, status: 'active', $or: [{ globalAccountId: globalAccount._id }, { email: normalizedEmail }] });
    if (!memberAccount) { sendError(response, 403, 'Você ainda não participa desta comunidade. Entre na sua conta VYBE para solicitar ou iniciar a entrada.'); return; }
    const memberCharacter = await Character.findOne({ tenantId: tenant._id, accountId: memberAccount._id }).sort({ createdAt: 1 });
    if (!memberCharacter) { sendError(response, 403, 'Seu perfil nesta comunidade ainda não está disponível.'); return; }
    await issueSession(request, response, memberAccount._id, memberCharacter._id);
    response.json({ account: { id: memberAccount._id.toString(), email: memberAccount.email }, character: publicCharacter(memberCharacter) });
    return;
  }
  const account = await Account.findOne({ tenantId: tenant._id, email: normalizedEmail });
  if (!account || !verifyPassword(password, account.passwordHash)) { sendError(response, 401, 'E-mail ou senha inválidos.'); return; }
  if (account.status === 'disabled') {
    const sanction = await CommunitySanction.findOne({ tenantId: tenant._id, accountId: account._id, status: 'active' });
    if (sanction?.endsAt && sanction.endsAt <= new Date()) {
      sanction.status = 'expired';
      account.status = 'active';
      await Promise.all([sanction.save(), account.save()]);
    } else {
      sendError(response, 403, sanction?.action === 'ban' ? 'Seu acesso a esta comunidade foi banido.' : sanction ? 'Seu acesso a esta comunidade está suspenso.' : 'Conta indisponível.');
      return;
    }
  }
  if (account.status === 'pending') { sendError(response, 403, 'Seu pedido de entrada ainda aguarda aprovação da equipe.'); return; }
  await claimCommunityOwnership(tenant, account);
  const character = await Character.findOne({ tenantId: tenant._id, accountId: account._id }).sort({ createdAt: 1 });
  if (!character) { sendError(response, 403, 'Sua conta ainda não possui um personagem nesta comunidade.'); return; }
  await issueSession(request, response, account._id, character._id);
  response.json({ account: { id: account._id.toString(), email: account.email }, character: publicCharacter(character) });
});

tenantRouter.get('/auth/me', requireSession, (request, response) => {
  response.json({ account: { id: request.vybeAccount!._id.toString(), email: request.vybeAccount!.email }, character: publicCharacter(sessionCharacter(request)) });
});

tenantRouter.post('/auth/logout', async (request, response) => {
  const cookies = request.headers.cookie?.split(';').map((part) => part.trim()) ?? [];
  const cookie = cookies.find((part) => part.startsWith('vybe_session='));
  const token = cookie?.slice('vybe_session='.length);
  if (token) await Session.deleteOne({ tenantId: sessionTenant(request)._id, tokenHash: hashSessionToken(decodeURIComponent(token)) });
  const globalCookie = cookies.find((part) => part.startsWith('vybe_account_session='));
  const globalToken = globalCookie?.slice('vybe_account_session='.length);
  if (globalToken) await VybeSession.deleteOne({ tokenHash: hashSessionToken(decodeURIComponent(globalToken)) });
  clearSessionCookie(response);
  clearGlobalSessionCookie(response);
  response.status(204).end();
});

// Community creation requests belong to the global VYBE account and can be
// submitted by users who are not members of this tenant. Editorial review
// endpoints keep their own session and admin checks inside this router.
tenantRouter.use(communityRequestsRouter);
tenantRouter.use(requireSession);
tenantRouter.get('/community/admin-access', (request, response) => {
  const community = sessionTenant(request);
  const user = request.vybeAccount!;
  response.json({ canManage: isCommunityOwner(community, user) || isPlatformAppCreator(user) });
});
tenantRouter.use(communityJoinRequestsRouter);
tenantRouter.use(communitySettingsRouter);
tenantRouter.use('/community-reports', communityReportsRouter);
tenantRouter.use('/bank', bankRouter);
tenantRouter.use('/academic', academicRouter);
tenantRouter.use('/news', newsRouter);

tenantRouter.get('/me/character', (request, response) => response.json(publicCharacter(sessionCharacter(request))));

tenantRouter.patch('/me/character', async (request, response) => {
  const character = sessionCharacter(request);
  const { displayName, username, communityFunction, bio, avatarUrl, coverUrl } = request.body ?? {};
  const updates: Record<string, string> = {};
  if (displayName !== undefined) {
    if (typeof displayName !== 'string' || displayName.trim().length < 2 || displayName.trim().length > 60) { sendError(response, 400, 'Nome deve ter entre 2 e 60 caracteres.'); return; }
    updates.displayName = displayName.trim();
  }
  if (username !== undefined) {
    if (typeof username !== 'string') { sendError(response, 400, 'Informe um username válido.'); return; }
    const normalizedUsername = username.trim().replace(/^@/, '').toLowerCase();
    const usernameRules = sessionTenant(request).settings?.characters;
    if (!/^[a-z0-9._]{3,24}$/.test(normalizedUsername) || normalizedUsername.length < (usernameRules?.usernameMinLength ?? 3) || normalizedUsername.length > (usernameRules?.usernameMaxLength ?? 24)) { sendError(response, 400, `O username deve ter entre ${usernameRules?.usernameMinLength ?? 3} e ${usernameRules?.usernameMaxLength ?? 24} caracteres válidos.`); return; }
    if (await Character.exists({ tenantId: sessionTenant(request)._id, username: normalizedUsername, _id: { $ne: character._id } })) { sendError(response, 409, 'Este username já está em uso nesta comunidade.'); return; }
    updates.username = normalizedUsername;
  }
  if (bio !== undefined) {
    if (typeof bio !== 'string' || bio.length > 1000) { sendError(response, 400, 'A bio pode ter até 1.000 caracteres.'); return; }
    if (sessionTenant(request).settings?.characters?.requireBio && bio.trim().length < 3) { sendError(response, 400, 'Esta comunidade exige uma bio de pelo menos 3 caracteres.'); return; }
    updates.bio = bio.trim();
  }
  if (communityFunction !== undefined) {
    if (typeof communityFunction !== 'string' || communityFunction.trim().length > 80) { sendError(response, 400, 'A função na comunidade pode ter até 80 caracteres.'); return; }
    updates.communityFunction = communityFunction.trim();
  }
  try {
    if (avatarUrl !== undefined) updates.avatarUrl = await saveProfileImage(avatarUrl, sessionTenant(request).slug);
    if (coverUrl !== undefined) updates.coverUrl = await saveProfileImage(coverUrl, sessionTenant(request).slug);
  } catch (error) {
    sendError(response, 400, error instanceof Error ? error.message : 'Não foi possível salvar a imagem.'); return;
  }
  const updated = await Character.findOneAndUpdate({ _id: character._id, tenantId: sessionTenant(request)._id, accountId: request.vybeAccount!._id }, { $set: updates }, { new: true, runValidators: true });
  if (!updated) { sendError(response, 404, 'Personagem não encontrado.'); return; }
  response.json(publicCharacter(updated));
});

tenantRouter.use(socialRouter);
tenantRouter.use('/match', matchRouter);
tenantRouter.use('/messages-v2', messagesAppRouter);
tenantRouter.use(chatRouter);
