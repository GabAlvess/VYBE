import mongoose from 'mongoose';

export type MessageServerRole = 'owner' | 'admin' | 'member';
export interface MessageServerFields {
  tenantId: mongoose.Types.ObjectId;
  ownerAccountId: mongoose.Types.ObjectId;
  ownerProfileId: mongoose.Types.ObjectId;
  name: string;
  description: string;
  iconUrl: string;
  privacy: 'private';
  createdAt?: Date;
  updatedAt?: Date;
}
const serverSchema = new mongoose.Schema<MessageServerFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  ownerAccountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  ownerProfileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  description: { type: String, default: '', trim: true, maxlength: 240 },
  iconUrl: { type: String, default: '', maxlength: 500 },
  privacy: { type: String, enum: ['private'], default: 'private', required: true },
}, { timestamps: true, collection: 'message_servers' });
serverSchema.index({ tenantId: 1, ownerAccountId: 1, createdAt: -1 });

export interface MessageServerMemberFields {
  tenantId: mongoose.Types.ObjectId; serverId: mongoose.Types.ObjectId; accountId: mongoose.Types.ObjectId; profileId: mongoose.Types.ObjectId; role: MessageServerRole; roleIds?: mongoose.Types.ObjectId[]; showTag?: boolean; notificationPreference?: 'all'|'mentions'|'muted'; lastChannelId?: mongoose.Types.ObjectId; joinedAt: Date;
}
const memberSchema = new mongoose.Schema<MessageServerMemberFields>({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, serverId: { type: mongoose.Schema.Types.ObjectId, required: true }, accountId: { type: mongoose.Schema.Types.ObjectId, required: true }, profileId: { type: mongoose.Schema.Types.ObjectId, required: true }, role: { type: String, enum: ['owner','admin','member'], default: 'member' }, roleIds: { type: [mongoose.Schema.Types.ObjectId], default: [] }, showTag: { type: Boolean, default: false }, notificationPreference: { type: String, enum: ['all','mentions','muted'] }, lastChannelId: mongoose.Schema.Types.ObjectId, joinedAt: { type: Date, default: Date.now } }, { timestamps: true, collection: 'message_server_members' });
memberSchema.index({ tenantId: 1, serverId: 1, accountId: 1 }, { unique: true });
memberSchema.index({ tenantId: 1, accountId: 1, joinedAt: -1 });

export interface MessageServerCategoryFields { tenantId: mongoose.Types.ObjectId; serverId: mongoose.Types.ObjectId; name: string; position: number; createdByAccountId: mongoose.Types.ObjectId; archivedAt?: Date; }
const categorySchema = new mongoose.Schema<MessageServerCategoryFields>({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, serverId: { type: mongoose.Schema.Types.ObjectId, required: true }, name: { type: String, required: true, trim: true, maxlength: 60 }, position: { type: Number, default: 0 }, createdByAccountId: { type: mongoose.Schema.Types.ObjectId, required: true }, archivedAt: Date }, { timestamps: true, collection: 'message_server_categories' });
categorySchema.index({ tenantId: 1, serverId: 1, name: 1 }, { unique: true });

export interface MessageServerChannelFields { tenantId: mongoose.Types.ObjectId; serverId: mongoose.Types.ObjectId; categoryId: mongoose.Types.ObjectId; name: string; description: string; kind: 'text' | 'announcement' | 'posts' | 'voice'; posting: 'members' | 'staff'; repliesEnabled?: boolean; position?: number; isPrivate?: boolean; allowedRoleIds?: mongoose.Types.ObjectId[]; permissionOverrides?: Array<{ roleId?: mongoose.Types.ObjectId; permission: string; state: 'allow'|'deny' }>; createdByAccountId: mongoose.Types.ObjectId; archivedAt?: Date; }
const channelSchema = new mongoose.Schema<MessageServerChannelFields>({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, serverId: { type: mongoose.Schema.Types.ObjectId, required: true }, categoryId: { type: mongoose.Schema.Types.ObjectId, required: true }, name: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9-]{2,40}$/ }, description: { type: String, default: '', trim: true, maxlength: 240 }, kind: { type: String, enum: ['text','announcement','posts','voice'], default: 'text' }, posting: { type: String, enum: ['members','staff'], default: 'members' }, repliesEnabled: { type: Boolean, default: true }, position: { type: Number, default: 0 }, isPrivate: { type: Boolean, default: false }, allowedRoleIds: { type: [mongoose.Schema.Types.ObjectId], default: [] }, permissionOverrides: [{ roleId: mongoose.Schema.Types.ObjectId, permission: { type: String, required: true }, state: { type: String, enum: ['allow','deny'], required: true } }], createdByAccountId: { type: mongoose.Schema.Types.ObjectId, required: true }, archivedAt: Date }, { timestamps: true, collection: 'message_server_channels' });
channelSchema.index({ tenantId: 1, serverId: 1, categoryId: 1, name: 1 }, { unique: true });

