import { Router, type Request, type Response } from 'express';
import { randomBytes, scryptSync } from 'node:crypto';
import mongoose from 'mongoose';
import { VERIFICATION_PRICE_BRL } from '@vybe/shared';
import { Community } from '../models/Community.js';
import { VybeAccount } from '../models/VybeAccount.js';
import { VybeNotification } from '../models/VybeNotification.js';
import { CommunityAudit } from '../models/CommunityAudit.js';
import { Account, Character, Notification } from '../models/Social.js';
import { canTransitionVerification, VerificationRequest, verificationStatuses, type VerificationStatus } from '../models/VerificationRequest.js';
import { requireSession, tenantScope } from '../middleware/tenant.js';
import { Conversation, ConversationBlock, ConversationMessage } from '../models/Conversation.js';
import { conversationDirectKey, canSendDirect } from './conversationPolicy.js';
import { MatchBlock } from '../models/Match.js';
import { emitToProfiles } from '../realtime/chatWebSocket.js';
import { isVerificationActive } from '../services/verifiedSocialBenefits.js';
import { PlatformPaymentSettings } from '../models/PlatformPaymentSettings.js';
import { parsePaymentProof, readPaymentProof, savePaymentProof } from '../services/privatePaymentProofs.js';
import { isMongoDuplicateKey } from '../services/migrateVerificationBeneficiaries.js';

export const verificationRouter = Router();
verificationRouter.use(requireSession);

