import mongoose from 'mongoose';

export type ConversationKind = 'direct' | 'group';
export interface ConversationParticipantFields {
  profileId: mongoose.Types.ObjectId;
  role: 'member' | 'admin';
  joinedAt: Date;
  leftAt?: Date;
  mutedAt?: Date;
  favorite?: boolean;
  lastReadAt?: Date;
  typingAt?: Date;
}
export interface ConversationFields {
  tenantId: mongoose.Types.ObjectId;
  kind: ConversationKind;
  directKey?: string;
  participants: ConversationParticipantFields[];
  name: string;
  description: string;
  photoUrl: string;
  createdBy: mongoose.Types.ObjectId;
  matchId?: mongoose.Types.ObjectId;
  legacyImportedAt?: Date;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
const participantSchema = new mongoose.Schema<ConversationParticipantFields>({
  profileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  role: { type: String, enum: ['member', 'admin'], default: 'member' },
  joinedAt: { type: Date, default: Date.now }, leftAt: Date, mutedAt: Date, favorite: { type: Boolean, default: false }, lastReadAt: Date, typingAt: Date,
}, { _id: false });
const conversationSchema = new mongoose.Schema<ConversationFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  kind: { type: String, enum: ['direct', 'group'], required: true },
  directKey: { type: String, default: undefined },
  participants: { type: [participantSchema], default: [] },
  name: { type: String, default: '', trim: true, maxlength: 80 },
  description: { type: String, default: '', trim: true, maxlength: 500 },
  photoUrl: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  matchId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  legacyImportedAt: Date,
  lastMessageAt: { type: Date, default: Date.now },
}, { timestamps: true, collection: 'conversations' });
conversationSchema.index({ tenantId: 1, directKey: 1 }, { unique: true, partialFilterExpression: { directKey: { $type: 'string' } } });
conversationSchema.index({ tenantId: 1, 'participants.profileId': 1, lastMessageAt: -1 });
conversationSchema.index({ tenantId: 1, matchId: 1 }, { unique: true, partialFilterExpression: { matchId: { $type: 'objectId' } } });

export interface ConversationMessageFields {
  tenantId: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId;
  senderProfileId: mongoose.Types.ObjectId;
  content: string;
  messageType: 'text' | 'image' | 'file';
  attachment?: { url: string; name: string; mimeType: string; size: number };
  legacyMessageId?: mongoose.Types.ObjectId;
  readAt?: Date;
  replyToMessageId?: mongoose.Types.ObjectId;
  favoriteBy: mongoose.Types.ObjectId[];
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
const messageSchema = new mongoose.Schema<ConversationMessageFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, required: true },
  senderProfileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  content: { type: String, default: '', trim: true, maxlength: 4000 },
  messageType: { type: String, enum: ['text', 'image', 'file'], default: 'text' },
  attachment: { url: String, name: String, mimeType: String, size: Number },
  legacyMessageId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  readAt: Date,
  replyToMessageId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  favoriteBy: { type: [{ type: mongoose.Schema.Types.ObjectId }], default: [] },
  deletedAt: Date,
}, { timestamps: true, collection: 'conversation_messages' });
messageSchema.index({ tenantId: 1, conversationId: 1, createdAt: 1 });
messageSchema.index({ tenantId: 1, senderProfileId: 1, createdAt: -1 });
messageSchema.index({ tenantId: 1, legacyMessageId: 1 }, { unique: true, partialFilterExpression: { legacyMessageId: { $type: 'objectId' } } });

export interface ConversationBlockFields { tenantId: mongoose.Types.ObjectId; blockerId: mongoose.Types.ObjectId; blockedId: mongoose.Types.ObjectId; }
const blockSchema = new mongoose.Schema<ConversationBlockFields>({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, blockerId: { type: mongoose.Schema.Types.ObjectId, required: true }, blockedId: { type: mongoose.Schema.Types.ObjectId, required: true } }, { timestamps: true, collection: 'conversation_blocks' });
blockSchema.index({ tenantId: 1, blockerId: 1, blockedId: 1 }, { unique: true });
blockSchema.index({ tenantId: 1, blockedId: 1 });

function model<T>(name: string, schema: mongoose.Schema<T>) { return (mongoose.models[name] as mongoose.Model<T> | undefined) ?? mongoose.model<T>(name, schema); }
export const Conversation = model<ConversationFields>('Conversation', conversationSchema);
export const ConversationMessage = model<ConversationMessageFields>('ConversationMessage', messageSchema);
export const ConversationBlock = model<ConversationBlockFields>('ConversationBlock', blockSchema);
