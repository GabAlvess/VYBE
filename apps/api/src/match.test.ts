import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { Match, MatchBlock, MatchMessage, MatchProfile, MatchReaction } from './models/Match.js';
import { canAccessMatch, canonicalProfilePair, createsMutualMatch, isPositiveMatchReaction, matchDiscoveryFilter, matchFeatureIsEnabled, validMatchAge } from './routes/matchPolicy.js';

const id = () => new mongoose.Types.ObjectId();

test('descoberta sempre limita a comunidade e exclui o próprio perfil', () => {
  const tenant = id();
  const own = id();
  const excluded = id();
  const filter = matchDiscoveryFilter(tenant, own, [excluded]);
  assert.ok(filter.tenantId.equals(tenant));
  assert.equal(filter.enabled, true);
  assert.deepEqual(filter.characterId.$nin.map(String), [String(own), String(excluded)]);
});

test('perfis desativados e menores de 18 não entram na descoberta', () => {
  const tenant = id();
  const own = id();
  const filter = matchDiscoveryFilter(tenant, own, []);
  assert.equal(filter.enabled, true);
  assert.deepEqual(filter.age, { $gte: 18, $lte: 120 });
  assert.equal(validMatchAge(17), false);
  assert.equal(validMatchAge(18), true);
});

test('like ou estrela só geram match com interesse positivo recíproco', () => {
  assert.equal(createsMutualMatch('like', 'like'), true);
  assert.equal(createsMutualMatch('like', 'star'), true);
  assert.equal(createsMutualMatch('star', 'like'), true);
  assert.equal(createsMutualMatch('star', 'star'), true);
  assert.equal(createsMutualMatch('like', 'pass'), false);
  assert.equal(createsMutualMatch('pass', 'like'), false);
  assert.equal(createsMutualMatch('star', undefined), false);
});

test('like, estrela e passar são tipos persistíveis distintos', () => {
  for (const type of ['like', 'star', 'pass'] as const) {
    const reaction = new MatchReaction({ tenantId: id(), fromProfileId: id(), toProfileId: id(), type });
    assert.equal(reaction.validateSync(), undefined);
  }
  assert.equal(isPositiveMatchReaction('like'), true);
  assert.equal(isPositiveMatchReaction('star'), true);
  assert.equal(isPositiveMatchReaction('pass'), false);
});

test('match é uma única relação ordenada para o mesmo par', () => {
  const a = id();
  const b = id();
  const forward = canonicalProfilePair(a, b);
  const reverse = canonicalProfilePair(b, a);
  assert.equal(String(forward.profileAId), String(reverse.profileAId));
  assert.equal(String(forward.profileBId), String(reverse.profileBId));
  const unique = Match.schema.indexes().some(([fields, options]) => Boolean(options?.unique) && Object.keys(fields).join(',') === 'tenantId,profileAId,profileBId');
  assert.equal(unique, true);
});

test('reação tem unicidade por comunidade, origem e destino', () => {
  const unique = MatchReaction.schema.indexes().some(([fields, options]) => Boolean(options?.unique) && Object.keys(fields).join(',') === 'tenantId,fromProfileId,toProfileId');
  assert.equal(unique, true);
});

test('perfil do Match tem unicidade por comunidade e identidade', () => {
  const unique = MatchProfile.schema.indexes().some(([fields, options]) => Boolean(options?.unique) && Object.keys(fields).join(',') === 'tenantId,characterId');
  assert.equal(unique, true);
});

test('mensagens exigem match ativo, participação e ausência de bloqueio', () => {
  const me = id();
  const other = id();
  const active = { status: 'active', profileAId: me, profileBId: other };
  assert.equal(canAccessMatch(active, me, false), true);
  assert.equal(canAccessMatch(active, other, false), true);
  assert.equal(canAccessMatch(active, id(), false), false);
  assert.equal(canAccessMatch(active, me, true), false);
  assert.equal(canAccessMatch({ ...active, status: 'blocked' }, me, false), false);
  assert.equal(canAccessMatch({ ...active, status: 'unmatched' }, me, false), false);
});

test('bloqueios são persistidos e únicos por direção dentro da comunidade', () => {
  const tenantId = id();
  const blockerId = id();
  const blockedId = id();
  const block = new MatchBlock({ tenantId, blockerId, blockedId });
  assert.equal(block.validateSync(), undefined);
  const unique = MatchBlock.schema.indexes().some(([fields, options]) => Boolean(options?.unique) && Object.keys(fields).join(',') === 'tenantId,blockerId,blockedId');
  assert.equal(unique, true);
});

test('mensagem mantém comunidade, match, emissor e destinatário', () => {
  const message = new MatchMessage({ tenantId: id(), matchId: id(), senderProfileId: id(), recipientProfileId: id(), content: 'Olá!' });
  assert.equal(message.validateSync(), undefined);
  const index = MatchMessage.schema.indexes().some(([fields]) => Object.keys(fields).join(',') === 'tenantId,matchId,createdAt');
  assert.equal(index, true);
});

test('app Match respeita o recurso da comunidade', () => {
  assert.equal(matchFeatureIsEnabled({ settings: { features: { match: true } } }), true);
  assert.equal(matchFeatureIsEnabled({ settings: { features: { match: false } } }), false);
  assert.equal(matchFeatureIsEnabled({}), true);
});

test('age aceita somente valores inteiros adultos válidos', () => {
  assert.equal(validMatchAge(null), false);
  assert.equal(validMatchAge('26'), false);
  assert.equal(validMatchAge(18), true);
  assert.equal(validMatchAge(120), true);
  assert.equal(validMatchAge(121), false);
});
