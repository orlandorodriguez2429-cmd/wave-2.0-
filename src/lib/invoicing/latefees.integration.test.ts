// Late fee assessment against a real Postgres: opt-in, one-time,
// percentage-of-balance, posted through the same double-entry engine.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { trialBalance } from '@/lib/ledger/reports';
import { signedBalance } from '@/lib/ledger/validate';
import { approveInvoice, createDraftInvoice, recordPayment } from './invoices';
import { applyLateFee, checkLateFeeEligibility } from './latefees';

let userId: string;
let businessId: string;
let customerId: string;
let checking: string;
let serviceRevenue: string;
let lateFeeIncome: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `latefee-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'Late Fee Tester' },
  });
  userId = user.id;
  const business = await createBusiness({ userId, name: 'Late Fees Test Co' });
  businessId = business.id;
  const byCode = async (code: string) =>
    (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code } } })).id;
  [checking, serviceRevenue, lateFeeIncome] = await Promise.all(['1010', '4100', '4910'].map(byCode));
  customerId = (await prisma.customer.create({ data: { businessId, name: 'Late Fee Customer' } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function openInvoice(dueDate: Date, totalCents = 100000n) {
  const draft = await createDraftInvoice({
    businessId,
    userId,
    input: {
      customerId,
      issueDate: new Date('2026-01-01'),
      dueDate,
      currency: 'USD',
      exchangeRate: '1',
      lines: [{ description: 'Work', quantityMilli: 1000n, unitPrice: totalCents, incomeAccountId: serviceRevenue }],
    },
  });
  return approveInvoice({ businessId, userId, invoiceId: draft.id });
}

async function lateFeeIncomeBalance() {
  const tb = await trialBalance(businessId);
  const row = tb.rows.find((r) => r.accountId === lateFeeIncome);
  return row ? signedBalance(row.type, row.debits, row.credits) : 0n;
}

describe('late fees', () => {
  it('is not eligible when late fees are disabled for the business', async () => {
    const invoice = await openInvoice(new Date('2025-01-01'));
    const result = await checkLateFeeEligibility({ businessId, invoiceId: invoice.id, asOf: new Date('2026-06-01') });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/not enabled/i);
  });

  it('applies a 1.5% one-time fee, posts a balanced entry, and bumps the invoice total', async () => {
    await prisma.business.update({ where: { id: businessId }, data: { lateFeePercentagePpm: 15_000, lateFeeGraceDays: 0 } });

    const invoice = await openInvoice(new Date('2025-01-01'), 100000n); // $1,000.00
    const before = await lateFeeIncomeBalance();

    const eligibility = await checkLateFeeEligibility({ businessId, invoiceId: invoice.id, asOf: new Date('2026-06-01') });
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.feeAmount).toBe(1500n); // 1.5% of $1,000.00 = $15.00

    const charge = await applyLateFee({ businessId, userId, invoiceId: invoice.id, asOf: new Date('2026-06-01') });
    expect(charge.amount).toBe(1500n);
    expect(await lateFeeIncomeBalance()).toBe(before + 1500n);

    const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updated.total).toBe(101500n);

    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: charge.journalEntryId },
      include: { lines: true },
    });
    const debits = entry.lines.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s + l.functionalAmount, 0n);
    const credits = entry.lines.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s + l.functionalAmount, 0n);
    expect(debits).toBe(credits);
    expect(debits).toBe(1500n);
  });

  it('refuses a second late fee on the same invoice (one-time only)', async () => {
    await prisma.business.update({ where: { id: businessId }, data: { lateFeePercentagePpm: 15_000, lateFeeGraceDays: 0 } });
    const invoice = await openInvoice(new Date('2025-01-01'));
    await applyLateFee({ businessId, userId, invoiceId: invoice.id, asOf: new Date('2026-06-01') });
    await expect(
      applyLateFee({ businessId, userId, invoiceId: invoice.id, asOf: new Date('2026-06-02') }),
    ).rejects.toThrow(/already been applied/i);
  });

  it('respects the grace period', async () => {
    await prisma.business.update({ where: { id: businessId }, data: { lateFeePercentagePpm: 15_000, lateFeeGraceDays: 10 } });
    const invoice = await openInvoice(new Date('2026-06-01'));
    const tooSoon = await checkLateFeeEligibility({ businessId, invoiceId: invoice.id, asOf: new Date('2026-06-05') });
    expect(tooSoon.eligible).toBe(false);
    expect(tooSoon.reason).toMatch(/grace period/i);

    const afterGrace = await checkLateFeeEligibility({ businessId, invoiceId: invoice.id, asOf: new Date('2026-06-12') });
    expect(afterGrace.eligible).toBe(true);
  });

  it('refuses to apply a fee once the invoice is fully paid', async () => {
    await prisma.business.update({ where: { id: businessId }, data: { lateFeePercentagePpm: 15_000, lateFeeGraceDays: 0 } });
    const invoice = await openInvoice(new Date('2025-01-01'));
    await recordPayment({
      businessId,
      userId,
      invoiceId: invoice.id,
      date: new Date('2026-01-05'),
      amount: 100000n,
      method: 'ACH',
      depositAccountId: checking,
    });
    const result = await checkLateFeeEligibility({ businessId, invoiceId: invoice.id, asOf: new Date('2026-06-01') });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/not open/i);
  });
});
