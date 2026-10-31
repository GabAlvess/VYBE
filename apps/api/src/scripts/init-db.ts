import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { CommunityEvent, EventRSVP, Notification } from '../models/Social.js';
import { CommunityAudit } from '../models/CommunityAudit.js';
import { DirectMessage, DirectTyping } from '../models/Chat.js';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { Match, MatchBlock, MatchMessage, MatchProfile, MatchReaction } from '../models/Match.js';
import { Conversation, ConversationBlock, ConversationMessage } from '../models/Conversation.js';
import { MessageAppProfile } from '../models/MessageAppProfile.js';
import { Wallet, WalletTransaction } from '../models/Wallet.js';
import { EchoAppProfile } from '../models/EchoAppProfile.js';
import { AcademicAssignment, AcademicContent, AcademicDiscipline, AcademicDisciplineTeacher, AcademicEnrollment, AcademicExam, AcademicGrade, AcademicInvite, AcademicLesson, AcademicRole, AcademicSubmission } from '../models/Academic.js';
import { NewsArticle, NewsAudit, NewsCategory, NewsComment, NewsEdition, NewsEditionArticle, NewsRole, NewsView } from '../models/News.js';
import { CareerApplication, CareerGrant, CareerJob, CareerListing, CareerProfile, MentorshipRequest } from '../models/Career.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('MONGODB_URI is required. Configure it in the local .env file.');
  process.exit(1);
}

try {
  const mongoOptions = process.env.NODE_ENV === 'development'
    ? { dbName: process.env.VYBE_DEV_DB_NAME ?? 'vybe_dev' }
    : {};
  await mongoose.connect(uri, mongoOptions);
  const database = mongoose.connection.db;

  if (!database) {
    throw new Error('Database connection did not provide a database handle.');
  }

  const existing = await database.listCollections({ name: 'communities' }).toArray();
  if (existing.length === 0) {
    await database.createCollection('communities');
  }

  // Apply indexes for events, messaging, Match, virtual wallets, academic records, and Career.
  await Promise.all([CommunityEvent.createIndexes(), EventRSVP.createIndexes(), Notification.createIndexes(), CommunityAudit.createIndexes(), DirectMessage.createIndexes(), DirectTyping.createIndexes(), VerificationRequest.createIndexes(), MatchProfile.createIndexes(), MatchReaction.createIndexes(), Match.createIndexes(), MatchBlock.createIndexes(), MatchMessage.createIndexes(), Conversation.createIndexes(), ConversationMessage.createIndexes(), ConversationBlock.createIndexes(), MessageAppProfile.createIndexes(), EchoAppProfile.createIndexes(), Wallet.createIndexes(), WalletTransaction.createIndexes(), AcademicRole.createIndexes(), AcademicDiscipline.createIndexes(), AcademicDisciplineTeacher.createIndexes(), AcademicEnrollment.createIndexes(), AcademicLesson.createIndexes(), AcademicContent.createIndexes(), AcademicAssignment.createIndexes(), AcademicSubmission.createIndexes(), AcademicExam.createIndexes(), AcademicGrade.createIndexes(), AcademicInvite.createIndexes(), NewsRole.createIndexes(), NewsCategory.createIndexes(), NewsArticle.createIndexes(), NewsView.createIndexes(), NewsComment.createIndexes(), NewsEdition.createIndexes(), NewsEditionArticle.createIndexes(), NewsAudit.createIndexes(), CareerProfile.createIndexes(), CareerJob.createIndexes(), CareerApplication.createIndexes(), CareerGrant.createIndexes(), CareerListing.createIndexes(), MentorshipRequest.createIndexes()]);

  console.log('Database initialization and application indexes completed.');
} catch {
  console.error('Database initialization failed. Check MongoDB access and network settings.');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
