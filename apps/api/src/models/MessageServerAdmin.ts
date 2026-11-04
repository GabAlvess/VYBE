import mongoose from 'mongoose';

export type MessageServerAccessMode = 'invite_only' | 'request' | 'discoverable';
export interface MessageServerConfigFields {
  tenantId: mongoose.Types.ObjectId; serverId: mongoose.Types.ObjectId; bannerUrl: string; accentColor: string;
  publicInfo: string; theme: string; rules: string; profilePrivate: boolean; tag: string; tagColor: string; tagInsignia: string;
  accessMode: MessageServerAccessMode; rulesRequired: boolean; ageRestricted: boolean; defaultRoleId?: mongoose.Types.ObjectId;
  notifications: 'all' | 'mentions' | 'important'; allowGifs: boolean; allowAttachments: boolean; archivedAt?: Date;
  welcomeEnabled?: boolean; welcomeChannelId?: mongoose.Types.ObjectId; welcomeMessage?: string;
  startChannelMode?: 'last'|'main'|'welcome_first'; startChannelId?: mongoose.Types.ObjectId;
  defaultNotifications?: 'all'|'mentions'|'muted'; groupMembersByRole?: boolean; showRoleColors?: boolean;
  antiSpamEnabled?: boolean; limitRepeatedLinks?: boolean;
}
const configSchema = new mongoose.Schema<MessageServerConfigFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, serverId: { type: mongoose.Schema.Types.ObjectId, required: true },
  bannerUrl: { type: String, default: '' }, accentColor: { type: String, default: '#246B6E', match: /^#[0-9A-Fa-f]{6}$/ },
  publicInfo: { type: String, default: '', maxlength: 500 }, theme: { type: String, default: '', maxlength: 60 }, rules: { type: String, default: '', maxlength: 4000 }, profilePrivate: { type: Boolean, default: false },
  tag: { type: String, default: '', uppercase: true, maxlength: 4, match: /^[A-Z0-9]{0,4}$/ }, tagColor: { type: String, default: '#246B6E', match: /^#[0-9A-Fa-f]{6}$/ }, tagInsignia: { type: String, default: 'star', maxlength: 24 },
  accessMode: { type: String, enum: ['invite_only', 'request', 'discoverable'], default: 'invite_only' }, rulesRequired: { type: Boolean, default: false }, ageRestricted: { type: Boolean, default: false }, defaultRoleId: mongoose.Schema.Types.ObjectId,
  notifications: { type: String, enum: ['all', 'mentions', 'important'], default: 'mentions' }, allowGifs: { type: Boolean, default: true }, allowAttachments: { type: Boolean, default: true }, archivedAt: Date,
  welcomeEnabled: { type: Boolean, default: false }, welcomeChannelId: mongoose.Schema.Types.ObjectId, welcomeMessage: { type: String, default: 'Boas-vindas ao {espaco}, {nome}!', maxlength: 500 },
  startChannelMode: { type: String, enum: ['last','main','welcome_first'], default: 'last' }, startChannelId: mongoose.Schema.Types.ObjectId,
  defaultNotifications: { type: String, enum: ['all','mentions','muted'], default: 'mentions' }, groupMembersByRole: { type: Boolean, default: false }, showRoleColors: { type: Boolean, default: true },
  antiSpamEnabled: { type: Boolean, default: false }, limitRepeatedLinks: { type: Boolean, default: true },
}, { timestamps: true, collection: 'message_server_configs' });
configSchema.index({ tenantId: 1, serverId: 1 }, { unique: true });
configSchema.index({ tenantId: 1, tag: 1 }, { unique: true, partialFilterExpression: { tag: { $type: 'string', $gt: '' } } });

