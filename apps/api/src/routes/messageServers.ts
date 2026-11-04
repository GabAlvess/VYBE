import { sanitizeFormattedText } from '@vybe/shared';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { Account, Character, Notification } from '../models/Social.js';
import { MessageServer, MessageServerCategory, MessageServerChannel, MessageServerMember, MessageServerMessage, MessageServerPost, MessageServerPostReply, type MessageServerAttachment, type MessageServerRole } from '../models/MessageServer.js';
import { allMessageServerPermissions, MessageServerAccessRequest, MessageServerAudit, MessageServerBan, MessageServerConfig, MessageServerCustomRole, MessageServerInvite, MessageServerRestriction, type MessageServerPermission } from '../models/MessageServerAdmin.js';
import { requireSession } from '../middleware/tenant.js';
import { emitToProfiles } from '../realtime/chatWebSocket.js';
import { canAccessMessageServerPrivateChannel, canGrantMessageServerPermissions, canManageMessageServerCustomRole, MESSAGE_SERVER_LEGACY_ADMIN_POSITION, canManageMessageServerHierarchy, canReorderMessageServerRoles, messageServerTopRolePosition, reorderedMessageServerRolePositions, validMessageServerColor, validMessageServerName, validMessageServerTag } from './messageServerPolicy.js';

export const messageServersRouter = Router();
messageServersRouter.use(requireSession);
messageServersRouter.use((request, response, next) => {
  if (request.vybeTenant!.settings?.features?.messages === false) { response.status(403).json({ error: 'Mensagens estão desativadas nesta comunidade.' }); return; }
  next();
});

const tenantId = (request: Request) => request.vybeTenant!._id;
const accountId = (request: Request) => request.vybeAccount!._id;
const profileId = (request: Request) => request.vybeCharacter!._id;
const validId = (value: unknown): value is string => typeof value === 'string' && mongoose.isValidObjectId(value);
const sendError = (response: Response, status: number, error: string) => response.status(status).json({ error });
const cleanCategoryName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

async function memberFor(request: Request, server: mongoose.Types.ObjectId) {
  return MessageServerMember.findOne({ tenantId: tenantId(request), serverId: server, accountId: accountId(request) }).lean();
}
async function authorizedServer(request: Request, rawId: unknown) {
  if (!validId(rawId)) return null;
  const serverId = new mongoose.Types.ObjectId(rawId);
  const [server, member] = await Promise.all([
    MessageServer.findOne({ _id: serverId, tenantId: tenantId(request), privacy: 'private' }).lean(),
    memberFor(request, serverId),
  ]);
  if (!server || !member) return null;
  const activeBan = await MessageServerBan.exists({ tenantId: tenantId(request), serverId, accountId: accountId(request), revokedAt: { $exists: false }, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] });
  if (activeBan && member.role !== 'owner') return null;
  return { server, member };
}
function serverRole(role: string | undefined): MessageServerRole | undefined {
  return role === 'owner' || role === 'admin' || role === 'member' ? role : undefined;
}
function serverJson(server: any, role: MessageServerRole, memberCount: number, permissions: MessageServerPermission[] = [], canManageProfile = role === 'owner') {
  return { id: server._id.toString(), name: server.name, description: server.description, iconUrl: server.iconUrl, privacy: server.privacy, role, permissions, canManageProfile, memberCount, createdAt: server.createdAt };
}
function channelJson(channel: any) {
  return { id: channel._id.toString(), serverId: channel.serverId.toString(), categoryId: channel.categoryId.toString(), name: channel.name, description: channel.description, kind: channel.kind, posting: channel.posting, repliesEnabled: channel.repliesEnabled !== false, position: channel.position ?? 0, isPrivate: Boolean(channel.isPrivate), allowedRoleIds: (channel.allowedRoleIds ?? []).map((id: mongoose.Types.ObjectId) => id.toString()), permissionOverrides:(channel.permissionOverrides??[]).map((item:any)=>({roleId:item.roleId?.toString?.()??null,permission:item.permission,state:item.state})) };
}
function canAccessChannel(member: any, channel: any, assignedRoles: Array<{ permissions?: string[] }> = []) { return !channel.isPrivate || canAccessMessageServerPrivateChannel(serverRole(member.role) ?? 'member', (member.roleIds ?? []).map((id: mongoose.Types.ObjectId) => id.toString()), (channel.allowedRoleIds ?? []).map((id: mongoose.Types.ObjectId) => id.toString()), assignedRoles.some((role) => role.permissions?.includes('view_private_channels'))); }
async function saveServerIcon(value: unknown, slug: string) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 3_000_000) throw new Error('Escolha um ícone PNG, JPG ou WebP de até 2 MB.');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('O ícone deve estar no formato PNG, JPG ou WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('O ícone deve ter até 2 MB.');
  const mime = match[1];
  const valid = mime === 'png'
    ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new Error('O conteúdo do arquivo não corresponde a um ícone válido.');
  const ext = mime === 'jpeg' ? 'jpg' : mime;
  // Keep profile images on the same tenant media route used by the rest of the app.
  const filename = `${randomBytes(16).toString('hex')}.${ext}`;
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads', slug);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, filename), bytes, { flag: 'wx', mode: 0o600 });
  return `/media/${slug}/${filename}`;
}

async function saveMessageServerFiles(value: unknown, slug: string, maxFiles = 5): Promise<MessageServerAttachment[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxFiles) throw new Error(`Envie no máximo ${maxFiles} arquivos.`);
  const output: MessageServerAttachment[] = [];
  const allowed = new Set(['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain']);
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') throw new Error('Anexo inválido.');
    const item = raw as Record<string, unknown>;
    if (typeof item.dataUrl !== 'string' || item.dataUrl.length > 7_200_000 || typeof item.name !== 'string') throw new Error('Anexo inválido ou maior que 5 MB.');
    const match = item.dataUrl.match(/^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match || !allowed.has(match[1].toLowerCase())) throw new Error('Formato de anexo não permitido.');
    const mimeType = match[1].toLowerCase(); const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Cada arquivo deve ter até 5 MB.');
    const valid = mimeType === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : mimeType === 'image/jpeg' ? bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff
      : mimeType === 'image/webp' ? bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'
      : mimeType === 'image/gif' ? ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString())
      : mimeType === 'application/pdf' ? bytes.subarray(0,5).toString()==='%PDF-'
      : !bytes.subarray(0,Math.min(bytes.length,4096)).includes(0);
    if (!valid) throw new Error('O conteúdo do arquivo não corresponde ao formato informado.');
    const extensions: Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','application/pdf':'pdf','text/plain':'txt'};
    const filename = `${randomBytes(18).toString('hex')}.${extensions[mimeType]}`;
    const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads', slug);
    await mkdir(directory, { recursive: true }); await writeFile(resolve(directory, filename), bytes, { flag: 'wx', mode: 0o600 });
    output.push({url:`/media/${slug}/message-${filename}`,name:item.name.trim().slice(0,180)||`arquivo.${extensions[mimeType]}`,mimeType,size:bytes.length});
  }
  return output;
}

function imageDimensions(bytes: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === 'png' && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (mime === 'jpeg') {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  if (mime === 'webp' && bytes.length >= 30) {
    const chunk = bytes.subarray(12, 16).toString();
    if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === 'VP8L' && bytes[20] === 0x2f) return { width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8), height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10)) };
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

const allServerPermissions: MessageServerPermission[] = [...allMessageServerPermissions];
const isStaff = (role: MessageServerRole | undefined) => role === 'owner' || role === 'admin';
async function hasServerPermission(member: any, serverId: mongoose.Types.ObjectId, permission: MessageServerPermission) {
  if (isStaff(serverRole(member.role))) return true;
  const roles = await MessageServerCustomRole.find({ tenantId: member.tenantId, serverId, _id: { $in: member.roleIds ?? [] } }).select('permissions').lean();
  return roles.some((role) => role.permissions.includes(permission));
}
function channelOverrideState(member:any,channel:any,permission:string):'allow'|'deny'|null{
  const assigned=(channel.permissionOverrides??[]).filter((item:any)=>item.permission===permission);
  const roleRules=assigned.filter((item:any)=>item.roleId&&(member.roleIds??[]).some((id:mongoose.Types.ObjectId)=>id.equals(item.roleId)));
  if(roleRules.some((item:any)=>item.state==='deny'))return'deny';
  if(roleRules.some((item:any)=>item.state==='allow'))return'allow';
  return assigned.find((item:any)=>!item.roleId)?.state??null;
}
async function hasChannelPermission(member: any, serverId: mongoose.Types.ObjectId, channel: any, permission: MessageServerPermission) {
  if (isStaff(serverRole(member.role))) return true;
  const roles = await MessageServerCustomRole.find({ tenantId: member.tenantId, serverId, _id: { $in: member.roleIds ?? [] } }).select('permissions').lean();
  const baseline = roles.some((role) => role.permissions.includes(permission));
  const override=channelOverrideState(member,channel,permission);if(override==='deny')return false;if(override==='allow')return true;
  return baseline;
}
async function hasAnyServerPermission(member: any, serverId: mongoose.Types.ObjectId, permissions: MessageServerPermission[]) {
  if (isStaff(serverRole(member.role))) return true;
  const roles = await MessageServerCustomRole.find({ tenantId: member.tenantId, serverId, _id: { $in: member.roleIds ?? [] } }).select('permissions').lean();
  return roles.some((role) => permissions.some((permission) => role.permissions.includes(permission)));
}
async function adminAccess(request: Request, response: Response, rawId: unknown, permission: MessageServerPermission) {
  const access = await authorizedServer(request, rawId);
  if (!access) { sendError(response, 404, 'Servidor não encontrado ou você não tem acesso.'); return null; }
  if (!await hasServerPermission(access.member, access.server._id, permission)) { sendError(response, 403, 'Você não tem permissão para esta ação.'); return null; }
  return access;
}
async function adminAccessAny(request: Request, response: Response, rawId: unknown, permissions: MessageServerPermission[]) {
  const access = await authorizedServer(request, rawId);
  if (!access) { sendError(response, 404, 'Servidor não encontrado ou você não tem acesso.'); return null; }
  if (!await Promise.all(permissions.map((permission) => hasServerPermission(access.member, access.server._id, permission))).then((values) => values.some(Boolean))) { sendError(response, 403, 'Você não tem permissão para esta ação.'); return null; }
  return access;
}
async function recordAudit(request: Request, server: mongoose.Types.ObjectId, action: string, targetId?: mongoose.Types.ObjectId, details: Record<string, unknown> = {}) {
  await MessageServerAudit.create({ tenantId: tenantId(request), serverId: server, actorAccountId: accountId(request), action, ...(targetId ? { targetId } : {}), details });
}
async function hierarchyAllows(request: Request, access: { member: any }, target: any) {
  if (target.role === 'owner' || target.accountId.equals(accountId(request))) return false;
  if (access.member.role === 'owner') return true;
  if (target.role === 'admin') return false;
  const ids = (access.member.roleIds ?? []).map((id: mongoose.Types.ObjectId) => id);
  const [actorRoles, targetRoles] = await Promise.all([
    MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.member.serverId, _id: { $in: ids } }).select('position').lean(),
    MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.member.serverId, _id: { $in: target.roleIds ?? [] } }).select('position').lean(),
  ]);
  const actorTop = Math.max(0, ...actorRoles.map((role) => role.position));
  const targetTop = Math.max(0, ...targetRoles.map((role) => role.position));
  return canManageMessageServerHierarchy(access.member.role, actorTop, target.role, targetTop, target.accountId.equals(accountId(request)));
}
const inviteHash = (token: string) => createHash('sha256').update(token).digest('hex');

async function publishWelcome(server: any, profile: any) {
  const config = await MessageServerConfig.findOne({ tenantId: server.tenantId, serverId: server._id }).lean();
  if (!config?.welcomeEnabled || !config.welcomeChannelId || !profile) return;
  const channel = await MessageServerChannel.findOne({ _id: config.welcomeChannelId, tenantId: server.tenantId, serverId: server._id, archivedAt: { $exists: false }, isPrivate: { $ne: true }, kind: { $ne: 'voice' }, posting: 'members' }).lean();
  if (!channel) return;
  const content = String(config.welcomeMessage ?? 'Boas-vindas ao {espaco}, {nome}!').replaceAll('{nome}', String(profile.displayName ?? profile.username ?? 'pessoa')).replaceAll('{espaco}', String(server.name));
  if (!content.trim() || content.length > 2000) return;
  const systemEventKey = `welcome:${profile.accountId?.toString?.() ?? profile._id.toString()}`;
  let created = false;
  try {
    const result = await MessageServerMessage.updateOne({ tenantId: server.tenantId, serverId: server._id, systemEventKey }, { $setOnInsert: { tenantId: server.tenantId, serverId: server._id, channelId: channel._id, authorAccountId: server.ownerAccountId, authorProfileId: server.ownerProfileId, authorName: 'VYBE Mensagens', authorUsername: 'vybe-mensagens', authorAvatarUrl: '', content, system: true, systemEventKey } }, { upsert: true, setDefaultsOnInsert: true });
    created = Boolean(result.upsertedCount);
  } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error; }
  if (created) {
    const recipients = await MessageServerMember.find({ tenantId: server.tenantId, serverId: server._id }).select('profileId').lean();
    emitToProfiles(server.tenantId.toString(), recipients.map((item) => item.profileId), { type: 'server:message', serverId: server._id.toString(), channelId: channel._id.toString() });
  }
}

function validWelcomeTemplate(value: string) {
  if (/[<>]/.test(value)) return false;
  const placeholders = value.match(/\{[^{}]*\}/g) ?? [];
  return placeholders.every((placeholder) => placeholder === '{nome}' || placeholder === '{espaco}') && !/[{}]/.test(value.replace(/\{(?:nome|espaco)\}/g, ''));
}

