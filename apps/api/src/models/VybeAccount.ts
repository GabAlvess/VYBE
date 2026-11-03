import mongoose, { type HydratedDocument } from 'mongoose';
import { ACCOUNT_GENDER_VALUES, GREETING_PREFERENCE_VALUES, type AccountGender, type GreetingPreference } from '@vybe/shared';

export interface VybeAccountFields {
  email: string;
  passwordHash: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  audioPreferences?: { enabled: boolean; messageSoundEnabled: boolean; notificationSoundEnabled: boolean; matchSoundEnabled: boolean; actionSoundEnabled: boolean; vybePlusSoundEnabled: boolean; volume: number };
  gender?: AccountGender;
  customGender?: string;
  greetingPreference?: GreetingPreference;
  customGreeting?: string;
  birthDate?: Date;
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
  avatarUrl: { type: String, default: '', maxlength: 2_800_000 },
  audioPreferences: { enabled: { type: Boolean, default: true }, messageSoundEnabled: { type: Boolean, default: true }, notificationSoundEnabled: { type: Boolean, default: true }, matchSoundEnabled: { type: Boolean, default: true }, actionSoundEnabled: { type: Boolean, default: true }, vybePlusSoundEnabled: { type: Boolean, default: true }, volume: { type: Number, min: 0, max: 1, default: 0.5 } },
  gender: { type: String, enum: [...ACCOUNT_GENDER_VALUES], default: undefined },
  customGender: { type: String, trim: true, maxlength: 80, default: '' },
  greetingPreference: { type: String, enum: [...GREETING_PREFERENCE_VALUES], default: 'NEUTRAL' },
  customGreeting: { type: String, trim: true, maxlength: 80, default: '' },
  birthDate: { type: Date, default: undefined },
  status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  termsAcceptedAt: Date,
  termsVersion: { type: String, maxlength: 20 },
  privacyAcceptedAt: Date,
  privacyVersion: { type: String, maxlength: 20 },
}, { timestamps: true, collection: 'vybe_accounts' });

schema.index({ email: 1 }, { unique: true });
schema.index({ username: 1 }, { unique: true });

export const VybeAccount = mongoose.models.VybeAccount ?? mongoose.model<VybeAccountFields>('VybeAccount', schema);
