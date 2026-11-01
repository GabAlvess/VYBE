import mongoose, { type HydratedDocument } from 'mongoose';

export interface CommunityRequestFields {
  sourceTenantId: mongoose.Types.ObjectId;
  sourceTenantSlug: string;
  accountId?: mongoose.Types.ObjectId;
  characterId?: mongoose.Types.ObjectId;
  globalAccountId?: mongoose.Types.ObjectId;
  applicantEmail: string;
  applicantName: string;
  applicantUsername: string;
  rpgName: string;
  slug: string;
  description: string;
  photoFilename: string;
  photoExtension: 'png' | 'jpg' | 'webp';
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type CommunityRequestDocument = HydratedDocument<CommunityRequestFields>;

const communityRequestSchema = new mongoose.Schema<CommunityRequestFields>({
  sourceTenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  sourceTenantSlug: { type: String, required: true, trim: true, lowercase: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, index: true },
  characterId: { type: mongoose.Schema.Types.ObjectId },
  globalAccountId: { type: mongoose.Schema.Types.ObjectId, index: true },
  applicantEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 254, default: '' },
  applicantName: { type: String, required: true, trim: true, maxlength: 60, default: 'Membro' },
  applicantUsername: { type: String, required: true, trim: true, lowercase: true, maxlength: 24, default: '' },
  rpgName: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 40 },
  description: { type: String, required: true, trim: true, minlength: 10, maxlength: 500 },
  photoFilename: { type: String, required: true, match: /^[a-f0-9]{32}\.(png|jpg|webp)$/ },
  photoExtension: { type: String, enum: ['png', 'jpg', 'webp'], required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId },
  reviewedAt: { type: Date },
}, { timestamps: true, collection: 'community_requests' });

communityRequestSchema.index({ sourceTenantId: 1, accountId: 1, status: 1, createdAt: -1 });
communityRequestSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

export const CommunityRequest = mongoose.models.CommunityRequest
  ?? mongoose.model<CommunityRequestFields>('CommunityRequest', communityRequestSchema);
