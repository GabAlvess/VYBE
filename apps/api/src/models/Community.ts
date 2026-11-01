import mongoose, { type HydratedDocument } from 'mongoose';

export const communityVisibilities = ['public', 'controlled', 'private'] as const;
export type CommunityVisibility = (typeof communityVisibilities)[number];

export interface CommunityFields {
  name: string;
  slug: string;
  subdomain: string;
  description: string;
  coverUrl: string;
  wallpaperUrl?: string;
  logoUrl: string;
  category: string;
  type: 'public';
  entry: 'open' | 'approval';
  status: 'active' | 'archived' | 'suspended' | 'deleted';
  brand: { primary: string; dark: string; medium: string; soft: string; lilac: string; white: string; graphite: string };
  rules: string[];
  memberCount: number;
  admins: mongoose.Types.ObjectId[];
  ownerAccountId?: mongoose.Types.ObjectId;
  ownerEmail: string;
  moderators: mongoose.Types.ObjectId[];
  settings: {
    access: { visibility: 'public' | 'private' | 'controlled'; approvalRequired: boolean; invitesEnabled: boolean; welcomeMessage: string };
    characters: { usernameMinLength: number; usernameMaxLength: number; minimumAge: number; requireBio: boolean; customFields: Array<{ key: string; label: string; required: boolean }> };
    features: { feed: boolean; pulse: boolean; stories: boolean; conversations: boolean; messages: boolean; events: boolean; match?: boolean; bank?: boolean; academic?: boolean; career?: boolean; news?: boolean; companies?: boolean; eventCreation: 'any_pending' | 'staff' | 'admins' | 'owner' };
    privacy: { showInDirectory: boolean; showMembers: boolean; showAdmins: boolean; publicContent: boolean };
    moderation: { rules: string[]; requireReportReason: boolean; maxPostLength: number };
  };
  createdAt: Date;
  updatedAt: Date;
}

export type CommunityDocument = HydratedDocument<CommunityFields>;

const communitySchema = new mongoose.Schema<CommunityFields>({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  subdomain: { type: String, required: true, unique: true, trim: true, lowercase: true },
  description: { type: String, required: true, trim: true, minlength: 10, maxlength: 500 },
  coverUrl: { type: String, default: '', maxlength: 300 },
  wallpaperUrl: { type: String, default: '', maxlength: 300 },
  logoUrl: { type: String, default: '', maxlength: 300 },
  category: { type: String, default: '', trim: true, maxlength: 60 },
  memberCount: { type: Number, min: 0, default: 0 },
  type: { type: String, enum: ['public'], default: 'public', required: true },
  entry: { type: String, enum: ['open', 'approval'], default: 'open', required: true },
  status: { type: String, enum: ['active', 'archived', 'suspended', 'deleted'], default: 'active', required: true },
  brand: {
    primary: { type: String, default: '#16815D' },
    dark: { type: String, default: '#0D6248' },
    medium: { type: String, default: '#35A67A' },
    soft: { type: String, default: '#F2FAF6' },
    lilac: { type: String, default: '#DDF3EA' },
    white: { type: String, default: '#FFFFFF' },
    graphite: { type: String, default: '#1F2422' },
  },
  rules: { type: [String], default: [] },
  admins: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  ownerAccountId: { type: mongoose.Schema.Types.ObjectId, default: undefined, index: true },
  ownerEmail: { type: String, default: '', lowercase: true, trim: true, maxlength: 254 },
  moderators: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  settings: {
    access: {
      visibility: { type: String, enum: ['public', 'private', 'controlled'], default: 'public' },
      approvalRequired: { type: Boolean, default: false },
      invitesEnabled: { type: Boolean, default: true },
      welcomeMessage: { type: String, default: '', maxlength: 500 },
    },
    characters: {
      usernameMinLength: { type: Number, default: 3, min: 3, max: 24 },
      usernameMaxLength: { type: Number, default: 24, min: 3, max: 24 },
      minimumAge: { type: Number, default: 18, min: 13, max: 100 },
      requireBio: { type: Boolean, default: false },
      customFields: { type: [{ key: String, label: String, required: Boolean }], default: [] },
    },
    features: {
      feed: { type: Boolean, default: true }, pulse: { type: Boolean, default: true },
      stories: { type: Boolean, default: true }, conversations: { type: Boolean, default: true },
      messages: { type: Boolean, default: true }, events: { type: Boolean, default: true },
      match: { type: Boolean, default: true }, bank: { type: Boolean, default: true },
      academic: { type: Boolean, default: true }, career: { type: Boolean, default: true },
      news: { type: Boolean, default: true }, companies: { type: Boolean, default: true },
      eventCreation: { type: String, enum: ['any_pending', 'staff', 'admins', 'owner'], default: 'any_pending' },
    },
    privacy: {
      showInDirectory: { type: Boolean, default: true }, showMembers: { type: Boolean, default: true },
      showAdmins: { type: Boolean, default: true }, publicContent: { type: Boolean, default: true },
    },
    moderation: {
      rules: { type: [String], default: [] },
      requireReportReason: { type: Boolean, default: true },
      maxPostLength: { type: Number, default: 5000, min: 100, max: 5000 },
    },
  },
}, { timestamps: true, collection: 'communities' });

export const Community = mongoose.models.Community
  ?? mongoose.model<CommunityFields>('Community', communitySchema);

export function serializeCommunity(community: CommunityDocument) {
  const { _id, __v, ...fields } = community.toObject();
  return { id: _id.toString(), ...fields };
}