messageServersRouter.get('/:serverId/settings', async (request, response) => {
  const access = await authorizedServer(request, request.params.serverId);
  if (!access) { sendError(response, 404, 'Servidor não encontrado ou você não tem acesso.'); return; }
  const [config, memberCount, channelCount, categories, roles, owner, currentMembership, banCount, restrictedCount, roleCounts] = await Promise.all([
    MessageServerConfig.findOne({ tenantId: tenantId(request), serverId: access.server._id }).lean(),
    MessageServerMember.countDocuments({ tenantId: tenantId(request), serverId: access.server._id }),
    MessageServerChannel.countDocuments({ tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } }),
    MessageServerCategory.find({ tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } }).sort({ position: 1 }).lean(),
    MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id }).sort({ position: -1 }).lean(),
    Character.findOne({ _id: access.server.ownerProfileId, tenantId: tenantId(request) }).select('displayName username').lean(),
    MessageServerMember.findOne({ tenantId: tenantId(request), serverId: access.server._id, accountId: accountId(request) }).select('showTag roleIds').lean(),
    MessageServerBan.countDocuments({ tenantId: tenantId(request), serverId: access.server._id, revokedAt: { $exists: false }, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] }),
    MessageServerRestriction.countDocuments({ tenantId: tenantId(request), serverId: access.server._id, revokedAt: { $exists: false }, $or: [{ mutedUntil: { $exists: false } }, { mutedUntil: { $gt: new Date() } }] }),
    MessageServerMember.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([{ $match: { tenantId: tenantId(request), serverId: access.server._id } }, { $unwind: '$roleIds' }, { $group: { _id: '$roleIds', count: { $sum: 1 } } }]),
  ]);
  const actorRoleIds = ((currentMembership as any)?.roleIds ?? []).map((id: mongoose.Types.ObjectId) => id.toString());
  const actorTopPosition = messageServerTopRolePosition(access.member.role, roles.filter((role) => actorRoleIds.includes(role._id.toString())).map((role) => role.position));
  const roleCountMap = new Map(roleCounts.map((item) => [item._id.toString(), item.count]));
  const permissions = access.member.role === 'owner' || access.member.role === 'admin' ? allServerPermissions : roles.filter((role) => ((access.member as any).roleIds ?? []).some((id: mongoose.Types.ObjectId) => id.equals(role._id))).flatMap((role) => role.permissions);
  const canManageProfile = access.member.role === 'owner' || roles.some((role) => ((access.member as any).roleIds ?? []).some((id: mongoose.Types.ObjectId) => id.equals(role._id)) && role.permissions.includes('manage_server'));
  const channels = await MessageServerChannel.find({ tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } }).sort({ position: 1, createdAt: 1 }).lean();
  response.json({ server: { id: access.server._id.toString(), name: access.server.name, description: access.server.description, iconUrl: access.server.iconUrl, ownerProfileId: access.server.ownerProfileId.toString(), ownerName: owner?.displayName ?? owner?.username ?? 'Proprietário', actorAccountId: accountId(request).toString(), createdAt: access.server.createdAt, status: config?.archivedAt ? 'archived' : 'active', role: access.member.role, actorTopPosition, permissions, canManageProfile }, stats: { memberCount, channelCount, categoryCount: categories.length, banCount, restrictedCount }, config: { bannerUrl:'',accentColor:'#246B6E',publicInfo:'',theme:'',rules:'',tag:'',tagColor:'#246B6E',tagInsignia:'star',accessMode:'invite_only',rulesRequired:false,notifications:'mentions',allowGifs:true,allowAttachments:true,welcomeEnabled:false,welcomeMessage:'Boas-vindas ao {espaco}, {nome}!',startChannelMode:'last',defaultNotifications:'mentions',groupMembersByRole:false,showRoleColors:true,antiSpamEnabled:false,limitRepeatedLinks:true,...(config??{}),showTag:Boolean(currentMembership?.showTag) }, categories, channels: await MessageServerChannel.find({ tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } }).sort({ position: 1, createdAt: 1 }).lean(), roles: roles.map((role) => ({ ...role, memberCount: roleCountMap.get(role._id.toString()) ?? 0 })) });
});

messageServersRouter.patch('/:serverId/settings/tag-display', async (request, response) => {
  const access = await authorizedServer(request, request.params.serverId); if (!access) { sendError(response, 404, 'Servidor não encontrado ou você não tem acesso.'); return; }
  if (typeof request.body?.show !== 'boolean') { sendError(response, 400, 'Preferência inválida.'); return; }
  const config = await MessageServerConfig.findOne({ tenantId: tenantId(request), serverId: access.server._id }).lean();
  await MessageServerMember.updateOne({ tenantId: tenantId(request), serverId: access.server._id, accountId: accountId(request) }, { $set: { showTag: Boolean(request.body.show && config?.tag) } });
  response.json({ showTag: Boolean(request.body.show && config?.tag) });
});

messageServersRouter.patch('/:serverId/settings/profile', async (request, response) => {
  const access = await authorizedServer(request, request.params.serverId); if (!access) { sendError(response, 404, 'Servidor não encontrado ou você não tem acesso.'); return; }
  const delegated = access.member.role === 'owner' ? true : await MessageServerCustomRole.exists({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: (access.member as any).roleIds ?? [] }, permissions: 'manage_server' });
  if (!delegated) { sendError(response, 403, 'Somente o proprietário ou um cargo delegado pode alterar o perfil do servidor.'); return; }
  const body = request.body ?? {};
  if (!validMessageServerName(body.name) || typeof body.description !== 'string' || body.description.length > 240 || typeof body.publicInfo !== 'string' || body.publicInfo.length > 500 || typeof body.theme !== 'string' || body.theme.length > 60 || typeof body.rules !== 'string' || body.rules.length > 4000 || typeof body.profilePrivate !== 'boolean' || !/^#[0-9a-f]{6}$/i.test(body.accentColor)) { sendError(response, 400, 'Revise os campos do perfil do servidor.'); return; }
  if (body.icon !== undefined && body.icon !== null && body.icon !== '') {
    const match = typeof body.icon === 'string' ? body.icon.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/) : null;
    const bytes = match ? Buffer.from(match[2], 'base64') : Buffer.alloc(0);
    const dimensions = match ? imageDimensions(bytes, match[1]) : null;
    if (!dimensions || dimensions.width < 512 || dimensions.height < 512) { sendError(response, 400, 'O ícone do servidor deve ter pelo menos 512 × 512 pixels.'); return; }
  }
  let iconUrl: string; let bannerUrl: string;
  try { iconUrl = await saveServerIcon(body.icon, request.vybeTenant!.slug); bannerUrl = await saveServerIcon(body.banner, request.vybeTenant!.slug); }
  catch (error) { sendError(response, 400, error instanceof Error ? error.message : 'Imagem inválida.'); return; }
  const updates: Record<string, unknown> = { name: body.name.trim(), description: body.description.trim() };
  if (body.icon !== undefined) updates.iconUrl = iconUrl;
  await MessageServer.updateOne({ _id: access.server._id, tenantId: tenantId(request) }, { $set: updates });
  await MessageServerConfig.findOneAndUpdate({ tenantId: tenantId(request), serverId: access.server._id }, { $set: { publicInfo: body.publicInfo.trim(), theme: body.theme.trim(), rules: body.rules.trim(), profilePrivate: body.profilePrivate, accentColor: body.accentColor, ...(body.banner !== undefined ? { bannerUrl } : {}) } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await recordAudit(request, access.server._id, 'server.profile.updated', access.server._id, { name: body.name.trim() });
  response.json({ saved: true });
});

messageServersRouter.patch('/:serverId/settings/tag', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_server'); if (!access) return;
  const tag = typeof request.body?.tag === 'string' ? request.body.tag.trim().toUpperCase() : '';
  const color = request.body?.color;
  const insignia = request.body?.insignia;
  if (!validMessageServerTag(tag) || !validMessageServerColor(color) || typeof insignia !== 'string' || !['star','sparkles','forum','groups','favorite'].includes(insignia)) { sendError(response, 400, 'Tag, cor ou insígnia inválida.'); return; }
  const duplicate = tag ? await MessageServerConfig.exists({ tenantId: tenantId(request), tag, serverId: { $ne: access.server._id } }) : null;
  if (duplicate) { sendError(response, 409, 'Esta tag já está em uso neste espaço.'); return; }
  try { await MessageServerConfig.findOneAndUpdate({ tenantId: tenantId(request), serverId: access.server._id }, { $set: { tag, tagColor: color, tagInsignia: insignia } }, { upsert: true, setDefaultsOnInsert: true }); }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { sendError(response, 409, 'Esta tag já está em uso neste espaço.'); return; } throw error; }
  await recordAudit(request, access.server._id, 'server.tag.updated', access.server._id, { tag }); response.json({ saved: true });
});

messageServersRouter.get('/:serverId/members/profile/:profileId', async (request, response) => {
  const access = await authorizedServer(request, request.params.serverId);
  if (!access || !validId(request.params.profileId)) { sendError(response, 404, 'Participante não encontrado neste espaço.'); return; }
  const member = await MessageServerMember.findOne({ tenantId: tenantId(request), serverId: access.server._id, profileId: request.params.profileId }).lean();
  if (!member) { sendError(response, 404, 'Participante não encontrado neste espaço.'); return; }
  const [profile, allRoles] = await Promise.all([
    Character.findOne({ _id: member.profileId, tenantId: tenantId(request) }).select('displayName username avatarUrl age').lean(),
    MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id }).sort({ position: -1, _id: 1 }).select('name color icon position permissions').lean(),
  ]);
  if (!profile) { sendError(response, 404, 'Perfil não encontrado neste espaço.'); return; }
  const roleIds = ((member as any).roleIds ?? []).map((id: mongoose.Types.ObjectId) => id.toString());
  const assignedRoles = allRoles.filter((role) => roleIds.includes(role._id.toString())).map(({ _id, name, color, icon, position }) => ({ id: _id.toString(), name, color, icon, position }));
  const actorRoleIds = ((access.member as any).roleIds ?? []).map((id: mongoose.Types.ObjectId) => id.toString());
  const actorRoles = allRoles.filter((role) => actorRoleIds.includes(role._id.toString()));
  const actorTop = messageServerTopRolePosition(access.member.role, actorRoles.map((role) => role.position));
  const actorPermissions = access.member.role === 'owner' || access.member.role === 'admin' ? allServerPermissions : actorRoles.flatMap((role) => role.permissions);
  const canManageAssignments = await hasServerPermission(access.member, access.server._id, 'manage_roles') && await hierarchyAllows(request, access, member);
  const availableRoles = canManageAssignments ? allRoles.filter((role) => canManageMessageServerCustomRole(access.member.role, actorTop, role.position) && (roleIds.includes(role._id.toString()) || canGrantMessageServerPermissions(access.member.role, actorPermissions, role.permissions))).map(({ _id, name, color, icon, position, permissions }) => ({ id: _id.toString(), name, color, icon, position, assignable: canGrantMessageServerPermissions(access.member.role, actorPermissions, permissions) })) : [];
  response.json({ memberId: member._id.toString(), profileId: profile._id.toString(), isSelf: member.accountId.equals(accountId(request)), serverRole: member.role, profile: { displayName: profile.displayName, username: profile.username, avatarUrl: profile.avatarUrl, age: typeof profile.age === 'number' && Number.isInteger(profile.age) && profile.age >= 13 && profile.age <= 100 ? profile.age : null }, roles: assignedRoles, availableRoles, canManageAssignments });
});

messageServersRouter.get('/:serverId/members', async (request, response) => {
  const access = await authorizedServer(request, request.params.serverId); if (!access) { sendError(response, 404, 'Servidor não encontrado ou você não tem acesso.'); return; }
  const [members, roles] = await Promise.all([MessageServerMember.find({ tenantId: tenantId(request), serverId: access.server._id }).sort({ joinedAt: 1 }).lean(), MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id }).lean()]);
  const profileIds = members.map((member) => member.profileId);
  const profiles = await Character.find({ tenantId: tenantId(request), _id: { $in: profileIds } }).select('displayName username avatarUrl').lean();
  const profileMap = new Map(profiles.map((profile) => [profile._id.toString(), profile])); const roleMap = new Map(roles.map((role) => [role._id.toString(), role]));
  const canSeeAccountIds = await hasAnyServerPermission(access.member, access.server._id, ['manage_server','manage_roles','kick_members','ban_members','restrict_members']);
  response.json(members.map((member) => ({ id: member._id.toString(), ...(canSeeAccountIds ? { accountId: member.accountId.toString() } : {}), profileId: member.profileId.toString(), role: member.role, roleIds: (member as any).roleIds ?? [], joinedAt: member.joinedAt, profile: profileMap.get(member.profileId.toString()) ?? null, roles: ((member as any).roleIds ?? []).map((id: mongoose.Types.ObjectId) => roleMap.get(id.toString())).filter(Boolean).map((role: any) => ({ id: role._id.toString(), name: role.name, color: role.color, icon: role.icon, position: role.position })) })));
});

