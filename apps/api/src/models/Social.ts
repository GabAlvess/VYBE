import mongoose, { type HydratedDocument } from 'mongoose';

export interface AccountFields {
  tenantId: mongoose.Types.ObjectId;
  globalAccountId?: mongoose.Types.ObjectId;
  email: string;
  passwordHash: string;
  status: 'pending' | 'active' | 'disabled';
  termsAcceptedAt?: Date;
  termsVersion?: string;
  privacyAcceptedAt?: Date;
  privacyVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}
export type AccountDocument = HydratedDocument<AccountFields>;
const accountSchema = new mongoose.Schema<AccountFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  globalAccountId: { type: mongoose.Schema.Types.ObjectId, default: undefined, index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  status: { type: String, enum: ['pending', 'active', 'disabled'], default: 'active' },
  termsAcceptedAt: { type: Date },
  termsVersion: { type: String, maxlength: 20 },
  privacyAcceptedAt: { type: Date },
  privacyVersion: { type: String, maxlength: 20 },
}, { timestamps: true });
accountSchema.index({ tenantId: 1, email: 1 }, { unique: true });
accountSchema.index({ tenantId: 1, globalAccountId: 1 }, { unique: true, partialFilterExpression: { globalAccountId: { $type: 'objectId' } } });

export interface CharacterFields {
  tenantId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  username: string;
  displayName: string;
  communityFunction?: string;
  bio: string;
  age?: number;
  photoplayerName?: string;
  normalizedPhotoplayerName?: string;
  photoplayerImageUrl?: string;
  avatarUrl: string;
  coverUrl: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  verification?: {
    verifiedAt?: Date;
    verifiedBy?: mongoose.Types.ObjectId;
    type?: 'OFFICIAL' | 'CREATOR' | 'PARTNER' | 'STAFF' | 'PAID_PROFILE';
    requestId?: mongoose.Types.ObjectId;
    removedAt?: Date;
    removedBy?: mongoose.Types.ObjectId;
    removalReason?: string;
  };
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}
export type CharacterDocument = HydratedDocument<CharacterFields>;
const characterSchema = new mongoose.Schema<CharacterFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  username: { type: String, required: true, lowercase: true, trim: true, match: /^[a-z0-9._]{3,24}$/ },
  displayName: { type: String, required: true, trim: true, maxlength: 60 },
  communityFunction: { type: String, default: '', trim: true, maxlength: 80 },
  bio: { type: String, default: '', maxlength: 280 },
  age: { type: Number, min: 13, max: 100, default: undefined },
  photoplayerName: { type: String, default: '', trim: true, maxlength: 100 },
  normalizedPhotoplayerName: { type: String, default: undefined, lowercase: true, trim: true, maxlength: 120 },
  photoplayerImageUrl: { type: String, default: '', maxlength: 300 },
  avatarUrl: { type: String, default: '' },
  coverUrl: { type: String, default: '' },
  followerCount: { type: Number, min: 0, default: 0 },
  followingCount: { type: Number, min: 0, default: 0 },
  postCount: { type: Number, min: 0, default: 0 },
  verification: {
    verifiedAt: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId },
    type: { type: String, enum: ['OFFICIAL', 'CREATOR', 'PARTNER', 'STAFF', 'PAID_PROFILE'] },
    requestId: { type: mongoose.Schema.Types.ObjectId },
    removedAt: { type: Date },
    removedBy: { type: mongoose.Schema.Types.ObjectId },
    removalReason: { type: String, maxlength: 500 },
  },
  seedKey: { type: String, default: undefined },
}, { timestamps: true });
characterSchema.index({ tenantId: 1, username: 1 }, { unique: true });
characterSchema.index({ tenantId: 1, normalizedPhotoplayerName: 1 }, { unique: true, partialFilterExpression: { normalizedPhotoplayerName: { $type: 'string' } } });
characterSchema.index({ tenantId: 1, seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } });

export interface SessionFields {
  tenantId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
}
const sessionSchema = new mongoose.Schema<SessionFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, required: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export interface PostFields {
  tenantId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  content: string;
  imageUrl: string;
  imageUrls?: string[];
  kind: 'post' | 'pulse';
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  poll?: {
    question: string;
    options: Array<{ id: string; text: string; votesCount: number }>;
    votes: Array<{ characterId: mongoose.Types.ObjectId; optionId: string }>;
  };
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}
export type PostDocument = HydratedDocument<PostFields>;
const postSchema = new mongoose.Schema<PostFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  content: { type: String, default: '', trim: true, maxlength: 5000 },
  imageUrl: { type: String, default: '', maxlength: 300 },
  imageUrls: { type: [String], default: [] },
  kind: { type: String, enum: ['post', 'pulse'], default: 'post', index: true },
  likesCount: { type: Number, min: 0, default: 0 },
  commentsCount: { type: Number, min: 0, default: 0 },
  viewsCount: { type: Number, min: 0, default: 0 },
  poll: {
    question: { type: String, trim: true, maxlength: 120 },
    options: [{ _id: false, id: { type: String, required: true }, text: { type: String, required: true, trim: true, maxlength: 80 }, votesCount: { type: Number, min: 0, default: 0 } }],
    votes: [{ _id: false, characterId: { type: mongoose.Schema.Types.ObjectId, required: true }, optionId: { type: String, required: true } }],
  },
  seedKey: { type: String, default: undefined },
}, { timestamps: true });
postSchema.index({ tenantId: 1, createdAt: -1 });
postSchema.index({ tenantId: 1, seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } });

