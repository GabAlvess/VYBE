import mongoose from 'mongoose';

type CommunityOwnerFields = { ownerAccountId?: mongoose.Types.ObjectId; admins: mongoose.Types.ObjectId[]; ownerEmail?: string };
type AccountIdentity = { _id: mongoose.Types.ObjectId; email: string };

export function isCommunityOwner(community: CommunityOwnerFields, user: AccountIdentity) {
  const configuredOwner = community.ownerAccountId ?? community.admins[0];
  return Boolean(configuredOwner?.equals(user._id) || community.ownerEmail?.toLowerCase() === user.email.toLowerCase());
}

export function isPlatformAppCreator(user: AccountIdentity) {
  const creators = (process.env.VYBE_PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return creators.includes(user.email.toLowerCase());
}

export function sanctionEndDate(durationDays: number | null, now = new Date()) {
  if (durationDays === null) return undefined;
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) throw new Error('Duração inválida.');
  return new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
}
