// Cash-basis P&L has to diverge from the accrual ledger by construction:
// invoices/bills recognize revenue/expense at approval, so a true cash-basis
// view re-derives recognition from payment dates instead of posting dates.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { profitAndLoss } from '@/lib/ledger/reports';
import { cashBasisProfitAndLoss } from '@/lib/ledger/more-reports';
import { approveInvoice, createDraftInvoice, recordPayment } from '@/lib/invoicing/invoices';
import { approveBill, createDraftBill, recordBillPayment } from '@/lib/bills';

let userId: string;
let businessId: string;
let customerId: string;
let vendorId: string;
let checking: string;
let serviceRevenue: string;
let rentExpense: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `cashbasis-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'Cash Basis Tester' },
  });
  userId = user.id;
  const business = await createBusiness({ userId, name: 'Cash Basis Test Co' });
  businessId = business.id;
  const byCode = async (code: string) =>
    (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code } } })).id;
  [checking, serviceRevenue, rentExpense] = await Promise.all(['1010', '4100', '6500'].map(byCode));
  customerId = (await prisma.customer.create({ data: { businessId, name: 'Cash Basis Customer' } })).id;
  vendorId = (await prisma.vendor.create({ data: { businessId, name: 'Cash Basis Landlord' } })).id;

  // Approved (posted) in January: $1,000 invoice, $400 rent bill.
  const invoiceDraft = await createDraftInvoice({
    businessId,
    userId,
    input: {
      customerId,
      issueDate: new Date('2026-01-05'),
      dueDate: new Date('2026-02-04'),
      currency: 'USD',
      exchangeRate: '1',
      lines: [{ description: 'Work', quantityMilli: 1000n, unitPrice: 100000n, incomeAccountId: serviceRevenue }],
    },
  });
  const invoice = await approveInvoice({ businessId, userId, invoiceId: invoiceDraft.id });

  const billDraft = await createDraftBill({
    businessId,
    userId,
    input: {
      vendorId,
      billDate: new Date('2026-01-10'),
      dueDate: new Date('2026-02-09'),
      currency: 'USD',
      exchangeRate: '1',
      lines: [{ description: 'Rent', expenseAccountId: rentExpense, amount: 40000n }],
    },
  });
  const bill = await approveBill({ businessId, userId, billId: billDraft.id });

  // Cash actually moves in February.
  await recordPayment({
    businessId,
    userId,
    invoiceId: invoice.id,
    date: new Date('2026-02-15'),
    amount: 60000n,
    method: 'ACH',
    depositAccountId: checking,
  });
  await recordBillPayment({
    businessId,
    userId,
    billId: bill.id,
    date: new Date('2026-02-15'),
    amount: 40000n,
    method: 'ACH',
    paymentAccountId: checking,
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('cash-basis P&L', () => {
  it('accrual recognizes at approval date (January), not payment date', async () => {
    const jan = await profitAndLoss(businessId, { from: new Date('2026-01-01'), to: new Date('2026-01-31') });
    expect(jan.income.total).toBe(100000n);
    expect(jan.expenses.total).toBe(40000n);

    const feb = await profitAndLoss(businessId, { from: new Date('2026-02-01'), to: new Date('2026-02-28') });
    expect(feb.income.total).toBe(0n);
    expect(feb.expenses.total).toBe(0n);
  });

  it('cash basis recognizes at payment date (February), not approval date', async () => {
    const jan = await cashBasisProfitAndLoss(businessId, { from: new Date('2026-01-01'), to: new Date('2026-01-31') });
    expect(jan.income.total).toBe(0n);
    expect(jan.expenses.total).toBe(0n);

    const feb = await cashBasisProfitAndLoss(businessId, { from: new Date('2026-02-01'), to: new Date('2026-02-28') });
    expect(feb.income.total).toBe(60000n); // partial payment received
    expect(feb.expenses.total).toBe(40000n); // bill paid in full
    expect(feb.netIncome).toBe(20000n);
  });
});
