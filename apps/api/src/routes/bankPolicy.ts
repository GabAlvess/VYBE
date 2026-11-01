export function isValidCents(value: unknown, allowZero = false): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

export function canSpend(balanceCents: number, amountCents: number, monthlyUsedCents: number, limitCents: number | null) {
  if (amountCents > balanceCents) return { allowed: false as const, reason: 'Saldo insuficiente para realizar esta transferência.' };
  if (limitCents !== null && monthlyUsedCents + amountCents > limitCents) return { allowed: false as const, reason: 'O limite mensal da sua carteira foi atingido.' };
  return { allowed: true as const };
}

export function transactionDirection(transaction: { type: string; senderWalletId?: { toString(): string } | null; recipientWalletId?: { toString(): string } | null }, walletId: string) {
  if (transaction.type === 'ADMIN_CREDIT' || transaction.type === 'SALARY' || transaction.type === 'REFUND') return 'in' as const;
  if (transaction.type === 'ADMIN_DEBIT' || transaction.type === 'ADMIN_TAX' || transaction.type === 'PAYMENT') return 'out' as const;
  return transaction.recipientWalletId?.toString() === walletId ? 'in' as const : 'out' as const;
}

export function bulkCreditTransactionKey(batchKey: string, characterId: string) {
  return `${batchKey}:${characterId}`;
}
