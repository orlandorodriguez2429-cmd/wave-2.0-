// Daily backstop sync is idempotent; firm overview sorts problems first.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { connectBank } from './banking/import';
import { syncAllConnections } from './banking/sync-all';
import { firmOverview } from './firm';

let userId: string;
let calm: string;
let messy: string;

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: `firm-${Date.now()}-${Math.random().toString(36).slice(2)}@t.local`, name: 'F' } })).id;
  calm = (await createBusiness({ userId, name: 'Calm Co' })).id;
  messy = (await createBusiness({ userId, name: 'Messy Co' })).id;
  const chk = async (b: string) => (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId: b, code: '1010' } } })).id;
  await connectBank({ businessId: messy, userId, provider: 'mock', ledgerAccountId: await chk(messy) });
  const c = await connectBank({ businessId: calm, userId, provider: 'mock', ledgerAccountId: await chk(calm) });
  await prisma.bankConnection.update({ where: { id: c.id }, data: { status: 'NEEDS_RECONNECT' } });
});
afterAll(async () => prisma.$disconnect());

describe('syncAllConnections', () => {
  it('syncs live connections, skips ones needing reconnect, and logs per business', async () => {
    const first = await syncAllConnections();
    expect(first.skippedNeedsReconnect).toBeGreaterThanOrEqual(1);
    const messyCount = await prisma.importedTransaction.count({ where: { businessId: messy } });
    expect(messyCount).toBe(8); // first mock batch
    expect(await prisma.importedTransaction.count({ where: { businessId: calm } })).toBe(0);
    const log = await prisma.auditLog.findFirst({ where: { businessId: messy, action: 'cron.bank_sync' } });
    expect(log).not.toBeNull();
  });
  it('is idempotent once the feed has nothing new', async () => {
    await syncAllConnections(); // second mock batch (3)
    await syncAllConnections(); // nothing left
    expect(await prisma.importedTransaction.count({ where: { businessId: messy } })).toBe(11);
  });
});

describe('firmOverview', () => {
  it('lists every client the user works on, problems first', async () => {
    const rows = (await firmOverview(userId)).filter((r) => r.businessId === calm || r.businessId === messy);
    expect(rows.map((r) => r.name)).toEqual(['Calm Co', 'Messy Co']); // needs-reconnect outranks review count
    expect(rows[0].bank).toBe('NEEDS_RECONNECT');
    const m = rows[1];
    expect(m.bank).toBe('OK');
    expect(m.toReview).toBeGreaterThan(0); // some mock rows don't match any rule
    expect(m.lastSyncAt).not.toBeNull();
  });
});
