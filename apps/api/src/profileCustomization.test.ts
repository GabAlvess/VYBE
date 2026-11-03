import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProfileNameColor, resolveProfileCustomization, updateProfileCustomization } from './services/profileCustomization.js';
import { getVybeFont, isAllowedVybeFont, normalizeVybeFontId, VYBE_FONTS } from '@vybe/shared';

test('catálogo VYBE contém famílias únicas categorizadas e valida somente fontes aprovadas', () => {
  const ids = VYBE_FONTS.map((font) => font.id);
  assert.ok(VYBE_FONTS.length >= 180 && VYBE_FONTS.length <= 200, `Esperadas cerca de 190 famílias, encontradas ${VYBE_FONTS.length}`);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(VYBE_FONTS.every((font) => font.categories.length > 0 && font.weights.includes(400)));
  assert.equal(normalizeVybeFontId('poppins'), 'poppins');
  assert.equal(normalizeVybeFontId('ELEGANT'), 'playfair-display');
  assert.equal(getVybeFont('great-vibes')?.family, 'Great Vibes');
  assert.equal(isAllowedVybeFont('ComicSansFake'), false);
  assert.equal(isAllowedVybeFont('https://example.com/font.css'), false);
});

test('personalização é independente por aplicativo e o legado fica restrito ao Social', () => {
  const legacy = { nameColor: 'GOLD', nameFont: 'ELEGANT', avatarFrame: 'GOLD', profileTheme: 'GOLD' };
  const afterSocial = updateProfileCustomization(undefined, legacy, 'SOCIAL', { nameColor: 'LILAC' });
  const afterEcho = updateProfileCustomization(afterSocial, legacy, 'ECHO', { nameColor: 'TEAL' });
  const afterMatch = updateProfileCustomization(afterEcho, legacy, 'MATCH', { nameColor: 'CORAL' });

  assert.equal(resolveProfileCustomization(afterMatch, legacy, 'SOCIAL').nameColor, 'LILAC');
  assert.equal(resolveProfileCustomization(afterMatch, legacy, 'ECHO').nameColor, 'TEAL');
  assert.equal(resolveProfileCustomization(afterMatch, legacy, 'MATCH').nameColor, 'CORAL');
  assert.equal(resolveProfileCustomization(afterSocial, legacy, 'ECHO').nameColor, 'DEFAULT');
  assert.equal(resolveProfileCustomization(afterSocial, legacy, 'MATCH').nameColor, 'DEFAULT');
  assert.equal(resolveProfileCustomization(undefined, legacy, 'SOCIAL').nameColor, 'GOLD');
});

test('cores HEX personalizadas permanecem independentes por app após atualizar a configuração', () => {
  const social = updateProfileCustomization(undefined, undefined, 'SOCIAL', { nameColor: '#FF4FA3' });
  const echo = updateProfileCustomization(social, undefined, 'ECHO', { nameColor: '#246B6E' });
  const match = updateProfileCustomization(echo, undefined, 'MATCH', { nameColor: '#A56DE2' });

  assert.equal(resolveProfileCustomization(match, undefined, 'SOCIAL').nameColor, '#FF4FA3');
  assert.equal(resolveProfileCustomization(match, undefined, 'ECHO').nameColor, '#246B6E');
  assert.equal(resolveProfileCustomization(match, undefined, 'MATCH').nameColor, '#A56DE2');
});

test('validador normaliza HEX e rejeita valores que não são cores sólidas', () => {
  assert.equal(normalizeProfileNameColor('#8d86c9'), '#8D86C9');
  assert.equal(normalizeProfileNameColor('ff4fa3'), '#FF4FA3');
  assert.equal(normalizeProfileNameColor('TEAL'), 'TEAL');
  for (const value of ['red', 'var(--text)', 'url(x)', 'linear-gradient(red, blue)', '#123', '#AABBCC80', '<script>']) {
    assert.equal(normalizeProfileNameColor(value), null, `${value} deve ser rejeitado`);
  }
});

test('duas fontes são persistidas por app e fontes antigas migram para a principal', () => {
  const oldSocial = { nameFont: 'great-vibes' };
  const migratedSocial = resolveProfileCustomization(undefined, oldSocial, 'SOCIAL');
  assert.equal(migratedSocial.primaryFontId, 'great-vibes');
  assert.equal(migratedSocial.secondaryFontId, 'DEFAULT');
  assert.equal(resolveProfileCustomization(undefined, { fontId: 'poppins' }, 'SOCIAL').primaryFontId, 'poppins');

  const social = updateProfileCustomization(undefined, oldSocial, 'SOCIAL', { primaryFontId: 'great-vibes', secondaryFontId: 'poppins' });
  assert.equal(Object.hasOwn(social.SOCIAL ?? {}, 'nameFont'), false);
  const echo = updateProfileCustomization(social, oldSocial, 'ECHO', { primaryFontId: 'montserrat', secondaryFontId: 'lora' });
  const match = updateProfileCustomization(echo, oldSocial, 'MATCH', { primaryFontId: 'playfair-display', secondaryFontId: 'dm-sans' });

  assert.deepEqual([resolveProfileCustomization(match, oldSocial, 'SOCIAL').primaryFontId, resolveProfileCustomization(match, oldSocial, 'SOCIAL').secondaryFontId], ['great-vibes', 'poppins']);
  assert.deepEqual([resolveProfileCustomization(match, oldSocial, 'ECHO').primaryFontId, resolveProfileCustomization(match, oldSocial, 'ECHO').secondaryFontId], ['montserrat', 'lora']);
  assert.deepEqual([resolveProfileCustomization(match, oldSocial, 'MATCH').primaryFontId, resolveProfileCustomization(match, oldSocial, 'MATCH').secondaryFontId], ['playfair-display', 'dm-sans']);
  assert.deepEqual([resolveProfileCustomization(undefined, oldSocial, 'MATCH').primaryFontId, resolveProfileCustomization(undefined, oldSocial, 'MATCH').secondaryFontId], ['DEFAULT', 'DEFAULT']);
});
