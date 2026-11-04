import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response, type NextFunction } from 'express';
import mongoose from 'mongoose';
import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from '@vybe/shared';
import { Community } from '../models/Community.js';
import { CommunityAudit } from '../models/CommunityAudit.js';
import { CommunityRequest, type CommunityRequestFields } from '../models/CommunityRequest.js';
import { CommunityJoinRequest } from '../models/CommunityJoinRequest.js';
import { Account, Character, Notification, Session } from '../models/Social.js';
import { Conversation, ConversationMessage } from '../models/Conversation.js';
import { VerificationRequest, canTransitionVerification, verificationStatuses, type VerificationStatus } from '../models/VerificationRequest.js';
import { VybeAccount } from '../models/VybeAccount.js';
import { VybeSession } from '../models/VybeSession.js';
import { VybeNotification } from '../models/VybeNotification.js';
import { normalizeJoinUsername, normalizePhotoplayerName, validateJoinAge, validateJoinText, validateJoinUsername } from './communityJoinPolicy.js';
import { requiresJoinApproval } from './communityEntryPolicy.js';
import { disconnectProfile, emitToProfiles } from '../realtime/chatWebSocket.js';
import { isVerificationActive } from '../services/verifiedSocialBenefits.js';
import { ensurePlatformSupport } from './verification.js';
import { conversationDirectKey } from './conversationPolicy.js';
import { ensureProvisioningCollections, provisionApprovedCommunity } from '../services/communityProvisioning.js';
import { isConfiguredPlatformAdmin } from '../services/platformAdminPolicy.js';
import { PlatformPaymentSettings, type PixKeyType } from '../models/PlatformPaymentSettings.js';
import { parsePaymentProof, readPaymentProof, savePaymentProof } from '../services/privatePaymentProofs.js';
import { DEFAULT_COMMUNITY_CREATION_PRICE_CENTS, PlatformProductSettings } from '../models/PlatformProductSettings.js';
import { SupportTicket, supportTicketStatuses, type SupportTicketStatus } from '../models/SupportTicket.js';
import { supportTicketTypes, type SupportTicketType } from '../models/SupportTicket.js';
import { SupportTicketMessage } from '../models/SupportTicketMessage.js';
import { readSupportFile, saveSupportFiles } from '../services/supportTicketFiles.js';
import { isCommunityOwner } from './communityAdminPolicy.js';
import { canReplyToSupportTicket, statusAfterUserSupportReply, supportTicketOwnerFilter } from './supportTicketPolicy.js';

