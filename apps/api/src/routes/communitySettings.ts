import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { Community, type CommunityDocument } from '../models/Community.js';
import { CommunityAudit } from '../models/CommunityAudit.js';
import { Account, Character, CommunityEvent } from '../models/Social.js';
import { AcademicRole } from '../models/Academic.js';
import { NewsRole } from '../models/News.js';
import { CommunitySanction } from '../models/CommunitySanction.js';
import { isCommunityOwner, sanctionEndDate } from './communityAdminPolicy.js';

export const communitySettingsRouter = Router();
const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads');
type SettingsRole = 'owner' | 'admin' | 'moderator';

function tenant(request: Request) { return request.vybeTenant!; }
function account(request: Request) { return request.vybeAccount!; }
function ownerId(value: CommunityDocument) { return value.ownerAccountId ?? value.admins[0]; }
function roleFor(request: Request): SettingsRole | null {
  const community = tenant(request);
  const user = account(request);
  const configuredPlatformAdmin = community.slug === (process.env.VYBE_PLATFORM_TENANT_SLUG ?? 'community')
    && (process.env.VYBE_PLATFORM_ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean).includes(user.email.toLowerCase());
  if (isCommunityOwner(community, user)) return 'owner';
  if (community.admins.some((id) => id.equals(user._id)) || configuredPlatformAdmin) return 'admin';
  if (community.moderators.some((id) => id.equals(user._id))) return 'moderator';
  return null;
}
function deny(response: Response) { response.status(403).json({ error: 'Somente o Owner desta comunidade pode acessar as configurações.' }); }
function audit(request: Request, action: string, details: Record<string, unknown>) {
  return CommunityAudit.create({ tenantId: tenant(request)._id, actorId: account(request)._id, action, details });
}
function asString(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function sendError(response: Response, status: number, error: string) { response.status(status).json({ error }); }

async function saveImage(value: unknown, slug: string) {
  if (typeof value !== 'string' || value.length > 3_000_000) throw new Error('A imagem deve ter no máximo 2 MB.');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Envie uma imagem PNG, JPEG ou WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 2 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 2 MB.');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const valid = ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : ext === 'jpg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new Error('O arquivo escolhido não corresponde a uma imagem válida.');
  const filename = `${randomBytes(16).toString('hex')}.${ext}`;
  await mkdir(resolve(uploadsDirectory, slug), { recursive: true });
  await writeFile(resolve(uploadsDirectory, slug, filename), bytes, { flag: 'wx', mode: 0o600 });
  return `/media/${slug}/${filename}`;
}

communitySettingsRouter.get('/settings/community', async (request, response) => {
  const role = roleFor(request);
  if (role !== 'owner') { deny(response); return; }
  const community = tenant(request);
  const admins = await Account.find({ tenantId: community._id, _id: { $in: community.admins } }).select('email').lean();
  const moderators = await Account.find({ tenantId: community._id, _id: { $in: community.moderators } }).select('email').lean();
  const staffIds = [...community.admins, ...community.moderators];
  const characters = await Character.find({ tenantId: community._id, accountId: { $in: staffIds } }).select('accountId displayName username').lean();
  const characterFor = (id: mongoose.Types.ObjectId) => characters.find((item) => item.accountId.equals(id));
  const logs = await CommunityAudit.find({ tenantId: community._id }).sort({ createdAt: -1 }).limit(30).lean();
  const pendingAccounts = await Account.find({ tenantId: community._id, status: 'pending' }).select('email createdAt').sort({ createdAt: 1 }).lean();
  const pendingCharacters = await Character.find({ tenantId: community._id, accountId: { $in: pendingAccounts.map((item) => item._id) } }).select('accountId displayName username bio avatarUrl').lean();
  const expiredSanctions = await CommunitySanction.find({ tenantId: community._id, status: 'active', endsAt: { $lte: new Date() } }).select('_id accountId').lean();
  if (expiredSanctions.length) {
    await Promise.all([
      CommunitySanction.updateMany({ _id: { $in: expiredSanctions.map((item) => item._id) }, tenantId: community._id, status: 'active' }, { $set: { status: 'expired' } }),
      Account.updateMany({ _id: { $in: expiredSanctions.map((item) => item.accountId) }, tenantId: community._id, status: 'disabled' }, { $set: { status: 'active' } }),
    ]);
  }
  const [activeMembers, activeAccounts, teachers, newsWriters, pendingEvents, pendingEventItems] = await Promise.all([
    Account.countDocuments({ tenantId: community._id, status: 'active' }),
    Account.find({ tenantId: community._id, status: 'active' }).select('_id createdAt').sort({ createdAt: -1 }).limit(200).lean(),
    AcademicRole.countDocuments({ tenantId: community._id, role: 'TEACHER', status: 'active' }),
    NewsRole.countDocuments({ tenantId: community._id, role: 'NEWS_WRITER', status: 'active' }),
    CommunityEvent.countDocuments({ tenantId: community._id, status: 'pending_approval' }),
    CommunityEvent.find({ tenantId: community._id, status: 'pending_approval' }).sort({ createdAt: 1 }).limit(4).lean(),
  ]);
  const activeCharacters = await Character.find({ tenantId: community._id, accountId: { $in: activeAccounts.map((item) => item._id) } }).select('accountId displayName username bio avatarUrl').lean();
  const activeSanctions = await CommunitySanction.find({ tenantId: community._id, status: 'active' }).sort({ createdAt: -1 }).lean();
  const sanctionedAccounts = await Account.find({ tenantId: community._id, _id: { $in: activeSanctions.map((item) => item.accountId) } }).select('email').lean();
  const sanctionedCharacters = await Character.find({ tenantId: community._id, accountId: { $in: activeSanctions.map((item) => item.accountId) } }).select('accountId displayName username avatarUrl').lean();
  const actors = await Account.find({ tenantId: community._id, _id: { $in: logs.map((item) => item.actorId) } }).select('email').lean();
  const actorEmails = new Map(actors.map((item) => [item._id.toString(), item.email]));
  response.json({
    role,
    community: {
      id: community._id.toString(), name: community.name, slug: community.slug, subdomain: community.subdomain,
      description: community.description, category: community.category, logoUrl: community.logoUrl, coverUrl: community.coverUrl, wallpaperUrl: community.wallpaperUrl ?? '',
      status: community.status, brand: community.brand, rules: community.rules, memberCount: community.memberCount,
      entry: community.entry, type: community.type, settings: community.settings,
    },
    metrics: { pendingMembers: pendingAccounts.length, teachers, newsWriters, pendingEvents, activeMembers, openReports: null },
    members: activeAccounts.map((item) => {
      const character = activeCharacters.find((person) => person.accountId.equals(item._id));
      return { accountId: item._id.toString(), joinedAt: item.createdAt, displayName: character?.displayName ?? 'Membro', username: character?.username ?? '', bio: character?.bio ?? '', avatarUrl: character?.avatarUrl ?? '' };
    }),
    pendingEvents: pendingEventItems.map((item) => ({ id: String(item._id), title: item.title, description: item.description, startsAt: item.startsAt, location: item.location, category: item.category, createdAt: item.createdAt })),
    sanctions: activeSanctions.map((item) => {
      const person = sanctionedCharacters.find((character) => character.accountId.equals(item.accountId));
      return { id: String(item._id), accountId: String(item.accountId), action: item.action, reason: item.reason, createdAt: item.createdAt, endsAt: item.endsAt ?? null, displayName: person?.displayName ?? sanctionedAccounts.find((entry) => entry._id.equals(item.accountId))?.email ?? 'Membro', username: person?.username ?? '', avatarUrl: person?.avatarUrl ?? '' };
    }),
    team: [
      ...community.admins.map((id) => ({ accountId: id.toString(), role: ownerId(community)?.equals(id) ? 'owner' : 'admin', email: admins.find((person) => person._id.equals(id))?.email ?? '', character: characterFor(id)?.displayName ?? '' })),
      ...community.moderators.map((id) => ({ accountId: id.toString(), role: 'moderator', email: moderators.find((person) => person._id.equals(id))?.email ?? '', character: characterFor(id)?.displayName ?? '' })),
    ],
    pendingMembers: pendingAccounts.map((item) => ({ accountId: item._id.toString(), email: item.email, createdAt: item.createdAt, character: pendingCharacters.find((person) => person.accountId.equals(item._id)) ?? null })),
    audit: logs.map((item) => ({ id: String(item._id), action: item.action, details: item.details, createdAt: item.createdAt, actorEmail: actorEmails.get(item.actorId.toString()) ?? 'Conta removida' })),
  });
});

communitySettingsRouter.post('/settings/community/members/:accountId', async (request, response) => {
  const role = roleFor(request);
  if (role !== 'owner') { deny(response); return; }
  if (!mongoose.isValidObjectId(request.params.accountId)) { sendError(response, 400, 'Solicitação inválida.'); return; }
  const decision = request.body?.decision;
  if (decision !== 'approve' && decision !== 'reject') { sendError(response, 400, 'Escolha aprovar ou recusar o pedido.'); return; }
  const rejectedReason = asString(request.body?.rejectedReason);
  if (decision === 'reject' && (rejectedReason.length < 3 || rejectedReason.length > 500)) { sendError(response, 400, 'Informe um motivo para recusar a solicitação.'); return; }
  const community = tenant(request);
  const member = await Account.findOne({ _id: request.params.accountId, tenantId: community._id, status: 'pending' });
  if (!member) { sendError(response, 404, 'Pedido pendente não encontrado nesta comunidade.'); return; }
  const character = await Character.findOne({ tenantId: community._id, accountId: member._id });
  if (decision === 'approve') {
    member.status = 'active';
    community.memberCount += 1;
    await Promise.all([member.save(), community.save()]);
  } else {
    member.status = 'disabled';
    await member.save();
  }
  await audit(request, `members.join.${decision}`, { targetAccountId: member._id.toString(), email: member.email, character: character?.displayName ?? '', ...(decision === 'reject' ? { rejectedReason } : {}) });
  response.json({ saved: true, decision });
});

communitySettingsRouter.post('/settings/community/members/:accountId/sanctions', async (request, response) => {
  if (roleFor(request) !== 'owner') { deny(response); return; }
  if (!mongoose.isValidObjectId(request.params.accountId)) { sendError(response, 400, 'Membro inválido.'); return; }
  const community = tenant(request);
  const target = await Account.findOne({ _id: request.params.accountId, tenantId: community._id, status: 'active' });
  if (!target) { sendError(response, 404, 'Membro ativo não encontrado nesta comunidade.'); return; }
  if (ownerId(community)?.equals(target._id)) { sendError(response, 400, 'A pessoa proprietária não pode ser suspensa ou banida.'); return; }
  const action = request.body?.action;
  const reason = asString(request.body?.reason);
  const durationDays = request.body?.durationDays;
  if (!['suspend', 'ban'].includes(action) || reason.length < 3 || reason.length > 500 || (durationDays !== null && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650))) { sendError(response, 400, 'Informe ação, motivo e duração válidos.'); return; }
  if (await CommunitySanction.exists({ tenantId: community._id, accountId: target._id, status: 'active' })) { sendError(response, 409, 'Este membro já possui uma suspensão ou banimento ativo.'); return; }
  const endsAt = sanctionEndDate(durationDays);
  const sanction = await CommunitySanction.create({ tenantId: community._id, accountId: target._id, action, status: 'active', reason, createdBy: account(request)._id, startsAt: new Date(), ...(endsAt ? { endsAt } : {}) });
  target.status = 'disabled';
  await target.save();
  await audit(request, action === 'ban' ? 'moderation.member.banned' : 'moderation.member.suspended', { accountId: target._id.toString(), sanctionId: sanction._id.toString(), reason, endsAt: endsAt?.toISOString() ?? null });
  response.status(201).json({ saved: true, sanctionId: sanction._id.toString() });
});

