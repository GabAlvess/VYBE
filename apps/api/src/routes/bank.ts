import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { CommunityAudit } from '../models/CommunityAudit.js';
import { Account, Character, Notification } from '../models/Social.js';
import { Wallet, WalletTransaction, type WalletDocument, type WalletTransactionDocument } from '../models/Wallet.js';
import { tenantScope } from '../middleware/tenant.js';
import { bulkCreditTransactionKey, canSpend, isValidCents, transactionDirection } from './bankPolicy.js';

export const bankRouter = Router();
const tenant = (request: Request) => request.vybeTenant!;
const account = (request: Request) => request.vybeAccount!;
const profile = (request: Request) => request.vybeCharacter!;
const bad = (response: Response, message: string, status = 400) => response.status(status).json({ error: message });
const reference = () => `TRX${randomBytes(5).toString('hex').toUpperCase()}`;
const startOfMonth = () => { const value = new Date(); value.setDate(1); value.setHours(0, 0, 0, 0); return value; };

bankRouter.use((request, response, next) => {
  if (tenant(request).settings?.features?.bank === false) { bad(response, 'O Banco não está disponível nesta comunidade.', 404); return; }
  next();
});

async function getWallet(characterId: mongoose.Types.ObjectId, tenantId: mongoose.Types.ObjectId) {
  try {
    return await Wallet.findOneAndUpdate(
      { tenantId, characterId },
      { $setOnInsert: { tenantId, characterId, balanceCents: 0, limitCents: null, cardLast4: String(randomBytes(2).readUInt16BE() % 10_000).padStart(4, '0') } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return Wallet.findOne({ tenantId, characterId });
    throw error;
  }
}

async function monthlyUsed(walletId: mongoose.Types.ObjectId, tenantId: mongoose.Types.ObjectId, session?: mongoose.ClientSession) {
  const aggregate = WalletTransaction.aggregate<{ total: number }>([
    { $match: { tenantId, senderWalletId: walletId, type: 'TRANSFER', createdAt: { $gte: startOfMonth() } } },
    { $group: { _id: null, total: { $sum: '$amountCents' } } },
  ]);
  if (session) aggregate.session(session);
  const [result] = await aggregate;
  return result?.total ?? 0;
}

function walletJson(wallet: WalletDocument, usedCents: number) {
  return { id: wallet._id.toString(), balanceCents: wallet.balanceCents, limitCents: wallet.limitCents, monthlyUsedCents: usedCents, monthlyAvailableCents: wallet.limitCents === null ? null : Math.max(0, wallet.limitCents - usedCents), cardLast4: wallet.cardLast4 };
}

function adminAllowed(request: Request) {
  const community = tenant(request);
  const user = account(request);
  return community.ownerAccountId?.equals(user._id)
    || community.ownerEmail?.toLowerCase() === user.email.toLowerCase()
    || community.admins.some((id) => id.equals(user._id));
}

// Shared internal query serializer with an explicit tenant (never inferred from a transaction).
async function serializeTransactions(items: WalletTransactionDocument[], walletId: mongoose.Types.ObjectId, tenantId: mongoose.Types.ObjectId) {
  const walletIds = [...new Set(items.flatMap((item) => [item.senderWalletId?.toString(), item.recipientWalletId?.toString()].filter((value): value is string => Boolean(value))))];
  const wallets = await Wallet.find({ _id: { $in: walletIds }, tenantId }).select('_id characterId').lean();
  const characterByWallet = new Map(wallets.map((item) => [(item._id as mongoose.Types.ObjectId).toString(), item.characterId.toString()]));
  const characterIds = [...new Set(characterByWallet.values())];
  const characters = await Character.find({ tenantId, _id: { $in: characterIds } }).select('displayName username avatarUrl').lean();
  const characterMap = new Map(characters.map((item) => [item._id.toString(), item]));
  return items.map((item) => {
    const direction = transactionDirection(item, walletId.toString());
    const otherWalletId = direction === 'in' ? item.senderWalletId : item.recipientWalletId;
    const otherId = otherWalletId ? characterByWallet.get(otherWalletId.toString()) : undefined;
    const other = otherId ? characterMap.get(otherId) : undefined;
    return { id: item._id.toString(), reference: item.reference, type: item.type, direction, amountCents: item.amountCents, description: item.description, status: item.status, createdAt: item.createdAt, other: other ? { id: otherId, displayName: other.displayName, username: other.username, avatarUrl: other.avatarUrl } : null };
  });
}

bankRouter.get('/', async (request, response) => {
  const community = tenant(request);
  const wallet = await getWallet(profile(request)._id, community._id);
  if (!wallet) { bad(response, 'Não foi possível carregar sua carteira.', 500); return; }
  const used = await monthlyUsed(wallet._id, community._id);
  const items = await WalletTransaction.find(tenantScope(community._id, { $or: [{ senderWalletId: wallet._id }, { recipientWalletId: wallet._id }] })).sort({ createdAt: -1 }).limit(6);
  response.json({ community: { id: community._id.toString(), name: community.name, logoUrl: community.logoUrl, coverUrl: community.coverUrl }, profile: { id: profile(request)._id.toString(), displayName: profile(request).displayName, username: profile(request).username, avatarUrl: profile(request).avatarUrl }, wallet: walletJson(wallet, used), recent: await serializeTransactions(items, wallet._id, community._id), canManage: Boolean(adminAllowed(request)) });
});

bankRouter.get('/recipients', async (request, response) => {
  const query = typeof request.query.q === 'string' ? request.query.q.trim().replace(/^@/, '').slice(0, 60) : '';
  if (query.length < 2) { response.json([]); return; }
  const community = tenant(request);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const results = await Character.find({ tenantId: community._id, _id: { $ne: profile(request)._id }, $or: [{ username: new RegExp(`^${escaped}`, 'i') }, { displayName: new RegExp(escaped, 'i') }] }).select('displayName username avatarUrl').limit(8).lean();
  response.json(results.map((item) => ({ id: item._id.toString(), displayName: item.displayName, username: item.username, avatarUrl: item.avatarUrl })));
});

bankRouter.get('/transactions', async (request, response) => {
  const community = tenant(request);
  const wallet = await getWallet(profile(request)._id, community._id);
  if (!wallet) { bad(response, 'Carteira não encontrada.', 404); return; }
  const filter = request.query.filter === 'in' || request.query.filter === 'out' ? request.query.filter : 'all';
  const directionFilter = filter === 'in' ? { recipientWalletId: wallet._id } : filter === 'out' ? { senderWalletId: wallet._id } : { $or: [{ recipientWalletId: wallet._id }, { senderWalletId: wallet._id }] };
  const items = await WalletTransaction.find(tenantScope(community._id, directionFilter)).sort({ createdAt: -1 }).limit(100);
  response.json(await serializeTransactions(items, wallet._id, community._id));
});

bankRouter.get('/transactions/:id', async (request, response) => {
  const community = tenant(request);
  if (!mongoose.isValidObjectId(request.params.id)) { bad(response, 'Transação inválida.'); return; }
  const wallet = await getWallet(profile(request)._id, community._id);
  if (!wallet) { bad(response, 'Carteira não encontrada.', 404); return; }
  const item = await WalletTransaction.findOne(tenantScope(community._id, { _id: request.params.id, $or: [{ senderWalletId: wallet._id }, { recipientWalletId: wallet._id }] }));
  if (!item) { bad(response, 'Transação não encontrada nesta carteira.', 404); return; }
  response.json((await serializeTransactions([item], wallet._id, community._id))[0]);
});

bankRouter.post('/transfer', async (request, response) => {
  const community = tenant(request);
  const { recipientCharacterId, amountCents, description } = request.body ?? {};
  const idempotencyKey = request.get('Idempotency-Key') ?? request.body?.idempotencyKey;
  if (!mongoose.isValidObjectId(recipientCharacterId) || recipientCharacterId === profile(request)._id.toString()) { bad(response, 'Escolha um destinatário válido.'); return; }
  if (!isValidCents(amountCents) || amountCents > 100_000_000) { bad(response, 'Informe um valor válido em centavos.'); return; }
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) { bad(response, 'Não foi possível confirmar a solicitação. Tente novamente.'); return; }
  if (description !== undefined && (typeof description !== 'string' || description.trim().length > 160)) { bad(response, 'A descrição pode ter até 160 caracteres.'); return; }
  const recipient = await Character.findOne({ tenantId: community._id, _id: recipientCharacterId });
  if (!recipient) { bad(response, 'Destinatário não encontrado nesta comunidade.', 404); return; }
  const senderWallet = await getWallet(profile(request)._id, community._id);
  const recipientWallet = await getWallet(recipient._id, community._id);
  if (!senderWallet || !recipientWallet) { bad(response, 'Não foi possível carregar as carteiras.', 500); return; }
  const existing = await WalletTransaction.findOne({ tenantId: community._id, senderWalletId: senderWallet._id, idempotencyKey });
  if (existing) { response.json({ transaction: existing, duplicate: true }); return; }
  const usedCents = await monthlyUsed(senderWallet._id, community._id);
  const policy = canSpend(senderWallet.balanceCents, amountCents, usedCents, senderWallet.limitCents);
  if (!policy.allowed) { bad(response, policy.reason, 409); return; }
  const mongoSession = await mongoose.startSession();
  let committed: InstanceType<typeof WalletTransaction> | null = null;
  try {
    await mongoSession.withTransaction(async () => {
      const debit = await Wallet.updateOne({ _id: senderWallet._id, tenantId: community._id, balanceCents: { $gte: amountCents } }, { $inc: { balanceCents: -amountCents } }, { session: mongoSession });
      if (!debit.modifiedCount) throw new Error('Saldo insuficiente para realizar esta transferência.');
      if (senderWallet.limitCents !== null) {
        const freshUsed = await monthlyUsed(senderWallet._id, community._id, mongoSession);
        if (freshUsed + amountCents > senderWallet.limitCents) throw new Error('O limite mensal da sua carteira foi atingido.');
      }
      await Wallet.updateOne({ _id: recipientWallet._id, tenantId: community._id }, { $inc: { balanceCents: amountCents } }, { session: mongoSession });
      const [created] = await WalletTransaction.create([{ tenantId: community._id, type: 'TRANSFER', amountCents, senderWalletId: senderWallet._id, recipientWalletId: recipientWallet._id, actorAccountId: account(request)._id, description: typeof description === 'string' ? description.trim() : '', status: 'COMPLETED', idempotencyKey, reference: reference() }], { session: mongoSession });
      committed = created;
      await Notification.create([{ tenantId: community._id, characterId: recipient._id, actorId: profile(request)._id, type: 'bank_transfer_received', targetId: created._id }], { session: mongoSession });
    });
  } catch (error) {
    const duplicate = error && typeof error === 'object' && 'code' in error && error.code === 11000;
    const prior = duplicate ? await WalletTransaction.findOne({ tenantId: community._id, senderWalletId: senderWallet._id, idempotencyKey }) : null;
    if (prior) { response.json({ transaction: prior, duplicate: true }); return; }
    if (error instanceof Error && (error.message.includes('Saldo insuficiente') || error.message.includes('limite mensal'))) { bad(response, error.message, 409); return; }
    if (error instanceof Error && error.message.includes('Transaction numbers are only allowed')) { bad(response, 'O Banco requer MongoDB configurado com replica set para garantir transferências atômicas.', 503); return; }
    throw error;
  } finally { await mongoSession.endSession(); }
  if (!committed) { bad(response, 'Não foi possível concluir a transferência.', 500); return; }
  response.status(201).json({ transaction: committed, duplicate: false });
});

bankRouter.get('/admin/wallets', async (request, response) => {
  if (!adminAllowed(request)) { bad(response, 'Apenas administradores da comunidade podem acessar as carteiras.', 403); return; }
  const community = tenant(request);
  const q = typeof request.query.q === 'string' ? request.query.q.trim().replace(/^@/, '').slice(0, 60) : '';
  const chars = q ? await Character.find({ tenantId: community._id, $or: [{ username: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { displayName: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] }).select('_id displayName username avatarUrl').limit(50).lean() : await Character.find({ tenantId: community._id }).select('_id displayName username avatarUrl').limit(50).lean();
  const wallets = await Wallet.find({ tenantId: community._id, characterId: { $in: chars.map((item) => item._id) } }).lean();
  const walletMap = new Map(wallets.map((item) => [item.characterId.toString(), item]));
  response.json(chars.map((item) => { const wallet = walletMap.get(item._id.toString()); return { id: item._id.toString(), displayName: item.displayName, username: item.username, avatarUrl: item.avatarUrl, wallet: wallet ? { id: (wallet._id as mongoose.Types.ObjectId).toString(), balanceCents: wallet.balanceCents, limitCents: wallet.limitCents } : null }; }));
});

bankRouter.get('/admin/summary', async (request, response) => {
  if (!adminAllowed(request)) { bad(response, 'Apenas administradores da comunidade podem acessar as carteiras.', 403); return; }
  const community = tenant(request);
  const activeAccounts = await Account.find({ tenantId: community._id, status: 'active' }).select('_id').lean();
  const characters = await Character.find({ tenantId: community._id, accountId: { $in: activeAccounts.map((item) => item._id) } }).select('_id').lean();
  const memberCount = characters.length;
  const requestedWithdrawAmount = typeof request.query.withdrawAmountCents === 'string' ? Number(request.query.withdrawAmountCents) : null;
  if (requestedWithdrawAmount !== null && (!Number.isSafeInteger(requestedWithdrawAmount) || requestedWithdrawAmount <= 0)) { bad(response, 'Informe um valor de retirada válido.'); return; }
  const walletFilter = { tenantId: community._id, characterId: { $in: characters.map((item) => item._id) }, balanceCents: requestedWithdrawAmount === null ? { $gt: 0 } : { $gte: requestedWithdrawAmount } };
  const [withdrawal] = await Wallet.aggregate<{ memberCount: number; totalCents: number }>([
    { $match: walletFilter },
    { $group: { _id: null, memberCount: { $sum: 1 }, totalCents: { $sum: '$balanceCents' } } },
  ]);
  const withdrawMemberCount = requestedWithdrawAmount === null ? withdrawal?.memberCount ?? 0 : memberCount;
  const withdrawTotalCents = requestedWithdrawAmount === null ? withdrawal?.totalCents ?? 0 : requestedWithdrawAmount * memberCount;
  if (!Number.isSafeInteger(withdrawTotalCents)) { bad(response, 'O total do ajuste ultrapassa o limite seguro.'); return; }
  response.json({ memberCount, maxBulkMembers: 500, withdrawMemberCount, withdrawTotalCents });
});

bankRouter.post('/admin/credits/all', async (request, response) => {
  if (!adminAllowed(request)) { bad(response, 'Apenas administradores da comunidade podem creditar todas as carteiras.', 403); return; }
  const community = tenant(request);
  const { amountCents, reason } = request.body ?? {};
  const batchKey = request.get('Idempotency-Key') ?? request.body?.idempotencyKey;
  if (!isValidCents(amountCents) || amountCents > 100_000_000) { bad(response, 'Informe um valor válido em centavos para cada carteira.'); return; }
  if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 160) { bad(response, 'Informe um motivo entre 3 e 160 caracteres.'); return; }
  if (typeof batchKey !== 'string' || batchKey.length < 8 || batchKey.length > 100) { bad(response, 'Não foi possível confirmar este crédito em lote. Tente novamente.'); return; }
  const priorBatch = await CommunityAudit.findOne({ tenantId: community._id, action: 'bank.bulk_credit', 'details.idempotencyKey': batchKey });
  if (priorBatch) {
    if (!priorBatch.actorId.equals(account(request)._id) || priorBatch.details.amountCents !== amountCents || priorBatch.details.reason !== reason.trim()) { bad(response, 'Esta chave já foi usada em outro ajuste.', 409); return; }
    response.json({ duplicate: true, recipientCount: priorBatch.details.recipientCount, amountPerWalletCents: amountCents, totalCents: priorBatch.details.totalCents });
    return;
  }
  const activeAccounts = await Account.find({ tenantId: community._id, status: 'active' }).select('_id').lean();
  const characters = await Character.find({ tenantId: community._id, accountId: { $in: activeAccounts.map((item) => item._id) } }).select('_id accountId').lean();
  if (!characters.length) { bad(response, 'Não há membros ativos para receber o crédito.', 409); return; }
  if (characters.length > 500) { bad(response, 'O crédito atômico em lote suporta até 500 membros por operação.', 413); return; }
  const totalCents = amountCents * characters.length;
  if (!Number.isSafeInteger(totalCents)) { bad(response, 'O valor total do crédito excede o limite permitido.'); return; }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Wallet.bulkWrite(characters.map((character) => ({
        updateOne: {
          filter: { tenantId: community._id, characterId: character._id },
          update: { $setOnInsert: { tenantId: community._id, characterId: character._id, balanceCents: 0, limitCents: null, cardLast4: String(randomBytes(2).readUInt16BE() % 10_000).padStart(4, '0') } },
          upsert: true,
        },
      })), { session, ordered: true });
      const wallets = await Wallet.find({ tenantId: community._id, characterId: { $in: characters.map((item) => item._id) } }).session(session);
      if (wallets.length !== characters.length) throw new Error('Não foi possível carregar todas as carteiras do universo.');
      await Wallet.bulkWrite(wallets.map((wallet) => ({ updateOne: { filter: { _id: wallet._id, tenantId: community._id }, update: { $inc: { balanceCents: amountCents } } } })), { session, ordered: true });
      const transactions = wallets.map((wallet) => ({ tenantId: community._id, type: 'ADMIN_CREDIT' as const, amountCents, recipientWalletId: wallet._id, actorAccountId: account(request)._id, description: reason.trim(), status: 'COMPLETED' as const, idempotencyKey: bulkCreditTransactionKey(batchKey, wallet.characterId.toString()), reference: reference() }));
      const createdTransactions = await WalletTransaction.insertMany(transactions, { session, ordered: true });
      await Notification.insertMany(wallets.map((wallet, index) => ({ tenantId: community._id, characterId: wallet.characterId, actorId: profile(request)._id, type: 'bank_admin_credit_received', targetId: createdTransactions[index]._id })), { session, ordered: true });
      await CommunityAudit.create([{ tenantId: community._id, actorId: account(request)._id, action: 'bank.bulk_credit', details: { idempotencyKey: batchKey, amountCents, totalCents, recipientCount: wallets.length, reason: reason.trim() } }], { session });
    });
  } catch (error) {
    const duplicate = error && typeof error === 'object' && 'code' in error && error.code === 11000;
    const committedBatch = duplicate ? await CommunityAudit.findOne({ tenantId: community._id, action: 'bank.bulk_credit', 'details.idempotencyKey': batchKey }) : null;
    if (committedBatch?.actorId.equals(account(request)._id)) {
      response.json({ duplicate: true, recipientCount: committedBatch.details.recipientCount, amountPerWalletCents: committedBatch.details.amountCents, totalCents: committedBatch.details.totalCents });
      return;
    }
    if (error instanceof Error && error.message.includes('Transaction numbers are only allowed')) { bad(response, 'O crédito em lote requer MongoDB configurado com replica set para aplicar os valores a todos juntos.', 503); return; }
    throw error;
  } finally { await session.endSession(); }
  response.status(201).json({ duplicate: false, recipientCount: characters.length, amountPerWalletCents: amountCents, totalCents });
});

