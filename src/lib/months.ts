// Month-to-month cycle. Every month from the books start date through last
// month gets one status:
//   NOT_CONNECTED  no bank feed and nothing imported for that month
//   NO_DATA        a feed exists but nothing arrived for that month
//   NEEDS_REVIEW   N transactions waiting (pending, or changed by the bank)
//   READY          everything reviewed — can be closed
//   CLOSED         locked; posting into it needs an explicit reopen
// The current month shows as IN_PROGRESS and can't be closed until it ends.
//
// Closing is sequential (the ledger lock is "closed through <date>"), is
// blocked while anything in that month or earlier is unreviewed, and is
// audit-logged. Reopening needs ACCOUNTANT or OWNER plus a reason; it also
// reopens every later month (the lock moves back), which the UI says.
import { prisma } from '@/lib/db';
import { LedgerValidationError } from '@/lib/ledger/validate';
import type { MembershipRole } from '@/generated/prisma/enums';

export type MonthStatus = 'NOT_CONNECTED' | 'NO_DATA' | 'NEEDS_REVIEW' | 'READY' | 'CLOSED' | 'IN_PROGRESS';

export interface MonthRow {
  /** "2026-09" */
  key: string;
  label: string;
  start: Date;
  end: Date;
  status: MonthStatus;
  imported: number;
  toReview: number;
  flagged: number;
}

