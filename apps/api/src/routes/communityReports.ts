import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { requireSession } from '../middleware/tenant.js';
import { CommunityContentReport, type CommunityReportTarget } from '../models/CommunityContentReport.js';
import { Character } from '../models/Social.js';
import { Conversation, ConversationMessage } from '../models/Conversation.js';
import { MatchProfile } from '../models/Match.js';
import { AcademicAssignment, AcademicContent, AcademicExam } from '../models/Academic.js';

export const communityReportsRouter = Router();
communityReportsRouter.use(requireSession);
const validId = (value: unknown): value is string => typeof value === 'string' && mongoose.isValidObjectId(value);
const models = { academic_content: AcademicContent, academic_assignment: AcademicAssignment, academic_exam: AcademicExam } as const;

communityReportsRouter.post('/', async (request: Request, response: Response) => {
  const tenantId = request.vybeTenant!._id;
  const reporter = request.vybeCharacter!._id;
  const { targetType, targetId, reason } = request.body ?? {};
  const allowed: CommunityReportTarget[] = ['direct_message', 'match_message', 'match_profile', 'profile', 'academic_content', 'academic_assignment', 'academic_exam'];
  if (!allowed.includes(targetType) || !validId(targetId) || typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500) { response.status(400).json({ error: 'Informe um motivo de 3 a 500 caracteres e um conteúdo válido.' }); return; }
  const id = new mongoose.Types.ObjectId(targetId);
  let targetProfileId: mongoose.Types.ObjectId | undefined;
  let snapshot = '';
  if (targetType === 'direct_message' || targetType === 'match_message') {
    const message = await ConversationMessage.findOne({ _id: id, tenantId }).select('conversationId senderProfileId content messageType attachment deletedAt').lean();
    if (!message) { response.status(404).json({ error: 'Mensagem não encontrada nesta comunidade.' }); return; }
    const conversation = await Conversation.findOne({ _id: message.conversationId, tenantId }).select('kind matchId participants').lean();
    const isMatch = Boolean(conversation?.matchId);
    if (!conversation || (targetType === 'match_message') !== isMatch || !conversation.participants.some((p) => p.profileId.equals(reporter) && !p.leftAt)) { response.status(403).json({ error: 'Você não pode denunciar esta mensagem.' }); return; }
    if (message.senderProfileId.equals(reporter)) { response.status(400).json({ error: 'Você não pode denunciar sua própria mensagem.' }); return; }
    targetProfileId = message.senderProfileId; snapshot = message.deletedAt ? '[Mensagem removida]' : message.content || `[${message.messageType}]`;
  } else if (targetType === 'match_profile' || targetType === 'profile') {
    targetProfileId = id;
    if (id.equals(reporter) || !await Character.exists({ _id: id, tenantId }) || (targetType === 'match_profile' && !await MatchProfile.exists({ tenantId, characterId: id }))) { response.status(404).json({ error: 'Perfil não encontrado nesta comunidade.' }); return; }
    const character = await Character.findOne({ _id: id, tenantId }).select('displayName username bio').lean();
    snapshot = character ? `${character.displayName} (@${character.username})\n${character.bio}` : '';
  } else {
    const model: mongoose.Model<any> = models[targetType as keyof typeof models];
    const content = await model.findOne({ _id: id, tenantId }).select('title description content instructions').lean() as { title?: string; description?: string; content?: string; instructions?: string } | null;
    if (!content) { response.status(404).json({ error: 'Conteúdo não encontrado nesta comunidade.' }); return; }
    snapshot = `${content.title ?? ''}\n${content.description ?? content.content ?? content.instructions ?? ''}`.trim();
  }
  try {
    await CommunityContentReport.updateOne({ tenantId, reporterProfileId: reporter, targetType, targetId: id }, { $setOnInsert: { tenantId, reporterProfileId: reporter, targetType, targetId: id, targetProfileId, reason: reason.trim(), snapshot, status: 'open' } }, { upsert: true, runValidators: true });
  } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error; }
  response.status(201).json({ reported: true });
});
