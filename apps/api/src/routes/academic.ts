import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { Account, Character, Notification } from '../models/Social.js';
import { Community } from '../models/Community.js';
import { requireSession } from '../middleware/tenant.js';
import { AcademicAssignment, AcademicContent, AcademicDiscipline, AcademicDisciplineTeacher, AcademicEnrollment, AcademicExam, AcademicExamSubmission, AcademicGrade, AcademicInvite, AcademicLesson, AcademicProfile, AcademicRole, AcademicSubmission } from '../models/Academic.js';
import { mayAccessTeacherArea, mayManageAcademic, mayReadDiscipline, maySubmitAssignment, type AcademicRoleName } from './academicPolicy.js';

export const academicRouter = Router();
academicRouter.use(requireSession);
const oid = (value: unknown): value is string => typeof value === 'string' && mongoose.isValidObjectId(value);
const fail = (res: Response, status: number, error: string) => res.status(status).json({ error });
const tenantOf = (req: Request) => req.vybeTenant!;
const profileOf = (req: Request) => req.vybeCharacter!;
const accountOf = (req: Request) => req.vybeAccount!;
const active = { status: 'active' };
const uploadRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads');

academicRouter.use(async (req, res, next) => {
  if (tenantOf(req).settings?.features?.academic === false) return fail(res, 403, 'O Acadêmico não está disponível nesta comunidade.');
  next();
});

async function rolesFor(tenantId: mongoose.Types.ObjectId, profileId: mongoose.Types.ObjectId) {
  const records = await AcademicRole.find({ tenantId, profileId, status: 'active' }).select('role').lean();
  return records.map((record) => record.role as AcademicRoleName);
}
async function hasRole(req: Request, role: AcademicRoleName) {
  return Boolean(await AcademicRole.exists({ tenantId: tenantOf(req)._id, profileId: profileOf(req)._id, role, status: 'active' }));
}
async function isAdmin(req: Request) { return hasRole(req, 'ACADEMIC_ADMIN'); }
async function isAssignedTeacher(req: Request, disciplineId: mongoose.Types.ObjectId) {
  const roles = await rolesFor(tenantOf(req)._id, profileOf(req)._id);
  return (roles.includes('TEACHER') || roles.includes('DIRECTOR')) && Boolean(await AcademicDisciplineTeacher.exists({ tenantId: tenantOf(req)._id, disciplineId, teacherProfileId: profileOf(req)._id, active: true }));
}
async function isEnrolled(req: Request, disciplineId: mongoose.Types.ObjectId) {
  return Boolean(await AcademicEnrollment.exists({ tenantId: tenantOf(req)._id, disciplineId, studentProfileId: profileOf(req)._id, status: 'active' }));
}
async function disciplinePermission(req: Request, res: Response, disciplineId: mongoose.Types.ObjectId) {
  const [academicAdmin, assignedTeacher, enrolledStudent] = await Promise.all([isAdmin(req), isAssignedTeacher(req, disciplineId), isEnrolled(req, disciplineId)]);
  if (!mayReadDiscipline({ academicAdmin, assignedTeacher, enrolledStudent })) { fail(res, 403, 'Você não tem acesso a esta disciplina.'); return null; }
  return { academicAdmin, assignedTeacher, enrolledStudent };
}
async function teacherPermission(req: Request, res: Response, disciplineId: mongoose.Types.ObjectId) {
  const permission = await disciplinePermission(req, res, disciplineId);
  if (!permission || (!permission.academicAdmin && !permission.assignedTeacher)) {
    if (permission) fail(res, 403, 'Apenas professores vinculados podem alterar esta disciplina.');
    return false;
  }
  return true;
}
async function communityCharacter(tenantId: mongoose.Types.ObjectId, profileId: unknown) {
  if (!oid(profileId)) return null;
  const character = await Character.findOne({ _id: profileId, tenantId }).select('displayName username avatarUrl bio communityFunction accountId').lean();
  if (!character || !await Account.exists({ _id: character.accountId, tenantId, status: 'active' })) return null;
  return character;
}
async function profilesFor(ids: mongoose.Types.ObjectId[], tenantId: mongoose.Types.ObjectId) {
  if (!ids.length) return [];
  return Character.find({ _id: { $in: ids }, tenantId }).select('displayName username avatarUrl bio communityFunction').lean();
}
async function notifyStudents(tenantId: mongoose.Types.ObjectId, disciplineId: mongoose.Types.ObjectId, actorId: mongoose.Types.ObjectId, targetId: mongoose.Types.ObjectId, type: 'academic_update' | 'academic_grade' | 'academic_submission') {
  const enrollments = await AcademicEnrollment.find({ tenantId, disciplineId, status: 'active' }).select('studentProfileId').lean();
  if (enrollments.length) await Notification.insertMany(enrollments.map(({ studentProfileId }) => ({ tenantId, characterId: studentProfileId, actorId, targetId, type })), { ordered: false }).catch(() => undefined);
}
async function notifyCommunityStudents(tenantId: mongoose.Types.ObjectId, actorId: mongoose.Types.ObjectId, targetId: mongoose.Types.ObjectId, type: 'academic_update' | 'academic_grade' | 'academic_submission') {
  const [teachers, characters] = await Promise.all([
    AcademicRole.find({ tenantId, role: 'TEACHER', status: 'active' }).distinct('profileId'),
    Character.find({ tenantId }).select('_id accountId').lean(),
  ]);
  const students = characters.filter((character) => !teachers.some((teacherId) => teacherId.equals(character._id)));
  if (!students.length) return;
  const accounts = await Account.find({ tenantId, status: 'active', _id: { $in: students.map((student) => student.accountId) } }).select('_id').lean();
  const activeAccountIds = new Set(accounts.map((account) => account._id.toString()));
  const recipients = students.filter((student) => activeAccountIds.has(student.accountId.toString()));
  if (recipients.length) await Notification.insertMany(recipients.map(({ _id }) => ({ tenantId, characterId: _id, actorId, targetId, type })), { ordered: false }).catch(() => undefined);
}
async function generalAdminCanBootstrap(req: Request) {
  const tenant = tenantOf(req);
  return Boolean(tenant.ownerAccountId?.equals(accountOf(req)._id) || tenant.admins.some((id) => id.equals(accountOf(req)._id)));
}
function checkedAcademicAttachment(input: unknown) {
  if (!input || typeof input !== 'object') return undefined;
  const file = input as Record<string, unknown>;
  const name = typeof file.name === 'string' ? file.name.slice(0, 180) : '';
  const url = typeof file.url === 'string' ? file.url : '';
  const mimeType = typeof file.mimeType === 'string' ? file.mimeType : '';
  const size = Number(file.size);
  if (!name || !/^\/api\/academic\/files\/academic_[a-f0-9]{32}\.(pdf|png|jpg|webp|docx|pptx|xlsx|xls)$/.test(url) || !Number.isFinite(size) || size < 1 || size > 10 * 1024 * 1024 || !mimeType) return undefined;
  return { url, name, mimeType: mimeType.slice(0, 100), size };
}
async function requireAcademicAdmin(req: Request, res: Response) {
  if (await isAdmin(req)) return true;
  if (await generalAdminCanBootstrap(req)) { fail(res, 403, 'Conceda a permissão de administrador acadêmico para este perfil primeiro.'); return false; }
  fail(res, 403, 'Apenas um administrador acadêmico pode fazer isso.'); return false;
}
function parseDate(value: unknown) { const date = typeof value === 'string' || value instanceof Date ? new Date(value) : new Date(Number.NaN); return Number.isNaN(date.getTime()) ? null : date; }

