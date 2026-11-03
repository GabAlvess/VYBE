import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response, type NextFunction } from 'express';
import mongoose from 'mongoose';
import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from '@vybe/shared';
import { Community } from '../models/Community.js';
import { CommunityAudit } from '../models/CommunityAudit.js';
import { CommunityRequest } from '../models/CommunityRequest.js';
import { CommunityJoinRequest } from '../models/CommunityJoinRequest.js';
import { Account, Character, Notification } from '../models/Social.js';
import { Conversation, ConversationMessage } from '../models/Conversation.js';
import { VerificationRequest, canTransitionVerification, verificationStatuses, type VerificationStatus } from '../models/VerificationRequest.js';
import { VybeAccount } from '../models/VybeAccount.js';
import { VybeSession } from '../models/VybeSession.js';
import { VybeNotification } from '../models/VybeNotification.js';
import { normalizeJoinUsername, normalizePhotoplayerName, validateJoinAge, validateJoinText, validateJoinUsername } from './communityJoinPolicy.js';
import { requiresJoinApproval } from './communityEntryPolicy.js';
import { emitToProfiles } from '../realtime/chatWebSocket.js';
import { isVerificationActive } from '../services/verifiedSocialBenefits.js';
import { ensurePlatformSupport } from './verification.js';
import { conversationDirectKey } from './conversationPolicy.js';
import { ensureProvisioningCollections, provisionApprovedCommunity } from '../services/communityProvisioning.js';
import { isConfiguredPlatformAdmin } from '../services/platformAdminPolicy.js';
import { PlatformPaymentSettings, type PixKeyType } from '../models/PlatformPaymentSettings.js';
import { readPaymentProof } from '../services/privatePaymentProofs.js';

export const platformRouter = Router();
const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads');
const globalAccount = (request: Request) => request.vybeGlobalAccount!;
const fail = (response: Response, status: number, error: string) => response.status(status).json({ error });
function requirePlatformAdmin(request: Request, response: Response, next: NextFunction) {
  if (!request.vybeGlobalAccount || !isConfiguredPlatformAdmin(request.vybeGlobalAccount.email)) { fail(response, 403, 'Acesso restrito à equipe administrativa da plataforma VYBE.'); return; }
  next();
}

function hashPassword(password: string, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
function verifyPassword(password: string, encoded: string) {
  const [salt, storedHash] = encoded.split(':');
  if (!salt || !storedHash) return false;
  const candidate = scryptSync(password, salt, 64); const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
function usernameFrom(value: string) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 24); }
function parseProfileBirthDate(value: unknown): Date | undefined | null {
  if (value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || date > new Date()) return null;
  const oldest = new Date(); oldest.setUTCFullYear(oldest.getUTCFullYear() - 120);
  if (date < oldest) return null;
  return date;
}
function validateAccountAvatar(value: unknown): string | null | undefined {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 2_800_000) return null;
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) return null;
  const ext = match[1];
  const valid = ext === 'png'
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : ext === 'jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  return valid ? value : null;
}
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
  const globalProfileRoute = ['/account/profile', '/account/audio-preferences'].includes(request.path);
  if (request.vybeTenant && !localPlatformHost && !globalProfileRoute) { next('router'); return; }
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
  if (!account) { fail(response, 401, 'E-mail ou senha inválidos.'); return; }
  if (!verifyPassword(password, account.passwordHash)) {
    // In local development, repair a stale global password hash from the
    // linked community account so existing admin test accounts remain usable.
    const tenant = request.vybeTenant;
    const localFallback = process.env.NODE_ENV === 'development' && tenant
      ? await Account.findOne({ tenantId: tenant._id, globalAccountId: account._id, status: 'active' })
      : null;
    if (!localFallback || !verifyPassword(password, localFallback.passwordHash)) {
      fail(response, 401, 'E-mail ou senha inválidos.'); return;
    }
    account.passwordHash = localFallback.passwordHash;
    await account.save();
  }
  await issueGlobalSession(response, account._id);
  response.json({ account: { id: account._id.toString(), email: account.email }, character: { id: account._id.toString(), username: account.username, displayName: account.displayName, bio: '', avatarUrl: account.avatarUrl, coverUrl: '', followerCount: 0, followingCount: 0, postCount: 0, verified: false }, globalAccount: true });
});

platformRouter.get('/auth/me', requireGlobal, (request, response) => {
  const account = globalAccount(request);
  response.json({ account: { id: account._id.toString(), email: account.email }, character: { id: account._id.toString(), username: account.username, displayName: account.displayName, bio: '', avatarUrl: account.avatarUrl, coverUrl: '', followerCount: 0, followingCount: 0, postCount: 0, verified: false }, globalAccount: true });
});

platformRouter.get('/platform/admin/me', requireGlobal, (request, response) => {
  const account = globalAccount(request);
  if (!isConfiguredPlatformAdmin(account.email)) { fail(response, 403, 'Acesso restrito à equipe administrativa da plataforma VYBE.'); return; }
  response.json({ isPlatformAdmin: true, account: { id: account._id.toString(), displayName: account.displayName, username: account.username } });
});

platformRouter.get('/platform/admin/community-requests', requireGlobal, requirePlatformAdmin, async (_request, response) => {
  const rows = await CommunityRequest.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(100).lean();
  response.json(rows.map((row) => ({ id: String(row._id), rpgName: row.rpgName, slug: row.slug, description: row.description, status: row.status, createdAt: row.createdAt, sourceTenantSlug: row.sourceTenantSlug, applicant: { displayName: row.applicantName, username: row.applicantUsername }, photoUrl: `/api/platform/admin/community-requests/${String(row._id)}/photo` })));
});

platformRouter.get('/platform/admin/community-requests/:requestId/photo', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(404).end(); return; }
  const rowResult = await CommunityRequest.findOne({ _id: request.params.requestId, status: 'pending' }).select('sourceTenantSlug photoFilename').lean();
  const row = Array.isArray(rowResult) ? rowResult[0] : rowResult;
  if (!row || !/^[a-z0-9-]+$/.test(row.sourceTenantSlug) || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(row.photoFilename)) { response.status(404).end(); return; }
  response.sendFile(row.photoFilename, { root: resolve(uploadsDirectory, row.sourceTenantSlug) }, (error) => { if (error && !response.headersSent) response.status(404).end(); });
});

