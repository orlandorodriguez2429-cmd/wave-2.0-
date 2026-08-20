import { Prisma } from '@/generated/prisma/client';
import type { PaymentMethod } from '@/generated/prisma/enums';
import { prisma } from '@/lib/db';
import { systemAccount } from '@/lib/ledger/accounts';
import { createAndPostEntry, reverseEntry } from '@/lib/ledger/post';
import { LedgerValidationError } from '@/lib/ledger/validate';
import { lineAmount, taxAmount } from './totals';

export interface InvoiceLineInput {
  description: string;
  quantityMilli: bigint;
  /** Minor units of the invoice currency. */
  unitPrice: bigint;
  incomeAccountId: string;
  taxRateId?: string;
}

export interface InvoiceDraftInput {
  customerId: string;
  issueDate: Date;
  dueDate: Date;
  currency: string;
  exchangeRate: string;
  memo?: string;
  terms?: string;
  lines: InvoiceLineInput[];
}

interface ComputedLine extends InvoiceLineInput {
  amount: bigint;
  taxAmount: bigint;
}

async function computeLines(
  db: Prisma.TransactionClient,
  businessId: string,
  lines: InvoiceLineInput[],
): Promise<{ computed: ComputedLine[]; subtotal: bigint; taxTotal: bigint }> {
  if (lines.length === 0) throw new LedgerValidationError('An invoice needs at least one line.');
  const taxRateIds = [...new Set(lines.map((l) => l.taxRateId).filter((x): x is string => !!x))];
  const taxRates = new Map(
    (await db.taxRate.findMany({ where: { id: { in: taxRateIds }, businessId } })).map((t) => [t.id, t]),
  );

  const computed = lines.map((line, i) => {
    if (!line.description.trim()) throw new LedgerValidationError(`Line ${i + 1}: description required.`);
    if (line.quantityMilli <= 0n) throw new LedgerValidationError(`Line ${i + 1}: quantity must be positive.`);
    if (line.unitPrice < 0n) throw new LedgerValidationError(`Line ${i + 1}: unit price cannot be negative.`);
    const amount = lineAmount(line.quantityMilli, line.unitPrice);
    let tax = 0n;
    if (line.taxRateId) {
      const rate = taxRates.get(line.taxRateId);
      if (!rate) throw new LedgerValidationError(`Line ${i + 1}: unknown tax rate.`);
      tax = taxAmount(amount, rate.ratePpm);
    }
    return { ...line, amount, taxAmount: tax };
  });

  const subtotal = computed.reduce((s, l) => s + l.amount, 0n);
  const taxTotal = computed.reduce((s, l) => s + l.taxAmount, 0n);
  if (subtotal + taxTotal <= 0n) throw new LedgerValidationError('Invoice total must be positive.');
  return { computed, subtotal, taxTotal };
}

export async function createDraftInvoice(opts: {
  businessId: string;
  userId: string;
  input: InvoiceDraftInput;
  estimateId?: string;
  recurringInvoiceId?: string;
}) {
  const { businessId, userId, input } = opts;
  return prisma.$transaction(async (tx) => {
    const { computed, subtotal, taxTotal } = await computeLines(tx, businessId, input.lines);
    const { nextInvoiceNumber } = await tx.business.update({
      where: { id: businessId },
      data: { nextInvoiceNumber: { increment: 1 } },
      select: { nextInvoiceNumber: true },
    });
    const invoice = await tx.invoice.create({
      data: {
        businessId,
        customerId: input.customerId,
        number: nextInvoiceNumber - 1,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        currency: input.currency,
        exchangeRate: new Prisma.Decimal(input.exchangeRate),
        memo: input.memo?.trim() || null,
        terms: input.terms?.trim() || null,
        subtotal,
        taxTotal,
        total: subtotal + taxTotal,
        estimateId: opts.estimateId,
        recurringInvoiceId: opts.recurringInvoiceId,
        lines: {
          create: computed.map((l, i) => ({
            lineNo: i + 1,
            description: l.description.trim(),
            quantityMilli: l.quantityMilli,
            unitPrice: l.unitPrice,
            amount: l.amount,
            incomeAccountId: l.incomeAccountId,
            taxRateId: l.taxRateId ?? null,
            taxAmount: l.taxAmount,
          })),
        },
      },
      include: { lines: true, customer: true },
    });
    await tx.auditLog.create({
      data: {
        businessId,
        userId,
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: invoice.id,
        payload: { number: invoice.number, total: invoice.total.toString(), currency: input.currency },
      },
    });
    return invoice;
  });
}

/**
 * Approve a draft: post the accrual entry (debit A/R; credit income per line,
 * tax liability per rate) and open the invoice for payment.
 */
