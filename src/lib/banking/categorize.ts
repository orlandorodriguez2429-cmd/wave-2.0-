import { prisma } from '@/lib/db';
import { createAndPostEntry, reverseEntry } from '@/lib/ledger/post';
import { LedgerValidationError } from '@/lib/ledger/validate';

export type CategorizedBy = 'USER' | 'RULE' | 'MERCHANT' | 'AI' | 'TRANSFER';

/**
 * Categorize a pending imported transaction: post a journal entry between the
 * bank's ledger account and the chosen category account(s).
 * Outflow (amount < 0): debit category, credit bank. Inflow: debit bank,
 * credit category. `splits` posts to several accounts (e.g. a loan payment:
 * principal → Loans Payable, interest → Interest Expense); they must add up
 * to the transaction amount.
 */
export async function categorizeTransaction(opts: {
  businessId: string;
  userId: string;
  transactionId: string;
  categoryAccountId?: string;
  splits?: Array<{ accountId: string; amount: bigint }>;
  categorizedBy?: CategorizedBy;
  ai?: { confidence: number; reason: string };
  /** "Remember for this payee": create a rule from this decision. */
  rememberPayee?: boolean;
}) {
  const txn = await prisma.importedTransaction.findUniqueOrThrow({
    where: { id: opts.transactionId },
    include: { bankAccountLink: true },
  });
  if (txn.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (txn.status !== 'PENDING') throw new LedgerValidationError('Transaction is already on the books.');

  const abs = txn.amount < 0n ? -txn.amount : txn.amount;
  if (abs === 0n) throw new LedgerValidationError('Zero-amount transactions should be excluded.');
  const splits =
    opts.splits && opts.splits.length > 0
      ? opts.splits.filter((s) => s.amount !== 0n)
      : opts.categoryAccountId
        ? [{ accountId: opts.categoryAccountId, amount: abs }]
        : [];
  if (splits.length === 0) throw new LedgerValidationError('Pick a category.');
  if (splits.some((s) => s.amount < 0n)) throw new LedgerValidationError('Split amounts must be positive.');
  if (splits.reduce((sum, s) => sum + s.amount, 0n) !== abs) {
    throw new LedgerValidationError('The split amounts must add up to the transaction amount.');
  }
  const bankAccountId = txn.bankAccountLink.ledgerAccountId;
  if (splits.some((s) => s.accountId === bankAccountId)) {
    throw new LedgerValidationError('Pick a category different from the bank account itself.');
  }
  const accounts = await prisma.account.findMany({ where: { id: { in: splits.map((s) => s.accountId) } } });
  if (accounts.length !== new Set(splits.map((s) => s.accountId)).size || accounts.some((a) => a.businessId !== opts.businessId)) {
    throw new LedgerValidationError('Unknown category account.');
  }
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
            ...splits.map((s) => ({ accountId: s.accountId, direction: 'DEBIT' as const, amount: s.amount })),
            { accountId: bankAccountId, direction: 'CREDIT', amount: abs },
          ]
        : [
            { accountId: bankAccountId, direction: 'DEBIT', amount: abs },
            ...splits.map((s) => ({ accountId: s.accountId, direction: 'CREDIT' as const, amount: s.amount })),
          ],
    },
  });

  const categorizedBy = opts.categorizedBy ?? 'USER';
  const updated = await prisma.importedTransaction.update({
    where: { id: txn.id },
    data: {
      status: 'CATEGORIZED',
      journalEntryId: entry.id,
      categorizedBy,
      ...(opts.ai ? { aiConfidence: opts.ai.confidence, aiReason: opts.ai.reason } : {}),
    },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: categorizedBy === 'USER' ? opts.userId : null,
      action: 'bank_txn.categorized',
      entityType: 'imported_transaction',
      entityId: txn.id,
      payload: {
        description: txn.description,
        amount: txn.amount.toString(),
        entryId: entry.id,
        by: categorizedBy,
        accounts: accounts.map((a) => a.code),
      },
    },
  });

  if (opts.rememberPayee && splits.length === 1) {
    await rememberPayeeRule({
      businessId: opts.businessId,
      userId: opts.userId,
      description: txn.merchantName || txn.description,
      outflow,
      accountId: splits[0].accountId,
    });
  }
  return updated;
}

