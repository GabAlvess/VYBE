import mongoose, { type HydratedDocument } from 'mongoose';

export type WalletTransactionType = 'TRANSFER' | 'ADMIN_CREDIT' | 'ADMIN_DEBIT' | 'PAYMENT' | 'REFUND' | 'SALARY' | 'OTHER';

export interface WalletFields {
  tenantId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  balanceCents: number;
  limitCents: number | null;
  cardLast4: string;
  createdAt: Date;
  updatedAt: Date;
}
export type WalletDocument = HydratedDocument<WalletFields>;

const walletSchema = new mongoose.Schema<WalletFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true },
  balanceCents: { type: Number, required: true, min: 0, default: 0 },
  limitCents: { type: Number, min: 0, default: null },
  cardLast4: { type: String, required: true, match: /^\d{4}$/ },
}, { timestamps: true, collection: 'bank_wallets' });
walletSchema.index({ tenantId: 1, characterId: 1 }, { unique: true });

export interface WalletTransactionFields {
  tenantId: mongoose.Types.ObjectId;
  type: WalletTransactionType;
  amountCents: number;
  senderWalletId?: mongoose.Types.ObjectId;
  recipientWalletId?: mongoose.Types.ObjectId;
  actorAccountId: mongoose.Types.ObjectId;
  description: string;
  status: 'COMPLETED';
  idempotencyKey?: string;
  reference: string;
  createdAt: Date;
}
export type WalletTransactionDocument = HydratedDocument<WalletTransactionFields>;

const transactionSchema = new mongoose.Schema<WalletTransactionFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  type: { type: String, enum: ['TRANSFER', 'ADMIN_CREDIT', 'ADMIN_DEBIT', 'PAYMENT', 'REFUND', 'SALARY', 'OTHER'], required: true },
  amountCents: { type: Number, required: true, min: 1 },
  senderWalletId: { type: mongoose.Schema.Types.ObjectId },
  recipientWalletId: { type: mongoose.Schema.Types.ObjectId },
  actorAccountId: { type: mongoose.Schema.Types.ObjectId, required: true },
  description: { type: String, default: '', maxlength: 160 },
  status: { type: String, enum: ['COMPLETED'], default: 'COMPLETED', required: true },
  idempotencyKey: { type: String, maxlength: 128 },
  reference: { type: String, required: true, unique: true },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'bank_transactions' });
transactionSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
transactionSchema.index({ tenantId: 1, senderWalletId: 1, createdAt: -1 });
transactionSchema.index({ tenantId: 1, recipientWalletId: 1, createdAt: -1 });

export const Wallet = mongoose.models.Wallet ?? mongoose.model<WalletFields>('Wallet', walletSchema);
export const WalletTransaction = mongoose.models.WalletTransaction ?? mongoose.model<WalletTransactionFields>('WalletTransaction', transactionSchema);
