'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireContext } from '@/lib/context';
import { DUTIES } from '@/lib/compliance';

function dateOrNull(v: FormDataEntryValue | null): Date | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function audit(businessId: string, userId: string, action: string, entityId: string, payload: object) {
  await prisma.auditLog.create({ data: { businessId, userId, action, entityType: 'compliance', entityId, payload } });
}

/** Record that a Safeguards duty was done (append-only). */
export async function recordDutyAction(formData: FormData): Promise<void> {
  const { user, business } = await requireContext('OWNER');
  const item = String(formData.get('item') ?? '');
  if (!DUTIES.some((d) => d.key === item)) throw new Error('Unknown item.');
  const doneAt = dateOrNull(formData.get('doneAt')) ?? new Date();
  if (doneAt > new Date(Date.now() + 86_400_000)) throw new Error('That date is in the future.');
  const note = String(formData.get('note') ?? '').slice(0, 1000);
  const ev = await prisma.complianceEvent.create({ data: { item, doneAt, note, userId: user.id } });
  await audit(business.id, user.id, 'compliance.duty_done', ev.id, { item, doneAt: doneAt.toISOString().slice(0, 10) });
  revalidatePath('/compliance');
}

export async function createIncidentAction(formData: FormData): Promise<void> {
  const { user, business } = await requireContext('OWNER');
  const description = String(formData.get('description') ?? '').trim().slice(0, 4000);
  if (!description) throw new Error('Describe what happened.');
  const inc = await prisma.complianceIncident.create({
    data: {
      discoveredAt: dateOrNull(formData.get('discoveredAt')) ?? new Date(),
      description,
      peopleAffected: Math.max(0, Number(formData.get('peopleAffected') ?? 0) || 0),
      floridaResidents: Math.max(0, Number(formData.get('floridaResidents') ?? 0) || 0),
      unencryptedData: formData.get('unencryptedData') === 'on',
      createdById: user.id,
    },
  });
  await audit(business.id, user.id, 'compliance.incident_opened', inc.id, {});
  redirect(`/compliance/incidents/${inc.id}`);
}

export async function updateIncidentAction(id: string, formData: FormData): Promise<void> {
  const { user, business } = await requireContext('OWNER');
  const data = {
    peopleAffected: Math.max(0, Number(formData.get('peopleAffected') ?? 0) || 0),
    floridaResidents: Math.max(0, Number(formData.get('floridaResidents') ?? 0) || 0),
    unencryptedData: formData.get('unencryptedData') === 'on',
    containedAt: dateOrNull(formData.get('containedAt')),
    individualsNotifiedAt: dateOrNull(formData.get('individualsNotifiedAt')),
    ftcNotifiedAt: dateOrNull(formData.get('ftcNotifiedAt')),
    floridaAgNotifiedAt: dateOrNull(formData.get('floridaAgNotifiedAt')),
    closedAt: dateOrNull(formData.get('closedAt')),
    notes: String(formData.get('notes') ?? '').slice(0, 8000),
  };
  await prisma.complianceIncident.update({ where: { id }, data });
  await audit(business.id, user.id, 'compliance.incident_updated', id, { closed: !!data.closedAt });
  revalidatePath(`/compliance/incidents/${id}`);
  revalidatePath('/compliance');
}