/** The stable part of a bank description, for "remember for this payee". */
export function payeeKey(description: string): string {
  return description
    .toUpperCase()
    .replace(/[#*]?\d[\d\s/.-]*/g, ' ')
    .replace(/\b(POS|DEBIT|CREDIT|PURCHASE|ACH|PMT|PAYMENT|CARD|ONLINE|RECURRING|WWW|COM)\b/g, ' ')
    .replace(/[^A-Z&' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

export async function rememberPayeeRule(opts: {
  businessId: string;
  userId: string;
  description: string;
  outflow: boolean;
  accountId: string;
}) {
  const pattern = payeeKey(opts.description);
  if (pattern.length < 3) return null;
  const appliesTo = opts.outflow ? 'OUTFLOW' : 'INFLOW';
  const existing = await prisma.categorizationRule.findFirst({
    where: { businessId: opts.businessId, pattern, matchType: 'CONTAINS', appliesTo },
  });
  const rule = existing
    ? await prisma.categorizationRule.update({ where: { id: existing.id }, data: { accountId: opts.accountId } })
    : await prisma.categorizationRule.create({
        data: { businessId: opts.businessId, pattern, matchType: 'CONTAINS', appliesTo, accountId: opts.accountId, priority: 50, source: 'LEARNED' },
      });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: existing ? 'categorization_rule.updated' : 'categorization_rule.created',
      entityType: 'categorization_rule',
      entityId: rule.id,
      payload: { pattern, appliesTo, learned: true },
    },
  });
  return rule;
}

/**
 * Undo an automatic (or manual) categorization so it can be corrected: the
 * journal entry is REVERSED (dated the same day, so the month's P&L is
 * right) — never edited — and the bank row goes back to pending review.
 * Fails if that month is closed: reopen it first.
 */
export async function recategorizeTransaction(opts: { businessId: string; userId: string; transactionId: string }) {
  const txn = await prisma.importedTransaction.findUniqueOrThrow({ where: { id: opts.transactionId } });
  if (txn.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (txn.status === 'CATEGORIZED' && txn.journalEntryId) {
    // A transfer entry is shared with its matched partner row: release it too.
    const lineIds = (
      await prisma.journalLine.findMany({ where: { entryId: txn.journalEntryId }, select: { id: true } })
    ).map((l) => l.id);
    const partner = await prisma.importedTransaction.findFirst({
      where: { businessId: opts.businessId, matchedJournalLineId: { in: lineIds } },
    });
    await reverseEntry({ businessId: opts.businessId, userId: opts.userId, entryId: txn.journalEntryId, date: txn.date });
    if (partner) {
      await prisma.importedTransaction.update({
        where: { id: partner.id },
        data: { status: 'PENDING', matchedJournalLineId: null, categorizedBy: null, autoProcessedAt: new Date() },
      });
    }
  } else if (txn.status === 'MATCHED' && txn.categorizedBy === 'TRANSFER' && txn.matchedJournalLineId) {
    const line = await prisma.journalLine.findUniqueOrThrow({ where: { id: txn.matchedJournalLineId } });
    const owner = await prisma.importedTransaction.findFirst({ where: { journalEntryId: line.entryId } });
    if (owner) return recategorizeTransaction({ ...opts, transactionId: owner.id });
  } else if (txn.status === 'EXCLUDED' || txn.status === 'MATCHED') {
    // Nothing was posted from this row; just send it back to review.
  } else {
    throw new LedgerValidationError('Nothing to undo.');
  }
  const updated = await prisma.importedTransaction.update({
    where: { id: txn.id },
    data: {
      status: 'PENDING',
      journalEntryId: null,
      matchedJournalLineId: null,
      categorizedBy: null,
      // Don't let the automatic pipeline re-post the same wrong guess.
      autoProcessedAt: new Date(),
    },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'bank_txn.recategorize',
      entityType: 'imported_transaction',
      entityId: txn.id,
      payload: { reversedEntryId: txn.journalEntryId, previousBy: txn.categorizedBy },
    },
  });
  return updated;
}

/**
 * Post a transfer between two of the business's own feed accounts: one
 * entry (debit the receiving account, credit the sending one). The outgoing
 * row owns the entry; the incoming row is matched to its debit line, so the
 * money is counted once and never touches the P&L.
 */
export async function postTransfer(opts: { businessId: string; userId: string; outId: string; inId: string }) {
  const [out, inn] = await Promise.all([
    prisma.importedTransaction.findUniqueOrThrow({ where: { id: opts.outId }, include: { bankAccountLink: true } }),
    prisma.importedTransaction.findUniqueOrThrow({ where: { id: opts.inId }, include: { bankAccountLink: true } }),
  ]);
  if (out.businessId !== opts.businessId || inn.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (out.status !== 'PENDING' || inn.status !== 'PENDING') throw new LedgerValidationError('Both sides must be pending.');
  if (out.amount >= 0n || inn.amount !== -out.amount) throw new LedgerValidationError('Transfer amounts must mirror each other.');
  const amount = inn.amount;
  const entry = await createAndPostEntry({
    businessId: opts.businessId,
    userId: opts.userId,
    source: 'BANK_IMPORT',
    input: {
      date: out.date,
      memo: `Transfer: ${out.bankAccountLink.name} → ${inn.bankAccountLink.name}`,
      currency: out.bankAccountLink.currency,
      exchangeRate: '1',
      lines: [
        { accountId: inn.bankAccountLink.ledgerAccountId, direction: 'DEBIT', amount },
        { accountId: out.bankAccountLink.ledgerAccountId, direction: 'CREDIT', amount },
      ],
    },
  });
  const debitLine = await prisma.journalLine.findFirstOrThrow({ where: { entryId: entry.id, direction: 'DEBIT' } });
  await prisma.$transaction([
    prisma.importedTransaction.update({
      where: { id: out.id },
      data: { status: 'CATEGORIZED', journalEntryId: entry.id, categorizedBy: 'TRANSFER' },
    }),
    prisma.importedTransaction.update({
      where: { id: inn.id },
      data: { status: 'MATCHED', matchedJournalLineId: debitLine.id, categorizedBy: 'TRANSFER' },
    }),
    prisma.auditLog.create({
      data: {
        businessId: opts.businessId,
        userId: null,
        action: 'bank_txn.transfer_posted',
        entityType: 'imported_transaction',
        entityId: out.id,
        payload: { partnerId: inn.id, entryId: entry.id, amount: amount.toString() },
      },
    }),
  ]);
  return entry;
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
