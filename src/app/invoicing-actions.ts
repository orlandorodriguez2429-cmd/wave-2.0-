'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentContext } from '@/lib/context';
import { LedgerValidationError } from '@/lib/ledger/validate';
import { parseAmount } from '@/lib/money';
import { parseQuantity } from '@/lib/invoicing/totals';
import {
  approveInvoice,
  createDraftInvoice,
  deleteDraftInvoice,
  recordPayment,
  voidInvoice,
  type InvoiceLineInput,
} from '@/lib/invoicing/invoices';
import { convertEstimateToInvoice, createEstimate, setEstimateStatus } from '@/lib/invoicing/estimates';
import { createExpense, reverseExpense } from '@/lib/expenses';
import { storeUpload } from '@/lib/storage';
import type { PaymentMethod } from '@/generated/prisma/enums';
import type { ActionResult } from './actions';

const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'CHECK', 'ACH', 'WIRE', 'CARD', 'OTHER'];

function errorResult(err: unknown): ActionResult {
  if (isRedirectError(err)) throw err;
  return { error: err instanceof Error ? err.message : 'Something went wrong.' };
}

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

function parseDate(value: FormDataEntryValue | null, label: string): Date {
  const s = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new LedgerValidationError(`${label}: pick a date.`);
  return new Date(s);
}

// ---------------------------------------------------------------------------
// Customers / vendors / tax rates
// ---------------------------------------------------------------------------

export async function createCustomerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Customer name is required.' };
  const customer = await prisma.customer.create({
    data: {
      businessId: business.id,
      name,
      email: String(formData.get('email') ?? '').trim() || null,
      address: String(formData.get('address') ?? '').trim() || null,
    },
  });
  await prisma.auditLog.create({
    data: {
      businessId: business.id,
      userId: user.id,
      action: 'customer.created',
      entityType: 'customer',
      entityId: customer.id,
      payload: { name },
    },
  });
  revalidatePath('/customers');
  return {};
}

export async function createVendorAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Vendor name is required.' };
  const vendor = await prisma.vendor.create({
    data: {
      businessId: business.id,
      name,
      email: String(formData.get('email') ?? '').trim() || null,
      address: String(formData.get('address') ?? '').trim() || null,
    },
  });
  await prisma.auditLog.create({
    data: {
      businessId: business.id,
      userId: user.id,
      action: 'vendor.created',
      entityType: 'vendor',
      entityId: vendor.id,
      payload: { name },
    },
  });
  revalidatePath('/vendors');
  return {};
}

export async function createTaxRateAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  const name = String(formData.get('name') ?? '').trim();
  const jurisdiction = String(formData.get('jurisdiction') ?? '').trim() || null;
  const rateStr = String(formData.get('rate') ?? '').trim();
  const liabilityAccountId = String(formData.get('liabilityAccountId') ?? '');
  if (!name) return { error: 'Tax name is required.' };
  const m = /^(\d{1,2})(?:\.(\d{1,4}))?$/.exec(rateStr);
  if (!m) return { error: 'Rate must be a percentage like 8.875 (max 4 decimal places).' };
  const ratePpm = Number(m[1]) * 10_000 + Number((m[2] ?? '').padEnd(4, '0'));
  if (!liabilityAccountId) return { error: 'Pick the liability account for collected tax.' };

  const rate = await prisma.taxRate.create({
    data: { businessId: business.id, name, jurisdiction, ratePpm, liabilityAccountId },
  });
  await prisma.auditLog.create({
    data: {
      businessId: business.id,
      userId: user.id,
      action: 'tax_rate.created',
      entityType: 'tax_rate',
      entityId: rate.id,
      payload: { name, ratePpm },
    },
  });
  revalidatePath('/taxes');
  return {};
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

