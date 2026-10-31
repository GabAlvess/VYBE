import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeJoinUsername, normalizePhotoplayerName, validateJoinAge, validateJoinText, validateJoinUsername } from './routes/communityJoinPolicy.js';

test('username is normalized and constrained to community username rules', () => {
  assert.equal(normalizeJoinUsername('@MarianaCosta'), 'marianacosta');
  assert.equal(validateJoinUsername('@mariana.costa', 3, 24), true);
  assert.equal(validateJoinUsername('nome inválido', 3, 24), false);
  assert.equal(validateJoinUsername('', 3, 24), false);
});

test('photoplayer comparison ignores accents, case, and repeated spaces', () => {
  assert.equal(normalizePhotoplayerName('  MADÉLYN   Cline '), 'madelyn cline');
});

test('age and presentation meet minimum and length rules', () => {
  assert.equal(validateJoinAge(18, 18), true);
  assert.equal(validateJoinAge(17, 18), false);
  assert.equal(validateJoinAge(18.5, 18), false);
  assert.equal(validateJoinText('Uma descrição adequada.', 10, 1000), true);
  assert.equal(validateJoinText('curta', 10, 1000), false);
});