communitySettingsRouter.post('/settings/community/sanctions/:sanctionId/revoke', async (request, response) => {
  if (roleFor(request) !== 'owner') { deny(response); return; }
  if (!mongoose.isValidObjectId(request.params.sanctionId)) { sendError(response, 400, 'Registro inválido.'); return; }
  const community = tenant(request);
  const sanction = await CommunitySanction.findOne({ _id: request.params.sanctionId, tenantId: community._id, status: 'active' });
  if (!sanction) { sendError(response, 404, 'Banimento ativo não encontrado nesta comunidade.'); return; }
  sanction.status = 'revoked'; sanction.revokedBy = account(request)._id; sanction.revokedAt = new Date();
  const target = await Account.findOne({ _id: sanction.accountId, tenantId: community._id, status: 'disabled' });
  if (target) target.status = 'active';
  await Promise.all([sanction.save(), target?.save()]);
  await audit(request, 'moderation.sanction.revoked', { accountId: sanction.accountId.toString(), sanctionId: sanction._id.toString(), previousAction: sanction.action });
  response.json({ saved: true });
});

communitySettingsRouter.patch('/settings/community/:section', async (request, response) => {
  const role = roleFor(request);
  if (role !== 'owner') { deny(response); return; }
  const community = tenant(request);
  const body = request.body ?? {};
  const section = request.params.section;
  const changes: Record<string, unknown> = {};
  if (section === 'general') {
    const name = asString(body.name), description = asString(body.description), category = asString(body.category);
    if (name.length < 2 || name.length > 80 || description.length < 10 || description.length > 500 || category.length < 2 || category.length > 60) { sendError(response, 400, 'Revise nome (2–80), descrição (10–500) e categoria (2–60).'); return; }
    changes.name = community.name = name;
    changes.description = community.description = description;
    changes.category = community.category = category;
    if (body.logo !== undefined) { try { changes.logoUrl = community.logoUrl = await saveImage(body.logo, community.slug); } catch (error) { sendError(response, 400, error instanceof Error ? error.message : 'Logo inválida.'); return; } }
    if (body.cover !== undefined) { try { changes.coverUrl = community.coverUrl = await saveImage(body.cover, community.slug); } catch (error) { sendError(response, 400, error instanceof Error ? error.message : 'Capa inválida.'); return; } }
    if (body.wallpaper !== undefined) { try { changes.wallpaperUrl = community.wallpaperUrl = await saveImage(body.wallpaper, community.slug); } catch (error) { sendError(response, 400, error instanceof Error ? error.message : 'Wallpaper inválido.'); return; } }
  } else if (section === 'access') {
    const { visibility, approvalRequired, invitesEnabled, welcomeMessage } = body;
    if (!['public', 'private', 'controlled'].includes(visibility) || typeof approvalRequired !== 'boolean' || typeof invitesEnabled !== 'boolean' || typeof welcomeMessage !== 'string' || welcomeMessage.length > 500) { sendError(response, 400, 'Configurações de acesso inválidas.'); return; }
    community.settings.access = { visibility, approvalRequired, invitesEnabled, welcomeMessage: welcomeMessage.trim() };
    community.entry = approvalRequired || visibility === 'controlled' || visibility === 'private' ? 'approval' : 'open';
    changes.access = community.settings.access;
  } else if (section === 'characters') {
    const { usernameMinLength, usernameMaxLength, requireBio, customFields } = body;
    if (!Number.isInteger(usernameMinLength) || usernameMinLength < 3 || usernameMinLength > 24 || !Number.isInteger(usernameMaxLength) || usernameMaxLength < usernameMinLength || usernameMaxLength > 24 || typeof requireBio !== 'boolean' || !Array.isArray(customFields) || customFields.length > 12 || customFields.some((item: any) => !item || typeof item.key !== 'string' || !/^[a-z][a-z0-9_]{1,30}$/.test(item.key) || typeof item.label !== 'string' || item.label.trim().length < 2 || item.label.trim().length > 50 || typeof item.required !== 'boolean')) { sendError(response, 400, 'Configurações de personagens inválidas.'); return; }
    community.settings.characters = { usernameMinLength, usernameMaxLength, requireBio, customFields: customFields.map((item: any) => ({ key: item.key, label: item.label.trim(), required: item.required })) };
    changes.characters = community.settings.characters;
  } else if (section === 'features') {
    const keys = ['feed', 'pulse', 'stories', 'conversations', 'messages', 'events', 'match', 'bank', 'academic', 'career', 'news', 'companies'] as const;
    if (keys.some((key) => typeof body[key] !== 'boolean') || (body.eventCreation !== undefined && !['any_pending', 'staff', 'admins', 'owner'].includes(body.eventCreation))) { sendError(response, 400, 'Selecione estados e permissões válidas para os recursos.'); return; }
    community.settings.features = { ...community.settings.features, ...Object.fromEntries(keys.map((key) => [key, body[key]])), eventCreation: body.eventCreation ?? community.settings.features.eventCreation ?? 'any_pending' } as typeof community.settings.features;
    changes.features = community.settings.features;
  } else if (section === 'privacy') {
    const keys = ['showInDirectory', 'showMembers', 'showAdmins', 'publicContent'] as const;
    if (keys.some((key) => typeof body[key] !== 'boolean')) { sendError(response, 400, 'Configurações de privacidade inválidas.'); return; }
    community.settings.privacy = Object.fromEntries(keys.map((key) => [key, body[key]])) as typeof community.settings.privacy;
    changes.privacy = community.settings.privacy;
  } else if (section === 'moderation') {
    const { rules, requireReportReason, maxPostLength } = body;
    if (!Array.isArray(rules) || rules.length > 20 || rules.some((item: unknown) => typeof item !== 'string' || item.trim().length < 3 || item.trim().length > 300) || typeof requireReportReason !== 'boolean' || !Number.isInteger(maxPostLength) || maxPostLength < 100 || maxPostLength > 5000) { sendError(response, 400, 'Configurações de moderação inválidas.'); return; }
    community.settings.moderation = { rules: rules.map((item: string) => item.trim()), requireReportReason, maxPostLength };
    community.rules = community.settings.moderation.rules;
    changes.moderation = community.settings.moderation;
  } else if (section === 'appearance') {
    const { primary, dark, medium, light, soft } = body;
    const colors = [primary, dark, medium, light, soft];
    if (colors.some((value) => typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value))) { sendError(response, 400, 'Informe cores hexadecimais válidas.'); return; }
    community.brand = { ...community.brand, primary, dark, medium, soft, lilac: light, graphite: community.brand.graphite, white: '#FFFFFF' };
    changes.brand = community.brand;
  } else { sendError(response, 404, 'Seção de configuração não encontrada.'); return; }
  await community.save();
  await audit(request, `settings.${section}.updated`, changes);
  response.json({ saved: true, community: { id: community._id.toString(), name: community.name, status: community.status } });
});