bankRouter.post('/admin/debits/all', async (request, response) => {
  if (!adminAllowed(request)) { bad(response, 'Apenas administradores da comunidade podem retirar saldo das carteiras.', 403); return; }
  const community = tenant(request);
  const { reason, mode = 'all', amountCents } = request.body ?? {};
  const batchKey = request.get('Idempotency-Key') ?? request.body?.idempotencyKey;
  if (!['all', 'fixed'].includes(mode) || (mode === 'fixed' && (!isValidCents(amountCents) || amountCents > 100_000_000))) { bad(response, 'Informe um modo e valor válidos para a retirada.'); return; }
  if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 160) { bad(response, 'Informe um motivo entre 3 e 160 caracteres.'); return; }
  if (typeof batchKey !== 'string' || batchKey.length < 8 || batchKey.length > 100) { bad(response, 'Não foi possível confirmar a retirada em lote. Tente novamente.'); return; }
  const priorBatch = await CommunityAudit.findOne({ tenantId: community._id, action: 'bank.bulk_debit', 'details.idempotencyKey': batchKey });
  if (priorBatch) {
    if (!priorBatch.actorId.equals(account(request)._id) || priorBatch.details.reason !== reason.trim() || priorBatch.details.mode !== mode || (mode === 'fixed' && priorBatch.details.amountCents !== amountCents)) { bad(response, 'Esta chave já foi usada em outro ajuste.', 409); return; }
    response.json({ duplicate: true, recipientCount: priorBatch.details.recipientCount, totalCents: priorBatch.details.totalCents });
    return;
  }
  const activeAccounts = await Account.find({ tenantId: community._id, status: 'active' }).select('_id').lean();
  const characters = await Character.find({ tenantId: community._id, accountId: { $in: activeAccounts.map((item) => item._id) } }).select('_id').lean();
  if (characters.length > 500) { bad(response, 'A retirada atômica em lote suporta até 500 membros por operação.', 413); return; }
  const session = await mongoose.startSession();
  let recipientCount = 0;
  let totalCents = 0;
  try {
    await session.withTransaction(async () => {
      if (mode === 'fixed') {
        await Wallet.bulkWrite(characters.map((character) => ({ updateOne: { filter: { tenantId: community._id, characterId: character._id }, update: { $setOnInsert: { tenantId: community._id, characterId: character._id, balanceCents: 0, limitCents: null, cardLast4: String(randomBytes(2).readUInt16BE() % 10_000).padStart(4, '0') } }, upsert: true } })), { session, ordered: true });
      }
      const allWallets = await Wallet.find({ tenantId: community._id, characterId: { $in: characters.map((item) => item._id) } }).session(session);
      const wallets = mode === 'all' ? allWallets.filter((wallet) => wallet.balanceCents > 0) : allWallets;
      recipientCount = wallets.length;
      totalCents = wallets.reduce((total, wallet) => total + (mode === 'all' ? wallet.balanceCents : amountCents), 0);
      if (!recipientCount || !Number.isSafeInteger(totalCents)) throw new Error('Não há saldo disponível para retirar.');
      const updates = await Wallet.bulkWrite(wallets.map((wallet) => { const debitCents = mode === 'all' ? wallet.balanceCents : amountCents; return { updateOne: { filter: { _id: wallet._id, tenantId: community._id, balanceCents: wallet.balanceCents }, update: { $inc: { balanceCents: -debitCents } } } }; }), { session, ordered: true });
      if (updates.modifiedCount !== wallets.length) throw new Error('Os saldos mudaram durante a operação. Tente revisar novamente.');
      await WalletTransaction.insertMany(wallets.map((wallet) => ({ tenantId: community._id, type: (mode === 'fixed' ? 'ADMIN_TAX' : 'ADMIN_DEBIT') as 'ADMIN_TAX' | 'ADMIN_DEBIT', amountCents: mode === 'all' ? wallet.balanceCents : amountCents, senderWalletId: wallet._id, actorAccountId: account(request)._id, description: reason.trim(), status: 'COMPLETED' as const, idempotencyKey: bulkCreditTransactionKey(batchKey, wallet.characterId.toString()), reference: reference() })), { session, ordered: true });
      await CommunityAudit.create([{ tenantId: community._id, actorId: account(request)._id, action: 'bank.bulk_debit', details: { idempotencyKey: batchKey, mode, amountCents: mode === 'fixed' ? amountCents : null, totalCents, recipientCount, reason: reason.trim() } }], { session });
    });
  } catch (error) {
    const duplicate = error && typeof error === 'object' && 'code' in error && error.code === 11000;
    const committedBatch = duplicate ? await CommunityAudit.findOne({ tenantId: community._id, action: 'bank.bulk_debit', 'details.idempotencyKey': batchKey }) : null;
    if (committedBatch?.actorId.equals(account(request)._id)) { response.json({ duplicate: true, recipientCount: committedBatch.details.recipientCount, totalCents: committedBatch.details.totalCents }); return; }
    if (error instanceof Error && error.message.includes('Não há saldo disponível')) { bad(response, error.message, 409); return; }
    if (error instanceof Error && error.message.includes('saldos mudaram')) { bad(response, error.message, 409); return; }
    if (error instanceof Error && error.message.includes('Transaction numbers are only allowed')) { bad(response, 'A retirada em lote requer MongoDB configurado com replica set para ajustar todas as carteiras juntas.', 503); return; }
    throw error;
  } finally { await session.endSession(); }
  response.status(201).json({ duplicate: false, recipientCount, totalCents });
});

