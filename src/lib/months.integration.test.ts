// Month statuses, close rules, reopen rules, ledger lock.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { createAndPostEntry } from '@/lib/ledger/post';
import { closeMonth, monthStatuses, reopenMonth } from './months';
import { categorizeTransaction } from './banking/categorize';

const TODAY = new Date('2026-11-10T12:00:00Z');
let businessId: string;
let userId: string;
let linkId: string;
let checking: string;
let sales: string;

const add = (date: string, amount: bigint, externalId: string) =>
  prisma.importedTransaction.create({
    data: { businessId, bankAccountLinkId: linkId, externalId, date: new Date(date), description: `TXN ${externalId}`, amount, autoProcessedAt: new Date() },
  });

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: `months-${Date.now()}-${Math.random().toString(36).slice(2)}@t.local`, name: 'M' } })).id;
  businessId = (await createBusiness({ userId, name: 'Months Co' })).id;
  await prisma.business.update({ where: { id: businessId }, data: { booksStartDate: new Date('2026-08-01') } });
  const code = async (c: string) => (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code: c } } })).id;
  [checking, sales] = [await code('1010'), await code('4000')];
  const conn = await prisma.bankConnection.create({
    data: { businessId, provider: 'mock', institutionName: 'B', accounts: { create: { businessId, externalAccountId: 'a', name: 'Chk', currency: 'USD', type: 'depository', ledgerAccountId: checking } } },
    include: { accounts: true },
  });
  linkId = conn.accounts[0].id;
});
afterAll(async () => prisma.$disconnect());

describe('months', () => {
  it('lists books-start → current month with statuses', async () => {
    const a = await add('2026-08-05', 10000n, 'aug1');
    await categorizeTransaction({ businessId, userId, transactionId: a.id, categoryAccountId: sales });
    await add('2026-09-09', 5000n, 'sep1'); // pending
    const m = await monthStatuses(businessId, TODAY);
    expect(m.map((x) => [x.key, x.status])).toEqual([
      ['2026-08', 'READY'],
      ['2026-09', 'NEEDS_REVIEW'],
      ['2026-10', 'NO_DATA'],
      ['2026-11', 'IN_PROGRESS'],
    ]);
    expect(m[1].toReview).toBe(1);
  });

  it('closes in order, blocks while anything is unreviewed, never closes the current month', async () => {
    await expect(closeMonth({ businessId, userId, month: '2026-09', today: TODAY })).rejects.toThrow(/August 2026 first/);
    await closeMonth({ businessId, userId, month: '2026-08', today: TODAY });
    await expect(closeMonth({ businessId, userId, month: '2026-09', today: TODAY })).rejects.toThrow(/1 transaction\(s\) to review/);
    await expect(closeMonth({ businessId, userId, month: '2026-11', today: TODAY })).rejects.toThrow(/after it ends/);
    const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(b.booksClosedThrough?.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('a closed month refuses postings', async () => {
    await expect(
      createAndPostEntry({
        businessId,
        userId,
        input: { date: new Date('2026-08-20'), memo: 'late', currency: 'USD', exchangeRate: '1', lines: [
          { accountId: checking, direction: 'DEBIT', amount: 100n },
          { accountId: sales, direction: 'CREDIT', amount: 100n },
        ] },
      }),
    ).rejects.toThrow(/closed through 2026-08-31/);
  });

  it('reopen needs owner/accountant and a reason, and is audit-logged', async () => {
    await expect(reopenMonth({ businessId, userId, role: 'EMPLOYEE', month: '2026-08', reason: 'fix' })).rejects.toThrow(/owner or accountant/);
    await expect(reopenMonth({ businessId, userId, role: 'ACCOUNTANT', month: '2026-08', reason: '' })).rejects.toThrow(/why/);
    await reopenMonth({ businessId, userId, role: 'ACCOUNTANT', month: '2026-08', reason: 'Client sent a missed receipt' });
    const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(b.booksClosedThrough).toBeNull();
    const log = await prisma.auditLog.findFirst({ where: { businessId, action: 'month.reopened' } });
    expect(log?.payload).toMatchObject({ month: '2026-08', reason: 'Client sent a missed receipt', previouslyClosedThrough: '2026-08-31' });
  });
});
