export type AcademicRoleName = 'STUDENT' | 'TEACHER' | 'DIRECTOR' | 'ACADEMIC_ADMIN';

export function mayAccessTeacherArea(roles: readonly AcademicRoleName[]) {
  return roles.includes('TEACHER') || roles.includes('DIRECTOR') || roles.includes('ACADEMIC_ADMIN');
}

export function mayManageAcademic(roles: readonly AcademicRoleName[]) {
  return roles.includes('ACADEMIC_ADMIN');
}

export function mayReadDiscipline(input: { academicAdmin: boolean; assignedTeacher: boolean; enrolledStudent: boolean }) {
  return input.academicAdmin || input.assignedTeacher || input.enrolledStudent;
}

export function maySubmitAssignment(input: { enrolled: boolean; isOpen: boolean; beforeDeadline: boolean; textAllowed: boolean; fileAllowed: boolean; hasText: boolean; hasFile: boolean }) {
  return input.enrolled && input.isOpen && input.beforeDeadline && ((input.textAllowed && input.hasText) || (input.fileAllowed && input.hasFile));
}
