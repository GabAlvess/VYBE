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
  category?: string;
  photoFilename: string;
  photoExtension: 'png' | 'jpg' | 'webp';
  logoFilename?: string;
  logoExtension?: 'png' | 'jpg' | 'webp';
  paymentRequired?: boolean;
  amountCents?: number;
  currency?: 'BRL';
  paymentStatus?: 'AWAITING_PAYMENT' | 'PROOF_SENT' | 'PAYMENT_ISSUE' | 'CONFIRMED' | 'REFUND_REQUIRED' | 'REFUNDED';
  paymentProofs?: Array<{ id: string; filename: string; mimeType: 'image/png' | 'image/jpeg' | 'application/pdf'; size: number; uploadedByGlobalAccountId: mongoose.Types.ObjectId; uploadedAt: Date }>;
  paymentConfirmedAt?: Date;
  paymentConfirmedByPlatformId?: mongoose.Types.ObjectId;
  paymentIssueReason?: string;
  supportConversationId?: mongoose.Types.ObjectId;
  refundNote?: string;
  history?: Array<{ action: string; actorGlobalAccountId?: mongoose.Types.ObjectId; actorPlatformAccountId?: mongoose.Types.ObjectId; reason?: string; createdAt: Date }>;
  createdCommunityId?: mongoose.Types.ObjectId;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  rejectionReason?: string;
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
  category: { type: String, default: '', trim: true, maxlength: 60 },
  photoFilename: { type: String, required: true, match: /^[a-f0-9]{32}\.(png|jpg|webp)$/ },
  photoExtension: { type: String, enum: ['png', 'jpg', 'webp'], required: true },
  logoFilename: { type: String, default: undefined, match: /^[a-f0-9]{32}\.(png|jpg|webp)$/ },
  logoExtension: { type: String, enum: ['png', 'jpg', 'webp'], default: undefined },
  paymentRequired: { type: Boolean, default: false, index: true },
  amountCents: { type: Number, min: 0, max: 100_000_000, default: 0 },
  currency: { type: String, enum: ['BRL'], default: 'BRL' },
  paymentStatus: { type: String, enum: ['AWAITING_PAYMENT', 'PROOF_SENT', 'PAYMENT_ISSUE', 'CONFIRMED', 'REFUND_REQUIRED', 'REFUNDED'], default: undefined, index: true },
  paymentProofs: [{ _id: false, id: { type: String, required: true, match: /^[a-f0-9]{32}$/ }, filename: { type: String, required: true, match: /^[a-f0-9]{32}\.(png|jpg|pdf)$/ }, mimeType: { type: String, enum: ['image/png', 'image/jpeg', 'application/pdf'], required: true }, size: { type: Number, required: true, min: 1, max: 5 * 1024 * 1024 }, uploadedByGlobalAccountId: { type: mongoose.Schema.Types.ObjectId, required: true }, uploadedAt: { type: Date, required: true } }],
  paymentConfirmedAt: { type: Date, default: undefined },
  paymentConfirmedByPlatformId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  paymentIssueReason: { type: String, default: '', maxlength: 1000 },
  supportConversationId: { type: mongoose.Schema.Types.ObjectId, default: undefined, index: true },
  refundNote: { type: String, default: '', maxlength: 1000 },
  history: [{ _id: false, action: { type: String, required: true, maxlength: 80 }, actorGlobalAccountId: mongoose.Schema.Types.ObjectId, actorPlatformAccountId: mongoose.Schema.Types.ObjectId, reason: { type: String, default: '', maxlength: 1000 }, createdAt: { type: Date, default: Date.now } }],
  createdCommunityId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId },
  reviewedAt: { type: Date },
  rejectionReason: { type: String, default: '', maxlength: 1000 },
}, { timestamps: true, collection: 'community_requests' });

communityRequestSchema.index({ sourceTenantId: 1, accountId: 1, status: 1, createdAt: -1 });
communityRequestSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
communityRequestSchema.index({ globalAccountId: 1 }, { unique: true, partialFilterExpression: { paymentRequired: true, status: 'pending' }, name: 'one_pending_paid_community_creation_per_account' });

export const CommunityRequest = mongoose.models.CommunityRequest
  ?? mongoose.model<CommunityRequestFields>('CommunityRequest', communityRequestSchema);