messageServersRouter.post('/:serverId/roles', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_roles'); if (!access) return;
  const { name, color, icon = '', permissions = [] } = request.body ?? {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 40 || typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color) || typeof icon !== 'string' || icon.length > 24 || !Array.isArray(permissions) || permissions.some((permission: unknown) => !allServerPermissions.includes(permission as MessageServerPermission))) { sendError(response, 400, 'Dados de cargo inválidos.'); return; }
  const isOwner = access.member.role === 'owner';
  const actorPermissions = isOwner || access.member.role === 'admin' ? allServerPermissions : (await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: (access.member as any).roleIds ?? [] } }).select('permissions').lean()).flatMap((role) => role.permissions);
  if (!canGrantMessageServerPermissions(access.member.role, actorPermissions, permissions)) { sendError(response, 403, 'Você não pode conceder permissões que não possui.'); return; }
  try {
    const existingRoles = await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id }).select('position').lean();
    const actorRoles = await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: (access.member as any).roleIds ?? [] } }).select('position').lean();
    const actorTop = messageServerTopRolePosition(access.member.role, actorRoles.map((role) => role.position));
    const usedPositions = new Set(existingRoles.map((role) => role.position));
    let position = access.member.role === 'owner' ? Math.max(0, ...existingRoles.map((role) => role.position)) + 1 : Math.min(actorTop - 1, Math.max(0, ...existingRoles.filter((role) => role.position < actorTop).map((role) => role.position)) + 1);
    while (position > 0 && usedPositions.has(position)) position -= 0.01;
    if (position <= 0 || (access.member.role !== 'owner' && position >= actorTop)) { sendError(response, 403, 'Sua hierarquia não permite criar um novo cargo neste nível.'); return; }
    const role = await MessageServerCustomRole.create({ tenantId: tenantId(request), serverId: access.server._id, name: name.trim(), color, icon, permissions, position, createdByAccountId: accountId(request) });
    await recordAudit(request, access.server._id, 'role.created', role._id, { name: role.name, permissions, position });
    response.status(201).json({ id: role._id.toString(), name: role.name, color: role.color, icon: role.icon, permissions: role.permissions, position: role.position });
  }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { sendError(response, 409, 'Já existe um cargo com esse nome.'); return; } throw error; }
});
messageServersRouter.patch('/:serverId/roles/reorder', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_roles'); if (!access) return;
  const { roleIds } = request.body ?? {};
  if (!Array.isArray(roleIds) || roleIds.some((id: unknown) => !validId(id))) { sendError(response, 400, 'Ordem de cargos inválida.'); return; }
  const roles = await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id }).sort({ position: -1, _id: 1 });
  if (roleIds.length !== roles.length || new Set(roleIds).size !== roles.length || roleIds.some((id: string) => !roles.some((role) => role._id.toString() === id))) { sendError(response, 400, 'A ordem precisa incluir cada cargo deste servidor exatamente uma vez.'); return; }
  const actorRoles = await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: (access.member as any).roleIds ?? [] } }).select('position').lean();
  const actorTop = messageServerTopRolePosition(access.member.role, actorRoles.map((role) => role.position));
  const currentOrder = roles.map((role) => ({ id: role._id.toString(), position: role.position }));
  if (!canReorderMessageServerRoles(access.member.role, actorTop, currentOrder, roleIds)) { sendError(response, 403, 'Sua hierarquia não permite reorganizar cargos iguais ou superiores ao seu.'); return; }
  const positions = reorderedMessageServerRolePositions(access.member.role, actorTop, currentOrder, roleIds);
  if (!positions) { sendError(response, 400, 'A nova ordem de cargos é inválida.'); return; }
  await Promise.all(roles.map((role) => { const position = positions.get(role._id.toString()); if (position === undefined || position === role.position) return Promise.resolve(); role.position = position; return role.save(); }));
  await recordAudit(request, access.server._id, 'role.hierarchy.reordered', access.server._id, { roleIds, positions: Object.fromEntries(positions) });
  response.json({ saved: true, roles: roleIds.map((id: string) => ({ id, position: positions.get(id) })) });
});
messageServersRouter.patch('/:serverId/roles/:roleId', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_roles'); if (!access) return;
  if (!validId(request.params.roleId)) { sendError(response, 400, 'Cargo inválido.'); return; }
  const role = await MessageServerCustomRole.findOne({ _id: request.params.roleId, tenantId: tenantId(request), serverId: access.server._id }); if (!role) { sendError(response, 404, 'Cargo não encontrado.'); return; }
  const actorRoles = await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: (access.member as any).roleIds ?? [] } }).select('position permissions').lean(); const actorTop = messageServerTopRolePosition(access.member.role, actorRoles.map((item) => item.position));
  if (!canManageMessageServerCustomRole(access.member.role, actorTop, role.position)) { sendError(response, 403, 'Sua hierarquia não permite editar este cargo.'); return; }
  const body = request.body ?? {};
  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 40) || body.color !== undefined && (typeof body.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(body.color)) || body.icon !== undefined && (typeof body.icon !== 'string' || body.icon.length > 24) || body.permissions !== undefined && (!Array.isArray(body.permissions) || body.permissions.some((permission: unknown) => !allServerPermissions.includes(permission as MessageServerPermission))) || body.position !== undefined) { sendError(response, 400, 'Dados do cargo inválidos ou acima da sua hierarquia.'); return; }
  if (body.permissions !== undefined && !canGrantMessageServerPermissions(access.member.role, actorRoles.flatMap((item) => item.permissions), body.permissions)) { sendError(response, 403, 'Você não pode conceder permissões que não possui.'); return; }
  if (body.name !== undefined) role.name = body.name.trim(); if (body.color !== undefined) role.color = body.color; if (body.icon !== undefined) role.icon = body.icon; if (body.permissions !== undefined) role.permissions = body.permissions;
  try { await role.save(); } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { sendError(response, 409, 'Já existe um cargo com esse nome.'); return; } throw error; }
  await recordAudit(request, access.server._id, body.permissions !== undefined ? 'role.permissions.updated' : body.position !== undefined ? 'role.position.updated' : 'role.updated', role._id, { name: role.name, color: role.color, position: role.position, permissions: role.permissions }); response.json({ id: role._id.toString(), name: role.name, color: role.color, icon: role.icon, permissions: role.permissions, position: role.position });
});
messageServersRouter.delete('/:serverId/roles/:roleId', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_roles'); if (!access) return;
  if (!validId(request.params.roleId)) { sendError(response, 400, 'Cargo inválido.'); return; }
  const role = await MessageServerCustomRole.findOne({ _id: request.params.roleId, tenantId: tenantId(request), serverId: access.server._id }); if (!role) { sendError(response, 404, 'Cargo não encontrado.'); return; }
  const actorRoles = await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: (access.member as any).roleIds ?? [] } }).select('position').lean(); const actorTop = messageServerTopRolePosition(access.member.role, actorRoles.map((item) => item.position));
  if (!canManageMessageServerCustomRole(access.member.role, actorTop, role.position)) { sendError(response, 403, 'Sua hierarquia não permite excluir este cargo.'); return; }
  await Promise.all([MessageServerMember.updateMany({ tenantId: tenantId(request), serverId: access.server._id }, { $pull: { roleIds: role._id } }), MessageServerConfig.updateOne({ tenantId: tenantId(request), serverId: access.server._id, defaultRoleId: role._id }, { $unset: { defaultRoleId: 1 } })]); await role.deleteOne(); await recordAudit(request, access.server._id, 'role.deleted', role._id, { name: role.name }); response.status(204).end();
});

messageServersRouter.patch('/:serverId/members/:memberId/roles', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_roles'); if (!access) return;
  if (!validId(request.params.memberId) || !Array.isArray(request.body?.roleIds) || request.body.roleIds.some((id: unknown) => !validId(id))) { sendError(response, 400, 'Lista de cargos inválida.'); return; }
  const target = await MessageServerMember.findOne({ _id: request.params.memberId, tenantId: tenantId(request), serverId: access.server._id });
  if (!target) { sendError(response, 404, 'Membro não encontrado.'); return; }
  if (!await hierarchyAllows(request, access, target)) { sendError(response, 403, 'A hierarquia não permite alterar este membro.'); return; }
  const ids = request.body.roleIds.map((id: string) => new mongoose.Types.ObjectId(id));
  const roles = await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: ids } }).lean();
  if (roles.length !== ids.length) { sendError(response, 400, 'Um ou mais cargos não pertencem a este servidor.'); return; }
  if (access.member.role !== 'owner') {
    const actorRoles = await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: (access.member as any).roleIds ?? [] } }).lean();
    const actorTop = Math.max(access.member.role === 'admin' ? MESSAGE_SERVER_LEGACY_ADMIN_POSITION : 0, ...actorRoles.map((role) => role.position));
    const targetRoles = await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: (target as any).roleIds ?? [] } }).select('position').lean();
    const previouslyAssigned = new Set(((target as any).roleIds ?? []).map((id: mongoose.Types.ObjectId) => id.toString()));
    const newlyAssignedRoles = roles.filter((role) => !previouslyAssigned.has(role._id.toString()));
    if (Math.max(0, ...targetRoles.map((role) => role.position)) >= actorTop || newlyAssignedRoles.some((role) => role.position >= actorTop || !canGrantMessageServerPermissions(access.member.role, actorRoles.flatMap((actorRole) => actorRole.permissions), role.permissions))) { sendError(response, 403, 'Não é possível administrar alguém de hierarquia igual/superior ou conceder permissões que você não possui.'); return; }
  }
  const previousRoleIds = ((target as any).roleIds ?? []).map((id: mongoose.Types.ObjectId) => id.toString());
  const nextRoleIds = ids.map(String);
  if (previousRoleIds.length === nextRoleIds.length && previousRoleIds.every((id: string) => nextRoleIds.includes(id))) { response.json({ saved: true, unchanged: true }); return; }
  (target as any).roleIds = ids; await target.save(); await recordAudit(request, access.server._id, 'member.roles.updated', target._id, { previousRoleIds, roleIds: nextRoleIds });
  const serverProfiles = await MessageServerMember.find({ tenantId: tenantId(request), serverId: access.server._id }).select('profileId').lean();
  emitToProfiles(tenantId(request).toString(), serverProfiles.map((member) => member.profileId), { type: 'server:member-roles', serverId: access.server._id.toString(), targetProfileId: target.profileId.toString() });
  response.json({ saved: true });
});

messageServersRouter.post('/:serverId/invites', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_invites'); if (!access) return;
  const { expiresInDays, maxUses } = request.body ?? {};
  if (expiresInDays !== undefined && (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 90) || maxUses !== undefined && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000)) { sendError(response, 400, 'Validade ou limite de usos inválido.'); return; }
  const token = randomBytes(32).toString('base64url'); const invite = await MessageServerInvite.create({ tenantId: tenantId(request), serverId: access.server._id, tokenHash: inviteHash(token), createdByAccountId: accountId(request), ...(expiresInDays ? { expiresAt: new Date(Date.now() + expiresInDays * 86400000) } : {}), ...(maxUses ? { maxUses } : {}) });
  await recordAudit(request, access.server._id, 'invite.created', invite._id, { maxUses: maxUses ?? null, expiresAt: invite.expiresAt ?? null }); response.status(201).json({ id: invite._id.toString(), token, url: `/mensagens?serverId=${access.server._id.toString()}&invite=${token}`, uses: invite.uses, maxUses: invite.maxUses ?? null, expiresAt: invite.expiresAt ?? null, createdAt: invite.createdAt });
});
messageServersRouter.get('/:serverId/invites', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_invites'); if (!access) return;
  const invites = await MessageServerInvite.find({ tenantId: tenantId(request), serverId: access.server._id }).sort({ createdAt: -1 }).lean(); const creators = await Character.find({ tenantId: tenantId(request), accountId: { $in: invites.map((item) => item.createdByAccountId) } }).select('accountId displayName username').lean(); const names = new Map(creators.map((person) => [person.accountId.toString(), person.displayName || person.username])); response.json(invites.map((item) => ({ id: item._id.toString(), uses: item.uses, maxUses: item.maxUses ?? null, expiresAt: item.expiresAt ?? null, revoked: Boolean(item.revokedAt), createdAt: item.createdAt, createdByAccountId: item.createdByAccountId.toString(), createdByName: names.get(item.createdByAccountId.toString()) ?? 'Administrador' })));
});
messageServersRouter.delete('/:serverId/invites/:inviteId', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_invites'); if (!access) return;
  if (!validId(request.params.inviteId)) { sendError(response, 400, 'Convite inválido.'); return; }
  const invite = await MessageServerInvite.findOneAndUpdate({ _id: request.params.inviteId, tenantId: tenantId(request), serverId: access.server._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } }, { new: true }); if (!invite) { sendError(response, 404, 'Convite não encontrado.'); return; }
  await recordAudit(request, access.server._id, 'invite.revoked', invite._id); response.status(204).end();
});

messageServersRouter.patch('/:serverId/settings/access', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_server'); if (!access) return;
  const { accessMode, rulesRequired, ageRestricted, rules } = request.body ?? {};
  if (!['invite_only','request','discoverable'].includes(accessMode) || typeof rulesRequired !== 'boolean' || typeof ageRestricted !== 'boolean' || (rules !== undefined && (typeof rules !== 'string' || rules.length > 4000))) { sendError(response, 400, 'Configurações de acesso inválidas.'); return; }
  await MessageServerConfig.findOneAndUpdate({ tenantId: tenantId(request), serverId: access.server._id }, { $set: { accessMode, rulesRequired, ageRestricted, ...(rules !== undefined ? { rules } : {}) } }, { upsert: true, setDefaultsOnInsert: true });
  await recordAudit(request, access.server._id, 'server.access.updated', access.server._id, { accessMode, rulesRequired, ageRestricted }); response.json({ saved: true });
});

messageServersRouter.get('/:serverId/access-preview', async (request, response) => {
  if (!validId(request.params.serverId)) { sendError(response, 404, 'Servidor não encontrado.'); return; }
  const serverId = new mongoose.Types.ObjectId(request.params.serverId); const server = await MessageServer.findOne({ _id: serverId, tenantId: tenantId(request), privacy: 'private' }).select('name description iconUrl').lean(); if (!server) { sendError(response, 404, 'Servidor não encontrado.'); return; }
  const config = await MessageServerConfig.findOne({ tenantId: tenantId(request), serverId }).select('accessMode rules rulesRequired ageRestricted profilePrivate').lean(); if (config?.accessMode !== 'request') { sendError(response, 403, 'Este servidor não está aceitando solicitações de acesso.'); return; } if (config.profilePrivate && !await memberFor(request, serverId)) { sendError(response, 403, 'O perfil deste servidor é privado. É necessário um convite para visualizar os detalhes.'); return; }
  response.json({ server: { id: serverId.toString(), name: server.name, description: server.description, iconUrl: server.iconUrl }, rulesRequired: Boolean(config.rulesRequired), ageRestricted: Boolean(config.ageRestricted), rules: config.rules ?? '' });
});
messageServersRouter.post('/:serverId/access-requests', async (request, response) => {
  if (!validId(request.params.serverId)) { sendError(response, 404, 'Servidor não encontrado.'); return; }
  const serverId = new mongoose.Types.ObjectId(request.params.serverId); const server = await MessageServer.findOne({ _id: serverId, tenantId: tenantId(request), privacy: 'private' }).lean();
  if (!server || await MessageServerMember.exists({ tenantId: tenantId(request), serverId, accountId: accountId(request) })) { sendError(response, 404, 'Servidor não encontrado ou você já participa.'); return; }
  const config = await MessageServerConfig.findOne({ tenantId: tenantId(request), serverId }).lean(); if (config?.accessMode !== 'request') { sendError(response, 403, 'Este servidor aceita somente convites.'); return; }
  if (config?.rulesRequired && request.body?.acceptedRules !== true) { sendError(response, 400, 'É necessário aceitar as regras deste servidor.'); return; }
  if (config?.ageRestricted && request.body?.acceptedAge !== true) { sendError(response, 400, 'É necessário confirmar que você tem a idade legal para entrar neste servidor.'); return; }
  const activeBan = await MessageServerBan.exists({ tenantId: tenantId(request), serverId, accountId: accountId(request), revokedAt: { $exists: false }, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] }); if (activeBan) { sendError(response, 403, 'Você não pode solicitar acesso a este servidor.'); return; }
  const presentation = typeof request.body?.presentation === 'string' ? request.body.presentation.trim() : ''; if (presentation.length > 500) { sendError(response, 400, 'A apresentação deve ter até 500 caracteres.'); return; }
  const requestRecord = await MessageServerAccessRequest.findOneAndUpdate({ tenantId: tenantId(request), serverId, accountId: accountId(request), status: 'pending' }, { $setOnInsert: { profileId: profileId(request), presentation, status: 'pending' } }, { upsert: true, new: true }); response.status(201).json({ id: requestRecord._id.toString(), status: requestRecord.status });
});
messageServersRouter.get('/:serverId/access-requests', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_server'); if (!access) return;
  const items = await MessageServerAccessRequest.find({ tenantId: tenantId(request), serverId: access.server._id, status: 'pending' }).sort({ createdAt: 1 }).lean(); const profiles = await Character.find({ tenantId: tenantId(request), _id: { $in: items.map((item) => item.profileId) } }).select('displayName username avatarUrl').lean(); const byId = new Map(profiles.map((profile) => [profile._id.toString(), profile])); response.json(items.map((item) => ({ ...item, profile: byId.get(item.profileId.toString()) ?? null })));
});
messageServersRouter.post('/:serverId/access-requests/:requestId/:decision', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_server'); if (!access) return;
  if (!validId(request.params.requestId) || !['approve','reject'].includes(request.params.decision)) { sendError(response, 400, 'Decisão inválida.'); return; }
  const item = await MessageServerAccessRequest.findOne({ _id: request.params.requestId, tenantId: tenantId(request), serverId: access.server._id, status: 'pending' }); if (!item) { sendError(response, 404, 'Solicitação não encontrada.'); return; }
  if (request.params.decision === 'approve' && await MessageServerBan.exists({ tenantId: tenantId(request), serverId: access.server._id, accountId: item.accountId, revokedAt: { $exists: false }, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] })) { sendError(response, 403, 'Esta pessoa está banida deste servidor.'); return; }
  item.status = request.params.decision === 'approve' ? 'approved' : 'rejected'; item.reviewedBy = accountId(request); item.reviewedAt = new Date(); await item.save();
  if (item.status === 'approved') {
  const config = await MessageServerConfig.findOne({ tenantId: tenantId(request), serverId: access.server._id }).select('defaultNotifications').lean();
    const membership = await MessageServerMember.updateOne({ tenantId: tenantId(request), serverId: access.server._id, accountId: item.accountId }, { $setOnInsert: { profileId: item.profileId, role: 'member', joinedAt: new Date(), notificationPreference: config?.defaultNotifications ?? 'mentions' } }, { upsert: true });
    if (membership.upsertedCount) { const profile = await Character.findOne({ _id: item.profileId, tenantId: tenantId(request) }).select('displayName username avatarUrl accountId').lean(); if (profile) await publishWelcome(access.server, profile); }
  }
  await recordAudit(request, access.server._id, `access.${item.status}`, item._id); response.json({ status: item.status });
});

