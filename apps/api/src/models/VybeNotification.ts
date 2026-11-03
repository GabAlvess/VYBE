import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  communityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  joinRequestId: { type: mongoose.Schema.Types.ObjectId },
  communityRequestId: { type: mongoose.Schema.Types.ObjectId },
  verificationRequestId: { type: mongoose.Schema.Types.ObjectId },
  type: { type: String, enum: ['community_join_update', 'community_creation_update', 'verification_request', 'verification_payment_proof'], required: true },
  status: { type: String, enum: ['NEEDS_INFORMATION', 'APPROVED', 'REJECTED', 'PENDING'], required: true },
  message: { type: String, default: '', maxlength: 1000 },
}, { timestamps: true, collection: 'vybe_notifications' });

schema.index({ accountId: 1, createdAt: -1 });

export const VybeNotification = mongoose.models.VybeNotification ?? mongoose.model('VybeNotification', schema);
