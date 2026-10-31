import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { EventRSVP, Notification } from './models/Social.js';
import { tenantScope } from './middleware/tenant.js';
import { canJoinEvent, canReviewEvents, canSeeEvent, eventCreationDecision } from './routes/eventPolicy.js';

test('membro cria evento pendente; Owner e Admin publicam imediatamente', () => {
  assert.equal(eventCreationDecision('any_pending', false, false, false), 'pending_approval');
  assert.equal(eventCreationDecision('any_pending', true, false, false), 'approved');
  assert.equal(eventCreationDecision('any_pending', false, true, false), 'approved');
});

test('política de criação pode restringir membro e moderador', () => {
  assert.equal(eventCreationDecision('owner', false, false, false), 'denied');
  assert.equal(eventCreationDecision('admins', false, false, true), 'denied');
  assert.equal(eventCreationDecision('staff', false, false, true), 'pending_approval');
});

test('somente Owner/Admin revisa e eventos privados só aparecem para equipe ou criador', () => {
  assert.equal(canReviewEvents(false, false), false);
  assert.equal(canReviewEvents(false, true), true);
  assert.equal(canSeeEvent('pending_approval', false, false), false);
  assert.equal(canSeeEvent('pending_approval', false, true), true);
  assert.equal(canSeeEvent('pending_approval', true, false), true);
});

test('limite permite repetição idempotente e bloqueia novos participantes quando cheio', () => {
  assert.equal(canJoinEvent(1, 1, true), true);
  assert.equal(canJoinEvent(1, 1, false), false);
  assert.equal(canJoinEvent(0, null, false), true);
});

test('escopo impede que consulta de evento atravesse comunidades', () => {
  const tenantA = new mongoose.Types.ObjectId();
  const tenantB = new mongoose.Types.ObjectId();
  const query = tenantScope(tenantA, { tenantId: tenantB, status: 'approved' });
  assert.ok(query.tenantId.equals(tenantA));
  assert.equal(query.status, 'approved');
});

test('RSVP tem unicidade por comunidade, evento e personagem', () => {
  const unique = EventRSVP.schema.indexes().some(([fields, options]) =>
    Boolean(options?.unique) && Object.keys(fields).join(',') === 'tenantId,eventId,characterId');
  assert.equal(unique, true);
});

test('presença de evento aceita Vou, Em dúvida e Não vou', () => {
  const base = { tenantId: new mongoose.Types.ObjectId(), eventId: new mongoose.Types.ObjectId(), characterId: new mongoose.Types.ObjectId() };
  for (const status of ['going', 'maybe', 'not_going'] as const) {
    assert.equal(new EventRSVP({ ...base, status }).validateSync(), undefined);
  }
  assert.equal(new EventRSVP({ ...base, status: 'invalid' }).validateSync()?.errors.status?.kind, 'enum');
});

test('notificação aceita os tipos de evento e inclui tenant/evento', () => {
  const notification = new Notification({
    tenantId: new mongoose.Types.ObjectId(), characterId: new mongoose.Types.ObjectId(),
    actorId: new mongoose.Types.ObjectId(), targetId: new mongoose.Types.ObjectId(), type: 'event_created',
  });
  assert.equal(notification.validateSync(), undefined);
  notification.type = 'event_pending';
  assert.equal(notification.validateSync(), undefined);
});
