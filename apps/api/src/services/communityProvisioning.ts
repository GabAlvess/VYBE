import mongoose from 'mongoose';
import { Community } from '../models/Community.js';
import { Account, Character } from '../models/Social.js';
import { CommunityAudit } from '../models/CommunityAudit.js';
import { VybeAccount } from '../models/VybeAccount.js';
import { VybeNotification } from '../models/VybeNotification.js';
import { CommunityRequest, type CommunityRequestFields } from '../models/CommunityRequest.js';

export const SYSTEM_COMMUNITY_DEFAULTS = Object.freeze({
  type: 'public' as const,
  entry: 'open' as const,
  status: 'active' as const,
  category: '',
  memberCount: 1,
  rules: [] as string[],
  brand: {
    primary: '#16815D', dark: '#0D6248', medium: '#35A67A',
    soft: '#F2FAF6', lilac: '#DDF3EA', white: '#FFFFFF', graphite: '#1F2422',
  },
  settings: {
    access: { visibility: 'public' as const, approvalRequired: false, invitesEnabled: true, welcomeMessage: '' },
    characters: { usernameMinLength: 3, usernameMaxLength: 24, minimumAge: 18, requireBio: false, customFields: [] as Array<{ key: string; label: string; required: boolean }> },
    features: { feed: true, pulse: true, stories: true, conversations: true, messages: true, events: true, match: true, bank: true, academic: true, career: true, news: true, companies: true, eventCreation: 'any_pending' as const },
    privacy: { showInDirectory: true, showMembers: true, showAdmins: true, publicContent: true },
    moderation: { rules: [] as string[], requireReportReason: true, maxPostLength: 5000 },
  },
});

export async function ensureProvisioningCollections() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Banco de dados indisponível para aprovar a comunidade.');
  const required = [Community, Account, Character, CommunityAudit, CommunityRequest, VybeNotification];
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));
  for (const model of required) {
    if (!existing.has(model.collection.collectionName)) {
      await db.createCollection(model.collection.collectionName);
      existing.add(model.collection.collectionName);
    }
  }
}

export function buildNewCommunityFromRequest(row: Pick<CommunityRequestFields,
  'rpgName' | 'slug' | 'description' | 'photoFilename'>) {
  return {
    name: row.rpgName,
    slug: row.slug,
    subdomain: row.slug,
    description: row.description,
    coverUrl: `/media/${row.slug}/${row.photoFilename}`,
    wallpaperUrl: '',
    logoUrl: '',
    ...SYSTEM_COMMUNITY_DEFAULTS,
    rules: [...SYSTEM_COMMUNITY_DEFAULTS.rules],
    brand: { ...SYSTEM_COMMUNITY_DEFAULTS.brand },
    admins: [],
    moderators: [],
    ownerEmail: '',
    settings: {
      access: { ...SYSTEM_COMMUNITY_DEFAULTS.settings.access },
      characters: { ...SYSTEM_COMMUNITY_DEFAULTS.settings.characters, customFields: [] },
      features: { ...SYSTEM_COMMUNITY_DEFAULTS.settings.features },
      privacy: { ...SYSTEM_COMMUNITY_DEFAULTS.settings.privacy },
      moderation: { ...SYSTEM_COMMUNITY_DEFAULTS.settings.moderation, rules: [] },
    },
  };
}

export function buildOwnerRecords(input: {
  tenantId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  email: string;
  passwordHash: string;
  globalAccountId?: mongoose.Types.ObjectId;
  displayName: string;
  username: string;
}) {
  const safeUsername = input.username.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 24);
  const displayName = input.displayName.trim().slice(0, 60);
  return {
    account: {
      _id: input.accountId,
      tenantId: input.tenantId,
      ...(input.globalAccountId ? { globalAccountId: input.globalAccountId } : {}),
      email: input.email,
      passwordHash: input.passwordHash,
      status: 'active' as const,
    },
    character: {
      tenantId: input.tenantId,
      accountId: input.accountId,
      username: safeUsername.length >= 3 ? safeUsername : `owner.${input.accountId.toString().slice(-6)}`,
      displayName: displayName.length >= 2 ? displayName : 'Owner',
      bio: '', avatarUrl: '', coverUrl: '', followerCount: 0, followingCount: 0, postCount: 0,
    },
  };
}

export async function provisionApprovedCommunity(
  row: InstanceType<typeof CommunityRequest>,
  reviewerId: mongoose.Types.ObjectId,
  session: mongoose.ClientSession,
) {
  const sourceAccount = row.accountId
    ? await Account.findOne({ _id: row.accountId, tenantId: row.sourceTenantId }).session(session).exec() as any
    : null;
  const globalAccountId = row.globalAccountId ?? sourceAccount?.globalAccountId;
  const globalAccount = globalAccountId
    ? await VybeAccount.findOne({ _id: globalAccountId, status: 'active' }).session(session).exec() as any
    : null;
  if (row.globalAccountId && !globalAccount) throw new Error('A conta solicitante não está disponível.');
  if (!sourceAccount && !globalAccount) throw new Error('Não foi possível validar a identidade do Owner solicitante.');

  const communityPayload = buildNewCommunityFromRequest(row);
  const [community] = await Community.create([{
    ...communityPayload,
    ownerEmail: row.applicantEmail,
  }], { session });

  const ownerAccountId = new mongoose.Types.ObjectId();
  const ownerRecords = buildOwnerRecords({
    tenantId: community._id, accountId: ownerAccountId, ...(globalAccountId ? { globalAccountId } : {}),
    email: row.applicantEmail, passwordHash: globalAccount?.passwordHash ?? sourceAccount!.passwordHash,
    displayName: row.applicantName || globalAccount?.displayName || 'Owner',
    username: row.applicantUsername || globalAccount?.username || 'owner',
  });
  if (globalAccount || sourceAccount?.termsAcceptedAt) Object.assign(ownerRecords.account, {
    ...(globalAccount?.termsAcceptedAt ?? sourceAccount?.termsAcceptedAt ? { termsAcceptedAt: globalAccount?.termsAcceptedAt ?? sourceAccount?.termsAcceptedAt } : {}),
    ...(globalAccount?.termsVersion ?? sourceAccount?.termsVersion ? { termsVersion: globalAccount?.termsVersion ?? sourceAccount?.termsVersion } : {}),
    ...(globalAccount?.privacyAcceptedAt ?? sourceAccount?.privacyAcceptedAt ? { privacyAcceptedAt: globalAccount?.privacyAcceptedAt ?? sourceAccount?.privacyAcceptedAt } : {}),
    ...(globalAccount?.privacyVersion ?? sourceAccount?.privacyVersion ? { privacyVersion: globalAccount?.privacyVersion ?? sourceAccount?.privacyVersion } : {}),
  });
  const [ownerAccount] = await Account.create([ownerRecords.account], { session });
  await Character.create([ownerRecords.character], { session });
  community.ownerAccountId = ownerAccount._id;
  community.ownerEmail = ownerAccount.email;
  community.admins = [ownerAccount._id];
  await community.save({ session });
  await CommunityAudit.create([{
    tenantId: community._id, actorId: reviewerId, action: 'platform.community.approved',
    details: { communityName: community.name, ownerAccountId: ownerAccount._id.toString(), requestId: row._id.toString() },
  }], { session });
  if (row.globalAccountId) {
    await VybeNotification.create([{
      accountId: row.globalAccountId, communityId: community._id, communityRequestId: row._id,
      type: 'community_creation_update', status: 'APPROVED',
      message: `Sua solicitação para criar ${community.name} foi aprovada.`,
    }], { session });
  }
  return community;
}
