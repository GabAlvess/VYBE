import mongoose, { type HydratedDocument } from 'mongoose';

export interface VybeAccountFields {
  email: string;
  passwordHash: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  status: 'active' | 'disabled';
  termsAcceptedAt?: Date;
  termsVersion?: string;
  privacyAcceptedAt?: Date;
  privacyVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type VybeAccountDocument = HydratedDocument<VybeAccountFields>;

const schema = new mongoose.Schema<VybeAccountFields>({
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true },
  displayName: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  username: { type: String, required: true, lowercase: true, trim: true, match: /^[a-z0-9._]{3,24}$/ },
  avatarUrl: { type: String, default: '' },
  status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  termsAcceptedAt: Date,
  termsVersion: { type: String, maxlength: 20 },
  privacyAcceptedAt: Date,
  privacyVersion: { type: String, maxlength: 20 },
}, { timestamps: true, collection: 'vybe_accounts' });

schema.index({ email: 1 }, { unique: true });
schema.index({ username: 1 }, { unique: true });

export const VybeAccount = mongoose.models.VybeAccount ?? mongoose.model<VybeAccountFields>('VybeAccount', schema);
