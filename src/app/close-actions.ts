'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireContext } from '@/lib/context';
import type { ActionResult } from './actions';

// Default month-end close checklist. Items are editable state on the row.
const DEFAULT_CHECKLIST = [
  { key: 'bank_rec', label: 'Reconcile every bank & credit card account for the period', done: false },
  { key: 'uncategorized', label: 'Clear all pending imported bank transactions', done: false },
  { key: 'ar_review', label: 'Review aged receivables; chase or write off stale invoices', done: false },
  { key: 'expenses', label: 'All receipts attached and expenses categorized', done: false },
  { key: 'sales_tax', label: 'Review sales tax collected vs remitted', done: false },
  { key: 'pnl_review', label: 'Review P&L vs prior period for anomalies', done: false },
  { key: 'bs_review', label: 'Review balance sheet account balances', done: false },
  { key: 'vendor_1099', label: 'Vendor payments coded to the right 1099 boxes; W-9s on file', done: false },
];

type ChecklistItem = { key: string; label: string; done: boolean };

export async function startPeriodCloseAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await requireContext('ACCOUNTANT');
  const end = String(formData.get('periodEnd') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return { error: 'Pick the period end date.' };
  const periodEnd = new Date(end);
  if (business.booksClosedThrough && periodEnd <= business.booksClosedThrough) {
    return { error: 'That period is already closed.' };
  }
  try {
    const close = await prisma.periodClose.create({
      data: { businessId: business.id, periodEnd, checklist: DEFAULT_CHECKLIST },
    });
    await prisma.auditLog.create({
      data: {
        businessId: business.id,
        userId: user.id,
        action: 'period_close.started',
        entityType: 'period_close',
        entityId: close.id,
        payload: { periodEnd: end },
      },
    });
    revalidatePath('/close');
    return {};
  } catch {
    return { error: 'A close for that period end already exists.' };
  }
}

export async function toggleChecklistItemAction(closeId: string, key: string): Promise<void> {
  const { business } = await requireContext('ACCOUNTANT');
  const close = await prisma.periodClose.findUniqueOrThrow({ where: { id: closeId } });
  if (close.businessId !== business.id) throw new Error('Wrong business.');
  if (close.status !== 'OPEN') throw new Error('Period is already closed.');
  const checklist = (close.checklist as ChecklistItem[]).map((item) =>
    item.key === key ? { ...item, done: !item.done } : item,
  );
  await prisma.periodClose.update({ where: { id: closeId }, data: { checklist } });
  revalidatePath('/close');
}

export async function closePeriodAction(closeId: string): Promise<void> {
  const { user, business } = await requireContext('ACCOUNTANT');
  const close = await prisma.periodClose.findUniqueOrThrow({ where: { id: closeId } });
  if (close.businessId !== business.id) throw new Error('Wrong business.');
  if (close.status !== 'OPEN') throw new Error('Already closed.');
  const checklist = close.checklist as ChecklistItem[];
  const open = checklist.filter((i) => !i.done);
  if (open.length > 0) {
    throw new Error(`Finish the checklist first — ${open.length} item(s) remain.`);
  }
  await prisma.$transaction([
    prisma.periodClose.update({
      where: { id: closeId },
      data: { status: 'CLOSED', closedAt: new Date(), closedById: user.id },
    }),
    prisma.business.update({
      where: { id: business.id },
      data: { booksClosedThrough: close.periodEnd },
    }),
    prisma.auditLog.create({
      data: {
        businessId: business.id,
        userId: user.id,
        action: 'period_close.closed',
        entityType: 'period_close',
        entityId: closeId,
        payload: { periodEnd: close.periodEnd.toISOString().slice(0, 10) },
      },
    }),
  ]);
  revalidatePath('/close');
}

/** Owner-only: reopen the latest closed period (rolls the lock back). */
export async function reopenPeriodAction(closeId: string): Promise<void> {
  const { user, business } = await requireContext('OWNER');
  const close = await prisma.periodClose.findUniqueOrThrow({ where: { id: closeId } });
  if (close.businessId !== business.id) throw new Error('Wrong business.');
  if (close.status !== 'CLOSED') throw new Error('Period is not closed.');
  const previous = await prisma.periodClose.findFirst({
    where: { businessId: business.id, status: 'CLOSED', periodEnd: { lt: close.periodEnd } },
    orderBy: { periodEnd: 'desc' },
  });
  await prisma.$transaction([
    prisma.periodClose.update({ where: { id: closeId }, data: { status: 'OPEN', closedAt: null, closedById: null } }),
    prisma.business.update({
      where: { id: business.id },
      data: { booksClosedThrough: previous?.periodEnd ?? null },
    }),
    prisma.auditLog.create({
      data: {
        businessId: business.id,
        userId: user.id,
        action: 'period_close.reopened',
        entityType: 'period_close',
        entityId: closeId,
        payload: { periodEnd: close.periodEnd.toISOString().slice(0, 10) },
      },
    }),
  ]);
  revalidatePath('/close');
}
