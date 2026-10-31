import mongoose, { type HydratedDocument } from 'mongoose';

export type CommunityJoinRequestStatus = 'PENDING' | 'NEEDS_INFORMATION' | 'APPROVED' | 'REJECTED';
export type CommunityJoinChangeField = 'username' | 'photoplayer' | 'description';
export interface CommunityJoinAnswer { key: string; label: string; value: string; }

export interface CommunityJoinRequestFields {
  communityId: mongoose.Types.ObjectId;
  communitySlug: string;
  sourceTenantId?: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  sourceCharacterId?: mongoose.Types.ObjectId;
  vybeAccountId?: mongoose.Types.ObjectId;
  characterName: string;
  requestedUsername: string;
  normalizedUsername: string;
  characterAge: number;
  photoplayerName: string;
  normalizedPhotoplayerName: string;
  photoplayerImageFilename: string;
  photoplayerImageExtension: 'png' | 'jpg' | 'webp';
  characterDescription: string;
  customAnswers: CommunityJoinAnswer[];
  status: CommunityJoinRequestStatus;
  requestedChanges: CommunityJoinChangeField[];
  adminMessage: string;
  rejectionReason: string;
  reviewedAt?: Date;
  reviewedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type CommunityJoinRequestDocument = HydratedDocument<CommunityJoinRequestFields>;
const answerSchema = new mongoose.Schema<CommunityJoinAnswer>({
  key: { type: String, required: true, maxlength: 32 },
  label: { type: String, required: true, maxlength: 50 },
  value: { type: String, required: true, maxlength: 500 },
}, { _id: false });

const schema = new mongoose.Schema<CommunityJoinRequestFields>({
  communityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  communitySlug: { type: String, required: true, trim: true, lowercase: true },
  sourceTenantId: { type: mongoose.Schema.Types.ObjectId, default: undefined, index: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  sourceCharacterId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  vybeAccountId: { type: mongoose.Schema.Types.ObjectId, default: undefined, index: true },
  characterName: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  requestedUsername: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9._]{3,24}$/ },
  normalizedUsername: { type: String, required: true, trim: true, lowercase: true },
  characterAge: { type: Number, required: true, min: 13, max: 100 },
  photoplayerName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  normalizedPhotoplayerName: { type: String, required: true, trim: true, lowercase: true, maxlength: 120 },
  photoplayerImageFilename: { type: String, required: true, match: /^[a-f0-9]{32}\.(png|jpg|webp)$/ },
  photoplayerImageExtension: { type: String, enum: ['png', 'jpg', 'webp'], required: true },
  characterDescription: { type: String, required: true, trim: true, minlength: 10, maxlength: 1000 },
  customAnswers: { type: [answerSchema], default: [] },
  status: { type: String, enum: ['PENDING', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
  requestedChanges: { type: [String], enum: ['username', 'photoplayer', 'description'], default: [] },
  adminMessage: { type: String, default: '', maxlength: 1000 },
  rejectionReason: { type: String, default: '', maxlength: 1000 },
  reviewedAt: Date,
  reviewedBy: mongoose.Schema.Types.ObjectId,
}, { timestamps: true, collection: 'community_join_requests' });

schema.index({ communityId: 1, sourceTenantId: 1, accountId: 1 }, { unique: true });
schema.index({ communityId: 1, vybeAccountId: 1 }, { unique: true, partialFilterExpression: { vybeAccountId: { $type: 'objectId' } } });
schema.index({ communityId: 1, status: 1, createdAt: 1 });

export const CommunityJoinRequest = mongoose.models.CommunityJoinRequest
  ?? mongoose.model<CommunityJoinRequestFields>('CommunityJoinRequest', schema);