function linesFromForm(formData: FormData, currency: string): InvoiceLineInput[] {
  const descriptions = formData.getAll('lineDescription').map(String);
  const quantities = formData.getAll('lineQuantity').map(String);
  const prices = formData.getAll('linePrice').map(String);
  const accounts = formData.getAll('lineIncomeAccountId').map(String);
  const taxes = formData.getAll('lineTaxRateId').map(String);

  return descriptions
    .map((description, i) => ({
      description,
      quantity: quantities[i]?.trim() || '1',
      price: prices[i]?.trim() ?? '',
      incomeAccountId: accounts[i] ?? '',
      taxRateId: taxes[i]?.trim() || undefined,
    }))
    .filter((l) => l.description.trim() || l.price)
    .map((l, i) => {
      if (!l.incomeAccountId) throw new LedgerValidationError(`Line ${i + 1}: pick an income account.`);
      return {
        description: l.description,
        quantityMilli: parseQuantity(l.quantity),
        unitPrice: parseAmount(l.price, currency),
        incomeAccountId: l.incomeAccountId,
        taxRateId: l.taxRateId,
      };
    });
}

export async function createInvoiceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  try {
    const currency = String(formData.get('currency') ?? business.functionalCurrency);
    const invoice = await createDraftInvoice({
      businessId: business.id,
      userId: user.id,
      input: {
        customerId: String(formData.get('customerId') ?? ''),
        issueDate: parseDate(formData.get('issueDate'), 'Issue date'),
        dueDate: parseDate(formData.get('dueDate'), 'Due date'),
        currency,
        exchangeRate: String(formData.get('exchangeRate') ?? '1').trim() || '1',
        memo: String(formData.get('memo') ?? ''),
        terms: String(formData.get('terms') ?? ''),
        lines: linesFromForm(formData, currency),
      },
    });
    revalidatePath('/invoices');
    redirect(`/invoices/${invoice.id}`);
  } catch (err) {
    return errorResult(err);
  }
}

export async function approveInvoiceAction(invoiceId: string): Promise<void> {
  const { user, business } = await getCurrentContext();
  await approveInvoice({ businessId: business.id, userId: user.id, invoiceId });
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath('/invoices');
}

export async function voidInvoiceAction(invoiceId: string): Promise<void> {
  const { user, business } = await getCurrentContext();
  await voidInvoice({ businessId: business.id, userId: user.id, invoiceId });
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath('/invoices');
}

export async function deleteDraftInvoiceAction(invoiceId: string): Promise<void> {
  const { user, business } = await getCurrentContext();
  await deleteDraftInvoice({ businessId: business.id, userId: user.id, invoiceId });
  revalidatePath('/invoices');
  redirect('/invoices');
}

export async function recordPaymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  const invoiceId = String(formData.get('invoiceId') ?? '');
  try {
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const methodRaw = String(formData.get('method') ?? 'OTHER') as PaymentMethod;
    await recordPayment({
      businessId: business.id,
      userId: user.id,
      invoiceId,
      date: parseDate(formData.get('date'), 'Payment date'),
      amount: parseAmount(String(formData.get('amount') ?? ''), invoice.currency),
      method: PAYMENT_METHODS.includes(methodRaw) ? methodRaw : 'OTHER',
      depositAccountId: String(formData.get('depositAccountId') ?? ''),
      memo: String(formData.get('memo') ?? ''),
    });
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath('/invoices');
    return {};
  } catch (err) {
    return errorResult(err);
  }
}

// ---------------------------------------------------------------------------
// Recurring invoices
// ---------------------------------------------------------------------------

