import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { VybeAccount } from './models/VybeAccount.js';
import { Notification } from './models/Social.js';

test('preferências de som começam com volume moderado e categorias disponíveis', () => {
  const account = new VybeAccount({ email: 'sounds@example.test', passwordHash: 'hash', displayName: 'Sounds User', username: 'sounds.user', status: 'active' });
  assert.equal(account.audioPreferences?.enabled, true);
  assert.equal(account.audioPreferences?.messageSoundEnabled, true);
  assert.equal(account.audioPreferences?.notificationSoundEnabled, true);
  assert.equal(account.audioPreferences?.matchSoundEnabled, true);
  assert.equal(account.audioPreferences?.actionSoundEnabled, true);
  assert.equal(account.audioPreferences?.vybePlusSoundEnabled, true);
  assert.equal(account.audioPreferences?.volume, 0.5);
  assert.equal(account.validateSync(), undefined);
});

test('volume de som rejeita valores fora da faixa de zero a um', () => {
  const account = new VybeAccount({ email: 'volume@example.test', passwordHash: 'hash', displayName: 'Volume User', username: 'volume.user', audioPreferences: { enabled: true, messageSoundEnabled: true, notificationSoundEnabled: true, matchSoundEnabled: true, actionSoundEnabled: true, vybePlusSoundEnabled: true, volume: 1.5 } });
  assert.ok(account.validateSync()?.errors['audioPreferences.volume']);
});

test('notificação de Match confirmado pode ser persistida para os dois perfis', () => {
  const notification = new Notification({ tenantId: new mongoose.Types.ObjectId('000000000000000000000001'), characterId: new mongoose.Types.ObjectId('000000000000000000000002'), actorId: new mongoose.Types.ObjectId('000000000000000000000003'), type: 'match_created', targetId: new mongoose.Types.ObjectId('000000000000000000000004') });
  assert.equal(notification.validateSync(), undefined);
});
