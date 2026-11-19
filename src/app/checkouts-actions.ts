'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/lib/context';
import { createCheckout, payCheckout, voidCheckout } from '@/lib/checkouts';
import { parseAmount } from '@/lib/money';
import type { ActionResult } from '@/app/actions';

export async function createCheckoutAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await requireContext('EMPLOYEE');
  const description = String(formData.get('description') ?? '').trim();
  const incomeAccountId = String(formData.get('incomeAccountId') ?? '');
  const rawAmount = String(formData.get('amount') ?? '').trim();
  if (!incomeAccountId) return { error: 'Pick an income account.' };

  try {
    const amount = parseAmount(rawAmount, business.functionalCurrency);
    await createCheckout({
      businessId: business.id,
      userId: user.id,
      input: { description, amount, currency: business.functionalCurrency, incomeAccountId },
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Something went wrong.' };
  }
  revalidatePath('/checkouts');
  return {};
}

export async function voidCheckoutAction(checkoutId: string): Promise<void> {
  const { user, business } = await requireContext('EMPLOYEE');
  await voidCheckout({ businessId: business.id, userId: user.id, checkoutId });
  revalidatePath('/checkouts');
}

/** Public, unauthenticated: the "Pay now" button on a shared checkout link. */
export async function payCheckoutAction(token: string): Promise<void> {
  await payCheckout({ token });
  revalidatePath(`/pay/${token}`);
}