platformRouter.patch('/platform/admin/community-requests/:requestId', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const decision = request.body?.decision;
  if (decision !== 'approve' && decision !== 'reject') { fail(response, 400, 'Escolha aprovar ou recusar a solicitação.'); return; }
  const row = await CommunityRequest.findOne({ _id: request.params.requestId, status: 'pending' });
  if (!row) { fail(response, 404, 'Solicitação não encontrada ou já revisada.'); return; }
  const actor = globalAccount(request); const reviewedAt = new Date();
  if (decision === 'reject') {
    row.status = 'rejected'; row.reviewedBy = actor._id; row.reviewedAt = reviewedAt; await row.save();
    response.json({ id: row._id.toString(), status: row.status }); return;
  }
  if (await Community.exists({ $or: [{ slug: row.slug }, { subdomain: row.slug }] })) { fail(response, 409, 'O endereço desta comunidade já foi utilizado. Recuse esta solicitação e peça um novo nome ao responsável.'); return; }
  const destinationDirectory = resolve(uploadsDirectory, row.slug);
  const destinationPhoto = resolve(destinationDirectory, row.photoFilename);
  let copiedPhoto = false;
  try {
    await ensureProvisioningCollections(); await mkdir(destinationDirectory, { recursive: true });
    await copyFile(resolve(uploadsDirectory, row.sourceTenantSlug, row.photoFilename), destinationPhoto); copiedPhoto = true;
    const session = await mongoose.startSession(); let created: InstanceType<typeof Community> | undefined;
    try {
      await session.withTransaction(async () => {
        const pending = await CommunityRequest.findOne({ _id: row._id, status: 'pending' }).session(session);
        if (!pending) throw new Error('Solicitação não encontrada ou já revisada.');
        created = await provisionApprovedCommunity(pending, actor._id, session);
        pending.status = 'approved'; pending.reviewedBy = actor._id; pending.reviewedAt = reviewedAt; await pending.save({ session });
      });
    } finally { await session.endSession(); }
    if (!created) throw new Error('A aprovação não criou a comunidade.');
    response.json({ id: row._id.toString(), status: 'approved', communityId: created._id.toString() });
  } catch (error) {
    if (copiedPhoto) await rm(destinationPhoto, { force: true }).catch(() => undefined);
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { fail(response, 409, 'O endereço de comunidade já está em uso.'); return; }
    if (error instanceof Error && error.message === 'Solicitação não encontrada ou já revisada.') { fail(response, 404, error.message); return; }
    throw error;
  }
});

platformRouter.get('/platform/admin/communities', requireGlobal, requirePlatformAdmin, async (_request, response) => {
  const rows = await Community.find({ status: { $ne: 'deleted' } }).select('name slug subdomain description coverUrl memberCount status ownerEmail createdAt').sort({ createdAt: 1 }).lean();
  response.json(rows.map((row) => ({ id: String(row._id), name: row.name, slug: row.slug, subdomain: row.subdomain, description: row.description, coverUrl: row.coverUrl, memberCount: row.memberCount, status: row.status, ownerEmail: row.ownerEmail ?? '' })));
});

platformRouter.patch('/platform/admin/communities/:communityId', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.communityId)) { fail(response, 404, 'Comunidade não encontrada.'); return; }
  const status = request.body?.status;
  if (!['active', 'archived', 'suspended'].includes(status)) { fail(response, 400, 'Status inválido para a comunidade.'); return; }
  const community = await Community.findById(request.params.communityId);
  if (!community || community.status === 'deleted') { fail(response, 404, 'Comunidade não encontrada.'); return; }
  if (community.slug === (process.env.VYBE_PLATFORM_TENANT_SLUG ?? 'community')) { fail(response, 400, 'A comunidade principal da VYBE não pode ser arquivada.'); return; }
  community.status = status; await community.save();
  const actor = globalAccount(request);
  await CommunityAudit.create({ tenantId: community._id, actorId: actor._id, action: `platform.community.${status}`, details: { communityName: community.name, status, platformAdminId: actor._id.toString() } });
  response.json({ id: community._id.toString(), status: community.status });
});

platformRouter.delete('/platform/admin/communities/:communityId', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.communityId)) { fail(response, 404, 'Comunidade não encontrada.'); return; }
  const community = await Community.findById(request.params.communityId);
  if (!community || community.status === 'deleted') { fail(response, 404, 'Comunidade não encontrada.'); return; }
  if (community.slug === (process.env.VYBE_PLATFORM_TENANT_SLUG ?? 'community')) { fail(response, 400, 'A comunidade principal da VYBE não pode ser excluída.'); return; }
  community.status = 'deleted'; await community.save();
  const actor = globalAccount(request);
  await CommunityAudit.create({ tenantId: community._id, actorId: actor._id, action: 'platform.community.deleted', details: { communityName: community.name, platformAdminId: actor._id.toString() } });
  response.json({ id: community._id.toString(), status: community.status });
});

const verificationStatusLabel = (status: VerificationStatus) => ({ PENDING: 'Nova solicitação', CONTACTED: 'Em atendimento', AWAITING_PAYMENT: 'Aguardando pagamento', PAYMENT_PROOF_SENT: 'Comprovante recebido', PAYMENT_ISSUE: 'Pagamento não identificado', PAID: 'Pagamento confirmado', APPROVED: 'Ativa', REJECTED: 'Recusada', CANCELLED: 'Cancelada', SUSPENDED: 'Suspensa', REVOKED: 'Revogada' } as const)[status];
function saoPauloMonthRange(monthValue: string) {
  const [year, month] = monthValue.split('-').map(Number);
  const localMidnightUtc = (targetYear: number, targetMonth: number) => {
    const target = Date.UTC(targetYear, targetMonth - 1, 1);
    let guess = target + 12 * 60 * 60 * 1000;
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    for (let attempt = 0; attempt < 3; attempt++) {
      const parts = formatter.formatToParts(new Date(guess));
      const part = (type: string) => Number(parts.find((value) => value.type === type)?.value ?? 0);
      const localWallTime = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
      guess = target - (localWallTime - guess);
    }
    return new Date(guess);
  };
  const start = localMidnightUtc(year, month);
  const end = month === 12 ? localMidnightUtc(year + 1, 1) : localMidnightUtc(year, month + 1);
  return { start, end };
}
function platformVerificationAvatarUrl(request: InstanceType<typeof VerificationRequest>, community: { slug: string } | null, profileId: mongoose.Types.ObjectId, avatarUrl: string) {
  if (!community || !avatarUrl.startsWith(`/media/${community.slug}/`)) return avatarUrl;
  return `/api/platform/vybe-plus/requests/${request._id.toString()}/avatars/${profileId.toString()}`;
}
const platformVerificationJson = (item: InstanceType<typeof VerificationRequest>, community: { name: string; slug: string } | null, character: { _id: mongoose.Types.ObjectId; username: string; displayName: string; avatarUrl: string } | null, beneficiary: { _id: mongoose.Types.ObjectId; username: string; displayName: string; avatarUrl: string } | null, handler?: { displayName: string; username: string } | null) => ({
  id: item._id.toString(), tenantId: item.tenantId.toString(), communityId: item.tenantId.toString(), conversationId: item.conversationId?.toString() ?? null,
  requestedByUserId: (item.requestedByUserId ?? item.accountId).toString(), beneficiaryProfileId: (item.beneficiaryProfileId ?? item.characterId).toString(), isGift: item.isGift ?? false, source: item.source ?? ((item.isGift ?? false) ? 'GIFT' : 'SELF_PURCHASE'),
  type: item.verificationType ?? 'PAID_PROFILE', status: item.status, statusLabel: verificationStatusLabel(item.status), paymentStatus: item.paymentStatus,
  amount: item.amount, currency: item.currency, createdAt: item.createdAt, updatedAt: item.updatedAt,
  paymentConfirmedAt: item.paymentConfirmedAt, approvedAt: item.approvedAt, rejectionReason: item.rejectionReason,
  paymentProofs: (item.paymentProofs ?? []).map(({ id, mimeType, size, uploadedAt }) => ({ id, mimeType, size, uploadedAt })),
  community: community ? { ...community, id: item.tenantId.toString() } : null,
  character: character ? { id: character._id.toString(), username: character.username, displayName: character.displayName, avatarUrl: platformVerificationAvatarUrl(item, community, character._id, character.avatarUrl) } : null,
  beneficiary: beneficiary ? { id: beneficiary._id.toString(), username: beneficiary.username, displayName: beneficiary.displayName, avatarUrl: platformVerificationAvatarUrl(item, community, beneficiary._id, beneficiary.avatarUrl) } : null,
  handledBy: item.handledBy?.toString() ?? null, handler: handler ? { displayName: handler.displayName, username: handler.username } : null,
});