communitySettingsRouter.post('/settings/community/team', async (request, response) => {
  if (roleFor(request) !== 'owner') { deny(response); return; }
  const community = tenant(request);
  const { operation, email, staffRole, accountId: targetId } = request.body ?? {};
  if (operation === 'add') {
    if (typeof email !== 'string' || !['admin', 'moderator'].includes(staffRole)) { sendError(response, 400, 'Informe e-mail e função válidos.'); return; }
    const target = await Account.findOne({ tenantId: community._id, email: email.trim().toLowerCase(), status: 'active' });
    if (!target) { sendError(response, 404, 'Não encontrei uma conta ativa com esse e-mail nesta comunidade.'); return; }
    if (ownerId(community)?.equals(target._id) && staffRole !== 'admin') { sendError(response, 400, 'O Owner não pode ser rebaixado para Moderator.'); return; }
    if (staffRole === 'admin') {
      if (!community.admins.some((id) => id.equals(target._id))) community.admins.push(target._id);
      community.moderators = community.moderators.filter((id) => !id.equals(target._id));
    } else {
      if (!community.moderators.some((id) => id.equals(target._id))) community.moderators.push(target._id);
      community.admins = community.admins.filter((id) => id.equals(ownerId(community)!) || !id.equals(target._id));
    }
    await community.save();
    await audit(request, 'team.member.added', { targetAccountId: target._id.toString(), role: staffRole });
  } else if (operation === 'remove') {
    if (typeof targetId !== 'string' || !mongoose.isValidObjectId(targetId)) { sendError(response, 400, 'Membro inválido.'); return; }
    const id = new mongoose.Types.ObjectId(targetId);
    if (ownerId(community)?.equals(id)) { sendError(response, 400, 'A propriedade não pode ser removida; transfira-a antes.'); return; }
    const wasAdmin = community.admins.some((item) => item.equals(id));
    const wasModerator = community.moderators.some((item) => item.equals(id));
    community.admins = community.admins.filter((item) => !item.equals(id));
    community.moderators = community.moderators.filter((item) => !item.equals(id));
    if (!wasAdmin && !wasModerator) { sendError(response, 404, 'Membro da equipe não encontrado.'); return; }
    await community.save();
    await audit(request, 'team.member.removed', { targetAccountId: id.toString(), previousRole: wasAdmin ? 'admin' : 'moderator' });
  } else { sendError(response, 400, 'Operação de equipe inválida.'); return; }
  response.json({ saved: true });
});

