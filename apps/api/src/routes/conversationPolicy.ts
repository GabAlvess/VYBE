import mongoose from 'mongoose';
import type { ConversationKind, ConversationParticipantFields } from '../models/Conversation.js';

export function conversationDirectKey(left: mongoose.Types.ObjectId | string, right: mongoose.Types.ObjectId | string) { return [left.toString(), right.toString()].sort().join(':'); }
export function isActiveParticipant(participants: ConversationParticipantFields[], profileId: mongoose.Types.ObjectId) { return participants.some((participant) => participant.profileId.equals(profileId) && !participant.leftAt); }
export function canAccessConversation(tenantId: mongoose.Types.ObjectId, currentTenantId: mongoose.Types.ObjectId, participants: ConversationParticipantFields[], profileId: mongoose.Types.ObjectId) { return tenantId.equals(currentTenantId) && isActiveParticipant(participants, profileId); }
export function canSendDirect(kind: ConversationKind, recipientCount: number, blocked: boolean) { return kind !== 'direct' || (recipientCount === 1 && !blocked); }
export function canManageConversation(role: string | undefined, active: boolean) { return active && role === 'admin'; }
export function isUnreadMessage(createdAt: Date, lastReadAt?: Date, own = false) { return !own && (!lastReadAt || createdAt > lastReadAt); }
export function canDeleteMessage(senderId: string, currentProfileId: string, createdAt: Date, now = new Date()) { return senderId === currentProfileId && now.getTime() >= createdAt.getTime() && now.getTime() - createdAt.getTime() <= 5 * 60 * 1000; }