bankRouter.get('/admin/audit', async (request, response) => {
  if (!adminAllowed(request)) { bad(response, 'Apenas administradores da comunidade podem consultar a auditoria do Banco.', 403); return; }
  const logs = await CommunityAudit.find({ tenantId: tenant(request)._id, action: /^bank\./ }).sort({ createdAt: -1 }).limit(100).lean();
  response.json(logs.map((item) => ({ id: String(item._id), action: item.action, details: item.details, createdAt: item.createdAt })));
});

bankRouter.patch('/admin/wallets/:characterId/limit', async (request, response) => {
  if (!adminAllowed(request)) { bad(response, 'Apenas administradores da comunidade podem alterar limites.', 403); return; }
  const community = tenant(request);
  const { limitCents } = request.body ?? {};
  if (!mongoose.isValidObjectId(request.params.characterId) || !isValidCents(limitCents, true)) { bad(response, 'Informe um limite válido em centavos.'); return; }
  const character = await Character.findOne({ tenantId: community._id, _id: request.params.characterId });
  if (!character) { bad(response, 'Perfil não encontrado nesta comunidade.', 404); return; }
  const wallet = await getWallet(character._id, community._id);
  if (!wallet) { bad(response, 'Carteira não encontrada.', 404); return; }
  const oldLimitCents = wallet.limitCents;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Wallet.updateOne({ _id: wallet._id, tenantId: community._id }, { $set: { limitCents } }, { session });
      await CommunityAudit.create([{ tenantId: community._id, actorId: account(request)._id, action: 'bank.limit_changed', details: { walletId: wallet._id.toString(), characterId: character._id.toString(), oldLimitCents, newLimitCents: limitCents } }], { session });
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Transaction numbers are only allowed')) { bad(response, 'O Banco requer MongoDB configurado com replica set para registrar o limite e a auditoria juntos.', 503); return; }
    throw error;
  } finally { await session.endSession(); }
  response.json({ limitCents: wallet.limitCents });
});