messageServersRouter.get('/:serverId/bans', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'ban_members'); if (!access) return;
  const bans = await MessageServerBan.find({ tenantId: tenantId(request), serverId: access.server._id }).sort({ createdAt: -1 }).lean(); const profiles = await Character.find({ tenantId: tenantId(request), _id: { $in: bans.map((ban) => ban.profileId) } }).select('displayName username avatarUrl').lean(); const byId = new Map(profiles.map((profile) => [profile._id.toString(), profile])); response.json(bans.map((ban) => ({ ...ban, profile: byId.get(ban.profileId.toString()) ?? null })));
});
messageServersRouter.post('/:serverId/bans', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'ban_members'); if (!access) return;
  const { accountId: targetAccountId, reason, durationDays } = request.body ?? {};
  if (!validId(targetAccountId) || typeof reason !== 'string' || reason.trim().length < 2 || reason.length > 500 || durationDays !== undefined && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365)) { sendError(response, 400, 'Informe membro, motivo e duração válidos.'); return; }
  const member = await MessageServerMember.findOne({ tenantId: tenantId(request), serverId: access.server._id, accountId: targetAccountId }); if (!member) { sendError(response, 404, 'Membro não encontrado neste servidor.'); return; }
  if (member.role === 'owner' || member.role === 'admin' && access.member.role !== 'owner' || member.accountId.equals(accountId(request))) { sendError(response, 403, 'A hierarquia não permite banir este membro.'); return; }
  if (!await hierarchyAllows(request, access, member)) { sendError(response, 403, 'Não é possível moderar alguém de hierarquia igual ou superior.'); return; }
  const banUpdate: Record<string, any> = { $set: { profileId: member.profileId, reason: reason.trim(), moderatorAccountId: accountId(request), ...(durationDays ? { expiresAt: new Date(Date.now() + durationDays * 86400000) } : {}) }, $unset: { revokedAt: 1, ...(!durationDays ? { expiresAt: 1 } : {}) } };
  const ban = await MessageServerBan.findOneAndUpdate({ tenantId: tenantId(request), serverId: access.server._id, accountId: member.accountId }, banUpdate, { upsert: true, new: true, setDefaultsOnInsert: true });
  await MessageServerMember.deleteOne({ _id: member._id, tenantId: tenantId(request), serverId: access.server._id }); await recordAudit(request, access.server._id, 'member.banned', member._id, { reason: reason.trim(), expiresAt: ban.expiresAt ?? null }); response.status(201).json({ id: ban._id.toString() });
});
messageServersRouter.delete('/:serverId/bans/:banId', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'revoke_bans'); if (!access) return;
  if (!validId(request.params.banId)) { sendError(response, 400, 'Banimento inválido.'); return; }
  const ban = await MessageServerBan.findOneAndUpdate({ _id: request.params.banId, tenantId: tenantId(request), serverId: access.server._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } }, { new: true }); if (!ban) { sendError(response, 404, 'Banimento não encontrado.'); return; }
  await recordAudit(request, access.server._id, 'ban.revoked', ban._id); response.status(204).end();
});
messageServersRouter.get('/:serverId/restrictions', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'restrict_members'); if (!access) return;
  const items = await MessageServerRestriction.find({ tenantId: tenantId(request), serverId: access.server._id, revokedAt: { $exists: false } }).sort({ createdAt: -1 }).lean(); const profiles = await Character.find({ tenantId: tenantId(request), _id: { $in: items.map((item) => item.profileId) } }).select('displayName username').lean(); const byId = new Map(profiles.map((profile) => [profile._id.toString(), profile])); response.json(items.map((item) => ({ ...item, profile: byId.get(item.profileId.toString()) ?? null })));
});
messageServersRouter.post('/:serverId/restrictions', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'restrict_members'); if (!access) return;
  const { accountId: targetId, reason, durationHours } = request.body ?? {};
  if (!validId(targetId) || typeof reason !== 'string' || reason.trim().length < 2 || reason.length > 500 || !Number.isInteger(durationHours) || durationHours < 1 || durationHours > 720) { sendError(response, 400, 'Informe membro, motivo e duração válidos.'); return; }
  const member = await MessageServerMember.findOne({ tenantId: tenantId(request), serverId: access.server._id, accountId: targetId }); if (!member) { sendError(response, 404, 'Membro não encontrado.'); return; }
  if (!await hierarchyAllows(request, access, member)) { sendError(response, 403, 'A hierarquia não permite restringir este membro.'); return; }
  const until = new Date(Date.now() + durationHours * 3600000); const item = await MessageServerRestriction.create({ tenantId: tenantId(request), serverId: access.server._id, accountId: member.accountId, profileId: member.profileId, reason: reason.trim(), moderatorAccountId: accountId(request), mutedUntil: until }); await recordAudit(request, access.server._id, 'member.restricted', member._id, { reason: reason.trim(), mutedUntil: until }); response.status(201).json({ id: item._id.toString(), mutedUntil: until });
});
messageServersRouter.delete('/:serverId/restrictions/:restrictionId', async (request, response) => {
  const access = await adminAccessAny(request, response, request.params.serverId, ['revoke_restrictions','restrict_members']); if (!access) return;
  if (!validId(request.params.restrictionId)) { sendError(response, 400, 'Restrição inválida.'); return; }
  const item = await MessageServerRestriction.findOneAndUpdate({ _id: request.params.restrictionId, tenantId: tenantId(request), serverId: access.server._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } }, { new: true }); if (!item) { sendError(response, 404, 'Restrição não encontrada.'); return; }
  await recordAudit(request, access.server._id, 'member.restriction_revoked', item._id); response.status(204).end();
});
messageServersRouter.get('/:serverId/audit', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'view_audit'); if (!access) return;
  const records = await MessageServerAudit.find({ tenantId: tenantId(request), serverId: access.server._id }).sort({ createdAt: -1 }).limit(200).lean(); const actors = await Character.find({ tenantId: tenantId(request), accountId: { $in: records.map((item) => item.actorAccountId) } }).select('accountId displayName username avatarUrl').lean(); const names = new Map(actors.map((person) => [person.accountId.toString(), person])); response.json(records.map((item) => ({ ...item, actor: names.get(item.actorAccountId.toString()) ?? null })));
});

messageServersRouter.patch('/:serverId/settings/communication', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_server'); if (!access) return;
  const { notifications, allowGifs, allowAttachments } = request.body ?? {};
  if (!['all','mentions','important'].includes(notifications) || typeof allowGifs !== 'boolean' || typeof allowAttachments !== 'boolean') { sendError(response, 400, 'Preferências inválidas.'); return; }
  await MessageServerConfig.findOneAndUpdate({ tenantId: tenantId(request), serverId: access.server._id }, { $set: { notifications, allowGifs, allowAttachments } }, { upsert: true, setDefaultsOnInsert: true }); await recordAudit(request, access.server._id, 'server.communication.updated', access.server._id, { notifications, allowGifs, allowAttachments }); response.json({ saved: true });
});

messageServersRouter.patch('/:serverId/settings/preferences', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_server'); if (!access) return;
  const body = request.body ?? {};
  const { welcomeEnabled, welcomeChannelId, welcomeMessage, startChannelMode, startChannelId, defaultNotifications, groupMembersByRole, showRoleColors, antiSpamEnabled, limitRepeatedLinks } = body;
  if ((welcomeChannelId && !validId(welcomeChannelId)) || (startChannelId && !validId(startChannelId))) { sendError(response, 400, 'Canal selecionado inválido.'); return; }
  const welcomeId = welcomeChannelId ? new mongoose.Types.ObjectId(welcomeChannelId) : undefined;
  const startId = startChannelId ? new mongoose.Types.ObjectId(startChannelId) : undefined;
  if (typeof welcomeEnabled !== 'boolean' || typeof welcomeMessage !== 'string' || welcomeMessage.length > 500 || !validWelcomeTemplate(welcomeMessage) || (welcomeEnabled && !welcomeMessage.trim()) || !['last','main','welcome_first'].includes(startChannelMode) || (startChannelMode === 'main' && !startId) || !['all','mentions','muted'].includes(defaultNotifications) || typeof groupMembersByRole !== 'boolean' || typeof showRoleColors !== 'boolean' || typeof antiSpamEnabled !== 'boolean' || typeof limitRepeatedLinks !== 'boolean' || (welcomeEnabled && !welcomeId)) { sendError(response, 400, 'Revise as preferências informadas.'); return; }
  const channelIds = [welcomeId, startId].filter(Boolean);
  const channels = channelIds.length ? await MessageServerChannel.find({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: channelIds }, archivedAt: { $exists: false }, isPrivate: { $ne: true }, kind: { $ne: 'voice' } }).lean() : [];
  if (welcomeEnabled && !channels.some((channel) => channel._id.equals(welcomeId!) && channel.posting === 'members')) { sendError(response, 400, 'Escolha um canal público onde todos os membros possam publicar para as boas-vindas.'); return; }
  if (startId && !channels.some((channel) => channel._id.equals(startId))) { sendError(response, 400, 'O canal inicial precisa ser público, ativo e aceitar mensagens.'); return; }
  const values = { welcomeEnabled, ...(welcomeId ? { welcomeChannelId: welcomeId } : { $unset: { welcomeChannelId: 1 } }), welcomeMessage: welcomeMessage.trim(), startChannelMode, ...(startId ? { startChannelId: startId } : { $unset: { startChannelId: 1 } }), defaultNotifications, groupMembersByRole, showRoleColors, antiSpamEnabled, limitRepeatedLinks };
  const { $unset, ...setValues } = values as typeof values & { $unset?: Record<string, number> };
  await MessageServerConfig.findOneAndUpdate({ tenantId: tenantId(request), serverId: access.server._id }, { $set: setValues, ...($unset ? { $unset } : {}) }, { upsert: true, setDefaultsOnInsert: true });
  await recordAudit(request, access.server._id, 'server.preferences.updated', access.server._id, { welcomeEnabled, welcomeChannelId: welcomeId?.toString() ?? null, startChannelMode, startChannelId: startId?.toString() ?? null, defaultNotifications, groupMembersByRole, showRoleColors, antiSpamEnabled, limitRepeatedLinks });
  response.json({ saved: true });
});

messageServersRouter.patch('/:serverId/my-preferences', async (request, response) => {
  const access = await authorizedServer(request, request.params.serverId); if (!access) { sendError(response, 404, 'Servidor não encontrado ou você não tem acesso.'); return; }
  const preference = request.body?.notificationPreference;
  if (!['all','mentions','muted'].includes(preference)) { sendError(response, 400, 'Preferência de notificações inválida.'); return; }
  await MessageServerMember.updateOne({ tenantId: tenantId(request), serverId: access.server._id, accountId: accountId(request) }, { $set: { notificationPreference: preference } });
  response.json({ notificationPreference: preference });
});

messageServersRouter.post('/:serverId/kick', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'kick_members'); if (!access) return;
  if (!validId(request.body?.accountId)) { sendError(response, 400, 'Membro inválido.'); return; }
  const member = await MessageServerMember.findOne({ tenantId: tenantId(request), serverId: access.server._id, accountId: request.body.accountId }); if (!member) { sendError(response, 404, 'Membro não encontrado.'); return; }
  if (!await hierarchyAllows(request, access, member)) { sendError(response, 403, 'A hierarquia não permite expulsar este membro.'); return; }
  await member.deleteOne(); await recordAudit(request, access.server._id, 'member.kicked', member._id); response.json({ removed: true });
});

