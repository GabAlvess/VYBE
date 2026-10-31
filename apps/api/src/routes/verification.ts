import { Router, type Request } from 'express';
import mongoose from 'mongoose';
import { VERIFICATION_PRICE_BRL } from '@vybe/shared';
import { Community } from '../models/Community.js';
import { CommunityAudit } from '../models/CommunityAudit.js';
import { Account, Character, Notification } from '../models/Social.js';
import { canTransitionVerification, VerificationRequest, verificationStatuses, type VerificationStatus } from '../models/VerificationRequest.js';
import { requireSession, tenantScope } from '../middleware/tenant.js';

export const verificationRouter = Router();
verificationRouter.use(requireSession);

function tenantId(request: Request) { return request.vybeTenant!._id; }
function platformSlug() { return process.env.VYBE_PLATFORM_TENANT_SLUG ?? 'community'; }
function platformAdminEmails() { return (process.env.VYBE_PLATFORM_ADMIN_EMAILS ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean); }
function isCentralAdmin(request: Request) {
  return request.vybeTenant!.slug === platformSlug() && platformAdminEmails().includes(request.vybeAccount!.email.toLowerCase());
}
function verificationJson(request: typeof VerificationRequest.prototype) {
  return { id: request._id.toString(), status: request.status, paymentStatus: request.paymentStatus, amount: request.amount, currency: request.currency, createdAt: request.createdAt, paymentConfirmedAt: request.paymentConfirmedAt, approvedAt: request.approvedAt, rejectionReason: request.rejectionReason, cancellationReason: request.cancellationReason };
}
function statusLabel(status: VerificationStatus) {
  return ({ PENDING: 'Pendente', CONTACTED: 'Em atendimento', AWAITING_PAYMENT: 'Aguardando pagamento', PAID: 'Pagamento confirmado', APPROVED: 'Aprovado', REJECTED: 'Recusado', CANCELLED: 'Cancelado' } as const)[status];
}
async function notify(tenant: mongoose.Types.ObjectId, to: mongoose.Types.ObjectId, actor: mongoose.Types.ObjectId, requestId: mongoose.Types.ObjectId, type: 'verification_requested' | 'verification_payment_confirmed' | 'verification_approved' | 'verification_rejected' | 'verification_removed') {
  await Notification.create({ tenantId: tenant, characterId: to, actorId: actor, targetId: requestId, type });
}

verificationRouter.get('/verification/price', (_request, response) => response.json({ amount: VERIFICATION_PRICE_BRL, currency: 'BRL' }));

verificationRouter.post('/verification/requests', async (request, response) => {
  const tenant = request.vybeTenant!;
  const character = request.vybeCharacter!;
  if (character.verification?.verifiedAt && !character.verification.removedAt) { response.status(409).json({ error: 'Este personagem já tem verificação ativa.' }); return; }
  const emails = platformAdminEmails();
  if (!emails.length) { response.status(503).json({ error: 'A conta administrativa central do VYBE ainda não está configurada.' }); return; }
  const configuredUsername = (process.env.VYBE_VERIFICATION_ADMIN_USERNAME ?? 'vybea').toLowerCase();
  const adminCharacter = await Character.findOne(tenantScope(tenant._id, { username: configuredUsername })).lean();
  if (!adminCharacter || !emails.includes((await Account.findOne(tenantScope(tenant._id, { _id: adminCharacter.accountId })).select('email').lean())?.email.toLowerCase() ?? '')) {
    response.status(503).json({ error: 'A conta oficial VYBE ADM ainda não está habilitada nesta comunidade.' }); return;
  }
  let verificationRequest = await VerificationRequest.findOne(tenantScope(tenant._id, { characterId: character._id, active: true }));
  if (!verificationRequest) {
    try {
      verificationRequest = await VerificationRequest.create({ tenantId: tenant._id, characterId: character._id, accountId: request.vybeAccount!._id, adminCharacterId: adminCharacter._id, amount: VERIFICATION_PRICE_BRL, currency: 'BRL', status: 'PENDING', active: true, paymentStatus: 'unpaid' });
      await notify(tenant._id, adminCharacter._id, character._id, verificationRequest._id, 'verification_requested');
    } catch (error) {
      if (!(error instanceof mongoose.mongo.MongoServerError) || error.code !== 11000) throw error;
      verificationRequest = await VerificationRequest.findOne(tenantScope(tenant._id, { characterId: character._id, active: true }));
    }
  }
  if (!verificationRequest) { response.status(500).json({ error: 'Não foi possível registrar a solicitação.' }); return; }
  response.status(200).json({ request: verificationJson(verificationRequest), adminUsername: adminCharacter.username, suggestedMessage: 'Olá! Quero solicitar a verificação do meu perfil no VYBE por R$ 29,90.' });
});