academicRouter.get('/me', async (req, res) => {
  const character = profileOf(req);
  let roles = await rolesFor(tenantOf(req)._id, character._id);
  if (!roles.includes('TEACHER') && !roles.includes('DIRECTOR') && !roles.includes('ACADEMIC_ADMIN') && !roles.includes('STUDENT')) {
    await AcademicRole.updateOne({ tenantId: tenantOf(req)._id, profileId: character._id, role: 'STUDENT' }, { $set: { status: 'active', grantedBy: character._id, grantedAt: new Date(), revokedAt: undefined } }, { upsert: true, runValidators: true });
    roles = [...roles, 'STUDENT'];
  } else if (roles.includes('TEACHER') && roles.includes('STUDENT')) {
    await AcademicRole.updateOne({ tenantId: tenantOf(req)._id, profileId: character._id, role: 'STUDENT' }, { $set: { status: 'inactive', revokedAt: new Date() } });
    roles = roles.filter((role) => role !== 'STUDENT');
  }
  const [academicProfile, invite] = await Promise.all([AcademicProfile.findOne({ tenantId: tenantOf(req)._id, profileId: character._id }).lean(), AcademicInvite.findOne({ tenantId: tenantOf(req)._id, email: accountOf(req).email.toLowerCase(), status: 'pending' }).lean()]);
  res.json({ profile: { id: character._id.toString(), displayName: character.displayName, username: character.username, avatarUrl: academicProfile?.avatarUrl || character.avatarUrl, bio: character.bio, courseOfStudy: academicProfile?.courseOfStudy ?? '' }, roles, canAccessTeacherArea: mayAccessTeacherArea(roles), canManageAcademic: mayManageAcademic(roles), canBootstrapAcademicAdmin: Boolean(await generalAdminCanBootstrap(req) && !roles.includes('ACADEMIC_ADMIN')), academicEnabled: tenantOf(req).settings?.features?.academic !== false, pendingInvite: invite ? { id: invite._id.toString(), name: invite.name, message: invite.message } : null });
});

