import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { isCommunityOwner, sanctionEndDate } from './routes/communityAdminPolicy.js';

test('somente o owner da comunidade atual recebe acesso administrativo total', () => {
  const owner = new mongoose.Types.ObjectId();
  const admin = new mongoose.Types.ObjectId();
  const account = (id: mongoose.Types.ObjectId) => ({ _id: id, email: `${id.toString()}@example.test` });
  const community = { ownerAccountId: owner, ownerEmail: 'owner@example.test', admins: [owner, admin] };
  assert.equal(isCommunityOwner(community, account(owner)), true);
  assert.equal(isCommunityOwner(community, account(admin)), false);
  assert.equal(isCommunityOwner({ ...community, ownerAccountId: new mongoose.Types.ObjectId(), ownerEmail: 'other@example.test' }, account(owner)), false);
});

test('fallback de comunidades antigas mantém o primeiro admin como owner, nunca os demais', () => {
  const owner = new mongoose.Types.ObjectId();
  const admin = new mongoose.Types.ObjectId();
  const community = { admins: [owner, admin], ownerEmail: '' };
  assert.equal(isCommunityOwner(community, { _id: owner, email: 'owner@example.test' }), true);
  assert.equal(isCommunityOwner(community, { _id: admin, email: 'admin@example.test' }), false);
});

test('sanção permanente não recebe fim e sanção temporária termina no prazo definido', () => {
  const now = new Date('2026-10-31T12:00:00.000Z');
  assert.equal(sanctionEndDate(null, now), undefined);
  assert.equal(sanctionEndDate(7, now)?.toISOString(), '2026-11-07T12:00:00.000Z');
  assert.throws(() => sanctionEndDate(0, now), /Duração inválida/);
});