messageServersRouter.get('/:serverId/invite-preview/:token', async (request, response) => {
  if (!validId(request.params.serverId) || typeof request.params.token !== 'string' || request.params.token.length < 24) { sendError(response, 404, 'Convite inválido.'); return; }
  const serverId = new mongoose.Types.ObjectId(request.params.serverId); const server = await MessageServer.findOne({ _id: serverId, tenantId: tenantId(request), privacy: 'private' }).lean();
  const invite = await MessageServerInvite.findOne({ tenantId: tenantId(request), serverId, tokenHash: inviteHash(request.params.token), revokedAt: { $exists: false }, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] }).lean();
  const config = await MessageServerConfig.findOne({ tenantId: tenantId(request), serverId }).select('rules rulesRequired ageRestricted accessMode bannerUrl').lean();
  if (!server || !invite || (invite.maxUses && invite.uses >= invite.maxUses) || (config?.accessMode ?? 'invite_only') !== 'invite_only') { sendError(response, 404, 'Este convite expirou ou não está disponível.'); return; }
  response.json({ server: { id: server._id.toString(), name: server.name, description: server.description, iconUrl: server.iconUrl, bannerUrl: config?.bannerUrl ?? '' }, rulesRequired: Boolean(config?.rulesRequired), ageRestricted: Boolean(config?.ageRestricted), rules: config?.rules ?? '' });
});
messageServersRouter.post('/:serverId/join/:token', async (request, response) => {
  if (!validId(request.params.serverId) || typeof request.params.token !== 'string' || request.params.token.length < 24) { sendError(response, 400, 'Convite inválido.'); return; }
  const serverId = new mongoose.Types.ObjectId(request.params.serverId); const server = await MessageServer.findOne({ _id: serverId, tenantId: tenantId(request), privacy: 'private' }); if (!server) { sendError(response, 404, 'Servidor não encontrado.'); return; }
  const config = await MessageServerConfig.findOne({ tenantId: tenantId(request), serverId }).lean(); const invite = await MessageServerInvite.findOne({ tenantId: tenantId(request), serverId, tokenHash: inviteHash(request.params.token), revokedAt: { $exists: false }, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] });
  if ((config?.accessMode ?? 'invite_only') !== 'invite_only' || !invite || invite.maxUses && invite.uses >= invite.maxUses) { sendError(response, 404, 'Este convite expirou ou não está disponível.'); return; }
  if (config?.rulesRequired && request.body?.acceptedRules !== true) { sendError(response, 400, 'É necessário aceitar as regras deste servidor.'); return; }
  if (config?.ageRestricted && request.body?.acceptedAge !== true) { sendError(response, 400, 'É necessário confirmar que você tem a idade legal para entrar neste servidor.'); return; }
  const banned = await MessageServerBan.exists({ tenantId: tenantId(request), serverId, accountId: accountId(request), revokedAt: { $exists: false }, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] }); if (banned) { sendError(response, 403, 'Você não pode entrar neste servidor.'); return; }
  if (await MessageServerMember.exists({ tenantId: tenantId(request), serverId, accountId: accountId(request) })) { response.json({ joined: true, serverId: serverId.toString() }); return; }
  const inviteQuery: Record<string, unknown> = { _id: invite._id, tenantId: tenantId(request), serverId, revokedAt: { $exists: false }, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] }; if (invite.maxUses) inviteQuery.uses = { $lt: invite.maxUses };
  const validInvite = await MessageServerInvite.findOneAndUpdate(inviteQuery, { $inc: { uses: 1 } }, { new: true }); if (!validInvite) { sendError(response, 404, 'Este convite atingiu o limite de usos ou expirou.'); return; }
  const membership = await MessageServerMember.updateOne({ tenantId: tenantId(request), serverId, accountId: accountId(request) }, { $setOnInsert: { profileId: profileId(request), role: 'member', joinedAt: new Date(), notificationPreference: config?.defaultNotifications ?? 'mentions' } }, { upsert: true });
  if (membership.upsertedCount) await publishWelcome(server, { ...request.vybeCharacter!, accountId: accountId(request) });
  response.json({ joined: true, serverId: serverId.toString() });
});
messageServersRouter.post('/:serverId/leave', async (request, response) => {
  const access = await authorizedServer(request, request.params.serverId); if (!access) { sendError(response, 404, 'Servidor não encontrado ou você não tem acesso.'); return; }
  if (access.member.role === 'owner' || access.server.ownerAccountId.equals(accountId(request))) { sendError(response, 403, 'O proprietário precisa transferir a propriedade antes de sair.'); return; }
  await MessageServerMember.deleteOne({ _id: access.member._id, tenantId: tenantId(request), serverId: access.server._id }); await recordAudit(request, access.server._id, 'member.left', access.member._id); response.json({ left: true });
});

messageServersRouter.get('/', async (request, response) => {
  const memberships = await MessageServerMember.find({ tenantId: tenantId(request), accountId: accountId(request) }).sort({ joinedAt: 1 }).lean();
  if (!memberships.length) { response.json([]); return; }
  const servers = await MessageServer.find({ tenantId: tenantId(request), privacy: 'private', _id: { $in: memberships.map((item) => item.serverId) } }).lean();
  const byId = new Map(servers.map((server) => [server._id.toString(), server]));
  const counts = await MessageServerMember.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    { $match: { tenantId: tenantId(request), serverId: { $in: servers.map((server) => server._id) } } },
    { $group: { _id: '$serverId', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((item) => [item._id.toString(), item.count]));
  const roleIds = memberships.flatMap((item) => (item as any).roleIds ?? []);
  const roles = roleIds.length ? await MessageServerCustomRole.find({ tenantId: tenantId(request), _id: { $in: roleIds } }).select('serverId permissions').lean() : [];
  const rolePermissions = new Map(roles.map((role) => [role._id.toString(), role]));
  response.json(memberships.flatMap((member) => { const server = byId.get(member.serverId.toString()); if (!server) return []; const assigned = ((member as any).roleIds ?? []).map((id: mongoose.Types.ObjectId) => rolePermissions.get(id.toString())).filter((role: any) => role?.serverId.equals(member.serverId)); const permissions = member.role === 'owner' || member.role === 'admin' ? allServerPermissions : assigned.flatMap((role: any) => role.permissions); const canManageProfile = member.role === 'owner' || assigned.some((role: any) => role.permissions.includes('manage_server')); return [serverJson(server, serverRole(member.role) ?? 'member', countMap.get(member.serverId.toString()) ?? 1, permissions, canManageProfile)]; }));
});

messageServersRouter.post('/', async (request, response) => {
  const body = request.body ?? {};
  if (!validMessageServerName(body.name) || (body.description !== undefined && (typeof body.description !== 'string' || body.description.trim().length > 240)) || (body.privacy !== undefined && body.privacy !== 'private')) {
    sendError(response, 400, 'Informe um nome de servidor válido. Por enquanto, os servidores são privados.'); return;
  }
  let iconUrl = '';
  try { iconUrl = await saveServerIcon(body.icon, request.vybeTenant!.slug); }
  catch (error) { sendError(response, 400, error instanceof Error ? error.message : 'Ícone inválido.'); return; }
  let server: any;
  try {
    server = await MessageServer.create({ tenantId: tenantId(request), ownerAccountId: accountId(request), ownerProfileId: profileId(request), name: body.name.trim(), description: typeof body.description === 'string' ? body.description.trim() : '', iconUrl, privacy: 'private' });
    await MessageServerMember.create({ tenantId: tenantId(request), serverId: server._id, accountId: accountId(request), profileId: profileId(request), role: 'owner' });
    const category = await MessageServerCategory.create({ tenantId: tenantId(request), serverId: server._id, name: 'COMUNIDADE', position: 0, createdByAccountId: accountId(request) });
    await MessageServerChannel.create({ tenantId: tenantId(request), serverId: server._id, categoryId: category._id, name: 'geral', description: 'Conversa geral do servidor.', kind: 'text', posting: 'members', createdByAccountId: accountId(request) });
  } catch (error) {
    if (server) await Promise.all([
      MessageServer.deleteOne({ _id: server._id, tenantId: tenantId(request) }),
      MessageServerMember.deleteMany({ tenantId: tenantId(request), serverId: server._id }),
      MessageServerCategory.deleteMany({ tenantId: tenantId(request), serverId: server._id }),
      MessageServerChannel.deleteMany({ tenantId: tenantId(request), serverId: server._id }),
    ]);
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { sendError(response, 409, 'Não foi possível concluir a criação. Tente outro nome.'); return; }
    throw error;
  }
  response.status(201).json(serverJson(server, 'owner', 1));
});

messageServersRouter.patch('/:serverId/last-channel', async (request, response) => {
  const access = await authorizedServer(request, request.params.serverId);
  if (!access || !validId(request.body?.channelId)) { sendError(response, 404, 'Canal não encontrado ou você não tem acesso.'); return; }
  const channel = await MessageServerChannel.findOne({ _id: request.body.channelId, tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } }).lean();
  if (!channel) { sendError(response, 404, 'Canal não encontrado ou você não tem acesso.'); return; }
  const roles = channel.isPrivate ? await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: (access.member as any).roleIds ?? [] } }).select('permissions').lean() : [];
  if (!canAccessChannel(access.member, channel, roles)) { sendError(response, 404, 'Canal não encontrado ou você não tem acesso.'); return; }
  await MessageServerMember.updateOne({ tenantId: tenantId(request), serverId: access.server._id, accountId: accountId(request) }, { $set: { lastChannelId: channel._id } });
  response.json({ saved: true });
});

messageServersRouter.get('/:serverId', async (request, response) => {
  const access = await authorizedServer(request, request.params.serverId);
  if (!access) { sendError(response, 404, 'Servidor não encontrado ou você não tem acesso.'); return; }
  const [categories, allChannels, members, config] = await Promise.all([
    MessageServerCategory.find({ tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } }).sort({ position: 1, createdAt: 1 }).lean(),
    MessageServerChannel.find({ tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } }).sort({ position: 1, createdAt: 1 }).lean(),
    MessageServerMember.countDocuments({ tenantId: tenantId(request), serverId: access.server._id }),
    MessageServerConfig.findOne({ tenantId: tenantId(request), serverId: access.server._id }).select('bannerUrl accentColor startChannelMode startChannelId welcomeEnabled welcomeChannelId groupMembersByRole showRoleColors defaultNotifications').lean(),
  ]);
  const assignedRoles = await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: (access.member as any).roleIds ?? [] } }).select('permissions').lean();
  const channels = allChannels.filter((channel) => canAccessChannel(access.member, channel, assignedRoles));
  const channelData=await Promise.all(channels.map(async(channel)=>({ ...channelJson(channel), canSend:channelOverrideState(access.member,channel,'send_messages')!=='deny'&&(channel.posting==='members'||await hasChannelPermission(access.member,access.server._id,channel,'send_messages')), canCreatePosts:channel.kind==='posts'&&channelOverrideState(access.member,channel,'create_posts')!=='deny'&&(channel.posting==='members'||await hasChannelPermission(access.member,access.server._id,channel,'create_posts')), canReplyPosts:channel.repliesEnabled!==false&&channelOverrideState(access.member,channel,'reply_posts')!=='deny'&&(channel.posting==='members'||await hasChannelPermission(access.member,access.server._id,channel,'reply_posts')), canPinMessages:await hasChannelPermission(access.member,access.server._id,channel,'pin_messages')||await hasChannelPermission(access.member,access.server._id,channel,'manage_messages'), canPinPosts:channel.kind==='posts'&&await hasChannelPermission(access.member,access.server._id,channel,'pin_posts'), canManagePosts:channel.kind==='posts'&&await hasChannelPermission(access.member,access.server._id,channel,'manage_posts'), canAttachFiles:await hasChannelPermission(access.member,access.server._id,channel,'attach_files'), canSendImages:await hasChannelPermission(access.member,access.server._id,channel,'send_images') })));
  const permissions = access.member.role === 'owner' || access.member.role === 'admin' ? allServerPermissions : assignedRoles.flatMap((role) => role.permissions);
  const canManageProfile = access.member.role === 'owner' || assignedRoles.some((role) => role.permissions.includes('manage_server'));
  response.json({ server: { ...serverJson(access.server, serverRole(access.member.role) ?? 'member', members, permissions, canManageProfile), bannerUrl: config?.bannerUrl ?? '', accentColor: config?.accentColor ?? '#246B6E', startChannelMode: config?.startChannelMode ?? 'last', startChannelId: config?.startChannelId?.toString() ?? '', welcomeEnabled: Boolean(config?.welcomeEnabled), welcomeChannelId: config?.welcomeChannelId?.toString() ?? '', groupMembersByRole: Boolean(config?.groupMembersByRole), showRoleColors: config?.showRoleColors !== false, defaultNotifications: config?.defaultNotifications ?? 'mentions', lastChannelId: (access.member as any).lastChannelId?.toString() ?? '', notificationPreference: (access.member as any).notificationPreference ?? config?.defaultNotifications ?? 'mentions' }, categories: categories.map((item) => ({ id: item._id.toString(), name: item.name, position: item.position })), channels: channelData });
});

messageServersRouter.post('/:serverId/categories', async (request, response) => {
  const access = await adminAccessAny(request, response, request.params.serverId, ['manage_categories','create_channels']); if (!access) return;
  const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
  if (name.length < 2 || name.length > 60) { sendError(response, 400, 'Informe um nome de categoria de 2 a 60 caracteres.'); return; }
  try {
    const position = await MessageServerCategory.countDocuments({ tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } });
    const category = await MessageServerCategory.create({ tenantId: tenantId(request), serverId: access.server._id, name, position, createdByAccountId: accountId(request) });
    await recordAudit(request, access.server._id, 'category.created', category._id, { name });
    response.status(201).json({ id: category._id.toString(), name: category.name, position: category.position });
  } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { sendError(response, 409, 'Já existe uma categoria com esse nome.'); return; } throw error; }
});

messageServersRouter.post('/:serverId/channels', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'create_channels'); if (!access) return;
  const { name, categoryId, description = '', kind = 'text', posting = 'members', repliesEnabled = true, isPrivate = false, allowedRoleIds = [], permissionOverrides = [] } = request.body ?? {};
  if (typeof name !== 'string' || !/^[a-z0-9-]{2,40}$/.test(name) || !validId(categoryId) || typeof description !== 'string' || description.length > 240 || !['text','announcement','posts','voice'].includes(kind) || !['members','staff'].includes(posting) || typeof repliesEnabled !== 'boolean' || typeof isPrivate !== 'boolean' || !Array.isArray(allowedRoleIds) || allowedRoleIds.some((id: unknown) => !validId(id)) || !Array.isArray(permissionOverrides) || permissionOverrides.some((item:any)=>!item||(item.roleId!==null&&!validId(item.roleId))||!allMessageServerPermissions.includes(item.permission)||!['allow','deny'].includes(item.state))) { sendError(response, 400, 'Dados do canal inválidos.'); return; }
  if ((isPrivate || allowedRoleIds.length > 0) && !await hasServerPermission(access.member, access.server._id, 'manage_channel_permissions')) { sendError(response, 403, 'Você não tem permissão para definir o acesso do canal.'); return; }
  if(permissionOverrides.length&&!await hasServerPermission(access.member,access.server._id,'manage_channel_permissions')){sendError(response,403,'Você não tem permissão para definir regras por cargo.');return;}
  const category = await MessageServerCategory.findOne({ _id: categoryId, tenantId: tenantId(request), serverId: access.server._id });
  if (!category) { sendError(response, 404, 'Categoria não encontrada neste servidor.'); return; }
  const accessRoles = allowedRoleIds.length ? await MessageServerCustomRole.find({ _id: { $in: allowedRoleIds }, tenantId: tenantId(request), serverId: access.server._id }).select('_id').lean() : [];
  if (accessRoles.length !== allowedRoleIds.length) { sendError(response, 400, 'Um ou mais cargos de acesso não pertencem a este servidor.'); return; }
  try {
    const position = await MessageServerChannel.countDocuments({ tenantId: tenantId(request), serverId: access.server._id, categoryId: category._id, archivedAt: { $exists: false } });
    const overrideRoleIds=[...new Set(permissionOverrides.filter((item:any)=>item.roleId!==null).map((item:any)=>item.roleId))];const overrideRoles=overrideRoleIds.length?await MessageServerCustomRole.find({_id:{$in:overrideRoleIds},tenantId:tenantId(request),serverId:access.server._id}).select('_id').lean():[];if(overrideRoles.length!==overrideRoleIds.length){sendError(response,400,'Um cargo das regras não pertence a este servidor.');return;}
    const channel = await MessageServerChannel.create({ tenantId: tenantId(request), serverId: access.server._id, categoryId: category._id, name, description: description.trim(), kind, posting, repliesEnabled, isPrivate, allowedRoleIds: accessRoles.map((role) => role._id), permissionOverrides:permissionOverrides.map((item:any)=>({...item,...(item.roleId?{roleId:new mongoose.Types.ObjectId(item.roleId)}:{})})), position, createdByAccountId: accountId(request) });
    await recordAudit(request, access.server._id, 'channel.created', channel._id, { name, kind });
    response.status(201).json(channelJson(channel));
  } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { sendError(response, 409, 'Já existe um canal com esse nome nesta categoria.'); return; } throw error; }
});