export const platformRouter = Router();
const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads');
type CommunityPaymentProof = NonNullable<CommunityRequestFields['paymentProofs']>[number];
type CommunityRequestEvent = NonNullable<CommunityRequestFields['history']>[number];
const globalAccount = (request: Request) => request.vybeGlobalAccount!;
const fail = (response: Response, status: number, error: string) => response.status(status).json({ error });
function requirePlatformAdmin(request: Request, response: Response, next: NextFunction) {
  if (!request.vybeGlobalAccount || !isConfiguredPlatformAdmin(request.vybeGlobalAccount.email)) { fail(response, 403, 'Acesso restrito à equipe administrativa da plataforma VYBE.'); return; }
  next();
}
function supportOwnerEmail() {
  const configuredOwner = (process.env.VYBE_PLATFORM_OWNER_EMAIL ?? '').trim().toLowerCase();
  const admins = (process.env.VYBE_PLATFORM_ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  return configuredOwner || (admins.length === 1 ? admins[0] : '');
}
function requireSupportOwner(request: Request, response: Response, next: NextFunction) {
  const ownerEmail = supportOwnerEmail();
  if (!request.vybeGlobalAccount || !ownerEmail || request.vybeGlobalAccount.email.toLowerCase() !== ownerEmail) { fail(response, 403, ownerEmail ? 'A caixa de atendimento é exclusiva da proprietária da plataforma.' : 'Configure VYBE_PLATFORM_OWNER_EMAIL para definir a proprietária da plataforma.'); return; }
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

function visibleTicketStatus(status: string) { return status === 'RESPONDED' ? 'WAITING_USER' : status; }
function ticketStatusName(status: string) { return ({ NEW: 'Aguardando atendimento', IN_PROGRESS: 'Em atendimento', WAITING_USER: 'Aguardando sua resposta', RESPONDED: 'Aguardando sua resposta', RESOLVED: 'Resolvido', CLOSED: 'Encerrado' } as Record<string, string>)[status] ?? status; }
function publicTicketEvents(row: any) {
  return (row.history ?? []).filter((event: any) => event.action === 'ticket_created' || event.action === 'support_reply_sent' || event.action === 'assigned' || event.action.startsWith('status_')).map((event: any, index: number) => ({ id: `${String(row._id)}-event-${index}`, action: event.action, status: visibleTicketStatus(event.newStatus ?? (event.action.startsWith('status_') ? event.action.slice(7).toUpperCase() : '')), createdAt: event.createdAt }));
}
function supportTicketJson(row: any, applicant?: any) { return { id: String(row._id), number: row.ticketNumber, category: row.category, subject: row.subject, description: row.description, appArea: row.appArea, communityName: row.communityName, communityId: (row.sourceCommunityId ?? (row.createdByGlobalAccountId ? undefined : row.tenantId))?.toString() ?? '', communityCreationRequestId: row.communityCreationRequestId?.toString() ?? '', verificationRequestId: row.verificationRequestId?.toString() ?? '', status: visibleTicketStatus(row.status), assignedToAdminId: row.assignedToAdminId?.toString() ?? '', assignedAt: row.assignedAt ?? null, resolvedAt: row.resolvedAt ?? null, closedAt: row.closedAt ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt, lastMessageAt: row.lastMessageAt, lastMessagePreview: row.lastMessagePreview, unreadForAdmin: row.unreadForAdmin, unreadMessageCount: row.unreadMessageCount ?? 0, unreadForUser: row.unreadForUser ?? false, unreadMessageCountForUser: row.unreadMessageCountForUser ?? 0, requester: applicant ? { id: String(applicant._id), displayName: applicant.displayName, username: applicant.username, email: applicant.email, avatarUrl: applicant.avatarUrl ?? '' } : null }; }

function ticketMessageJson(message: any, ticketId: string, viewer: 'USER' | 'ADMIN', sender: any) {
  return { id: String(message._id), content: message.content, sender, isSupport: message.senderType === 'SUPPORT', createdAt: message.createdAt, attachments: (message.attachments ?? []).map((item: any) => ({ name: item.name, mimeType: item.mimeType, size: item.size, url: viewer === 'ADMIN' ? `/api/platform/admin/support/tickets/${ticketId}/attachments/${item.storageName}` : `/api/support/tickets/${ticketId}/attachments/${item.storageName}` })) };
}
async function readTicketMessages(ticket: any, viewer: 'USER' | 'ADMIN', requester?: any) {
  const stored = await SupportTicketMessage.find({ ticketId: ticket._id }).sort({ createdAt: 1 }).limit(500).lean();
  if (stored.length) return stored.map((message) => ticketMessageJson(message, String(ticket._id), viewer, message.senderType === 'SUPPORT' ? { displayName: 'VYBE Suporte', username: 'suporte' } : requester ?? null));
  // Read-only compatibility for older protocols created before support tickets had their own message store.
  if (!ticket.conversationId || !ticket.tenantId) return [];
  const oldMessages = await ConversationMessage.find({ tenantId: ticket.tenantId, conversationId: ticket.conversationId, deletedAt: { $exists: false } }).sort({ createdAt: 1 }).limit(500).lean();
  const senderIds = [...new Set(oldMessages.map((message) => message.senderProfileId.toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const senders = await Character.find({ tenantId: ticket.tenantId, _id: { $in: senderIds } }).select('_id displayName username platformIdentity').lean();
  const byId = new Map(senders.map((item) => [String(item._id), item]));
  return oldMessages.map((message) => { const sender = message.senderGlobalAccountId ? requester : byId.get(message.senderProfileId.toString()) ?? null; return { id: String(message._id), content: message.content, messageType: message.messageType, attachment: message.attachment, createdAt: message.createdAt, sender, isSupport: message.senderGlobalAccountId ? false : byId.get(message.senderProfileId.toString())?.platformIdentity === 'VYBE_SUPPORT' }; });
}

function supportCounterId() { return new mongoose.Types.ObjectId('000000000000000000000001'); }
async function nextSupportTicketNumber() {
  const counter = await mongoose.connection.collection('support_ticket_counters').findOneAndUpdate({ _id: supportCounterId() }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after' });
  const value = (counter as any)?.value?.value ?? (counter as any)?.value ?? 1;
  return Number(value);
}
async function collectSupportFiles(ticketId: string, value: unknown, response: Response) {
  try { return await saveSupportFiles(ticketId, value); }
  catch (error) { fail(response, 400, error instanceof Error ? error.message : 'Anexo inválido.'); return null; }
}

platformRouter.post('/support/tickets', requireGlobal, async (request, response) => {
  const body = request.body ?? {}; const category = body.category as SupportTicketType;
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const appArea = typeof body.appArea === 'string' ? body.appArea.trim() : '';
  if (!(supportTicketTypes as readonly string[]).includes(category) || subject.length < 3 || subject.length > 120 || description.length < 5 || description.length > 4000 || appArea.length > 80) { fail(response, 400, 'Confira o assunto, a descrição e a categoria do atendimento.'); return; }
  const account = globalAccount(request);
  let sourceCommunity: any = null;
  if (typeof body.communityId === 'string' && mongoose.isValidObjectId(body.communityId)) {
    const requested: any = await Community.findOne({ _id: body.communityId, status: 'active' }).lean();
    if (requested) {
      const member = await Account.findOne({ tenantId: requested._id, status: 'active', $or: [{ globalAccountId: account._id }, { email: account.email }] }).select('_id role').lean();
      if (member) sourceCommunity = requested;
    }
  }
  if (category === 'PLATFORM_DIRECTION') {
    const ownerCommunity = sourceCommunity && await Community.findById(sourceCommunity._id);
    const member = ownerCommunity && await Account.findOne({ tenantId: ownerCommunity._id, status: 'active', $or: [{ globalAccountId: account._id }, { email: account.email }] });
    if (!ownerCommunity || !member || !isCommunityOwner(ownerCommunity, member)) { fail(response, 403, 'O canal da direção está disponível somente para proprietários de comunidade.'); return; }
  }
  let communityCreationRequestId: mongoose.Types.ObjectId | undefined;
  if (body.communityCreationRequestId) {
    if (!mongoose.isValidObjectId(body.communityCreationRequestId)) { fail(response, 400, 'Solicitação de criação inválida.'); return; }
    const related = await CommunityRequest.findOne({ _id: body.communityCreationRequestId, globalAccountId: account._id }).select('_id').lean();
    if (!related) { fail(response, 403, 'Você não pode vincular uma solicitação de criação de outra conta.'); return; }
    communityCreationRequestId = new mongoose.Types.ObjectId(String((related as any)._id));
  }
  let verificationRequestId: mongoose.Types.ObjectId | undefined;
  if (body.verificationRequestId) {
    if (!mongoose.isValidObjectId(body.verificationRequestId)) { fail(response, 400, 'Solicitação VYBE+ inválida.'); return; }
    const related = await VerificationRequest.findOne({ _id: body.verificationRequestId, requestedByUserId: account._id }).select('_id').lean();
    if (!related) { fail(response, 403, 'Você não pode vincular uma solicitação VYBE+ de outra conta.'); return; }
    verificationRequestId = new mongoose.Types.ObjectId(String((related as any)._id));
  }
  const ticketNumber = await nextSupportTicketNumber();
  const ticketId = new mongoose.Types.ObjectId();
  const attachments = await collectSupportFiles(String(ticketId), body.attachments, response); if (!attachments) return;
  const ticket = await SupportTicket.create({ _id: ticketId, ticketNumber, createdByGlobalAccountId: account._id, sourceCommunityId: sourceCommunity?._id, category, subject, description, appArea, communityName: sourceCommunity?.name ?? '', communityCreationRequestId, verificationRequestId, status: 'NEW', lastMessageAt: new Date(), lastMessagePreview: description.slice(0, 180), unreadForAdmin: true, unreadMessageCount: 1, unreadForUser: false, unreadMessageCountForUser: 0, history: [{ action: 'ticket_created', actorUserId: account._id, createdAt: new Date() }] });
  const message = await SupportTicketMessage.create({ ticketId: ticket._id, senderGlobalAccountId: account._id, senderType: 'USER', content: description, attachments });
  const ownerEmail = supportOwnerEmail();
  const adminAccounts = ownerEmail ? await VybeAccount.find({ email: ownerEmail, status: 'active' }).select('_id').lean() : [];
  if (adminAccounts.length) await VybeNotification.insertMany(adminAccounts.map((admin) => ({ accountId: admin._id, communityId: sourceCommunity?._id, type: 'support_ticket', status: 'NEW', supportTicketId: ticket._id, message: `Novo atendimento #${String(ticketNumber).padStart(5, '0')}: ${subject}` }))).catch(() => undefined);
  response.status(201).json(supportTicketJson(ticket, account));
});

platformRouter.get('/support/tickets/me', requireGlobal, async (request, response) => {
  const rows = await SupportTicket.find({ createdByGlobalAccountId: globalAccount(request)._id }).sort({ updatedAt: -1 }).limit(100).lean();
  response.json(rows.map((row) => supportTicketJson(row)));
});

platformRouter.get('/support/tickets/:ticketId', requireGlobal, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.ticketId)) { fail(response, 404, 'Atendimento não encontrado.'); return; }
  const ticket: any = await SupportTicket.findOne(supportTicketOwnerFilter(String(request.params.ticketId), globalAccount(request)._id)).lean();
  if (!ticket) { fail(response, 404, 'Atendimento não encontrado.'); return; }
  await SupportTicket.updateOne({ _id: ticket._id, createdByGlobalAccountId: globalAccount(request)._id }, { $set: { unreadForUser: false, unreadMessageCountForUser: 0 } });
  ticket.unreadForUser = false; ticket.unreadMessageCountForUser = 0;
  response.json({ ticket: supportTicketJson(ticket, globalAccount(request)), messages: await readTicketMessages(ticket, 'USER', globalAccount(request)), events: publicTicketEvents(ticket) });
});

platformRouter.post('/support/tickets/:ticketId/messages', requireGlobal, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.ticketId)) { fail(response, 404, 'Atendimento não encontrado.'); return; }
  const content = typeof request.body?.content === 'string' ? request.body.content.trim() : '';
  const hasFiles = Array.isArray(request.body?.attachments) && request.body.attachments.length > 0;
  if ((!content && !hasFiles) || content.length > 4000) { fail(response, 400, 'Escreva uma mensagem ou anexe um arquivo.'); return; }
  const account = globalAccount(request); const ticket: any = await SupportTicket.findOne(supportTicketOwnerFilter(String(request.params.ticketId), account._id));
  if (!ticket || !canReplyToSupportTicket(ticket.status)) { fail(response, ticket ? 409 : 404, ticket ? 'Este atendimento foi encerrado. Abra um novo para continuar.' : 'Atendimento não encontrado.'); return; }
  const attachments = await collectSupportFiles(String(ticket._id), request.body?.attachments, response); if (!attachments) return;
  const message = await SupportTicketMessage.create({ ticketId: ticket._id, senderGlobalAccountId: account._id, senderType: 'USER', content, attachments });
  const previousStatus = visibleTicketStatus(ticket.status); ticket.status = statusAfterUserSupportReply(); if (previousStatus === 'RESOLVED') ticket.resolvedAt = undefined; ticket.lastMessageAt = message.createdAt; ticket.lastMessagePreview = content.slice(0, 180) || 'Anexo enviado'; ticket.unreadForAdmin = true; ticket.unreadMessageCount = (ticket.unreadMessageCount ?? 0) + 1; ticket.unreadForUser = false; ticket.unreadMessageCountForUser = 0; ticket.history ??= []; ticket.history.push({ action: 'user_reply_sent', actorUserId: account._id, createdAt: new Date() }); await ticket.save();
  const ownerEmail = supportOwnerEmail();
  const adminAccounts = ownerEmail ? await VybeAccount.find({ email: ownerEmail, status: 'active' }).select('_id').lean() : [];
  if (adminAccounts.length) await VybeNotification.insertMany(adminAccounts.map((admin) => ({ accountId: admin._id, communityId: ticket.sourceCommunityId, type: 'support_ticket', status: 'NEW', supportTicketId: ticket._id, message: `Nova mensagem no atendimento #${String(ticket.ticketNumber).padStart(5, '0')}.` }))).catch(() => undefined);
  response.status(201).json(ticketMessageJson(message, String(ticket._id), 'USER', account));
});