export interface PostReportFields {
  tenantId: mongoose.Types.ObjectId;
  postId: mongoose.Types.ObjectId;
  reporterId: mongoose.Types.ObjectId;
  reason: string;
  status: 'open' | 'resolved';
}
const postReportSchema = new mongoose.Schema<PostReportFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  postId: { type: mongoose.Schema.Types.ObjectId, required: true },
  reporterId: { type: mongoose.Schema.Types.ObjectId, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
}, { timestamps: true, collection: 'community_post_reports' });
postReportSchema.index({ tenantId: 1, postId: 1, reporterId: 1 }, { unique: true });

export interface PostViewFields {
  tenantId: mongoose.Types.ObjectId;
  postId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
}
const postViewSchema = new mongoose.Schema<PostViewFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  postId: { type: mongoose.Schema.Types.ObjectId, required: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true, collection: 'post_views' });
postViewSchema.index({ tenantId: 1, postId: 1, characterId: 1 }, { unique: true });

export interface LikeFields { tenantId: mongoose.Types.ObjectId; postId: mongoose.Types.ObjectId; characterId: mongoose.Types.ObjectId; }
const likeSchema = new mongoose.Schema<LikeFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  postId: { type: mongoose.Schema.Types.ObjectId, required: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true });
likeSchema.index({ tenantId: 1, postId: 1, characterId: 1 }, { unique: true });

export interface SavedPostFields { tenantId: mongoose.Types.ObjectId; postId: mongoose.Types.ObjectId; characterId: mongoose.Types.ObjectId; }
const savedPostSchema = new mongoose.Schema<SavedPostFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  postId: { type: mongoose.Schema.Types.ObjectId, required: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true });
savedPostSchema.index({ tenantId: 1, postId: 1, characterId: 1 }, { unique: true });

export interface RepostFields { tenantId: mongoose.Types.ObjectId; postId: mongoose.Types.ObjectId; characterId: mongoose.Types.ObjectId; comment?: string; }
const repostSchema = new mongoose.Schema<RepostFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  postId: { type: mongoose.Schema.Types.ObjectId, required: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true },
  comment: { type: String, default: '', trim: true, maxlength: 500 },
}, { timestamps: true });
repostSchema.index({ tenantId: 1, postId: 1, characterId: 1 }, { unique: true });

export interface StoryFields { tenantId: mongoose.Types.ObjectId; characterId: mongoose.Types.ObjectId; imageUrl: string; expiresAt: Date; createdAt: Date; updatedAt: Date; }
const storySchema = new mongoose.Schema<StoryFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  imageUrl: { type: String, required: true, maxlength: 300 },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export interface StoryViewFields { tenantId: mongoose.Types.ObjectId; storyId: mongoose.Types.ObjectId; viewerCharacterId: mongoose.Types.ObjectId; }
const storyViewSchema = new mongoose.Schema<StoryViewFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  storyId: { type: mongoose.Schema.Types.ObjectId, required: true },
  viewerCharacterId: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true });
storyViewSchema.index({ tenantId: 1, storyId: 1, viewerCharacterId: 1 }, { unique: true });

export interface CommentFields {
  tenantId: mongoose.Types.ObjectId;
  postId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  content: string;
  replyToCommentId?: mongoose.Types.ObjectId;
  seedKey?: string;
  createdAt: Date;
}
const commentSchema = new mongoose.Schema<CommentFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  postId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true },
  content: { type: String, required: true, trim: true, maxlength: 1000 },
  replyToCommentId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  seedKey: { type: String, default: undefined },
}, { timestamps: true });
commentSchema.index({ tenantId: 1, seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } });

export interface FollowFields { tenantId: mongoose.Types.ObjectId; followerId: mongoose.Types.ObjectId; followedId: mongoose.Types.ObjectId; seedKey?: string; }
const followSchema = new mongoose.Schema<FollowFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  followerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  followedId: { type: mongoose.Schema.Types.ObjectId, required: true },
  seedKey: { type: String, default: undefined },
}, { timestamps: true });
followSchema.index({ tenantId: 1, followerId: 1, followedId: 1 }, { unique: true });
followSchema.index({ tenantId: 1, seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } });

