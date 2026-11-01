import mongoose from 'mongoose';

export type CommunityReportTarget = 'direct_message' | 'match_message' | 'match_profile' | 'profile' | 'academic_content' | 'academic_assignment' | 'academic_exam';
export interface CommunityContentReportFields {
  tenantId: mongoose.Types.ObjectId;
  reporterProfileId: mongoose.Types.ObjectId;
  targetType: CommunityReportTarget;
  targetId: mongoose.Types.ObjectId;
  targetProfileId?: mongoose.Types.ObjectId;
  reason: string;
  snapshot: string;
  status: 'open' | 'resolved';
  resolvedAt?: Date;
  resolvedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const schema = new mongoose.Schema<CommunityContentReportFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  reporterProfileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  targetType: { type: String, enum: ['direct_message', 'match_message', 'match_profile', 'profile', 'academic_content', 'academic_assignment', 'academic_exam'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  targetProfileId: { type: mongoose.Schema.Types.ObjectId },
  reason: { type: String, required: true, trim: true, minlength: 3, maxlength: 500 },
  snapshot: { type: String, default: '', maxlength: 4000 },
  status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
  resolvedAt: Date,
  resolvedBy: mongoose.Schema.Types.ObjectId,
}, { timestamps: true, collection: 'community_content_reports' });
schema.index({ tenantId: 1, reporterProfileId: 1, targetType: 1, targetId: 1 }, { unique: true });
schema.index({ tenantId: 1, status: 1, createdAt: -1 });
export const CommunityContentReport = (mongoose.models.CommunityContentReport as mongoose.Model<CommunityContentReportFields> | undefined) ?? mongoose.model<CommunityContentReportFields>('CommunityContentReport', schema);