export function monthEnd(year: number, monthIndex: number): Date {
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** Months to show: books start (or earliest data, or 6 months back) → current month. */
export async function monthRange(businessId: string, today = new Date()): Promise<Array<{ start: Date; end: Date }>> {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  let first = business.booksStartDate;
  if (!first) {
    const earliest = await prisma.importedTransaction.findFirst({
      where: { businessId },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    first = earliest?.date ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));
  }
  const months: Array<{ start: Date; end: Date }> = [];
  let y = first.getUTCFullYear();
  let m = first.getUTCMonth();
  const lastY = today.getUTCFullYear();
  const lastM = today.getUTCMonth();
  while (y < lastY || (y === lastY && m <= lastM)) {
    months.push({ start: new Date(Date.UTC(y, m, 1)), end: monthEnd(y, m) });
    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
    if (months.length > 120) break; // ten years is plenty
  }
  return months;
}

export async function monthStatuses(businessId: string, today = new Date()): Promise<MonthRow[]> {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  const range = await monthRange(businessId, today);
  if (range.length === 0) return [];
  const from = range[0].start;
  const to = range[range.length - 1].end;

  const [rows, activeFeeds] = await Promise.all([
    prisma.importedTransaction.findMany({
      where: { businessId, date: { gte: from, lte: to } },
      select: { date: true, status: true, needsReview: true },
    }),
    prisma.bankConnection.count({ where: { businessId, status: { not: 'REMOVED' } } }),
  ]);
  const counts = new Map<string, { imported: number; pending: number; flagged: number }>();
  for (const r of rows) {
    const k = monthKey(r.date);
    const c = counts.get(k) ?? { imported: 0, pending: 0, flagged: 0 };
    c.imported++;
    if (r.status === 'PENDING') c.pending++;
    if (r.needsReview) c.flagged++;
    counts.set(k, c);
  }
  const currentKey = monthKey(today);
  return range.map(({ start, end }) => {
    const key = monthKey(start);
    const c = counts.get(key) ?? { imported: 0, pending: 0, flagged: 0 };
    const closed = !!business.booksClosedThrough && end <= business.booksClosedThrough;
    let status: MonthStatus;
    if (closed) status = 'CLOSED';
    else if (c.pending + c.flagged > 0) status = 'NEEDS_REVIEW';
    else if (key === currentKey) status = 'IN_PROGRESS';
    else if (c.imported === 0) status = activeFeeds > 0 ? 'NO_DATA' : 'NOT_CONNECTED';
    else status = 'READY';
    return {
      key,
      label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      start,
      end,
      status,
      imported: c.imported,
      toReview: c.pending,
      flagged: c.flagged,
    };
  });
}

export async function closeMonth(opts: { businessId: string; userId: string; month: string; today?: Date }) {
  const months = await monthStatuses(opts.businessId, opts.today);
  const idx = months.findIndex((m) => m.key === opts.month);
  if (idx < 0) throw new LedgerValidationError('Unknown month.');
  const target = months[idx];
  if (target.status === 'CLOSED') throw new LedgerValidationError('That month is already closed.');
  if (target.status === 'IN_PROGRESS' || target.end >= new Date(Date.UTC((opts.today ?? new Date()).getUTCFullYear(), (opts.today ?? new Date()).getUTCMonth(), 1))) {
    throw new LedgerValidationError('A month can only be closed after it ends.');
  }
  const earlierOpen = months.slice(0, idx).find((m) => m.status !== 'CLOSED');
  if (earlierOpen) throw new LedgerValidationError(`Close ${earlierOpen.label} first — months close in order.`);
  const unreviewed = target.toReview + target.flagged;
  if (unreviewed > 0) {
    throw new LedgerValidationError(`${target.label} still has ${unreviewed} transaction(s) to review.`);
  }

  await prisma.$transaction([
    prisma.business.update({ where: { id: opts.businessId }, data: { booksClosedThrough: target.end } }),
    prisma.periodClose.upsert({
      where: { businessId_periodEnd: { businessId: opts.businessId, periodEnd: target.end } },
      create: {
        businessId: opts.businessId,
        periodEnd: target.end,
        checklist: [{ key: 'reviewed', label: `All ${target.imported} bank transactions reviewed`, done: true }],
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: opts.userId,
      },
      update: { status: 'CLOSED', closedAt: new Date(), closedById: opts.userId },
    }),
    prisma.auditLog.create({
      data: {
        businessId: opts.businessId,
        userId: opts.userId,
        action: 'month.closed',
        entityType: 'business',
        entityId: opts.businessId,
        payload: { month: target.key, transactions: target.imported },
      },
    }),
  ]);
}

export async function reopenMonth(opts: {
  businessId: string;
  userId: string;
  role: MembershipRole;
  month: string;
  reason: string;
}) {
  if (opts.role !== 'OWNER' && opts.role !== 'ACCOUNTANT') {
    throw new LedgerValidationError('Only an owner or accountant can reopen a month.');
  }
  const reason = opts.reason.trim();
  if (reason.length < 3) throw new LedgerValidationError('Say why the month is being reopened.');
  const business = await prisma.business.findUniqueOrThrow({ where: { id: opts.businessId } });
  const [y, m] = opts.month.split('-').map(Number);
  if (!y || !m) throw new LedgerValidationError('Unknown month.');
  const end = monthEnd(y, m - 1);
  if (!business.booksClosedThrough || end > business.booksClosedThrough) {
    throw new LedgerValidationError('That month is not closed.');
  }
  const newLock = monthEnd(y, m - 2); // end of the previous month
  const previouslyClosedThrough = business.booksClosedThrough;
  await prisma.$transaction([
    prisma.business.update({
      where: { id: opts.businessId },
      // Before the first close there is no lock at all.
      data: { booksClosedThrough: business.booksStartDate && newLock < business.booksStartDate ? null : newLock },
    }),
    prisma.periodClose.updateMany({
      where: { businessId: opts.businessId, periodEnd: { gte: end }, status: 'CLOSED' },
      data: { status: 'OPEN', closedAt: null, closedById: null },
    }),
    prisma.auditLog.create({
      data: {
        businessId: opts.businessId,
        userId: opts.userId,
        action: 'month.reopened',
        entityType: 'business',
        entityId: opts.businessId,
        payload: {
          month: opts.month,
          reason,
          previouslyClosedThrough: previouslyClosedThrough.toISOString().slice(0, 10),
        },
      },
    }),
  ]);
}
