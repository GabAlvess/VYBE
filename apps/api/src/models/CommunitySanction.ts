import mongoose from 'mongoose';

export interface CommunitySanctionFields {
  tenantId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  action: 'suspend' | 'ban';
  status: 'active' | 'revoked' | 'expired';
  reason: string;
  createdBy: mongoose.Types.ObjectId;
  startsAt: Date;
  endsAt?: Date;
  revokedBy?: mongoose.Types.ObjectId;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const sanctionSchema = new mongoose.Schema<CommunitySanctionFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  action: { type: String, enum: ['suspend', 'ban'], required: true },
  status: { type: String, enum: ['active', 'revoked', 'expired'], default: 'active', required: true },
  reason: { type: String, required: true, trim: true, minlength: 3, maxlength: 500 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  startsAt: { type: Date, default: Date.now },
  endsAt: Date,
  revokedBy: mongoose.Schema.Types.ObjectId,
  revokedAt: Date,
}, { timestamps: true, collection: 'community_sanctions' });

sanctionSchema.index({ tenantId: 1, accountId: 1, status: 1 });

export const CommunitySanction = (mongoose.models.CommunitySanction as mongoose.Model<CommunitySanctionFields> | undefined)
  ?? mongoose.model<CommunitySanctionFields>('CommunitySanction', sanctionSchema);
