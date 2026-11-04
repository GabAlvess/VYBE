import mongoose from 'mongoose';

export interface PlatformProductSettingsFields {
  key: 'COMMUNITY_CREATION';
  amountCents: number;
  updatedByPlatformAdminId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<PlatformProductSettingsFields>({
  key: { type: String, enum: ['COMMUNITY_CREATION'], unique: true, required: true },
  amountCents: { type: Number, required: true, min: 1, max: 100_000_000 },
  updatedByPlatformAdminId: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true, collection: 'platform_product_settings' });

export const PlatformProductSettings: mongoose.Model<PlatformProductSettingsFields> =
  (mongoose.models.PlatformProductSettings as mongoose.Model<PlatformProductSettingsFields> | undefined)
  ?? mongoose.model<PlatformProductSettingsFields>('PlatformProductSettings', schema);

export const DEFAULT_COMMUNITY_CREATION_PRICE_CENTS = 4990;
