import { Router } from 'express';
import mongoose from 'mongoose';
import { requireSession } from '../middleware/tenant.js';
import { CareerApplication, CareerGrant, CareerJob, CareerListing, CareerProfile, MentorshipRequest } from '../models/Career.js';
import { Community } from '../models/Community.js';
import { Character } from '../models/Social.js';
import { Notification } from '../models/Social.js';

export const careerRouter = Router();
careerRouter.use(requireSession);
const tenant = (req: Parameters<typeof requireSession>[0]) => req.vybeTenant!._id;
const character = (req: Parameters<typeof requireSession>[0]) => req.vybeCharacter!._id;
async function isAdmin(req: Parameters<typeof requireSession>[0]) {
  const community = await Community.findById(tenant(req)).select('admins ownerAccountId');
  return Boolean(community?.admins.some((adminId: mongoose.Types.ObjectId) => adminId.equals(req.vybeAccount!._id)) || community?.ownerAccountId?.equals(req.vybeAccount!._id));
}
async function canRecruit(req: Parameters<typeof requireSession>[0]) {
  return await isAdmin(req) || Boolean(await CareerGrant.exists({ tenantId: tenant(req), characterId: character(req), role: { $in: ['RECRUITER', 'CAREER_ADMIN'] } }));
}
const id = (value: unknown) => typeof value === 'string' && mongoose.isValidObjectId(value);

careerRouter.get('/career', async (req, res) => {
  const communityId = tenant(req);
  const [profile, jobs, applications, listings, grant] = await Promise.all([
    CareerProfile.findOne({ tenantId: communityId, characterId: character(req) }).lean(),
    CareerJob.find({ tenantId: communityId, status: 'OPEN', deadline: { $gte: new Date() } }).sort({ createdAt: -1 }).limit(6).lean(),
    CareerApplication.find({ tenantId: communityId, characterId: character(req) }).populate('jobId').lean(),
    CareerListing.find({ tenantId: communityId, status: 'OPEN' }).lean(),
    CareerGrant.findOne({ tenantId: communityId, characterId: character(req) }).lean() as Promise<{ role?: string } | null>,
  ]);
  const community = await Community.findById(communityId).select('name coverUrl admins ownerAccountId');
  res.json({ profile, jobs, applications, listings, canRecruit: await canRecruit(req), role: (await isAdmin(req)) ? 'CAREER_ADMIN' : grant?.role ?? 'CAREER_MEMBER', community: community?.name ?? 'Comunidade', bannerUrl: community?.coverUrl ?? '' });
});

careerRouter.put('/career/profile', async (req, res) => {
  const fields = req.body ?? {};
  const strings = ['headline', 'summary', 'portfolioUrl', 'resumeFile'] as const;
  if (strings.some((key) => fields[key] !== undefined && typeof fields[key] !== 'string') || ['education', 'experience', 'skills', 'languages'].some((key) => fields[key] !== undefined && (!Array.isArray(fields[key]) || fields[key].some((item: unknown) => typeof item !== 'string' || item.length > 300)))) return res.status(400).json({ error: 'Confira os campos do perfil profissional.' });
  if (fields.resumeFile && !/^data:application\/pdf;base64,/.test(fields.resumeFile) && !/^\/media\/[\w-]+\/[a-f0-9]{32}\.pdf$/.test(fields.resumeFile)) return res.status(400).json({ error: 'O currículo deve ser um arquivo PDF válido.' });
  if (typeof fields.resumeFile === 'string' && fields.resumeFile.startsWith('data:')) {
    const payload = fields.resumeFile.match(/^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/)?.[1];
    if (!payload) return res.status(400).json({ error: 'O currículo deve ser um arquivo PDF válido.' });
    const bytes = Buffer.from(payload, 'base64');
    if (bytes.byteLength > 5 * 1024 * 1024) return res.status(400).json({ error: 'O currículo deve ter no máximo 5 MB.' });
    if (bytes.subarray(0, 5).toString() !== '%PDF-') return res.status(400).json({ error: 'O arquivo selecionado não é um PDF válido.' });
  }
  const profile = await CareerProfile.findOneAndUpdate({ tenantId: tenant(req), characterId: character(req) }, { $set: Object.fromEntries([...strings, 'education', 'experience', 'skills', 'languages'].filter((key) => fields[key] !== undefined).map((key) => [key, fields[key]])), $setOnInsert: { tenantId: tenant(req), characterId: character(req) } }, { upsert: true, new: true, runValidators: true });
  res.json(profile);
});

