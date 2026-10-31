import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'VybeAccount', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, collection: 'vybe_sessions' });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const VybeSession = mongoose.models.VybeSession ?? mongoose.model('VybeSession', schema);
