import { Prisma } from '@/generated/prisma/client';
import type { PaymentMethod } from '@/generated/prisma/enums';
import { prisma } from '@/lib/db';
import { systemAccount } from '@/lib/ledger/accounts';
import { createAndPostEntry, reverseEntry } from '@/lib/ledger/post';
import { LedgerValidationError } from '@/lib/ledger/validate';

// Vendor bills: enter-now-pay-later, the AP mirror of Invoice/Payment.
// Approval posts Dr Expense / Cr Accounts Payable; each payment posts
// Dr Accounts Payable / Cr Cash. This is what makes Aged Payables real
// instead of a placeholder — Expense (immediate payment) still exists
// separately for money that's already gone out the door.

export interface BillLineInput {
  expenseAccountId: string;
  amount: bigint;
  description?: string;
}

export interface BillDraftInput {
  vendorId: string;
  billDate: Date;
  dueDate: Date;
  currency: string;
  exchangeRate: string;
  memo?: string;
  lines: BillLineInput[];
}

export async function createDraftBill(opts: { businessId: string; userId: string; input: BillDraftInput }) {
  const { businessId, userId, input } = opts;
  if (input.lines.length === 0) throw new LedgerValidationError('A bill needs at least one line.');
  if (input.lines.some((l) => l.amount <= 0n)) {
    throw new LedgerValidationError('Bill line amounts must be positive.');
  }
  const total = input.lines.reduce((s, l) => s + l.amount, 0n);

  return prisma.$transaction(async (tx) => {
    const { nextBillNumber } = await tx.business.update({
      where: { id: businessId },
      data: { nextBillNumber: { increment: 1 } },
      select: { nextBillNumber: true },
    });
    const bill = await tx.bill.create({
      data: {
        businessId,
        vendorId: input.vendorId,
        number: nextBillNumber - 1,
        billDate: input.billDate,
        dueDate: input.dueDate,
        currency: input.currency,
        exchangeRate: new Prisma.Decimal(input.exchangeRate),
        memo: input.memo?.trim() || null,
        total,
        lines: {
          create: input.lines.map((l, i) => ({
            lineNo: i + 1,
            description: l.description?.trim() || null,
            expenseAccountId: l.expenseAccountId,
            amount: l.amount,
          })),
        },
      },
      include: { lines: true, vendor: true },
    });
    await tx.auditLog.create({
      data: {
        businessId,
        userId,
        action: 'bill.created',
        entityType: 'bill',
        entityId: bill.id,
        payload: { number: bill.number, total: total.toString(), currency: input.currency, vendorId: input.vendorId },
      },
    });
    return bill;
  });
}

/** Approve a draft: post Dr Expense (per line) / Cr Accounts Payable, open it for payment. */
export async function approveBill(opts: { businessId: string; userId: string; billId: string }) {
  const bill = await prisma.bill.findUniqueOrThrow({
    where: { id: opts.billId },
    include: { lines: { orderBy: { lineNo: 'asc' } }, vendor: true },
  });
  if (bill.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (bill.status !== 'DRAFT') throw new LedgerValidationError('Only draft bills can be approved.');

  const ap = await systemAccount(prisma, opts.businessId, 'accounts_payable');

  const entry = await createAndPostEntry({
    businessId: opts.businessId,
    userId: opts.userId,
    source: 'BILL',
    input: {
      date: bill.billDate,
      memo: `Bill #${bill.number} — ${bill.vendor.name}`,
      currency: bill.currency,
      exchangeRate: bill.exchangeRate.toString(),
      lines: [
        ...bill.lines.map((l) => ({
          accountId: l.expenseAccountId,
          direction: 'DEBIT' as const,
          amount: l.amount,
          description: l.description ?? undefined,
        })),
        { accountId: ap.id, direction: 'CREDIT' as const, amount: bill.total, description: `Bill #${bill.number}` },
      ],
    },
  });

  const updated = await prisma.bill.update({
    where: { id: bill.id },
    data: { status: 'OPEN', journalEntryId: entry.id },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'bill.approved',
      entityType: 'bill',
      entityId: bill.id,
      payload: { number: bill.number, journalEntryId: entry.id },
    },
  });
  return updated;
}

