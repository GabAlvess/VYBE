import mongoose from 'mongoose';

export type MatchReactionType = 'like' | 'star' | 'pass';
export const isPositiveMatchReaction = (type: MatchReactionType | undefined) => type === 'like' || type === 'star';
export const createsMutualMatch = (incoming: MatchReactionType, previous: MatchReactionType | undefined) => isPositiveMatchReaction(incoming) && isPositiveMatchReaction(previous);
export const validMatchAge = (age: unknown): age is number => Number.isInteger(age) && typeof age === 'number' && age >= 18 && age <= 120;

export function canonicalProfilePair(left: mongoose.Types.ObjectId | string, right: mongoose.Types.ObjectId | string) {
  const ids = [left.toString(), right.toString()].sort();
  return { profileAId: new mongoose.Types.ObjectId(ids[0]), profileBId: new mongoose.Types.ObjectId(ids[1]) };
}

export function matchDiscoveryFilter(tenantId: mongoose.Types.ObjectId, currentId: mongoose.Types.ObjectId, excludedIds: mongoose.Types.ObjectId[]) {
  return { tenantId, enabled: true, age: { $gte: 18, $lte: 120 }, characterId: { $nin: [currentId, ...excludedIds] } };
}

export function canAccessMatch(match: { status: string; profileAId: mongoose.Types.ObjectId; profileBId: mongoose.Types.ObjectId } | null, currentId: mongoose.Types.ObjectId, blocked: boolean) {
  return Boolean(match && match.status === 'active' && !blocked && (match.profileAId.equals(currentId) || match.profileBId.equals(currentId)));
}

export function matchFeatureIsEnabled(tenant: { settings?: { features?: { match?: boolean } } }) {
  return tenant.settings?.features?.match !== false;
}
