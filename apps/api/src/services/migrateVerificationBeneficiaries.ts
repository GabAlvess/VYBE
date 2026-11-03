import mongoose from 'mongoose';
import { VerificationRequest } from '../models/VerificationRequest.js';

/** Backfills beneficiary metadata and replaces the legacy requester uniqueness rule. */
export async function migrateVerificationBeneficiaries() {
  const collection = VerificationRequest.collection;
  const migration = await collection.updateMany(
    { $or: [
      { beneficiaryProfileId: { $exists: false } },
      { requestedByUserId: { $exists: false } },
      { isGift: { $exists: false } },
      { source: { $exists: false } },
    ] },
    [{ $set: {
      beneficiaryProfileId: { $ifNull: ['$beneficiaryProfileId', '$characterId'] },
      requestedByUserId: { $ifNull: ['$requestedByUserId', '$accountId'] },
      isGift: { $ifNull: ['$isGift', false] },
      source: { $ifNull: ['$source', { $cond: [{ $eq: [{ $ifNull: ['$isGift', false] }, true] }, 'GIFT', 'SELF_PURCHASE'] }] },
    } }],
  );

  const indexes = await collection.indexes();
  const legacyUniqueIndex = indexes.find((index) => index.unique && index.key.tenantId === 1 && index.key.characterId === 1 && index.key.active === 1);
  if (legacyUniqueIndex?.name) await collection.dropIndex(legacyUniqueIndex.name);

  await collection.createIndex(
    { tenantId: 1, beneficiaryProfileId: 1, active: 1 },
    { unique: true, partialFilterExpression: { active: true, beneficiaryProfileId: { $type: 'objectId' } }, name: 'verification_active_beneficiary_unique' },
  );
  return { modifiedCount: migration.modifiedCount, legacyIndexRemoved: Boolean(legacyUniqueIndex?.name) };
}

export function isMongoDuplicateKey(error: unknown): error is mongoose.mongo.MongoServerError {
  return error instanceof mongoose.mongo.MongoServerError && error.code === 11000;
}
