import mongoose from 'mongoose';

export interface MessageAppProfileFields {
  tenantId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  displayName: string;
  bio: string;
  statusMessage: string;
  avatarUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

const messageAppProfileSchema = new mongoose.Schema<MessageAppProfileFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true },
  displayName: { type: String, default: '', trim: true, maxlength: 60 },
  bio: { type: String, default: '', trim: true, maxlength: 300 },
  statusMessage: { type: String, default: '', trim: true, maxlength: 80 },
  avatarUrl: { type: String, default: '' },
}, { timestamps: true, collection: 'message_app_profiles' });
messageAppProfileSchema.index({ tenantId: 1, characterId: 1 }, { unique: true });

export const MessageAppProfile = (mongoose.models.MessageAppProfile as mongoose.Model<MessageAppProfileFields> | undefined) ?? mongoose.model<MessageAppProfileFields>('MessageAppProfile', messageAppProfileSchema);
