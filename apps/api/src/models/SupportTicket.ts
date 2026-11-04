import mongoose from 'mongoose';

export const supportTicketTypes = ['BUG_REPORT', 'TECHNICAL_PROBLEM', 'SYSTEM_ERROR', 'ACCOUNT', 'COMMUNITY', 'COMMUNITY_MANAGEMENT', 'SUGGESTION', 'HELP', 'PAYMENT', 'COMMUNITY_CREATION', 'PLATFORM_DIRECTION', 'VYBE_PLUS', 'REPORT', 'OTHER'] as const;
export type SupportTicketType = typeof supportTicketTypes[number];
export const supportTicketStatuses = ['NEW', 'IN_PROGRESS', 'RESPONDED', 'WAITING_USER', 'RESOLVED', 'CLOSED'] as const;
export type SupportTicketStatus = typeof supportTicketStatuses[number];

const supportTicketSchema = new mongoose.Schema({
  ticketNumber: { type: Number, required: true, unique: true, index: true },
  createdByGlobalAccountId: { type: mongoose.Schema.Types.ObjectId, default: undefined, index: true },
  createdByAccountId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  requesterProfileId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  sourceCommunityId: { type: mongoose.Schema.Types.ObjectId, default: undefined, index: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, default: undefined, index: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, default: undefined, index: true },
  category: { type: String, enum: supportTicketTypes, required: true, index: true },
  subject: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 4000 },
  appArea: { type: String, default: '', trim: true, maxlength: 80 },
  communityName: { type: String, default: '', maxlength: 120 },
  communityCreationRequestId: { type: mongoose.Schema.Types.ObjectId, default: undefined, index: true },
  verificationRequestId: { type: mongoose.Schema.Types.ObjectId, default: undefined, index: true },
  status: { type: String, enum: supportTicketStatuses, default: 'NEW', index: true },
  assignedToAdminId: { type: mongoose.Schema.Types.ObjectId, default: undefined, index: true },
  assignedAt: { type: Date, default: undefined },
  resolvedAt: { type: Date, default: undefined },
  closedAt: { type: Date, default: undefined },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  lastMessagePreview: { type: String, default: '', maxlength: 180 },
  unreadForAdmin: { type: Boolean, default: true, index: true },
  unreadMessageCount: { type: Number, default: 1, min: 0 },
  unreadForUser: { type: Boolean, default: false, index: true },
  unreadMessageCountForUser: { type: Number, default: 0, min: 0 },
  internalNotes: [{ _id: false, authorAdminId: { type: mongoose.Schema.Types.ObjectId, required: true }, content: { type: String, required: true, maxlength: 2000 }, createdAt: { type: Date, default: Date.now } }],
  history: [{ _id: false, action: { type: String, required: true, maxlength: 80 }, previousStatus: { type: String, maxlength: 40 }, newStatus: { type: String, maxlength: 40 }, actorAdminId: mongoose.Schema.Types.ObjectId, actorUserId: mongoose.Schema.Types.ObjectId, reason: { type: String, default: '', maxlength: 1000 }, createdAt: { type: Date, default: Date.now } }],
}, { timestamps: true, collection: 'support_tickets' });
supportTicketSchema.index({ createdByGlobalAccountId: 1, updatedAt: -1 });
supportTicketSchema.index({ category: 1, status: 1, lastMessageAt: -1 });

export const SupportTicket = mongoose.models.SupportTicket ?? mongoose.model('SupportTicket', supportTicketSchema);
