import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { Account, Character, CommunityEvent, EventRSVP, Notification } from '../models/Social.js';
import { CommunityAudit } from '../models/CommunityAudit.js';
import { DirectMessage, DirectTyping } from '../models/Chat.js';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { Match, MatchBlock, MatchMessage, MatchProfile, MatchReaction } from '../models/Match.js';
import { Conversation, ConversationBlock, ConversationMessage } from '../models/Conversation.js';
import { MessageAppProfile } from '../models/MessageAppProfile.js';
import { Wallet, WalletTransaction } from '../models/Wallet.js';
import { EchoAppProfile } from '../models/EchoAppProfile.js';
import { AcademicAssignment, AcademicContent, AcademicDiscipline, AcademicDisciplineTeacher, AcademicEnrollment, AcademicExam, AcademicExamSubmission, AcademicGrade, AcademicInvite, AcademicLesson, AcademicProfile, AcademicRole, AcademicSubmission } from '../models/Academic.js';
import { NewsArticle, NewsAudit, NewsCategory, NewsComment, NewsEdition, NewsEditionArticle, NewsRole, NewsView } from '../models/News.js';
import { CareerApplication, CareerGrant, CareerJob, CareerListing, CareerProfile, MentorshipRequest } from '../models/Career.js';
import { Community } from '../models/Community.js';
import { CommunityJoinRequest } from '../models/CommunityJoinRequest.js';
import { VybeAccount } from '../models/VybeAccount.js';
import { VybeSession } from '../models/VybeSession.js';
import { VybeNotification } from '../models/VybeNotification.js';
import { migrateVerificationBeneficiaries } from '../services/migrateVerificationBeneficiaries.js';

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

  await Community.updateMany({ 'settings.characters.minimumAge': { $exists: false } }, { $set: { 'settings.characters.minimumAge': 18 } });

  const verificationMigration = await migrateVerificationBeneficiaries();
  console.log(`VYBE+ beneficiary migration completed. Updated ${verificationMigration.modifiedCount} legacy requests; removed old requester index: ${verificationMigration.legacyIndexRemoved}.`);

  // Preserve existing active users as VYBE accounts while keeping their tenant-scoped characters as memberships.
  const activeAccounts = await Account.find({ status: 'active' }).sort({ createdAt: 1 }).lean();
  for (const localAccount of activeAccounts) {
    const existingGlobal = await VybeAccount.findOne({ email: localAccount.email }).select('_id').lean() as { _id: mongoose.Types.ObjectId } | null;
    let globalAccountId = existingGlobal?._id;
    if (!globalAccountId) {
      const localCharacter = await Character.findOne({ tenantId: localAccount.tenantId, accountId: localAccount._id }).sort({ createdAt: 1 }).lean();
      const baseUsername = (localCharacter?.username ?? localCharacter?.displayName ?? 'membro').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 24) || 'membro';
      let username = baseUsername.length >= 3 ? baseUsername : `membro.${baseUsername}`;
      if (await VybeAccount.exists({ username })) username = `${username.slice(0, 17)}.${localAccount._id.toString().slice(-6)}`;
      const created = await VybeAccount.create({ email: localAccount.email, passwordHash: localAccount.passwordHash, displayName: localCharacter?.displayName ?? 'Membro VYBE', username, avatarUrl: localCharacter?.avatarUrl ?? '', status: 'active', termsAcceptedAt: localAccount.termsAcceptedAt, termsVersion: localAccount.termsVersion, privacyAcceptedAt: localAccount.privacyAcceptedAt, privacyVersion: localAccount.privacyVersion });
      globalAccountId = created._id;
    }
    await Account.updateMany({ email: localAccount.email, status: 'active', globalAccountId: { $exists: false } }, { $set: { globalAccountId } });
  }

  // Apply indexes for community membership, events, messaging, Match, virtual wallets, academic records, and Career.
  await Promise.all([Community.createIndexes(), Account.createIndexes(), Character.createIndexes(), CommunityJoinRequest.createIndexes(), VybeAccount.createIndexes(), VybeSession.createIndexes(), VybeNotification.createIndexes(), CommunityEvent.createIndexes(), EventRSVP.createIndexes(), Notification.createIndexes(), CommunityAudit.createIndexes(), DirectMessage.createIndexes(), DirectTyping.createIndexes(), VerificationRequest.createIndexes(), MatchProfile.createIndexes(), MatchReaction.createIndexes(), Match.createIndexes(), MatchBlock.createIndexes(), MatchMessage.createIndexes(), Conversation.createIndexes(), ConversationMessage.createIndexes(), ConversationBlock.createIndexes(), MessageAppProfile.createIndexes(), EchoAppProfile.createIndexes(), Wallet.createIndexes(), WalletTransaction.createIndexes(), AcademicRole.createIndexes(), AcademicProfile.createIndexes(), AcademicDiscipline.createIndexes(), AcademicDisciplineTeacher.createIndexes(), AcademicEnrollment.createIndexes(), AcademicLesson.createIndexes(), AcademicContent.createIndexes(), AcademicAssignment.createIndexes(), AcademicSubmission.createIndexes(), AcademicExam.createIndexes(), AcademicExamSubmission.createIndexes(), AcademicGrade.createIndexes(), AcademicInvite.createIndexes(), NewsRole.createIndexes(), NewsCategory.createIndexes(), NewsArticle.createIndexes(), NewsView.createIndexes(), NewsComment.createIndexes(), NewsEdition.createIndexes(), NewsEditionArticle.createIndexes(), NewsAudit.createIndexes(), CareerProfile.createIndexes(), CareerJob.createIndexes(), CareerApplication.createIndexes(), CareerGrant.createIndexes(), CareerListing.createIndexes(), MentorshipRequest.createIndexes()]);

  console.log('Database initialization and application indexes completed.');
} catch {
  console.error('Database initialization failed. Check MongoDB access and network settings.');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
