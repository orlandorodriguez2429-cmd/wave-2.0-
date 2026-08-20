// Integration tests against a real Postgres (DATABASE_URL). They prove the
// invariants hold at the DATABASE level, not just in the service layer:
// posted entries and their lines are frozen by triggers, unbalanced posts are
// rejected, reversals link and cancel exactly, and the balance sheet balances.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from './business';
import { createAndPostEntry, reverseEntry } from './post';
import { balanceSheet, profitAndLoss, trialBalance } from './reports';

let userId: string;
let businessId: string;
let checking: string;
let sales: string;
let rent: string;
let equity: string;

const usd = (dollars: number) => BigInt(Math.round(dollars * 100));

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `test-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'Test User' },
  });
  userId = user.id;
  const business = await createBusiness({ userId, name: 'Integration Test Co' });
  businessId = business.id;
  const byCode = async (code: string) =>
    (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code } } })).id;
  [checking, sales, rent, equity] = await Promise.all(['1010', '4000', '6500', '3000'].map(byCode));
});

afterAll(async () => {
  await prisma.$disconnect();
});

const postSimple = (memo: string, amount: bigint, debitAcc: string, creditAcc: string, date = '2026-03-01') =>
  createAndPostEntry({
    businessId,
    userId,
    input: {
      date: new Date(date),
      memo,
      currency: 'USD',
      exchangeRate: '1',
      lines: [
        { accountId: debitAcc, direction: 'DEBIT', amount },
        { accountId: creditAcc, direction: 'CREDIT', amount },
      ],
    },
  });

describe('posting', () => {
  it('posts balanced entries with sequential numbering and an audit trail', async () => {
    const e1 = await postSimple('Owner investment', usd(10000), checking, equity, '2026-01-05');
    const e2 = await postSimple('Consulting revenue', usd(5000), checking, sales, '2026-02-01');

    expect(e1.status).toBe('POSTED');
    expect(e1.entryNumber).toBe(1);
    expect(e2.entryNumber).toBe(2);
    expect(e1.postedAt).toBeTruthy();

    const audit = await prisma.auditLog.findMany({
      where: { businessId, action: 'journal_entry.posted' },
    });
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects unbalanced entries in the service layer', async () => {
    await expect(
      createAndPostEntry({
        businessId,
        userId,
        input: {
          date: new Date('2026-03-01'),
          memo: 'Unbalanced',
          currency: 'USD',
          exchangeRate: '1',
          lines: [
            { accountId: checking, direction: 'DEBIT', amount: usd(100) },
            { accountId: sales, direction: 'CREDIT', amount: usd(99) },
          ],
        },
      }),
    ).rejects.toThrow(/unbalanced/i);
  });

  it('DB posting gate rejects an unbalanced entry even if the app layer is bypassed', async () => {
    const draft = await prisma.journalEntry.create({
      data: {
        businessId,
        date: new Date('2026-03-01'),
        memo: 'Bypass attempt',
        status: 'DRAFT',
        currency: 'USD',
        createdById: userId,
        lines: {
          create: [
            { lineNo: 1, accountId: checking, direction: 'DEBIT', amount: 100n, functionalAmount: 100n },
            { lineNo: 2, accountId: sales, direction: 'CREDIT', amount: 99n, functionalAmount: 99n },
          ],
        },
      },
    });
    await expect(
      prisma.journalEntry.update({
        where: { id: draft.id },
        data: { status: 'POSTED', entryNumber: 9999 },
      }),
    ).rejects.toThrow(/unbalanced/i);
    await prisma.journalEntry.delete({ where: { id: draft.id } }); // drafts are deletable
  });

  it('DB forbids inserting an entry directly in POSTED state', async () => {
    await expect(
      prisma.journalEntry.create({
        data: {
          businessId,
          date: new Date('2026-03-01'),
          memo: 'Direct POSTED insert',
          status: 'POSTED',
          entryNumber: 9998,
          currency: 'USD',
          createdById: userId,
        },
      }),
    ).rejects.toThrow(/inserted as DRAFT/i);
  });
});

describe('immutability (DB triggers)', () => {
  it('blocks UPDATE and DELETE of a posted entry and its lines', async () => {
    const entry = await postSimple('Immutable rent', usd(1500), rent, checking);

    await expect(
      prisma.journalEntry.update({ where: { id: entry.id }, data: { memo: 'tampered' } }),
    ).rejects.toThrow(/immutable/i);
    await expect(prisma.journalEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/immutable/i);

    const line = entry.lines[0];
    await expect(
      prisma.journalLine.update({ where: { id: line.id }, data: { amount: 1n, functionalAmount: 1n } }),
    ).rejects.toThrow(/immutable/i);
    await expect(prisma.journalLine.delete({ where: { id: line.id } })).rejects.toThrow(/immutable/i);
    await expect(
      prisma.journalLine.create({
        data: { entryId: entry.id, lineNo: 99, accountId: sales, direction: 'DEBIT', amount: 1n, functionalAmount: 1n },
      }),
    ).rejects.toThrow(/immutable/i);

    // Raw SQL bypassing Prisma hits the same wall.
    await expect(
      prisma.$executeRaw`UPDATE journal_entries SET memo = 'raw tamper' WHERE id = ${entry.id}`,
    ).rejects.toThrow(/immutable/i);
  });

  it('enforces positive amounts via CHECK constraints', async () => {
    const draft = await prisma.journalEntry.create({
      data: {
        businessId,
        date: new Date('2026-03-01'),
        memo: 'Draft for CHECK test',
        status: 'DRAFT',
        currency: 'USD',
        createdById: userId,
      },
    });
    await expect(
      prisma.$executeRaw`
        INSERT INTO journal_lines (id, "entryId", "lineNo", "accountId", direction, amount, "functionalAmount")
        VALUES ('neg-test', ${draft.id}, 50, ${checking}, 'DEBIT', -5, -5)
      `,
    ).rejects.toThrow(/journal_lines_amount_positive/);
    await prisma.journalEntry.delete({ where: { id: draft.id } });
  });
});

describe('reversals', () => {
  it('reverses a posted entry via a linked, flipped entry and refuses double reversal', async () => {
    const original = await postSimple('Rent posted to wrong month', usd(2000), rent, checking, '2026-04-01');
    const reversal = await reverseEntry({ businessId, userId, entryId: original.id, date: new Date('2026-04-02') });

    expect(reversal.reversesId).toBe(original.id);
    expect(reversal.memo).toContain(`Reversal of JE-${original.entryNumber}`);
    const flipped = reversal.lines.find((l) => l.accountId === rent);
    expect(flipped?.direction).toBe('CREDIT');
    expect(flipped?.amount).toBe(usd(2000));

    await expect(reverseEntry({ businessId, userId, entryId: original.id })).rejects.toThrow(/already been reversed/i);
    await expect(reverseEntry({ businessId, userId, entryId: reversal.id })).rejects.toThrow(/itself a reversal/i);

    // Net effect on the rent account for April is zero.
    const tb = await trialBalance(businessId, { from: new Date('2026-04-01'), to: new Date('2026-04-30') });
    const rentRow = tb.rows.find((r) => r.accountId === rent);
    expect(rentRow?.debitBalance ?? 0n).toBe(0n);
    expect(rentRow?.creditBalance ?? 0n).toBe(0n);
  });
});

describe('multi-currency', () => {
  it('posts an FX entry balanced in both currencies', async () => {
    const entry = await createAndPostEntry({
      businessId,
      userId,
      input: {
        date: new Date('2026-05-01'),
        memo: 'EUR consulting invoice',
        currency: 'EUR',
        exchangeRate: '1.0850',
        lines: [
          { accountId: checking, direction: 'DEBIT', amount: 10000n }, // €100.00
          { accountId: sales, direction: 'CREDIT', amount: 10000n },
        ],
      },
    });
    for (const line of entry.lines) {
      expect(line.functionalAmount).toBe(10850n); // $108.50
    }
  });
});

describe('reports', () => {
  it('trial balance debits equal credits', async () => {
    const tb = await trialBalance(businessId);
    expect(tb.totalDebits).toBe(tb.totalCredits);
    expect(tb.totalDebits).toBeGreaterThan(0n);
  });

  it('P&L computes net income; balance sheet balances against it', async () => {
    const pnl = await profitAndLoss(businessId, {
      from: new Date('2026-01-01'),
      to: new Date('2026-12-31'),
    });
    expect(pnl.income.total).toBeGreaterThan(0n);
    expect(pnl.netIncome).toBe(pnl.grossProfit - pnl.expenses.total);

    const bs = await balanceSheet(businessId, new Date('2026-12-31'));
    expect(bs.balances).toBe(true);
    expect(bs.assets.total).toBe(bs.liabilitiesAndEquity);
  });
});
