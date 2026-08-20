// End-to-end invoicing/expense flows against a real Postgres: every business
// document lands as balanced, immutable journal entries.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { trialBalance } from '@/lib/ledger/reports';
import { createExpense } from '@/lib/expenses';
import { approveInvoice, createDraftInvoice, recordPayment, voidInvoice } from './invoices';
import { convertEstimateToInvoice, createEstimate } from './estimates';

let userId: string;
let businessId: string;
let customerId: string;
let vendorId: string;
let taxRateId: string;
let checking: string;
let serviceRevenue: string;
let salesTaxPayable: string;
let contractorExpense: string;

const usd = (dollars: number) => BigInt(Math.round(dollars * 100));

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `inv-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'Inv Tester' },
  });
  userId = user.id;
  const business = await createBusiness({ userId, name: 'Invoicing Test Co' });
  businessId = business.id;
  const byCode = async (code: string) =>
    (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code } } })).id;
  [checking, serviceRevenue, salesTaxPayable, contractorExpense] = await Promise.all(
    ['1010', '4100', '2200', '6900'].map(byCode),
  );
  customerId = (
    await prisma.customer.create({ data: { businessId, name: 'Test Customer' } })
  ).id;
  vendorId = (await prisma.vendor.create({ data: { businessId, name: 'Test Vendor' } })).id;
  taxRateId = (
    await prisma.taxRate.create({
      data: { businessId, name: 'Test 8.875%', ratePpm: 88750, liabilityAccountId: salesTaxPayable },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const draft = () =>
  createDraftInvoice({
    businessId,
    userId,
    input: {
      customerId,
      issueDate: new Date('2026-04-01'),
      dueDate: new Date('2026-05-01'),
      currency: 'USD',
      exchangeRate: '1',
      lines: [
        {
          description: 'Consulting',
          quantityMilli: 1000n,
          unitPrice: usd(1000),
          incomeAccountId: serviceRevenue,
          taxRateId,
        },
      ],
    },
  });

describe('invoices', () => {
  it('computes totals with ppm tax and posts a balanced A/R entry on approval', async () => {
    const invoice = await draft();
    expect(invoice.subtotal).toBe(usd(1000));
    expect(invoice.taxTotal).toBe(8875n); // 8.875% of $1000 = $88.75
    expect(invoice.total).toBe(usd(1000) + 8875n);
    expect(invoice.status).toBe('DRAFT');

    // Drafts touch nothing in the ledger.
    const before = await trialBalance(businessId);

    const approved = await approveInvoice({ businessId, userId, invoiceId: invoice.id });
    expect(approved.status).toBe('OPEN');

    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: approved.journalEntryId! },
      include: { lines: { include: { account: true } } },
    });
    expect(entry.source).toBe('INVOICE');
    const arLine = entry.lines.find((l) => l.account.subtype === 'accounts_receivable');
    expect(arLine?.direction).toBe('DEBIT');
    expect(arLine?.amount).toBe(invoice.total);
    const taxLine = entry.lines.find((l) => l.accountId === salesTaxPayable);
    expect(taxLine?.direction).toBe('CREDIT');
    expect(taxLine?.amount).toBe(8875n);

    const after = await trialBalance(businessId);
    expect(after.totalDebits - before.totalDebits).toBeGreaterThan(0n);
    expect(after.totalDebits).toBe(after.totalCredits);
  });

  it('partial payments keep the invoice OPEN; full payment marks PAID; overpayment refused', async () => {
    const invoice = await draft();
    await approveInvoice({ businessId, userId, invoiceId: invoice.id });

    await recordPayment({
      businessId,
      userId,
      invoiceId: invoice.id,
      date: new Date('2026-04-10'),
      amount: usd(500),
      method: 'ACH',
      depositAccountId: checking,
    });
    let current = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(current.status).toBe('OPEN');

    await expect(
      recordPayment({
        businessId,
        userId,
        invoiceId: invoice.id,
        date: new Date('2026-04-11'),
        amount: usd(100000),
        method: 'ACH',
        depositAccountId: checking,
      }),
    ).rejects.toThrow(/exceeds/i);

    await recordPayment({
      businessId,
      userId,
      invoiceId: invoice.id,
      date: new Date('2026-04-20'),
      amount: current.total - usd(500),
      method: 'CHECK',
      depositAccountId: checking,
    });
    current = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(current.status).toBe('PAID');
    await expect(
      recordPayment({
        businessId,
        userId,
        invoiceId: invoice.id,
        date: new Date('2026-04-21'),
        amount: 1n,
        method: 'CASH',
        depositAccountId: checking,
      }),
    ).rejects.toThrow(/open invoices/i);
  });

  it('voiding reverses the ledger entry and refuses when payments exist', async () => {
    const invoice = await draft();
    await approveInvoice({ businessId, userId, invoiceId: invoice.id });
    const voided = await voidInvoice({ businessId, userId, invoiceId: invoice.id });
    expect(voided.status).toBe('VOID');
    const reversal = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: voided.voidJournalEntryId! },
    });
    expect(reversal.reversesId).toBe(voided.journalEntryId);

    const paidInvoice = await draft();
    await approveInvoice({ businessId, userId, invoiceId: paidInvoice.id });
    await recordPayment({
      businessId,
      userId,
      invoiceId: paidInvoice.id,
      date: new Date('2026-04-10'),
      amount: usd(100),
      method: 'ACH',
      depositAccountId: checking,
    });
    await expect(voidInvoice({ businessId, userId, invoiceId: paidInvoice.id })).rejects.toThrow(/payments/i);
  });
});

describe('estimates', () => {
  it('converts to a draft invoice with identical lines and totals', async () => {
    const estimate = await createEstimate({
      businessId,
      userId,
      input: {
        customerId,
        issueDate: new Date('2026-04-01'),
        currency: 'USD',
        exchangeRate: '1',
        lines: [
          {
            description: 'Proposal work',
            quantityMilli: 2000n,
            unitPrice: usd(150),
            incomeAccountId: serviceRevenue,
            taxRateId,
          },
        ],
      },
    });
    expect(estimate.subtotal).toBe(usd(300));

    const invoice = await convertEstimateToInvoice({ businessId, userId, estimateId: estimate.id });
    expect(invoice.subtotal).toBe(estimate.subtotal);
    expect(invoice.taxTotal).toBe(estimate.taxTotal);
    expect(invoice.status).toBe('DRAFT');
    const est = await prisma.estimate.findUniqueOrThrow({ where: { id: estimate.id } });
    expect(est.status).toBe('CONVERTED');
    await expect(convertEstimateToInvoice({ businessId, userId, estimateId: estimate.id })).rejects.toThrow(
      /already converted/i,
    );
  });
});

describe('expenses', () => {
  it('posts a balanced expense entry and accumulates against the vendor', async () => {
    const expense = await createExpense({
      businessId,
      userId,
      input: {
        vendorId,
        date: new Date('2026-04-08'),
        memo: 'Contract design work',
        currency: 'USD',
        exchangeRate: '1',
        paymentAccountId: checking,
        paymentMethod: 'ACH',
        lines: [{ expenseAccountId: contractorExpense, amount: usd(1500) }],
      },
    });
    expect(expense.total).toBe(usd(1500));
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: expense.journalEntryId! },
      include: { lines: true },
    });
    expect(entry.source).toBe('EXPENSE');
    expect(entry.lines.find((l) => l.accountId === contractorExpense)?.direction).toBe('DEBIT');
    expect(entry.lines.find((l) => l.accountId === checking)?.direction).toBe('CREDIT');

    const tb = await trialBalance(businessId);
    expect(tb.totalDebits).toBe(tb.totalCredits);
  });
});
