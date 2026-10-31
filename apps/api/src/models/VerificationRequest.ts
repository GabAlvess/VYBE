import mongoose from 'mongoose';
import { VERIFICATION_PRICE_BRL } from '@vybe/shared';

export const verificationStatuses = ['PENDING', 'CONTACTED', 'AWAITING_PAYMENT', 'PAID', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type VerificationStatus = (typeof verificationStatuses)[number];
const verificationTransitions: Record<VerificationStatus, VerificationStatus[]> = {
  PENDING: ['CONTACTED', 'REJECTED', 'CANCELLED'], CONTACTED: ['AWAITING_PAYMENT', 'REJECTED', 'CANCELLED'],
  AWAITING_PAYMENT: ['PAID', 'REJECTED', 'CANCELLED'], PAID: ['APPROVED', 'REJECTED'], APPROVED: [], REJECTED: [], CANCELLED: [],
};
export function canTransitionVerification(from: VerificationStatus, to: VerificationStatus) { return verificationTransitions[from].includes(to); }

export interface VerificationRequestFields {
  tenantId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  adminCharacterId: mongoose.Types.ObjectId;
  status: VerificationStatus;
  active: boolean;
  amount: number;
  currency: 'BRL';
  paymentStatus: 'unpaid' | 'confirmed';
  paymentConfirmedAt?: Date;
  paymentConfirmedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  approvedBy?: mongoose.Types.ObjectId;
  rejectedAt?: Date;
  rejectedBy?: mongoose.Types.ObjectId;
  rejectionReason?: string;
  cancelledAt?: Date;
  cancelledBy?: mongoose.Types.ObjectId;
  cancellationReason?: string;
  removedAt?: Date;
  removedBy?: mongoose.Types.ObjectId;
  removalReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const verificationRequestSchema = new mongoose.Schema<VerificationRequestFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, required: true },
  adminCharacterId: { type: mongoose.Schema.Types.ObjectId, required: true },
  status: { type: String, enum: verificationStatuses, default: 'PENDING', required: true },
  active: { type: Boolean, default: true, required: true },
  amount: { type: Number, default: VERIFICATION_PRICE_BRL, required: true },
  currency: { type: String, enum: ['BRL'], default: 'BRL', required: true },
  paymentStatus: { type: String, enum: ['unpaid', 'confirmed'], default: 'unpaid' },
  paymentConfirmedAt: Date,
  paymentConfirmedBy: mongoose.Schema.Types.ObjectId,
  approvedAt: Date,
  approvedBy: mongoose.Schema.Types.ObjectId,
  rejectedAt: Date,
  rejectedBy: mongoose.Schema.Types.ObjectId,
  rejectionReason: { type: String, default: '', maxlength: 500 },
  cancelledAt: Date,
  cancelledBy: mongoose.Schema.Types.ObjectId,
  cancellationReason: { type: String, default: '', maxlength: 500 },
  removedAt: Date,
  removedBy: mongoose.Schema.Types.ObjectId,
  removalReason: { type: String, default: '', maxlength: 500 },
}, { timestamps: true, collection: 'verification_requests' });

verificationRequestSchema.index({ tenantId: 1, characterId: 1, createdAt: -1 });
verificationRequestSchema.index({ tenantId: 1, characterId: 1, active: 1 }, { unique: true, partialFilterExpression: { active: true } });
verificationRequestSchema.index({ status: 1, createdAt: 1 });

export const VerificationRequest: mongoose.Model<VerificationRequestFields> = (mongoose.models.VerificationRequest as mongoose.Model<VerificationRequestFields> | undefined) ?? mongoose.model<VerificationRequestFields>('VerificationRequest', verificationRequestSchema);