platformRouter.get('/support/tickets/:ticketId/attachments/:storageName', requireGlobal, async (request, response) => {
  const ticketId = String(request.params.ticketId); const storageName = String(request.params.storageName);
  if (!mongoose.isValidObjectId(ticketId)) { response.status(404).end(); return; }
  const account = globalAccount(request); const ticket: any = await SupportTicket.findOne(supportTicketOwnerFilter(ticketId, account._id)).select('_id').lean();
  if (!ticket) { response.status(404).end(); return; }
  const message: any = await SupportTicketMessage.findOne({ ticketId: ticket._id, 'attachments.storageName': storageName }).select('attachments').lean();
  const attachment = message?.attachments?.find((item: any) => item.storageName === storageName);
  if (!attachment) { response.status(404).end(); return; }
  try { const file = await readSupportFile(String(ticket._id), storageName); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Content-Type', attachment.mimeType); response.setHeader('Content-Disposition', `${attachment.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`); response.send(file); } catch { response.status(404).end(); }
});

platformRouter.get('/platform/admin/support/tickets', requireGlobal, requireSupportOwner, async (request, response) => {
  const filter: Record<string, unknown> = {};
  const category = typeof request.query.category === 'string' ? request.query.category : '';
  const status = typeof request.query.status === 'string' ? request.query.status : '';
  if (category && category !== 'ALL') { const values = category.split(',').filter(Boolean); if (values.some((value) => !(supportTicketTypes as readonly string[]).includes(value))) { fail(response, 400, 'Categoria inválida.'); return; } filter.category = values.length > 1 ? { $in: values } : values[0]; }
  if (request.query.history === '1') filter.status = { $in: ['RESOLVED', 'CLOSED'] };
  else if (status && status !== 'ALL') { if (!(supportTicketStatuses as readonly string[]).includes(status)) { fail(response, 400, 'Status inválido.'); return; } filter.status = status; }
  if (request.query.unread === '1') filter.unreadForAdmin = true;
  if (typeof request.query.communityId === 'string' && mongoose.isValidObjectId(request.query.communityId)) filter.tenantId = request.query.communityId;
  const rows: any[] = await SupportTicket.find(filter).sort({ lastMessageAt: -1 }).limit(500).lean() as any;
  const profileIds = [...new Set(rows.map((row) => row.requesterProfileId?.toString()).filter(Boolean))].map((id) => new mongoose.Types.ObjectId(id!));
  const globalIds = [...new Set(rows.map((row) => row.createdByGlobalAccountId?.toString()).filter(Boolean))].map((id) => new mongoose.Types.ObjectId(id!));
  const [profiles, accounts] = await Promise.all([Character.find({ _id: { $in: profileIds } }).select('_id displayName username avatarUrl').lean(), VybeAccount.find({ _id: { $in: globalIds } }).select('_id displayName username email avatarUrl').lean()]);
  const byProfile = new Map(profiles.map((item) => [String(item._id), item])); const byAccount = new Map(accounts.map((item) => [String(item._id), item]));
  response.json(rows.map((row) => supportTicketJson(row, byProfile.get(row.requesterProfileId?.toString() ?? '') ?? byAccount.get(row.createdByGlobalAccountId?.toString() ?? ''))));
});

platformRouter.get('/platform/admin/support/tickets/:ticketId', requireGlobal, requireSupportOwner, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.ticketId)) { fail(response, 404, 'Atendimento não encontrado.'); return; }
  const row: any = await SupportTicket.findById(request.params.ticketId).lean() as any;
  if (!row) { fail(response, 404, 'Atendimento não encontrado.'); return; }
  await SupportTicket.updateOne({ _id: row._id }, { $set: { unreadForAdmin: false, unreadMessageCount: 0 } }); row.unreadForAdmin = false; row.unreadMessageCount = 0;
  const [profile, account, handler] = await Promise.all([
    row.requesterProfileId ? Character.findById(row.requesterProfileId).select('_id displayName username avatarUrl').lean() : null,
    row.createdByGlobalAccountId ? VybeAccount.findById(row.createdByGlobalAccountId).select('_id displayName username email avatarUrl').lean() : null,
    row.assignedToAdminId ? VybeAccount.findById(row.assignedToAdminId).select('displayName username').lean() : null,
  ]);
  const requester = profile ?? account;
  const assigned = Array.isArray(handler) ? handler[0] : handler;
  response.json({ ticket: { ...supportTicketJson(row, requester), assignedTo: assigned ? { displayName: assigned.displayName, username: assigned.username } : null, internalNotes: (row.internalNotes ?? []).map((note: any) => ({ content: note.content, createdAt: note.createdAt, authorId: String(note.authorAdminId) })), history: row.history ?? [] }, messages: await readTicketMessages(row, 'ADMIN', requester), events: publicTicketEvents(row) });
});

platformRouter.post('/platform/admin/support/tickets/:ticketId/assign', requireGlobal, requireSupportOwner, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.ticketId)) { fail(response, 404, 'Atendimento não encontrado.'); return; }
  const actor = globalAccount(request); const now = new Date();
  const before = await SupportTicket.findById(request.params.ticketId);
  if (!before) { fail(response, 404, 'Atendimento não encontrado.'); return; }
  if (before.assignedToAdminId?.equals(actor._id) && before.status === 'IN_PROGRESS') { response.json({ assigned: true, id: String(before._id), status: before.status, assignedTo: { displayName: actor.displayName, username: actor.username } }); return; }
  const row = await SupportTicket.findByIdAndUpdate(request.params.ticketId, { $set: { assignedToAdminId: actor._id, assignedAt: now, status: 'IN_PROGRESS', unreadForUser: true }, $push: { history: { action: 'assigned', previousStatus: visibleTicketStatus(before.status), newStatus: 'IN_PROGRESS', actorAdminId: actor._id, createdAt: now } } }, { new: true });
  if (!row) { fail(response, 404, 'Atendimento não encontrado.'); return; }
  if (row.createdByGlobalAccountId) await VybeNotification.create({ accountId: row.createdByGlobalAccountId, communityId: row.sourceCommunityId, supportTicketId: row._id, type: 'support_ticket', status: 'NEW', message: `O atendimento #${String(row.ticketNumber).padStart(5, '0')} está em atendimento pela equipe VYBE.` }).catch(() => undefined);
  response.json({ assigned: true, id: String(row._id), status: row.status, assignedTo: { displayName: actor.displayName, username: actor.username } });
});

platformRouter.patch('/platform/admin/support/tickets/:ticketId/status', requireGlobal, requireSupportOwner, async (request, response) => {
  const status = request.body?.status as SupportTicketStatus; const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim().slice(0, 1000) : '';
  if (!mongoose.isValidObjectId(request.params.ticketId) || !(supportTicketStatuses as readonly string[]).includes(status) || status === 'RESPONDED') { fail(response, 400, 'Status inválido.'); return; }
  const now = new Date(); const actor = globalAccount(request);
  const before = await SupportTicket.findById(request.params.ticketId);
  if (!before) { fail(response, 404, 'Atendimento não encontrado.'); return; }
  if (before.status === status) { response.json({ id: String(before._id), status: visibleTicketStatus(before.status), resolvedAt: before.resolvedAt, closedAt: before.closedAt }); return; }
  const row = await SupportTicket.findByIdAndUpdate(request.params.ticketId, { $set: { status, resolvedAt: status === 'RESOLVED' ? now : status === 'CLOSED' ? before.resolvedAt : undefined, closedAt: status === 'CLOSED' ? now : undefined, unreadForUser: true }, $push: { history: { action: `status_${status.toLowerCase()}`, previousStatus: visibleTicketStatus(before.status), newStatus: status, actorAdminId: actor._id, reason, createdAt: now } } }, { new: true });
  if (!row) { fail(response, 404, 'Atendimento não encontrado.'); return; }
  if (row.createdByGlobalAccountId) await VybeNotification.create({ accountId: row.createdByGlobalAccountId, communityId: row.sourceCommunityId, supportTicketId: row._id, type: 'support_ticket', status: 'NEW', message: `O status do atendimento #${String(row.ticketNumber).padStart(5, '0')} foi atualizado para “${ticketStatusName(status)}”.` }).catch(() => undefined);
  else if (row.tenantId && row.requesterProfileId) {
    const community = await Community.findById(row.tenantId).select('_id name slug').lean();
    if (community) { const support = await ensurePlatformSupport(community as NonNullable<Request['vybeTenant']>); await Notification.create({ tenantId: row.tenantId, characterId: row.requesterProfileId, actorId: support._id, type: 'message', targetId: row.conversationId ?? row._id }).catch(() => undefined); }
  }
  response.json({ id: String(row._id), status: row.status, resolvedAt: row.resolvedAt });
});