function verifyQrImage(value: unknown) {
  if (value === '' || value === undefined) return '';
  if (typeof value !== 'string' || value.length > 1_500_000) throw new Error('A imagem do QR Code deve ter até 1 MB.');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('O QR Code deve ser uma imagem PNG, JPG ou WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 1024 * 1024) throw new Error('A imagem do QR Code deve ter até 1 MB.');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : match[1] === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new Error('O arquivo escolhido não corresponde a uma imagem válida.');
  return value;
}

platformRouter.get('/platform/vybe-plus/pix', requireGlobal, requirePlatformAdmin, async (_request, response) => {
  const settings = await PlatformPaymentSettings.findOne({ key: 'VYBE_PLUS_PIX' }).lean();
  response.json(settings ? { pixKey: settings.pixKey, pixKeyType: settings.pixKeyType, recipientName: settings.recipientName, qrCodeDataUrl: settings.qrCodeDataUrl ?? '' } : { pixKey: '', pixKeyType: 'RANDOM_KEY', recipientName: '', qrCodeDataUrl: '' });
});

platformRouter.put('/platform/vybe-plus/pix', requireGlobal, requirePlatformAdmin, async (request, response) => {
  const pixKey = typeof request.body?.pixKey === 'string' ? request.body.pixKey.trim() : '';
  const pixKeyType = request.body?.pixKeyType as PixKeyType;
  const recipientName = typeof request.body?.recipientName === 'string' ? request.body.recipientName.trim() : '';
  if (pixKey.length < 3 || pixKey.length > 300 || !['EMAIL', 'PHONE', 'CPF_CNPJ', 'RANDOM_KEY', 'PIX_COPY_PASTE'].includes(pixKeyType) || recipientName.length < 2 || recipientName.length > 100) { fail(response, 400, 'Informe uma chave PIX, tipo e nome do recebedor válidos.'); return; }
  let qrCodeDataUrl: string;
  try { qrCodeDataUrl = verifyQrImage(request.body?.qrCodeDataUrl); }
  catch (error) { fail(response, 400, error instanceof Error ? error.message : 'QR Code inválido.'); return; }
  const actor = globalAccount(request);
  const settings = await PlatformPaymentSettings.findOneAndUpdate({ key: 'VYBE_PLUS_PIX' }, { $set: { pixKey, pixKeyType, recipientName, qrCodeDataUrl, updatedByPlatformAdminId: actor._id } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
  response.json({ pixKey: settings.pixKey, pixKeyType: settings.pixKeyType, recipientName: settings.recipientName, qrCodeDataUrl: settings.qrCodeDataUrl ?? '' });
});

async function useOfficialSupportIdentity(item: InstanceType<typeof VerificationRequest>, community: { _id: mongoose.Types.ObjectId; name?: string; slug?: string }, conversation: InstanceType<typeof Conversation>) {
  const official = await ensurePlatformSupport(community as NonNullable<Request['vybeTenant']>);
  const previousSupportId = item.adminCharacterId;
  if (previousSupportId.equals(official._id)) return official;
  const now = new Date();
  const legacyParticipant = conversation.participants.find((participant) => participant.profileId.equals(previousSupportId));
  if (legacyParticipant) {
    legacyParticipant.profileId = official._id;
    legacyParticipant.leftAt = undefined;
    legacyParticipant.lastReadAt = now;
  }
  if (conversation.createdBy.equals(previousSupportId)) conversation.createdBy = official._id;
  conversation.directKey = conversationDirectKey(item.characterId, official._id);
  item.adminCharacterId = official._id;
  item.history ??= [];
  item.history.push({ action: 'support_identity_migrated', createdAt: now });
  await Promise.all([conversation.save(), item.save()]);
  return official;
}

async function resolveVerificationConversation(item: InstanceType<typeof VerificationRequest>, community: { _id: mongoose.Types.ObjectId; name?: string; slug?: string }) {
  let conversation = item.conversationId
    ? await Conversation.findOne({ _id: item.conversationId, tenantId: item.tenantId, kind: 'direct' })
    : null;
  const support = await ensurePlatformSupport(community as NonNullable<Request['vybeTenant']>);
  const supportIds = [...new Map([item.adminCharacterId, support._id].map((id) => [id.toString(), id])).values()];
  const isRequestConversation = (candidate: InstanceType<typeof Conversation>) => candidate.participants.some((participant) => participant.profileId.equals(item.characterId))
    && candidate.participants.some((participant) => supportIds.some((id) => participant.profileId.equals(id)));
  if (!conversation || !isRequestConversation(conversation)) {
    conversation = null;
    for (const supportId of supportIds) {
      conversation = await Conversation.findOne({
        tenantId: item.tenantId,
        kind: 'direct',
        'participants.profileId': { $all: [item.characterId, supportId] },
      }).sort({ lastMessageAt: -1 });
      if (conversation) break;
    }
  }
  if (!conversation) return null;
  const official = await useOfficialSupportIdentity(item, community, conversation);
  if (!conversation.participants.some((participant) => participant.profileId.equals(official._id))) return null;
  if (item.conversationId?.toString() !== conversation._id.toString()) {
    item.conversationId = conversation._id;
    item.history ??= [];
    item.history.push({ action: 'support_conversation_linked', createdAt: new Date() });
    await item.save();
  }
  return conversation;
}

platformRouter.get('/platform/vybe-plus/cash-flow', requireGlobal, requirePlatformAdmin, async (request, response) => {
  const month = typeof request.query.month === 'string' ? request.query.month : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { fail(response, 400, 'Informe um mês válido no formato AAAA-MM.'); return; }
  const { start, end } = saoPauloMonthRange(month);
  const payments = await VerificationRequest.find({ paymentStatus: 'confirmed', paymentConfirmedAt: { $gte: start, $lt: end }, amount: { $gt: 0 } }).sort({ paymentConfirmedAt: -1 }).lean();
  const communityIds = [...new Set(payments.map((item) => item.tenantId.toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const profileIds = [...new Set(payments.flatMap((item) => [(item.beneficiaryProfileId ?? item.characterId).toString(), item.characterId.toString()]))].map((id) => new mongoose.Types.ObjectId(id));
  const [communities, profiles] = await Promise.all([
    communityIds.length ? Community.find({ _id: { $in: communityIds } }).select('_id name').lean() : Promise.resolve([]),
    profileIds.length ? Character.find({ _id: { $in: profileIds } }).select('_id tenantId displayName username').lean() : Promise.resolve([]),
  ]);
  const communityById = new Map(communities.map((item) => [String(item._id), item.name]));
  const profileByKey = new Map(profiles.map((item) => [`${item.tenantId}:${item._id}`, item]));
  const rows = payments.map((item) => {
    const buyer = profileByKey.get(`${item.tenantId}:${item.characterId}`);
    const beneficiary = profileByKey.get(`${item.tenantId}:${item.beneficiaryProfileId ?? item.characterId}`);
    return { id: item._id.toString(), community: communityById.get(item.tenantId.toString()) ?? 'Comunidade removida', buyer: buyer ? { displayName: buyer.displayName, username: buyer.username } : null, beneficiary: beneficiary ? { displayName: beneficiary.displayName, username: beneficiary.username } : null, isGift: item.isGift ?? false, amount: item.amount, currency: item.currency, paymentConfirmedAt: item.paymentConfirmedAt };
  });
  const totalAmount = Math.round(payments.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  response.json({ month, count: payments.length, totalAmount, currency: 'BRL', payments: rows });
});

platformRouter.get('/platform/vybe-plus/requests', requireGlobal, requirePlatformAdmin, async (request, response) => {
  const status = typeof request.query.status === 'string' ? request.query.status : '';
  const communityId = typeof request.query.communityId === 'string' ? request.query.communityId : '';
  const search = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 100) : '';
  if (status && status !== 'ALL' && !verificationStatuses.includes(status as VerificationStatus)) { fail(response, 400, 'Filtro de status inválido.'); return; }
  if (communityId && !mongoose.isValidObjectId(communityId)) { fail(response, 400, 'Comunidade inválida.'); return; }
  const requests = await VerificationRequest.find({ ...(status && status !== 'ALL' ? { status } : {}), ...(communityId ? { tenantId: new mongoose.Types.ObjectId(communityId) } : {}) }).sort({ createdAt: -1 }).limit(1000).lean();
  const [communities, characters, admins] = await Promise.all([
    Community.find({}).select('_id name slug').sort({ name: 1 }).lean(),
    requests.length ? Character.find({ $or: requests.flatMap((item) => [{ tenantId: item.tenantId, _id: item.characterId }, { tenantId: item.tenantId, _id: item.beneficiaryProfileId ?? item.characterId }]) }).select('_id tenantId username displayName avatarUrl').lean() : Promise.resolve([]),
    VybeAccount.find({ _id: { $in: [...new Set(requests.map((item) => item.handledBy?.toString()).filter(Boolean))].map((id) => new mongoose.Types.ObjectId(id!)) } }).select('_id displayName username').lean(),
  ]);
  const communityById = new Map(communities.map((item) => [String(item._id), item]));
  const characterByKey = new Map(characters.map((item) => [`${item.tenantId}:${item._id}`, item]));
  const adminById = new Map(admins.map((item) => [String(item._id), item]));
  const rows = requests.map((item) => platformVerificationJson(item as InstanceType<typeof VerificationRequest>, (communityById.get(item.tenantId.toString()) as { name: string; slug: string } | undefined) ?? null, characterByKey.get(`${item.tenantId}:${item.characterId}`) ?? null, characterByKey.get(`${item.tenantId}:${item.beneficiaryProfileId ?? item.characterId}`) ?? null, item.handledBy ? adminById.get(item.handledBy.toString()) as { displayName: string; username: string } | undefined ?? null : null));
  const filtered = search ? rows.filter((item) => `${item.id} ${item.character?.displayName ?? ''} ${item.character?.username ?? ''} ${item.beneficiary?.displayName ?? ''} ${item.beneficiary?.username ?? ''} ${item.community?.name ?? ''} ${item.communityId}`.toLowerCase().includes(search.toLowerCase())) : rows;
  const priority: Record<VerificationStatus, number> = { PENDING: 0, CONTACTED: 1, AWAITING_PAYMENT: 2, PAYMENT_PROOF_SENT: 3, PAYMENT_ISSUE: 4, PAID: 5, APPROVED: 6, SUSPENDED: 7, REJECTED: 8, REVOKED: 9, CANCELLED: 10 };
  filtered.sort((left, right) => priority[left.status] - priority[right.status] || new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const allRequests = await VerificationRequest.find({}).select('tenantId status createdAt approvedAt').lean();
  const now = new Date();
  const localParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (type: string) => Number(localParts.find((value) => value.type === type)?.value ?? 0);
  const localNowAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  const saoPauloOffset = localNowAsUtc - now.getTime();
  const today = new Date(Date.UTC(part('year'), part('month') - 1, part('day')) - saoPauloOffset);
  const scopedTodayRequests = allRequests.filter((item) => (!status || status === 'ALL' || item.status === status) && (!communityId || item.tenantId.toString() === communityId));
  response.json({ requests: filtered, communities: communities.map((item) => ({ id: String(item._id), name: item.name, slug: item.slug })), stats: {
    newToday: scopedTodayRequests.filter((item) => status === 'APPROVED' ? Boolean(item.approvedAt && item.approvedAt >= today) : item.createdAt >= today).length,
    awaitingSupport: allRequests.filter((item) => ['PENDING', 'CONTACTED'].includes(item.status)).length,
    awaitingPayment: allRequests.filter((item) => ['AWAITING_PAYMENT', 'PAYMENT_PROOF_SENT', 'PAYMENT_ISSUE'].includes(item.status)).length,
    proofsToReview: allRequests.filter((item) => item.status === 'PAYMENT_PROOF_SENT').length,
    active: allRequests.filter((item) => item.status === 'APPROVED').length,
    newRequests: allRequests.filter((item) => ['PENDING', 'AWAITING_PAYMENT'].includes(item.status)).length,
  } });
});

platformRouter.get('/platform/vybe-plus/requests/:requestId', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 400, 'Solicitação inválida.'); return; }
  const item = await VerificationRequest.findById(request.params.requestId);
  if (!item) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const [communityResult, character, beneficiary, handlerResult, linkedConversation] = await Promise.all([
    Community.findById(item.tenantId).select('_id name slug').lean(),
    Character.findOne({ _id: item.characterId, tenantId: item.tenantId }).select('_id username displayName avatarUrl accountId').lean(),
    Character.findOne({ _id: item.beneficiaryProfileId ?? item.characterId, tenantId: item.tenantId }).select('_id username displayName avatarUrl accountId').lean(),
    item.handledBy ? VybeAccount.findById(item.handledBy).select('displayName username').lean() : Promise.resolve(null),
    item.conversationId ? Conversation.findOne({ _id: item.conversationId, tenantId: item.tenantId }) : Promise.resolve(null),
  ]);
  const community = Array.isArray(communityResult) ? communityResult[0] : communityResult;
  const handler = Array.isArray(handlerResult) ? handlerResult[0] : handlerResult;
  let conversation = linkedConversation;
  if (community) conversation = await resolveVerificationConversation(item, community as { _id: mongoose.Types.ObjectId; name?: string; slug?: string });
  let messages: Array<Record<string, unknown>> = [];
  if (conversation) {
    const now = new Date();
    if (request.query.read === '1') await Promise.all([
      ConversationMessage.updateMany({ tenantId: item.tenantId, conversationId: conversation._id, senderProfileId: item.characterId, readAt: { $exists: false }, deletedAt: { $exists: false } }, { $set: { readAt: now } }),
      (async () => { const participant = conversation.participants.find((entry) => entry.profileId.equals(item.adminCharacterId)); if (participant) { participant.lastReadAt = now; await conversation.save(); } })(),
    ]);
    const rows = await ConversationMessage.find({ tenantId: item.tenantId, conversationId: conversation._id, deletedAt: { $exists: false } }).sort({ createdAt: 1 }).limit(500).lean();
    const senderIds = [...new Set(rows.map((message) => message.senderProfileId.toString()))].map((id) => new mongoose.Types.ObjectId(id));
    const senders = await Character.find({ tenantId: item.tenantId, _id: { $in: senderIds } }).select('_id displayName username avatarUrl platformIdentity').lean();
    const senderById = new Map(senders.map((sender) => [String(sender._id), sender]));
    messages = rows.map((message) => ({ id: String(message._id), content: message.content, messageType: message.messageType, attachment: message.attachment, createdAt: message.createdAt, readAt: message.readAt, sender: senderById.get(message.senderProfileId.toString()) ? { id: message.senderProfileId.toString(), ...senderById.get(message.senderProfileId.toString()) } : null, isSupport: message.senderProfileId.equals(item.adminCharacterId) }));
  }
  const platformAccountIds = [...new Set([...(item.history ?? []).map((entry) => entry.actorPlatformAccountId?.toString()), ...(item.internalNotes ?? []).map((entry) => entry.authorPlatformAccountId.toString())].filter(Boolean))].map((id) => new mongoose.Types.ObjectId(id!));
  const auditAccounts = platformAccountIds.length ? await VybeAccount.find({ _id: { $in: platformAccountIds } }).select('_id displayName username').lean() : [];
  const auditById = new Map(auditAccounts.map((account) => [String(account._id), account]));
  response.json({ request: { ...platformVerificationJson(item, community ? { name: community.name, slug: community.slug } : null, character, beneficiary, handler as { displayName: string; username: string } | null), accountId: item.accountId.toString(), profileId: (item.beneficiaryProfileId ?? item.characterId).toString(), profile: beneficiary ? { id: String(beneficiary._id), username: beneficiary.username, displayName: beneficiary.displayName } : null, buyerProfileId: item.characterId.toString(), buyer: character ? { id: String(character._id), username: character.username, displayName: character.displayName } : null, adminCharacterId: item.adminCharacterId.toString(), history: (item.history ?? []).map((entry) => ({ action: entry.action, reason: entry.reason ?? '', createdAt: entry.createdAt, actor: entry.actorPlatformAccountId ? auditById.get(entry.actorPlatformAccountId.toString()) ?? null : null })), internalNotes: (item.internalNotes ?? []).map((note) => ({ content: note.content, createdAt: note.createdAt, author: auditById.get(note.authorPlatformAccountId.toString()) ?? null })), conversationId: item.conversationId?.toString() ?? null }, messages });
});

platformRouter.get('/platform/vybe-plus/requests/:requestId/proofs/:proofId', requireGlobal, requirePlatformAdmin, async (request, response) => {
  const requestId = String(request.params.requestId);
  const proofId = String(request.params.proofId);
  if (!mongoose.isValidObjectId(requestId) || !/^[a-f0-9]{32}$/.test(proofId)) { response.status(404).end(); return; }
  const item = await VerificationRequest.findById(requestId).select('paymentProofs').lean();
  const proof = item?.paymentProofs?.find((entry) => entry.id === proofId);
  if (!proof) { response.status(404).end(); return; }
  const bytes = await readPaymentProof(proof.filename);
  response.setHeader('Content-Type', proof.mimeType);
  response.setHeader('Content-Disposition', `inline; filename="comprovante.${proof.filename.split('.').pop()}"`);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  response.send(bytes);
});

platformRouter.get('/platform/vybe-plus/requests/:requestId/avatars/:profileId', requireGlobal, requirePlatformAdmin, async (request, response) => {
  const requestId = String(request.params.requestId);
  const profileId = String(request.params.profileId);
  if (!mongoose.isValidObjectId(requestId) || !mongoose.isValidObjectId(profileId)) { response.status(404).end(); return; }
  const item = await VerificationRequest.findById(requestId).select('tenantId characterId beneficiaryProfileId').lean();
  if (!item || ![item.characterId.toString(), (item.beneficiaryProfileId ?? item.characterId).toString()].includes(profileId)) { response.status(404).end(); return; }
  const [communityResult, profile] = await Promise.all([
    Community.findById(item.tenantId).select('slug').lean(),
    Character.findOne({ _id: profileId, tenantId: item.tenantId }).select('avatarUrl').lean(),
  ]);
  const community = Array.isArray(communityResult) ? communityResult[0] : communityResult;
  if (!community || !profile) { response.status(404).end(); return; }
  const prefix = `/media/${community.slug}/`;
  if (!profile.avatarUrl.startsWith(prefix)) { response.status(404).end(); return; }
  const filename = profile.avatarUrl.slice(prefix.length);
  if (!/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(filename)) { response.status(404).end(); return; }
  response.sendFile(filename, { root: resolve(uploadsDirectory, community.slug) }, (error) => { if (error && !response.headersSent) response.status(404).end(); });
});

platformRouter.post('/platform/vybe-plus/requests/:requestId/assign', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 400, 'Solicitação inválida.'); return; }
  const item = await VerificationRequest.findById(request.params.requestId);
  if (!item) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const actor = globalAccount(request); const now = new Date();
  item.handledBy = actor._id; item.handledAt = now;
  item.history ??= []; item.history.push({ action: 'assigned', actorPlatformAccountId: actor._id, createdAt: now });
  if (item.status === 'PENDING') item.status = 'CONTACTED';
  await item.save();
  response.json({ assigned: true, status: item.status, handler: { displayName: actor.displayName, username: actor.username } });
});

platformRouter.post('/platform/vybe-plus/requests/:requestId/notes', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 400, 'Solicitação inválida.'); return; }
  const content = typeof request.body?.content === 'string' ? request.body.content.trim() : '';
  if (content.length < 2 || content.length > 2000) { fail(response, 400, 'A nota deve ter entre 2 e 2000 caracteres.'); return; }
  const item = await VerificationRequest.findById(request.params.requestId);
  if (!item) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const actor = globalAccount(request); const now = new Date();
  item.internalNotes ??= []; item.internalNotes.push({ authorPlatformAccountId: actor._id, content, createdAt: now });
  item.history ??= []; item.history.push({ action: 'internal_note_added', actorPlatformAccountId: actor._id, createdAt: now });
  await item.save(); response.status(201).json({ saved: true, createdAt: now });
});