bankRouter.post('/admin/wallets/:characterId/adjustment', async (request, response) => {
  if (!adminAllowed(request)) { bad(response, 'Apenas administradores da comunidade podem ajustar carteiras.', 403); return; }
  const community = tenant(request);
  const { amountCents, direction, reason } = request.body ?? {};
  const withdrawAll = direction === 'withdraw_all';
  if (!mongoose.isValidObjectId(request.params.characterId) || (!withdrawAll && (!isValidCents(amountCents) || amountCents > 100_000_000)) || !['credit', 'debit', 'withdraw_all'].includes(direction) || typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 160) { bad(response, 'Informe valor, tipo de ajuste e motivo válidos.'); return; }
  const character = await Character.findOne({ tenantId: community._id, _id: request.params.characterId });
  if (!character) { bad(response, 'Perfil não encontrado nesta comunidade.', 404); return; }
  const wallet = await getWallet(character._id, community._id);
  if (!wallet) { bad(response, 'Carteira não encontrada.', 404); return; }
  const isCredit = direction === 'credit';
  const session = await mongoose.startSession();
  let created: InstanceType<typeof WalletTransaction> | null = null;
  let adjustedAmountCents = Number(amountCents);
  try {
    await session.withTransaction(async () => {
      if (withdrawAll) {
        const currentWallet = await Wallet.findOne({ _id: wallet._id, tenantId: community._id }).session(session);
        if (!currentWallet || currentWallet.balanceCents <= 0) throw new Error('A carteira não possui saldo disponível para retirar.');
        adjustedAmountCents = currentWallet.balanceCents;
      }
      const update = await Wallet.updateOne({ _id: wallet._id, tenantId: community._id }, { $inc: { balanceCents: isCredit ? adjustedAmountCents : -adjustedAmountCents } }, { session });
      if (!update.modifiedCount) throw new Error('Não foi possível ajustar o saldo da carteira.');
      const [item] = await WalletTransaction.create([{ tenantId: community._id, type: isCredit ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT', amountCents: adjustedAmountCents, ...(isCredit ? { recipientWalletId: wallet._id } : { senderWalletId: wallet._id }), actorAccountId: account(request)._id, description: reason.trim(), status: 'COMPLETED', reference: reference() }], { session });
      created = item;
      await CommunityAudit.create([{ tenantId: community._id, actorId: account(request)._id, action: isCredit ? 'bank.admin_credit' : withdrawAll ? 'bank.admin_withdraw_all' : 'bank.admin_debit', details: { walletId: wallet._id.toString(), characterId: character._id.toString(), amountCents: adjustedAmountCents, reason: reason.trim(), transactionId: item._id.toString() } }], { session });
      if (isCredit) await Notification.create([{ tenantId: community._id, characterId: character._id, actorId: profile(request)._id, type: 'bank_admin_credit_received', targetId: item._id }], { session });
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('não possui saldo disponível')) { bad(response, error.message, 409); return; }
    if (error instanceof Error && error.message.includes('saldo da carteira negativo')) { bad(response, error.message, 409); return; }
    if (error instanceof Error && error.message.includes('Transaction numbers are only allowed')) { bad(response, 'O Banco requer MongoDB configurado com replica set para garantir ajustes atômicos.', 503); return; }
    throw error;
  } finally { await session.endSession(); }
  response.status(201).json({ transaction: created });
});