export async function makeRecurringAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  const invoiceId = String(formData.get('invoiceId') ?? '');
  const frequency = String(formData.get('frequency') ?? 'MONTHLY');
  const autoApprove = formData.get('autoApprove') === 'on';
  try {
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (invoice.businessId !== business.id) throw new LedgerValidationError('Wrong business.');
    if (!['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'].includes(frequency)) {
      throw new LedgerValidationError('Pick a frequency.');
    }
    const dueInDays = Math.max(
      0,
      Math.round((invoice.dueDate.getTime() - invoice.issueDate.getTime()) / 86400_000),
    );
    const rec = await prisma.recurringInvoice.create({
      data: {
        businessId: business.id,
        customerId: invoice.customerId,
        frequency: frequency as 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
        nextRunDate: parseDate(formData.get('nextRunDate'), 'First run date'),
        autoApprove,
        template: {
          currency: invoice.currency,
          exchangeRate: invoice.exchangeRate.toString(),
          memo: invoice.memo ?? undefined,
          terms: invoice.terms ?? undefined,
          dueInDays,
          lines: invoice.lines.map((l) => ({
            description: l.description,
            quantityMilli: l.quantityMilli.toString(),
            unitPrice: l.unitPrice.toString(),
            incomeAccountId: l.incomeAccountId,
            taxRateId: l.taxRateId ?? undefined,
          })),
        },
      },
    });
    await prisma.auditLog.create({
      data: {
        businessId: business.id,
        userId: user.id,
        action: 'recurring_invoice.created',
        entityType: 'recurring_invoice',
        entityId: rec.id,
        payload: { fromInvoice: invoice.number, frequency },
      },
    });
    revalidatePath(`/invoices/${invoiceId}`);
    return {};
  } catch (err) {
    return errorResult(err);
  }
}

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

export async function createEstimateAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  try {
    const currency = String(formData.get('currency') ?? business.functionalCurrency);
    const expiry = String(formData.get('expiryDate') ?? '');
    const estimate = await createEstimate({
      businessId: business.id,
      userId: user.id,
      input: {
        customerId: String(formData.get('customerId') ?? ''),
        issueDate: parseDate(formData.get('issueDate'), 'Issue date'),
        expiryDate: /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? new Date(expiry) : undefined,
        currency,
        exchangeRate: String(formData.get('exchangeRate') ?? '1').trim() || '1',
        memo: String(formData.get('memo') ?? ''),
        lines: linesFromForm(formData, currency),
      },
    });
    revalidatePath('/estimates');
    redirect(`/estimates/${estimate.id}`);
  } catch (err) {
    return errorResult(err);
  }
}

export async function setEstimateStatusAction(
  estimateId: string,
  status: 'SENT' | 'ACCEPTED' | 'DECLINED',
): Promise<void> {
  const { user, business } = await getCurrentContext();
  await setEstimateStatus({ businessId: business.id, userId: user.id, estimateId, status });
  revalidatePath(`/estimates/${estimateId}`);
  revalidatePath('/estimates');
}

export async function convertEstimateAction(estimateId: string): Promise<void> {
  const { user, business } = await getCurrentContext();
  const invoice = await convertEstimateToInvoice({ businessId: business.id, userId: user.id, estimateId });
  revalidatePath('/estimates');
  revalidatePath('/invoices');
  redirect(`/invoices/${invoice.id}`);
}

// ---------------------------------------------------------------------------
// Expenses & mileage
// ---------------------------------------------------------------------------

export async function createExpenseAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  try {
    const currency = String(formData.get('currency') ?? business.functionalCurrency);

    let receiptFileId: string | undefined;
    const receipt = formData.get('receipt');
    if (receipt instanceof File && receipt.size > 0) {
      const stored = await storeUpload({
        businessId: business.id,
        filename: receipt.name,
        mimeType: receipt.type,
        data: Buffer.from(await receipt.arrayBuffer()),
      });
      receiptFileId = stored.id;
    }

    const accounts = formData.getAll('lineAccountId').map(String);
    const amounts = formData.getAll('lineAmount').map(String);
    const descriptions = formData.getAll('lineDescription').map(String);
    const lines = accounts
      .map((expenseAccountId, i) => ({
        expenseAccountId,
        raw: amounts[i]?.trim() ?? '',
        description: descriptions[i]?.trim() || undefined,
      }))
      .filter((l) => l.expenseAccountId || l.raw)
      .map((l, i) => {
        if (!l.expenseAccountId) throw new LedgerValidationError(`Line ${i + 1}: pick an account.`);
        return {
          expenseAccountId: l.expenseAccountId,
          amount: parseAmount(l.raw, currency),
          description: l.description,
        };
      });

    const methodRaw = String(formData.get('paymentMethod') ?? 'OTHER') as PaymentMethod;
    await createExpense({
      businessId: business.id,
      userId: user.id,
      input: {
        vendorId: String(formData.get('vendorId') ?? '') || undefined,
        date: parseDate(formData.get('date'), 'Date'),
        memo: String(formData.get('memo') ?? ''),
        currency,
        exchangeRate: String(formData.get('exchangeRate') ?? '1').trim() || '1',
        paymentAccountId: String(formData.get('paymentAccountId') ?? ''),
        paymentMethod: PAYMENT_METHODS.includes(methodRaw) ? methodRaw : 'OTHER',
        lines,
        receiptFileId,
      },
    });
    revalidatePath('/expenses');
    redirect('/expenses');
  } catch (err) {
    return errorResult(err);
  }
}

