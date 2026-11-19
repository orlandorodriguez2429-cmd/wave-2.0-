// Firm view: every business the signed-in staff member can work on
// (OWNER or ACCOUNTANT), one row each, problems first.
import { prisma } from '@/lib/db';
import { monthStatuses } from '@/lib/months';
import { vendor1099Totals } from '@/lib/forms1099/tracking';

export type BankHealth = 'OK' | 'NEEDS_RECONNECT' | 'NOT_CONNECTED';

export interface ClientRow {
  businessId: string;
  name: string;
  bank: BankHealth;
  connections: number;
  lastSyncAt: Date | null;
  toReview: number;
  monthsNotClosed: number;
  oldestOpenMonth: string | null;
  needs1099: number;
  missingW9: number;
  problemScore: number;
}

export async function firmOverview(userId: string, today = new Date()): Promise<ClientRow[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId, role: { in: ['OWNER', 'ACCOUNTANT'] } },
    include: { business: true },
  });
  const rows: ClientRow[] = [];
  for (const m of memberships) {
    const b = m.business;
    const [connections, toReview, months, totals] = await Promise.all([
      prisma.bankConnection.findMany({ where: { businessId: b.id, status: { not: 'REMOVED' } } }),
      prisma.importedTransaction.count({
        where: { businessId: b.id, OR: [{ status: 'PENDING' }, { needsReview: true }] },
      }),
      monthStatuses(b.id, today),
      vendor1099Totals(b.id, today.getUTCFullYear()),
    ]);
    const bank: BankHealth =
      connections.length === 0
        ? 'NOT_CONNECTED'
        : connections.some((c) => c.status === 'NEEDS_RECONNECT' || c.status === 'ERROR')
          ? 'NEEDS_RECONNECT'
          : 'OK';
    const lastSyncAt = connections.reduce<Date | null>(
      (max, c) => (c.lastSyncAt && (!max || c.lastSyncAt > max) ? c.lastSyncAt : max),
      null,
    );
    const open = months.filter((mo) => mo.status !== 'CLOSED' && mo.status !== 'IN_PROGRESS');
    const reportable = totals.filter((t) => t.status === 'REPORTABLE');
    const missingW9 = reportable.filter((t) => !t.is1099Eligible).length;
    const problemScore =
      (bank === 'NEEDS_RECONNECT' ? 1000 : bank === 'NOT_CONNECTED' ? 300 : 0) +
      missingW9 * 200 +
      toReview * 2 +
      open.length * 10;
    rows.push({
      businessId: b.id,
      name: b.name,
      bank,
      connections: connections.length,
      lastSyncAt,
      toReview,
      monthsNotClosed: open.length,
      oldestOpenMonth: open[0]?.label ?? null,
      needs1099: reportable.length,
      missingW9,
      problemScore,
    });
  }
  return rows.sort((a, b) => b.problemScore - a.problemScore || a.name.localeCompare(b.name));
}
