import { Prisma } from '@/generated/prisma/client';
import type { PaymentMethod } from '@/generated/prisma/enums';
import { prisma } from '@/lib/db';
import { createAndPostEntry, reverseEntry } from '@/lib/ledger/post';
import { LedgerValidationError } from '@/lib/ledger/validate';

export interface ExpenseLineInput {
  expenseAccountId: string;
  amount: bigint;
  description?: string;
}

export interface ExpenseInput {
  vendorId?: string;
  date: Date;
  memo: string;
  currency: string;
  exchangeRate: string;
  /** Account credited: bank/cash account or credit-card liability. */
  paymentAccountId: string;
  /** How it was paid — from Phase 4 this drives the 1099-K card exclusion. */
  paymentMethod: PaymentMethod;
  lines: ExpenseLineInput[];
  receiptFileId?: string;
}

/** Record a paid expense: debit each expense account, credit the payment account. */
export async function createExpense(opts: { businessId: string; userId: string; input: ExpenseInput }) {
  const { businessId, userId, input } = opts;
  if (input.lines.length === 0) throw new LedgerValidationError('An expense needs at least one line.');
  if (input.lines.some((l) => l.amount <= 0n)) {
    throw new LedgerValidationError('Expense line amounts must be positive.');
  }
  const total = input.lines.reduce((s, l) => s + l.amount, 0n);

  const entry = await createAndPostEntry({
    businessId,
    userId,
    source: 'EXPENSE',
    input: {
      date: input.date,
      memo: input.memo,
      currency: input.currency,
      exchangeRate: input.exchangeRate,
      lines: [
        ...input.lines.map((l) => ({
          accountId: l.expenseAccountId,
          direction: 'DEBIT' as const,
          amount: l.amount,
          description: l.description,
        })),
        { accountId: input.paymentAccountId, direction: 'CREDIT', amount: total },
      ],
    },
  });

  const expense = await prisma.expense.create({
    data: {
      businessId,
      vendorId: input.vendorId ?? null,
      date: input.date,
      memo: input.memo.trim(),
      currency: input.currency,
      exchangeRate: new Prisma.Decimal(input.exchangeRate),
      paymentAccountId: input.paymentAccountId,
      paymentMethod: input.paymentMethod,
      total,
      journalEntryId: entry.id,
      receiptFileId: input.receiptFileId ?? null,
      lines: {
        create: input.lines.map((l, i) => ({
          lineNo: i + 1,
          description: l.description?.trim() || null,
          expenseAccountId: l.expenseAccountId,
          amount: l.amount,
        })),
      },
    },
    include: { lines: true },
  });

  await prisma.auditLog.create({
    data: {
      businessId,
      userId,
      action: 'expense.created',
      entityType: 'expense',
      entityId: expense.id,
      payload: {
        total: total.toString(),
        currency: input.currency,
        vendorId: input.vendorId ?? null,
        paymentMethod: input.paymentMethod,
      },
    },
  });
  return expense;
}

/** Reverse an expense's ledger entry and mark it deleted (rows retained). */
export async function reverseExpense(opts: { businessId: string; userId: string; expenseId: string }) {
  const expense = await prisma.expense.findUniqueOrThrow({ where: { id: opts.expenseId } });
  if (expense.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (!expense.journalEntryId) throw new LedgerValidationError('Expense has no ledger entry.');
  const reversal = await reverseEntry({
    businessId: opts.businessId,
    userId: opts.userId,
    entryId: expense.journalEntryId,
    memo: `Reverse expense: ${expense.memo}`,
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'expense.reversed',
      entityType: 'expense',
      entityId: expense.id,
      payload: { reversalEntryId: reversal.id },
    },
  });
  return reversal;
}