platformRouter.post('/platform/vybe-plus/requests/:requestId/messages', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 400, 'Solicitação inválida.'); return; }
  const content = typeof request.body?.content === 'string' ? request.body.content.trim() : '';
  if (!content || content.length > 4000) { fail(response, 400, 'A mensagem deve ter entre 1 e 4000 caracteres.'); return; }
  const item = await VerificationRequest.findById(request.params.requestId);
  if (!item) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const community = await Community.findById(item.tenantId).select('_id name slug').lean();
  const conversation = community ? await resolveVerificationConversation(item, community as { _id: mongoose.Types.ObjectId; name?: string; slug?: string }) : null;
  const support = conversation && community ? await useOfficialSupportIdentity(item, community as { _id: mongoose.Types.ObjectId; name?: string; slug?: string }, conversation) : null;
  if (!conversation || !support || !conversation.participants.some((participant) => participant.profileId.equals(support._id))) { fail(response, 409, 'A conversa não está vinculada à conta oficial VYBE Suporte.'); return; }
  const message = await ConversationMessage.create({ tenantId: item.tenantId, conversationId: conversation._id, senderProfileId: support._id, content, messageType: 'text' });
  conversation.lastMessageAt = message.createdAt; const supportParticipant = conversation.participants.find((participant) => participant.profileId.equals(support._id)); if (supportParticipant) { supportParticipant.typingAt = undefined; supportParticipant.lastReadAt = message.createdAt; } await conversation.save();
  await Notification.create({ tenantId: item.tenantId, characterId: item.characterId, actorId: support._id, type: 'message', targetId: message._id });
  emitToProfiles(item.tenantId.toString(), conversation.participants.filter((participant) => !participant.leftAt).map((participant) => participant.profileId), { type: 'message:new', conversationId: conversation._id.toString(), messageId: message._id.toString() });
  if (item.status === 'PENDING') { item.status = 'CONTACTED'; item.handledBy = globalAccount(request)._id; item.handledAt = new Date(); item.history ??= []; item.history.push({ action: 'contact_started', actorPlatformAccountId: globalAccount(request)._id, createdAt: new Date() }); await item.save(); }
  response.status(201).json({ id: message._id.toString(), content: message.content, messageType: message.messageType, createdAt: message.createdAt, sender: { id: support._id.toString(), displayName: support.displayName, username: support.username, avatarUrl: support.avatarUrl, platformIdentity: support.platformIdentity }, isSupport: true });
});

