'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { getCurrentContext } from '@/lib/context';
import { parseAmount } from '@/lib/money';
import { requestW9, setW9Manually, type W9Data } from '@/lib/forms1099/w9';
import { recordVendorPayment } from '@/lib/forms1099/tracking';
import { BOX_BY_CODE } from '@/lib/forms1099/boxes';
import type { PaymentMethod, TaxEntityType, TinType } from '@/generated/prisma/enums';
import type { ActionResult } from './actions';

export async function requestW9Action(vendorId: string): Promise<void> {
  const { user, business } = await getCurrentContext();
  await requestW9({ businessId: business.id, userId: user.id, vendorId });
  revalidatePath(`/vendors/${vendorId}`);
  revalidatePath('/vendors');
}

function w9FromForm(formData: FormData): W9Data {
  return {
    legalName: String(formData.get('legalName') ?? ''),
    businessName: String(formData.get('businessName') ?? '') || undefined,
    taxEntityType: String(formData.get('taxEntityType') ?? 'INDIVIDUAL_SOLE_PROP') as TaxEntityType,
    tin: String(formData.get('tin') ?? ''),
    tinType: String(formData.get('tinType') ?? 'SSN') === 'EIN' ? ('EIN' as TinType) : ('SSN' as TinType),
    taxStreet: String(formData.get('taxStreet') ?? ''),
    taxCity: String(formData.get('taxCity') ?? ''),
    taxState: String(formData.get('taxState') ?? ''),
    taxZip: String(formData.get('taxZip') ?? ''),
    backupWithholding: formData.get('backupWithholding') === 'on',
    eDeliveryConsent: formData.get('eDeliveryConsent') === 'on',
  };
}

export async function enterW9Action(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  const vendorId = String(formData.get('vendorId') ?? '');
  try {
    await setW9Manually({ businessId: business.id, userId: user.id, vendorId, data: w9FromForm(formData) });
    revalidatePath(`/vendors/${vendorId}`);
    revalidatePath('/vendors');
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to save W-9.' };
  }
}

// Public contractor submission — no session; addressed by token.
export async function submitW9PublicAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const token = String(formData.get('token') ?? '');
  const certify = formData.get('certify') === 'on';
  if (!certify) return { error: 'You must certify the information is correct (per the W-9 instructions).' };
  try {
    const { submitW9ByToken } = await import('@/lib/forms1099/w9');
    await submitW9ByToken(token, w9FromForm(formData));
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to submit W-9.' };
  }
}

export async function logVendorPaymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  const vendorId = String(formData.get('vendorId') ?? '');
  try {
    const dateStr = String(formData.get('date') ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { error: 'Pick a date.' };
    const boxCode = String(formData.get('boxCode') ?? 'NEC_1');
    if (!BOX_BY_CODE.has(boxCode)) return { error: 'Pick a 1099 box.' };
    const methodRaw = String(formData.get('method') ?? 'CHECK') as PaymentMethod;
    await recordVendorPayment({
      businessId: business.id,
      userId: user.id,
      vendorId,
      date: new Date(dateStr),
      amount: parseAmount(String(formData.get('amount') ?? ''), business.functionalCurrency),
      method: ['CASH', 'CHECK', 'ACH', 'WIRE', 'CARD', 'OTHER'].includes(methodRaw) ? methodRaw : 'OTHER',
      boxCode,
      source: 'MANUAL',
      memo: String(formData.get('memo') ?? ''),
    });
    revalidatePath(`/vendors/${vendorId}`);
    revalidatePath('/1099');
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to log payment.' };
  }
}

export async function setVendorBoxAction(vendorId: string, boxCode: string): Promise<void> {
  const { user, business } = await getCurrentContext();
  if (!BOX_BY_CODE.has(boxCode)) throw new Error('Unknown box code.');
  const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } });
  if (vendor.businessId !== business.id) throw new Error('Wrong business.');
  await prisma.vendor.update({ where: { id: vendorId }, data: { defaultBoxCode: boxCode } });
  await prisma.auditLog.create({
    data: {
      businessId: business.id,
      userId: user.id,
      action: 'vendor.default_box_changed',
      entityType: 'vendor',
      entityId: vendorId,
      payload: { boxCode },
    },
  });
  revalidatePath(`/vendors/${vendorId}`);
}

export async function updateThresholdAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  const taxYear = Number(formData.get('taxYear'));
  if (!Number.isInteger(taxYear) || taxYear < 2020 || taxYear > 2100) return { error: 'Invalid tax year.' };
  try {
    const necMisc = parseAmount(String(formData.get('necMiscThreshold') ?? ''), business.functionalCurrency);
    const updated = await prisma.taxYearConfig.update({
      where: { taxYear },
      data: {
        necMiscThreshold: necMisc,
        notes: String(formData.get('notes') ?? '').trim() || null,
      },
    });
    await prisma.auditLog.create({
      data: {
        businessId: business.id,
        userId: user.id,
        action: 'tax_year_config.updated',
        entityType: 'tax_year_config',
        entityId: String(taxYear),
        payload: { necMiscThreshold: updated.necMiscThreshold.toString() },
      },
    });
    revalidatePath('/settings/1099');
    revalidatePath('/1099');
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update threshold.' };
  }
}
