import { Router } from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireTenant } from '../middleware/tenant.js';
import { requireSession } from '../middleware/tenant.js';
import { Conversation, ConversationMessage } from '../models/Conversation.js';
import { MessageAppProfile } from '../models/MessageAppProfile.js';
import { CommunityJoinRequest } from '../models/CommunityJoinRequest.js';

export const mediaRouter = Router();
const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads');

mediaRouter.use(requireTenant);
mediaRouter.get('/:tenantSlug/message-:filename', requireSession, async (request, response) => {
  const tenant = request.vybeTenant!;
  const characterId = request.vybeCharacter!._id;
  const tenantSlug = String(request.params.tenantSlug);
  const filename = String(request.params.filename);
  if (tenantSlug !== tenant.slug || !/^[a-f0-9]{36}\.(png|jpg|webp|gif|pdf|doc|docx|xls|xlsx|txt|zip)$/.test(filename)) { response.status(404).end(); return; }
  const url = `/media/${tenantSlug}/message-${filename}`;
  const [message, group, profile] = await Promise.all([
    ConversationMessage.findOne({ tenantId: tenant._id, 'attachment.url': url }).select('conversationId').lean(),
    Conversation.findOne({ tenantId: tenant._id, photoUrl: url }).select('_id').lean(),
    MessageAppProfile.exists({ tenantId: tenant._id, avatarUrl: url }),
  ]);
  const conversationId = message?.conversationId ?? group?._id;
  const canReadConversationFile = conversationId && await Conversation.exists({ _id: conversationId, tenantId: tenant._id, participants: { $elemMatch: { profileId: characterId, leftAt: { $exists: false } } } });
  if (!profile && !canReadConversationFile) { response.status(404).end(); return; }
  response.sendFile(`message-${filename}`, { root: resolve(uploadsDirectory, tenant.slug) }, (error) => { if (error && !response.headersSent) response.status(404).end(); });
});
mediaRouter.get('/:tenantSlug/:filename', requireSession, async (request, response) => {
  const tenant = request.vybeTenant!;
  const tenantSlug = String(request.params.tenantSlug);
  const filename = String(request.params.filename);
  if (tenantSlug !== tenant.slug || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(filename)) {
    response.status(404).end();
    return;
  }
  const isUnapprovedJoinPhoto = await CommunityJoinRequest.exists({ communityId: tenant._id, photoplayerImageFilename: filename, status: { $ne: 'APPROVED' } });
  if (isUnapprovedJoinPhoto) { response.status(404).end(); return; }
  response.sendFile(filename, { root: resolve(uploadsDirectory, tenant.slug) }, (error) => {
    if (error && !response.headersSent) response.status(404).end();
  });
});