platformRouter.post('/platform/vybe-plus/requests/:requestId/confirm-payment', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 400, 'Solicitação inválida.'); return; }
  const actor = globalAccount(request);
  const session = await mongoose.startSession();
  const resultHolder: { current: { request: InstanceType<typeof VerificationRequest>; beneficiaryProfileId: mongoose.Types.ObjectId; buyerProfileId: mongoose.Types.ObjectId; idempotent: boolean } | null } = { current: null };
  try {
    await session.withTransaction(async () => {
      const item = await VerificationRequest.findById(request.params.requestId).session(session);
      if (!item) throw Object.assign(new Error('Solicitação não encontrada.'), { statusCode: 404 });
      const beneficiaryProfileId = item.beneficiaryProfileId ?? item.characterId;
      const target = await Character.findOne({ _id: beneficiaryProfileId, tenantId: item.tenantId }).session(session);
      if (!target) throw Object.assign(new Error('Perfil beneficiário não encontrado nesta comunidade.'), { statusCode: 404 });
      if (item.status === 'APPROVED' && item.paymentStatus === 'confirmed' && isVerificationActive(target.verification) && target.verification?.requestId?.equals(item._id)) {
        resultHolder.current = { request: item, beneficiaryProfileId, buyerProfileId: item.characterId, idempotent: true };
        return;
      }
      if (!['AWAITING_PAYMENT', 'PAYMENT_PROOF_SENT'].includes(item.status)) throw Object.assign(new Error('Aceite somente solicitações aguardando comprovante ou análise do pagamento.'), { statusCode: 409 });
      if (item.status === 'AWAITING_PAYMENT') {
        const conversationProof = item.conversationId ? await ConversationMessage.exists({ tenantId: item.tenantId, conversationId: item.conversationId, senderProfileId: item.characterId, messageType: { $in: ['image', 'file'] }, 'attachment.url': { $exists: true, $ne: '' }, deletedAt: { $exists: false } }).session(session) : null;
        if (!conversationProof) throw Object.assign(new Error('Nenhum comprovante anexado à conversa foi encontrado. Peça ao solicitante que envie o comprovante antes de aceitar.'), { statusCode: 409 });
      }
      if (isVerificationActive(target.verification)) throw Object.assign(new Error('Este perfil já possui VYBE Verificado ativo nesta comunidade.'), { statusCode: 409 });
      const now = new Date();
      item.paymentStatus = 'confirmed'; item.paymentConfirmedAt = now; item.paymentConfirmedByPlatformId = actor._id;
      item.status = 'APPROVED'; item.active = false; item.approvedAt = now; item.approvedByPlatformId = actor._id;
      item.history ??= [];
      item.history.push({ action: 'payment_confirmed', actorPlatformAccountId: actor._id, createdAt: now });
      item.history.push({ action: 'verification_activated', actorPlatformAccountId: actor._id, createdAt: now });
      target.verification = { ...target.verification, status: 'ACTIVE', type: 'PAID_PROFILE', source: item.source ?? ((item.isGift ?? false) ? 'GIFT' : 'SELF_PURCHASE'), requestId: item._id, verifiedAt: target.verification?.verifiedAt ?? now, activatedAt: now, expiresAt: null, removedAt: undefined, removedBy: undefined, removalReason: undefined };
      await Promise.all([item.save({ session }), target.save({ session })]);
      const notifications = (item.isGift ?? false)
        ? [
            { tenantId: item.tenantId, characterId: beneficiaryProfileId, actorId: item.adminCharacterId, targetId: item._id, type: 'verification_gift_received' as const },
            { tenantId: item.tenantId, characterId: item.characterId, actorId: beneficiaryProfileId, targetId: item._id, type: 'verification_gift_activated' as const },
          ]
        : [{ tenantId: item.tenantId, characterId: beneficiaryProfileId, actorId: item.adminCharacterId, targetId: item._id, type: 'verification_approved' as const }];
      await Promise.all(notifications.map((notification) => new Notification(notification).save({ session })));
      await CommunityAudit.create([{ tenantId: item.tenantId, actorId: actor._id, action: 'verification_payment_confirmed_and_activated', details: { requestId: item._id.toString(), beneficiaryProfileId: beneficiaryProfileId.toString(), isGift: item.isGift ?? false, platformAdminId: actor._id.toString() } }], { session });
      resultHolder.current = { request: item, beneficiaryProfileId, buyerProfileId: item.characterId, idempotent: false };
    });
  } catch (error) {
    const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number((error as { statusCode: unknown }).statusCode) : 500;
    fail(response, statusCode, error instanceof Error ? error.message : 'Não foi possível confirmar o pagamento e ativar o benefício.');
    return;
  } finally { await session.endSession(); }
  const result = resultHolder.current;
  if (!result) { fail(response, 500, 'Não foi possível concluir a ativação.'); return; }
  if (!result.idempotent) emitToProfiles(result.request.tenantId.toString(), [...new Set([result.buyerProfileId.toString(), result.beneficiaryProfileId.toString()])], { type: 'notification:new', targetId: result.request._id.toString() });
  const communityResult = await Community.findById(result.request.tenantId).select('_id name slug').lean();
  const community = Array.isArray(communityResult) ? communityResult[0] : communityResult;
  const [buyerProfile, beneficiaryProfile] = await Promise.all([
    Character.findOne({ _id: result.buyerProfileId, tenantId: result.request.tenantId }).select('_id username displayName avatarUrl').lean(),
    Character.findOne({ _id: result.beneficiaryProfileId, tenantId: result.request.tenantId }).select('_id username displayName avatarUrl').lean(),
  ]);
  response.json({ activated: true, idempotent: result.idempotent, request: platformVerificationJson(result.request, community ? { name: community.name, slug: community.slug } : null, buyerProfile, beneficiaryProfile, { displayName: actor.displayName, username: actor.username }) });
});

