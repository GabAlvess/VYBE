import mongoose, { type HydratedDocument } from 'mongoose';

export type ChannelKind = 'text' | 'announcement' | 'roleplay' | 'restricted';
export type ChannelPosting = 'members' | 'staff' | 'restricted';

export interface CommunityChannelFields {
  tenantId: mongoose.Types.ObjectId;
  name: string;
  category: string;
  description: string;
  kind: ChannelKind;
  posting: ChannelPosting;
  private: boolean;
  createdBy: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}
export type CommunityChannelDocument = HydratedDocument<CommunityChannelFields>;
const communityChannelSchema = new mongoose.Schema<CommunityChannelFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  name: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9-]{2,40}$/ },
  category: { type: String, required: true, trim: true, maxlength: 60 },
  description: { type: String, default: '', trim: true, maxlength: 240 },
  kind: { type: String, enum: ['text', 'announcement', 'roleplay', 'restricted'], default: 'text' },
  posting: { type: String, enum: ['members', 'staff', 'restricted'], default: 'members' },
  private: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { timestamps: true, collection: 'community_channels' });
communityChannelSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export interface CommunityMessageFields {
  tenantId: mongoose.Types.ObjectId;
  channelId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  content: string;
  seedKey?: string;
  deletedAt?: Date;
  deletedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const communityMessageSchema = new mongoose.Schema<CommunityMessageFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  channelId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  content: { type: String, required: true, trim: true, maxlength: 2000 },
  seedKey: { type: String, default: undefined },
  deletedAt: Date,
  deletedBy: mongoose.Schema.Types.ObjectId,
}, { timestamps: true, collection: 'community_messages' });
communityMessageSchema.index({ tenantId: 1, channelId: 1, createdAt: -1 });
communityMessageSchema.index({ tenantId: 1, seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } });

export interface MessageReportFields {
  tenantId: mongoose.Types.ObjectId;
  messageId: mongoose.Types.ObjectId;
  reporterId: mongoose.Types.ObjectId;
  reason: string;
  status: 'open' | 'resolved';
}
const messageReportSchema = new mongoose.Schema<MessageReportFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  messageId: { type: mongoose.Schema.Types.ObjectId, required: true },
  reporterId: { type: mongoose.Schema.Types.ObjectId, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
}, { timestamps: true, collection: 'community_message_reports' });
messageReportSchema.index({ tenantId: 1, messageId: 1, reporterId: 1 }, { unique: true });

export interface DirectMessageFields {
  tenantId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  recipientId: mongoose.Types.ObjectId;
  content: string;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
const directMessageSchema = new mongoose.Schema<DirectMessageFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, required: true },
  content: { type: String, required: true, trim: true, maxlength: 2000 },
  readAt: { type: Date },
}, { timestamps: true, collection: 'direct_messages' });
directMessageSchema.index({ tenantId: 1, senderId: 1, recipientId: 1, createdAt: -1 });
directMessageSchema.index({ tenantId: 1, recipientId: 1, readAt: 1, senderId: 1 });

export const CommunityChannel: mongoose.Model<CommunityChannelFields> = (mongoose.models.CommunityChannel as mongoose.Model<CommunityChannelFields> | undefined) ?? mongoose.model<CommunityChannelFields>('CommunityChannel', communityChannelSchema);
export const CommunityMessage: mongoose.Model<CommunityMessageFields> = (mongoose.models.CommunityMessage as mongoose.Model<CommunityMessageFields> | undefined) ?? mongoose.model<CommunityMessageFields>('CommunityMessage', communityMessageSchema);
export const CommunityMessageReport: mongoose.Model<MessageReportFields> = (mongoose.models.CommunityMessageReport as mongoose.Model<MessageReportFields> | undefined) ?? mongoose.model<MessageReportFields>('CommunityMessageReport', messageReportSchema);
export const DirectMessage: mongoose.Model<DirectMessageFields> = (mongoose.models.DirectMessage as mongoose.Model<DirectMessageFields> | undefined) ?? mongoose.model<DirectMessageFields>('DirectMessage', directMessageSchema);

export interface DirectTypingFields {
  tenantId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  recipientId: mongoose.Types.ObjectId;
  expiresAt: Date;
}
const directTypingSchema = new mongoose.Schema<DirectTypingFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, required: true },
  expiresAt: { type: Date, required: true },
}, { collection: 'direct_typing' });
directTypingSchema.index({ tenantId: 1, senderId: 1, recipientId: 1 }, { unique: true });
directTypingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const DirectTyping: mongoose.Model<DirectTypingFields> = (mongoose.models.DirectTyping as mongoose.Model<DirectTypingFields> | undefined) ?? mongoose.model<DirectTypingFields>('DirectTyping', directTypingSchema);
