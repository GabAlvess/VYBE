import mongoose from 'mongoose';
import { Conversation } from '../models/Conversation.js';

export async function getOrCreateMatchConversation(tenantId: mongoose.Types.ObjectId, matchId: mongoose.Types.ObjectId, profileAId: mongoose.Types.ObjectId, profileBId: mongoose.Types.ObjectId) {
  const directKey = [profileAId.toString(), profileBId.toString()].sort().join(':');
  return Conversation.findOneAndUpdate(
    { tenantId, kind: 'direct', directKey },
    { $setOnInsert: { tenantId, kind: 'direct', directKey, createdBy: profileAId, participants: [{ profileId: profileAId, role: 'member' }, { profileId: profileBId, role: 'member' }] }, $set: { matchId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}