platformRouter.patch('/platform/vybe-plus/requests/:requestId', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 400, 'Solicitação inválida.'); return; }
  const status = request.body?.status as VerificationStatus;
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
  if (!verificationStatuses.includes(status)) { fail(response, 400, 'Status inválido.'); return; }
  if (['REJECTED', 'SUSPENDED', 'REVOKED'].includes(status) && (reason.length < 5 || reason.length > 500)) { fail(response, 400, 'Informe um motivo entre 5 e 500 caracteres.'); return; }
  const item = await VerificationRequest.findById(request.params.requestId);
  if (!item) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  if (!canTransitionVerification(item.status, status)) { fail(response, 409, `A solicitação não pode passar de ${verificationStatusLabel(item.status)} para ${verificationStatusLabel(status)}.`); return; }
  if (status === 'APPROVED' && item.paymentStatus !== 'confirmed') { fail(response, 409, 'Confirme o pagamento antes de ativar o VYBE Verificado.'); return; }
  const beneficiaryProfileId = item.beneficiaryProfileId ?? item.characterId;
  const target = await Character.findOne({ _id: beneficiaryProfileId, tenantId: item.tenantId });
  if (!target) { fail(response, 404, 'Perfil beneficiário da solicitação não encontrado nesta comunidade.'); return; }
  if (status === 'APPROVED' && isVerificationActive(target.verification)) { fail(response, 409, 'Este perfil já possui VYBE Verificado ativo.'); return; }
  const actor = globalAccount(request); const now = new Date();
  item.status = status;
  if (['APPROVED', 'REJECTED', 'CANCELLED', 'SUSPENDED', 'REVOKED'].includes(status)) item.active = false;
  if (status === 'PAID') { item.paymentStatus = 'confirmed'; item.paymentConfirmedAt = now; item.paymentConfirmedByPlatformId = actor._id; }
  if (status === 'APPROVED') { item.approvedAt = now; item.approvedByPlatformId = actor._id; }
  if (status === 'REJECTED') { item.rejectedAt = now; item.rejectedBy = actor._id; item.rejectionReason = reason; }
  if (status === 'SUSPENDED' || status === 'REVOKED') { item.removedAt = now; item.removedByPlatformId = actor._id; item.removalReason = reason; }
  item.history ??= []; item.history.push({ action: `status_${status.toLowerCase()}`, actorPlatformAccountId: actor._id, reason: reason || undefined, createdAt: now });
  if (status === 'APPROVED') {
    target.verification = { ...target.verification, status: 'ACTIVE', type: 'PAID_PROFILE', source: item.source ?? ((item.isGift ?? false) ? 'GIFT' : 'SELF_PURCHASE'), requestId: item._id, verifiedAt: target.verification?.verifiedAt ?? now, activatedAt: now, expiresAt: null, removedAt: undefined, removedBy: undefined, removalReason: undefined };
  } else if (status === 'SUSPENDED') {
    target.verification = { ...target.verification, status: 'SUSPENDED', type: 'PAID_PROFILE', requestId: item._id, removedAt: now, removalReason: reason };
  } else if (status === 'REVOKED') {
    target.verification = { ...target.verification, status: 'REVOKED', type: 'PAID_PROFILE', requestId: item._id, removedAt: now, removalReason: reason };
  }
  await Promise.all([item.save(), target.save()]);
  const notificationType = status === 'PAID' ? 'verification_payment_confirmed' : status === 'PAYMENT_ISSUE' ? 'verification_payment_issue' : status === 'APPROVED' ? 'verification_approved' : status === 'REJECTED' ? 'verification_rejected' : status === 'SUSPENDED' ? 'verification_suspended' : status === 'REVOKED' ? 'verification_removed' : null;
  if (notificationType) {
    if (status === 'APPROVED' && (item.isGift ?? false)) {
      await Promise.all([
        Notification.create({ tenantId: item.tenantId, characterId: beneficiaryProfileId, actorId: item.adminCharacterId, targetId: item._id, type: 'verification_gift_received' }),
        Notification.create({ tenantId: item.tenantId, characterId: item.characterId, actorId: beneficiaryProfileId, targetId: item._id, type: 'verification_gift_activated' }),
      ]);
    } else {
      await Notification.create({ tenantId: item.tenantId, characterId: status === 'PAID' || status === 'PAYMENT_ISSUE' || status === 'REJECTED' ? item.characterId : beneficiaryProfileId, actorId: item.adminCharacterId, targetId: item._id, type: notificationType });
    }
  }
  const communityResult = await Community.findById(item.tenantId).select('_id name slug').lean();
  const community = Array.isArray(communityResult) ? communityResult[0] : communityResult;
  const [buyerProfile, beneficiaryProfile] = await Promise.all([
    Character.findOne({ _id: item.characterId, tenantId: item.tenantId }).select('_id username displayName avatarUrl').lean(),
    Character.findOne({ _id: beneficiaryProfileId, tenantId: item.tenantId }).select('_id username displayName avatarUrl').lean(),
  ]);
  response.json({ request: platformVerificationJson(item, community ? { name: community.name, slug: community.slug } : null, buyerProfile, beneficiaryProfile, { displayName: actor.displayName, username: actor.username }) });
});

