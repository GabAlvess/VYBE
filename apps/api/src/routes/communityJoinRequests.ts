import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { Community } from '../models/Community.js';
import { CommunityAudit } from '../models/CommunityAudit.js';
import { CommunityJoinRequest, type CommunityJoinChangeField } from '../models/CommunityJoinRequest.js';
import { Account, Character, Notification } from '../models/Social.js';
import { VybeAccount } from '../models/VybeAccount.js';
import { VybeNotification } from '../models/VybeNotification.js';
import { isCommunityOwner, isPlatformAppCreator } from './communityAdminPolicy.js';
import { normalizeJoinUsername, normalizePhotoplayerName, validateJoinAge, validateJoinText, validateJoinUsername } from './communityJoinPolicy.js';

export const communityJoinRequestsRouter = Router();
const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads');
const changeFields = new Set<CommunityJoinChangeField>(['username', 'photoplayer', 'description']);
const account = (request: Request) => request.vybeAccount!;
const character = (request: Request) => request.vybeCharacter!;
const tenant = (request: Request) => request.vybeTenant!;
const fail = (response: Response, status: number, error: string) => response.status(status).json({ error });

async function savePhotoplayerImage(value: unknown, communitySlug: string) {
  if (typeof value !== 'string' || value.length > 7_000_000) throw new Error('Envie uma foto de até 5 MB.');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('A foto deve estar no formato JPG, PNG ou WEBP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 16 || bytes.length > 5 * 1024 * 1024) throw new Error('A foto deve ter até 5 MB.');
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
  const valid = extension === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : extension === 'jpg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new Error('O arquivo escolhido não corresponde a uma imagem válida.');
  const filename = `${randomBytes(16).toString('hex')}.${extension}`;
  await mkdir(resolve(uploadsDirectory, communitySlug), { recursive: true });
  await writeFile(resolve(uploadsDirectory, communitySlug, filename), bytes, { flag: 'wx', mode: 0o600 });
  return { filename, extension: extension as 'png' | 'jpg' | 'webp' };
}

function requestJson(row: InstanceType<typeof CommunityJoinRequest>, photoUrl: string) {
  return {
    id: row._id.toString(), communityId: row.communityId.toString(), communitySlug: row.communitySlug,
    characterName: row.characterName, requestedUsername: row.requestedUsername, characterAge: row.characterAge,
    photoplayerName: row.photoplayerName, photoplayerImageUrl: photoUrl, characterDescription: row.characterDescription,
    customAnswers: row.customAnswers, status: row.status, requestedChanges: row.requestedChanges,
    adminMessage: row.adminMessage, rejectionReason: row.rejectionReason,
    createdAt: row.createdAt, reviewedAt: row.reviewedAt,
  };
}

communityJoinRequestsRouter.get('/communities/:slug/join-info', async (request, response) => {
  const slug = String(request.params.slug);
  const community: any = await Community.findOne({ slug, status: 'active', type: 'public' }).select('name slug subdomain logoUrl coverUrl settings').lean();
  if (!community) { fail(response, 404, 'Comunidade não encontrada.'); return; }
  const identity = character(request);
  const [membership, joinRequest] = await Promise.all([
    Account.findOne({ tenantId: community._id, email: account(request).email, status: 'active' }).select('_id').lean(),
    CommunityJoinRequest.findOne({ communityId: community._id, sourceTenantId: tenant(request)._id, accountId: account(request)._id }),
  ]);
  const photoUrl = joinRequest ? `/api/community-join-requests/${joinRequest._id.toString()}/photo` : '';
  response.json({
    community: { id: community._id.toString(), name: community.name, slug: community.slug, subdomain: community.subdomain, logoUrl: community.logoUrl, coverUrl: community.coverUrl },
    account: { displayName: identity.displayName, username: identity.username, avatarUrl: identity.avatarUrl },
    minimumAge: community.settings.characters.minimumAge ?? 18,
    usernameMinLength: community.settings.characters.usernameMinLength,
    usernameMaxLength: community.settings.characters.usernameMaxLength,
    customQuestions: community.settings.characters.customFields ?? [],
    membershipStatus: membership ? 'MEMBER' : 'NONE',
    request: joinRequest ? requestJson(joinRequest, photoUrl) : null,
  });
});

communityJoinRequestsRouter.get('/communities/:slug/join-availability', async (request, response) => {
  const slug = String(request.params.slug);
  const community: any = await Community.findOne({ slug, status: 'active' }).select('_id settings').lean();
  if (!community) { fail(response, 404, 'Comunidade não encontrada.'); return; }
  const username = typeof request.query.username === 'string' ? normalizeJoinUsername(request.query.username) : '';
  const photoplayer = typeof request.query.photoplayer === 'string' ? normalizePhotoplayerName(request.query.photoplayer) : '';
  const currentCharacter = character(request);
  const ownRequestId: any = await CommunityJoinRequest.findOne({ communityId: community._id, sourceTenantId: tenant(request)._id, accountId: account(request)._id, status: { $in: ['PENDING', 'NEEDS_INFORMATION'] } }).select('_id').lean();
  const [usernameUsed, photoplayerUsed] = await Promise.all([
    username ? Character.exists({ tenantId: community._id, username, _id: { $ne: currentCharacter._id } }) : false,
    photoplayer ? Character.exists({ tenantId: community._id, normalizedPhotoplayerName: photoplayer }) : false,
  ]);
  const [usernameRequested, photoplayerRequested] = await Promise.all([
    username ? CommunityJoinRequest.exists({ communityId: community._id, normalizedUsername: username, status: { $in: ['PENDING', 'NEEDS_INFORMATION'] }, ...(ownRequestId ? { _id: { $ne: ownRequestId._id } } : {}) }) : false,
    photoplayer ? CommunityJoinRequest.exists({ communityId: community._id, normalizedPhotoplayerName: photoplayer, status: { $in: ['PENDING', 'NEEDS_INFORMATION'] }, ...(ownRequestId ? { _id: { $ne: ownRequestId._id } } : {}) }) : false,
  ]);
  response.json({ usernameAvailable: username ? !usernameUsed && !usernameRequested : null, photoplayerAvailable: photoplayer ? !photoplayerUsed && !photoplayerRequested : null });
});

communityJoinRequestsRouter.post('/communities/:slug/join-requests', async (request, response) => {
  const slug = String(request.params.slug);
  const community: any = await Community.findOne({ slug, status: 'active', type: 'public' });
  if (!community) { fail(response, 404, 'Comunidade não encontrada.'); return; }
  const body = request.body ?? {};
  const fields: Array<{ key: string; label: string; required: boolean }> = community.settings.characters.customFields ?? [];
  const answersValue = body.customAnswers ?? {};
  if (!answersValue || typeof answersValue !== 'object' || Array.isArray(answersValue)) { fail(response, 400, 'Confira as respostas adicionais.'); return; }
  const allowed = new Set(fields.map((field) => field.key));
  if (Object.keys(answersValue).some((key) => !allowed.has(key))) { fail(response, 400, 'As perguntas da comunidade mudaram. Atualize a página e tente novamente.'); return; }
  const customAnswers: Array<{ key: string; label: string; value: string }> = [];
  for (const field of fields) {
    const raw = (answersValue as Record<string, unknown>)[field.key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (field.required && !value) { fail(response, 400, `Preencha “${field.label}”.`); return; }
    if (value.length > 500) { fail(response, 400, `A resposta para “${field.label}” deve ter no máximo 500 caracteres.`); return; }
    if (value) customAnswers.push({ key: field.key, label: field.label, value });
  }
  const characterName = typeof body.characterName === 'string' ? body.characterName.trim() : '';
  const username = normalizeJoinUsername(body.username ?? '');
  const age = body.age;
  const photoplayerName = typeof body.photoplayerName === 'string' ? body.photoplayerName.trim().replace(/\s+/g, ' ') : '';
  const normalizedPhotoplayerName = normalizePhotoplayerName(photoplayerName);
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!validateJoinText(characterName, 2, 60)) { fail(response, 400, 'Informe o nome do personagem (de 2 a 60 caracteres).'); return; }
  if (!validateJoinUsername(username, community.settings.characters.usernameMinLength, community.settings.characters.usernameMaxLength)) { fail(response, 400, `O nome de usuário deve ter de ${community.settings.characters.usernameMinLength} a ${community.settings.characters.usernameMaxLength} caracteres: letras, números, ponto ou sublinhado.`); return; }
  if (!validateJoinAge(age, community.settings.characters.minimumAge ?? 18)) { fail(response, 400, `Seu personagem não atende à idade mínima de ${community.settings.characters.minimumAge ?? 18} anos desta comunidade.`); return; }
  if (!validateJoinText(photoplayerName, 2, 100)) { fail(response, 400, 'Informe o nome do photoplayer.'); return; }
  if (!validateJoinText(description, 10, 1000)) { fail(response, 400, 'Conte um pouco sobre seu personagem (de 10 a 1.000 caracteres).'); return; }
  if (body.confirmed !== true) { fail(response, 400, 'Confirme que as informações estão corretas e respeitam as regras da comunidade.'); return; }
  const requester = account(request);
  if (await Account.exists({ tenantId: community._id, email: requester.email, status: 'active' })) { fail(response, 409, 'Você já faz parte desta comunidade.'); return; }
  const oldRequest: any = await CommunityJoinRequest.findOne({ communityId: community._id, sourceTenantId: tenant(request)._id, accountId: requester._id });
  if (oldRequest?.status === 'PENDING' || oldRequest?.status === 'APPROVED') { fail(response, 409, oldRequest.status === 'PENDING' ? 'Sua solicitação já está aguardando análise.' : 'Sua entrada nesta comunidade já foi aprovada.'); return; }
  const imageData = typeof body.photoplayerImage === 'string' ? body.photoplayerImage : '';
  if (await Character.exists({ tenantId: community._id, username, _id: { $ne: character(request)._id } })) { fail(response, 409, 'Este nome de usuário já está sendo utilizado nesta comunidade.'); return; }
  if (await Character.exists({ tenantId: community._id, normalizedPhotoplayerName })) { fail(response, 409, 'Este photoplayer já está sendo utilizado nesta comunidade.'); return; }
  const [duplicateUsername, duplicatePhotoplayer] = await Promise.all([
    CommunityJoinRequest.exists({ communityId: community._id, normalizedUsername: username, status: { $in: ['PENDING', 'NEEDS_INFORMATION'] }, ...(oldRequest ? { _id: { $ne: oldRequest._id } } : {}) }),
    CommunityJoinRequest.exists({ communityId: community._id, normalizedPhotoplayerName, status: { $in: ['PENDING', 'NEEDS_INFORMATION'] }, ...(oldRequest ? { _id: { $ne: oldRequest._id } } : {}) }),
  ]);
  if (duplicateUsername) { fail(response, 409, 'Este nome de usuário está em outra solicitação de entrada.'); return; }
  if (duplicatePhotoplayer) { fail(response, 409, 'Este photoplayer está em outra solicitação de entrada.'); return; }
  let image: { filename: string; extension: 'png' | 'jpg' | 'webp' };
  if (imageData) {
    try { image = await savePhotoplayerImage(imageData, community.slug); }
    catch (error) { fail(response, 400, error instanceof Error ? error.message : 'Não foi possível validar a foto.'); return; }
  } else if (oldRequest?.status === 'NEEDS_INFORMATION' && !oldRequest.requestedChanges.includes('photoplayer')) {
    image = { filename: oldRequest.photoplayerImageFilename, extension: oldRequest.photoplayerImageExtension };
  } else { fail(response, 400, 'Envie a foto do photoplayer.'); return; }
  const record = {
    communityId: community._id, communitySlug: community.slug,
    sourceTenantId: tenant(request)._id, accountId: requester._id, sourceCharacterId: character(request)._id,
    characterName, requestedUsername: username, normalizedUsername: username, characterAge: age,
    photoplayerName, normalizedPhotoplayerName,
    photoplayerImageFilename: image.filename, photoplayerImageExtension: image.extension,
    characterDescription: description, customAnswers,
    status: 'PENDING' as const, requestedChanges: [], adminMessage: '', rejectionReason: '',
    reviewedAt: undefined, reviewedBy: undefined,
  };
  const joinRequest = oldRequest ? Object.assign(oldRequest, record) : new CommunityJoinRequest(record);
  await joinRequest.save();
  response.status(201).json(requestJson(joinRequest, `/api/community-join-requests/${joinRequest._id.toString()}/photo`));
});

communityJoinRequestsRouter.get('/my/community-join-requests', async (request, response) => {
  const rows = await CommunityJoinRequest.find({ sourceTenantId: tenant(request)._id, accountId: account(request)._id }).sort({ updatedAt: -1 }).limit(50).lean();
  response.json(rows.map((row) => ({ ...row, id: String(row._id), communityId: String(row.communityId), photoUrl: `/api/community-join-requests/${String(row._id)}/photo` })));
});

communityJoinRequestsRouter.get('/community-join-requests/:id/photo', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.id)) { response.status(404).end(); return; }
  const row: any = await CommunityJoinRequest.findOne({ _id: String(request.params.id), sourceTenantId: tenant(request)._id, accountId: account(request)._id }).select('communityId photoplayerImageFilename').lean();
  if (!row || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(row.photoplayerImageFilename)) { response.status(404).end(); return; }
  const community: any = await Community.findById(row.communityId).select('slug').lean();
  if (!community || !/^[a-z0-9-]+$/.test(community.slug)) { response.status(404).end(); return; }
  response.sendFile(row.photoplayerImageFilename, { root: resolve(uploadsDirectory, community.slug) }, (error) => { if (error && !response.headersSent) response.status(404).end(); });
});

