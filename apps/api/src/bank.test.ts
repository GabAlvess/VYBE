import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { tenantScope } from './middleware/tenant.js';
import { Notification } from './models/Social.js';
import { Wallet, WalletTransaction } from './models/Wallet.js';
import { bulkCreditTransactionKey, canSpend, isValidCents, transactionDirection } from './routes/bankPolicy.js';

const id = () => new mongoose.Types.ObjectId();

test('valores de carteira usam centavos inteiros positivos', () => {
  assert.equal(isValidCents(8000), true);
  assert.equal(isValidCents(0), false);
  assert.equal(isValidCents(0, true), true);
  assert.equal(isValidCents(80.5), false);
  assert.equal(isValidCents('8000'), false);
});

test('saldo e limite mensal são verificados separadamente', () => {
  assert.deepEqual(canSpend(10_000, 3_000, 4_000, 8_000), { allowed: true });
  assert.equal(canSpend(2_000, 3_000, 0, 8_000).reason, 'Saldo insuficiente para realizar esta transferência.');
  assert.equal(canSpend(10_000, 3_000, 6_000, 8_000).reason, 'O limite mensal da sua carteira foi atingido.');
  assert.equal(canSpend(10_000, 3_000, 0, null).allowed, true);
});

test('direção da mesma transferência aparece como entrada e saída para as duas carteiras', () => {
  const sender = id(); const recipient = id();
  const transaction = { type: 'TRANSFER', senderWalletId: sender, recipientWalletId: recipient };
  assert.equal(transactionDirection(transaction, sender.toString()), 'out');
  assert.equal(transactionDirection(transaction, recipient.toString()), 'in');
});

test('cada carteira é única por comunidade e perfil', () => {
  const tenantId = id(); const profileId = id();
  const wallet = new Wallet({ tenantId, characterId: profileId, balanceCents: 0, limitCents: null, cardLast4: '0248' });
  assert.equal(wallet.validateSync(), undefined);
  assert.equal(new Wallet({ tenantId, characterId: profileId, balanceCents: 0, cardLast4: '0248' }).validateSync(), undefined);
  assert.ok(Wallet.schema.indexes().some(([fields, options]) => Boolean(options?.unique) && Object.keys(fields).join(',') === 'tenantId,characterId'));
});

test('transação lógica tem idempotência única por comunidade e histórico dos dois lados', () => {
  const transaction = new WalletTransaction({ tenantId: id(), type: 'TRANSFER', amountCents: 8000, senderWalletId: id(), recipientWalletId: id(), actorAccountId: id(), reference: 'TRX12345678', idempotencyKey: 'transfer-key-01' });
  assert.equal(transaction.validateSync(), undefined);
  assert.ok(WalletTransaction.schema.indexes().some(([fields, options]) => Boolean(options?.unique) && Object.keys(fields).join(',') === 'tenantId,idempotencyKey'));
  assert.ok(WalletTransaction.schema.indexes().some(([fields]) => Object.keys(fields).join(',') === 'tenantId,senderWalletId,createdAt'));
  assert.ok(WalletTransaction.schema.indexes().some(([fields]) => Object.keys(fields).join(',') === 'tenantId,recipientWalletId,createdAt'));
});

test('escopo da carteira substitui qualquer tenant vindo de entrada e não permite cruzamento', () => {
  const tenantA = id(); const tenantB = id();
  const query = tenantScope(tenantA, { tenantId: tenantB, characterId: id() });
  assert.equal(query.tenantId.toString(), tenantA.toString());
  assert.notEqual(query.tenantId.toString(), tenantB.toString());
});

test('notificação de crédito virtual pode ser persistida sem dados bancários reais', () => {
  const notice = new Notification({ tenantId: id(), characterId: id(), actorId: id(), targetId: id(), type: 'bank_transfer_received' });
  assert.equal(notice.validateSync(), undefined);
  notice.type = 'bank_admin_credit_received';
  assert.equal(notice.validateSync(), undefined);
});

test('crédito em lote mantém uma chave idempotente distinta por carteira', () => {
  const batch = 'batch-key-123';
  const profileA = id().toString();
  const profileB = id().toString();
  assert.equal(bulkCreditTransactionKey(batch, profileA), `${batch}:${profileA}`);
  assert.notEqual(bulkCreditTransactionKey(batch, profileA), bulkCreditTransactionKey(batch, profileB));
  assert.equal(bulkCreditTransactionKey(batch, profileA), bulkCreditTransactionKey(batch, profileA));
});