platformRouter.get('/account/profile', requireGlobal, (request, response) => {
  const account = globalAccount(request);
  response.json({
    displayName: account.displayName,
    username: account.username,
    avatarUrl: account.avatarUrl,
    birthDate: account.birthDate ? account.birthDate.toISOString().slice(0, 10) : '',
  });
});

platformRouter.get('/account/audio-preferences', requireGlobal, (request, response) => {
  const value = globalAccount(request).audioPreferences;
  response.json({ enabled: value?.enabled ?? true, messageSoundEnabled: value?.messageSoundEnabled ?? true, notificationSoundEnabled: value?.notificationSoundEnabled ?? true, matchSoundEnabled: value?.matchSoundEnabled ?? true, actionSoundEnabled: value?.actionSoundEnabled ?? true, vybePlusSoundEnabled: value?.vybePlusSoundEnabled ?? true, volume: value?.volume ?? 0.5 });
});

platformRouter.patch('/account/audio-preferences', requireGlobal, async (request, response) => {
  const account = globalAccount(request);
  const allowed = ['enabled', 'messageSoundEnabled', 'notificationSoundEnabled', 'matchSoundEnabled', 'actionSoundEnabled', 'vybePlusSoundEnabled'] as const;
  for (const key of allowed) if (Object.hasOwn(request.body ?? {}, key) && typeof request.body[key] !== 'boolean') { fail(response, 400, 'As opções de som devem ser ativadas ou desativadas.'); return; }
  if (Object.hasOwn(request.body ?? {}, 'volume') && (typeof request.body.volume !== 'number' || !Number.isFinite(request.body.volume) || request.body.volume < 0 || request.body.volume > 1)) { fail(response, 400, 'O volume deve ficar entre 0 e 1.'); return; }
  const current: { enabled?: boolean; messageSoundEnabled?: boolean; notificationSoundEnabled?: boolean; matchSoundEnabled?: boolean; actionSoundEnabled?: boolean; vybePlusSoundEnabled?: boolean; volume?: number } = account.audioPreferences ?? {};
  account.audioPreferences = { enabled: current.enabled ?? true, messageSoundEnabled: current.messageSoundEnabled ?? true, notificationSoundEnabled: current.notificationSoundEnabled ?? true, matchSoundEnabled: current.matchSoundEnabled ?? true, actionSoundEnabled: current.actionSoundEnabled ?? true, vybePlusSoundEnabled: current.vybePlusSoundEnabled ?? true, volume: current.volume ?? 0.5, ...(request.body ?? {}) };
  await account.save();
  response.json(account.audioPreferences);
});

