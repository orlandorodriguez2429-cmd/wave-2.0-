// Bank feed pipeline against real Postgres: sandbox connect, idempotent
// import, rule suggestions, categorize (correct debit/credit orientation),
// match-to-existing-entry, exclude, and reconciliation variance math.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { createAndPostEntry } from '@/lib/ledger/post';
import { connectBank, syncConnection } from './import';
import { categorizeTransaction, excludeTransaction, matchCandidates, matchTransaction } from './categorize';
import { completeReconciliation, reconciliationReport } from './reconcile';

let userId: string;
let businessId: string;
let checking: string;
let softwareExpense: string;
let travelExpense: string;
let sales: string;
let connectionId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `bank-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'Bank Tester' },
  });
  userId = user.id;
  const business = await createBusiness({ userId, name: 'Banking Test Co' });
  businessId = business.id;
  const byCode = async (code: string) =>
    (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code } } })).id;
  [checking, softwareExpense, travelExpense, sales] = await Promise.all(
    ['1010', '6600', '6700', '4000'].map(byCode),
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('bank feed import', () => {
  it('connects the sandbox provider and imports the first batch, applying rules', async () => {
    // Rule created BEFORE import so suggestions land on the new rows.
    await prisma.categorizationRule.create({
      data: { businessId, pattern: 'AWS', matchType: 'CONTAINS', appliesTo: 'OUTFLOW', accountId: softwareExpense, priority: 10 },
    });

    const connection = await connectBank({ businessId, userId, provider: 'mock', ledgerAccountId: checking });
    connectionId = connection.id;
    const first = await syncConnection({ businessId, userId, connectionId });
    expect(first.imported).toBe(8);

    const aws = await prisma.importedTransaction.findFirst({
      where: { businessId, description: { contains: 'AWS' } },
    });
    expect(aws?.suggestedAccountId).toBe(softwareExpense);
    expect(aws?.suggestedByRuleId).toBeTruthy();
  });

  it('re-sync is idempotent per batch and advances the cursor', async () => {
    const second = await syncConnection({ businessId, userId, connectionId });
    expect(second.imported).toBe(3); // batch 2
    const third = await syncConnection({ businessId, userId, connectionId });
    expect(third.imported).toBe(0); // no more batches
    expect(await prisma.importedTransaction.count({ where: { businessId } })).toBe(11);
  });
});

describe('categorize / match / exclude', () => {
  it('categorizing an outflow debits the category and credits the bank account', async () => {
    const txn = await prisma.importedTransaction.findFirstOrThrow({
      where: { businessId, description: { contains: 'DELTA AIR' } },
    });
    const updated = await categorizeTransaction({
      businessId,
      userId,
      transactionId: txn.id,
      categoryAccountId: travelExpense,
    });
    expect(updated.status).toBe('CATEGORIZED');
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: updated.journalEntryId! },
      include: { lines: true },
    });
    expect(entry.source).toBe('BANK_IMPORT');
    expect(entry.lines.find((l) => l.accountId === travelExpense)?.direction).toBe('DEBIT');
    expect(entry.lines.find((l) => l.accountId === checking)?.direction).toBe('CREDIT');
    expect(entry.lines[0].amount).toBe(45620n);
  });

  it('categorizing an inflow debits the bank account and credits the category', async () => {
    const txn = await prisma.importedTransaction.findFirstOrThrow({
      where: { businessId, description: { contains: 'ST-9931' } },
    });
    const updated = await categorizeTransaction({
      businessId,
      userId,
      transactionId: txn.id,
      categoryAccountId: sales,
    });
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: updated.journalEntryId! },
      include: { lines: true },
    });
    expect(entry.lines.find((l) => l.accountId === checking)?.direction).toBe('DEBIT');
    expect(entry.lines.find((l) => l.accountId === sales)?.direction).toBe('CREDIT');
  });

  it('matches a bank line to an already-posted entry instead of double-posting', async () => {
    // Post rent manually first — as if entered before the feed arrived.
    await createAndPostEntry({
      businessId,
      userId,
      input: {
        date: new Date('2026-05-08'),
        memo: 'May rent paid from checking',
        currency: 'USD',
        exchangeRate: '1',
        lines: [
          { accountId: travelExpense, direction: 'DEBIT', amount: 180000n },
          { accountId: checking, direction: 'CREDIT', amount: 180000n },
        ],
      },
    });
    const txn = await prisma.importedTransaction.findFirstOrThrow({
      where: { businessId, description: { contains: 'WEWORK' } },
    });
    const candidates = await matchCandidates(businessId, txn.id);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].amount).toBe(180000n);

    const matched = await matchTransaction({
      businessId,
      userId,
      transactionId: txn.id,
      journalLineId: candidates[0].id,
    });
    expect(matched.status).toBe('MATCHED');
    expect(matched.journalEntryId).toBeNull(); // no new entry created

    // The same ledger line can't be claimed twice.
    const again = await matchCandidates(businessId, txn.id);
    expect(again.find((c) => c.id === candidates[0].id)).toBeUndefined();
  });

  it('excludes personal spend without touching the ledger', async () => {
    const txn = await prisma.importedTransaction.findFirstOrThrow({
      where: { businessId, description: { contains: 'USPS' } },
    });
    const excluded = await excludeTransaction({ businessId, userId, transactionId: txn.id });
    expect(excluded.status).toBe('EXCLUDED');
    await expect(
      categorizeTransaction({ businessId, userId, transactionId: txn.id, categoryAccountId: travelExpense }),
    ).rejects.toThrow(/already on the books|already resolved/i);
  });
});

describe('reconciliation', () => {
  it('computes variance against the ledger and blocks completion until zero', async () => {
    // Ledger movement in May so far: -45620 (Delta) +412500 (Stripe) -180000 (rent match) = +186880.
    const session = await prisma.reconciliationSession.create({
      data: {
        businessId,
        ledgerAccountId: checking,
        statementStart: new Date('2026-05-01'),
        statementEnd: new Date('2026-05-31'),
        startingBalance: 0n,
        endingBalance: 100000n, // deliberately wrong
      },
    });
    const report = await reconciliationReport(businessId, session.id);
    expect(report.ledgerEnd - report.ledgerStart).toBe(186880n);
    expect(report.variance).not.toBe(0n);
    await expect(completeReconciliation({ businessId, userId, sessionId: session.id })).rejects.toThrow(
      /variance/i,
    );

    // Fix the statement balance to the true ledger figure; pending txns still block.
    await prisma.reconciliationSession.update({
      where: { id: session.id },
      data: { endingBalance: report.ledgerEnd, startingBalance: report.ledgerStart },
    });
    await expect(completeReconciliation({ businessId, userId, sessionId: session.id })).rejects.toThrow(
      /pending/i,
    );

    // Resolve the stragglers, then completion succeeds.
    const pending = await prisma.importedTransaction.findMany({ where: { businessId, status: 'PENDING' } });
    for (const txn of pending) {
      await categorizeTransaction({
        businessId,
        userId,
        transactionId: txn.id,
        categoryAccountId: txn.amount < 0n ? travelExpense : sales,
      });
    }
    const fresh = await reconciliationReport(businessId, session.id);
    await prisma.reconciliationSession.update({
      where: { id: session.id },
      data: { endingBalance: fresh.ledgerEnd, startingBalance: fresh.ledgerStart },
    });
    const completed = await completeReconciliation({ businessId, userId, sessionId: session.id });
    expect(completed.status).toBe('COMPLETED');
  });
});