communitySettingsRouter.post('/settings/community/risk/transfer', async (request, response) => {
  const community = tenant(request);
  if (roleFor(request) !== 'owner') { deny(response); return; }
  const email = asString(request.body?.email).toLowerCase();
  if (request.body?.confirmation !== community.name) { sendError(response, 400, 'Digite o nome exato da comunidade para confirmar.'); return; }
  const target = await Account.findOne({ tenantId: community._id, email, status: 'active' });
  if (!target || target._id.equals(account(request)._id)) { sendError(response, 404, 'Informe o e-mail de outra conta ativa desta comunidade.'); return; }
  const previousOwnerId = ownerId(community);
  if (previousOwnerId && !previousOwnerId.equals(target._id)) community.admins = community.admins.filter((id) => !id.equals(previousOwnerId));
  if (!community.admins.some((id) => id.equals(target._id))) community.admins.push(target._id);
  community.ownerAccountId = target._id;
  community.ownerEmail = target.email;
  await community.save();
  await audit(request, 'risk.ownership.transferred', { previousOwnerId: previousOwnerId?.toString(), newOwnerId: target._id.toString() });
  response.json({ saved: true });
});

communitySettingsRouter.post('/settings/community/risk/suspend', async (request, response) => {
  const community = tenant(request);
  if (roleFor(request) !== 'owner') { deny(response); return; }
  if (community.slug === (process.env.VYBE_PLATFORM_TENANT_SLUG ?? 'community')) { sendError(response, 400, 'A comunidade principal da VYBE não pode ser suspensa por esta tela.'); return; }
  if (request.body?.confirmation !== community.name) { sendError(response, 400, 'Digite o nome exato da comunidade para confirmar.'); return; }
  community.status = 'suspended';
  await community.save();
  await audit(request, 'risk.community.suspended', { communityId: community._id.toString(), communityName: community.name });
  response.json({ saved: true, status: 'suspended' });
});

communitySettingsRouter.post('/settings/community/risk/request-deletion', async (request, response) => {
  const community = tenant(request);
  if (roleFor(request) !== 'owner') { deny(response); return; }
  if (request.body?.confirmation !== community.name || typeof request.body?.reason !== 'string' || request.body.reason.trim().length < 10) { sendError(response, 400, 'Confirme pelo nome exato e informe um motivo com pelo menos 10 caracteres.'); return; }
  await audit(request, 'risk.community.deletion.requested', { communityId: community._id.toString(), communityName: community.name, reason: request.body.reason.trim().slice(0, 500) });
  response.status(202).json({ saved: true, message: 'Solicitação de exclusão registrada para análise da plataforma.' });
});