platformRouter.patch('/account/profile', requireGlobal, async (request, response) => {
  const account = globalAccount(request);
  const { displayName, username, birthDate, avatarUrl } = request.body ?? {};
  if (typeof displayName !== 'string' || displayName.trim().length < 2 || displayName.trim().length > 60) { fail(response, 400, 'Informe um nome completo entre 2 e 60 caracteres.'); return; }
  const normalizedUsername = typeof username === 'string' ? usernameFrom(username.replace(/^@/, '').trim()) : '';
  if (!/^[a-z0-9._]{3,24}$/.test(normalizedUsername)) { fail(response, 400, 'O @username deve ter de 3 a 24 caracteres: letras, números, ponto ou underline.'); return; }
  const parsedBirthDate = parseProfileBirthDate(birthDate);
  if (parsedBirthDate === null) { fail(response, 400, 'Informe uma data de nascimento válida.'); return; }
  const safeAvatar = validateAccountAvatar(avatarUrl);
  if (safeAvatar === null || safeAvatar === undefined) { fail(response, 400, 'A foto deve ser JPG, PNG ou WEBP e ter até 2 MB.'); return; }
  account.displayName = displayName.trim();
  account.username = normalizedUsername;
  account.birthDate = parsedBirthDate;
  account.avatarUrl = safeAvatar;
  try {
    await account.save();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { fail(response, 409, 'Este @username já está em uso.'); return; }
    throw error;
  }
  response.json({ displayName: account.displayName, username: account.username, avatarUrl: account.avatarUrl, birthDate: account.birthDate ? account.birthDate.toISOString().slice(0, 10) : '' });
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
  response.json({ currentTenantSlug: request.vybeTenant?.slug ?? '', communities: communities.map((item) => ({ id: String(item._id), name: item.name, slug: item.slug, subdomain: item.subdomain, description: item.description, coverUrl: item.coverUrl ? `/api/communities/${item.slug}/cover` : '', logoUrl: item.logoUrl?.startsWith(`/media/${item.slug}/`) ? `/api/communities/${item.slug}/logo` : item.logoUrl, category: item.category, memberCount: item.memberCount, requiresApproval: requiresJoinApproval(item), joinStatus: memberships.some((member) => String(member.tenantId) === String(item._id)) ? 'MEMBER' : requests.find((joinRequest) => String(joinRequest.communityId) === String(item._id))?.status ?? 'NONE' })) });
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

platformRouter.get('/communities/:slug/logo', async (request, response) => {
  const community: any = await Community.findOne({ slug: request.params.slug, status: 'active', type: 'public' }).select('slug logoUrl').lean();
  const asset = community?.logoUrl.match(/^\/media\/([a-z0-9-]+)\/([a-f0-9]{32}\.(?:png|jpg|webp))$/);
  if (!community || !asset || asset[1] !== community.slug) { response.status(404).end(); return; }
  response.sendFile(asset[2], { root: resolve(uploadsDirectory, community.slug) }, (error) => { if (error && !response.headersSent) response.status(404).end(); });
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
  response.json({ community: { id: String(community._id), name: community.name, slug: community.slug, subdomain: community.subdomain, logoUrl: community.logoUrl?.startsWith(`/media/${community.slug}/`) ? `/api/communities/${community.slug}/logo` : community.logoUrl, coverUrl: community.coverUrl?.startsWith(`/media/${community.slug}/`) ? `/api/communities/${community.slug}/cover` : community.coverUrl }, account: { displayName: account.displayName, username: account.username, avatarUrl: account.avatarUrl }, minimumAge: community.settings?.characters?.minimumAge ?? 18, usernameMinLength: community.settings?.characters?.usernameMinLength ?? 3, usernameMaxLength: community.settings?.characters?.usernameMaxLength ?? 24, customQuestions: community.settings?.characters?.customFields ?? [], requiresApproval: requiresJoinApproval(community), membershipStatus: member ? 'MEMBER' : 'NONE', request: joinRequest ? requestJson(joinRequest, requestPhoto) : null });
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
  response.json(rows.map((row) => ({ id: String(row._id), type: row.type, status: row.status, message: row.message, createdAt: row.createdAt, verificationRequestId: row.verificationRequestId?.toString() ?? null, communityName: communityMap.get(String(row.communityId))?.name ?? 'Comunidade', communitySlug: communityMap.get(String(row.communityId))?.slug ?? '' })));
});

platformRouter.get('/community-join-requests/:id/photo', requireGlobal, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.id)) { response.status(404).end(); return; }
  const row: any = await CommunityJoinRequest.findOne({ _id: request.params.id, vybeAccountId: globalAccount(request)._id }).select('communitySlug photoplayerImageFilename').lean();
  if (!row || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(row.photoplayerImageFilename)) { response.status(404).end(); return; }
  response.sendFile(row.photoplayerImageFilename, { root: resolve(uploadsDirectory, row.communitySlug) }, (error) => { if (error && !response.headersSent) response.status(404).end(); });
});