export const allMessageServerPermissions = ['manage_server','manage_roles','manage_invites','view_audit','create_channels','edit_channels','delete_channels','manage_categories','manage_channel_permissions','view_private_channels','view_channels','send_messages','send_images','attach_files','send_gifs','react','pin_messages','manage_messages','create_posts','reply_posts','manage_posts','pin_posts','mention_roles','connect_voice','speak','mute_members','disconnect_members','manage_voice_channels','manage_voice_permissions','manage_nicknames','restrict_members','revoke_restrictions','kick_members','ban_members','revoke_bans'] as const;
export type MessageServerPermission = typeof allMessageServerPermissions[number];
export interface MessageServerCustomRoleFields { tenantId: mongoose.Types.ObjectId; serverId: mongoose.Types.ObjectId; name: string; color: string; icon: string; position: number; permissions: MessageServerPermission[]; createdByAccountId: mongoose.Types.ObjectId; }
const customRoleSchema = new mongoose.Schema<MessageServerCustomRoleFields>({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, serverId: { type: mongoose.Schema.Types.ObjectId, required: true }, name: { type: String, required: true, trim: true, minlength: 2, maxlength: 40 }, color: { type: String, default: '#246B6E', match: /^#[0-9A-Fa-f]{6}$/ }, icon: { type: String, default: '', maxlength: 24 }, position: { type: Number, default: 0 }, permissions: { type: [{ type: String, enum: allMessageServerPermissions }], default: [], validate: { validator: (permissions: string[]) => permissions.every((permission) => allMessageServerPermissions.includes(permission as MessageServerPermission)), message: 'Cargo contém permissões desconhecidas.' } }, createdByAccountId: { type: mongoose.Schema.Types.ObjectId, required: true } }, { timestamps: true, collection: 'message_server_roles' });
customRoleSchema.index({ tenantId: 1, serverId: 1, name: 1 }, { unique: true });

export interface MessageServerInviteFields { tenantId: mongoose.Types.ObjectId; serverId: mongoose.Types.ObjectId; tokenHash: string; createdByAccountId: mongoose.Types.ObjectId; expiresAt?: Date; maxUses?: number; uses: number; revokedAt?: Date; createdAt?: Date; }
const inviteSchema = new mongoose.Schema<MessageServerInviteFields>({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, serverId: { type: mongoose.Schema.Types.ObjectId, required: true }, tokenHash: { type: String, required: true, unique: true }, createdByAccountId: { type: mongoose.Schema.Types.ObjectId, required: true }, expiresAt: Date, maxUses: Number, uses: { type: Number, default: 0 }, revokedAt: Date }, { timestamps: true, collection: 'message_server_invites' });
inviteSchema.index({ tenantId: 1, serverId: 1, createdAt: -1 });

export interface MessageServerBanFields { tenantId: mongoose.Types.ObjectId; serverId: mongoose.Types.ObjectId; accountId: mongoose.Types.ObjectId; profileId: mongoose.Types.ObjectId; reason: string; moderatorAccountId: mongoose.Types.ObjectId; expiresAt?: Date; revokedAt?: Date; }
const banSchema = new mongoose.Schema<MessageServerBanFields>({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, serverId: { type: mongoose.Schema.Types.ObjectId, required: true }, accountId: { type: mongoose.Schema.Types.ObjectId, required: true }, profileId: { type: mongoose.Schema.Types.ObjectId, required: true }, reason: { type: String, required: true, maxlength: 500 }, moderatorAccountId: { type: mongoose.Schema.Types.ObjectId, required: true }, expiresAt: Date, revokedAt: Date }, { timestamps: true, collection: 'message_server_bans' });
banSchema.index({ tenantId: 1, serverId: 1, accountId: 1 }, { unique: true, partialFilterExpression: { revokedAt: { $exists: false } } });

export interface MessageServerAuditFields { tenantId: mongoose.Types.ObjectId; serverId: mongoose.Types.ObjectId; actorAccountId: mongoose.Types.ObjectId; action: string; targetId?: mongoose.Types.ObjectId; details: Record<string, unknown>; }
const auditSchema = new mongoose.Schema<MessageServerAuditFields>({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, serverId: { type: mongoose.Schema.Types.ObjectId, required: true }, actorAccountId: { type: mongoose.Schema.Types.ObjectId, required: true }, action: { type: String, required: true, maxlength: 60 }, targetId: mongoose.Schema.Types.ObjectId, details: { type: mongoose.Schema.Types.Mixed, default: {} } }, { timestamps: true, collection: 'message_server_audit' });
auditSchema.index({ tenantId: 1, serverId: 1, createdAt: -1 });

export interface MessageServerAccessRequestFields { tenantId: mongoose.Types.ObjectId; serverId: mongoose.Types.ObjectId; accountId: mongoose.Types.ObjectId; profileId: mongoose.Types.ObjectId; presentation: string; status: 'pending'|'approved'|'rejected'; reviewedBy?: mongoose.Types.ObjectId; reviewedAt?: Date; }
const accessRequestSchema = new mongoose.Schema<MessageServerAccessRequestFields>({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, serverId: { type: mongoose.Schema.Types.ObjectId, required: true }, accountId: { type: mongoose.Schema.Types.ObjectId, required: true }, profileId: { type: mongoose.Schema.Types.ObjectId, required: true }, presentation: { type: String, default: '', maxlength: 500 }, status: { type: String, enum: ['pending','approved','rejected'], default: 'pending' }, reviewedBy: mongoose.Schema.Types.ObjectId, reviewedAt: Date }, { timestamps: true, collection: 'message_server_access_requests' });
accessRequestSchema.index({ tenantId: 1, serverId: 1, accountId: 1, status: 1 });
accessRequestSchema.index({ tenantId: 1, serverId: 1, accountId: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

export interface MessageServerRestrictionFields { tenantId: mongoose.Types.ObjectId; serverId: mongoose.Types.ObjectId; accountId: mongoose.Types.ObjectId; profileId: mongoose.Types.ObjectId; reason: string; moderatorAccountId: mongoose.Types.ObjectId; mutedUntil?: Date; revokedAt?: Date; }
const restrictionSchema = new mongoose.Schema<MessageServerRestrictionFields>({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, serverId: { type: mongoose.Schema.Types.ObjectId, required: true }, accountId: { type: mongoose.Schema.Types.ObjectId, required: true }, profileId: { type: mongoose.Schema.Types.ObjectId, required: true }, reason: { type: String, required: true, maxlength: 500 }, moderatorAccountId: { type: mongoose.Schema.Types.ObjectId, required: true }, mutedUntil: Date, revokedAt: Date }, { timestamps: true, collection: 'message_server_restrictions' });
restrictionSchema.index({ tenantId: 1, serverId: 1, accountId: 1, createdAt: -1 });

function model<T>(name: string, schema: mongoose.Schema<T>) { return (mongoose.models[name] as mongoose.Model<T> | undefined) ?? mongoose.model<T>(name, schema); }
export const MessageServerConfig = model('MessageServerConfig', configSchema);
export const MessageServerCustomRole = model('MessageServerCustomRole', customRoleSchema);
export const MessageServerInvite = model('MessageServerInvite', inviteSchema);
export const MessageServerBan = model('MessageServerBan', banSchema);
export const MessageServerAudit = model('MessageServerAudit', auditSchema);
export const MessageServerAccessRequest = model('MessageServerAccessRequest', accessRequestSchema);
export const MessageServerRestriction = model('MessageServerRestriction', restrictionSchema);