export async function approveInvoice(opts: { businessId: string; userId: string; invoiceId: string }) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: opts.invoiceId },
    include: { lines: { include: { taxRate: true }, orderBy: { lineNo: 'asc' } } },
  });
  if (invoice.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (invoice.status !== 'DRAFT') throw new LedgerValidationError('Only draft invoices can be approved.');

  const ar = await systemAccount(prisma, opts.businessId, 'accounts_receivable');

  const incomeByAccount = new Map<string, bigint>();
  const taxByAccount = new Map<string, bigint>();
  for (const line of invoice.lines) {
    incomeByAccount.set(line.incomeAccountId, (incomeByAccount.get(line.incomeAccountId) ?? 0n) + line.amount);
    if (line.taxRate && line.taxAmount > 0n) {
      taxByAccount.set(
        line.taxRate.liabilityAccountId,
        (taxByAccount.get(line.taxRate.liabilityAccountId) ?? 0n) + line.taxAmount,
      );
    }
  }

  const entry = await createAndPostEntry({
    businessId: opts.businessId,
    userId: opts.userId,
    source: 'INVOICE',
    input: {
      date: invoice.issueDate,
      memo: `Invoice #${invoice.number}`,
      currency: invoice.currency,
      exchangeRate: invoice.exchangeRate.toString(),
      lines: [
        { accountId: ar.id, direction: 'DEBIT', amount: invoice.total, description: `Invoice #${invoice.number}` },
        ...[...incomeByAccount.entries()].map(([accountId, amount]) => ({
          accountId,
          direction: 'CREDIT' as const,
          amount,
        })),
        ...[...taxByAccount.entries()].map(([accountId, amount]) => ({
          accountId,
          direction: 'CREDIT' as const,
          amount,
          description: 'Sales tax collected',
        })),
      ],
    },
  });

  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: 'OPEN', journalEntryId: entry.id },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'invoice.approved',
      entityType: 'invoice',
      entityId: invoice.id,
      payload: { number: invoice.number, journalEntryId: entry.id },
    },
  });
  return updated;
}

export async function paidTotal(invoiceId: string): Promise<bigint> {
  const payments = await prisma.payment.findMany({ where: { invoiceId } });
  return payments.reduce((s, p) => s + p.amount, 0n);
}

/**
 * Record a (possibly partial) payment: debit the deposit account, credit A/R.
 * Marks the invoice PAID when the running total reaches the invoice total.
 * FX note: payments post at the invoice's exchange rate; realized gain/loss
 * on rate movement is deferred to a later phase.
 */
export async function recordPayment(opts: {
  businessId: string;
  userId: string;
  invoiceId: string;
  date: Date;
  amount: bigint;
  method: PaymentMethod;
  depositAccountId: string;
  memo?: string;
}) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: opts.invoiceId } });
  if (invoice.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (invoice.status !== 'OPEN') throw new LedgerValidationError('Payments can only be recorded on open invoices.');
  if (opts.amount <= 0n) throw new LedgerValidationError('Payment amount must be positive.');

  const alreadyPaid = await paidTotal(invoice.id);
  const remaining = invoice.total - alreadyPaid;
  if (opts.amount > remaining) {
    throw new LedgerValidationError(
      `Payment exceeds the remaining balance (${remaining} minor units outstanding).`,
    );
  }

  const ar = await systemAccount(prisma, opts.businessId, 'accounts_receivable');
  const entry = await createAndPostEntry({
    businessId: opts.businessId,
    userId: opts.userId,
    source: 'PAYMENT',
    input: {
      date: opts.date,
      memo: `Payment on invoice #${invoice.number}`,
      currency: invoice.currency,
      exchangeRate: invoice.exchangeRate.toString(),
      lines: [
        { accountId: opts.depositAccountId, direction: 'DEBIT', amount: opts.amount },
        { accountId: ar.id, direction: 'CREDIT', amount: opts.amount, description: `Invoice #${invoice.number}` },
      ],
    },
  });

  const payment = await prisma.payment.create({
    data: {
      businessId: opts.businessId,
      invoiceId: invoice.id,
      date: opts.date,
      amount: opts.amount,
      method: opts.method,
      memo: opts.memo?.trim() || null,
      depositAccountId: opts.depositAccountId,
      journalEntryId: entry.id,
    },
  });

  if (alreadyPaid + opts.amount >= invoice.total) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
  }
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'invoice.payment_recorded',
      entityType: 'invoice',
      entityId: invoice.id,
      payload: { number: invoice.number, amount: opts.amount.toString(), method: opts.method },
    },
  });
  return payment;
}

/** Void an open, unpaid invoice by reversing its ledger entry. */
export async function voidInvoice(opts: { businessId: string; userId: string; invoiceId: string }) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: opts.invoiceId },
    include: { payments: true },
  });
  if (invoice.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (invoice.status !== 'OPEN') throw new LedgerValidationError('Only open invoices can be voided.');
  if (invoice.payments.length > 0) {
    throw new LedgerValidationError('This invoice has payments; refund/reverse those first.');
  }
  if (!invoice.journalEntryId) throw new LedgerValidationError('Invoice has no ledger entry.');

  const reversal = await reverseEntry({
    businessId: opts.businessId,
    userId: opts.userId,
    entryId: invoice.journalEntryId,
    memo: `Void invoice #${invoice.number}`,
  });
  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: 'VOID', voidJournalEntryId: reversal.id },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'invoice.voided',
      entityType: 'invoice',
      entityId: invoice.id,
      payload: { number: invoice.number, reversalEntryId: reversal.id },
    },
  });
  return updated;
}

/** Drafts never touched the ledger, so they can simply be deleted. */
export async function deleteDraftInvoice(opts: { businessId: string; userId: string; invoiceId: string }) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: opts.invoiceId } });
  if (invoice.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (invoice.status !== 'DRAFT') throw new LedgerValidationError('Only drafts can be deleted.');
  await prisma.invoice.delete({ where: { id: invoice.id } });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'invoice.draft_deleted',
      entityType: 'invoice',
      entityId: invoice.id,
      payload: { number: invoice.number },
    },
  });
}