verificationRouter.get('/verification/requests/me', async (request, response) => {
  const requests = await VerificationRequest.find(tenantScope(tenantId(request), { characterId: request.vybeCharacter!._id })).sort({ createdAt: -1 }).limit(20).lean();
  response.json(requests.map((item) => ({ id: item._id.toString(), status: item.status, statusLabel: statusLabel(item.status), amount: item.amount, currency: item.currency, createdAt: item.createdAt, rejectionReason: item.rejectionReason, cancellationReason: item.cancellationReason })));
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
    return { id: item._id.toString(), tenantId: item.tenantId.toString(), community: community ? { name: community.name, slug: community.slug } : null, character: character ? { id: character._id.toString(), username: character.username, displayName: character.displayName, avatarUrl: character.avatarUrl } : null, status: item.status, statusLabel: statusLabel(item.status), paymentStatus: item.paymentStatus, amount: item.amount, currency: item.currency, createdAt: item.createdAt, paymentConfirmedAt: item.paymentConfirmedAt, rejectionReason: item.rejectionReason, cancellationReason: item.cancellationReason };
  }) });
});

verificationRouter.patch('/verification/admin/:requestId', async (request, response) => {
  if (!isCentralAdmin(request)) { response.status(403).json({ error: 'Apenas a administração central do VYBE pode revisar verificações.' }); return; }
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(400).json({ error: 'Solicitação inválida.' }); return; }
  const status = request.body?.status as VerificationStatus;
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
  if (!verificationStatuses.includes(status)) { response.status(400).json({ error: 'Status inválido.' }); return; }
  if ((status === 'REJECTED' || status === 'CANCELLED') && reason.length < 5) { response.status(400).json({ error: 'Informe um motivo com pelo menos 5 caracteres.' }); return; }
  const item = await VerificationRequest.findById(request.params.requestId);
  if (!item) { response.status(404).json({ error: 'Solicitação não encontrada.' }); return; }
  if (!canTransitionVerification(item.status, status)) { response.status(409).json({ error: `A solicitação não pode passar de ${statusLabel(item.status)} para ${statusLabel(status)}.` }); return; }
  if (status === 'APPROVED' && item.paymentStatus !== 'confirmed') { response.status(409).json({ error: 'Confirme o pagamento antes de aprovar o selo.' }); return; }
  const target = await Character.findOne(tenantScope(item.tenantId, { _id: item.characterId, accountId: item.accountId }));
  if (!target) { response.status(404).json({ error: 'Personagem não encontrado nesta comunidade.' }); return; }
  if (status === 'APPROVED' && target.verification?.verifiedAt && !target.verification.removedAt) { response.status(409).json({ error: 'Este personagem já possui verificação ativa.' }); return; }
  const now = new Date();
  item.status = status;
  if (status === 'APPROVED' || status === 'REJECTED' || status === 'CANCELLED') item.active = false;
  if (status === 'PAID') { item.paymentStatus = 'confirmed'; item.paymentConfirmedAt = now; item.paymentConfirmedBy = request.vybeAccount!._id; }
  if (status === 'APPROVED') { item.approvedAt = now; item.approvedBy = request.vybeAccount!._id; }
  if (status === 'REJECTED') { item.rejectedAt = now; item.rejectedBy = request.vybeAccount!._id; item.rejectionReason = reason; }
  if (status === 'CANCELLED') { item.cancelledAt = now; item.cancelledBy = request.vybeAccount!._id; item.cancellationReason = reason; }
  await item.save();
  if (status === 'APPROVED') {
    target.verification = { verifiedAt: now, verifiedBy: request.vybeAccount!._id, type: 'PAID_PROFILE', requestId: item._id };
    await target.save();
  }
  const notificationType = status === 'PAID' ? 'verification_payment_confirmed' : status === 'APPROVED' ? 'verification_approved' : status === 'REJECTED' ? 'verification_rejected' : null;
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