communityJoinRequestsRouter.get('/settings/community/join-requests', async (request, response) => {
  const current = tenant(request);
  const user = account(request);
  const canReview = isCommunityOwner(current, user) || current.admins.some((id) => id.equals(user._id)) || isPlatformAppCreator(user);
  if (!canReview) { fail(response, 403, 'Somente a equipe autorizada pode revisar pedidos de entrada.'); return; }
  const rows = await CommunityJoinRequest.find({ communityId: current._id, status: { $in: ['PENDING', 'NEEDS_INFORMATION'] } }).sort({ createdAt: 1 }).lean();
  const legacyRows = rows.filter((row) => row.sourceTenantId && row.sourceCharacterId);
  const sourceTenantIds = [...new Set(legacyRows.map((row) => row.sourceTenantId!.toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const requesterIds = legacyRows.map((row) => row.sourceCharacterId!);
  const [requesters, globalRequesters] = await Promise.all([
    Character.find({ _id: { $in: requesterIds }, tenantId: { $in: sourceTenantIds } }).select('tenantId displayName username avatarUrl').lean(),
    VybeAccount.find({ _id: { $in: rows.map((row) => row.vybeAccountId).filter(Boolean) } }).select('displayName username avatarUrl').lean(),
  ]);
  const requestersByKey = new Map(requesters.map((person) => [`${person.tenantId}:${person._id}`, person]));
  response.json(rows.map((row) => {
    const person = row.vybeAccountId ? globalRequesters.find((item) => String(item._id) === String(row.vybeAccountId)) : requestersByKey.get(`${row.sourceTenantId}:${row.sourceCharacterId}`);
    return { ...requestJson(row as unknown as InstanceType<typeof CommunityJoinRequest>, `/api/settings/community/join-requests/${String(row._id)}/photo`), id: String(row._id), requester: person ? { ...person, id: String(person._id) } : null };
  }));
});

communityJoinRequestsRouter.get('/settings/community/join-requests/:id/photo', async (request, response) => {
  const current = tenant(request);
  const user = account(request);
  const canReview = isCommunityOwner(current, user) || current.admins.some((id) => id.equals(user._id)) || isPlatformAppCreator(user);
  if (!canReview || !mongoose.isValidObjectId(request.params.id)) { response.status(404).end(); return; }
  const row: any = await CommunityJoinRequest.findOne({ _id: String(request.params.id), communityId: current._id }).select('communitySlug photoplayerImageFilename').lean();
  if (!row || row.communitySlug !== current.slug || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(row.photoplayerImageFilename)) { response.status(404).end(); return; }
  response.sendFile(row.photoplayerImageFilename, { root: resolve(uploadsDirectory, current.slug) }, (error) => { if (error && !response.headersSent) response.status(404).end(); });
});

communityJoinRequestsRouter.post('/settings/community/join-requests/:id/review', async (request, response) => {
  const current = tenant(request);
  const reviewer = account(request);
  const canReview = isCommunityOwner(current, reviewer) || current.admins.some((id) => id.equals(reviewer._id)) || isPlatformAppCreator(reviewer);
  if (!canReview) { fail(response, 403, 'Somente a equipe autorizada pode revisar pedidos de entrada.'); return; }
  if (!mongoose.isValidObjectId(request.params.id)) { fail(response, 404, 'Solicitação não encontrada.'); return; }
  const joinRequest = await CommunityJoinRequest.findOne({ _id: request.params.id, communityId: current._id, status: { $in: ['PENDING', 'NEEDS_INFORMATION'] } });
  if (!joinRequest) { fail(response, 404, 'Solicitação pendente não encontrada nesta comunidade.'); return; }
  const decision = request.body?.decision;
  const message = typeof request.body?.message === 'string' ? request.body.message.trim() : '';
  if (decision === 'request_changes') {
    const requestedChanges = Array.isArray(request.body?.fields) ? request.body.fields.filter((field: unknown): field is CommunityJoinChangeField => typeof field === 'string' && changeFields.has(field as CommunityJoinChangeField)) : [];
    if (!requestedChanges.length || new Set(requestedChanges).size !== requestedChanges.length || message.length < 3 || message.length > 1000) { fail(response, 400, 'Selecione os campos que precisam de ajuste e escreva uma orientação.'); return; }
    joinRequest.status = 'NEEDS_INFORMATION'; joinRequest.requestedChanges = requestedChanges; joinRequest.adminMessage = message; joinRequest.rejectionReason = ''; joinRequest.reviewedBy = reviewer._id; joinRequest.reviewedAt = new Date();
  } else if (decision === 'reject') {
    if (message.length < 3 || message.length > 1000) { fail(response, 400, 'Informe o motivo da recusa.'); return; }
    joinRequest.status = 'REJECTED'; joinRequest.rejectionReason = message; joinRequest.adminMessage = ''; joinRequest.requestedChanges = []; joinRequest.reviewedBy = reviewer._id; joinRequest.reviewedAt = new Date();
  } else if (decision === 'approve') {
    const minimumAge = current.settings.characters.minimumAge ?? 18;
    const username = joinRequest.normalizedUsername;
    const photoplayerName = joinRequest.normalizedPhotoplayerName;
    const usernameLength = username.length;
    const usernameValid = validateJoinUsername(username, current.settings.characters.usernameMinLength, current.settings.characters.usernameMaxLength);
    const sameTenantApplicant = !joinRequest.vybeAccountId && Boolean(joinRequest.sourceTenantId?.equals(current._id));
    const applicantCharacterFilter = sameTenantApplicant ? { _id: { $ne: joinRequest.sourceCharacterId } } : {};
    if (!usernameValid || usernameLength < current.settings.characters.usernameMinLength || await Character.exists({ tenantId: current._id, username, ...applicantCharacterFilter })) {
      joinRequest.status = 'NEEDS_INFORMATION'; joinRequest.requestedChanges = ['username']; joinRequest.adminMessage = 'Este nome de usuário já está sendo utilizado ou deixou de atender às regras da comunidade. Escolha outro.'; joinRequest.reviewedBy = reviewer._id; joinRequest.reviewedAt = new Date(); await joinRequest.save();
      fail(response, 409, joinRequest.adminMessage); return;
    }
    if (!validateJoinAge(joinRequest.characterAge, minimumAge)) {
      joinRequest.status = 'NEEDS_INFORMATION'; joinRequest.requestedChanges = []; joinRequest.adminMessage = `A idade mínima da comunidade foi atualizada para ${minimumAge} anos. Revise a ficha.`; joinRequest.reviewedBy = reviewer._id; joinRequest.reviewedAt = new Date(); await joinRequest.save();
      fail(response, 409, joinRequest.adminMessage); return;
    }
    if (await Character.exists({ tenantId: current._id, normalizedPhotoplayerName: photoplayerName })) {
      joinRequest.status = 'NEEDS_INFORMATION'; joinRequest.requestedChanges = ['photoplayer']; joinRequest.adminMessage = 'Este photoplayer passou a ser utilizado por outro membro. Escolha uma nova referência visual para continuar.'; joinRequest.reviewedBy = reviewer._id; joinRequest.reviewedAt = new Date(); await joinRequest.save();
      fail(response, 409, joinRequest.adminMessage); return;
    }
    const globalSource: any = joinRequest.vybeAccountId ? await VybeAccount.findOne({ _id: joinRequest.vybeAccountId, status: 'active' }).lean() : null;
    const legacySource = !joinRequest.vybeAccountId && joinRequest.sourceTenantId ? await Account.findOne({ _id: joinRequest.accountId, tenantId: joinRequest.sourceTenantId, status: 'active' }).lean() : null;
    const source: any = globalSource ?? legacySource;
    if (!source) { fail(response, 404, 'A conta solicitante não está mais disponível.'); return; }
    const existingTargetAccount = await Account.findOne({ tenantId: current._id, email: source.email.toLowerCase() }).select('_id status').lean();
    if (existingTargetAccount) { fail(response, 409, 'Esta pessoa já possui uma conta nesta comunidade.'); return; }
    let createdAccount: mongoose.Types.ObjectId | undefined;
    let createdCharacter: mongoose.Types.ObjectId | undefined;
    let memberCountIncremented = false;
    try {
      const imageUrl = `/media/${current.slug}/${joinRequest.photoplayerImageFilename}`;
      const newAccount = await Account.create({ tenantId: current._id, ...(globalSource ? { globalAccountId: globalSource._id } : {}), email: source.email, passwordHash: globalSource ? randomBytes(64).toString('hex') : source.passwordHash, status: 'active', termsAcceptedAt: source.termsAcceptedAt, termsVersion: source.termsVersion, privacyAcceptedAt: source.privacyAcceptedAt, privacyVersion: source.privacyVersion });
      createdAccount = newAccount._id;
      const newCharacter = await Character.create({ tenantId: current._id, accountId: newAccount._id, username, displayName: joinRequest.characterName, age: joinRequest.characterAge, photoplayerName: joinRequest.photoplayerName, normalizedPhotoplayerName: photoplayerName, photoplayerImageUrl: imageUrl, avatarUrl: imageUrl, bio: joinRequest.characterDescription });
      createdCharacter = newCharacter._id;
      current.memberCount += 1;
      await current.save();
      memberCountIncremented = true;
      joinRequest.status = 'APPROVED'; joinRequest.requestedChanges = []; joinRequest.adminMessage = ''; joinRequest.rejectionReason = ''; joinRequest.reviewedBy = reviewer._id; joinRequest.reviewedAt = new Date();
      await joinRequest.save();
    } catch (error) {
      if (createdCharacter) await Character.deleteOne({ _id: createdCharacter, tenantId: current._id });
      if (memberCountIncremented) { current.memberCount = Math.max(0, current.memberCount - 1); await current.save(); }
      if (createdAccount) await Account.deleteOne({ _id: createdAccount, tenantId: current._id });
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
        joinRequest.status = 'NEEDS_INFORMATION'; joinRequest.requestedChanges = ['username', 'photoplayer']; joinRequest.adminMessage = 'O username ou photoplayer foi reservado por outra pessoa enquanto esta solicitação aguardava análise. Atualize a ficha para continuar.'; joinRequest.reviewedBy = reviewer._id; joinRequest.reviewedAt = new Date(); await joinRequest.save();
        fail(response, 409, joinRequest.adminMessage); return;
      }
      throw error;
    }
  } else { fail(response, 400, 'Escolha aprovar, solicitar alteração ou recusar.'); return; }
  await joinRequest.save();
  await CommunityAudit.create({ tenantId: current._id, actorId: reviewer._id, action: `community.join.${decision}`, details: { joinRequestId: joinRequest._id.toString(), requesterAccountId: joinRequest.accountId.toString(), ...(decision === 'request_changes' ? { fields: joinRequest.requestedChanges, message } : decision === 'reject' ? { reason: message } : {}) } });
  if (joinRequest.vybeAccountId) {
    await VybeNotification.create({ accountId: joinRequest.vybeAccountId, communityId: current._id, joinRequestId: joinRequest._id, type: 'community_join_update', status: joinRequest.status, message: joinRequest.status === 'NEEDS_INFORMATION' ? joinRequest.adminMessage : joinRequest.status === 'REJECTED' ? joinRequest.rejectionReason : '' }).catch(() => undefined);
  } else if (joinRequest.sourceTenantId && joinRequest.sourceCharacterId) {
    await Notification.create({ tenantId: joinRequest.sourceTenantId, characterId: joinRequest.sourceCharacterId, actorId: joinRequest.sourceCharacterId, targetId: joinRequest._id, type: 'community_join_update' }).catch(() => undefined);
  }
  response.json({ id: joinRequest._id.toString(), status: joinRequest.status });
});