platformRouter.post('/platform/admin/support/tickets/:ticketId/messages', requireGlobal, requireSupportOwner, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.ticketId)) { fail(response, 404, 'Atendimento não encontrado.'); return; }
  const content = typeof request.body?.content === 'string' ? request.body.content.trim() : '';
  const hasFiles = Array.isArray(request.body?.attachments) && request.body.attachments.length > 0;
  if ((!content && !hasFiles) || content.length > 4000) { fail(response, 400, 'Escreva uma mensagem ou anexe um arquivo.'); return; }
  const row: any = await SupportTicket.findById(request.params.ticketId) as any;
  if (!row || (!row.requesterProfileId && !row.createdByGlobalAccountId)) { fail(response, 404, 'Atendimento não encontrado.'); return; }
  if (!canReplyToSupportTicket(row.status)) { fail(response, 409, 'Este atendimento está somente para leitura. Reabra o protocolo antes de responder.'); return; }
  if (row.createdByGlobalAccountId) {
    const attachments = await collectSupportFiles(String(row._id), request.body?.attachments, response); if (!attachments) return;
    const message = await SupportTicketMessage.create({ ticketId: row._id, senderGlobalAccountId: globalAccount(request)._id, senderType: 'SUPPORT', content, attachments });
    if (row.createdByGlobalAccountId) await VybeNotification.create({ accountId: row.createdByGlobalAccountId, communityId: row.sourceCommunityId, supportTicketId: row._id, type: 'support_ticket', status: 'NEW', message: `VYBE Suporte respondeu ao atendimento #${String(row.ticketNumber).padStart(5, '0')}.` }).catch(() => undefined);
    const previousStatus = visibleTicketStatus(row.status); row.lastMessageAt = message.createdAt; row.lastMessagePreview = content.slice(0, 180) || 'Anexo enviado'; row.unreadForAdmin = false; row.unreadMessageCount = 0; row.unreadForUser = true; row.unreadMessageCountForUser = (row.unreadMessageCountForUser ?? 0) + 1; row.assignedToAdminId ??= globalAccount(request)._id; row.status = 'WAITING_USER'; if (previousStatus === 'RESOLVED') row.resolvedAt = undefined; row.history ??= []; row.history.push({ action: 'support_reply_sent', actorAdminId: globalAccount(request)._id, createdAt: new Date() }); if (previousStatus !== 'WAITING_USER') row.history.push({ action: 'status_waiting_user', previousStatus, newStatus: 'WAITING_USER', actorAdminId: globalAccount(request)._id, createdAt: new Date() }); await row.save();
    response.status(201).json(ticketMessageJson(message, String(row._id), 'ADMIN', { displayName: 'VYBE Suporte', username: 'suporte' })); return;
  }
  if (!row.tenantId || !row.conversationId) { fail(response, 409, 'Este atendimento antigo não possui uma conversa disponível.'); return; }
  const community = await Community.findById(row.tenantId).select('_id name slug').lean();
  if (!community) { fail(response, 404, 'O ambiente de atendimento não está disponível.'); return; }
  const support = await ensurePlatformSupport(community as NonNullable<Request['vybeTenant']>);
  const conversation = await Conversation.findOne({ _id: row.conversationId, tenantId: row.tenantId, kind: 'direct' });
  if (!conversation || !conversation.participants.some((participant) => participant.profileId.equals(support._id)) || (row.createdByGlobalAccountId && !conversation.platformParticipantAccountIds?.some((id) => id.equals(row.createdByGlobalAccountId)))) { fail(response, 409, 'A conversa institucional não está disponível.'); return; }
  const message = await ConversationMessage.create({ tenantId: row.tenantId, conversationId: conversation._id, senderProfileId: support._id, content, messageType: 'text' });
  conversation.lastMessageAt = message.createdAt; const participant = conversation.participants.find((item) => item.profileId.equals(support._id)); if (participant) participant.lastReadAt = message.createdAt; await conversation.save();
  if (row.requesterProfileId) await Notification.create({ tenantId: row.tenantId, characterId: row.requesterProfileId, actorId: support._id, type: 'message', targetId: message._id }).catch(() => undefined);
  if (row.createdByGlobalAccountId) await VybeNotification.create({ accountId: row.createdByGlobalAccountId, communityId: row.sourceCommunityId, supportTicketId: row._id, type: 'support_ticket', status: 'NEW', message: `VYBE Suporte respondeu ao atendimento #${String(row.ticketNumber).padStart(5, '0')}.` }).catch(() => undefined);
  emitToProfiles(row.tenantId.toString(), conversation.participants.filter((item) => !item.leftAt).map((item) => item.profileId), { type: 'message:new', conversationId: conversation._id.toString(), messageId: message._id.toString() });
  const previousStatus = visibleTicketStatus(row.status); row.lastMessageAt = message.createdAt; row.lastMessagePreview = content.slice(0, 180); row.unreadForAdmin = false; row.unreadMessageCount = 0; row.unreadForUser = true; row.unreadMessageCountForUser = (row.unreadMessageCountForUser ?? 0) + 1; row.assignedToAdminId ??= globalAccount(request)._id; row.status = 'WAITING_USER'; if (previousStatus === 'RESOLVED') row.resolvedAt = undefined; row.history ??= []; row.history.push({ action: 'support_reply_sent', actorAdminId: globalAccount(request)._id, createdAt: new Date() }); if (previousStatus !== 'WAITING_USER') row.history.push({ action: 'status_waiting_user', previousStatus, newStatus: 'WAITING_USER', actorAdminId: globalAccount(request)._id, createdAt: new Date() }); await row.save();
  response.status(201).json({ id: String(message._id), content, createdAt: message.createdAt, isSupport: true, sender: { displayName: support.displayName, username: support.username, platformIdentity: support.platformIdentity } });
});

platformRouter.get('/platform/admin/support/tickets/:ticketId/attachments/:storageName', requireGlobal, requireSupportOwner, async (request, response) => {
  const ticketId = String(request.params.ticketId); const storageName = String(request.params.storageName);
  if (!mongoose.isValidObjectId(ticketId)) { response.status(404).end(); return; }
  const ticket: any = await SupportTicket.findById(ticketId).select('_id').lean(); if (!ticket) { response.status(404).end(); return; }
  const message: any = await SupportTicketMessage.findOne({ ticketId: ticket._id, 'attachments.storageName': storageName }).select('attachments').lean();
  const attachment = message?.attachments?.find((item: any) => item.storageName === storageName);
  if (!attachment) { response.status(404).end(); return; }
  try { const file = await readSupportFile(String(ticket._id), storageName); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Content-Type', attachment.mimeType); response.setHeader('Content-Disposition', `${attachment.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`); response.send(file); } catch { response.status(404).end(); }
});

platformRouter.post('/platform/admin/support/tickets/:ticketId/notes', requireGlobal, requireSupportOwner, async (request, response) => {
  const content = typeof request.body?.content === 'string' ? request.body.content.trim() : '';
  if (!mongoose.isValidObjectId(request.params.ticketId) || content.length < 2 || content.length > 2000) { fail(response, 400, 'A nota deve ter entre 2 e 2000 caracteres.'); return; }
  const now = new Date(); const actor = globalAccount(request);
  const row = await SupportTicket.findByIdAndUpdate(request.params.ticketId, { $push: { internalNotes: { authorAdminId: actor._id, content, createdAt: now }, history: { action: 'internal_note_added', actorAdminId: actor._id, createdAt: now } } });
  if (!row) { fail(response, 404, 'Atendimento não encontrado.'); return; }
  response.status(201).json({ saved: true, createdAt: now });
});
async function savePhotoplayerImage(value: unknown, slug: string, maxBytes = 5 * 1024 * 1024) {
  if (typeof value !== 'string' || value.length > 7_000_000) throw new Error('Envie uma foto de até 5 MB.');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('A foto deve ser JPG, PNG ou WEBP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 16 || bytes.length > maxBytes) throw new Error(`A foto deve ter até ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
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
  const rows = await CommunityRequest.find({ status: 'pending', paymentRequired: { $ne: true } }).sort({ createdAt: 1 }).limit(100).lean();
  response.json(rows.map((row) => ({ id: String(row._id), rpgName: row.rpgName, slug: row.slug, description: row.description, status: row.status, createdAt: row.createdAt, sourceTenantSlug: row.sourceTenantSlug, applicant: { displayName: row.applicantName, username: row.applicantUsername }, photoUrl: `/api/platform/admin/community-requests/${String(row._id)}/photo` })));
});

platformRouter.get('/platform/admin/community-requests/:requestId/photo', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(404).end(); return; }
  const rowResult = await CommunityRequest.findOne({ _id: request.params.requestId, status: 'pending', paymentRequired: { $ne: true } }).select('sourceTenantSlug photoFilename').lean();
  const row = Array.isArray(rowResult) ? rowResult[0] : rowResult;
  if (!row || !/^[a-z0-9-]+$/.test(row.sourceTenantSlug) || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(row.photoFilename)) { response.status(404).end(); return; }
  response.sendFile(row.photoFilename, { root: resolve(uploadsDirectory, row.sourceTenantSlug) }, (error) => { if (error && !response.headersSent) response.status(404).end(); });
});

