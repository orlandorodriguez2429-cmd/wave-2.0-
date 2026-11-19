'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireContext } from '@/lib/context';
import { closeMonth, reopenMonth } from '@/lib/months';
import type { ActionResult } from './actions';

function fail(err: unknown): ActionResult {
  return { error: err instanceof Error ? err.message : 'Something went wrong.' };
}

export async function closeMonthAction(month: string): Promise<void> {
  const { user, business } = await requireContext('ACCOUNTANT');
  await closeMonth({ businessId: business.id, userId: user.id, month });
  revalidatePath('/close');
  revalidatePath('/');
}

export async function reopenMonthAction(month: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business, role } = await requireContext('ACCOUNTANT');
  try {
    await reopenMonth({ businessId: business.id, userId: user.id, role, month, reason: String(formData.get('reason') ?? '') });
    revalidatePath('/close');
    revalidatePath('/');
    return {};
  } catch (err) {
    return fail(err);
  }
}

export async function saveBooksSettingsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await requireContext('ACCOUNTANT');
  const start = String(formData.get('booksStart') ?? '').trim(); // YYYY-MM
  const businessType = String(formData.get('businessType') ?? '').trim().slice(0, 80);
  if (start && !/^\d{4}-\d{2}$/.test(start)) return { error: 'Pick the first month as YYYY-MM.' };
  const booksStartDate = start ? new Date(`${start}-01T00:00:00Z`) : null;
  if (booksStartDate && business.booksClosedThrough && booksStartDate > business.booksClosedThrough) {
    // fine: start after the lock
  }
  await prisma.business.update({ where: { id: business.id }, data: { booksStartDate, businessType: businessType || null } });
  await prisma.auditLog.create({
    data: {
      businessId: business.id,
      userId: user.id,
      action: 'business.books_settings_updated',
      entityType: 'business',
      entityId: business.id,
      payload: { booksStart: start || null, businessType: businessType || null },
    },
  });
  revalidatePath('/close');
  return {};
}
