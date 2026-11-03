import assert from 'node:assert/strict';
import test from 'node:test';
import { VybeAccount } from './models/VybeAccount.js';
import { accountGreetingLabel, mapLegacyAccountGender, validateAccountProfilePreferences } from '@vybe/shared';

test('mulher pode escolher a saudação Bem-vinda', () => {
  assert.equal(accountGreetingLabel('FEMININE'), 'BEM-VINDA DE VOLTA');
});

test('homem pode escolher a saudação Bem-vindo', () => {
  assert.equal(accountGreetingLabel('MASCULINE'), 'BEM-VINDO DE VOLTA');
});

test('gênero não-binário não deduz saudação e a forma neutra é explícita', () => {
  assert.equal(accountGreetingLabel('NEUTRAL'), 'QUE BOM TER VOCÊ DE VOLTA');
});

test('gênero personalizado exige descrição e gênero padrão aceita descrição opcional', () => {
  assert.equal(validateAccountProfilePreferences('CUSTOM', '', 'NEUTRAL', '').customGenderValid, false);
  assert.equal(validateAccountProfilePreferences('CUSTOM', 'Agênero parcial', 'NEUTRAL', '').valid, true);
  assert.equal(validateAccountProfilePreferences('WOMAN', '', 'NEUTRAL', '').valid, true);
});

test('saudação personalizada exige texto e preserva o texto escolhido', () => {
  assert.equal(validateAccountProfilePreferences('NON_BINARY', '', 'CUSTOM', '').customGreetingValid, false);
  assert.equal(validateAccountProfilePreferences('NON_BINARY', '', 'CUSTOM', 'Bem-vinde de volta').valid, true);
  assert.equal(accountGreetingLabel('CUSTOM', '  Bem-vinde de volta  '), 'Bem-vinde de volta');
});

test('prefiro não informar é uma identidade persistível sem inferir saudação', () => {
  const preferences = validateAccountProfilePreferences('PREFER_NOT_TO_SAY', '', 'NEUTRAL', '');
  assert.equal(preferences.valid, true);
  assert.equal(accountGreetingLabel('NEUTRAL'), 'QUE BOM TER VOCÊ DE VOLTA');
});

test('mapeia campos antigos sem inferir preferência de saudação', () => {
  assert.deepEqual(mapLegacyAccountGender('female'), { gender: 'WOMAN' });
  assert.deepEqual(mapLegacyAccountGender('feminino'), { gender: 'WOMAN' });
  assert.deepEqual(mapLegacyAccountGender('masculino'), { gender: 'MAN' });
  assert.deepEqual(mapLegacyAccountGender('non-binary'), { gender: 'NON_BINARY' });
  assert.deepEqual(mapLegacyAccountGender('Two-Spirit'), { gender: 'TWO_SPIRIT' });
  assert.deepEqual(mapLegacyAccountGender('identidade anterior'), { gender: 'CUSTOM', customGender: 'identidade anterior' });
  assert.equal(accountGreetingLabel('NEUTRAL'), 'QUE BOM TER VOCÊ DE VOLTA');
});

test('perfil central serializa gênero, identidade personalizada e preferência separadamente', () => {
  const account = new VybeAccount({ email: 'pessoa@example.test', passwordHash: 'hash', displayName: 'Pessoa Exemplo', username: 'pessoa.exemplo', avatarUrl: '', status: 'active', gender: 'GENDER_FLUID', customGender: '', greetingPreference: 'CUSTOM', customGreeting: 'Bem-vinde de volta' });
  const stored = account.toObject();
  assert.equal(stored.gender, 'GENDER_FLUID');
  assert.equal(stored.greetingPreference, 'CUSTOM');
  assert.equal(stored.customGreeting, 'Bem-vinde de volta');
  assert.equal('tenantId' in stored, false);
});
