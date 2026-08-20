import { z } from 'zod';
import type { RecurrenceFrequency } from '@/generated/prisma/enums';
import { prisma } from '@/lib/db';
import { approveInvoice, createDraftInvoice } from './invoices';

// Template stored as JSON on the RecurringInvoice row; validated on every run
// so a hand-edited template fails loudly instead of generating garbage.
export const recurringTemplateSchema = z.object({
  currency: z.string().length(3),
  exchangeRate: z.string().regex(/^\d+(\.\d+)?$/),
  memo: z.string().optional(),
  terms: z.string().optional(),
  dueInDays: z.number().int().min(0).max(365),
  lines: z
    .array(
      z.object({
        description: z.string().min(1),
        quantityMilli: z.string().regex(/^\d+$/),
        unitPrice: z.string().regex(/^\d+$/),
        incomeAccountId: z.string().min(1),
        taxRateId: z.string().optional(),
      }),
    )
    .min(1),
});

export type RecurringTemplate = z.infer<typeof recurringTemplateSchema>;

export function advanceDate(date: Date, frequency: RecurrenceFrequency): Date {
  const next = new Date(date);
  switch (frequency) {
    case 'WEEKLY':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'MONTHLY':
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case 'QUARTERLY':
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case 'YEARLY':
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
  }
  return next;
}

/**
 * Materialize every recurring invoice that is due as of `asOf`. Called by the
 * jobs runner (scripts/run-jobs.ts) — cron/queue infrastructure plugs in
 * there, not here. Catches per-template errors so one broken template can't
 * stall the rest.
 */
export async function runDueRecurringInvoices(asOf = new Date()) {
  const due = await prisma.recurringInvoice.findMany({
    where: { isPaused: false, nextRunDate: { lte: asOf } },
    include: { business: { include: { memberships: { where: { role: 'OWNER' }, take: 1 } } } },
  });

  const results: Array<{ recurringInvoiceId: string; invoiceNumber?: number; error?: string }> = [];
  for (const rec of due) {
    try {
      if (rec.endDate && rec.nextRunDate > rec.endDate) {
        await prisma.recurringInvoice.update({ where: { id: rec.id }, data: { isPaused: true } });
        continue;
      }
      const template = recurringTemplateSchema.parse(rec.template);
      const ownerId = rec.business.memberships[0]?.userId;
      if (!ownerId) throw new Error('Business has no owner to attribute the invoice to.');

      const issueDate = rec.nextRunDate;
      const invoice = await createDraftInvoice({
        businessId: rec.businessId,
        userId: ownerId,
        recurringInvoiceId: rec.id,
        input: {
          customerId: rec.customerId,
          issueDate,
          dueDate: new Date(issueDate.getTime() + template.dueInDays * 86400_000),
          currency: template.currency,
          exchangeRate: template.exchangeRate,
          memo: template.memo,
          terms: template.terms,
          lines: template.lines.map((l) => ({
            description: l.description,
            quantityMilli: BigInt(l.quantityMilli),
            unitPrice: BigInt(l.unitPrice),
            incomeAccountId: l.incomeAccountId,
            taxRateId: l.taxRateId,
          })),
        },
      });
      if (rec.autoApprove) {
        await approveInvoice({ businessId: rec.businessId, userId: ownerId, invoiceId: invoice.id });
      }
      await prisma.recurringInvoice.update({
        where: { id: rec.id },
        data: { nextRunDate: advanceDate(rec.nextRunDate, rec.frequency) },
      });
      results.push({ recurringInvoiceId: rec.id, invoiceNumber: invoice.number });
    } catch (err) {
      results.push({ recurringInvoiceId: rec.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
