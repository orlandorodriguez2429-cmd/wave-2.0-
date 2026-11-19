'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { LedgerValidationError } from '@/lib/ledger/validate';
import { parseAmount } from '@/lib/money';
import { parseQuantity } from '@/lib/invoicing/totals';
import type { ActionResult } from '@/app/actions';
import type { RecurrenceFrequency } from '@/generated/prisma/enums';
import type { RecurringTemplate } from '@/lib/invoicing/recurring';

const FREQUENCIES: RecurrenceFrequency[] = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];

function parseDate(value: FormDataEntryValue | null): Date | null {
  const s = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(s);
}

export async function createRecurringInvoiceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { business } = await requireContext('EMPLOYEE');
  try {
    const customerId = String(formData.get('customerId') ?? '');
    if (!customerId) return { error: 'Pick a customer.' };
    const frequency = String(formData.get('frequency') ?? 'MONTHLY') as RecurrenceFrequency;
    if (!FREQUENCIES.includes(frequency)) return { error: 'Pick a frequency.' };
    const startDate = parseDate(formData.get('startDate'));
    if (!startDate) return { error: 'Pick a first issue date.' };
    const endDate = parseDate(formData.get('endDate'));
    const dueInDays = Number(formData.get('dueInDays') ?? '30');
    const autoApprove = formData.get('autoApprove') === 'on';
    const memo = String(formData.get('memo') ?? '').trim();

    const descriptions = formData.getAll('lineDescription').map(String);
    const quantities = formData.getAll('lineQuantity').map(String);
    const prices = formData.getAll('linePrice').map(String);
    const accounts = formData.getAll('lineIncomeAccountId').map(String);
    const lines = descriptions
      .map((description, i) => ({
        description,
        quantity: quantities[i]?.trim() || '1',
        price: prices[i]?.trim() ?? '',
        incomeAccountId: accounts[i] ?? '',
      }))
      .filter((l) => l.description.trim() || l.price)
      .map((l, i) => {
        if (!l.price) throw new LedgerValidationError(`Line ${i + 1}: enter a price.`);
        if (!l.incomeAccountId) throw new LedgerValidationError(`Line ${i + 1}: pick an income account.`);
        return {
          description: l.description,
          quantityMilli: parseQuantity(l.quantity).toString(),
          unitPrice: parseAmount(l.price, business.functionalCurrency).toString(),
          incomeAccountId: l.incomeAccountId,
        };
      });
    if (lines.length === 0) return { error: 'Add at least one line.' };

    const template: RecurringTemplate = {
      currency: business.functionalCurrency,
      exchangeRate: '1',
      memo: memo || undefined,
      dueInDays: Math.max(0, Math.min(365, dueInDays)),
      lines,
    };

    await prisma.recurringInvoice.create({
      data: {
        businessId: business.id,
        customerId,
        frequency,
        nextRunDate: startDate,
        endDate,
        autoApprove,
        template,
      },
    });
    revalidatePath('/invoices/recurring');
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Something went wrong.' };
  }
}

export async function setRecurringInvoicePausedAction(recurringInvoiceId: string, paused: boolean): Promise<void> {
  const { business } = await requireContext('EMPLOYEE');
  const rec = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id: recurringInvoiceId } });
  if (rec.businessId !== business.id) throw new Error('Wrong business.');
  await prisma.recurringInvoice.update({ where: { id: recurringInvoiceId }, data: { isPaused: paused } });
  revalidatePath('/invoices/recurring');
}

export async function deleteRecurringInvoiceAction(recurringInvoiceId: string): Promise<void> {
  const { business } = await requireContext('EMPLOYEE');
  const rec = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id: recurringInvoiceId } });
  if (rec.businessId !== business.id) throw new Error('Wrong business.');
  await prisma.recurringInvoice.delete({ where: { id: recurringInvoiceId } });
  revalidatePath('/invoices/recurring');
}
