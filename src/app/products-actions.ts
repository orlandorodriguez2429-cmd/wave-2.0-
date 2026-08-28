'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/lib/context';
import { archiveProduct, createProduct } from '@/lib/products';
import { parseAmount } from '@/lib/money';
import type { ActionResult } from '@/app/actions';

export async function createProductAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { business } = await requireContext('EMPLOYEE');
  const name = String(formData.get('name') ?? '').trim();
  const incomeAccountId = String(formData.get('incomeAccountId') ?? '');
  const rawPrice = String(formData.get('unitPrice') ?? '0').trim() || '0';
  if (!name) return { error: 'Name is required.' };
  if (!incomeAccountId) return { error: 'Pick an income account.' };

  let unitPrice: bigint;
  try {
    unitPrice = parseAmount(rawPrice, business.functionalCurrency);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid price.' };
  }
  if (unitPrice < 0n) return { error: 'Price cannot be negative.' };

  await createProduct({
    businessId: business.id,
    name,
    description: String(formData.get('description') ?? ''),
    sku: String(formData.get('sku') ?? ''),
    unitPrice,
    incomeAccountId,
  });
  revalidatePath('/products');
  return {};
}

export async function archiveProductAction(productId: string): Promise<void> {
  const { business } = await requireContext('EMPLOYEE');
  await archiveProduct({ businessId: business.id, productId });
  revalidatePath('/products');
}