messageServersRouter.patch('/:serverId/categories/:categoryId', async (request, response) => {
  const access = await adminAccessAny(request, response, request.params.serverId, ['manage_categories','edit_channels']); if (!access) return;
  if (!validId(request.params.categoryId)) { sendError(response, 400, 'Categoria inválida.'); return; }
  const category = await MessageServerCategory.findOne({ _id: request.params.categoryId, tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } }); if (!category) { sendError(response, 404, 'Categoria não encontrada.'); return; }
  const { name, position } = request.body ?? {};
  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) || position !== undefined && (!Number.isInteger(position) || position < 0 || position > 10000)) { sendError(response, 400, 'Nome ou ordem de categoria inválidos.'); return; }
  if (name !== undefined) category.name = name.trim(); if (position !== undefined) category.position = position; await category.save();
  await recordAudit(request, access.server._id, 'category.updated', category._id, { name: category.name, position: category.position }); response.json({ id: category._id.toString(), name: category.name, position: category.position });
});
messageServersRouter.delete('/:serverId/categories/:categoryId', async (request, response) => {
  const access = await adminAccessAny(request, response, request.params.serverId, ['manage_categories','delete_channels']); if (!access) return;
  if (!validId(request.params.categoryId)) { sendError(response, 400, 'Categoria inválida.'); return; }
  const category = await MessageServerCategory.findOne({ _id: request.params.categoryId, tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } }); if (!category) { sendError(response, 404, 'Categoria não encontrada.'); return; }
  if (await MessageServerChannel.exists({ tenantId: tenantId(request), serverId: access.server._id, categoryId: category._id, archivedAt: { $exists: false } })) { sendError(response, 409, 'Mova ou arquive os canais desta categoria antes de arquivá-la.'); return; }
  category.archivedAt = new Date(); await category.save(); await recordAudit(request, access.server._id, 'category.archived', category._id, { name: category.name }); response.status(204).end();
});
messageServersRouter.patch('/:serverId/channels/:channelId', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'edit_channels'); if (!access) return;
  if (!validId(request.params.channelId)) { sendError(response, 400, 'Canal inválido.'); return; }
  const channel = await MessageServerChannel.findOne({ _id: request.params.channelId, tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } }); if (!channel) { sendError(response, 404, 'Canal não encontrado.'); return; }
  const body = request.body ?? {};
  if ((body.isPrivate !== undefined || body.allowedRoleIds !== undefined || body.permissionOverrides !== undefined) && !await hasServerPermission(access.member, access.server._id, 'manage_channel_permissions')) { sendError(response, 403, 'Você não tem permissão para alterar o acesso do canal.'); return; }
  if (body.name !== undefined && (typeof body.name !== 'string' || !/^[a-z0-9-]{2,40}$/.test(body.name)) || body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 240) || body.kind !== undefined && !['text','announcement','posts','voice'].includes(body.kind) || body.posting !== undefined && !['members','staff'].includes(body.posting) || body.repliesEnabled !== undefined && typeof body.repliesEnabled !== 'boolean' || body.position !== undefined && (!Number.isInteger(body.position) || body.position < 0 || body.position > 10000) || body.categoryId !== undefined && !validId(body.categoryId) || body.isPrivate !== undefined && typeof body.isPrivate !== 'boolean' || body.allowedRoleIds !== undefined && (!Array.isArray(body.allowedRoleIds) || body.allowedRoleIds.some((id: unknown) => !validId(id)))) { sendError(response, 400, 'Dados do canal inválidos.'); return; }
  if ((body.isPrivate !== undefined || body.allowedRoleIds !== undefined || body.permissionOverrides !== undefined) && !await hasServerPermission(access.member, access.server._id, 'manage_channel_permissions')) { sendError(response, 403, 'Você não tem permissão para alterar o acesso do canal.'); return; }
  if (body.name !== undefined) channel.name = body.name; if (body.description !== undefined) channel.description = body.description.trim(); if (body.kind !== undefined) channel.kind = body.kind; if (body.posting !== undefined) channel.posting = body.posting; if (body.repliesEnabled !== undefined) channel.repliesEnabled = body.repliesEnabled; if (body.position !== undefined) channel.position = body.position;
  if (body.categoryId !== undefined) { const category = await MessageServerCategory.findOne({ _id: body.categoryId, tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } }); if (!category) { sendError(response, 404, 'Categoria não encontrada neste servidor.'); return; } channel.categoryId = category._id; }
  if (body.allowedRoleIds !== undefined) { const roles = await MessageServerCustomRole.find({ _id: { $in: body.allowedRoleIds }, tenantId: tenantId(request), serverId: access.server._id }).select('_id').lean(); if (roles.length !== body.allowedRoleIds.length) { sendError(response, 400, 'Um ou mais cargos de acesso não pertencem a este servidor.'); return; } channel.allowedRoleIds = roles.map((role) => role._id); }
  if (body.permissionOverrides !== undefined) {
    if (!Array.isArray(body.permissionOverrides) || body.permissionOverrides.length > 120 || body.permissionOverrides.some((item: any) => !item || (item.roleId !== null && !validId(item.roleId)) || !allMessageServerPermissions.includes(item.permission) || !['allow','deny'].includes(item.state))) { sendError(response, 400, 'Regras de permissão do canal inválidas.'); return; }
    const roleIds = [...new Set(body.permissionOverrides.filter((item: any) => item.roleId !== null).map((item: any) => item.roleId))];
    const roles = roleIds.length ? await MessageServerCustomRole.find({ _id: { $in: roleIds }, tenantId: tenantId(request), serverId: access.server._id }).select('_id').lean() : [];
    if (roles.length !== roleIds.length) { sendError(response, 400, 'Um cargo das regras não pertence a este servidor.'); return; }
    channel.permissionOverrides = body.permissionOverrides.map((item: any) => ({ ...(item.roleId ? { roleId: new mongoose.Types.ObjectId(item.roleId) } : {}), permission: item.permission, state: item.state }));
  }
  if (body.isPrivate !== undefined) channel.isPrivate = body.isPrivate; if (body.isPrivate === false) channel.allowedRoleIds = [];
  await channel.save(); await recordAudit(request, access.server._id, 'channel.updated', channel._id, { name: channel.name, categoryId: channel.categoryId.toString(), position: channel.position }); response.json(channelJson(channel));
});
messageServersRouter.delete('/:serverId/channels/:channelId', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'delete_channels'); if (!access) return;
  if (!validId(request.params.channelId)) { sendError(response, 400, 'Canal inválido.'); return; }
  const channel = await MessageServerChannel.findOneAndUpdate({ _id: request.params.channelId, tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } }, { $set: { archivedAt: new Date() } }, { new: true });
  if (!channel) { sendError(response, 404, 'Canal não encontrado.'); return; }
  await recordAudit(request, access.server._id, 'channel.archived', channel._id, { name: channel.name }); response.status(204).end();
});

messageServersRouter.get('/:serverId/invite-candidates', async (request, response) => {
  const access = await adminAccess(request, response, request.params.serverId, 'manage_invites'); if (!access) return;
  const q = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 80) : '';
  const accounts = await Account.find({ tenantId: tenantId(request), status: 'active' }).select('_id').lean();
  const [members, bans] = await Promise.all([
    MessageServerMember.find({ tenantId: tenantId(request), serverId: access.server._id }).select('accountId').lean(),
    MessageServerBan.find({ tenantId: tenantId(request), serverId: access.server._id, revokedAt: { $exists: false }, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] }).select('accountId').lean(),
  ]);
  const excluded = new Set([...members.map((item) => item.accountId.toString()), ...bans.map((item) => item.accountId.toString()), accountId(request).toString()]);
  const selector: Record<string, unknown> = { tenantId: tenantId(request), accountId: { $in: accounts.map((item) => item._id).filter((id) => !excluded.has(id.toString())) } };

  // The picker must include every eligible account in the tenant so “Selecionar todos”
  // really applies to the complete list, not just the first page of results.
  const people = await Character.find(selector).select('_id displayName username avatarUrl').sort({ displayName: 1 }).lean();
  const filtered = q ? people.filter((person) => `${person.displayName} ${person.username}`.toLowerCase().includes(q.replace(/^@/, '').toLowerCase())) : people;
  response.json(filtered.map((person) => ({ id: person._id.toString(), displayName: person.displayName, username: person.username, avatarUrl: person.avatarUrl ?? '' })));
});

messageServersRouter.get('/:serverId/channels/:channelId/messages', async (request, response) => {
  const access = await authorizedServer(request, request.params.serverId);
  if (!access || !validId(request.params.channelId)) { sendError(response, 404, 'Canal não encontrado ou você não tem acesso.'); return; }
  const channel = await MessageServerChannel.findOne({ _id: request.params.channelId, tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } }).lean();
  if (!channel) { sendError(response, 404, 'Canal não encontrado ou você não tem acesso.'); return; }
  const viewerRoles = channel.isPrivate ? await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: (access.member as any).roleIds ?? [] } }).select('permissions').lean() : [];
  if (!canAccessChannel(access.member, channel, viewerRoles)) { sendError(response, 404, 'Canal não encontrado ou você não tem acesso.'); return; }
  if (channel.kind === 'posts' || channel.kind === 'voice') { sendError(response, 400, 'Este canal não contém mensagens tradicionais.'); return; }
  const selector: Record<string, any> = { tenantId: tenantId(request), serverId: access.server._id, channelId: channel._id };
  const aroundId = typeof request.query.around === 'string' && validId(request.query.around) ? request.query.around : '';
  let messages:any[]=[];
  if (aroundId) {
    const target = await MessageServerMessage.findOne({ _id: aroundId, ...selector }).select('createdAt').lean();
    if (target) { const date = new Date(target.createdAt ?? Date.now()); const [older,newer]=await Promise.all([MessageServerMessage.find({...selector,createdAt:{$lt:date}}).sort({createdAt:-1}).limit(100).lean(),MessageServerMessage.find({...selector,_id:aroundId}).lean().then(async(found)=>found.length?found:MessageServerMessage.find({...selector,createdAt:{$gte:date}}).sort({createdAt:1}).limit(100).lean())]);messages=[...older.reverse(),...newer]; }
  }
  if(!messages.length)messages=await MessageServerMessage.find(selector).sort({ createdAt: -1 }).limit(100).lean();
  const [config, memberships] = await Promise.all([MessageServerConfig.findOne({ tenantId: tenantId(request), serverId: access.server._id }).select('tag tagColor').lean(), MessageServerMember.find({ tenantId: tenantId(request), serverId: access.server._id, showTag: true }).select('accountId').lean()]);
  const tagMembers = new Set(memberships.map((item) => item.accountId.toString()));
  response.json(messages.reverse().map((message) => {
    const deletedByAdmin = Boolean(message.deletedAt && message.deletedBy && !message.deletedBy.equals(message.authorAccountId));
    return {
      id: message._id.toString(), serverId: message.serverId.toString(), channelId: message.channelId.toString(),
      content: message.deletedAt ? (deletedByAdmin ? 'Mensagem apagada por um admin.' : 'Mensagem removida.') : message.content,
      deleted: Boolean(message.deletedAt), deletedByAdmin, own: message.authorAccountId.equals(accountId(request)), createdAt: message.createdAt, attachments: message.attachments ?? [], pinned: Boolean(message.pinnedAt), pinnedAt: message.pinnedAt ?? null,
      author: { id: message.authorProfileId.toString(), displayName: message.authorName, username: message.authorUsername, avatarUrl: message.authorAvatarUrl, system: Boolean(message.system), ...(config?.tag && tagMembers.has(message.authorAccountId.toString()) ? { tag: config.tag, tagColor: config.tagColor } : {}) },
    };
  }));
});

messageServersRouter.get('/:serverId/channels/:channelId/pins', async (request, response) => {
  const access = await authorizedServer(request, request.params.serverId);
  if (!access || !validId(request.params.channelId)) { sendError(response,404,'Canal não encontrado ou você não tem acesso.'); return; }
  const channel = await MessageServerChannel.findOne({ _id: request.params.channelId, tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } }).lean();
  const viewerRoles=channel?.isPrivate?await MessageServerCustomRole.find({tenantId:tenantId(request),serverId:access.server._id,_id:{$in:(access.member as any).roleIds??[]}}).select('permissions').lean():[];
  if (!channel || channel.kind === 'posts' || channel.kind === 'voice' || !canAccessChannel(access.member,channel,viewerRoles)) { sendError(response,404,'Canal não encontrado ou você não tem acesso.'); return; }
  const pins=await MessageServerMessage.find({tenantId:tenantId(request),serverId:access.server._id,channelId:channel._id,pinnedAt:{$exists:true},deletedAt:{$exists:false}}).sort({pinnedAt:-1}).lean();
  response.json(pins.map((message)=>({id:message._id.toString(),content:message.content,createdAt:message.createdAt,pinnedAt:message.pinnedAt,attachments:message.attachments??[],author:{id:message.authorProfileId.toString(),displayName:message.authorName,avatarUrl:message.authorAvatarUrl}})));
});

messageServersRouter.patch('/:serverId/channels/:channelId/messages/:messageId/pin', async (request,response)=>{
  const access=await authorizedServer(request,request.params.serverId);
  if(!access||!validId(request.params.channelId)||!validId(request.params.messageId)){sendError(response,404,'Mensagem não encontrada.');return;}
  const channel=await MessageServerChannel.findOne({_id:request.params.channelId,tenantId:tenantId(request),serverId:access.server._id,archivedAt:{$exists:false}}).lean();
  const viewerRoles=channel?.isPrivate?await MessageServerCustomRole.find({tenantId:tenantId(request),serverId:access.server._id,_id:{$in:(access.member as any).roleIds??[]}}).select('permissions').lean():[];
  if(!channel||channel.kind==='posts'||channel.kind==='voice'||!canAccessChannel(access.member,channel,viewerRoles)){sendError(response,404,'Canal não encontrado.');return;}
  if(!await hasChannelPermission(access.member,access.server._id,channel,'pin_messages')&&!await hasChannelPermission(access.member,access.server._id,channel,'manage_messages')){sendError(response,403,'Você não tem permissão para fixar mensagens.');return;}
  const message=await MessageServerMessage.findOne({_id:request.params.messageId,tenantId:tenantId(request),serverId:access.server._id,channelId:channel._id,deletedAt:{$exists:false}});
  if(!message){sendError(response,404,'Mensagem não encontrada neste canal.');return;}
  if(request.body?.pinned===true){message.pinnedAt=message.pinnedAt??new Date();message.pinnedByAccountId=message.pinnedByAccountId??accountId(request);await message.save();await recordAudit(request,access.server._id,'message.pinned',message._id,{channelId:channel._id.toString()});}
  else {message.pinnedAt=undefined;message.pinnedByAccountId=undefined;await message.save();await recordAudit(request,access.server._id,'message.unpinned',message._id,{channelId:channel._id.toString()});}
  response.json({id:message._id.toString(),pinned:Boolean(message.pinnedAt),pinnedAt:message.pinnedAt??null});
});