academicRouter.patch('/profile', async (req, res) => {
  const courseOfStudy = typeof req.body?.courseOfStudy === 'string' ? req.body.courseOfStudy.trim() : '';
  if (courseOfStudy.length > 120) return fail(res, 400, 'O curso ou matéria deve ter até 120 caracteres.');
  let avatarUrl = (await AcademicProfile.findOne({ tenantId: tenantOf(req)._id, profileId: profileOf(req)._id }).select('avatarUrl').lean())?.avatarUrl ?? '';
  if (Object.hasOwn(req.body ?? {}, 'photo')) {
    const photo = req.body.photo;
    if (photo === null || photo === '') avatarUrl = '';
    else {
      if (typeof photo !== 'string' || photo.length > 2_900_000) return fail(res, 400, 'A foto deve ter no máximo 2 MB.');
      const match = photo.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return fail(res, 400, 'Envie uma foto PNG, JPG ou WebP válida.');
      const bytes = Buffer.from(match[2], 'base64');
      const valid = bytes.length > 0 && bytes.length <= 2 * 1024 * 1024 && (match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : match[1] === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP');
      if (!valid) return fail(res, 400, 'O arquivo escolhido não corresponde a uma imagem válida.');
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1]; const filename = `academic_${randomBytes(16).toString('hex')}.${ext}`; const directory = resolve(uploadRoot, tenantOf(req).slug);
      await mkdir(directory, { recursive: true }); await writeFile(resolve(directory, filename), bytes, { flag: 'wx', mode: 0o600 }); avatarUrl = `/api/academic/files/${filename}`;
    }
  }
  const profile = await AcademicProfile.findOneAndUpdate({ tenantId: tenantOf(req)._id, profileId: profileOf(req)._id }, { $set: { courseOfStudy, avatarUrl } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
  res.json({ courseOfStudy: profile.courseOfStudy, avatarUrl: profile.avatarUrl });
});

academicRouter.post('/files', async (req, res) => {
  const data = req.body?.data; const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 180) : '';
  if (!name || typeof data !== 'string' || data.length > 14_000_000) return fail(res, 400, 'Selecione um arquivo válido de até 10 MB.');
  const match = data.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i); if (!match) return fail(res, 400, 'O arquivo não está em um formato reconhecido.');
  const mimeType = match[1].toLowerCase(); const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) return fail(res, 400, 'O arquivo deve ter até 10 MB.');
  const type = mimeType === 'application/pdf' && bytes.subarray(0,5).toString() === '%PDF-'
    ? 'pdf'
    : mimeType === 'image/png' && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
      : mimeType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpg'
        : mimeType === 'image/webp' && bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'webp'
          : ['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(mimeType) && bytes.subarray(0,2).toString() === 'PK' ? (mimeType.includes('wordprocessing')?'docx':mimeType.includes('presentation')?'pptx':'xlsx')
            : mimeType === 'application/vnd.ms-excel' && bytes.subarray(0,4).equals(Buffer.from([0xd0,0xcf,0x11,0xe0])) ? 'xls' : null;
  if (!type) return fail(res, 400, 'Tipo de arquivo não permitido ou conteúdo inválido. Use PDF, DOCX, PPTX, XLSX, XLS ou imagem PNG, JPEG e WebP.');
  const filename = `academic_${randomBytes(16).toString('hex')}.${type}`; const directory = resolve(uploadRoot, tenantOf(req).slug);
  await mkdir(directory, { recursive: true }); await writeFile(resolve(directory, filename), bytes, { flag: 'wx', mode: 0o600 });
  res.status(201).json({ url: `/api/academic/files/${filename}`, name, mimeType, size: bytes.length });
});
academicRouter.get('/files/:filename', async (req, res) => {
  const filename = req.params.filename;
  if (!/^academic_[a-f0-9]{32}\.(pdf|png|jpg|webp|docx|pptx|xlsx|xls)$/.test(filename)) return fail(res, 404, 'Arquivo não encontrado.');
  const url = `/api/academic/files/${filename}`; const tenantId = tenantOf(req)._id;
  if (await AcademicProfile.exists({ tenantId, avatarUrl: url })) { const filePath = resolve(uploadRoot, tenantOf(req).slug, filename); res.sendFile(filePath, { headers: { 'Content-Disposition': 'inline' } }); return; }
  if (await AcademicProfile.exists({ tenantId, avatarUrl: url })) {
    const filePath = resolve(uploadRoot, tenantOf(req).slug, filename); res.sendFile(filePath, { headers: { 'Content-Disposition': 'inline' } }); return;
  }
  const [lesson, content, assignment, exam, submission] = await Promise.all([
    AcademicLesson.findOne({ tenantId, 'attachment.url': url }).select('disciplineId').lean(), AcademicContent.findOne({ tenantId, 'attachment.url': url }).select('disciplineId').lean(), AcademicAssignment.findOne({ tenantId, 'attachment.url': url }).select('disciplineId').lean(), AcademicExam.findOne({ tenantId, 'attachment.url': url }).select('disciplineId').lean(), AcademicSubmission.findOne({ tenantId, 'attachment.url': url }).select('disciplineId studentProfileId').lean(),
  ]);
  const record = lesson ?? content ?? assignment ?? exam ?? submission;
  if (!record) return fail(res, 404, 'Arquivo não encontrado.');
  const canRead = submission?.studentProfileId.equals(profileOf(req)._id) || await disciplinePermission(req, res, record.disciplineId);
  if (!canRead) return;
  const filePath = resolve(uploadRoot, tenantOf(req).slug, filename); res.sendFile(filePath, { headers: { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}` } });
});

academicRouter.get('/disciplines', async (req, res) => {
  const tenantId = tenantOf(req)._id; const profileId = profileOf(req)._id;
  const [admin, teacher] = await Promise.all([isAdmin(req), hasRole(req, 'TEACHER')]);
  const [assignments, enrollments] = await Promise.all([
    teacher ? AcademicDisciplineTeacher.find({ tenantId, teacherProfileId: profileId, active: true }).distinct('disciplineId') : Promise.resolve([]),
    AcademicEnrollment.find({ tenantId, studentProfileId: profileId, status: 'active' }).distinct('disciplineId'),
  ]);
  const filter: Record<string, unknown> = { tenantId, status: 'active' };
  if (req.query.scope === 'mine') {
    filter._id = { $in: [...assignments, ...enrollments] };
  } else if (req.query.scope === 'enrolled') filter._id = { $in: enrollments };
  else if (!admin) filter._id = { $in: [...assignments, ...enrollments] };
  const disciplines = await AcademicDiscipline.find(filter).sort({ name: 1 }).lean();
  const ids = disciplines.map((item) => item._id);
  const [links, nextLessons, exams, tasks] = await Promise.all([
    AcademicDisciplineTeacher.find({ tenantId, disciplineId: { $in: ids }, active: true }).select('disciplineId teacherProfileId').lean(),
    AcademicLesson.find({ tenantId, disciplineId: { $in: ids }, status: 'published', startAt: { $gte: new Date() } }).sort({ startAt: 1 }).lean(),
    AcademicExam.find({ tenantId, disciplineId: { $in: ids }, status: 'published', examAt: { $gte: new Date() } }).sort({ examAt: 1 }).lean(),
    AcademicAssignment.find({ tenantId, disciplineId: { $in: ids }, status: 'published', dueAt: { $gte: new Date() } }).sort({ dueAt: 1 }).lean(),
  ]);
  const teacherProfiles = await profilesFor(links.map((item) => item.teacherProfileId), tenantId);
  res.json(disciplines.map((discipline) => ({ id: discipline._id.toString(), name: discipline.name, code: discipline.code, description: discipline.description, teachers: links.filter((x) => x.disciplineId.equals(discipline._id)).map((link) => teacherProfiles.find((p) => p._id.equals(link.teacherProfileId))).filter(Boolean).map((p) => ({ name: p!.displayName, username: p!.username })), nextLesson: nextLessons.find((item) => item.disciplineId.equals(discipline._id)) ?? null, nextExam: exams.find((item) => item.disciplineId.equals(discipline._id)) ?? null, pendingCount: tasks.filter((item) => item.disciplineId.equals(discipline._id)).length })));
});

academicRouter.get('/today', async (req, res) => {
  const tenantId = tenantOf(req)._id; const profileId = profileOf(req)._id;
  const links = await AcademicEnrollment.find({ tenantId, studentProfileId: profileId, status: 'active' }).select('disciplineId').lean();
  const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1);
  const lessons = await AcademicLesson.find({ tenantId, disciplineId: { $in: links.map((x) => x.disciplineId) }, status: 'published', startAt: { $gte: start, $lt: end } }).sort({ startAt: 1 }).lean();
  const disciplines = await AcademicDiscipline.find({ tenantId, _id: { $in: lessons.map((l) => l.disciplineId) } }).select('name').lean();
  res.json(lessons.map((lesson) => ({ ...lesson, id: lesson._id.toString(), discipline: disciplines.find((d) => d._id.equals(lesson.disciplineId))?.name ?? '' })));
});

academicRouter.get('/disciplines/:id', async (req, res) => {
  if (!oid(req.params.id)) return fail(res, 400, 'Disciplina inválida.');
  const tenantId = tenantOf(req)._id; const disciplineId = new mongoose.Types.ObjectId(req.params.id);
  const access = await disciplinePermission(req, res, disciplineId); if (!access) return;
  const discipline = await AcademicDiscipline.findOne({ _id: disciplineId, tenantId }).lean(); if (!discipline) return fail(res, 404, 'Disciplina não encontrada.');
  const [lessons, contents, assignments, exams, enrollments, grades, submissions] = await Promise.all([
    AcademicLesson.find({ tenantId, disciplineId, status: 'published' }).sort({ startAt: 1 }).lean(),
    AcademicContent.find({ tenantId, disciplineId }).sort({ publishedAt: -1 }).lean(),
    AcademicAssignment.find({ tenantId, disciplineId, status: 'published' }).sort({ dueAt: 1 }).lean(),
    AcademicExam.find({ tenantId, disciplineId, status: 'published' }).sort({ examAt: 1 }).lean(),
    access.academicAdmin || access.assignedTeacher ? AcademicEnrollment.find({ tenantId, disciplineId, status: 'active' }).select('studentProfileId enrolledAt').lean() : Promise.resolve([]),
    AcademicGrade.find({ tenantId, disciplineId, studentProfileId: profileOf(req)._id }).sort({ gradedAt: -1 }).lean(),
    AcademicSubmission.find({ tenantId, disciplineId, studentProfileId: profileOf(req)._id }).select('assignmentId status submittedAt score feedback').lean(),
  ]);
  const studentProfiles = await profilesFor(enrollments.map((item) => item.studentProfileId), tenantId);
  res.json({ discipline: { id: discipline._id.toString(), name: discipline.name, code: discipline.code, description: discipline.description }, lessons, contents, assignments, exams, grades: grades.map((g) => ({ ...g, id: g._id.toString() })), submissions, students: studentProfiles.map((p) => ({ id: p._id.toString(), name: p.displayName, username: p.username, avatarUrl: p.avatarUrl })) });
});

academicRouter.get('/activities', async (req, res) => {
  const tenantId = tenantOf(req)._id; const profileId = profileOf(req)._id;
  if (!await hasRole(req, 'STUDENT')) return res.json([]);
  const [assignments, submissions, disciplines] = await Promise.all([AcademicAssignment.find({ tenantId, status: 'published' }).sort({ dueAt: 1 }).lean(), AcademicSubmission.find({ tenantId, studentProfileId: profileId }).lean(), AcademicDiscipline.find({ tenantId }).select('name').lean()]);
  res.json(assignments.map((item) => ({ ...item, id: item._id.toString(), disciplineName: disciplines.find((d) => d._id.equals(item.disciplineId))?.name ?? '', submission: submissions.find((s) => s.assignmentId.equals(item._id)) ?? null })));
});
academicRouter.get('/exams', async (req, res) => {
  const tenantId = tenantOf(req)._id; const profileId = profileOf(req)._id;
  if (!await hasRole(req, 'STUDENT')) return res.json([]);
  const [exams, disciplines, submissions] = await Promise.all([AcademicExam.find({ tenantId, status: 'published' }).sort({ examAt: 1 }).lean(), AcademicDiscipline.find({ tenantId }).select('name').lean(), AcademicExamSubmission.find({ tenantId, studentProfileId: profileId }).lean()]);
  res.json(exams.map((item) => ({ ...item, id: item._id.toString(), disciplineName: disciplines.find((d) => d._id.equals(item.disciplineId))?.name ?? '', submission: submissions.find((submission) => submission.examId.equals(item._id)) ?? null })));
});
academicRouter.get('/grades', async (req, res) => {
  const tenantId = tenantOf(req)._id; const profileId = profileOf(req)._id;
  const rows = await AcademicGrade.find({ tenantId, studentProfileId: profileId }).sort({ gradedAt: -1 }).lean();
  const disciplines = await AcademicDiscipline.find({ tenantId, _id: { $in: rows.map((item) => item.disciplineId) } }).select('name').lean();
  res.json(rows.map((item) => ({ ...item, id: item._id.toString(), disciplineName: disciplines.find((d) => d._id.equals(item.disciplineId))?.name ?? '' })));
});
academicRouter.get('/notices', async (req, res) => {
  const notices = await Notification.find({ tenantId: tenantOf(req)._id, characterId: profileOf(req)._id, type: { $in: ['academic_update', 'academic_grade', 'academic_submission'] } }).sort({ createdAt: -1 }).limit(20).lean();
  res.json(notices.map((item) => ({ id: item._id.toString(), type: item.type, targetId: item.targetId.toString(), createdAt: item.createdAt })));
});

academicRouter.post('/assignments/:id/submit', async (req, res) => {
  if (!oid(req.params.id)) return fail(res, 400, 'Atividade inválida.');
  const assignment = await AcademicAssignment.findOne({ _id: req.params.id, tenantId: tenantOf(req)._id, status: 'published' });
  if (!assignment) return fail(res, 404, 'Atividade não encontrada.');
  const textContent = typeof req.body?.textContent === 'string' ? req.body.textContent.trim() : '';
  const file = checkedAcademicAttachment(req.body?.attachment);
  if (req.body?.attachment && !file) return fail(res, 400, 'O arquivo anexado não é válido para esta comunidade.');
  const hasFile = Boolean(file);
  const eligibleStudent = await hasRole(req, 'STUDENT') || await isEnrolled(req, assignment.disciplineId);
  const allowed = maySubmitAssignment({ enrolled: eligibleStudent, isOpen: !assignment.opensAt || assignment.opensAt <= new Date(), beforeDeadline: assignment.dueAt >= new Date(), textAllowed: assignment.allowText, fileAllowed: assignment.allowFile, hasText: Boolean(textContent), hasFile });
  if (!allowed) return fail(res, 403, 'A entrega não está disponível para sua matrícula ou ultrapassou o prazo.');
  const submission = await AcademicSubmission.findOneAndUpdate({ tenantId: tenantOf(req)._id, assignmentId: assignment._id, studentProfileId: profileOf(req)._id }, { $set: { disciplineId: assignment.disciplineId, textContent, ...(hasFile ? { attachment: file } : {}), submittedAt: new Date(), status: 'submitted', score: undefined, feedback: '', gradedByProfileId: undefined, gradedAt: undefined } }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true });
  await Notification.create({ tenantId: tenantOf(req)._id, characterId: assignment.teacherProfileId, actorId: profileOf(req)._id, targetId: submission._id, type: 'academic_submission' }).catch(() => undefined);
  res.status(201).json(submission);
});

academicRouter.post('/exams/:id/submit', async (req, res) => {
  if (!oid(req.params.id)) return fail(res, 400, 'Prova inválida.');
  const exam = await AcademicExam.findOne({ _id: req.params.id, tenantId: tenantOf(req)._id, status: 'published' }).lean();
  if (!exam) return fail(res, 404, 'Prova não encontrada.');
  if (!await hasRole(req, 'STUDENT') && !await isEnrolled(req, exam.disciplineId)) return fail(res, 403, 'Somente alunos da comunidade podem realizar esta prova.');
  if (await AcademicExamSubmission.exists({ tenantId: tenantOf(req)._id, examId: exam._id, studentProfileId: profileOf(req)._id })) return fail(res, 409, 'Você já enviou sua resposta para esta prova.');
  const questions = Array.isArray(exam.questions) ? exam.questions : [];
  const answers = questions.map((question, index) => ({ prompt: question.prompt, response: typeof req.body?.answers?.[index]?.response === 'string' ? req.body.answers[index].response.trim() : '' }));
  if (questions.length && (answers.some((answer) => !answer.response) || !Array.isArray(req.body?.answers) || req.body.answers.length !== questions.length)) return fail(res, 400, 'Responda todas as questões antes de enviar.');
  const responseText = typeof req.body?.responseText === 'string' ? req.body.responseText.trim() : '';
  if (!questions.length && !responseText) return fail(res, 400, 'Escreva sua resposta antes de enviar.');
  if (answers.some((answer) => answer.response.length > 5000) || responseText.length > 10000) return fail(res, 400, 'Uma resposta ultrapassou o limite permitido.');
  try {
    const submission = await AcademicExamSubmission.create({ tenantId: tenantOf(req)._id, examId: exam._id, disciplineId: exam.disciplineId, studentProfileId: profileOf(req)._id, answers, responseText });
    await Notification.create({ tenantId: tenantOf(req)._id, characterId: exam.teacherProfileId, actorId: profileOf(req)._id, targetId: submission._id, type: 'academic_submission' }).catch(() => undefined);
    res.status(201).json(submission);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return fail(res, 409, 'Você já enviou sua resposta para esta prova.');
    throw error;
  }
});

academicRouter.get('/teacher', async (req, res) => {
  const roles = await rolesFor(tenantOf(req)._id, profileOf(req)._id);
  if (!mayAccessTeacherArea(roles)) return fail(res, 403, 'A Área do Professor exige autorização acadêmica.');
  const tenantId = tenantOf(req)._id;
  const links = await AcademicDisciplineTeacher.find({ tenantId, teacherProfileId: profileOf(req)._id, active: true }).select('disciplineId').lean();
  const disciplineFilter: Record<string, unknown> = { tenantId, status: 'active', _id: { $in: links.map((x) => x.disciplineId) } };
  const disciplines = await AcademicDiscipline.find(disciplineFilter).sort({ name: 1 }).lean(); const ids = disciplines.map((item) => item._id);
  const [lessons, assignments, exams] = await Promise.all([AcademicLesson.find({ tenantId, disciplineId: { $in: ids }, startAt: { $gte: new Date() }, status: 'published' }).sort({ startAt: 1 }).limit(10).lean(), AcademicAssignment.find({ tenantId, disciplineId: { $in: ids }, status: 'published' }).lean(), AcademicExam.find({ tenantId, disciplineId: { $in: ids }, status: 'published', examAt: { $gte: new Date() } }).sort({ examAt: 1 }).limit(10).lean()]);
  const submissions = await AcademicSubmission.find({ tenantId, assignmentId: { $in: assignments.map((a) => a._id) }, status: 'submitted' }).sort({ submittedAt: 1 }).lean();
  const examSubmissions = await AcademicExamSubmission.find({ tenantId, disciplineId: { $in: ids } }).sort({ submittedAt: -1 }).lean();
  const communityMembers = await Character.find({ tenantId }).select('displayName username avatarUrl accountId').lean();
  const activeAccounts = await Account.find({ tenantId, status: 'active', _id: { $in: communityMembers.map((member) => member.accountId) } }).select('_id').lean();
  const activeAccountIds = new Set(activeAccounts.map((account) => account._id.toString()));
  const roster = communityMembers.filter((member) => activeAccountIds.has(member.accountId.toString()));
  const students = await profilesFor(submissions.map((item) => item.studentProfileId), tenantId);
  const examStudents = await profilesFor(examSubmissions.map((item) => item.studentProfileId), tenantId);
  const examTitles = new Map((await AcademicExam.find({ tenantId, _id: { $in: examSubmissions.map((item) => item.examId) } }).select('_id title').lean()).map((item) => [item._id.toString(), item.title]));
  res.json({ roles, disciplines: disciplines.map((d) => ({ id: d._id.toString(), name: d.name, code: d.code, description: d.description, assignedToMe: links.some((link) => link.disciplineId.equals(d._id)) })), lessons, assignments, exams, students: roster.map((p) => ({ id: p._id.toString(), name: p.displayName, username: p.username, avatarUrl: p.avatarUrl })), pendingSubmissions: submissions.map((s) => ({ ...s, id: s._id.toString(), student: students.find((p) => p._id.equals(s.studentProfileId)) ?? null })), examSubmissions: examSubmissions.map((submission) => ({ ...submission, id: submission._id.toString(), examTitle: examTitles.get(submission.examId.toString()) ?? 'Prova', student: examStudents.find((student) => student._id.equals(submission.studentProfileId)) ?? null })) });
});

academicRouter.post('/teacher/disciplines', async (req, res) => {
  const roles = await rolesFor(tenantOf(req)._id, profileOf(req)._id);
  if (!roles.includes('TEACHER') && !roles.includes('DIRECTOR') && !roles.includes('ACADEMIC_ADMIN')) return fail(res, 403, 'Apenas professores autorizados podem criar disciplinas.');
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  if (name.length < 2 || name.length > 100 || !/^[A-Z0-9_-]{2,24}$/.test(code) || description.length > 1500) return fail(res, 400, 'Informe nome e código válidos. A descrição pode ter até 1.500 caracteres.');
  if (await AcademicDiscipline.exists({ tenantId: tenantOf(req)._id, code })) return fail(res, 409, 'Este código já está sendo usado por outra disciplina nesta comunidade.');
  const discipline = await AcademicDiscipline.create({ tenantId: tenantOf(req)._id, name, code, description, createdBy: profileOf(req)._id });
  await AcademicDisciplineTeacher.create({ tenantId: tenantOf(req)._id, disciplineId: discipline._id, teacherProfileId: profileOf(req)._id, assignedBy: profileOf(req)._id, active: true });
  res.status(201).json(discipline);
});

academicRouter.delete('/teacher/disciplines/:id', async (req, res) => {
  if (!oid(req.params.id)) return fail(res, 400, 'Disciplina inválida.');
  const disciplineId = new mongoose.Types.ObjectId(req.params.id);
  const roles = await rolesFor(tenantOf(req)._id, profileOf(req)._id);
  if (!roles.some((role) => ['TEACHER', 'DIRECTOR', 'ACADEMIC_ADMIN'].includes(role)) || !await AcademicDisciplineTeacher.exists({ tenantId: tenantOf(req)._id, disciplineId, teacherProfileId: profileOf(req)._id, active: true })) return fail(res, 403, 'Você não está vinculado como professor(a) desta disciplina.');
  await AcademicDisciplineTeacher.updateOne({ tenantId: tenantOf(req)._id, disciplineId, teacherProfileId: profileOf(req)._id, active: true }, { $set: { active: false } });
  res.status(204).end();
});

academicRouter.get('/teacher/discipline/:id', async (req, res) => {
  if (!oid(req.params.id)) return fail(res, 400, 'Disciplina inválida.');
  const disciplineId = new mongoose.Types.ObjectId(req.params.id); if (!await teacherPermission(req, res, disciplineId)) return;
  const tenantId = tenantOf(req)._id; const [discipline, enrollments, assignments, grades, lessons] = await Promise.all([AcademicDiscipline.findOne({ _id: disciplineId, tenantId }).lean(), AcademicEnrollment.find({ tenantId, disciplineId, status: 'active' }).select('studentProfileId').lean(), AcademicAssignment.find({ tenantId, disciplineId }).sort({ dueAt: 1 }).lean(), AcademicGrade.find({ tenantId, disciplineId }).lean(), AcademicLesson.find({ tenantId, disciplineId, status: 'published' }).sort({ startAt: -1 }).limit(30).lean()]);
  if (!discipline) return fail(res, 404, 'Disciplina não encontrada.');
  const students = await profilesFor(enrollments.map((e) => e.studentProfileId), tenantId);
  const assignmentIds = assignments.map((a) => a._id); const submissions = await AcademicSubmission.find({ tenantId, assignmentId: { $in: assignmentIds } }).lean();
  const submitterProfiles = await profilesFor(submissions.map((s) => s.studentProfileId), tenantId);
  res.json({ discipline, lessons, students: students.map((p) => ({ id: p._id.toString(), name: p.displayName, username: p.username, avatarUrl: p.avatarUrl, grades: grades.filter((g) => g.studentProfileId.equals(p._id)).map((g) => ({ id: g._id.toString(), title: g.title, score: g.score, maxScore: g.maxScore, feedback: g.feedback })) })), assignments, submissions: submissions.map((s) => ({ ...s, id: s._id.toString(), student: submitterProfiles.find((p) => p._id.equals(s.studentProfileId)) })) });
});

academicRouter.post('/teacher/lessons', async (req, res) => {
  const { disciplineId, title, description = '', content = '', startAt, endAt, location = '' } = req.body ?? {};
  if (!oid(disciplineId) || typeof title !== 'string' || title.trim().length < 2) return fail(res, 400, 'Informe uma disciplina e o título da aula.');
  if (!await teacherPermission(req, res, new mongoose.Types.ObjectId(disciplineId))) return;
  const start = parseDate(startAt); const end = parseDate(endAt); if (!start || !end || end <= start) return fail(res, 400, 'Informe horários válidos para a aula.');
  const attachment = checkedAcademicAttachment(req.body?.attachment); if (req.body?.attachment && !attachment) return fail(res, 400, 'O anexo não é válido para esta comunidade.');
  const lesson = await AcademicLesson.create({ tenantId: tenantOf(req)._id, disciplineId, teacherProfileId: profileOf(req)._id, title: title.trim(), description, content, startAt: start, endAt: end, location, attachment });
  await notifyStudents(tenantOf(req)._id, lesson.disciplineId, profileOf(req)._id, lesson._id, 'academic_update'); res.status(201).json(lesson);
});
academicRouter.patch('/teacher/lessons/:id', async (req, res) => {
  if (!oid(req.params.id)) return fail(res, 400, 'Aula inválida.');
  const lesson = await AcademicLesson.findOne({ _id: req.params.id, tenantId: tenantOf(req)._id, status: 'published' }); if (!lesson) return fail(res, 404, 'Aula não encontrada.');
  if (!await teacherPermission(req, res, lesson.disciplineId)) return;
  const body = req.body ?? {}; let scheduleChanged = false;
  for (const key of ['title','description','content','location'] as const) if (body[key] !== undefined) { if (typeof body[key] !== 'string') return fail(res, 400, 'Confira os dados informados.'); lesson[key] = body[key].trim(); }
  if (body.startAt !== undefined) { const value = parseDate(body.startAt); if (!value) return fail(res, 400, 'Data de início inválida.'); scheduleChanged ||= value.getTime() !== lesson.startAt.getTime(); lesson.startAt = value; }
  if (body.endAt !== undefined) { const value = parseDate(body.endAt); if (!value) return fail(res, 400, 'Data de término inválida.'); scheduleChanged ||= value.getTime() !== lesson.endAt.getTime(); lesson.endAt = value; }
  if (lesson.endAt <= lesson.startAt) return fail(res, 400, 'O término precisa ser depois do início.');
  await lesson.save(); if (scheduleChanged) await notifyStudents(tenantOf(req)._id, lesson.disciplineId, profileOf(req)._id, lesson._id, 'academic_update'); res.json(lesson);
});
academicRouter.post('/teacher/contents', async (req, res) => {
  const { disciplineId, title, description = '', url = '', lessonId } = req.body ?? {};
  if (!oid(disciplineId) || typeof title !== 'string' || title.trim().length < 2 || (url && (typeof url !== 'string' || !/^https:\/\//i.test(url)))) return fail(res, 400, 'Informe um título e um link HTTPS válido, se houver.');
  if (!await teacherPermission(req, res, new mongoose.Types.ObjectId(disciplineId))) return;
  const attachment = checkedAcademicAttachment(req.body?.attachment); if (req.body?.attachment && !attachment) return fail(res, 400, 'O anexo não é válido para esta comunidade.');
  if (oid(lessonId) && !await AcademicLesson.exists({ _id: lessonId, tenantId: tenantOf(req)._id, disciplineId })) return fail(res, 404, 'A aula não pertence a esta disciplina.');
  const item = await AcademicContent.create({ tenantId: tenantOf(req)._id, disciplineId, ...(oid(lessonId) ? { lessonId } : {}), teacherProfileId: profileOf(req)._id, title: title.trim(), description, url, attachment });
  await notifyStudents(tenantOf(req)._id, item.disciplineId, profileOf(req)._id, item._id, 'academic_update'); res.status(201).json(item);
});
academicRouter.post('/teacher/assignments', async (req, res) => {
  const body = req.body ?? {}; const dueAt = parseDate(body.dueAt); const opensAt = body.opensAt ? parseDate(body.opensAt) : undefined;
  if (!oid(body.disciplineId) || typeof body.title !== 'string' || body.title.trim().length < 2 || typeof body.instructions !== 'string' || !body.instructions.trim() || !dueAt || (opensAt && !opensAt) || !Number.isFinite(Number(body.maxScore)) || Number(body.maxScore) <= 0) return fail(res, 400, 'Preencha título, instruções, prazo e nota máxima.');
  const disciplineId = new mongoose.Types.ObjectId(body.disciplineId); if (!await teacherPermission(req, res, disciplineId)) return;
  const attachment = checkedAcademicAttachment(body.attachment); if (body.attachment && !attachment) return fail(res, 400, 'O anexo não é válido para esta comunidade.');
  const item = await AcademicAssignment.create({ tenantId: tenantOf(req)._id, disciplineId, teacherProfileId: profileOf(req)._id, title: body.title.trim(), instructions: body.instructions.trim(), dueAt, opensAt, maxScore: Number(body.maxScore), allowText: body.allowText !== false, allowFile: body.allowFile === true, attachment });
  await notifyCommunityStudents(tenantOf(req)._id, profileOf(req)._id, item._id, 'academic_update'); res.status(201).json(item);
});
academicRouter.post('/teacher/exams', async (req, res) => {
  const body = req.body ?? {}; const examAt = parseDate(body.examAt);
  if (!oid(body.disciplineId) || typeof body.title !== 'string' || body.title.trim().length < 2 || !examAt || !Number.isFinite(Number(body.maxScore)) || Number(body.maxScore) <= 0) return fail(res, 400, 'Preencha título, data e nota máxima.');
  const disciplineId = new mongoose.Types.ObjectId(body.disciplineId); if (!await teacherPermission(req, res, disciplineId)) return;
  if (!Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > 40 || body.questions.some((question: unknown) => typeof question !== 'string' || !question.trim() || question.trim().length > 1000)) return fail(res, 400, 'Adicione de 1 a 40 questões, com até 1.000 caracteres cada.');
  const attachment = checkedAcademicAttachment(body.attachment); if (body.attachment && !attachment) return fail(res, 400, 'O anexo não é válido para esta comunidade.');
  const item = await AcademicExam.create({ tenantId: tenantOf(req)._id, disciplineId, teacherProfileId: profileOf(req)._id, title: body.title.trim(), description: body.description ?? '', examAt, location: body.location ?? '', maxScore: Number(body.maxScore), instructions: body.instructions ?? '', questions: body.questions.map((question: string) => ({ prompt: question.trim() })), attachment });
  await notifyCommunityStudents(tenantOf(req)._id, profileOf(req)._id, item._id, 'academic_update'); res.status(201).json(item);
});
academicRouter.post('/teacher/grades', async (req, res) => {
  const body = req.body ?? {}; const disciplineId = oid(body.disciplineId) ? new mongoose.Types.ObjectId(body.disciplineId) : null;
  if (!disciplineId || !await teacherPermission(req, res, disciplineId)) return;
  if (!oid(body.studentProfileId) || typeof body.title !== 'string' || !Number.isFinite(Number(body.score)) || !Number.isFinite(Number(body.maxScore)) || Number(body.score) < 0 || Number(body.maxScore) <= 0 || Number(body.score) > Number(body.maxScore)) return fail(res, 400, 'Informe aluno, avaliação e uma nota válida.');
  if (!await communityCharacter(tenantOf(req)._id, body.studentProfileId)) return fail(res, 404, 'O aluno selecionado não pertence a esta comunidade.');
  const grade = await AcademicGrade.findOneAndUpdate({ tenantId: tenantOf(req)._id, studentProfileId: body.studentProfileId, assessmentKey: `manual:${disciplineId}:${String(body.title).trim().toLowerCase()}` }, { $set: { disciplineId, studentProfileId: body.studentProfileId, assessmentKey: `manual:${disciplineId}:${String(body.title).trim().toLowerCase()}`, assessmentType: 'manual', title: String(body.title).trim(), score: Number(body.score), maxScore: Number(body.maxScore), feedback: typeof body.feedback === 'string' ? body.feedback.slice(0, 3000) : '', gradedByProfileId: profileOf(req)._id, gradedAt: new Date() } }, { new: true, upsert: true, runValidators: true });
  await Notification.create({ tenantId: tenantOf(req)._id, characterId: body.studentProfileId, actorId: profileOf(req)._id, targetId: grade._id, type: 'academic_grade' }).catch(() => undefined); res.json(grade);
});
academicRouter.patch('/teacher/submissions/:id/grade', async (req, res) => {
  if (!oid(req.params.id)) return fail(res, 400, 'Entrega inválida.');
  const submission = await AcademicSubmission.findOne({ _id: req.params.id, tenantId: tenantOf(req)._id }); if (!submission) return fail(res, 404, 'Entrega não encontrada.');
  if (!await teacherPermission(req, res, submission.disciplineId)) return;
  const score = Number(req.body?.score); if (!Number.isFinite(score) || score < 0) return fail(res, 400, 'Informe uma nota válida.');
  const assignment = await AcademicAssignment.findOne({ _id: submission.assignmentId, tenantId: tenantOf(req)._id }); if (!assignment || score > assignment.maxScore) return fail(res, 400, 'A nota ultrapassa o valor máximo da atividade.');
  submission.score = score; submission.feedback = typeof req.body?.feedback === 'string' ? req.body.feedback.slice(0, 3000) : ''; submission.status = 'graded'; submission.gradedByProfileId = profileOf(req)._id; submission.gradedAt = new Date(); await submission.save();
  await AcademicGrade.findOneAndUpdate({ tenantId: tenantOf(req)._id, studentProfileId: submission.studentProfileId, assessmentKey: `assignment:${assignment._id}` }, { $set: { tenantId: tenantOf(req)._id, disciplineId: assignment.disciplineId, studentProfileId: submission.studentProfileId, assessmentKey: `assignment:${assignment._id}`, assessmentType: 'assignment', assessmentId: assignment._id, title: assignment.title, score, maxScore: assignment.maxScore, feedback: submission.feedback, gradedByProfileId: profileOf(req)._id, gradedAt: submission.gradedAt } }, { upsert: true, new: true, runValidators: true });
  await Notification.create({ tenantId: tenantOf(req)._id, characterId: submission.studentProfileId, actorId: profileOf(req)._id, targetId: submission._id, type: 'academic_grade' }).catch(() => undefined); res.json(submission);
});

academicRouter.post('/admin/setup/academic-admin', async (req, res) => {
  if (!await generalAdminCanBootstrap(req)) return fail(res, 403, 'Somente a administração da comunidade pode autorizar o primeiro administrador acadêmico.');
  if (!oid(req.body?.profileId)) return fail(res, 400, 'Selecione um perfil da comunidade.');
  const target = await communityCharacter(tenantOf(req)._id, req.body.profileId); if (!target) return fail(res, 404, 'Perfil não encontrado nesta comunidade.');
  await AcademicRole.updateOne({ tenantId: tenantOf(req)._id, profileId: req.body.profileId, role: 'ACADEMIC_ADMIN' }, { $set: { status: 'active', grantedBy: profileOf(req)._id, grantedAt: new Date(), revokedAt: undefined } }, { upsert: true, runValidators: true });
  res.status(201).json({ ok: true });
});
academicRouter.get('/admin/members', async (req, res) => {
  if (!await isAdmin(req) && !await generalAdminCanBootstrap(req)) { fail(res, 403, 'Apenas uma pessoa autorizada pode buscar membros.'); return; }
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const chars = await Character.find({ tenantId: tenantOf(req)._id, ...(q ? { $or: [{ displayName: { $regex: q.slice(0, 40), $options: 'i' } }, { username: { $regex: q.replace(/^@/, '').slice(0, 24), $options: 'i' } }] } : {}) }).limit(30).select('displayName username avatarUrl accountId').lean();
  const accounts = await Account.find({ tenantId: tenantOf(req)._id, status: 'active', _id: { $in: chars.map((c) => c.accountId) } }).select('_id').lean(); const activeAccountIds = new Set(accounts.map((a) => a._id.toString()));
  res.json(chars.filter((c) => activeAccountIds.has(c.accountId.toString())).map((c) => ({ id: c._id.toString(), name: c.displayName, username: c.username, avatarUrl: c.avatarUrl })));
});
academicRouter.post('/admin/members/role', async (req, res) => {
  if (!await requireAcademicAdmin(req, res)) return;
  const { profileId, role, disciplineId, disciplineIds = [] } = req.body ?? {};
  const allowedRoles: AcademicRoleName[] = ['TEACHER', 'DIRECTOR', 'STUDENT', 'ACADEMIC_ADMIN'];
  if (!oid(profileId) || !allowedRoles.includes(role) || !Array.isArray(disciplineIds) || disciplineIds.some((id: unknown) => !oid(id))) return fail(res, 400, 'Selecione um membro e uma função acadêmica válida.');
  if (!await communityCharacter(tenantOf(req)._id, profileId)) return fail(res, 404, 'Perfil não encontrado nesta comunidade.');
  const linkedDisciplineIds: string[] = role === 'STUDENT' ? (disciplineIds.length ? [...new Set(disciplineIds)] : oid(disciplineId) ? [disciplineId] : []) : ['TEACHER', 'DIRECTOR'].includes(role) ? [...new Set(disciplineIds)] : [];
  if (role === 'STUDENT' && !linkedDisciplineIds.length) return fail(res, 400, 'Selecione ao menos uma disciplina para o aluno.');
  if (linkedDisciplineIds.length && await AcademicDiscipline.countDocuments({ tenantId: tenantOf(req)._id, _id: { $in: linkedDisciplineIds }, status: 'active' }) !== linkedDisciplineIds.length) return fail(res, 400, 'Uma ou mais disciplinas não pertencem a esta comunidade.');
  const tenantId = tenantOf(req)._id;
  const current = await AcademicRole.find({ tenantId, profileId, role: 'ACADEMIC_ADMIN', status: 'active' }).lean();
  const keepAdminAccess = current.length > 0 && (role === 'TEACHER' || role === 'DIRECTOR');
  if (current.length && role === 'STUDENT' && await AcademicRole.countDocuments({ tenantId, role: 'ACADEMIC_ADMIN', status: 'active' }) <= 1) return fail(res, 400, 'A comunidade precisa manter pelo menos um ADM acadêmico ativo.');
  const rolesToDeactivate = allowedRoles.filter((candidate) => candidate !== role && !(keepAdminAccess && candidate === 'ACADEMIC_ADMIN'));
  if (rolesToDeactivate.length) await AcademicRole.updateMany({ tenantId, profileId, role: { $in: rolesToDeactivate } }, { $set: { status: 'inactive', revokedAt: new Date() } });
  await AcademicRole.updateOne({ tenantId, profileId, role }, { $set: { status: 'active', grantedBy: profileOf(req)._id, grantedAt: new Date(), revokedAt: undefined } }, { upsert: true, runValidators: true });
  await AcademicDisciplineTeacher.updateMany({ tenantId, teacherProfileId: profileId }, { $set: { active: false } });
  if (role === 'TEACHER' || role === 'DIRECTOR') await Promise.all(linkedDisciplineIds.map((id) => AcademicDisciplineTeacher.updateOne({ tenantId, disciplineId: id, teacherProfileId: profileId }, { $set: { active: true, assignedBy: profileOf(req)._id } }, { upsert: true })));
  if (role === 'STUDENT') await Promise.all(linkedDisciplineIds.map((id) => AcademicEnrollment.findOneAndUpdate({ tenantId, disciplineId: id, studentProfileId: profileId }, { $set: { status: 'active', enrolledAt: new Date(), removedAt: undefined, createdBy: profileOf(req)._id } }, { upsert: true, new: true, runValidators: true })));
  if (role !== 'STUDENT') await AcademicEnrollment.updateMany({ tenantId, studentProfileId: profileId, status: 'active' }, { $set: { status: 'removed', removedAt: new Date() } });
  res.status(201).json({ ok: true, role });
});
academicRouter.post('/admin/disciplines', async (req, res) => {
  if (!await requireAcademicAdmin(req, res)) return;
  const { name, code, description = '' } = req.body ?? {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100 || typeof description !== 'string' || description.length > 1500) return fail(res, 400, 'Informe um nome válido para a disciplina.');
  const providedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (providedCode && !/^[A-Z0-9_-]{2,24}$/.test(providedCode)) return fail(res, 400, 'O código deve ter de 2 a 24 caracteres: letras, números, hífen ou sublinhado.');
  let finalCode = providedCode || name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  if (finalCode.length < 2) finalCode = 'DISCIPLINA';
  if (!providedCode) {
    const baseCode = finalCode;
    let suffix = 2;
    while (await AcademicDiscipline.exists({ tenantId: tenantOf(req)._id, code: finalCode })) { const suffixCode = `_${suffix++}`; finalCode = `${baseCode.slice(0, 24 - suffixCode.length)}${suffixCode}`; }
  } else if (await AcademicDiscipline.exists({ tenantId: tenantOf(req)._id, code: finalCode })) return fail(res, 409, 'Já existe uma disciplina com esse código.');
  const item = await AcademicDiscipline.create({ tenantId: tenantOf(req)._id, name: name.trim(), code: finalCode, description: description.trim(), createdBy: profileOf(req)._id }); res.status(201).json(item);
});
academicRouter.patch('/admin/disciplines/:id', async (req, res) => {
  if (!await requireAcademicAdmin(req, res)) return;
  if (!oid(req.params.id)) return fail(res, 400, 'Disciplina inválida.');
  const body = req.body ?? {}; const item = await AcademicDiscipline.findOne({ _id: req.params.id, tenantId: tenantOf(req)._id }); if (!item) return fail(res, 404, 'Disciplina não encontrada.');
  if (body.name !== undefined) { if (typeof body.name !== 'string' || body.name.trim().length < 2) return fail(res, 400, 'Informe um nome válido.'); item.name = body.name.trim(); }
  if (body.description !== undefined) { if (typeof body.description !== 'string') return fail(res, 400, 'Descrição inválida.'); item.description = body.description.trim(); }
  if (body.status !== undefined) { if (!['active','archived'].includes(body.status)) return fail(res, 400, 'Status inválido.'); item.status = body.status; }
  await item.save(); res.json(item);
});
academicRouter.delete('/admin/disciplines/:id', async (req, res) => {
  if (!await requireAcademicAdmin(req, res)) return;
  if (!oid(req.params.id)) return fail(res, 400, 'Disciplina inválida.');
  const tenantId = tenantOf(req)._id;
  const discipline = await AcademicDiscipline.findOne({ _id: req.params.id, tenantId });
  if (!discipline) return fail(res, 404, 'Disciplina não encontrada.');
  if (discipline.status === 'archived') return res.status(204).end();
  const disciplineId = discipline._id;
  await Promise.all([
    AcademicDisciplineTeacher.updateMany({ tenantId, disciplineId }, { $set: { active: false } }),
    AcademicEnrollment.updateMany({ tenantId, disciplineId, status: 'active' }, { $set: { status: 'removed', removedAt: new Date() } }),
    AcademicLesson.updateMany({ tenantId, disciplineId, status: 'published' }, { $set: { status: 'cancelled' } }),
    AcademicAssignment.updateMany({ tenantId, disciplineId, status: 'published' }, { $set: { status: 'archived' } }),
    AcademicExam.updateMany({ tenantId, disciplineId, status: 'published' }, { $set: { status: 'cancelled' } }),
  ]);
  discipline.status = 'archived';
  await discipline.save();
  res.status(204).end();
});
academicRouter.post('/admin/teachers', async (req, res) => {
  if (!await requireAcademicAdmin(req, res)) return;
  const { profileId, disciplineIds = [] } = req.body ?? {}; if (!oid(profileId) || !Array.isArray(disciplineIds) || disciplineIds.some((id: unknown) => !oid(id))) return fail(res, 400, 'Selecione um membro e disciplinas válidas.');
  if (!await communityCharacter(tenantOf(req)._id, profileId)) return fail(res, 404, 'Perfil não encontrado nesta comunidade.');
  if (disciplineIds.length && await AcademicDiscipline.countDocuments({ tenantId: tenantOf(req)._id, _id: { $in: disciplineIds }, status: 'active' }) !== disciplineIds.length) return fail(res, 400, 'Uma ou mais disciplinas não pertencem a esta comunidade.');
  await AcademicRole.updateOne({ tenantId: tenantOf(req)._id, profileId, role: 'TEACHER' }, { $set: { status: 'active', grantedBy: profileOf(req)._id, grantedAt: new Date(), revokedAt: undefined } }, { upsert: true, runValidators: true });
  await AcademicRole.updateOne({ tenantId: tenantOf(req)._id, profileId, role: 'STUDENT' }, { $set: { status: 'inactive', revokedAt: new Date() } });
  await Promise.all(disciplineIds.map((disciplineId: string) => AcademicDisciplineTeacher.updateOne({ tenantId: tenantOf(req)._id, disciplineId, teacherProfileId: profileId }, { $set: { active: true, assignedBy: profileOf(req)._id } }, { upsert: true })));
  res.status(201).json({ ok: true });
});
academicRouter.get('/admin/teachers', async (req, res) => {
  if (!await requireAcademicAdmin(req, res)) return;
  const roles = await AcademicRole.find({ tenantId: tenantOf(req)._id, role: 'TEACHER', status: 'active' }).select('profileId').lean(); const profiles = await profilesFor(roles.map((r) => r.profileId), tenantOf(req)._id);
  const invites = await AcademicInvite.find({ tenantId: tenantOf(req)._id, status: 'pending' }).sort({ createdAt: -1 }).lean();
  res.json({ teachers: profiles.map((p) => ({ id: p._id.toString(), name: p.displayName, username: p.username })), invites: invites.map((i) => ({ id: i._id.toString(), email: i.email, name: i.name })) });
});
academicRouter.delete('/admin/teachers/:profileId', async (req, res) => {
  if (!await requireAcademicAdmin(req, res)) return;
  if (!oid(req.params.profileId)) return fail(res, 400, 'Perfil inválido.');
  await AcademicRole.updateOne({ tenantId: tenantOf(req)._id, profileId: req.params.profileId, role: 'TEACHER' }, { $set: { status: 'inactive', revokedAt: new Date() } });
  await AcademicRole.updateOne({ tenantId: tenantOf(req)._id, profileId: req.params.profileId, role: 'STUDENT' }, { $set: { status: 'active', grantedBy: profileOf(req)._id, grantedAt: new Date(), revokedAt: undefined } }, { upsert: true, runValidators: true });
  await AcademicDisciplineTeacher.updateMany({ tenantId: tenantOf(req)._id, teacherProfileId: req.params.profileId }, { $set: { active: false } }); res.status(204).end();
});
academicRouter.post('/admin/invites', async (req, res) => {
  if (!await requireAcademicAdmin(req, res)) return;
  const { email, name = '', message = '', disciplineIds = [] } = req.body ?? {}; if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !Array.isArray(disciplineIds) || disciplineIds.some((id: unknown) => !oid(id))) return fail(res, 400, 'Informe um e-mail válido e disciplinas válidas.');
  if (disciplineIds.length && await AcademicDiscipline.countDocuments({ tenantId: tenantOf(req)._id, _id: { $in: disciplineIds }, status: 'active' }) !== disciplineIds.length) return fail(res, 400, 'Uma ou mais disciplinas não pertencem a esta comunidade.');
  const invite = await AcademicInvite.create({ tenantId: tenantOf(req)._id, email: email.toLowerCase().trim(), name, message, disciplineIds, invitedBy: profileOf(req)._id }); res.status(201).json(invite);
});
academicRouter.get('/invites/mine', async (req, res) => {
  const invite = await AcademicInvite.findOne({ tenantId: tenantOf(req)._id, email: accountOf(req).email.toLowerCase(), status: 'pending' }).lean(); res.json(invite ? { id: invite._id.toString(), name: invite.name, message: invite.message } : null);
});
academicRouter.post('/invites/:id/accept', async (req, res) => {
  if (!oid(req.params.id)) return fail(res, 400, 'Convite inválido.');
  const invite = await AcademicInvite.findOne({ _id: req.params.id, tenantId: tenantOf(req)._id, email: accountOf(req).email.toLowerCase(), status: 'pending' }); if (!invite) return fail(res, 404, 'Convite pendente não encontrado para esta conta.');
  await AcademicRole.updateOne({ tenantId: tenantOf(req)._id, profileId: profileOf(req)._id, role: 'TEACHER' }, { $set: { status: 'active', grantedBy: invite.invitedBy, grantedAt: new Date(), revokedAt: undefined } }, { upsert: true, runValidators: true });
  for (const disciplineId of invite.disciplineIds) if (await AcademicDiscipline.exists({ _id: disciplineId, tenantId: tenantOf(req)._id, status: 'active' })) await AcademicDisciplineTeacher.updateOne({ tenantId: tenantOf(req)._id, disciplineId, teacherProfileId: profileOf(req)._id }, { $set: { active: true, assignedBy: invite.invitedBy } }, { upsert: true });
  invite.status = 'accepted'; invite.acceptedBy = profileOf(req)._id; invite.acceptedAt = new Date(); await invite.save(); res.json({ ok: true });
});
academicRouter.post('/admin/enrollments', async (req, res) => {
  if (!await requireAcademicAdmin(req, res)) return;
  const { disciplineId, profileId } = req.body ?? {}; if (!oid(disciplineId) || !oid(profileId)) return fail(res, 400, 'Disciplina e perfil inválidos.');
  if (!await AcademicDiscipline.exists({ _id: disciplineId, tenantId: tenantOf(req)._id, status: 'active' }) || !await communityCharacter(tenantOf(req)._id, profileId)) return fail(res, 404, 'Disciplina ou perfil não encontrado nesta comunidade.');
  await AcademicRole.updateOne({ tenantId: tenantOf(req)._id, profileId, role: 'STUDENT' }, { $set: { status: 'active', grantedBy: profileOf(req)._id, grantedAt: new Date(), revokedAt: undefined } }, { upsert: true, runValidators: true });
  const enrollment = await AcademicEnrollment.findOneAndUpdate({ tenantId: tenantOf(req)._id, disciplineId, studentProfileId: profileId }, { $set: { status: 'active', enrolledAt: new Date(), removedAt: undefined, createdBy: profileOf(req)._id } }, { upsert: true, new: true, runValidators: true }); res.status(201).json(enrollment);
});
academicRouter.delete('/enrollments/:disciplineId/leave', async (req, res) => {
  if (!oid(req.params.disciplineId)) return fail(res, 400, 'Disciplina inválida.');
  const enrollment = await AcademicEnrollment.findOne({ tenantId: tenantOf(req)._id, disciplineId: req.params.disciplineId, studentProfileId: profileOf(req)._id, status: 'active' });
  if (!enrollment) return fail(res, 404, 'Você não está matriculado(a) nesta disciplina.');
  enrollment.status = 'removed'; enrollment.removedAt = new Date(); await enrollment.save();
  res.status(204).end();
});
academicRouter.delete('/admin/enrollments/:disciplineId/:profileId', async (req, res) => {
  if (!await requireAcademicAdmin(req, res)) return;
  if (!oid(req.params.disciplineId) || !oid(req.params.profileId)) return fail(res, 400, 'Disciplina ou perfil inválido.');
  await AcademicEnrollment.updateOne({ tenantId: tenantOf(req)._id, disciplineId: req.params.disciplineId, studentProfileId: req.params.profileId, status: 'active' }, { $set: { status: 'removed', removedAt: new Date() } }); res.status(204).end();
});