export async function billPaidTotal(billId: string): Promise<bigint> {
  const payments = await prisma.billPayment.findMany({ where: { billId } });
  return payments.reduce((s, p) => s + p.amount, 0n);
}

/** Record a (possibly partial) payment: debit A/P, credit the payment account. */
export async function recordBillPayment(opts: {
  businessId: string;
  userId: string;
  billId: string;
  date: Date;
  amount: bigint;
  method: PaymentMethod;
  paymentAccountId: string;
  memo?: string;
}) {
  const bill = await prisma.bill.findUniqueOrThrow({ where: { id: opts.billId } });
  if (bill.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (bill.status !== 'OPEN') throw new LedgerValidationError('Payments can only be recorded on open bills.');
  if (opts.amount <= 0n) throw new LedgerValidationError('Payment amount must be positive.');

  const alreadyPaid = await billPaidTotal(bill.id);
  const remaining = bill.total - alreadyPaid;
  if (opts.amount > remaining) {
    throw new LedgerValidationError(`Payment exceeds the remaining balance (${remaining} minor units outstanding).`);
  }

  const ap = await systemAccount(prisma, opts.businessId, 'accounts_payable');
  const entry = await createAndPostEntry({
    businessId: opts.businessId,
    userId: opts.userId,
    source: 'BILL_PAYMENT',
    input: {
      date: opts.date,
      memo: `Payment on bill #${bill.number}`,
      currency: bill.currency,
      exchangeRate: bill.exchangeRate.toString(),
      lines: [
        { accountId: ap.id, direction: 'DEBIT', amount: opts.amount, description: `Bill #${bill.number}` },
        { accountId: opts.paymentAccountId, direction: 'CREDIT', amount: opts.amount },
      ],
    },
  });

  const payment = await prisma.billPayment.create({
    data: {
      businessId: opts.businessId,
      billId: bill.id,
      date: opts.date,
      amount: opts.amount,
      method: opts.method,
      memo: opts.memo?.trim() || null,
      paymentAccountId: opts.paymentAccountId,
      journalEntryId: entry.id,
    },
  });

  if (alreadyPaid + opts.amount >= bill.total) {
    await prisma.bill.update({ where: { id: bill.id }, data: { status: 'PAID' } });
  }
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'bill.payment_recorded',
      entityType: 'bill',
      entityId: bill.id,
      payload: { number: bill.number, amount: opts.amount.toString(), method: opts.method },
    },
  });
  return payment;
}

/** Void an open, unpaid bill by reversing its ledger entry. */
export async function voidBill(opts: { businessId: string; userId: string; billId: string }) {
  const bill = await prisma.bill.findUniqueOrThrow({
    where: { id: opts.billId },
    include: { payments: true },
  });
  if (bill.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (bill.status !== 'OPEN') throw new LedgerValidationError('Only open bills can be voided.');
  if (bill.payments.length > 0) throw new LedgerValidationError('Cannot void a bill with payments recorded — reverse the payments first.');
  if (!bill.journalEntryId) throw new LedgerValidationError('Bill has no ledger entry.');

  const reversal = await reverseEntry({
    businessId: opts.businessId,
    userId: opts.userId,
    entryId: bill.journalEntryId,
    memo: `Void bill #${bill.number}`,
  });
  const updated = await prisma.bill.update({
    where: { id: bill.id },
    data: { status: 'VOID', voidJournalEntryId: reversal.id },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'bill.voided',
      entityType: 'bill',
      entityId: bill.id,
      payload: { number: bill.number, reversalEntryId: reversal.id },
    },
  });
  return updated;
}