careerRouter.post('/career/jobs', async (req, res) => {
  if (!await canRecruit(req)) return res.status(403).json({ error: 'Apenas recrutadores autorizados podem criar vagas.' });
  const body = req.body ?? {};
  for (const field of ['title', 'organization', 'area', 'type', 'location', 'description', 'deadline']) if (typeof body[field] !== 'string' || !body[field].trim()) return res.status(400).json({ error: `Preencha ${field}.` });
  const job = await CareerJob.create({ ...body, tenantId: tenant(req), recruiterId: character(req), status: body.status === 'DRAFT' ? 'DRAFT' : 'OPEN' });
  if (job.status === 'OPEN') {
    const members = await Character.find({ tenantId: tenant(req), _id: { $ne: character(req) } }).select('_id').lean();
    if (members.length) await Notification.insertMany(members.map((member) => ({ tenantId: tenant(req), characterId: member._id, actorId: character(req), type: 'career_job', targetId: job._id })));
  }
  res.status(201).json(job);
});

careerRouter.put('/career/grants/:characterId', async (req, res) => {
  if (!await isAdmin(req) && !await CareerGrant.exists({ tenantId: tenant(req), characterId: character(req), role: 'CAREER_ADMIN' })) return res.status(403).json({ error: 'Apenas Career Admin pode conceder papéis de carreira.' });
  if (!id(req.params.characterId) || !['RECRUITER', 'CAREER_ADMIN', 'CAREER_MEMBER'].includes(req.body?.role)) return res.status(400).json({ error: 'Pessoa ou papel inválido.' });
  if (!await Character.exists({ _id: req.params.characterId, tenantId: tenant(req) })) return res.status(404).json({ error: 'Membro não encontrado nesta comunidade.' });
  if (req.body.role === 'CAREER_MEMBER') await CareerGrant.deleteOne({ tenantId: tenant(req), characterId: req.params.characterId });
  else await CareerGrant.findOneAndUpdate({ tenantId: tenant(req), characterId: req.params.characterId }, { $set: { role: req.body.role }, $setOnInsert: { tenantId: tenant(req), characterId: req.params.characterId } }, { upsert: true });
  res.json({ success: true });
});

careerRouter.post('/career/listings', async (req, res) => {
  if (!await isAdmin(req) && !await CareerGrant.exists({ tenantId: tenant(req), characterId: character(req), role: 'CAREER_ADMIN' })) return res.status(403).json({ error: 'Apenas Career Admin pode publicar programas e oportunidades.' });
  const { kind, title, description = '', area = '', characterId } = req.body ?? {};
  if (!['opportunity', 'mentor', 'notice'].includes(kind) || typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'Informe o tipo e o título.' });
  if (kind === 'mentor' && (!id(characterId) || !await Character.exists({ _id: characterId, tenantId: tenant(req) }))) return res.status(400).json({ error: 'O mentor deve ser membro desta comunidade.' });
  res.status(201).json(await CareerListing.create({ tenantId: tenant(req), kind, title: title.trim(), description: String(description).slice(0, 2000), area: String(area).slice(0, 80), characterId }));
});

careerRouter.patch('/career/jobs/:jobId', async (req, res) => {
  if (!id(req.params.jobId)) return res.status(400).json({ error: 'Vaga inválida.' });
  const job = await CareerJob.findOne({ _id: req.params.jobId, tenantId: tenant(req) });
  if (!job) return res.status(404).json({ error: 'Vaga não encontrada.' });
  if (!await canRecruit(req) || !(await isAdmin(req)) && !job.recruiterId.equals(character(req))) return res.status(403).json({ error: 'Você não pode gerenciar esta vaga.' });
  const allowed = ['title', 'organization', 'area', 'type', 'location', 'description', 'responsibilities', 'requirements', 'deadline', 'openings', 'status'];
  for (const key of allowed) if (req.body?.[key] !== undefined) (job as any)[key] = req.body[key];
  await job.save(); res.json(job);
});

