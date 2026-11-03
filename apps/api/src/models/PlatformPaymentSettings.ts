import mongoose from 'mongoose';

export type PixKeyType = 'EMAIL' | 'PHONE' | 'CPF_CNPJ' | 'RANDOM_KEY' | 'PIX_COPY_PASTE';
export interface PlatformPaymentSettingsFields {
  key: 'VYBE_PLUS_PIX';
  pixKey: string;
  pixKeyType: PixKeyType;
  recipientName: string;
  qrCodeDataUrl?: string;
  updatedByPlatformAdminId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<PlatformPaymentSettingsFields>({
  key: { type: String, enum: ['VYBE_PLUS_PIX'], unique: true, required: true },
  pixKey: { type: String, required: true, trim: true, maxlength: 200 },
  pixKeyType: { type: String, enum: ['EMAIL', 'PHONE', 'CPF_CNPJ', 'RANDOM_KEY', 'PIX_COPY_PASTE'], required: true },
  recipientName: { type: String, required: true, trim: true, maxlength: 100 },
  qrCodeDataUrl: { type: String, default: '', maxlength: 1_500_000 },
  updatedByPlatformAdminId: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true, collection: 'platform_payment_settings' });

export const PlatformPaymentSettings: mongoose.Model<PlatformPaymentSettingsFields> =
  (mongoose.models.PlatformPaymentSettings as mongoose.Model<PlatformPaymentSettingsFields> | undefined)
  ?? mongoose.model<PlatformPaymentSettingsFields>('PlatformPaymentSettings', schema);