function tenantId(request: Request) { return request.vybeTenant!._id; }
function platformSlug() { return process.env.VYBE_PLATFORM_TENANT_SLUG ?? 'community'; }
function platformAdminEmails() { return (process.env.VYBE_PLATFORM_ADMIN_EMAILS ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean); }
function isCentralAdmin(request: Request) {
  return request.vybeTenant!.slug === platformSlug() && platformAdminEmails().includes(request.vybeAccount!.email.toLowerCase());
}
function verificationJson(request: typeof VerificationRequest.prototype) {
  return { id: request._id.toString(), type: request.verificationType ?? 'PAID_PROFILE', status: request.status, paymentStatus: request.paymentStatus, amount: request.amount, currency: request.currency, createdAt: request.createdAt, paymentConfirmedAt: request.paymentConfirmedAt, approvedAt: request.approvedAt, rejectionReason: request.rejectionReason, cancellationReason: request.cancellationReason, paymentProofs: (request.paymentProofs ?? []).map((proof: { id: string; mimeType: string; size: number; uploadedAt: Date }) => ({ id: proof.id, mimeType: proof.mimeType, size: proof.size, uploadedAt: proof.uploadedAt })) };
}
function statusLabel(status: VerificationStatus) {
  return ({ PENDING: 'Aguardando atendimento', CONTACTED: 'Em atendimento', AWAITING_PAYMENT: 'Aguardando pagamento', PAYMENT_PROOF_SENT: 'Comprovante enviado', PAYMENT_ISSUE: 'Problema no pagamento', PAID: 'Pagamento confirmado', APPROVED: 'Ativo', REJECTED: 'Recusado', CANCELLED: 'Cancelado', SUSPENDED: 'Suspenso', REVOKED: 'Revogado' } as const)[status];
}
function isDuplicateKey(error: unknown) { return isMongoDuplicateKey(error); }
function sendVerificationRequestError(error: unknown, response: Response) {
  if (isDuplicateKey(error)) { response.status(409).json({ error: 'Já existe uma solicitação ativa para este perfil nesta comunidade.' }); return; }
  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) { response.status(400).json({ error: 'Os dados da solicitação são inválidos. Confira o perfil e a comunidade selecionados.' }); return; }
  console.error('[VYBE+] Falha inesperada ao criar solicitação de verificação:', error instanceof Error ? error.stack ?? error.message : error);
  response.status(500).json({ error: 'Não foi possível concluir sua solicitação. Tente novamente ou fale com o suporte.' });
}
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export async function ensurePlatformSupport(tenant: NonNullable<Request['vybeTenant']>) {
  const existing = await Character.findOne(tenantScope(tenant._id, { platformIdentity: 'VYBE_SUPPORT' }));
  if (existing) return existing;
  const suffix = tenant._id.toString().slice(-6);
  const email = `vybe-support+${tenant._id.toString()}@system.vybe.internal`;
  let account = await Account.findOne(tenantScope(tenant._id, { email }));
  if (!account) {
    const password = randomBytes(48).toString('base64url');
    const salt = randomBytes(16).toString('hex');
    try { account = await Account.create({ tenantId: tenant._id, email, passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`, status: 'active' }); }
    catch (error) {
      if (!isDuplicateKey(error)) throw error;
      account = await Account.findOne(tenantScope(tenant._id, { email }));
      if (!account) throw error;
    }
  }
  // Character usernames permit only letters, numbers, dots and underscores (no hyphen).
  const baseUsername = 'vybesuporte';
  const username = await Character.exists(tenantScope(tenant._id, { username: baseUsername })) ? `${baseUsername}${suffix}` : baseUsername;
  try {
    return await Character.create({ tenantId: tenant._id, accountId: account._id, username, displayName: 'VYBE Suporte', bio: 'Conta oficial de atendimento da plataforma VYBE.', platformIdentity: 'VYBE_SUPPORT', verification: { status: 'ACTIVE', type: 'OFFICIAL', verifiedAt: new Date(), expiresAt: null } });
  } catch (error) {
    if (isDuplicateKey(error)) {
      const created = await Character.findOne(tenantScope(tenant._id, { platformIdentity: 'VYBE_SUPPORT' }));
      if (created) return created;
    }
    throw error;
  }
}
async function ensureSupportConversation(tenantId: mongoose.Types.ObjectId, memberId: mongoose.Types.ObjectId, supportId: mongoose.Types.ObjectId) {
  const directKey = conversationDirectKey(memberId, supportId);
  try {
    return await Conversation.findOneAndUpdate({ tenantId, kind: 'direct', directKey }, { $setOnInsert: { tenantId, kind: 'direct', directKey, createdBy: memberId, participants: [{ profileId: memberId, role: 'member' }, { profileId: supportId, role: 'member' }] } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const existing = await Conversation.findOne({ tenantId, kind: 'direct', directKey });
    if (existing) return existing;
    throw error;
  }
}
async function notify(tenant: mongoose.Types.ObjectId, to: mongoose.Types.ObjectId, actor: mongoose.Types.ObjectId, requestId: mongoose.Types.ObjectId, type: 'verification_requested' | 'verification_payment_confirmed' | 'verification_approved' | 'verification_rejected' | 'verification_suspended' | 'verification_removed') {
  await Notification.create({ tenantId: tenant, characterId: to, actorId: actor, targetId: requestId, type });
}

verificationRouter.get('/verification/price', (_request, response) => response.json({ amount: VERIFICATION_PRICE_BRL, currency: 'BRL' }));

verificationRouter.get('/verification/status', async (request, response) => {
  const tenant = request.vybeTenant!;
  const character = request.vybeCharacter!;
  const [latestRequest, community, paymentSettings] = await Promise.all([
    VerificationRequest.findOne(tenantScope(tenant._id, { characterId: character._id })).sort({ createdAt: -1 }).lean(),
    Community.findById(tenant._id).select('name logoUrl').lean().then((value) => Array.isArray(value) ? value[0] : value),
    PlatformPaymentSettings.findOne({ key: 'VYBE_PLUS_PIX' }).lean(),
  ]);
  const verification = character.verification;
  const active = isVerificationActive(verification);
  const support = await Character.findOne(tenantScope(tenant._id, { platformIdentity: 'VYBE_SUPPORT' })).select('username').lean();
  const canPay = Boolean(latestRequest && ['PENDING', 'CONTACTED', 'AWAITING_PAYMENT', 'PAYMENT_PROOF_SENT', 'PAYMENT_ISSUE', 'PAID'].includes(latestRequest.status));
  if (canPay && latestRequest && !latestRequest.history?.some((entry) => entry.action === 'pix_viewed')) {
    await VerificationRequest.updateOne({ _id: latestRequest._id, tenantId: tenant._id }, { $push: { history: { action: 'pix_viewed', createdAt: new Date() } } });
  }
  const beneficiary = latestRequest ? await Character.findOne(tenantScope(tenant._id, { _id: latestRequest.beneficiaryProfileId ?? latestRequest.characterId })).select('username displayName').lean() : null;
  response.json({ community: community?.name ?? 'Sua comunidade', communityLogoUrl: community?.logoUrl ?? null, username: character.username, supportUsername: support?.username ?? null, verification: { active, type: verification?.type ?? null, status: verification?.status ?? null, source: verification?.source ?? null, activatedAt: verification?.activatedAt ?? verification?.verifiedAt ?? null }, request: latestRequest ? { id: latestRequest._id.toString(), status: latestRequest.status, statusLabel: statusLabel(latestRequest.status), createdAt: latestRequest.createdAt, conversationId: latestRequest.conversationId?.toString() ?? null, rejectionReason: latestRequest.rejectionReason, isGift: latestRequest.isGift ?? false, beneficiary: beneficiary ? { username: beneficiary.username, displayName: beneficiary.displayName } : null, paymentProofs: (latestRequest.paymentProofs ?? []).map((proof: { id: string; mimeType: string; size: number; uploadedAt: Date }) => ({ id: proof.id, mimeType: proof.mimeType, size: proof.size, uploadedAt: proof.uploadedAt })) } : null, payment: canPay && paymentSettings ? { pixKey: paymentSettings.pixKey, pixKeyType: paymentSettings.pixKeyType, recipientName: paymentSettings.recipientName, qrCodeDataUrl: paymentSettings.qrCodeDataUrl ?? '' } : null, amount: latestRequest?.amount ?? VERIFICATION_PRICE_BRL, currency: latestRequest?.currency ?? 'BRL' });
});

verificationRouter.post('/verification/requests/:requestId/proof', async (request, response) => {
  const tenant = request.vybeTenant!;
  const character = request.vybeCharacter!;
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(400).json({ error: 'Solicitação inválida.' }); return; }
  const item = await VerificationRequest.findOne(tenantScope(tenant._id, { _id: request.params.requestId, characterId: character._id }));
  if (!item) { response.status(404).json({ error: 'Solicitação não encontrada para este perfil e comunidade.' }); return; }
  if (!['PENDING', 'CONTACTED', 'AWAITING_PAYMENT', 'PAYMENT_ISSUE'].includes(item.status)) { response.status(409).json({ error: 'Esta solicitação não está aceitando comprovantes agora.' }); return; }
  let parsed: ReturnType<typeof parsePaymentProof>;
  try { parsed = parsePaymentProof(request.body?.dataUrl); }
  catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Comprovante inválido.' }); return; }
  const saved = await savePaymentProof(parsed.bytes, parsed.extension);
  const now = new Date();
  item.paymentProofs ??= [];
  item.paymentProofs.push({ ...saved, mimeType: parsed.mimeType, size: parsed.bytes.length, uploadedByProfileId: character._id, uploadedAt: now });
  item.status = 'PAYMENT_PROOF_SENT';
  item.active = true;
  item.history ??= [];
  item.history.push({ action: 'proof_uploaded', createdAt: now });
  await item.save();
  const adminCharacter = item.adminCharacterId;
  await Notification.create({ tenantId: tenant._id, characterId: adminCharacter, actorId: character._id, targetId: item._id, type: 'verification_requested' }).catch(() => undefined);
  const adminEmails = platformAdminEmails();
  const platformAdmins = adminEmails.length ? await VybeAccount.find({ email: { $in: adminEmails }, status: 'active' }).select('_id').lean().catch(() => []) : [];
  if (platformAdmins.length) await VybeNotification.insertMany(platformAdmins.map((admin) => ({ accountId: admin._id, communityId: tenant._id, verificationRequestId: item._id, type: 'verification_payment_proof', status: 'PENDING', message: `Comprovante de pagamento recebido para a solicitação #${item._id.toString()}.` }))).catch(() => undefined);
  response.status(201).json({ status: item.status, statusLabel: statusLabel(item.status), proof: { id: saved.id, mimeType: parsed.mimeType, size: parsed.bytes.length, uploadedAt: now } });
});

verificationRouter.get('/verification/requests/:requestId/proofs/:proofId', async (request, response) => {
  const tenant = request.vybeTenant!;
  const character = request.vybeCharacter!;
  if (!mongoose.isValidObjectId(request.params.requestId) || !/^[a-f0-9]{32}$/.test(request.params.proofId)) { response.status(404).end(); return; }
  const item = await VerificationRequest.findOne(tenantScope(tenant._id, { _id: request.params.requestId, characterId: character._id }));
  const proof = item?.paymentProofs?.find((entry) => entry.id === request.params.proofId);
  if (!proof) { response.status(404).end(); return; }
  const bytes = await readPaymentProof(proof.filename);
  response.setHeader('Content-Type', proof.mimeType);
  response.setHeader('Content-Disposition', `inline; filename="comprovante.${proof.filename.split('.').pop()}"`);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  response.send(bytes);
});

verificationRouter.get('/verification/beneficiaries', async (request, response) => {
  const tenant = request.vybeTenant!;
  const character = request.vybeCharacter!;
  const search = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 60) : '';
  if (search.length < 2) { response.json([]); return; }
  const expression = new RegExp(escapeRegex(search.replace(/^@/, '')), 'i');
  const profiles = await Character.find(tenantScope(tenant._id, { _id: { $ne: character._id }, platformIdentity: { $exists: false }, $or: [{ username: expression }, { displayName: expression }] }))
    .select('_id username displayName avatarUrl verification')
    .sort({ displayName: 1 })
    .limit(12)
    .lean();
  if (!profiles.length) { response.json([]); return; }
  const ids = profiles.map((profile) => profile._id);
  const requests = await VerificationRequest.find(tenantScope(tenant._id, { active: true, $or: [{ beneficiaryProfileId: { $in: ids } }, { beneficiaryProfileId: { $exists: false }, characterId: { $in: ids } }] })).select('beneficiaryProfileId characterId').lean();
  const requestedIds = new Set(requests.map((item) => (item.beneficiaryProfileId ?? item.characterId).toString()));
  response.json(profiles.map((profile) => ({ id: profile._id.toString(), username: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl, verified: isVerificationActive(profile.verification), hasActiveRequest: requestedIds.has(profile._id.toString()) })));
});

verificationRouter.post('/verification/requests', async (request, response) => {
  let createdRequestId: mongoose.Types.ObjectId | undefined;
  let createdRequest = false;
  try {
  const tenant = request.vybeTenant!;
  const character = request.vybeCharacter!;
  if (!request.vybeAccount || !tenant || !character) { response.status(401).json({ error: 'Sua sessão expirou. Entre novamente para continuar.' }); return; }
  if (request.body?.isGift !== undefined && typeof request.body.isGift !== 'boolean') { response.status(400).json({ error: 'A opção de beneficiário é inválida.' }); return; }
  const isGift = request.body?.isGift === true;
  const requestedBeneficiaryId = typeof request.body?.beneficiaryProfileId === 'string' ? request.body.beneficiaryProfileId : '';
  if (isGift && !mongoose.isValidObjectId(requestedBeneficiaryId)) { response.status(400).json({ error: 'Selecione um perfil válido para o presente.' }); return; }
  if (!isGift && requestedBeneficiaryId && requestedBeneficiaryId !== character._id.toString()) { response.status(400).json({ error: 'O perfil beneficiário precisa ser o seu perfil nesta comunidade.' }); return; }
  const requester = await Character.findOne(tenantScope(tenant._id, { _id: character._id, accountId: request.vybeAccount._id }));
  if (!requester) { response.status(404).json({ error: 'Não foi possível localizar seu perfil nesta comunidade.' }); return; }
  const beneficiary = isGift
    ? await Character.findOne(tenantScope(tenant._id, { _id: requestedBeneficiaryId, platformIdentity: { $exists: false } }))
    : requester;
  if (!beneficiary) { response.status(404).json({ error: 'Este perfil não pertence à comunidade atual.' }); return; }
  if (isGift && beneficiary._id.equals(character._id)) { response.status(400).json({ error: 'Para solicitar para si, selecione “Para mim”.' }); return; }
  if (isVerificationActive(beneficiary.verification)) { response.status(409).json({ error: 'Este perfil já possui VYBE Verificado nesta comunidade.' }); return; }
  const beneficiaryQuery = { tenantId: tenant._id, active: true, $or: [{ beneficiaryProfileId: beneficiary._id }, { beneficiaryProfileId: { $exists: false }, characterId: beneficiary._id }] };
  const existingRequest = await VerificationRequest.findOne(beneficiaryQuery);
  if (existingRequest) { response.status(409).json({ error: 'Este perfil já possui uma solicitação ativa de VYBE Verificado nesta comunidade.', requestId: existingRequest._id.toString(), status: existingRequest.status }); return; }
  const requesterConflict = await VerificationRequest.findOne(tenantScope(tenant._id, { characterId: character._id, active: true }));
  if (requesterConflict && !isGift) { response.status(409).json({ error: 'Já existe uma solicitação em andamento para seu perfil nesta comunidade.', requestId: requesterConflict._id.toString(), status: requesterConflict.status }); return; }
  const adminCharacter = await ensurePlatformSupport(tenant);
  let verificationRequest: InstanceType<typeof VerificationRequest> | null = null;
  let created = false;
  try {
    verificationRequest = await VerificationRequest.create({ tenantId: tenant._id, requestedByUserId: request.vybeGlobalAccount?._id ?? request.vybeAccount._id, beneficiaryProfileId: beneficiary._id, isGift, source: isGift ? 'GIFT' : 'SELF_PURCHASE', characterId: character._id, accountId: request.vybeAccount._id, adminCharacterId: adminCharacter._id, verificationType: 'PAID_PROFILE', amount: VERIFICATION_PRICE_BRL, currency: 'BRL', status: 'AWAITING_PAYMENT', active: true, paymentStatus: 'unpaid', history: [{ action: 'request_created', createdAt: new Date() }] });
    created = true;
    createdRequest = true;
    createdRequestId = verificationRequest._id;
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    verificationRequest = await VerificationRequest.findOne(beneficiaryQuery);
    if (!verificationRequest) {
      const priorRequest = await VerificationRequest.findOne(tenantScope(tenant._id, { characterId: character._id, active: true }));
      if (priorRequest) { response.status(409).json({ error: 'Já existe uma solicitação em andamento para seu perfil nesta comunidade.', requestId: priorRequest._id.toString(), status: priorRequest.status }); return; }
      throw error;
    }
  }
  if (!verificationRequest) { response.status(409).json({ error: 'Já existe uma solicitação em andamento para este perfil nesta comunidade.' }); return; }
  if (!isGift && (character.verification?.requestId?.toString() !== verificationRequest._id.toString() || character.verification?.status !== 'PENDING')) {
      character.verification = { ...character.verification, status: 'PENDING', type: 'PAID_PROFILE', requestId: verificationRequest._id };
      try { await character.save(); }
      catch (error) { if (created) await VerificationRequest.deleteOne({ _id: verificationRequest._id, tenantId: tenant._id }); throw error; }
  }
  if (created) {
    await notify(tenant._id, adminCharacter._id, character._id, verificationRequest._id, 'verification_requested').catch(() => undefined);
      const adminEmails = (process.env.VYBE_PLATFORM_ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
      const platformAdmins = adminEmails.length ? await VybeAccount.find({ email: { $in: adminEmails }, status: 'active' }).select('_id').lean().catch(() => []) : [];
      if (platformAdmins.length) await VybeNotification.insertMany(platformAdmins.map((admin) => ({ accountId: admin._id, communityId: tenant._id, verificationRequestId: verificationRequest!._id, type: 'verification_request', status: 'PENDING', message: `Nova solicitação de VYBE Verificado por @${character.username}.` }))).catch(() => undefined);
  }
  response.status(created ? 201 : 200).json({ request: verificationJson(verificationRequest), alreadyExists: !created, isGift: verificationRequest.isGift ?? false, conversationId: verificationRequest.conversationId?.toString() ?? null });
  } catch (error) {
    if (createdRequest && createdRequestId) {
      try { await VerificationRequest.deleteOne({ _id: createdRequestId, tenantId: request.vybeTenant?._id }); }
      catch (cleanupError) { console.error('[VYBE+] Não foi possível reverter solicitação incompleta:', cleanupError instanceof Error ? cleanupError.stack ?? cleanupError.message : cleanupError); }
    }
    sendVerificationRequestError(error, response);
  }
});

verificationRouter.post('/verification/support/conversation', async (request, response) => {
  const tenant = request.vybeTenant!;
  const character = request.vybeCharacter!;
  const requestId = typeof request.body?.requestId === 'string' ? request.body.requestId : '';
  if (requestId && !mongoose.isValidObjectId(requestId)) { response.status(400).json({ error: 'Solicitação inválida.' }); return; }
  const verificationRequest = requestId ? await VerificationRequest.findOne(tenantScope(tenant._id, { _id: requestId, characterId: character._id })) : null;
  if (requestId && !verificationRequest) { response.status(404).json({ error: 'Solicitação não encontrada para este perfil e comunidade.' }); return; }
  const support = await ensurePlatformSupport(tenant);
  const blocked = Boolean(await Promise.all([
    ConversationBlock.exists({ tenantId: tenant._id, $or: [{ blockerId: character._id, blockedId: support._id }, { blockerId: support._id, blockedId: character._id }] }),
    MatchBlock.exists({ tenantId: tenant._id, $or: [{ blockerId: character._id, blockedId: support._id }, { blockerId: support._id, blockedId: character._id }] }),
  ]).then((items) => items.some(Boolean)));
  if (!canSendDirect('direct', 1, blocked)) { response.status(409).json({ error: 'A conversa com VYBE Suporte está indisponível para este perfil.' }); return; }
  const conversation = await ensureSupportConversation(tenant._id, character._id, support._id);
  if (verificationRequest && verificationRequest.conversationId?.toString() !== conversation._id.toString()) {
    verificationRequest.conversationId = conversation._id;
    verificationRequest.history = [...(verificationRequest.history ?? []), { action: 'support_conversation_opened', createdAt: new Date() }];
    await verificationRequest.save();
  }
  if (!await ConversationMessage.exists({ tenantId: tenant._id, conversationId: conversation._id })) {
    const context = verificationRequest
      ? `Olá! Solicitei o VYBE Verificado para meu perfil na comunidade ${tenant.name}. Minha solicitação é ${verificationRequest._id.toString()}.`
      : `Olá! Gostaria de saber mais sobre o VYBE+ na comunidade ${tenant.name}.`;
    const message = await ConversationMessage.create({ tenantId: tenant._id, conversationId: conversation._id, senderProfileId: character._id, content: context, messageType: 'text' });
    conversation.lastMessageAt = message.createdAt;
    await conversation.save();
    await Notification.create({ tenantId: tenant._id, characterId: support._id, actorId: character._id, type: 'message', targetId: message._id }).catch(() => undefined);
    emitToProfiles(tenant._id.toString(), [character._id, support._id], { type: 'message:new', conversationId: conversation._id.toString(), messageId: message._id.toString() });
  }
  response.json({ conversationId: conversation._id.toString(), supportUsername: support.username });
});

verificationRouter.get('/verification/requests/me', async (request, response) => {
  const requests = await VerificationRequest.find(tenantScope(tenantId(request), { characterId: request.vybeCharacter!._id })).sort({ createdAt: -1 }).limit(20).lean();
  response.json(requests.map((item) => ({ id: item._id.toString(), type: item.verificationType ?? 'PAID_PROFILE', status: item.status, statusLabel: statusLabel(item.status), amount: item.amount, currency: item.currency, createdAt: item.createdAt, rejectionReason: item.rejectionReason, cancellationReason: item.cancellationReason })));
});

verificationRouter.get('/verification/admin', async (request, response) => {
  if (!isCentralAdmin(request)) { response.status(403).json({ error: 'Apenas a administração central do VYBE pode acessar as verificações.' }); return; }
  const requests = await VerificationRequest.find({}).sort({ createdAt: -1 }).limit(300).lean();
  const tenantIds = [...new Set(requests.map((item) => item.tenantId.toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const [communities, characters] = await Promise.all([
    Community.find({ _id: { $in: tenantIds } }).select('_id name slug').lean(),
    Character.find({ $or: requests.map((item) => ({ tenantId: item.tenantId, _id: item.characterId })) }).select('_id tenantId username displayName avatarUrl accountId').lean(),
  ]);
  const communityById = new Map(communities.map((item) => [String(item._id), item]));
  const characterByKey = new Map(characters.map((item) => [`${item.tenantId}:${String(item._id)}`, item]));
  response.json({ isCentralAdmin: true, requests: requests.map((item) => {
    const community = communityById.get(item.tenantId.toString());
    const character = characterByKey.get(`${item.tenantId}:${item.characterId}`);
    return { id: item._id.toString(), tenantId: item.tenantId.toString(), conversationId: item.conversationId?.toString() ?? null, type: item.verificationType ?? 'PAID_PROFILE', community: community ? { name: community.name, slug: community.slug } : null, character: character ? { id: character._id.toString(), username: character.username, displayName: character.displayName, avatarUrl: character.avatarUrl } : null, status: item.status, statusLabel: statusLabel(item.status), paymentStatus: item.paymentStatus, amount: item.amount, currency: item.currency, createdAt: item.createdAt, paymentConfirmedAt: item.paymentConfirmedAt, rejectionReason: item.rejectionReason, cancellationReason: item.cancellationReason };
  }) });
});

verificationRouter.patch('/verification/admin/:requestId', async (request, response) => {
  if (!isCentralAdmin(request)) { response.status(403).json({ error: 'Apenas a administração central do VYBE pode revisar verificações.' }); return; }
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(400).json({ error: 'Solicitação inválida.' }); return; }
  const status = request.body?.status as VerificationStatus;
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
  if (!verificationStatuses.includes(status)) { response.status(400).json({ error: 'Status inválido.' }); return; }
  if ((status === 'REJECTED' || status === 'CANCELLED' || status === 'SUSPENDED' || status === 'REVOKED') && reason.length < 5) { response.status(400).json({ error: 'Informe um motivo com pelo menos 5 caracteres.' }); return; }
  const item = await VerificationRequest.findById(request.params.requestId);
  if (!item) { response.status(404).json({ error: 'Solicitação não encontrada.' }); return; }
  if (!canTransitionVerification(item.status, status)) { response.status(409).json({ error: `A solicitação não pode passar de ${statusLabel(item.status)} para ${statusLabel(status)}.` }); return; }
  if (status === 'APPROVED' && item.paymentStatus !== 'confirmed') { response.status(409).json({ error: 'Confirme o pagamento antes de aprovar o selo.' }); return; }
  const target = await Character.findOne(tenantScope(item.tenantId, { _id: item.characterId, accountId: item.accountId }));
  if (!target) { response.status(404).json({ error: 'Personagem não encontrado nesta comunidade.' }); return; }
  if (status === 'APPROVED' && target.verification?.status === 'ACTIVE' && !target.verification.removedAt) { response.status(409).json({ error: 'Este personagem já possui VYBE Verificado ativo.' }); return; }
  const now = new Date();
  item.status = status;
  if (status === 'APPROVED' || status === 'REJECTED' || status === 'CANCELLED' || status === 'SUSPENDED' || status === 'REVOKED') item.active = false;
  if (status === 'PAID') { item.paymentStatus = 'confirmed'; item.paymentConfirmedAt = now; item.paymentConfirmedBy = request.vybeAccount!._id; }
  if (status === 'APPROVED') { item.approvedAt = now; item.approvedBy = request.vybeAccount!._id; }
  if (status === 'REJECTED') { item.rejectedAt = now; item.rejectedBy = request.vybeAccount!._id; item.rejectionReason = reason; }
  if (status === 'CANCELLED') { item.cancelledAt = now; item.cancelledBy = request.vybeAccount!._id; item.cancellationReason = reason; }
  await item.save();
  if (status === 'APPROVED' || status === 'SUSPENDED' || status === 'REVOKED') {
    target.verification = { ...target.verification, status: status === 'APPROVED' ? 'ACTIVE' : status, verifiedAt: target.verification?.verifiedAt ?? now, activatedAt: status === 'APPROVED' ? now : target.verification?.activatedAt, expiresAt: null, verifiedBy: request.vybeAccount!._id, type: 'PAID_PROFILE', source: item.source ?? ((item.isGift ?? false) ? 'GIFT' : 'SELF_PURCHASE'), requestId: item._id, removedAt: status === 'REVOKED' ? now : status === 'APPROVED' ? undefined : target.verification?.removedAt, removedBy: status === 'REVOKED' ? request.vybeAccount!._id : status === 'APPROVED' ? undefined : target.verification?.removedBy, removalReason: status === 'REVOKED' || status === 'SUSPENDED' ? reason : status === 'APPROVED' ? undefined : target.verification?.removalReason };
    await target.save();
  } else if (status === 'REJECTED' || status === 'CANCELLED') {
    target.verification = { ...target.verification, status: 'REVOKED', removedAt: now, removedBy: request.vybeAccount!._id, removalReason: reason, requestId: item._id };
    await target.save();
  } else if (status === 'PENDING' || status === 'CONTACTED' || status === 'AWAITING_PAYMENT' || status === 'PAID') {
    target.verification = { ...target.verification, status: status === 'PAID' ? 'PENDING' : 'PENDING', type: 'PAID_PROFILE', requestId: item._id };
    await target.save();
  }
  const notificationType = status === 'PAID' ? 'verification_payment_confirmed' : status === 'APPROVED' ? 'verification_approved' : status === 'REJECTED' ? 'verification_rejected' : status === 'SUSPENDED' ? 'verification_suspended' : status === 'REVOKED' ? 'verification_removed' : null;
  if (notificationType) await notify(item.tenantId, item.characterId, request.vybeCharacter!._id, item._id, notificationType);
  await CommunityAudit.create({ tenantId: item.tenantId, actorId: request.vybeCharacter!._id, action: `verification_${status.toLowerCase()}`, details: { requestId: item._id.toString(), characterId: item.characterId.toString(), reason } });
  response.json({ id: item._id.toString(), status: item.status, statusLabel: statusLabel(item.status), character: { id: target._id.toString(), isVerified: Boolean(target.verification?.verifiedAt && !target.verification.removedAt) } });
});

verificationRouter.post('/verification/admin/:requestId/remove', async (request, response) => {
  if (!isCentralAdmin(request)) { response.status(403).json({ error: 'Apenas a administração central do VYBE pode remover verificações.' }); return; }
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(400).json({ error: 'Solicitação inválida.' }); return; }
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 500) { response.status(400).json({ error: 'Informe um motivo com pelo menos 5 caracteres.' }); return; }
  const item = await VerificationRequest.findById(request.params.requestId);
  if (!item || item.status !== 'APPROVED') { response.status(404).json({ error: 'Verificação ativa não encontrada.' }); return; }
  const target = await Character.findOne(tenantScope(item.tenantId, { _id: item.characterId, accountId: item.accountId }));
  if (!target?.verification?.verifiedAt || target.verification.removedAt) { response.status(409).json({ error: 'Este selo já está removido ou indisponível.' }); return; }
  const now = new Date();
  target.verification.removedAt = now; target.verification.removedBy = request.vybeAccount!._id; target.verification.removalReason = reason;
  item.removedAt = now; item.removedBy = request.vybeAccount!._id; item.removalReason = reason;
  await Promise.all([target.save(), item.save(), notify(item.tenantId, item.characterId, request.vybeCharacter!._id, item._id, 'verification_removed'), CommunityAudit.create({ tenantId: item.tenantId, actorId: request.vybeCharacter!._id, action: 'verification_removed', details: { requestId: item._id.toString(), characterId: item.characterId.toString(), reason } })]);
  response.json({ removed: true, reason });
});
