import mongoose from 'mongoose';
import { VERIFICATION_PRICE_BRL } from '@vybe/shared';

export const verificationStatuses = ['PENDING', 'CONTACTED', 'AWAITING_PAYMENT', 'PAYMENT_PROOF_SENT', 'PAYMENT_ISSUE', 'PAID', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUSPENDED', 'REVOKED'] as const;
export type VerificationStatus = (typeof verificationStatuses)[number];
const verificationTransitions: Record<VerificationStatus, VerificationStatus[]> = {
  PENDING: ['CONTACTED', 'AWAITING_PAYMENT', 'REJECTED', 'CANCELLED'], CONTACTED: ['AWAITING_PAYMENT', 'REJECTED', 'CANCELLED'],
  AWAITING_PAYMENT: ['PAYMENT_PROOF_SENT', 'PAYMENT_ISSUE', 'PAID', 'REJECTED', 'CANCELLED'],
  PAYMENT_PROOF_SENT: ['PAYMENT_ISSUE', 'PAID', 'REJECTED', 'CANCELLED'],
  PAYMENT_ISSUE: ['PAYMENT_PROOF_SENT', 'AWAITING_PAYMENT', 'REJECTED', 'CANCELLED'],
  PAID: ['APPROVED', 'REJECTED'], APPROVED: ['SUSPENDED', 'REVOKED'], SUSPENDED: ['APPROVED', 'REVOKED'], REVOKED: [], REJECTED: [], CANCELLED: [],
};
export function canTransitionVerification(from: VerificationStatus, to: VerificationStatus) { return verificationTransitions[from].includes(to); }

export interface VerificationRequestFields {
  tenantId: mongoose.Types.ObjectId;
  requestedByUserId?: mongoose.Types.ObjectId;
  beneficiaryProfileId?: mongoose.Types.ObjectId;
  isGift?: boolean;
  source?: 'SELF_PURCHASE' | 'GIFT' | 'GIVEAWAY' | 'PROMOTION' | 'ADMIN_GRANT';
  // Legacy fields remain for older records: characterId/accountId identify the requester.
  characterId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  adminCharacterId: mongoose.Types.ObjectId;
  verificationType?: 'PAID_PROFILE' | 'OFFICIAL' | 'CREATOR' | 'PARTNER' | 'STAFF';
  conversationId?: mongoose.Types.ObjectId;
  handledBy?: mongoose.Types.ObjectId;
  handledAt?: Date;
  history?: Array<{ action: string; actorPlatformAccountId?: mongoose.Types.ObjectId; reason?: string; createdAt: Date }>;
  internalNotes?: Array<{ authorPlatformAccountId: mongoose.Types.ObjectId; content: string; createdAt: Date }>;
  paymentProofs?: Array<{ id: string; filename: string; mimeType: 'image/png' | 'image/jpeg' | 'application/pdf'; size: number; uploadedByProfileId: mongoose.Types.ObjectId; uploadedAt: Date }>;
  status: VerificationStatus;
  active: boolean;
  amount: number;
  currency: 'BRL';
  paymentStatus: 'unpaid' | 'confirmed';
  paymentConfirmedAt?: Date;
  paymentConfirmedBy?: mongoose.Types.ObjectId;
  paymentConfirmedByPlatformId?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  approvedBy?: mongoose.Types.ObjectId;
  approvedByPlatformId?: mongoose.Types.ObjectId;
  rejectedAt?: Date;
  rejectedBy?: mongoose.Types.ObjectId;
  rejectionReason?: string;
  cancelledAt?: Date;
  cancelledBy?: mongoose.Types.ObjectId;
  cancellationReason?: string;
  removedAt?: Date;
  removedBy?: mongoose.Types.ObjectId;
  removedByPlatformId?: mongoose.Types.ObjectId;
  removalReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const verificationRequestSchema = new mongoose.Schema<VerificationRequestFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  requestedByUserId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  beneficiaryProfileId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  isGift: { type: Boolean, default: false, required: true },
  source: { type: String, enum: ['SELF_PURCHASE', 'GIFT', 'GIVEAWAY', 'PROMOTION', 'ADMIN_GRANT'], default: 'SELF_PURCHASE', required: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, required: true },
  adminCharacterId: { type: mongoose.Schema.Types.ObjectId, required: true },
  verificationType: { type: String, enum: ['PAID_PROFILE', 'OFFICIAL', 'CREATOR', 'PARTNER', 'STAFF'], default: 'PAID_PROFILE', required: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  handledBy: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  handledAt: { type: Date, default: undefined },
  history: [{ _id: false, action: { type: String, required: true, maxlength: 80 }, actorPlatformAccountId: mongoose.Schema.Types.ObjectId, reason: { type: String, maxlength: 500 }, createdAt: { type: Date, default: Date.now } }],
  internalNotes: [{ _id: false, authorPlatformAccountId: { type: mongoose.Schema.Types.ObjectId, required: true }, content: { type: String, required: true, trim: true, maxlength: 2000 }, createdAt: { type: Date, default: Date.now } }],
  paymentProofs: [{ _id: false, id: { type: String, required: true, match: /^[a-f0-9]{32}$/ }, filename: { type: String, required: true, match: /^[a-f0-9]{32}\.(png|jpg|pdf)$/ }, mimeType: { type: String, enum: ['image/png', 'image/jpeg', 'application/pdf'], required: true }, size: { type: Number, required: true, min: 1, max: 5 * 1024 * 1024 }, uploadedByProfileId: { type: mongoose.Schema.Types.ObjectId, required: true }, uploadedAt: { type: Date, required: true } }],
  status: { type: String, enum: verificationStatuses, default: 'PENDING', required: true },
  active: { type: Boolean, default: true, required: true },
  amount: { type: Number, default: VERIFICATION_PRICE_BRL, required: true },
  currency: { type: String, enum: ['BRL'], default: 'BRL', required: true },
  paymentStatus: { type: String, enum: ['unpaid', 'confirmed'], default: 'unpaid' },
  paymentConfirmedAt: Date,
  paymentConfirmedBy: mongoose.Schema.Types.ObjectId,
  paymentConfirmedByPlatformId: mongoose.Schema.Types.ObjectId,
  approvedAt: Date,
  approvedBy: mongoose.Schema.Types.ObjectId,
  approvedByPlatformId: mongoose.Schema.Types.ObjectId,
  rejectedAt: Date,
  rejectedBy: mongoose.Schema.Types.ObjectId,
  rejectionReason: { type: String, default: '', maxlength: 500 },
  cancelledAt: Date,
  cancelledBy: mongoose.Schema.Types.ObjectId,
  cancellationReason: { type: String, default: '', maxlength: 500 },
  removedAt: Date,
  removedBy: mongoose.Schema.Types.ObjectId,
  removedByPlatformId: mongoose.Schema.Types.ObjectId,
  removalReason: { type: String, default: '', maxlength: 500 },
}, { timestamps: true, collection: 'verification_requests' });

verificationRequestSchema.index({ tenantId: 1, characterId: 1, createdAt: -1 });
verificationRequestSchema.index({ tenantId: 1, beneficiaryProfileId: 1, active: 1 }, { unique: true, partialFilterExpression: { active: true, beneficiaryProfileId: { $type: 'objectId' } }, name: 'verification_active_beneficiary_unique' });
verificationRequestSchema.index({ status: 1, createdAt: 1 });

export const VerificationRequest: mongoose.Model<VerificationRequestFields> = (mongoose.models.VerificationRequest as mongoose.Model<VerificationRequestFields> | undefined) ?? mongoose.model<VerificationRequestFields>('VerificationRequest', verificationRequestSchema);
