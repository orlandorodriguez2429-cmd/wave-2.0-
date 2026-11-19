// End-to-end bill flows against a real Postgres: approval posts to Accounts
// Payable, payments clear it, and Aged Payables reflects real open balances.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { trialBalance } from '@/lib/ledger/reports';
import { agedPayables } from '@/lib/ledger/more-reports';
import { approveBill, createDraftBill, recordBillPayment, voidBill } from './bills';
import { signedBalance } from '@/lib/ledger/validate';

let userId: string;
let businessId: string;
let vendorId: string;
let checking: string;
let rentExpense: string;
let accountsPayable: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `bill-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'Bill Tester' },
  });
  userId = user.id;
  const business = await createBusiness({ userId, name: 'Bills Test Co' });
  businessId = business.id;
  const byCode = async (code: string) =>
    (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code } } })).id;
  [checking, rentExpense, accountsPayable] = await Promise.all(['1010', '6500', '2000'].map(byCode));
  vendorId = (await prisma.vendor.create({ data: { businessId, name: 'Landlord LLC' } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const draft = (overrides: Partial<Parameters<typeof createDraftBill>[0]['input']> = {}) =>
  createDraftBill({
    businessId,
    userId,
    input: {
      vendorId,
      billDate: new Date('2026-01-01'),
      dueDate: new Date('2026-01-31'),
      currency: 'USD',
      exchangeRate: '1',
      memo: 'January rent',
      lines: [{ expenseAccountId: rentExpense, amount: 200000n }],
      ...overrides,
    },
  });

async function apBalance() {
  const tb = await trialBalance(businessId);
  const row = tb.rows.find((r) => r.accountId === accountsPayable);
  return row ? signedBalance(row.type, row.debits, row.credits) : 0n;
}

describe('bills', () => {
  it('draft bill has no ledger effect until approved', async () => {
    const before = await apBalance();
    const bill = await draft();
    expect(bill.status).toBe('DRAFT');
    expect(await apBalance()).toBe(before);
  });

  it('approving posts Dr Expense / Cr Accounts Payable and balances', async () => {
    const before = await apBalance();
    const bill = await draft();
    const approved = await approveBill({ businessId, userId, billId: bill.id });
    expect(approved.status).toBe('OPEN');
    expect(await apBalance()).toBe(before + 200000n);

    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: approved.journalEntryId! },
      include: { lines: true },
    });
    const debits = entry.lines.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s + l.functionalAmount, 0n);
    const credits = entry.lines.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s + l.functionalAmount, 0n);
    expect(debits).toBe(credits);
    expect(debits).toBe(200000n);
  });

  it('a full payment clears Accounts Payable and marks the bill PAID', async () => {
    const bill = await draft();
    await approveBill({ businessId, userId, billId: bill.id });
    const apAfterApproval = await apBalance();

    const payment = await recordBillPayment({
      businessId,
      userId,
      billId: bill.id,
      date: new Date('2026-01-15'),
      amount: 200000n,
      method: 'ACH',
      paymentAccountId: checking,
    });
    expect(payment.amount).toBe(200000n);

    const updated = await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(updated.status).toBe('PAID');
    expect(await apBalance()).toBe(apAfterApproval - 200000n);
  });

  it('rejects a payment larger than the remaining balance', async () => {
    const bill = await draft();
    await approveBill({ businessId, userId, billId: bill.id });
    await expect(
      recordBillPayment({
        businessId,
        userId,
        billId: bill.id,
        date: new Date('2026-01-15'),
        amount: 999999n,
        method: 'ACH',
        paymentAccountId: checking,
      }),
    ).rejects.toThrow(/exceeds the remaining balance/);
  });

  it('voiding an unpaid open bill reverses the ledger entry and clears A/P', async () => {
    const before = await apBalance();
    const bill = await draft();
    await approveBill({ businessId, userId, billId: bill.id });
    expect(await apBalance()).toBe(before + 200000n);

    const voided = await voidBill({ businessId, userId, billId: bill.id });
    expect(voided.status).toBe('VOID');
    expect(await apBalance()).toBe(before);
  });

  it('cannot void a bill that already has a payment', async () => {
    const bill = await draft();
    await approveBill({ businessId, userId, billId: bill.id });
    await recordBillPayment({
      businessId,
      userId,
      billId: bill.id,
      date: new Date('2026-01-15'),
      amount: 100000n,
      method: 'ACH',
      paymentAccountId: checking,
    });
    await expect(voidBill({ businessId, userId, billId: bill.id })).rejects.toThrow(/payments recorded/);
  });

  it('aged payables buckets an overdue open bill correctly and excludes paid/draft/void bills', async () => {
    const overdue = await draft({ billDate: new Date('2025-11-01'), dueDate: new Date('2025-12-01') });
    await approveBill({ businessId, userId, billId: overdue.id });

    const paidOff = await draft({ dueDate: new Date('2026-02-01') });
    await approveBill({ businessId, userId, billId: paidOff.id });
    await recordBillPayment({
      businessId,
      userId,
      billId: paidOff.id,
      date: new Date('2026-01-20'),
      amount: 200000n,
      method: 'ACH',
      paymentAccountId: checking,
    });

    await draft(); // stays DRAFT — must not appear

    const report = await agedPayables(businessId, new Date('2026-06-15'));
    const overdueRow = report.rows.find((r) => r.billId === overdue.id);
    expect(overdueRow).toBeDefined();
    expect(overdueRow!.bucket).toBe('90+');
    expect(report.rows.some((r) => r.billId === paidOff.id)).toBe(false);
    expect(report.total).toBeGreaterThanOrEqual(overdueRow!.balance);
  });
});