platformRouter.patch('/platform/admin/community-requests/:requestId', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const decision = request.body?.decision;
  if (decision !== 'approve' && decision !== 'reject') { fail(response, 400, 'Escolha aprovar ou recusar a solicitação.'); return; }
  const row = await CommunityRequest.findOne({ _id: request.params.requestId, status: 'pending', paymentRequired: { $ne: true } });
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

platformRouter.get('/platform/admin/community-creation-settings', requireGlobal, requirePlatformAdmin, async (_request, response) => {
  const settings = await PlatformProductSettings.findOne({ key: 'COMMUNITY_CREATION' }).lean();
  response.json({ amountCents: settings?.amountCents ?? DEFAULT_COMMUNITY_CREATION_PRICE_CENTS, currency: 'BRL' });
});

platformRouter.put('/platform/admin/community-creation-settings', requireGlobal, requirePlatformAdmin, async (request, response) => {
  const amountCents = request.body?.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 100_000_000) { fail(response, 400, 'Informe um preço válido em centavos.'); return; }
  const actor = globalAccount(request);
  const settings = await PlatformProductSettings.findOneAndUpdate({ key: 'COMMUNITY_CREATION' }, { $set: { amountCents, updatedByPlatformAdminId: actor._id } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
  response.json({ amountCents: settings.amountCents, currency: 'BRL' });
});

platformRouter.get('/platform/admin/community-creation-requests', requireGlobal, requirePlatformAdmin, async (request, response) => {
  const filter = String(request.query.filter ?? 'all');
  const query: Record<string, unknown> = { paymentRequired: true };
  if (filter === 'new') { query.paymentStatus = 'AWAITING_PAYMENT'; query.createdAt = { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }; }
  else if (filter === 'awaiting_payment') query.paymentStatus = 'AWAITING_PAYMENT';
  else if (filter === 'proof_sent') query.paymentStatus = 'PROOF_SENT';
  else if (filter === 'payment_issue') query.paymentStatus = 'PAYMENT_ISSUE';
  else if (filter === 'confirmed') query.paymentStatus = 'CONFIRMED';
  else if (filter === 'pending_approval') { query.paymentStatus = 'CONFIRMED'; query.status = 'pending'; }
  else if (filter === 'approved' || filter === 'rejected' || filter === 'cancelled') query.status = filter;
  else if (filter !== 'all') { fail(response, 400, 'Filtro inválido.'); return; }
  const rows: any[] = await CommunityRequest.find(query).sort({ createdAt: -1 }).limit(300).lean() as any;
  response.json(rows.map((row) => ({ id: String(row._id), rpgName: row.rpgName, slug: row.slug, description: row.description, category: row.category ?? '', status: row.status, paymentStatus: row.paymentStatus, amountCents: row.amountCents, currency: row.currency ?? 'BRL', createdAt: row.createdAt, updatedAt: row.updatedAt, applicant: { displayName: row.applicantName, username: row.applicantUsername, email: row.applicantEmail }, photoUrl: `/api/platform/admin/community-creation-requests/${String(row._id)}/photo`, logoUrl: row.logoFilename ? `/api/platform/admin/community-creation-requests/${String(row._id)}/logo` : '', proofs: ((row.paymentProofs ?? []) as CommunityPaymentProof[]).map((proof: CommunityPaymentProof) => ({ id: proof.id, mimeType: proof.mimeType, size: proof.size, uploadedAt: proof.uploadedAt, url: `/api/platform/admin/community-creation-requests/${String(row._id)}/proofs/${proof.id}` })), rejectionReason: row.rejectionReason, paymentIssueReason: row.paymentIssueReason, history: (row.history ?? []).map((event: CommunityRequestEvent) => ({ action: event.action, reason: event.reason ?? '', createdAt: event.createdAt, actorGlobalAccountId: event.actorGlobalAccountId ? String(event.actorGlobalAccountId) : '', actorPlatformAccountId: event.actorPlatformAccountId ? String(event.actorPlatformAccountId) : '' })), paymentConfirmedAt: row.paymentConfirmedAt ?? null, paymentConfirmedByPlatformId: row.paymentConfirmedByPlatformId ? String(row.paymentConfirmedByPlatformId) : '', createdCommunityId: row.createdCommunityId ? String(row.createdCommunityId) : null })));
});

async function resolveCommunityCreationSupport(row: InstanceType<typeof CommunityRequest>) {
  if (!row.characterId) return null;
  const community = await Community.findById(row.sourceTenantId).select('_id name slug').lean();
  const requester = await Character.findOne({ _id: row.characterId, tenantId: row.sourceTenantId }).select('_id').lean();
  if (!community || !requester) return null;
  const support = await ensurePlatformSupport(community as NonNullable<Request['vybeTenant']>);
  let conversation = row.supportConversationId
    ? await Conversation.findOne({ _id: row.supportConversationId, tenantId: row.sourceTenantId, kind: 'direct' })
    : null;
  const directKey = conversationDirectKey(requester._id, support._id);
  if (!conversation || !conversation.participants.some((participant) => participant.profileId.equals(requester._id)) || !conversation.participants.some((participant) => participant.profileId.equals(support._id))) {
    conversation = await Conversation.findOne({ tenantId: row.sourceTenantId, kind: 'direct', directKey });
  }
  if (!conversation) {
    try {
      conversation = await Conversation.create({ tenantId: row.sourceTenantId, kind: 'direct', directKey, createdBy: requester._id, participants: [{ profileId: requester._id, role: 'member' }, { profileId: support._id, role: 'member' }] });
    } catch (error) {
      conversation = await Conversation.findOne({ tenantId: row.sourceTenantId, kind: 'direct', directKey });
      if (!conversation) throw error;
    }
  }
  if (row.supportConversationId?.toString() !== conversation._id.toString()) {
    row.supportConversationId = conversation._id;
    row.history ??= [];
    row.history.push({ action: 'support_conversation_opened', createdAt: new Date() });
    await row.save();
  }
  return { community, requester, support, conversation };
}

platformRouter.get('/platform/admin/community-creation-requests/:requestId/support', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const row = await CommunityRequest.findOne({ _id: request.params.requestId, paymentRequired: true });
  if (!row) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const context = await resolveCommunityCreationSupport(row);
  if (!context) { fail(response, 409, 'Não foi possível localizar o perfil do solicitante para abrir o atendimento.'); return; }
  const messages = await ConversationMessage.find({ tenantId: row.sourceTenantId, conversationId: context.conversation._id, deletedAt: { $exists: false } }).sort({ createdAt: 1 }).limit(500).lean();
  const senderIds = [...new Set(messages.map((message) => message.senderProfileId.toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const senders = await Character.find({ tenantId: row.sourceTenantId, _id: { $in: senderIds } }).select('_id displayName username avatarUrl platformIdentity').lean();
  const senderById = new Map(senders.map((sender) => [String(sender._id), sender]));
  response.json({ conversationId: context.conversation._id.toString(), support: { displayName: context.support.displayName, username: context.support.username }, messages: messages.map((message) => ({ id: String(message._id), content: message.content, messageType: message.messageType, attachment: message.attachment, createdAt: message.createdAt, sender: senderById.get(message.senderProfileId.toString()) ?? null, isSupport: message.senderProfileId.equals(context.support._id) })) });
});

platformRouter.post('/platform/admin/community-creation-requests/:requestId/support/messages', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const content = typeof request.body?.content === 'string' ? request.body.content.trim() : '';
  if (!content || content.length > 4000) { fail(response, 400, 'A mensagem deve ter entre 1 e 4000 caracteres.'); return; }
  const row = await CommunityRequest.findOne({ _id: request.params.requestId, paymentRequired: true });
  if (!row) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const context = await resolveCommunityCreationSupport(row);
  if (!context) { fail(response, 409, 'Não foi possível localizar o perfil do solicitante para responder.'); return; }
  const message = await ConversationMessage.create({ tenantId: row.sourceTenantId, conversationId: context.conversation._id, senderProfileId: context.support._id, content, messageType: 'text' });
  context.conversation.lastMessageAt = message.createdAt;
  const supportParticipant = context.conversation.participants.find((participant) => participant.profileId.equals(context.support._id));
  if (supportParticipant) { supportParticipant.typingAt = undefined; supportParticipant.lastReadAt = message.createdAt; }
  await context.conversation.save();
  await Notification.create({ tenantId: row.sourceTenantId, characterId: context.requester._id, actorId: context.support._id, type: 'message', targetId: message._id });
  emitToProfiles(row.sourceTenantId.toString(), context.conversation.participants.filter((participant) => !participant.leftAt).map((participant) => participant.profileId), { type: 'message:new', conversationId: context.conversation._id.toString(), messageId: message._id.toString() });
  row.history ??= []; row.history.push({ action: 'support_message_sent', actorPlatformAccountId: globalAccount(request)._id, createdAt: new Date() }); await row.save();
  response.status(201).json({ id: String(message._id), content: message.content, messageType: message.messageType, createdAt: message.createdAt, sender: { id: context.support._id.toString(), displayName: context.support.displayName, username: context.support.username, avatarUrl: context.support.avatarUrl }, isSupport: true });
});

platformRouter.get('/platform/admin/community-creation-requests/:requestId/:asset', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(404).end(); return; }
  const row: any = await CommunityRequest.findOne({ _id: request.params.requestId, paymentRequired: true }).lean() as any;
  if (!row) { response.status(404).end(); return; }
  if (request.params.asset === 'photo' || request.params.asset === 'logo') {
    const filename = request.params.asset === 'photo' ? row.photoFilename : row.logoFilename;
    if (!filename || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(filename)) { response.status(404).end(); return; }
    response.setHeader('Cache-Control', 'private, no-store'); response.sendFile(filename, { root: resolve(uploadsDirectory, row.sourceTenantSlug) }, (error) => { if (error && !response.headersSent) response.status(404).end(); }); return;
  }
  response.status(404).end();
});

platformRouter.get('/platform/admin/community-creation-requests/:requestId/proofs/:proofId', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(404).end(); return; }
  const row: any = await CommunityRequest.findOne({ _id: request.params.requestId, paymentRequired: true }).lean() as any;
  const proof = (row?.paymentProofs as CommunityPaymentProof[] | undefined)?.find((item: CommunityPaymentProof) => item.id === request.params.proofId);
  if (!proof) { response.status(404).end(); return; }
  try { response.setHeader('Content-Type', proof.mimeType); response.setHeader('Content-Disposition', `inline; filename="comprovante-${proof.id}.${proof.filename.split('.').pop()}"`); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.send(await readPaymentProof(proof.filename)); } catch { response.status(404).end(); }
});

