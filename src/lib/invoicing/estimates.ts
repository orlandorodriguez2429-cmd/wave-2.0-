import { Prisma } from '@/generated/prisma/client';
import type { EstimateStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/db';
import { LedgerValidationError } from '@/lib/ledger/validate';
import { createDraftInvoice, type InvoiceLineInput } from './invoices';
import { lineAmount, taxAmount } from './totals';

export interface EstimateInput {
  customerId: string;
  issueDate: Date;
  expiryDate?: Date;
  currency: string;
  exchangeRate: string;
  memo?: string;
  lines: InvoiceLineInput[];
}

export async function createEstimate(opts: { businessId: string; userId: string; input: EstimateInput }) {
  const { businessId, userId, input } = opts;
  if (input.lines.length === 0) throw new LedgerValidationError('An estimate needs at least one line.');

  return prisma.$transaction(async (tx) => {
    const taxRateIds = [...new Set(input.lines.map((l) => l.taxRateId).filter((x): x is string => !!x))];
    const taxRates = new Map(
      (await tx.taxRate.findMany({ where: { id: { in: taxRateIds }, businessId } })).map((t) => [t.id, t]),
    );
    const computed = input.lines.map((l) => {
      const amount = lineAmount(l.quantityMilli, l.unitPrice);
      const rate = l.taxRateId ? taxRates.get(l.taxRateId) : undefined;
      return { ...l, amount, taxAmount: rate ? taxAmount(amount, rate.ratePpm) : 0n };
    });
    const subtotal = computed.reduce((s, l) => s + l.amount, 0n);
    const taxTotal = computed.reduce((s, l) => s + l.taxAmount, 0n);

    const { nextEstimateNumber } = await tx.business.update({
      where: { id: businessId },
      data: { nextEstimateNumber: { increment: 1 } },
      select: { nextEstimateNumber: true },
    });

    const estimate = await tx.estimate.create({
      data: {
        businessId,
        customerId: input.customerId,
        number: nextEstimateNumber - 1,
        issueDate: input.issueDate,
        expiryDate: input.expiryDate ?? null,
        currency: input.currency,
        exchangeRate: new Prisma.Decimal(input.exchangeRate),
        memo: input.memo?.trim() || null,
        subtotal,
        taxTotal,
        total: subtotal + taxTotal,
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
      include: { lines: true },
    });
    await tx.auditLog.create({
      data: {
        businessId,
        userId,
        action: 'estimate.created',
        entityType: 'estimate',
        entityId: estimate.id,
        payload: { number: estimate.number, total: estimate.total.toString() },
      },
    });
    return estimate;
  });
}

export async function setEstimateStatus(opts: {
  businessId: string;
  userId: string;
  estimateId: string;
  status: Extract<EstimateStatus, 'SENT' | 'ACCEPTED' | 'DECLINED'>;
}) {
  const estimate = await prisma.estimate.findUniqueOrThrow({ where: { id: opts.estimateId } });
  if (estimate.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (estimate.status === 'CONVERTED') throw new LedgerValidationError('Estimate already converted.');
  const updated = await prisma.estimate.update({ where: { id: estimate.id }, data: { status: opts.status } });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: `estimate.${opts.status.toLowerCase()}`,
      entityType: 'estimate',
      entityId: estimate.id,
      payload: { number: estimate.number },
    },
  });
  return updated;
}

/** Convert an estimate into a draft invoice carrying its lines over verbatim. */
export async function convertEstimateToInvoice(opts: {
  businessId: string;
  userId: string;
  estimateId: string;
  issueDate?: Date;
  dueInDays?: number;
}) {
  const estimate = await prisma.estimate.findUniqueOrThrow({
    where: { id: opts.estimateId },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  });
  if (estimate.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (estimate.status === 'CONVERTED') throw new LedgerValidationError('Estimate already converted.');
  if (estimate.status === 'DECLINED') throw new LedgerValidationError('Declined estimates cannot be converted.');

  const issueDate = opts.issueDate ?? new Date();
  const dueDate = new Date(issueDate.getTime() + (opts.dueInDays ?? 30) * 86400_000);

  const invoice = await createDraftInvoice({
    businessId: opts.businessId,
    userId: opts.userId,
    estimateId: estimate.id,
    input: {
      customerId: estimate.customerId,
      issueDate,
      dueDate,
      currency: estimate.currency,
      exchangeRate: estimate.exchangeRate.toString(),
      memo: estimate.memo ?? undefined,
      lines: estimate.lines.map((l) => ({
        description: l.description,
        quantityMilli: l.quantityMilli,
        unitPrice: l.unitPrice,
        incomeAccountId: l.incomeAccountId,
        taxRateId: l.taxRateId ?? undefined,
      })),
    },
  });

  await prisma.estimate.update({ where: { id: estimate.id }, data: { status: 'CONVERTED' } });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'estimate.converted',
      entityType: 'estimate',
      entityId: estimate.id,
      payload: { number: estimate.number, invoiceNumber: invoice.number },
    },
  });
  return invoice;
}
