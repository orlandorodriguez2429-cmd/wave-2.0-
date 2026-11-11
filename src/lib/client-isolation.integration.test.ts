// Defense in depth behind the middleware: with a CLIENT session, every staff
// context/action/route handler 404s, and the client's own actions refuse
// another business's ids. Cookies are faked; everything else is real.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string) => void jar.delete(n),
  }),
  headers: async () => new Headers({ 'x-forwarded-for': '198.51.100.7' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { prisma } = await import('@/lib/db');
const { createBusiness } = await import('@/lib/ledger/business');
const { newSession, signToken, sessionCookieName } = await import('@/lib/session-core');
const { getClientContext, getCurrentContext } = await import('@/lib/context');
const { readSession, rotateSessions } = await import('@/lib/auth');
const banking = await import('@/app/banking-actions');
const months = await import('@/app/months-actions');
const team = await import('@/app/auth-actions');
const client = await import('@/app/client-actions');
const reportExport = await import('@/app/reports/export/[report]/route');
const pdfRoute = await import('@/app/1099/forms/[id]/pdf/route');
const clientExport = await import('@/app/client/pnl/export/route');
const { NextRequest } = await import('next/server');

let clientUser: string;
let staffUser: string;
let ownBiz: string;
let otherBiz: string;
let otherConn: string;
let otherLink: string;
let otherTxn: string;

async function loginAs(userId: string, businessId: string, role: 'CLIENT' | 'OWNER') {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  jar.set(sessionCookieName(), await signToken(newSession({ userId, businessId, role, sv: u.sessionVersion })));
}
const is404 = (err: unknown) => String((err as { digest?: string })?.digest ?? '').includes('404');

beforeAll(async () => {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  staffUser = (await prisma.user.create({ data: { email: `staff-${tag}@t.local`, name: 'Staff' } })).id;
  clientUser = (await prisma.user.create({ data: { email: `client-${tag}@t.local`, name: 'Client' } })).id;
  ownBiz = (await createBusiness({ userId: staffUser, name: 'Client Own Co' })).id;
  otherBiz = (await createBusiness({ userId: staffUser, name: 'Somebody Else Co' })).id;
  await prisma.membership.create({ data: { userId: clientUser, businessId: ownBiz, role: 'CLIENT' } });
  const ledger = (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId: otherBiz, code: '1010' } } })).id;
  const conn = await prisma.bankConnection.create({
    data: {
      businessId: otherBiz, provider: 'plaid', institutionName: 'Other Bank', itemId: `item-${tag}`, accessTokenEncrypted: null, status: 'NEEDS_RECONNECT',
      accounts: { create: { businessId: otherBiz, externalAccountId: 'x', name: 'Chk', currency: 'USD', type: 'depository', ledgerAccountId: ledger } },
    },
    include: { accounts: true },
  });
  otherConn = conn.id;
  otherLink = conn.accounts[0].id;
  otherTxn = (await prisma.importedTransaction.create({ data: { businessId: otherBiz, bankAccountLinkId: otherLink, externalId: 'o1', date: new Date('2026-09-01'), description: 'OTHER', amount: -100n } })).id;
});
beforeEach(() => jar.clear());
afterAll(async () => prisma.$disconnect());

describe('CLIENT session', () => {
  beforeEach(async () => loginAs(clientUser, ownBiz, 'CLIENT'));

  it('gets its own business from the client context, and only that', async () => {
    const ctx = await getClientContext();
    expect(ctx.business.id).toBe(ownBiz);
  });

  it('a session pointing at another business still only yields its own', async () => {
    await loginAs(clientUser, otherBiz, 'CLIENT'); // tampered/old businessId (signed by us, still)
    expect((await getClientContext()).business.id).toBe(ownBiz);
  });

  it('staff context → 404', async () => {
    await expect(getCurrentContext()).rejects.toSatisfy(is404);
  });

  it.each([
    ['categorize', () => banking.categorizeTxnAction({}, Object.assign(new FormData(), {}))],
    ['exclude', () => banking.excludeTxnAction(otherTxn)],
    ['sync', () => banking.syncConnectionAction(otherConn)],
    ['disconnect', () => banking.disconnectConnectionAction(otherConn)],
    ['undo', () => banking.recategorizeTxnAction(otherTxn)],
    ['close month', () => months.closeMonthAction('2026-08')],
    ['invite', () => team.inviteClientAction({}, new FormData())],
    ['switch business', () => team.switchBusinessAction(otherBiz)],
  ])('staff action "%s" → 404', async (_name, run) => {
    await expect(run()).rejects.toSatisfy(is404);
  });

  it('staff route handlers → 404', async () => {
    await expect(
      reportExport.GET(new NextRequest('http://x/reports/export/profit-loss'), { params: Promise.resolve({ report: 'profit-loss' }) }),
    ).rejects.toSatisfy(is404);
    await expect(pdfRoute.GET(new NextRequest('http://x/1099/forms/x/pdf'), { params: Promise.resolve({ id: 'x' }) })).rejects.toSatisfy(is404);
  });

  it("can't use another business's ids in its own actions", async () => {
    vi.stubEnv('PLAID_CLIENT_ID', 'test');
    vi.stubEnv('PLAID_SECRET', 'test');
    expect(await client.clientCreateLinkTokenAction(otherConn)).toEqual({ error: 'Connection not found.' });
    expect((await client.clientMarkReconnectedAction(otherConn)).error).toMatch(/Wrong business/);
    vi.unstubAllEnvs();
    const fd = new FormData();
    fd.set('file', new File(['Date,Description,Amount\n2026-09-01,X,-1.00\n'], 's.csv', { type: 'text/csv' }));
    fd.set('linkId', otherLink);
    fd.set('opening', '1.00');
    fd.set('closing', '0.00');
    expect((await client.clientUploadStatementAction({}, fd)).error).toMatch(/Unknown account/);
    expect(await prisma.importedTransaction.count({ where: { businessId: otherBiz } })).toBe(1);
  });

  it("the portal export only ever shows its own business", async () => {
    const res = await clientExport.GET(new NextRequest('http://x/client/pnl/export?format=csv&businessId=' + otherBiz));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/profit-loss-/);
  });
});

describe('staff session', () => {
  it('client context → 404', async () => {
    await loginAs(staffUser, ownBiz, 'OWNER');
    await expect(getClientContext()).rejects.toSatisfy(is404);
  });
});

describe('session rotation', () => {
  it('bumping the session version kills existing sessions', async () => {
    await loginAs(staffUser, ownBiz, 'OWNER');
    expect(await readSession()).not.toBeNull();
    await rotateSessions(staffUser);
    expect(await readSession()).toBeNull();
  });
});

describe('staff view audit', () => {
  it('logs who opened which page for which business, once per 15 minutes', async () => {
    // Re-mock headers for this case: the middleware sets x-yts-path.
    const h = await import('next/headers');
    const spy = vi.spyOn(h, 'headers').mockImplementation(async () => new Headers({ 'x-yts-path': '/reports/profit-loss' }) as never);
    await loginAs(staffUser, ownBiz, 'OWNER');
    await getCurrentContext();
    await getCurrentContext();
    const logs = await prisma.auditLog.findMany({ where: { businessId: ownBiz, userId: staffUser, action: 'data.viewed' } });
    expect(logs).toHaveLength(1);
    expect(logs[0].entityId).toBe('/reports/profit-loss');
    spy.mockRestore();
  });
});