platformRouter.patch('/platform/admin/community-creation-requests/:requestId/payment', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const action = request.body?.action; const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim().slice(0, 1000) : '';
  const actor = globalAccount(request); const now = new Date();
  const row: any = await CommunityRequest.findOne({ _id: request.params.requestId, paymentRequired: true }).lean() as any;
  if (!row) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  if (action === 'confirm') {
    if (row.paymentStatus === 'CONFIRMED') { response.json({ id: String(row._id), paymentStatus: row.paymentStatus }); return; }
    if (row.status !== 'pending' || !(row.paymentProofs?.length)) { fail(response, 409, 'A solicitação precisa estar pendente e ter comprovante enviado.'); return; }
    const lastIssue = [...(row.history ?? [])].reverse().find((event: CommunityRequestEvent) => event.action === 'payment_not_identified');
    const latestProof = [...row.paymentProofs].sort((a: CommunityPaymentProof, b: CommunityPaymentProof) => b.uploadedAt.getTime() - a.uploadedAt.getTime())[0];
    if (lastIssue && new Date(latestProof.uploadedAt) <= new Date(lastIssue.createdAt)) { fail(response, 409, 'Aguarde o envio de um novo comprovante antes de confirmar.'); return; }
    const updated = await CommunityRequest.findOneAndUpdate({ _id: row._id, paymentRequired: true, status: 'pending', paymentStatus: { $in: ['AWAITING_PAYMENT', 'PROOF_SENT', 'PAYMENT_ISSUE'] }, 'paymentProofs.0': { $exists: true } }, { $set: { paymentStatus: 'CONFIRMED', paymentConfirmedAt: now, paymentConfirmedByPlatformId: actor._id, paymentIssueReason: '' }, $push: { history: { action: 'payment_confirmed', actorPlatformAccountId: actor._id, reason: `amountCents=${row.amountCents ?? 0};requestId=${row._id}`, createdAt: now } } }, { new: true });
    if (!updated) { const latest: any = await CommunityRequest.findById(row._id).select('paymentStatus').lean() as any; if (latest?.paymentStatus === 'CONFIRMED') { response.json({ id: String(row._id), paymentStatus: 'CONFIRMED' }); return; } fail(response, 409, 'O status da solicitação mudou. Atualize a página e tente novamente.'); return; }
    response.json({ id: String(updated._id), paymentStatus: updated.paymentStatus }); return;
  } else if (action === 'issue') {
    if (reason.length < 3 || row.status !== 'pending' || row.paymentStatus === 'CONFIRMED') { fail(response, 400, 'Informe o motivo do pagamento não identificado.'); return; }
    const updated = await CommunityRequest.findOneAndUpdate({ _id: row._id, paymentRequired: true, status: 'pending', paymentStatus: { $in: ['AWAITING_PAYMENT', 'PROOF_SENT'] } }, { $set: { paymentStatus: 'PAYMENT_ISSUE', paymentIssueReason: reason }, $push: { history: { action: 'payment_not_identified', actorPlatformAccountId: actor._id, reason, createdAt: now } } }, { new: true });
    if (!updated) { fail(response, 409, 'O status da solicitação mudou. Atualize a página e tente novamente.'); return; }
    if (updated.globalAccountId) await VybeNotification.create({ accountId: updated.globalAccountId, communityRequestId: updated._id, type: 'community_creation_update', status: 'PAYMENT_ISSUE', message: `Não conseguimos identificar o PIX de ${updated.rpgName}. Envie um novo comprovante ou fale com o suporte. ${reason}` });
    response.json({ id: String(updated._id), paymentStatus: updated.paymentStatus }); return;
  } else { fail(response, 400, 'Ação de pagamento inválida.'); return; }
});

platformRouter.patch('/platform/admin/community-creation-requests/:requestId/reject', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim().slice(0, 1000) : '';
  if (reason.length < 3) { fail(response, 400, 'Informe o motivo da recusa.'); return; }
  const actor = globalAccount(request); const reviewedAt = new Date(); const historyEntry = { action: 'request_rejected', actorPlatformAccountId: actor._id, reason, createdAt: reviewedAt };
  let row = await CommunityRequest.findOneAndUpdate({ _id: request.params.requestId, paymentRequired: true, status: 'pending', paymentStatus: { $ne: 'CONFIRMED' } }, { $set: { status: 'rejected', reviewedBy: actor._id, reviewedAt, rejectionReason: reason }, $push: { history: historyEntry } }, { new: true });
  if (!row) row = await CommunityRequest.findOneAndUpdate({ _id: request.params.requestId, paymentRequired: true, status: 'pending', paymentStatus: 'CONFIRMED' }, { $set: { status: 'rejected', paymentStatus: 'REFUND_REQUIRED', reviewedBy: actor._id, reviewedAt, rejectionReason: reason }, $push: { history: historyEntry } }, { new: true });
  if (!row) { fail(response, 404, 'Solicitação não encontrada ou já finalizada.'); return; }
  if (row.globalAccountId) await VybeNotification.create({ accountId: row.globalAccountId, communityRequestId: row._id, type: 'community_creation_update', status: 'REJECTED', message: `A solicitação de criação de ${row.rpgName} foi recusada: ${reason}` });
  response.json({ id: String(row._id), status: row.status, paymentStatus: row.paymentStatus });
});

platformRouter.patch('/platform/admin/community-creation-requests/:requestId/refund', requireGlobal, requirePlatformAdmin, async (request, response) => {
  const note = typeof request.body?.note === 'string' ? request.body.note.trim().slice(0, 1000) : '';
  if (!mongoose.isValidObjectId(request.params.requestId) || note.length < 3) { fail(response, 400, 'Informe a referência ou observação do reembolso.'); return; }
  const actor = globalAccount(request); const row = await CommunityRequest.findOneAndUpdate({ _id: request.params.requestId, paymentRequired: true, paymentStatus: 'REFUND_REQUIRED' }, { $set: { paymentStatus: 'REFUNDED', refundNote: note }, $push: { history: { action: 'refund_recorded', actorPlatformAccountId: actor._id, reason: note, createdAt: new Date() } } }, { new: true });
  if (!row) { fail(response, 404, 'Solicitação não encontrada ou sem reembolso pendente.'); return; }
  response.json({ id: String(row._id), paymentStatus: row.paymentStatus });
});

platformRouter.post('/platform/admin/community-creation-requests/:requestId/approve', requireGlobal, requirePlatformAdmin, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const actor = globalAccount(request); const row = await CommunityRequest.findOne({ _id: request.params.requestId, paymentRequired: true, status: 'pending', paymentStatus: 'CONFIRMED' });
  if (!row) { fail(response, 409, 'Confirme o pagamento antes de aprovar a criação.'); return; }
  if (await Community.exists({ $or: [{ slug: row.slug }, { subdomain: row.slug }] })) { fail(response, 409, 'O endereço desta comunidade já foi utilizado.'); return; }
  const destinationDirectory = resolve(uploadsDirectory, row.slug); const destinationPhoto = resolve(destinationDirectory, row.photoFilename); const destinationLogo = row.logoFilename ? resolve(destinationDirectory, row.logoFilename) : '';
  try {
    await ensureProvisioningCollections(); await mkdir(destinationDirectory, { recursive: true });
    await copyFile(resolve(uploadsDirectory, row.sourceTenantSlug, row.photoFilename), destinationPhoto);
    if (row.logoFilename && destinationLogo) await copyFile(resolve(uploadsDirectory, row.sourceTenantSlug, row.logoFilename), destinationLogo);
    const session = await mongoose.startSession(); let created: InstanceType<typeof Community> | undefined;
    try { await session.withTransaction(async () => {
      const pending = await CommunityRequest.findOne({ _id: row._id, status: 'pending', paymentRequired: true, paymentStatus: 'CONFIRMED' }).session(session);
      if (!pending || pending.createdCommunityId) throw new Error('Solicitação não encontrada ou já aprovada.');
      if (await Community.exists({ $or: [{ slug: pending.slug }, { subdomain: pending.slug }] }).session(session)) throw new Error('O endereço desta comunidade já foi utilizado.');
      created = await provisionApprovedCommunity(pending, actor._id, session);
      pending.status = 'approved'; pending.reviewedBy = actor._id; pending.reviewedAt = new Date(); pending.createdCommunityId = created._id;
      pending.history ??= []; pending.history.push({ action: 'community_created', actorPlatformAccountId: actor._id, reason: `communityId=${created._id}`, createdAt: new Date() }); await pending.save({ session });
    }); } finally { await session.endSession(); }
    if (!created) throw new Error('A aprovação não criou a comunidade.');
    response.json({ id: String(row._id), status: 'approved', communityId: String(created._id) });
  } catch (error) {
    // Keep copied request assets on failure: concurrent retries may be using the same deterministic filenames.
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { fail(response, 409, 'O endereço de comunidade já está em uso.'); return; }
    if (error instanceof Error && (error.message.includes('Solicitação não encontrada') || error.message.includes('endereço desta comunidade'))) { fail(response, 409, error.message); return; }
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
  const [payments, communityPurchases] = await Promise.all([
    VerificationRequest.find({ paymentStatus: 'confirmed', paymentConfirmedAt: { $gte: start, $lt: end }, amount: { $gt: 0 } }).sort({ paymentConfirmedAt: -1 }).lean(),
    CommunityRequest.find({ paymentRequired: true, paymentStatus: 'CONFIRMED', paymentConfirmedAt: { $gte: start, $lt: end }, amountCents: { $gt: 0 } }).sort({ paymentConfirmedAt: -1 }).lean(),
  ]);
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
    return { id: `vybe-plus:${item._id.toString()}`, kind: 'VYBE_PLUS' as const, product: 'VYBE Verificado', community: communityById.get(item.tenantId.toString()) ?? 'Comunidade removida', buyer: buyer ? { displayName: buyer.displayName, username: buyer.username } : null, beneficiary: beneficiary ? { displayName: beneficiary.displayName, username: beneficiary.username } : null, isGift: item.isGift ?? false, amount: item.amount, currency: item.currency, paymentConfirmedAt: item.paymentConfirmedAt };
  });
  const creationRows = communityPurchases.map((item) => ({ id: `community-creation:${String(item._id)}`, kind: 'COMMUNITY_CREATION' as const, product: 'Criação de comunidade', community: item.rpgName, buyer: { displayName: item.applicantName, username: item.applicantUsername }, beneficiary: null, isGift: false, amount: (item.amountCents ?? 0) / 100, currency: item.currency ?? 'BRL', paymentConfirmedAt: item.paymentConfirmedAt! }));
  const allPayments = [...rows, ...creationRows].sort((a, b) => new Date(b.paymentConfirmedAt).getTime() - new Date(a.paymentConfirmedAt).getTime());
  const totalAmount = Math.round(allPayments.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  response.json({ month, count: allPayments.length, totalAmount, currency: 'BRL', payments: allPayments });
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
  const tenantId = request.vybeTenant?._id;
  const tenantCookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('vybe_session='));
  const tenantToken = tenantCookie ? decodeURIComponent(tenantCookie.slice('vybe_session='.length)) : '';
  if (tenantId && tenantToken) {
    const tenantSession = await Session.findOne({ tenantId, tokenHash: createHash('sha256').update(tenantToken).digest('hex') }).select('characterId').lean();
    if (tenantSession) disconnectProfile(tenantId.toString(), tenantSession.characterId.toString());
    await Session.deleteOne({ tenantId, tokenHash: createHash('sha256').update(tenantToken).digest('hex') });
  }
  if (token) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const globalSession: any = await VybeSession.findOne({ tokenHash }).select('accountId').lean();
    if (globalSession) {
      const globalAccount: any = await VybeAccount.findById(globalSession.accountId).select('email').lean();
      const accounts = await Account.find({ $or: [{ globalAccountId: globalSession.accountId }, ...(globalAccount?.email ? [{ email: globalAccount.email }] : [])] }).select('_id').lean();
      const profileIds = accounts.length ? await Character.find({ accountId: { $in: accounts.map((account) => account._id) } }).select('tenantId _id').lean() : [];
      for (const profile of profileIds) disconnectProfile(profile.tenantId.toString(), profile._id.toString());
    }
    await VybeSession.deleteOne({ tokenHash });
  }
  clearGlobalCookie(response);
  response.setHeader('Set-Cookie', [...(Array.isArray(response.getHeader('Set-Cookie')) ? response.getHeader('Set-Cookie') as string[] : response.getHeader('Set-Cookie') ? [String(response.getHeader('Set-Cookie'))] : []), `vybe_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`]);
  response.status(204).end();
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

