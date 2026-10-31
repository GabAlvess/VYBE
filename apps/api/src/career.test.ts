import assert from 'node:assert/strict';
import test from 'node:test';
import { CareerApplication, CareerJob, CareerProfile, CareerGrant, MentorshipRequest } from './models/Career.js';

function hasUniqueIndex(model: typeof CareerProfile, keys: Record<string, 1>) {
  return model.schema.indexes().some(([index, options]) => options.unique === true && JSON.stringify(index) === JSON.stringify(keys));
}

test('professional profiles are unique per community identity', () => {
  assert.equal(hasUniqueIndex(CareerProfile, { tenantId: 1, characterId: 1 }), true);
});

test('applications prevent duplicate submissions for the same community, job, and member', () => {
  assert.equal(hasUniqueIndex(CareerApplication, { tenantId: 1, jobId: 1, characterId: 1 }), true);
  assert.deepEqual(CareerApplication.schema.path('status')?.options.enum, ['SUBMITTED', 'UNDER_REVIEW', 'INTERVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN']);
});

test('jobs expose the agreed category and publication status values', () => {
  assert.deepEqual(CareerJob.schema.path('type')?.options.enum, ['Estágio', 'Emprego', 'Residência', 'Pesquisa', 'Programa', 'Voluntariado', 'Freelance', 'Outro']);
  assert.deepEqual(CareerJob.schema.path('status')?.options.enum, ['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED']);
});

test('career roles and mentoring states stay explicit and community scoped', () => {
  assert.equal(hasUniqueIndex(CareerGrant, { tenantId: 1, characterId: 1 }), true);
  assert.deepEqual(MentorshipRequest.schema.path('status')?.options.enum, ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED']);
});
