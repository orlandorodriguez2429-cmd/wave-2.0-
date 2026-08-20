'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { getCurrentContext } from '@/lib/context';
import { encryptSecret } from '@/lib/crypto';
import { parseAmount } from '@/lib/money';
import {
  createCorrection,
  deliverCopyB,
  generateDrafts,
  markReady,
  submitForms,
  updateDraftAmounts,
} from '@/lib/forms1099/forms';
import type { ActionResult } from './actions';

function err(e: unknown): ActionResult {
  return { error: e instanceof Error ? e.message : 'Something went wrong.' };
}

export async function generateFormsAction(taxYear: number): Promise<void> {
  const { user, business } = await getCurrentContext();
  await generateDrafts({ businessId: business.id, userId: user.id, taxYear });
  revalidatePath('/1099/forms');
}

export async function updateFormAmountsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  const formId = String(formData.get('formId') ?? '');
  try {
    const boxes = formData.getAll('boxNumber').map(String);
    const values = formData.getAll('boxAmount').map(String);
    const amounts: Record<string, bigint> = {};
    boxes.forEach((box, i) => {
      const raw = values[i]?.trim();
      if (raw) amounts[box] = parseAmount(raw, business.functionalCurrency);
    });
    await updateDraftAmounts({ businessId: business.id, userId: user.id, formId, amounts });
    revalidatePath(`/1099/forms/${formId}`);
    return {};
  } catch (e) {
    return err(e);
  }
}

export async function markReadyAction(formId: string): Promise<void> {
  const { user, business } = await getCurrentContext();
  await markReady({ businessId: business.id, userId: user.id, formId });
  revalidatePath(`/1099/forms/${formId}`);
  revalidatePath('/1099/forms');
}

// The ONLY path to the transmitter — invoked by the explicit
// "Submit to IRS" confirmation button, never by any job or automation.
export async function submitFormsAction(taxYear: number): Promise<void> {
  const { user, business } = await getCurrentContext();
  const ready = await prisma.form1099.findMany({
    where: { businessId: business.id, taxYear, status: 'READY' },
    select: { id: true },
  });
  if (ready.length === 0) return;
  await submitForms({
    businessId: business.id,
    userId: user.id,
    formIds: ready.map((f) => f.id),
    transmitterName: process.env.EFILE_TRANSMITTER ?? 'mock',
    confirmedByUser: true,
  });
  revalidatePath('/1099/forms');
}

export async function correctFormAction(formId: string): Promise<void> {
  const { user, business } = await getCurrentContext();
  await createCorrection({ businessId: business.id, userId: user.id, formId });
  revalidatePath('/1099/forms');
}

export async function deliverCopyBAction(formId: string, method: 'electronic' | 'mail'): Promise<void> {
  const { user, business } = await getCurrentContext();
  await deliverCopyB({ businessId: business.id, userId: user.id, formId, method });
  revalidatePath(`/1099/forms/${formId}`);
  revalidatePath('/1099/forms');
}

export async function setPayerInfoAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  const ein = String(formData.get('ein') ?? '').replace(/[^0-9]/g, '');
  if (ein && ein.length !== 9) return { error: 'EIN must be 9 digits.' };
  try {
    await prisma.business.update({
      where: { id: business.id },
      data: {
        ...(ein ? { einEncrypted: encryptSecret(ein), einLast4: ein.slice(-4) } : {}),
        legalName: String(formData.get('legalName') ?? '').trim() || business.legalName,
        taxStreet: String(formData.get('taxStreet') ?? '').trim() || null,
        taxCity: String(formData.get('taxCity') ?? '').trim() || null,
        taxState: String(formData.get('taxState') ?? '').trim().toUpperCase() || null,
        taxZip: String(formData.get('taxZip') ?? '').trim() || null,
      },
    });
    await prisma.auditLog.create({
      data: {
        businessId: business.id,
        userId: user.id,
        action: 'business.payer_info_updated',
        entityType: 'business',
        entityId: business.id,
        payload: { einSet: !!ein }, // never the EIN itself
      },
    });
    revalidatePath('/settings/1099');
    return {};
  } catch (e) {
    return err(e);
  }
}