platformRouter.get('/community-creation/settings', requireGlobal, async (_request, response) => {
  const settings = await PlatformProductSettings.findOne({ key: 'COMMUNITY_CREATION' }).lean();
  response.json({ amountCents: settings?.amountCents ?? DEFAULT_COMMUNITY_CREATION_PRICE_CENTS, currency: 'BRL' });
});

platformRouter.get('/community-requests', requireGlobal, async (request, response) => {
  const account = globalAccount(request);
  const rows = await CommunityRequest.find({ $or: [
    { globalAccountId: account._id },
    { applicantEmail: account.email },
  ] }).sort({ createdAt: -1 }).limit(20).lean();
  response.json(rows.map((row) => ({
    id: String(row._id), rpgName: row.rpgName, slug: row.slug,
    description: row.description, category: row.category ?? '', status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
    paymentRequired: row.paymentRequired === true, amountCents: row.amountCents ?? 0, currency: row.currency ?? 'BRL', paymentStatus: row.paymentStatus ?? '', rejectionReason: row.rejectionReason ?? '', paymentIssueReason: row.paymentIssueReason ?? '', createdCommunityId: row.createdCommunityId ? String(row.createdCommunityId) : '',
    photoUrl: `/api/community-requests/${String(row._id)}/photo`, logoUrl: row.logoFilename ? `/api/community-requests/${String(row._id)}/logo` : '',
  })));
});

platformRouter.get('/community-requests/:requestId/payment-info', requireGlobal, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const account = globalAccount(request); const row = await CommunityRequest.findOne({ _id: request.params.requestId, globalAccountId: account._id, paymentRequired: true });
  if (!row) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  if (!row.history?.some((event: CommunityRequestEvent) => event.action === 'payment_instructions_presented')) await CommunityRequest.updateOne({ _id: row._id, history: { $not: { $elemMatch: { action: 'payment_instructions_presented' } } } }, { $push: { history: { action: 'payment_instructions_presented', actorGlobalAccountId: account._id, createdAt: new Date() } } });
  const pix = await PlatformPaymentSettings.findOne({ key: 'VYBE_PLUS_PIX' }).lean();
  response.json({ id: String(row._id), rpgName: row.rpgName, status: row.status, paymentStatus: row.paymentStatus, paymentIssueReason: row.paymentIssueReason ?? '', amountCents: row.amountCents, currency: row.currency ?? 'BRL', pix: pix ? { pixKey: pix.pixKey, pixKeyType: pix.pixKeyType, recipientName: pix.recipientName, qrCodeDataUrl: pix.qrCodeDataUrl ?? '' } : null, proofs: ((row.paymentProofs ?? []) as CommunityPaymentProof[]).map((proof: CommunityPaymentProof) => ({ id: proof.id, uploadedAt: proof.uploadedAt })) });
});

platformRouter.post('/community-requests/:requestId/payment-proof', requireGlobal, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const account = globalAccount(request); const row = await CommunityRequest.findOne({ _id: request.params.requestId, globalAccountId: account._id, status: 'pending', paymentRequired: true, paymentStatus: { $in: ['AWAITING_PAYMENT', 'PAYMENT_ISSUE'] } });
  if (!row) { fail(response, 409, 'Esta solicitação não aceita um novo comprovante.'); return; }
  let parsed; try { parsed = parsePaymentProof(request.body?.proof); } catch (error) { fail(response, 400, error instanceof Error ? error.message : 'Comprovante inválido.'); return; }
  const saved = await savePaymentProof(parsed.bytes, parsed.extension); const now = new Date();
  try {
    const updated = await CommunityRequest.findOneAndUpdate({ _id: row._id, globalAccountId: account._id, status: 'pending', paymentRequired: true, paymentStatus: { $in: ['AWAITING_PAYMENT', 'PAYMENT_ISSUE'] } }, { $set: { paymentStatus: 'PROOF_SENT', paymentIssueReason: '' }, $push: { paymentProofs: { ...saved, mimeType: parsed.mimeType, size: parsed.bytes.byteLength, uploadedByGlobalAccountId: account._id, uploadedAt: now }, history: { action: 'payment_proof_uploaded', actorGlobalAccountId: account._id, createdAt: now } } }, { new: true });
    if (!updated) { await rm(resolve(dirname(fileURLToPath(import.meta.url)), '../../private/vybe-plus-proofs', saved.filename), { force: true }).catch(() => undefined); fail(response, 409, 'O status da solicitação mudou. Atualize a página e tente novamente.'); return; }
    response.status(201).json({ id: String(updated._id), paymentStatus: updated.paymentStatus, message: 'Comprovante recebido! A equipe VYBE está analisando seu pagamento.' });
  } catch (error) { await rm(resolve(dirname(fileURLToPath(import.meta.url)), '../../private/vybe-plus-proofs', saved.filename), { force: true }).catch(() => undefined); throw error; }
});

platformRouter.patch('/community-requests/:requestId/cancel', requireGlobal, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const account = globalAccount(request); const now = new Date(); const row = await CommunityRequest.findOneAndUpdate({ _id: request.params.requestId, globalAccountId: account._id, paymentRequired: true, status: 'pending', paymentStatus: { $ne: 'CONFIRMED' } }, { $set: { status: 'cancelled' }, $push: { history: { action: 'request_cancelled', actorGlobalAccountId: account._id, createdAt: now } } }, { new: true });
  if (!row) { fail(response, 409, 'Esta solicitação não pode ser cancelada.'); return; }
  response.json({ id: String(row._id), status: row.status });
});

platformRouter.get('/community-requests/:requestId/photo', requireGlobal, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(404).end(); return; }
  const account = globalAccount(request);
  const row = await CommunityRequest.findOne({ _id: request.params.requestId, $or: [
    { globalAccountId: account._id },
    { applicantEmail: account.email },
  ] });
  if (!row || !/^[a-z0-9-]+$/.test(row.sourceTenantSlug) || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(row.photoFilename)) { response.status(404).end(); return; }
  response.setHeader('Cache-Control', 'private, no-store'); response.sendFile(row.photoFilename, { root: resolve(uploadsDirectory, row.sourceTenantSlug) }, (error) => {
    if (error && !response.headersSent) response.status(404).end();
  });
});

platformRouter.get('/community-requests/:requestId/logo', requireGlobal, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.requestId)) { response.status(404).end(); return; }
  const account = globalAccount(request); const row: any = await CommunityRequest.findOne({ _id: request.params.requestId, globalAccountId: account._id }).select('sourceTenantSlug logoFilename').lean() as any;
  if (!row?.logoFilename || !/^[a-z0-9-]+$/.test(row.sourceTenantSlug)) { response.status(404).end(); return; }
  response.setHeader('Cache-Control', 'private, no-store'); response.sendFile(row.logoFilename, { root: resolve(uploadsDirectory, row.sourceTenantSlug) }, (error) => { if (error && !response.headersSent) response.status(404).end(); });
});

