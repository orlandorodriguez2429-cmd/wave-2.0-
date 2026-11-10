// The automatic categorization pipeline against real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { profitAndLoss } from '@/lib/ledger/reports';
import { ensureTemplateAccount } from '@/lib/ledger/accounts';
import { autoCategorize } from './autocat';
import { categorizeTransaction, recategorizeTransaction } from './categorize';
import type { AiItem, Classifier } from './ai-categorize';

let businessId: string;
let userId: string;
let links: { checking: string; savings: string; card: string };
const code = async (c: string) => (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code: c } } })).id;

let n = 0;
async function txn(link: string, date: string, description: string, amount: bigint, extra: { merchantName?: string } = {}) {
  return prisma.importedTransaction.create({
    data: { businessId, bankAccountLinkId: link, externalId: `t-${++n}`, date: new Date(date), description, amount, ...extra },
  });
}
const get = (id: string) => prisma.importedTransaction.findUniqueOrThrow({ where: { id } });

/** Fake AI: records exactly what it was sent, answers from a lookup. */
function fakeAi(answers: Record<string, { code: string | null; confidence: number }>) {
  const seen: { businessType: string | null; items: AiItem[]; categories: string[] }[] = [];
  const classifier: Classifier = async ({ businessType, items, categories }) => {
    seen.push({ businessType, items, categories: categories.map((c) => c.code) });
    return items.map((item, index) => {
      const a = Object.entries(answers).find(([k]) => item.description.includes(k))?.[1];
      return { index, accountCode: a?.code ?? null, confidence: a?.confidence ?? 0.2, reason: 'fake reason' };
    });
  };
  return { classifier, seen };
}

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `auto-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'Auto Tester' } });
  userId = user.id;
  businessId = (await createBusiness({ userId, name: 'Autocat Test Co' })).id;
  await prisma.business.update({ where: { id: businessId }, data: { businessType: 'residential cleaning' } });
  const conn = await prisma.bankConnection.create({
    data: {
      businessId,
      provider: 'mock',
      institutionName: 'Test Bank',
      accounts: {
        create: [
          { businessId, externalAccountId: 'chk', name: 'Checking', mask: '1111', currency: 'USD', type: 'depository', subtype: 'checking', ledgerAccountId: await code('1010') },
          { businessId, externalAccountId: 'sav', name: 'Savings', mask: '2222', currency: 'USD', type: 'depository', subtype: 'savings', ledgerAccountId: await code('1020') },
          { businessId, externalAccountId: 'cc', name: 'Card', mask: '3333', currency: 'USD', type: 'credit', subtype: 'credit card', ledgerAccountId: await code('2100') },
        ],
      },
    },
    include: { accounts: true },
  });
  const by = (e: string) => conn.accounts.find((a) => a.externalAccountId === e)!.id;
  links = { checking: by('chk'), savings: by('sav'), card: by('cc') };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('autoCategorize', () => {
  const ids: Record<string, string> = {};
  let ai: ReturnType<typeof fakeAi>;

  it('sorts a month of activity: transfers, rules, merchant rules, AI, review', async () => {
    await prisma.categorizationRule.create({
      data: { businessId, pattern: 'CLEANPRO SUPPLY', matchType: 'CONTAINS', appliesTo: 'OUTFLOW', accountId: await code('5000'), priority: 10 },
    });
    ids.xferOut = (await txn(links.checking, '2026-09-03', 'ONLINE TRANSFER TO SAV 2222', -200000n)).id;
    ids.xferIn = (await txn(links.savings, '2026-09-04', 'ONLINE TRANSFER FROM CHK 1111', 200000n)).id;
    ids.cardPayOut = (await txn(links.checking, '2026-09-10', 'CHASE CREDIT CRD AUTOPAY', -45000n)).id;
    ids.cardPayIn = (await txn(links.card, '2026-09-11', 'PAYMENT THANK YOU', 45000n)).id;
    ids.rule = (await txn(links.card, '2026-09-05', 'CLEANPRO SUPPLY #22', -8000n)).id;
    ids.aws = (await txn(links.card, '2026-09-06', 'GOOGLE *WORKSPACE', -1400n)).id;
    ids.salesTax = (await txn(links.checking, '2026-09-15', 'CA DEPT OF TAX AND FEE ADMIN CDTFA', -12500n)).id;
    ids.loan = (await txn(links.checking, '2026-09-20', 'SBA LOAN PMT 004419', -52000n)).id;
    ids.customer = (await txn(links.checking, '2026-09-21', 'MOBILE DEPOSIT HOMEOWNER INVOICE', 30000n)).id;
    ids.zelle = (await txn(links.checking, '2026-09-22', 'ZELLE TO MARIA GARCIA 5521', -15000n)).id;
    ids.closed = (await txn(links.card, '2026-01-15', 'GITHUB INC', -400n)).id;
    await prisma.business.update({ where: { id: businessId }, data: { booksClosedThrough: new Date('2026-01-31') } });

    ai = fakeAi({ 'MOBILE DEPOSIT': { code: '4100', confidence: 0.93 }, ZELLE: { code: '6900', confidence: 0.55 } });
    const stats = await autoCategorize({ businessId, classifier: ai.classifier });
    expect(stats).toMatchObject({ considered: 11, transfers: 2, rule: 1, merchant: 2, ai: 1, leftForReview: 3 });

    // Transfers: one entry each; incoming side matched, not double-counted.
    const out = await get(ids.xferOut);
    const inn = await get(ids.xferIn);
    expect([out.status, out.categorizedBy, inn.status, inn.categorizedBy]).toEqual(['CATEGORIZED', 'TRANSFER', 'MATCHED', 'TRANSFER']);
    const cardIn = await get(ids.cardPayIn);
    expect(cardIn.status).toBe('MATCHED'); // card payment paired with the checking side

    expect((await get(ids.rule)).categorizedBy).toBe('RULE');
    expect((await get(ids.aws)).categorizedBy).toBe('MERCHANT');
    expect((await get(ids.salesTax)).categorizedBy).toBe('MERCHANT');

    // AI ≥ 0.85 applied and labelled; < 0.85 pre-filled for review.
    const cust = await get(ids.customer);
    expect([cust.status, cust.categorizedBy, cust.aiConfidence]).toEqual(['CATEGORIZED', 'AI', 0.93]);
    const z = await get(ids.zelle);
    expect([z.status, z.suggestedAccountId, z.aiConfidence, z.aiReason]).toEqual(['PENDING', await code('6900'), 0.55, 'fake reason']);

    // Loan payment: suggested, never auto-posted.
    const loan = await get(ids.loan);
    expect([loan.status, loan.suggestedAccountId]).toEqual(['PENDING', await code('2500')]);
    expect(loan.aiReason).toMatch(/interest/);
    // Closed month: never posted.
    expect((await get(ids.closed)).status).toBe('PENDING');
  });

  it('sent the AI only cleaned descriptions, amounts and the business type', async () => {
    const sent = JSON.stringify(ai.seen);
    expect(ai.seen).toHaveLength(1);
    expect(ai.seen[0].businessType).toBe('residential cleaning');
    expect(sent).not.toMatch(/MARIA|GARCIA|5521|Autocat|Test Bank|1111|2222|3333/);
    expect(sent).toContain('ZELLE TO [person]');
    // Feed accounts are not offered as categories; balance-sheet targets are.
    expect(ai.seen[0].categories).not.toContain('1010');
    expect(ai.seen[0].categories).toEqual(expect.arrayContaining(['2100', '2200', '2500', '3000', '4100', '6900']));
  });

  it('keeps transfers, card payments and sales tax off the P&L', async () => {
    const pnl = await profitAndLoss(businessId, { from: new Date('2026-09-01'), to: new Date('2026-09-30') });
    // Income: AI'd customer deposit 300.00. Expenses: rule 80.00 (COGS) + workspace 14.00.
    expect(pnl.income.total).toBe(30000n);
    expect(pnl.cogs.total + pnl.expenses.total).toBe(9400n);
  });

  it('does not re-send rows the AI already looked at', async () => {
    const again = await autoCategorize({ businessId, classifier: ai.classifier });
    expect(again.considered).toBe(0);
    expect(ai.seen).toHaveLength(1);
  });

  it('splits a loan payment into principal (balance sheet) and interest (expense)', async () => {
    const interest = await ensureTemplateAccount(prisma, businessId, '7100');
    await categorizeTransaction({
      businessId,
      userId,
      transactionId: ids.loan,
      splits: [
        { accountId: await code('2500'), amount: 47000n },
        { accountId: interest.id, amount: 5000n },
      ],
    });
    const pnl = await profitAndLoss(businessId, { from: new Date('2026-09-01'), to: new Date('2026-09-30') });
    expect(pnl.cogs.total + pnl.expenses.total).toBe(9400n + 5000n);
    await expect(
      categorizeTransaction({ businessId, userId, transactionId: ids.zelle, splits: [{ accountId: await code('6900'), amount: 1n }] }),
    ).rejects.toThrow(/add up/);
  });

  it('a correction reverses the entry, and "remember for this payee" teaches a rule', async () => {
    const before = await get(ids.customer);
    await recategorizeTransaction({ businessId, userId, transactionId: ids.customer });
    const reversed = await prisma.journalEntry.findFirst({ where: { reversesId: before.journalEntryId! } });
    expect(reversed).not.toBeNull();
    expect((await get(ids.customer)).status).toBe('PENDING');

    await categorizeTransaction({ businessId, userId, transactionId: ids.customer, categoryAccountId: await code('4000'), rememberPayee: true });
    const rule = await prisma.categorizationRule.findFirst({ where: { businessId, source: 'LEARNED' } });
    expect(rule).toMatchObject({ pattern: 'MOBILE DEPOSIT HOMEOWNER', appliesTo: 'INFLOW' });

    // Next month the same payee is handled by the learned rule, no AI.
    const next = await txn(links.checking, '2026-10-05', 'MOBILE DEPOSIT HOMEOWNER INVOICE', 32000n);
    const s = await autoCategorize({ businessId, classifier: ai.classifier });
    expect(s.rule).toBe(1);
    expect((await get(next.id)).categorizedBy).toBe('RULE');
    expect(ai.seen).toHaveLength(1);
  });

  it('undoing a transfer releases both sides', async () => {
    await recategorizeTransaction({ businessId, userId, transactionId: ids.xferIn });
    expect((await get(ids.xferOut)).status).toBe('PENDING');
    expect((await get(ids.xferIn)).status).toBe('PENDING');
  });

  it('if the AI is down, everything just waits for review', async () => {
    const t = await txn(links.checking, '2026-10-07', 'SOMETHING ODD', -999n);
    const s = await autoCategorize({ businessId, classifier: async () => { throw new Error('timeout'); } });
    expect(s.leftForReview).toBe(1);
    expect((await get(t.id)).status).toBe('PENDING');
  });
});