export async function reverseExpenseAction(expenseId: string): Promise<void> {
  const { user, business } = await getCurrentContext();
  await reverseExpense({ businessId: business.id, userId: user.id, expenseId });
  revalidatePath('/expenses');
}

export async function createMileageAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  const milesRaw = String(formData.get('miles') ?? '').trim();
  const rateRaw = String(formData.get('ratePerMile') ?? '').trim();
  const purpose = String(formData.get('purpose') ?? '').trim();
  const m = /^(\d+)(?:\.(\d))?$/.exec(milesRaw);
  if (!m) return { error: 'Miles must be a number with at most 1 decimal place.' };
  const rateMatch = /^(\d+)(?:\.(\d{1,2}))?$/.exec(rateRaw);
  if (!rateMatch) return { error: 'Rate must be dollars per mile, e.g. 0.70.' };
  if (!purpose) return { error: 'Purpose is required.' };
  const milesTenths = Number(m[1]) * 10 + Number(m[2] ?? 0);
  const ratePerMileCents = Number(rateMatch[1]) * 100 + Number((rateMatch[2] ?? '').padEnd(2, '0'));

  try {
    const entry = await prisma.mileageEntry.create({
      data: {
        businessId: business.id,
        date: parseDate(formData.get('date'), 'Date'),
        milesTenths,
        ratePerMileCents,
        purpose,
        vehicle: String(formData.get('vehicle') ?? '').trim() || null,
      },
    });
    await prisma.auditLog.create({
      data: {
        businessId: business.id,
        userId: user.id,
        action: 'mileage.created',
        entityType: 'mileage_entry',
        entityId: entry.id,
        payload: { milesTenths, ratePerMileCents },
      },
    });
    revalidatePath('/mileage');
    return {};
  } catch (err) {
    return errorResult(err);
  }
}

// ---------------------------------------------------------------------------
// Client portal (public, token-addressed)
// ---------------------------------------------------------------------------

/**
 * Sandbox "pay online" for the client portal. Behind a PaymentProvider
 * interface this would call Stripe Checkout; without credentials it records a
 * full card payment against the first bank account, clearly labeled sandbox.
 */
export async function portalPayAction(portalToken: string): Promise<void> {
  const invoice = await prisma.invoice.findUnique({ where: { portalToken } });
  if (!invoice || invoice.status !== 'OPEN') return;
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: invoice.businessId },
    include: { memberships: { where: { role: 'OWNER' }, take: 1 } },
  });
  const deposit = await prisma.account.findFirst({
    where: { businessId: invoice.businessId, subtype: 'cash_and_bank', isArchived: false },
    orderBy: { code: 'asc' },
  });
  const ownerId = business.memberships[0]?.userId;
  if (!deposit || !ownerId) return;

  const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
  const remaining = invoice.total - payments.reduce((s, p) => s + p.amount, 0n);
  if (remaining <= 0n) return;

  await recordPayment({
    businessId: invoice.businessId,
    userId: ownerId,
    invoiceId: invoice.id,
    date: new Date(),
    amount: remaining,
    method: 'CARD',
    depositAccountId: deposit.id,
    memo: 'Client portal payment (sandbox)',
  });
  revalidatePath(`/portal/${portalToken}`);
}
