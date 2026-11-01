import mongoose from 'mongoose';

export interface EchoAppProfileFields {
  tenantId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  displayName: string;
  bio: string;
  avatarUrl: string;
  coverUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

const echoAppProfileSchema = new mongoose.Schema<EchoAppProfileFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true },
  displayName: { type: String, default: '', trim: true, maxlength: 60 },
  bio: { type: String, default: '', trim: true, maxlength: 300 },
  avatarUrl: { type: String, default: '' },
  coverUrl: { type: String, default: '' },
}, { timestamps: true, collection: 'echo_app_profiles' });

echoAppProfileSchema.index({ tenantId: 1, characterId: 1 }, { unique: true });

export const EchoAppProfile = (mongoose.models.EchoAppProfile as mongoose.Model<EchoAppProfileFields> | undefined)
  ?? mongoose.model<EchoAppProfileFields>('EchoAppProfile', echoAppProfileSchema);
