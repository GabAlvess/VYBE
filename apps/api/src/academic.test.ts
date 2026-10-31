import test from 'node:test';
import assert from 'node:assert/strict';
import { mayAccessTeacherArea, mayManageAcademic, mayReadDiscipline, maySubmitAssignment } from './routes/academicPolicy.js';

test('student does not gain teacher-area or academic-admin permissions', () => {
  assert.equal(mayAccessTeacherArea(['STUDENT']), false);
  assert.equal(mayManageAcademic(['STUDENT']), false);
});

test('teacher and academic admin access teacher area while only academic admin manages structure', () => {
  assert.equal(mayAccessTeacherArea(['TEACHER']), true);
  assert.equal(mayAccessTeacherArea(['ACADEMIC_ADMIN']), true);
  assert.equal(mayManageAcademic(['TEACHER']), false);
  assert.equal(mayManageAcademic(['ACADEMIC_ADMIN']), true);
});

test('discipline access requires admin, assigned teacher, or active enrollment', () => {
  assert.equal(mayReadDiscipline({ academicAdmin: false, assignedTeacher: false, enrolledStudent: false }), false);
  assert.equal(mayReadDiscipline({ academicAdmin: false, assignedTeacher: true, enrolledStudent: false }), true);
  assert.equal(mayReadDiscipline({ academicAdmin: false, assignedTeacher: false, enrolledStudent: true }), true);
});

test('submission policy requires active enrollment, open dates, deadline, and permitted content', () => {
  const base = { enrolled: true, isOpen: true, beforeDeadline: true, textAllowed: true, fileAllowed: false, hasText: true, hasFile: false };
  assert.equal(maySubmitAssignment(base), true);
  assert.equal(maySubmitAssignment({ ...base, enrolled: false }), false);
  assert.equal(maySubmitAssignment({ ...base, beforeDeadline: false }), false);
  assert.equal(maySubmitAssignment({ ...base, hasText: false }), false);
});
