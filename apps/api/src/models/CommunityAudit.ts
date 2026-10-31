import mongoose from 'mongoose';

export interface CommunityAuditFields {
  tenantId: mongoose.Types.ObjectId;
  actorId: mongoose.Types.ObjectId;
  action: string;
  details: Record<string, unknown>;
  createdAt: Date;
}

const communityAuditSchema = new mongoose.Schema<CommunityAuditFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, required: true, maxlength: 80 },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'community_audit_logs' });

communityAuditSchema.index({ tenantId: 1, createdAt: -1 });

export const CommunityAudit = mongoose.models.CommunityAudit
  ?? mongoose.model<CommunityAuditFields>('CommunityAudit', communityAuditSchema);
