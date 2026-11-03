import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { insertUnicodeText, VERIFICATION_PRICE_BRL } from '@vybe/shared';
import { canTransitionVerification, VerificationRequest } from './models/VerificationRequest.js';
import { tenantScope } from './middleware/tenant.js';
import { isVerificationActive, socialDistributionScore, VERIFIED_TREND_BOOST } from './services/verifiedSocialBenefits.js';
import { parsePaymentProof } from './services/privatePaymentProofs.js';

test('emoji/text insertion preserves surrounding Unicode and places the cursor after insertion', () => {
  const result = insertUnicodeText('Olá mundo', ' 💚', 4, 4);
  assert.deepEqual(result, { value: 'Olá  💚mundo', cursor: 7 });
  assert.equal(insertUnicodeText('A👩‍👩‍👧‍👦B', '✨', 1, 1).value, 'A✨👩‍👩‍👧‍👦B');
});

test('emoji insertion replaces only the selected range and clamps invalid cursor positions', () => {
  assert.deepEqual(insertUnicodeText('Bom dia!', '✨', 4, 7), { value: 'Bom ✨!', cursor: 5 });
  assert.deepEqual(insertUnicodeText('abc', '😂', 40, 40), { value: 'abc😂', cursor: 5 });
});

test('verification request keeps a single configured one-time BRL price', () => {
  assert.equal(VERIFICATION_PRICE_BRL, 29.9);
  const request = new VerificationRequest({ tenantId: new mongoose.Types.ObjectId(), characterId: new mongoose.Types.ObjectId(), accountId: new mongoose.Types.ObjectId(), adminCharacterId: new mongoose.Types.ObjectId() });
  assert.equal(request.amount, 29.9);
  assert.equal(request.currency, 'BRL');
  assert.equal(request.status, 'PENDING');
});

test('verification requests accept self and gift payloads with supported source and initial status', () => {
  const tenantId = new mongoose.Types.ObjectId();
  const requesterId = new mongoose.Types.ObjectId();
  const beneficiaryId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();
  const selfRequest = new VerificationRequest({ tenantId, requestedByUserId: requesterId, beneficiaryProfileId: requesterId, isGift: false, source: 'SELF_PURCHASE', characterId: requesterId, accountId: requesterId, adminCharacterId: adminId, status: 'AWAITING_PAYMENT', active: true });
  const giftRequest = new VerificationRequest({ tenantId, requestedByUserId: requesterId, beneficiaryProfileId: beneficiaryId, isGift: true, source: 'GIFT', characterId: requesterId, accountId: requesterId, adminCharacterId: adminId, status: 'AWAITING_PAYMENT', active: true });
  assert.equal(selfRequest.validateSync(), undefined);
  assert.equal(giftRequest.validateSync(), undefined);
  assert.equal(giftRequest.beneficiaryProfileId?.toString(), beneficiaryId.toString());
  giftRequest.source = 'INVALID' as never;
  assert.equal(giftRequest.validateSync()?.errors.source?.kind, 'enum');
});

test('active verification requests are unique by beneficiary profile and community', () => {
  const index = VerificationRequest.schema.indexes().find(([keys]) => keys.tenantId === 1 && keys.beneficiaryProfileId === 1 && keys.active === 1);
  assert.ok(index);
  assert.equal(index[1].unique, true);
  assert.deepEqual(index[1].partialFilterExpression, { active: true, beneficiaryProfileId: { $type: 'objectId' } });
});

test('verification approval requires payment confirmation and only follows allowed states', () => {
  assert.equal(canTransitionVerification('PENDING', 'CONTACTED'), true);
  assert.equal(canTransitionVerification('CONTACTED', 'AWAITING_PAYMENT'), true);
  assert.equal(canTransitionVerification('AWAITING_PAYMENT', 'PAID'), true);
  assert.equal(canTransitionVerification('PAID', 'APPROVED'), true);
  assert.equal(canTransitionVerification('AWAITING_PAYMENT', 'PAYMENT_PROOF_SENT'), true);
  assert.equal(canTransitionVerification('PAYMENT_PROOF_SENT', 'PAYMENT_ISSUE'), true);
  assert.equal(canTransitionVerification('PAYMENT_ISSUE', 'PAYMENT_PROOF_SENT'), true);
  assert.equal(canTransitionVerification('PAYMENT_PROOF_SENT', 'APPROVED'), false);
  assert.equal(canTransitionVerification('PENDING', 'APPROVED'), false);
  assert.equal(canTransitionVerification('APPROVED', 'PENDING'), false);
});