messageServersRouter.get('/:serverId/channels/:channelId/posts',async(request,response)=>{
  const access=await authorizedServer(request,request.params.serverId);if(!access||!validId(request.params.channelId)){sendError(response,404,'Canal não encontrado ou você não tem acesso.');return;}
  const channel=await MessageServerChannel.findOne({_id:request.params.channelId,tenantId:tenantId(request),serverId:access.server._id,archivedAt:{$exists:false}}).lean();
  const roles=channel?.isPrivate?await MessageServerCustomRole.find({tenantId:tenantId(request),serverId:access.server._id,_id:{$in:(access.member as any).roleIds??[]}}).select('permissions').lean():[];
  if(!channel||channel.kind!=='posts'||!canAccessChannel(access.member,channel,roles)){sendError(response,404,'Canal de publicações não encontrado ou você não tem acesso.');return;}
  const selector:Record<string,any>={tenantId:tenantId(request),serverId:access.server._id,channelId:channel._id,deletedAt:{$exists:false}};
  if(request.query.pinned==='1')selector.pinnedAt={$exists:true};
  if(typeof request.query.q==='string'&&request.query.q.trim()){const q=request.query.q.trim().slice(0,100).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');selector.$or=[{title:{$regex:q,$options:'i'}},{content:{$regex:q,$options:'i'}}];}
  const sort:Record<string,1|-1>=request.query.sort==='activity'?{updatedAt:-1}:{createdAt:-1};
  const posts=await MessageServerPost.find(selector).sort({pinnedAt:-1,...sort}).limit(100).lean();
  response.json(posts.map((post)=>({id:post._id.toString(),channelId:post.channelId.toString(),title:post.title,content:post.content,cover:post.cover??null,attachments:post.attachments??[],pinned:Boolean(post.pinnedAt),pinnedAt:post.pinnedAt??null,replyCount:post.replyCount??0,createdAt:post.createdAt,updatedAt:post.updatedAt,own:post.authorAccountId.equals(accountId(request)),author:{id:post.authorProfileId.toString(),displayName:post.authorName,avatarUrl:post.authorAvatarUrl}})));
});

messageServersRouter.post('/:serverId/channels/:channelId/posts',async(request,response)=>{
  const access=await authorizedServer(request,request.params.serverId);if(!access||!validId(request.params.channelId)){sendError(response,404,'Canal não encontrado ou você não tem acesso.');return;}
  const channel=await MessageServerChannel.findOne({_id:request.params.channelId,tenantId:tenantId(request),serverId:access.server._id,archivedAt:{$exists:false}}).lean();
  const roles=channel?.isPrivate?await MessageServerCustomRole.find({tenantId:tenantId(request),serverId:access.server._id,_id:{$in:(access.member as any).roleIds??[]}}).select('permissions').lean():[];
  if(!channel||channel.kind!=='posts'||!canAccessChannel(access.member,channel,roles)){sendError(response,404,'Canal de publicações não encontrado ou você não tem acesso.');return;}
  if(channelOverrideState(access.member,channel,'create_posts')==='deny'||channel.posting==='staff'&&!await hasChannelPermission(access.member,access.server._id,channel,'create_posts')){sendError(response,403,'Você não tem permissão para criar publicações neste canal.');return;}
  const title=typeof request.body?.title==='string'?request.body.title.trim():'';const rawContent=request.body?.content;const content=sanitizeFormattedText(rawContent,10000)??'';
  if(title.length<2||title.length>120||rawContent!==undefined&&content===''&&typeof rawContent!=='string'||typeof rawContent==='string'&&rawContent.length>10000){sendError(response,400,'Informe um título de 2 a 120 caracteres e conteúdo de até 10.000 caracteres.');return;}
  const raw=request.body?.attachments;const hasImage=Array.isArray(raw)&&raw.some((item:any)=>/^data:image\//i.test(item?.dataUrl??''));const hasFile=Array.isArray(raw)&&raw.some((item:any)=>typeof item?.dataUrl==='string'&&!/^data:image\//i.test(item.dataUrl));
  if((request.body?.cover?.dataUrl||hasImage)&&!await hasChannelPermission(access.member,access.server._id,channel,'send_images')){sendError(response,403,'Você não tem permissão para anexar imagens.');return;}
  if(hasFile&&!await hasChannelPermission(access.member,access.server._id,channel,'attach_files')){sendError(response,403,'Você não tem permissão para anexar arquivos.');return;}
  let attachments:MessageServerAttachment[]=[];let cover:MessageServerAttachment|undefined;
  try{attachments=await saveMessageServerFiles(raw,request.vybeTenant!.slug,5);if(request.body?.cover!==undefined&&request.body.cover!==null){const images=await saveMessageServerFiles([request.body.cover],request.vybeTenant!.slug,1);if(images[0]&&!images[0].mimeType.startsWith('image/'))throw new Error('A capa precisa ser uma imagem.');cover=images[0];}}catch(reason){sendError(response,400,reason instanceof Error?reason.message:'Anexo inválido.');return;}
  const author=request.vybeCharacter!;const post=await MessageServerPost.create({tenantId:tenantId(request),serverId:access.server._id,channelId:channel._id,authorAccountId:accountId(request),authorProfileId:profileId(request),authorName:author.displayName,authorAvatarUrl:author.avatarUrl,title,content,cover,attachments});
  const members=await MessageServerMember.find({tenantId:tenantId(request),serverId:access.server._id}).select('profileId role roleIds notificationPreference').lean();const roleIds=members.flatMap((member)=>(member as any).roleIds??[]);const allRoles=roleIds.length?await MessageServerCustomRole.find({tenantId:tenantId(request),serverId:access.server._id,_id:{$in:roleIds}}).select('_id name permissions').lean():[];const rolesById=new Map(allRoles.map((role)=>[role._id.toString(),role]));const visible=members.filter((member)=>canAccessChannel(member,channel,((member as any).roleIds??[]).map((id:mongoose.Types.ObjectId)=>rolesById.get(id.toString())).filter((role:any)=>Boolean(role))));
  const profiles=await Character.find({tenantId:tenantId(request),_id:{$in:visible.map((member)=>member.profileId)}}).select('_id username').lean();const names=new Map(profiles.map((item)=>[item._id.toString(),item.username]));const notifications=visible.filter((member)=>!member.profileId.equals(profileId(request))&&(member as any).notificationPreference!=='muted'&&((member as any).notificationPreference==='all'||(member as any).notificationPreference===undefined||names.get(member.profileId.toString())&&new RegExp(`@${String(names.get(member.profileId.toString())).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\w.-])`,'i').test(content))).map((member)=>({tenantId:tenantId(request),characterId:member.profileId,actorId:profileId(request),type:'server_message' as const,targetId:post._id,serverId:access.server._id,channelId:channel._id}));
  if(notifications.length)await Notification.insertMany(notifications,{ordered:false}).catch(()=>undefined);emitToProfiles(tenantId(request).toString(),visible.map((member)=>member.profileId),{type:'server:message',serverId:access.server._id.toString(),channelId:channel._id.toString()});
  response.status(201).json({id:post._id.toString(),channelId:channel._id.toString(),title,content,cover:cover??null,attachments,replyCount:0,pinned:false,createdAt:post.createdAt,updatedAt:post.updatedAt,own:true,author:{id:profileId(request).toString(),displayName:author.displayName,avatarUrl:author.avatarUrl}});
});

messageServersRouter.get('/:serverId/channels/:channelId/posts/:postId',async(request,response)=>{
  const access=await authorizedServer(request,request.params.serverId);if(!access||!validId(request.params.channelId)||!validId(request.params.postId)){sendError(response,404,'Publicação não encontrada.');return;}
  const channel=await MessageServerChannel.findOne({_id:request.params.channelId,tenantId:tenantId(request),serverId:access.server._id,kind:'posts',archivedAt:{$exists:false}}).lean();const roles=channel?.isPrivate?await MessageServerCustomRole.find({tenantId:tenantId(request),serverId:access.server._id,_id:{$in:(access.member as any).roleIds??[]}}).select('permissions').lean():[];
  if(!channel||!canAccessChannel(access.member,channel,roles)){sendError(response,404,'Publicação não encontrada.');return;}
  const post=await MessageServerPost.findOne({_id:request.params.postId,tenantId:tenantId(request),serverId:access.server._id,channelId:channel._id,deletedAt:{$exists:false}}).lean();if(!post){sendError(response,404,'Publicação não encontrada.');return;}
  response.json({id:post._id.toString(),channelId:post.channelId.toString(),title:post.title,content:post.content,cover:post.cover??null,attachments:post.attachments??[],pinned:Boolean(post.pinnedAt),pinnedAt:post.pinnedAt??null,replyCount:post.replyCount??0,createdAt:post.createdAt,updatedAt:post.updatedAt,own:post.authorAccountId.equals(accountId(request)),canManage:await hasChannelPermission(access.member,access.server._id,channel,'manage_posts'),author:{id:post.authorProfileId.toString(),displayName:post.authorName,avatarUrl:post.authorAvatarUrl}});
});

messageServersRouter.get('/:serverId/channels/:channelId/posts/:postId/replies',async(request,response)=>{
  const access=await authorizedServer(request,request.params.serverId);if(!access||!validId(request.params.channelId)||!validId(request.params.postId)){sendError(response,404,'Publicação não encontrada.');return;}
  const channel=await MessageServerChannel.findOne({_id:request.params.channelId,tenantId:tenantId(request),serverId:access.server._id,kind:'posts',archivedAt:{$exists:false}}).lean();const roles=channel?.isPrivate?await MessageServerCustomRole.find({tenantId:tenantId(request),serverId:access.server._id,_id:{$in:(access.member as any).roleIds??[]}}).select('permissions').lean():[];
  if(!channel||!canAccessChannel(access.member,channel,roles)||!await MessageServerPost.exists({_id:request.params.postId,tenantId:tenantId(request),serverId:access.server._id,channelId:channel._id,deletedAt:{$exists:false}})){sendError(response,404,'Publicação não encontrada.');return;}
  const replies=await MessageServerPostReply.find({tenantId:tenantId(request),serverId:access.server._id,channelId:channel._id,postId:request.params.postId}).sort({createdAt:1}).limit(500).lean();response.json(replies.map((reply)=>({id:reply._id.toString(),content:reply.deletedAt?'Resposta removida.':reply.content,deleted:Boolean(reply.deletedAt),attachments:reply.attachments??[],createdAt:reply.createdAt,own:reply.authorAccountId.equals(accountId(request)),author:{id:reply.authorProfileId.toString(),displayName:reply.authorName,avatarUrl:reply.authorAvatarUrl}})));
});

messageServersRouter.post('/:serverId/channels/:channelId/posts/:postId/replies',async(request,response)=>{
  const access=await authorizedServer(request,request.params.serverId);if(!access||!validId(request.params.channelId)||!validId(request.params.postId)){sendError(response,404,'Publicação não encontrada.');return;}
  const channel=await MessageServerChannel.findOne({_id:request.params.channelId,tenantId:tenantId(request),serverId:access.server._id,kind:'posts',archivedAt:{$exists:false}}).lean();const roles=channel?.isPrivate?await MessageServerCustomRole.find({tenantId:tenantId(request),serverId:access.server._id,_id:{$in:(access.member as any).roleIds??[]}}).select('permissions').lean():[];
  if(!channel||!canAccessChannel(access.member,channel,roles)){sendError(response,404,'Publicação não encontrada.');return;}
  if(!channel.repliesEnabled){sendError(response,403,'As respostas estão desativadas neste canal.');return;}
  if(channelOverrideState(access.member,channel,'reply_posts')==='deny'||channel.posting==='staff'&&!await hasChannelPermission(access.member,access.server._id,channel,'reply_posts')){sendError(response,403,'Você não tem permissão para responder a publicações.');return;}
  const rawContent=request.body?.content;const content=sanitizeFormattedText(rawContent,4000)??'';const raw=request.body?.attachments;if(rawContent!==undefined&&(typeof rawContent!=='string'||rawContent.length>4000)||!content&&(!Array.isArray(raw)||!raw.length)){sendError(response,400,'Informe uma resposta ou um anexo.');return;}
  if(Array.isArray(raw)){const images=raw.some((item:any)=>/^data:image\//i.test(item?.dataUrl??''));const files=raw.some((item:any)=>typeof item?.dataUrl==='string'&&!/^data:image\//i.test(item.dataUrl));if(images&&!await hasChannelPermission(access.member,access.server._id,channel,'send_images')){sendError(response,403,'Você não tem permissão para anexar imagens.');return;}if(files&&!await hasChannelPermission(access.member,access.server._id,channel,'attach_files')){sendError(response,403,'Você não tem permissão para anexar arquivos.');return;}}
  let attachments:MessageServerAttachment[]=[];try{attachments=await saveMessageServerFiles(raw,request.vybeTenant!.slug,5);}catch(reason){sendError(response,400,reason instanceof Error?reason.message:'Anexo inválido.');return;}
  const post=await MessageServerPost.findOne({_id:request.params.postId,tenantId:tenantId(request),serverId:access.server._id,channelId:channel._id,deletedAt:{$exists:false}});if(!post){sendError(response,404,'Publicação não encontrada.');return;}
  const author=request.vybeCharacter!;const reply=await MessageServerPostReply.create({tenantId:tenantId(request),serverId:access.server._id,channelId:channel._id,postId:post._id,authorAccountId:accountId(request),authorProfileId:profileId(request),authorName:author.displayName,authorAvatarUrl:author.avatarUrl,content,attachments});post.replyCount=(post.replyCount??0)+1;await post.save();
  if(!post.authorProfileId.equals(profileId(request))){const recipient=await MessageServerMember.findOne({tenantId:tenantId(request),serverId:access.server._id,profileId:post.authorProfileId}).select('notificationPreference').lean();if(recipient?.notificationPreference!=='muted')await Notification.create({tenantId:tenantId(request),characterId:post.authorProfileId,actorId:profileId(request),type:'server_message',targetId:post._id,serverId:access.server._id,channelId:channel._id}).catch(()=>undefined);}
  emitToProfiles(tenantId(request).toString(),[post.authorProfileId],{type:'server:message',serverId:access.server._id.toString(),channelId:channel._id.toString()});response.status(201).json({id:reply._id.toString(),content,attachments,deleted:false,createdAt:reply.createdAt,own:true,author:{id:profileId(request).toString(),displayName:author.displayName,avatarUrl:author.avatarUrl}});
});

messageServersRouter.patch('/:serverId/channels/:channelId/posts/:postId/pin',async(request,response)=>{
  const access=await authorizedServer(request,request.params.serverId);if(!access||!validId(request.params.channelId)||!validId(request.params.postId)){sendError(response,404,'Publicação não encontrada.');return;}
  const channel=await MessageServerChannel.findOne({_id:request.params.channelId,tenantId:tenantId(request),serverId:access.server._id,kind:'posts',archivedAt:{$exists:false}}).lean();const roles=channel?.isPrivate?await MessageServerCustomRole.find({tenantId:tenantId(request),serverId:access.server._id,_id:{$in:(access.member as any).roleIds??[]}}).select('permissions').lean():[];
  if(!channel||!canAccessChannel(access.member,channel,roles)){sendError(response,404,'Publicação não encontrada.');return;}
  if(!await hasChannelPermission(access.member,access.server._id,channel,'pin_posts')){sendError(response,403,'Você não tem permissão para fixar publicações.');return;}
  const post=await MessageServerPost.findOne({_id:request.params.postId,tenantId:tenantId(request),serverId:access.server._id,channelId:channel._id,deletedAt:{$exists:false}});if(!post){sendError(response,404,'Publicação não encontrada.');return;}
  if(request.body?.pinned===true){post.pinnedAt=post.pinnedAt??new Date();post.pinnedByAccountId=post.pinnedByAccountId??accountId(request);}else{post.pinnedAt=undefined;post.pinnedByAccountId=undefined;}await post.save();await recordAudit(request,access.server._id,post.pinnedAt?'post.pinned':'post.unpinned',post._id,{channelId:channel._id.toString()});response.json({id:post._id.toString(),pinned:Boolean(post.pinnedAt),pinnedAt:post.pinnedAt??null});
});

messageServersRouter.patch('/:serverId/channels/:channelId/posts/:postId',async(request,response)=>{
  const access=await authorizedServer(request,request.params.serverId);if(!access||!validId(request.params.channelId)||!validId(request.params.postId)){sendError(response,404,'Publicação não encontrada.');return;}
  const channel=await MessageServerChannel.findOne({_id:request.params.channelId,tenantId:tenantId(request),serverId:access.server._id,kind:'posts',archivedAt:{$exists:false}}).lean();const roles=channel?.isPrivate?await MessageServerCustomRole.find({tenantId:tenantId(request),serverId:access.server._id,_id:{$in:(access.member as any).roleIds??[]}}).select('permissions').lean():[];
  if(!channel||!canAccessChannel(access.member,channel,roles)){sendError(response,404,'Publicação não encontrada.');return;}
  const post=await MessageServerPost.findOne({_id:request.params.postId,tenantId:tenantId(request),serverId:access.server._id,channelId:channel._id,deletedAt:{$exists:false}});if(!post){sendError(response,404,'Publicação não encontrada.');return;}
  const moderator=!post.authorAccountId.equals(accountId(request));if(moderator&&!await hasChannelPermission(access.member,access.server._id,channel,'manage_posts')){sendError(response,403,'Você não pode editar uma publicação de outra pessoa.');return;}
  const title=request.body?.title;const rawContent=request.body?.content;const content=rawContent===undefined?undefined:sanitizeFormattedText(rawContent,10000);if(title!==undefined&&(typeof title!=='string'||title.trim().length<2||title.trim().length>120)||rawContent!==undefined&&typeof content!=='string'||title===undefined&&content===undefined){sendError(response,400,'Título ou conteúdo inválido.');return;}
  if(title!==undefined)post.title=title.trim();if(typeof content==='string')post.content=content;post.editedAt=new Date();await post.save();if(moderator)await recordAudit(request,access.server._id,'post.edited_by_moderator',post._id,{channelId:channel._id.toString(),authorAccountId:post.authorAccountId.toString()});response.json({id:post._id.toString(),title:post.title,content:post.content,editedAt:post.editedAt});
});

messageServersRouter.delete('/:serverId/channels/:channelId/posts/:postId',async(request,response)=>{
  const access=await authorizedServer(request,request.params.serverId);if(!access||!validId(request.params.channelId)||!validId(request.params.postId)){sendError(response,404,'Publicação não encontrada.');return;}
  const channel=await MessageServerChannel.findOne({_id:request.params.channelId,tenantId:tenantId(request),serverId:access.server._id,kind:'posts',archivedAt:{$exists:false}}).lean();const roles=channel?.isPrivate?await MessageServerCustomRole.find({tenantId:tenantId(request),serverId:access.server._id,_id:{$in:(access.member as any).roleIds??[]}}).select('permissions').lean():[];
  if(!channel||!canAccessChannel(access.member,channel,roles)){sendError(response,404,'Publicação não encontrada.');return;}
  const post=await MessageServerPost.findOne({_id:request.params.postId,tenantId:tenantId(request),serverId:access.server._id,channelId:channel._id,deletedAt:{$exists:false}});if(!post){sendError(response,404,'Publicação não encontrada.');return;}
  const moderator=!post.authorAccountId.equals(accountId(request));if(moderator&&!await hasChannelPermission(access.member,access.server._id,channel,'manage_posts')){sendError(response,403,'Você não pode remover a publicação de outra pessoa.');return;}
  post.deletedAt=new Date();await post.save();if(moderator)await recordAudit(request,access.server._id,'post.deleted_by_moderator',post._id,{channelId:channel._id.toString(),authorAccountId:post.authorAccountId.toString()});response.status(204).end();
});

messageServersRouter.post('/:serverId/channels/:channelId/messages', async (request, response) => {
  const access = await authorizedServer(request, request.params.serverId);
  if (!access || !validId(request.params.channelId)) { sendError(response, 404, 'Canal não encontrado ou você não tem acesso.'); return; }
  const channel = await MessageServerChannel.findOne({ _id: request.params.channelId, tenantId: tenantId(request), serverId: access.server._id, archivedAt: { $exists: false } });
  if (!channel) { sendError(response, 404, 'Canal não encontrado ou você não tem acesso.'); return; }
  const senderRoles = channel.isPrivate ? await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: (access.member as any).roleIds ?? [] } }).select('permissions').lean() : [];
  if (!canAccessChannel(access.member, channel, senderRoles)) { sendError(response, 404, 'Canal não encontrado ou você não tem acesso.'); return; }
  if (channel.kind === 'voice') { sendError(response, 400, 'Este é um canal de voz e não recebe mensagens de texto.'); return; }
  if (channelOverrideState(access.member,channel,'send_messages')==='deny' || channel.posting==='staff' && !await hasChannelPermission(access.member,access.server._id,channel,'send_messages')) { sendError(response, 403, 'Você não tem permissão para publicar neste canal.'); return; }
  if (await MessageServerRestriction.exists({ tenantId: tenantId(request), serverId: access.server._id, accountId: accountId(request), revokedAt: { $exists: false }, $or: [{ mutedUntil: { $exists: false } }, { mutedUntil: { $gt: new Date() } }] })) { sendError(response, 403, 'Seu acesso ao envio de mensagens está temporariamente restrito.'); return; }
  const rawContent=request.body?.content;const content = sanitizeFormattedText(rawContent, 2000) ?? '';
  const rawAttachments=request.body?.attachments;
  if (rawContent!==undefined&&(typeof rawContent!=='string'||rawContent.length>2000) || (!content && (!Array.isArray(rawAttachments)||!rawAttachments.length))) { sendError(response, 400, 'Informe uma mensagem ou um anexo.'); return; }
  if(Array.isArray(rawAttachments)){const hasImages=rawAttachments.some((item:any)=>typeof item?.dataUrl==='string'&&/^data:image\//i.test(item.dataUrl));const hasFiles=rawAttachments.some((item:any)=>typeof item?.dataUrl==='string'&&!/^data:image\//i.test(item.dataUrl));if(hasImages&&!await hasChannelPermission(access.member,access.server._id,channel,'send_images')){sendError(response,403,'Você não tem permissão para enviar imagens.');return;}if(hasFiles&&!await hasChannelPermission(access.member,access.server._id,channel,'attach_files')){sendError(response,403,'Você não tem permissão para anexar arquivos.');return;}}
  let attachments:MessageServerAttachment[]=[];
  try{attachments=await saveMessageServerFiles(rawAttachments,request.vybeTenant!.slug,5);}catch(reason){sendError(response,400,reason instanceof Error?reason.message:'Anexo inválido.');return;}
  const spamConfig = await MessageServerConfig.findOne({ tenantId: tenantId(request), serverId: access.server._id }).select('antiSpamEnabled limitRepeatedLinks').lean();
  if (spamConfig?.antiSpamEnabled) {
    const now = Date.now();
    const recentByAuthor = await MessageServerMessage.find({ tenantId: tenantId(request), serverId: access.server._id, authorAccountId: accountId(request), createdAt: { $gte: new Date(now - 60_000) }, deletedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(20).select('channelId content createdAt').lean();
    if (recentByAuthor.filter((message) => new Date(message.createdAt ?? 0).getTime() > now - 8_000).length >= 5) { response.setHeader('Retry-After', '8'); sendError(response, 429, 'Você está enviando mensagens muito rápido. Aguarde alguns segundos e tente novamente.'); return; }
    const sameChannelRecent = recentByAuthor.filter((message) => message.channelId.equals(channel._id));
    if (sameChannelRecent.slice(0, 2).length === 2 && sameChannelRecent.slice(0, 2).every((message) => message.content.trim().toLocaleLowerCase() === content.toLocaleLowerCase())) { sendError(response, 429, 'Esta mensagem já foi enviada repetidamente. Edite o texto antes de tentar de novo.'); return; }
    if (spamConfig.limitRepeatedLinks) {
      const links = [...content.matchAll(/https?:\/\/[^\s<>()]+/gi)].map((match) => match[0].replace(/[.,!?;:]+$/,'').toLowerCase());
      const repeated = links.find((link) => recentByAuthor.filter((message) => [...message.content.matchAll(/https?:\/\/[^\s<>()]+/gi)].some((match) => match[0].replace(/[.,!?;:]+$/,'').toLowerCase() === link)).length >= 2);
      if (repeated) { sendError(response, 429, 'Este link foi enviado várias vezes recentemente. Aguarde antes de compartilhá-lo novamente.'); return; }
    }
  }
  const contentRoleMentions = /@(everyone|here)\b/i.test(content);
  const rolesMentionedInContent = await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id }).select('name').lean();
  const mentionsCustomRole = rolesMentionedInContent.some((role) => new RegExp(`@${role.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i').test(content));
  if ((contentRoleMentions || mentionsCustomRole) && !await hasServerPermission(access.member, access.server._id, 'mention_roles')) { sendError(response, 403, 'Você não tem permissão para mencionar cargos ou todos os participantes.'); return; }
  const author = request.vybeCharacter!;
  const message = await MessageServerMessage.create({ tenantId: tenantId(request), serverId: access.server._id, channelId: channel._id, authorAccountId: accountId(request), authorProfileId: profileId(request), authorName: author.displayName, authorUsername: author.username, authorAvatarUrl: author.avatarUrl, content, attachments });
  const [serverConfig, currentMember] = await Promise.all([MessageServerConfig.findOne({ tenantId: tenantId(request), serverId: access.server._id }).select('tag tagColor defaultNotifications').lean(), MessageServerMember.findOne({ tenantId: tenantId(request), serverId: access.server._id, accountId: accountId(request) }).select('showTag').lean()]);
  const serverMembers = await MessageServerMember.find({ tenantId: tenantId(request), serverId: access.server._id }).select('profileId role roleIds notificationPreference').lean();
  const allAssignedRoleIds = serverMembers.flatMap((member) => (member as any).roleIds ?? []);
  const serverRoles = allAssignedRoleIds.length ? await MessageServerCustomRole.find({ tenantId: tenantId(request), serverId: access.server._id, _id: { $in: allAssignedRoleIds } }).select('_id name permissions').lean() : [];
  const serverRoleMap = new Map(serverRoles.map((role) => [role._id.toString(), role]));
  const visibleMembers = serverMembers.filter((member) => canAccessChannel(member, channel, ((member as any).roleIds ?? []).map((id: mongoose.Types.ObjectId) => serverRoleMap.get(id.toString())).filter((role: { permissions: string[] } | undefined): role is { permissions: string[] } => Boolean(role))));
  const visibleProfiles = visibleMembers.map((item) => item.profileId);
  const mentionEveryone = contentRoleMentions;
  const mentionedRoles = serverRoles.filter((role) => new RegExp(`@${role.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i').test(content)).map((role) => role._id.toString());
  const profiles = visibleMembers.length ? await Character.find({ tenantId: tenantId(request), _id: { $in: visibleProfiles } }).select('_id username').lean() : [];
  const profileNames = new Map(profiles.map((person) => [person._id.toString(), person.username]));
  const noticeRows = visibleMembers.filter((member) => {
    if (member.profileId.equals(profileId(request))) return false;
    const preference = (member as any).notificationPreference ?? serverConfig?.defaultNotifications ?? 'mentions';
    if (preference === 'muted') return false;
    if (preference === 'all' || mentionEveryone) return true;
    const username = profileNames.get(member.profileId.toString());
    const userMentioned = username ? new RegExp(`@${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`, 'i').test(content) : false;
    const roleMentioned = ((member as any).roleIds ?? []).some((id: mongoose.Types.ObjectId) => mentionedRoles.includes(id.toString()));
    return userMentioned || roleMentioned;
  }).map((member) => ({ tenantId: tenantId(request), characterId: member.profileId, actorId: profileId(request), type: 'server_message' as const, targetId: message._id, serverId: access.server._id, channelId: channel._id }));
  if (noticeRows.length) await Notification.insertMany(noticeRows, { ordered: false }).catch(() => undefined);
  emitToProfiles(tenantId(request).toString(), visibleProfiles, { type: 'server:message', serverId: access.server._id.toString(), channelId: channel._id.toString() });
  response.status(201).json({ id: message._id.toString(), serverId: message.serverId.toString(), channelId: message.channelId.toString(), content: message.content, attachments, pinned: false, deleted: false, own: true, createdAt: message.createdAt, author: { id: author._id.toString(), displayName: author.displayName, username: author.username, avatarUrl: author.avatarUrl, ...(serverConfig?.tag && currentMember?.showTag ? { tag: serverConfig.tag, tagColor: serverConfig.tagColor } : {}) } });
});

messageServersRouter.delete('/:serverId/messages/:messageId', async (request, response) => {
  const access = await authorizedServer(request, request.params.serverId);
  if (!access || !validId(request.params.messageId)) { sendError(response, 404, 'Mensagem não encontrada ou você não tem acesso.'); return; }
  const message = await MessageServerMessage.findOne({ _id: request.params.messageId, tenantId: tenantId(request), serverId: access.server._id });
  if (!message) { sendError(response, 404, 'Mensagem não encontrada ou você não tem acesso.'); return; }
  if (!message.authorAccountId.equals(accountId(request)) && !await hasServerPermission(access.member, access.server._id, 'manage_messages')) { sendError(response, 403, 'Você não pode remover esta mensagem.'); return; }
  if (!message.deletedAt) { message.deletedAt = new Date(); message.deletedBy = accountId(request); await message.save(); }
  response.status(204).end();
});
