import { prisma } from '@/lib/db';
import { createAndPostEntry } from '@/lib/ledger/post';
import { LedgerValidationError } from '@/lib/ledger/validate';

/**
 * Categorize a pending imported transaction: post a journal entry between the
 * bank's ledger account and the chosen category account.
 * Outflow (amount < 0): debit category, credit bank. Inflow: debit bank,
 * credit category.
 */
export async function categorizeTransaction(opts: {
  businessId: string;
  userId: string;
  transactionId: string;
  categoryAccountId: string;
}) {
  const txn = await prisma.importedTransaction.findUniqueOrThrow({
    where: { id: opts.transactionId },
    include: { bankAccountLink: true },
  });
  if (txn.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (txn.status !== 'PENDING') throw new LedgerValidationError('Transaction is already on the books.');
  if (opts.categoryAccountId === txn.bankAccountLink.ledgerAccountId) {
    throw new LedgerValidationError('Pick a category different from the bank account itself.');
  }

  const abs = txn.amount < 0n ? -txn.amount : txn.amount;
  if (abs === 0n) throw new LedgerValidationError('Zero-amount transactions should be excluded.');
  const bankAccountId = txn.bankAccountLink.ledgerAccountId;
  const outflow = txn.amount < 0n;

  const entry = await createAndPostEntry({
    businessId: opts.businessId,
    userId: opts.userId,
    source: 'BANK_IMPORT',
    input: {
      date: txn.date,
      memo: txn.description,
      currency: txn.bankAccountLink.currency,
      exchangeRate: '1',
      lines: outflow
        ? [
            { accountId: opts.categoryAccountId, direction: 'DEBIT', amount: abs },
            { accountId: bankAccountId, direction: 'CREDIT', amount: abs },
          ]
        : [
            { accountId: bankAccountId, direction: 'DEBIT', amount: abs },
            { accountId: opts.categoryAccountId, direction: 'CREDIT', amount: abs },
          ],
    },
  });

  const updated = await prisma.importedTransaction.update({
    where: { id: txn.id },
    data: { status: 'CATEGORIZED', journalEntryId: entry.id },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'bank_txn.categorized',
      entityType: 'imported_transaction',
      entityId: txn.id,
      payload: { description: txn.description, amount: txn.amount.toString(), entryId: entry.id },
    },
  });
  return updated;
}

/**
 * Candidate posted journal lines this bank transaction could match: same
 * ledger account, same direction and amount, within ±7 days, not yet matched.
 */
export async function matchCandidates(businessId: string, transactionId: string) {
  const txn = await prisma.importedTransaction.findUniqueOrThrow({
    where: { id: transactionId },
    include: { bankAccountLink: true },
  });
  if (txn.businessId !== businessId) throw new LedgerValidationError('Wrong business.');
  const abs = txn.amount < 0n ? -txn.amount : txn.amount;
  const direction = txn.amount < 0n ? 'CREDIT' : 'DEBIT'; // effect on the bank ledger account
  const from = new Date(txn.date.getTime() - 7 * 86400_000);
  const to = new Date(txn.date.getTime() + 7 * 86400_000);

  const alreadyMatched = (
    await prisma.importedTransaction.findMany({
      where: { businessId, matchedJournalLineId: { not: null } },
      select: { matchedJournalLineId: true },
    })
  ).map((t) => t.matchedJournalLineId!) as string[];

  return prisma.journalLine.findMany({
    where: {
      accountId: txn.bankAccountLink.ledgerAccountId,
      direction,
      amount: abs,
      id: { notIn: alreadyMatched },
      entry: { businessId, status: 'POSTED', date: { gte: from, lte: to } },
    },
    include: { entry: { select: { id: true, entryNumber: true, date: true, memo: true, source: true } } },
    take: 10,
  });
}

/** Confirm a match: the bank line corresponds to an entry already on the books. */
export async function matchTransaction(opts: {
  businessId: string;
  userId: string;
  transactionId: string;
  journalLineId: string;
}) {
  const txn = await prisma.importedTransaction.findUniqueOrThrow({
    where: { id: opts.transactionId },
    include: { bankAccountLink: true },
  });
  if (txn.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (txn.status !== 'PENDING') throw new LedgerValidationError('Transaction is already resolved.');

  const line = await prisma.journalLine.findUniqueOrThrow({
    where: { id: opts.journalLineId },
    include: { entry: true },
  });
  if (line.entry.businessId !== opts.businessId || line.accountId !== txn.bankAccountLink.ledgerAccountId) {
    throw new LedgerValidationError('That ledger line does not belong to this bank account.');
  }

  const updated = await prisma.importedTransaction.update({
    where: { id: txn.id },
    data: { status: 'MATCHED', matchedJournalLineId: line.id },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'bank_txn.matched',
      entityType: 'imported_transaction',
      entityId: txn.id,
      payload: { journalLineId: line.id, entryNumber: line.entry.entryNumber },
    },
  });
  return updated;
}

export async function excludeTransaction(opts: { businessId: string; userId: string; transactionId: string }) {
  const txn = await prisma.importedTransaction.findUniqueOrThrow({ where: { id: opts.transactionId } });
  if (txn.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (txn.status !== 'PENDING') throw new LedgerValidationError('Only pending transactions can be excluded.');
  const updated = await prisma.importedTransaction.update({
    where: { id: txn.id },
    data: { status: 'EXCLUDED' },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'bank_txn.excluded',
      entityType: 'imported_transaction',
      entityId: txn.id,
      payload: { description: txn.description },
    },
  });
  return updated;
}