export interface MessageServerAttachment { url: string; name: string; mimeType: string; size: number; }
export interface MessageServerMessageFields { tenantId: mongoose.Types.ObjectId; serverId: mongoose.Types.ObjectId; channelId: mongoose.Types.ObjectId; authorAccountId: mongoose.Types.ObjectId; authorProfileId: mongoose.Types.ObjectId; authorName: string; authorUsername: string; authorAvatarUrl: string; content: string; attachments?: MessageServerAttachment[]; system?: boolean; systemEventKey?: string; pinnedAt?: Date; pinnedByAccountId?: mongoose.Types.ObjectId; createdAt?: Date; updatedAt?: Date; deletedAt?: Date; deletedBy?: mongoose.Types.ObjectId; }
const messageSchema = new mongoose.Schema<MessageServerMessageFields>({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, serverId: { type: mongoose.Schema.Types.ObjectId, required: true }, channelId: { type: mongoose.Schema.Types.ObjectId, required: true }, authorAccountId: { type: mongoose.Schema.Types.ObjectId, required: true }, authorProfileId: { type: mongoose.Schema.Types.ObjectId, required: true }, authorName: { type: String, required: true, maxlength: 60 }, authorUsername: { type: String, required: true, maxlength: 24 }, authorAvatarUrl: { type: String, default: '', maxlength: 500 }, content: { type: String, required: true, trim: true, maxlength: 2000 }, attachments: { type: [{ url: String, name: String, mimeType: String, size: Number }], default: [] }, system: { type: Boolean, default: false }, systemEventKey: { type: String, maxlength: 150 }, pinnedAt: Date, pinnedByAccountId: mongoose.Schema.Types.ObjectId, deletedAt: Date, deletedBy: mongoose.Schema.Types.ObjectId }, { timestamps: true, collection: 'message_server_messages' });
messageSchema.index({ tenantId: 1, serverId: 1, channelId: 1, createdAt: -1 });
messageSchema.index({ tenantId: 1, serverId: 1, systemEventKey: 1 }, { unique: true, partialFilterExpression: { systemEventKey: { $type: 'string' } } });

function getModel<T>(name: string, schema: mongoose.Schema<T>) { return (mongoose.models[name] as mongoose.Model<T> | undefined) ?? mongoose.model<T>(name, schema); }
export const MessageServer = getModel<MessageServerFields>('MessageServer', serverSchema);
export const MessageServerMember = getModel<MessageServerMemberFields>('MessageServerMember', memberSchema);
export const MessageServerCategory = getModel<MessageServerCategoryFields>('MessageServerCategory', categorySchema);
export const MessageServerChannel = getModel<MessageServerChannelFields>('MessageServerChannel', channelSchema);
export const MessageServerMessage = getModel<MessageServerMessageFields>('MessageServerMessage', messageSchema);

export interface MessageServerPostFields { tenantId: mongoose.Types.ObjectId; serverId: mongoose.Types.ObjectId; channelId: mongoose.Types.ObjectId; authorAccountId: mongoose.Types.ObjectId; authorProfileId: mongoose.Types.ObjectId; authorName: string; authorAvatarUrl: string; title: string; content: string; cover?: MessageServerAttachment; attachments?: MessageServerAttachment[]; pinnedAt?: Date; pinnedByAccountId?: mongoose.Types.ObjectId; editedAt?: Date; deletedAt?: Date; replyCount?: number; createdAt?:Date;updatedAt?:Date; }
const postSchema = new mongoose.Schema<MessageServerPostFields>({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, serverId: { type: mongoose.Schema.Types.ObjectId, required: true }, channelId: { type: mongoose.Schema.Types.ObjectId, required: true }, authorAccountId: { type: mongoose.Schema.Types.ObjectId, required: true }, authorProfileId: { type: mongoose.Schema.Types.ObjectId, required: true }, authorName: { type: String, required: true, maxlength: 60 }, authorAvatarUrl: { type: String, default: '', maxlength: 500 }, title: { type: String, required: true, trim: true, maxlength: 120 }, content: { type: String, required: true, trim: true, maxlength: 10000 }, cover: { url: String, name: String, mimeType: String, size: Number }, attachments: { type: [{ url: String, name: String, mimeType: String, size: Number }], default: [] }, pinnedAt: Date, pinnedByAccountId: mongoose.Schema.Types.ObjectId, editedAt: Date, deletedAt: Date, replyCount: { type: Number, default: 0 } }, { timestamps: true, collection: 'message_server_posts' });
postSchema.index({ tenantId: 1, serverId: 1, channelId: 1, pinnedAt: -1, updatedAt: -1 });
export const MessageServerPost = getModel<MessageServerPostFields>('MessageServerPost', postSchema);

export interface MessageServerPostReplyFields { tenantId: mongoose.Types.ObjectId; serverId: mongoose.Types.ObjectId; channelId: mongoose.Types.ObjectId; postId: mongoose.Types.ObjectId; authorAccountId: mongoose.Types.ObjectId; authorProfileId: mongoose.Types.ObjectId; authorName: string; authorAvatarUrl: string; content: string; attachments?: MessageServerAttachment[]; deletedAt?: Date; deletedBy?: mongoose.Types.ObjectId; createdAt?:Date;updatedAt?:Date; }
const postReplySchema = new mongoose.Schema<MessageServerPostReplyFields>({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, serverId: { type: mongoose.Schema.Types.ObjectId, required: true }, channelId: { type: mongoose.Schema.Types.ObjectId, required: true }, postId: { type: mongoose.Schema.Types.ObjectId, required: true }, authorAccountId: { type: mongoose.Schema.Types.ObjectId, required: true }, authorProfileId: { type: mongoose.Schema.Types.ObjectId, required: true }, authorName: { type: String, required: true, maxlength: 60 }, authorAvatarUrl: { type: String, default: '', maxlength: 500 }, content: { type: String, required: true, maxlength: 4000 }, attachments: { type: [{ url: String, name: String, mimeType: String, size: Number }], default: [] }, deletedAt: Date, deletedBy: mongoose.Schema.Types.ObjectId }, { timestamps: true, collection: 'message_server_post_replies' });
postReplySchema.index({ tenantId: 1, serverId: 1, channelId: 1, postId: 1, createdAt: 1 });
export const MessageServerPostReply = getModel<MessageServerPostReplyFields>('MessageServerPostReply', postReplySchema);