careerRouter.post('/career/jobs/:jobId/apply', async (req, res) => {
  if (!id(req.params.jobId)) return res.status(400).json({ error: 'Vaga inválida.' });
  const job = await CareerJob.findOne({ _id: req.params.jobId, tenantId: tenant(req), status: 'OPEN', deadline: { $gte: new Date() } });
  if (!job) return res.status(404).json({ error: 'Esta vaga não está recebendo candidaturas.' });
  const profile = await CareerProfile.findOne({ tenantId: tenant(req), characterId: character(req) });
  if (!profile || !profile.headline || !profile.summary || !profile.education.length || !profile.skills.length) return res.status(400).json({ error: 'Complete seu perfil profissional antes de se candidatar.' });
  try { const application = await CareerApplication.create({ tenantId: tenant(req), jobId: job._id, characterId: character(req), profileId: profile._id, history: [{ status: 'SUBMITTED', changedBy: character(req), changedAt: new Date() }] }); res.status(201).json(application); }
  catch (error) { if ((error as { code?: number }).code === 11000) return res.status(409).json({ error: 'Você já se candidatou a esta vaga.' }); throw error; }
});

careerRouter.get('/career/jobs/:jobId/candidates', async (req, res) => {
  if (!id(req.params.jobId)) return res.status(400).json({ error: 'Vaga inválida.' });
  const job = await CareerJob.findOne({ _id: req.params.jobId, tenantId: tenant(req) });
  if (!job) return res.status(404).json({ error: 'Vaga não encontrada.' });
  if (!await canRecruit(req) || !(await isAdmin(req)) && !job.recruiterId.equals(character(req))) return res.status(403).json({ error: 'Você não pode acessar os candidatos desta vaga.' });
  const candidates = await CareerApplication.find({ tenantId: tenant(req), jobId: job._id }).populate('profileId').lean();
  const people = await Character.find({ tenantId: tenant(req), _id: { $in: candidates.map((item) => item.characterId) } }).select('username displayName avatarUrl').lean();
  res.json(candidates.map((app) => ({ ...app, candidate: people.find((person) => person._id.equals(app.characterId)) })));
});

careerRouter.patch('/career/applications/:applicationId', async (req, res) => {
  if (!id(req.params.applicationId)) return res.status(400).json({ error: 'Candidatura inválida.' });
  const application = await CareerApplication.findOne({ _id: req.params.applicationId, tenantId: tenant(req) });
  if (!application) return res.status(404).json({ error: 'Candidatura não encontrada.' });
  const status = req.body?.status;
  if (character(req).equals(application.characterId)) {
    if (status !== 'WITHDRAWN' || !['SUBMITTED', 'UNDER_REVIEW'].includes(application.status)) return res.status(403).json({ error: 'Esta candidatura não pode ser retirada.' });
  } else {
    const job = await CareerJob.findOne({ _id: application.jobId, tenantId: tenant(req) });
    if (!job || !await canRecruit(req) || !(await isAdmin(req)) && !job.recruiterId.equals(character(req))) return res.status(403).json({ error: 'Você não pode atualizar esta candidatura.' });
    if (!['UNDER_REVIEW', 'INTERVIEW', 'APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  }
  application.history.push({ status, changedBy: character(req), changedAt: new Date(), message: typeof req.body?.message === 'string' ? req.body.message.slice(0, 1000) : '' } as never);
  application.status = status; await application.save();
  if (!character(req).equals(application.characterId)) await Notification.create({ tenantId: tenant(req), characterId: application.characterId, actorId: character(req), type: 'career_status', targetId: application._id });
  res.json(application);
});

careerRouter.get('/career/applications', async (req, res) => res.json(await CareerApplication.find({ tenantId: tenant(req), characterId: character(req) }).populate('jobId').sort({ createdAt: -1 }).lean()));
careerRouter.post('/career/mentorship', async (req, res) => {
  if (!id(req.body?.mentorId)) return res.status(400).json({ error: 'Escolha um mentor disponível.' });
  const mentor = await CareerListing.exists({ tenantId: tenant(req), _id: req.body.mentorId, kind: 'mentor', status: 'OPEN' });
  if (!mentor) return res.status(404).json({ error: 'Mentor não encontrado nesta comunidade.' });
  res.status(201).json(await MentorshipRequest.create({ tenantId: tenant(req), mentorId: req.body.mentorId, characterId: character(req), message: String(req.body.message ?? '').slice(0, 1000) }));
});
