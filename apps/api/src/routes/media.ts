import { Router } from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireTenant } from '../middleware/tenant.js';
import { requireSession } from '../middleware/tenant.js';
import { Conversation, ConversationMessage } from '../models/Conversation.js';
import { MessageAppProfile } from '../models/MessageAppProfile.js';
import { CommunityJoinRequest } from '../models/CommunityJoinRequest.js';
import { MessageServerChannel, MessageServerMember, MessageServerMessage, MessageServerPost, MessageServerPostReply } from '../models/MessageServer.js';
import { MessageServerCustomRole } from '../models/MessageServerAdmin.js';

export const mediaRouter = Router();
const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads');

mediaRouter.use(requireTenant);
mediaRouter.get('/:tenantSlug/message-:filename', requireSession, async (request, response) => {
  const tenant = request.vybeTenant!;
  const characterId = request.vybeCharacter!._id;
  const tenantSlug = String(request.params.tenantSlug);
  const filename = String(request.params.filename);
  if (tenantSlug !== tenant.slug || !/^[a-f0-9]{36}\.(png|jpg|webp|gif|pdf|doc|docx|xls|xlsx|txt|zip|webm|ogg|m4a|mp3|wav)$/.test(filename)) { response.status(404).end(); return; }
  const url = `/media/${tenantSlug}/message-${filename}`;
  const [message, group, profile, serverMessage, post, reply] = await Promise.all([
    ConversationMessage.findOne({ tenantId: tenant._id, 'attachment.url': url }).select('conversationId attachment.mimeType').lean(),
    Conversation.findOne({ tenantId: tenant._id, photoUrl: url }).select('_id').lean(),
    MessageAppProfile.exists({ tenantId: tenant._id, avatarUrl: url }),
    MessageServerMessage.findOne({ tenantId: tenant._id, attachments: { $elemMatch: { url } } }).select('serverId channelId attachments').lean(),
    MessageServerPost.findOne({ tenantId: tenant._id, deletedAt: { $exists: false }, $or: [{ 'cover.url': url }, { attachments: { $elemMatch: { url } } }] }).select('serverId channelId cover attachments').lean(),
    MessageServerPostReply.findOne({ tenantId: tenant._id, deletedAt: { $exists: false }, attachments: { $elemMatch: { url } } }).select('serverId channelId attachments').lean(),
  ]);
  const conversationId = message?.conversationId ?? group?._id;
  const canReadConversationFile = conversationId && await Conversation.exists({ _id: conversationId, tenantId: tenant._id, participants: { $elemMatch: { profileId: characterId, leftAt: { $exists: false } } } });
  const serverAsset=serverMessage??post??reply;
  let canReadServerFile=false;
  if(serverAsset){
    const [membership,channel]=await Promise.all([MessageServerMember.findOne({tenantId:tenant._id,serverId:serverAsset.serverId,profileId:characterId}).select('role roleIds').lean(),MessageServerChannel.findOne({_id:serverAsset.channelId,tenantId:tenant._id,serverId:serverAsset.serverId,archivedAt:{$exists:false}}).select('isPrivate allowedRoleIds').lean()]);
    if(membership&&channel){canReadServerFile=!channel.isPrivate||membership.role==='owner'||membership.role==='admin'||(membership.roleIds??[]).some((id)=>channel.allowedRoleIds?.some((allowed)=>allowed.equals(id)));if(!canReadServerFile&&membership.roleIds?.length){const role=await MessageServerCustomRole.exists({tenantId:tenant._id,serverId:serverAsset.serverId,_id:{$in:membership.roleIds},permissions:'view_private_channels'});canReadServerFile=Boolean(role);}}
  }
  if (!profile && !canReadConversationFile && !canReadServerFile) { response.status(404).end(); return; }
  const serverAttachment=serverMessage?.attachments?.find((item)=>item.url===url)??(post?.cover?.url===url?post.cover:undefined)??post?.attachments?.find((item)=>item.url===url)??reply?.attachments?.find((item)=>item.url===url);
  const attachmentMime=message?.attachment?.mimeType??serverAttachment?.mimeType;
  if (attachmentMime) response.type(attachmentMime);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.sendFile(`message-${filename}`, { root: resolve(uploadsDirectory, tenant.slug) }, (error) => { if (error && !response.headersSent) response.status(404).end(); });
});
mediaRouter.get('/:tenantSlug/:filename', requireSession, async (request, response) => {
  const tenant = request.vybeTenant!;
  const tenantSlug = String(request.params.tenantSlug);
  const filename = String(request.params.filename);
  // The server-profile uploader previously generated `server-<36 hex>` names;
  // keep those URLs working while new uploads use the standard 32-hex format.
  if (tenantSlug !== tenant.slug || !/^(?:[a-f0-9]{32}|server-[a-f0-9]{36})\.(png|jpg|webp)$/.test(filename)) {
    response.status(404).end();
    return;
  }
  const isUnapprovedJoinPhoto = await CommunityJoinRequest.exists({ communityId: tenant._id, photoplayerImageFilename: filename, status: { $ne: 'APPROVED' } });
  if (isUnapprovedJoinPhoto) { response.status(404).end(); return; }
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'private, no-cache');
  response.sendFile(filename, { root: resolve(uploadsDirectory, tenant.slug) }, (error) => {
    if (error && !response.headersSent) response.status(404).end();
  });
});