export interface NotificationFields {
  tenantId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  actorId: mongoose.Types.ObjectId;
  type: 'follow' | 'like' | 'comment' | 'mention' | 'message' | 'echo_like' | 'echo_mention' | 'repost' | 'echo_reply' | 'event_created' | 'event_updated' | 'event_cancelled' | 'event_review' | 'event_pending' | 'verification_requested' | 'verification_payment_confirmed' | 'verification_approved' | 'verification_rejected' | 'verification_removed' | 'bank_transfer_received' | 'bank_admin_credit_received' | 'academic_update' | 'academic_submission' | 'academic_grade' | 'news_published' | 'news_reviewed' | 'career_status' | 'career_job' | 'community_join_update';
  targetId: mongoose.Types.ObjectId;
  readAt?: Date;
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}
const notificationSchema = new mongoose.Schema<NotificationFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  type: { type: String, enum: ['follow', 'like', 'comment', 'mention', 'message', 'echo_like', 'echo_mention', 'repost', 'echo_reply', 'event_created', 'event_updated', 'event_cancelled', 'event_review', 'event_pending', 'verification_requested', 'verification_payment_confirmed', 'verification_approved', 'verification_rejected', 'verification_removed', 'bank_transfer_received', 'bank_admin_credit_received', 'academic_update', 'academic_submission', 'academic_grade', 'news_published', 'news_reviewed', 'career_status', 'career_job', 'community_join_update'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  readAt: { type: Date },
  seedKey: { type: String, default: undefined },
}, { timestamps: true });
notificationSchema.index({ tenantId: 1, characterId: 1, createdAt: -1 });
notificationSchema.index({ tenantId: 1, seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } });

export interface EventFields {
  tenantId: mongoose.Types.ObjectId;
  creatorCharacterId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  startsAt: Date;
  endsAt?: Date;
  location: string;
  imageUrl: string;
  category: string;
  participantLimit: number | null;
  allowComments: boolean;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'cancelled' | 'completed' | 'changes_requested' | 'upcoming';
  official: boolean;
  rejectedReason: string;
  cancellationReason: string;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  cancelledBy?: mongoose.Types.ObjectId;
  cancelledAt?: Date;
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}
const eventSchema = new mongoose.Schema<EventFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  creatorCharacterId: { type: mongoose.Schema.Types.ObjectId, required: false, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 1000 },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date },
  location: { type: String, required: true, trim: true, maxlength: 160 },
  imageUrl: { type: String, default: '' },
  category: { type: String, default: 'outro', maxlength: 32 },
  participantLimit: { type: Number, default: null, min: 1 },
  allowComments: { type: Boolean, default: true },
  status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'completed', 'changes_requested', 'upcoming'], default: 'pending_approval' },
  official: { type: Boolean, default: false },
  rejectedReason: { type: String, default: '', maxlength: 500 },
  cancellationReason: { type: String, default: '', maxlength: 500 },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId },
  reviewedAt: { type: Date },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId },
  cancelledAt: { type: Date },
  seedKey: { type: String, default: undefined },
}, { timestamps: true });
eventSchema.index({ tenantId: 1, startsAt: 1 });
eventSchema.index({ tenantId: 1, seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } });

export interface EventRSVPFields {
  tenantId: mongoose.Types.ObjectId;
  eventId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  status: 'going' | 'maybe' | 'not_going' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}
const eventRSVPSchema = new mongoose.Schema<EventRSVPFields>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  eventId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  characterId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  status: { type: String, enum: ['going', 'maybe', 'not_going', 'cancelled'], default: 'going' },
}, { timestamps: true });
eventRSVPSchema.index({ tenantId: 1, eventId: 1, characterId: 1 }, { unique: true });

function model<T>(name: string, schema: mongoose.Schema<T>) {
  return (mongoose.models[name] as mongoose.Model<T> | undefined) ?? mongoose.model<T>(name, schema);
}

export const Account = model<AccountFields>('Account', accountSchema);
export const Character = model<CharacterFields>('Character', characterSchema);
export const Session = model<SessionFields>('Session', sessionSchema);
export const Post = model<PostFields>('Post', postSchema);
export const PostReport = model<PostReportFields>('PostReport', postReportSchema);
export const PostView = model<PostViewFields>('PostView', postViewSchema);
export const Like = model<LikeFields>('Like', likeSchema);
export const SavedPost = model<SavedPostFields>('SavedPost', savedPostSchema);
export const Repost = model<RepostFields>('Repost', repostSchema);
export const Story = model<StoryFields>('Story', storySchema);
export const StoryView = model<StoryViewFields>('StoryView', storyViewSchema);
export const Comment = model<CommentFields>('Comment', commentSchema);
export const Follow = model<FollowFields>('Follow', followSchema);
export const Notification = model<NotificationFields>('Notification', notificationSchema);
export const CommunityEvent = model<EventFields>('CommunityEvent', eventSchema);
export const EventRSVP = model<EventRSVPFields>('EventRSVP', eventRSVPSchema);