platformRouter.post('/community-requests', requireGlobal, async (request, response) => {
  const account = globalAccount(request);
  const rpgName = typeof request.body?.rpgName === 'string' ? request.body.rpgName.trim() : '';
  const description = typeof request.body?.description === 'string' ? request.body.description.trim() : '';
  const category = typeof request.body?.category === 'string' ? request.body.category.trim().slice(0, 60) : '';
  const photo = typeof request.body?.photo === 'string' ? request.body.photo : '';
  const logo = typeof request.body?.logo === 'string' ? request.body.logo : '';
  if (request.body?.confirmed !== true) { fail(response, 400, 'Confirme os dados e as condições da criação.'); return; }
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
  let savedLogo: { filename: string; extension: 'png' | 'jpg' | 'webp' } | undefined;
  try {
    if (logo) savedLogo = await savePhotoplayerImage(logo, sourceTenant.slug, 1 * 1024 * 1024);
    const setting = await PlatformProductSettings.findOne({ key: 'COMMUNITY_CREATION' }).lean();
    const amountCents = setting?.amountCents ?? DEFAULT_COMMUNITY_CREATION_PRICE_CENTS;
    const row = await CommunityRequest.create({
      sourceTenantId: sourceTenant._id, sourceTenantSlug: sourceTenant.slug,
      globalAccountId: account._id, applicantEmail: account.email,
      applicantName: account.displayName, applicantUsername: account.username,
      rpgName, slug, description, category, photoFilename: filename, photoExtension: extension,
      ...(savedLogo ? { logoFilename: savedLogo.filename, logoExtension: savedLogo.extension } : {}),
      paymentRequired: true, amountCents, currency: 'BRL', paymentStatus: 'AWAITING_PAYMENT', status: 'pending',
      history: [{ action: 'request_created', actorGlobalAccountId: account._id, reason: `amountCents=${amountCents}`, createdAt: new Date() }],
    });
    response.status(201).json({ id: String(row._id), rpgName: row.rpgName, slug: row.slug, description: row.description, category: row.category, status: row.status, paymentRequired: true, paymentStatus: row.paymentStatus, amountCents: row.amountCents, currency: row.currency, createdAt: row.createdAt });
  } catch (error) {
    await rm(resolve(sourceDirectory, filename), { force: true });
    if (savedLogo) await rm(resolve(sourceDirectory, savedLogo.filename), { force: true });
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
  fail(response, 403, 'Preencha a ficha de entrada para acessar esta comunidade.'); return;
});

platformRouter.post('/communities/:slug/join-requests', requireGlobal, async (request, response) => {
  const community: any = await Community.findOne({ slug: request.params.slug, status: 'active', type: 'public' });
  if (!community) { fail(response, 404, 'Comunidade não encontrada.'); return; }
  const approvalRequired = requiresJoinApproval(community);
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
  if (oldRequest?.status === 'APPROVED' || (approvalRequired && oldRequest?.status === 'PENDING')) { fail(response, 409, oldRequest.status === 'PENDING' ? 'Sua solicitação já aguarda análise.' : 'Sua entrada já foi aprovada.'); return; }
  if (await Character.exists({ tenantId: community._id, username })) { fail(response, 409, 'Este username já está em uso nesta comunidade.'); return; }
  if (await Character.exists({ tenantId: community._id, normalizedPhotoplayerName })) { fail(response, 409, 'Este photoplayer já está em uso nesta comunidade.'); return; }
  const duplicate = await CommunityJoinRequest.exists({ communityId: community._id, vybeAccountId: { $ne: account._id }, status: { $in: ['PENDING', 'NEEDS_INFORMATION'] }, $or: [{ normalizedUsername: username }, { normalizedPhotoplayerName }] });
  if (duplicate) { fail(response, 409, 'Username ou photoplayer já está reservado em outra solicitação.'); return; }
  let image: { filename: string; extension: 'png' | 'jpg' | 'webp' };
  if (typeof body.photoplayerImage === 'string' && body.photoplayerImage) { try { image = await savePhotoplayerImage(body.photoplayerImage, community.slug); } catch (error) { fail(response, 400, error instanceof Error ? error.message : 'Não foi possível validar a foto.'); return; } }
  else if (oldRequest?.status === 'NEEDS_INFORMATION' && !oldRequest.requestedChanges.includes('photoplayer')) image = { filename: oldRequest.photoplayerImageFilename, extension: oldRequest.photoplayerImageExtension };
  else { fail(response, 400, 'Envie a foto do photoplayer.'); return; }
  const record = { communityId: community._id, communitySlug: community.slug, accountId: account._id, vybeAccountId: account._id, characterName, requestedUsername: username, normalizedUsername: username, characterAge: age, photoplayerName, normalizedPhotoplayerName, photoplayerImageFilename: image.filename, photoplayerImageExtension: image.extension, characterDescription: description, customAnswers, status: approvalRequired ? 'PENDING' as const : 'APPROVED' as const, requestedChanges: [], adminMessage: '', rejectionReason: '', reviewedAt: undefined, reviewedBy: undefined };
  const row = oldRequest ? Object.assign(oldRequest, record) : new CommunityJoinRequest(record);
  if (!approvalRequired) {
    let createdAccountId: mongoose.Types.ObjectId | undefined;
    let createdCharacterId: mongoose.Types.ObjectId | undefined;
    let memberCountIncremented = false;
    try {
      const localAccount = await Account.create({ tenantId: community._id, globalAccountId: account._id, email: account.email, passwordHash: hashPassword(randomBytes(64).toString('hex')), status: 'active', termsAcceptedAt: account.termsAcceptedAt, termsVersion: account.termsVersion, privacyAcceptedAt: account.privacyAcceptedAt, privacyVersion: account.privacyVersion });
      createdAccountId = localAccount._id;
      const imageUrl = `/media/${community.slug}/${image.filename}`;
      const localCharacter = await Character.create({ tenantId: community._id, accountId: localAccount._id, username, displayName: characterName, age, photoplayerName, normalizedPhotoplayerName, photoplayerImageUrl: imageUrl, avatarUrl: imageUrl, bio: description });
      createdCharacterId = localCharacter._id;
      community.memberCount += 1;
      await community.save();
      memberCountIncremented = true;
      await row.save();
    } catch (error) {
      if (createdCharacterId) await Character.deleteOne({ _id: createdCharacterId, tenantId: community._id });
      if (memberCountIncremented) { community.memberCount = Math.max(0, community.memberCount - 1); await community.save(); }
      if (createdAccountId) await Account.deleteOne({ _id: createdAccountId, tenantId: community._id });
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { fail(response, 409, 'O username ou photoplayer entrou em conflito com outro perfil. Revise a ficha e tente novamente.'); return; }
      throw error;
    }
  } else await row.save();
  response.status(201).json(requestJson(row, `/api/community-join-requests/${row._id}/photo`));
});

platformRouter.get('/my/community-join-requests', requireGlobal, async (request, response) => {
  const rows = await CommunityJoinRequest.find({ vybeAccountId: globalAccount(request)._id }).sort({ updatedAt: -1 }).limit(50).lean();
  response.json(rows.map((row) => ({ ...row, id: String(row._id), communityId: String(row.communityId), photoUrl: `/api/community-join-requests/${String(row._id)}/photo` })));
});

platformRouter.get('/notifications', requireGlobal, async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const rows = await VybeNotification.find({ accountId: globalAccount(request)._id, type: { $ne: 'community_join_update' } }).sort({ createdAt: -1 }).limit(30).lean();
  const communities = await Community.find({ _id: { $in: rows.flatMap((row) => row.communityId ? [row.communityId] : []) } }).select('name slug').lean();
  const communityMap = new Map(communities.map((item) => [String(item._id), { name: item.name, slug: item.slug }]));
  response.json(rows.map((row) => ({ id: String(row._id), type: row.type, status: row.status, message: row.message, targetId: row.communityRequestId?.toString() ?? row.supportTicketId?.toString() ?? '', supportTicketId: row.supportTicketId?.toString() ?? null, createdAt: row.createdAt, verificationRequestId: row.verificationRequestId?.toString() ?? null, communityName: communityMap.get(String(row.communityId))?.name ?? 'Comunidade', communitySlug: communityMap.get(String(row.communityId))?.slug ?? '' })));
});

platformRouter.delete('/notifications', requireGlobal, async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const result = await VybeNotification.deleteMany({ accountId: globalAccount(request)._id });
  response.json({ deleted: result.deletedCount });
});

platformRouter.get('/community-join-requests/:id/photo', requireGlobal, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.id)) { response.status(404).end(); return; }
  const row: any = await CommunityJoinRequest.findOne({ _id: request.params.id, vybeAccountId: globalAccount(request)._id }).select('communitySlug photoplayerImageFilename').lean();
  if (!row || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(row.photoplayerImageFilename)) { response.status(404).end(); return; }
  response.sendFile(row.photoplayerImageFilename, { root: resolve(uploadsDirectory, row.communitySlug) }, (error) => { if (error && !response.headersSent) response.status(404).end(); });
});
