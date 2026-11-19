'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireContext } from '@/lib/context';
import { LedgerValidationError } from '@/lib/ledger/validate';
import { parseAmount } from '@/lib/money';
import { approveBill, createDraftBill, recordBillPayment, voidBill, type BillLineInput } from '@/lib/bills';
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

export async function createBillAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await requireContext('EMPLOYEE');
  try {
    const currency = String(formData.get('currency') ?? business.functionalCurrency);
    const accounts = formData.getAll('lineAccountId').map(String);
    const amounts = formData.getAll('lineAmount').map(String);
    const descriptions = formData.getAll('lineDescription').map(String);
    const lines: BillLineInput[] = accounts
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

    const bill = await createDraftBill({
      businessId: business.id,
      userId: user.id,
      input: {
        vendorId: String(formData.get('vendorId') ?? ''),
        billDate: parseDate(formData.get('billDate'), 'Bill date'),
        dueDate: parseDate(formData.get('dueDate'), 'Due date'),
        currency,
        exchangeRate: String(formData.get('exchangeRate') ?? '1').trim() || '1',
        memo: String(formData.get('memo') ?? ''),
        lines,
      },
    });
    revalidatePath('/bills');
    redirect(`/bills/${bill.id}`);
  } catch (err) {
    return errorResult(err);
  }
}

export async function approveBillAction(billId: string): Promise<void> {
  const { user, business } = await requireContext('ACCOUNTANT');
  await approveBill({ businessId: business.id, userId: user.id, billId });
  revalidatePath(`/bills/${billId}`);
  revalidatePath('/bills');
  revalidatePath('/reports/aged-payables');
}

export async function voidBillAction(billId: string): Promise<void> {
  const { user, business } = await requireContext('ACCOUNTANT');
  await voidBill({ businessId: business.id, userId: user.id, billId });
  revalidatePath(`/bills/${billId}`);
  revalidatePath('/bills');
  revalidatePath('/reports/aged-payables');
}

export async function recordBillPaymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await requireContext('ACCOUNTANT');
  const billId = String(formData.get('billId') ?? '');
  try {
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    const methodRaw = String(formData.get('method') ?? 'OTHER') as PaymentMethod;
    await recordBillPayment({
      businessId: business.id,
      userId: user.id,
      billId,
      date: parseDate(formData.get('date'), 'Payment date'),
      amount: parseAmount(String(formData.get('amount') ?? ''), bill.currency),
      method: PAYMENT_METHODS.includes(methodRaw) ? methodRaw : 'OTHER',
      paymentAccountId: String(formData.get('paymentAccountId') ?? ''),
      memo: String(formData.get('memo') ?? ''),
    });
    revalidatePath(`/bills/${billId}`);
    revalidatePath('/bills');
    revalidatePath('/reports/aged-payables');
    return {};
  } catch (err) {
    return errorResult(err);
  }
}
