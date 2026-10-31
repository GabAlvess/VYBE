import mongoose, { type HydratedDocument } from 'mongoose';

export interface MatchProfileFields {
  tenantId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  enabled: boolean;
  age: number | null;
  bio: string;
  location: string;
  interests: string[];
  photos: string[];
  createdAt: Date;
  updatedAt: Date;
}
const matchProfileSchema = new mongoose.Schema<MatchProfileFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  enabled: { type: Boolean, default: false, index: true },
  age: { type: Number, min: 18, max: 120, default: null },
  bio: { type: String, default: '', trim: true, maxlength: 500 },
  location: { type: String, default: '', trim: true, maxlength: 100 },
  interests: { type: [String], default: [] },
  photos: { type: [String], default: [] },
}, { timestamps: true });
matchProfileSchema.index({ tenantId: 1, characterId: 1 }, { unique: true });
matchProfileSchema.index({ tenantId: 1, enabled: 1, age: 1, updatedAt: -1 });

export interface MatchReactionFields {
  tenantId: mongoose.Types.ObjectId;
  fromProfileId: mongoose.Types.ObjectId;
  toProfileId: mongoose.Types.ObjectId;
  type: 'like' | 'star' | 'pass';
  createdAt: Date;
  updatedAt: Date;
}
const matchReactionSchema = new mongoose.Schema<MatchReactionFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  fromProfileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  toProfileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  type: { type: String, enum: ['like', 'star', 'pass'], required: true },
}, { timestamps: true });
matchReactionSchema.index({ tenantId: 1, fromProfileId: 1, toProfileId: 1 }, { unique: true });
matchReactionSchema.index({ tenantId: 1, toProfileId: 1, type: 1 });

export interface MatchFields {
  tenantId: mongoose.Types.ObjectId;
  profileAId: mongoose.Types.ObjectId;
  profileBId: mongoose.Types.ObjectId;
  status: 'active' | 'blocked' | 'unmatched';
  createdAt: Date;
  updatedAt: Date;
}
const matchSchema = new mongoose.Schema<MatchFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  profileAId: { type: mongoose.Schema.Types.ObjectId, required: true },
  profileBId: { type: mongoose.Schema.Types.ObjectId, required: true },
  status: { type: String, enum: ['active', 'blocked', 'unmatched'], default: 'active', index: true },
}, { timestamps: true });
matchSchema.index({ tenantId: 1, profileAId: 1, profileBId: 1 }, { unique: true });
matchSchema.index({ tenantId: 1, profileAId: 1, status: 1, updatedAt: -1 });
matchSchema.index({ tenantId: 1, profileBId: 1, status: 1, updatedAt: -1 });

export interface MatchBlockFields {
  tenantId: mongoose.Types.ObjectId;
  blockerId: mongoose.Types.ObjectId;
  blockedId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const matchBlockSchema = new mongoose.Schema<MatchBlockFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  blockerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  blockedId: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true });
matchBlockSchema.index({ tenantId: 1, blockerId: 1, blockedId: 1 }, { unique: true });
matchBlockSchema.index({ tenantId: 1, blockedId: 1 });

export interface MatchMessageFields {
  tenantId: mongoose.Types.ObjectId;
  matchId: mongoose.Types.ObjectId;
  senderProfileId: mongoose.Types.ObjectId;
  recipientProfileId: mongoose.Types.ObjectId;
  content: string;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
const matchMessageSchema = new mongoose.Schema<MatchMessageFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  matchId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  senderProfileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  recipientProfileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  content: { type: String, required: true, trim: true, maxlength: 1000 },
  readAt: { type: Date },
}, { timestamps: true });
matchMessageSchema.index({ tenantId: 1, matchId: 1, createdAt: 1 });
matchMessageSchema.index({ tenantId: 1, recipientProfileId: 1, readAt: 1 });

function model<T>(name: string, schema: mongoose.Schema<T>) {
  return (mongoose.models[name] as mongoose.Model<T> | undefined) ?? mongoose.model<T>(name, schema);
}

export const MatchProfile = model<MatchProfileFields>('MatchProfile', matchProfileSchema);
export const MatchReaction = model<MatchReactionFields>('MatchReaction', matchReactionSchema);
export const Match = model<MatchFields>('Match', matchSchema);
export const MatchBlock = model<MatchBlockFields>('MatchBlock', matchBlockSchema);
export const MatchMessage = model<MatchMessageFields>('MatchMessage', matchMessageSchema);

export type MatchProfileDocument = HydratedDocument<MatchProfileFields>;