test('verification request keeps buyer, beneficiary, community and gift source separate', () => {
  const buyer = new mongoose.Types.ObjectId();
  const beneficiary = new mongoose.Types.ObjectId();
  const community = new mongoose.Types.ObjectId();
  const request = new VerificationRequest({ tenantId: community, characterId: buyer, accountId: new mongoose.Types.ObjectId(), requestedByUserId: new mongoose.Types.ObjectId(), beneficiaryProfileId: beneficiary, isGift: true, source: 'GIFT', adminCharacterId: new mongoose.Types.ObjectId(), status: 'AWAITING_PAYMENT', active: true, amount: 29.9, currency: 'BRL', paymentStatus: 'unpaid' });
  assert.equal(request.validateSync(), undefined);
  assert.equal(request.characterId.toString(), buyer.toString());
  assert.equal(request.beneficiaryProfileId?.toString(), beneficiary.toString());
  assert.equal(request.tenantId.toString(), community.toString());
  assert.equal(request.isGift, true);
  assert.equal(request.source, 'GIFT');
});

test('payment proof validation checks actual file signature and accepted formats', () => {
  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const pdfHeader = Buffer.from('%PDF-1.7');
  assert.equal(parsePaymentProof(`data:image/png;base64,${pngHeader.toString('base64')}`).mimeType, 'image/png');
  assert.equal(parsePaymentProof(`data:image/jpeg;base64,${jpegHeader.toString('base64')}`).extension, 'jpg');
  assert.equal(parsePaymentProof(`data:application/pdf;base64,${pdfHeader.toString('base64')}`).mimeType, 'application/pdf');
  assert.throws(() => parsePaymentProof(`data:image/png;base64,${pdfHeader.toString('base64')}`), /não corresponde/);
  assert.throws(() => parsePaymentProof('data:image/svg+xml;base64,PHN2Zz4='), /PNG, JPG ou PDF/);
});

test('verification requests preserve assignment, internal notes, and platform audit metadata', () => {
  const request = new VerificationRequest({
    tenantId: new mongoose.Types.ObjectId(), characterId: new mongoose.Types.ObjectId(), accountId: new mongoose.Types.ObjectId(), adminCharacterId: new mongoose.Types.ObjectId(), status: 'PENDING', active: true,
    handledBy: new mongoose.Types.ObjectId(), handledAt: new Date('2026-11-02T12:00:00.000Z'),
    history: [{ action: 'request_created', createdAt: new Date('2026-11-02T11:00:00.000Z') }, { action: 'status_paid', actorPlatformAccountId: new mongoose.Types.ObjectId(), createdAt: new Date('2026-11-02T12:00:00.000Z') }],
    internalNotes: [{ authorPlatformAccountId: new mongoose.Types.ObjectId(), content: 'Pagamento conferido manualmente.', createdAt: new Date('2026-11-02T12:00:00.000Z') }],
  });
  const validation = request.validateSync();
  assert.equal(validation, undefined);
  assert.equal(request.history?.length, 2);
  assert.equal(request.internalNotes?.[0]?.content, 'Pagamento conferido manualmente.');
  assert.ok(request.handledBy);
});

test('verification tenant scope always binds lookup to one community', () => {
  const tenant = new mongoose.Types.ObjectId();
  const query = tenantScope(tenant, { characterId: new mongoose.Types.ObjectId(), active: true });
  assert.equal(query.tenantId, tenant);
  assert.equal(query.active, true);
});

test('verification benefits require an active status and stop on expiration or revocation', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(isVerificationActive({ status: 'PENDING', verifiedAt: now }, now), false);
  assert.equal(isVerificationActive({ status: 'ACTIVE', expiresAt: new Date(now.getTime() + 1000) }, now), true);
  assert.equal(isVerificationActive({ status: 'ACTIVE', expiresAt: now }, now), false);
  assert.equal(isVerificationActive({ status: 'REVOKED', verifiedAt: now }, now), false);
  assert.equal(isVerificationActive({ verifiedAt: now }, now), true);
});

test('verified trend boost stays small and cannot replace content relevance', () => {
  const post = { likesCount: 0, commentsCount: 0, createdAt: new Date() };
  const regularScore = socialDistributionScore(post, false, 'trend');
  const verifiedScore = socialDistributionScore(post, true, 'trend');
  assert.ok(verifiedScore > regularScore);
  assert.ok(verifiedScore <= regularScore * (1 + VERIFIED_TREND_BOOST));
  const popularPost = { likesCount: 100, commentsCount: 25, createdAt: new Date() };
  assert.ok(socialDistributionScore(popularPost, false, 'trend') > verifiedScore);
});
