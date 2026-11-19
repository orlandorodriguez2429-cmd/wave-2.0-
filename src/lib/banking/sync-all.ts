// Backstop sync for every live connection (daily cron). Webhooks do the
// real-time work; this catches anything missed. Idempotent: each sync starts
// from the saved cursor, so running it twice imports nothing new.
import { prisma } from '@/lib/db';
import { syncConnection } from './sync';
import { autoCategorize } from './autocat';

export interface SyncAllResult {
  connections: number;
  ok: number;
  failed: number;
  imported: number;
  autoCategorized: number;
  skippedNeedsReconnect: number;
}

export async function syncAllConnections(opts: { trigger?: 'cron' } = {}): Promise<SyncAllResult> {
  const result: SyncAllResult = { connections: 0, ok: 0, failed: 0, imported: 0, autoCategorized: 0, skippedNeedsReconnect: 0 };
  const connections = await prisma.bankConnection.findMany({
    where: { status: { in: ['ACTIVE', 'ERROR', 'NEEDS_RECONNECT'] }, provider: { not: 'upload' } },
    select: { id: true, businessId: true, status: true },
    orderBy: { lastSyncAt: { sort: 'asc', nulls: 'first' } },
  });
  const perBusiness = new Map<string, { ok: number; failed: number; imported: number; auto: number }>();
  for (const c of connections) {
    const b = perBusiness.get(c.businessId) ?? { ok: 0, failed: 0, imported: 0, auto: 0 };
    perBusiness.set(c.businessId, b);
    if (c.status === 'NEEDS_RECONNECT') {
      // Plaid would just fail again; the client has to reconnect first.
      result.skippedNeedsReconnect++;
      continue;
    }
    result.connections++;
    try {
      const r = await syncConnection({ connectionId: c.id, userId: null, trigger: opts.trigger ?? 'cron' });
      result.ok++;
      b.ok++;
      result.imported += r.imported;
      b.imported += r.imported;
      const auto = r.auto ? r.auto.transfers * 2 + r.auto.rule + r.auto.merchant + r.auto.ai : 0;
      result.autoCategorized += auto;
      b.auto += auto;
    } catch {
      result.failed++;
      b.failed++;
    }
  }
  // Rows from statement uploads or earlier failures that were never auto-processed.
  const leftovers = await prisma.importedTransaction.groupBy({
    by: ['businessId'],
    where: { status: 'PENDING', autoProcessedAt: null },
  });
  for (const l of leftovers) {
    const s = await autoCategorize({ businessId: l.businessId }).catch(() => null);
    if (s) result.autoCategorized += s.transfers * 2 + s.rule + s.merchant + s.ai;
  }
  for (const [businessId, b] of perBusiness) {
    await prisma.auditLog.create({
      data: {
        businessId,
        userId: null,
        action: 'cron.bank_sync',
        entityType: 'business',
        entityId: businessId,
        payload: b,
      },
    });
  }
  return result;
}
