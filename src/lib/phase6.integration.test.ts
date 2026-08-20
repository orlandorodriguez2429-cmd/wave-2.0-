// Phase 6: session signing, role gates, period-close ledger lock, new
// reports, and API token auth primitives.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { createAndPostEntry } from '@/lib/ledger/post';
import { requireRole, signSession, verifySession, ForbiddenError } from '@/lib/auth';
import { generateToken, hashToken, resolveApiToken } from '@/lib/api-auth';
import { agedReceivables, cashFlow, salesTaxReport } from '@/lib/ledger/more-reports';
import { approveInvoice, createDraftInvoice } from '@/lib/invoicing/invoices';

let userId: string;
let businessId: string;
let checking: string;
let sales: string;
let equity: string;
let salesTaxAccount: string;

const usd = (d: number) => BigInt(Math.round(d * 100));

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `p6-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'P6' },
  });
  userId = user.id;
  const business = await createBusiness({ userId, name: 'Phase6 Test Co' });
  businessId = business.id;
  const byCode = async (code: string) =>
    (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code } } })).id;
  [checking, sales, equity, salesTaxAccount] = await Promise.all(['1010', '4000', '3000', '2200'].map(byCode));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('sessions & roles', () => {
  it('signed sessions round-trip; tampering and truncation are rejected', () => {
    const token = signSession({ userId: 'u1', businessId: 'b1' });
    const payload = verifySession(token);
    expect(payload?.userId).toBe('u1');
    expect(payload?.businessId).toBe('b1');

    expect(verifySession(token.slice(0, -2))).toBeNull();
    const [body] = token.split('.');
    expect(verifySession(`${body}.AAAA`)).toBeNull();
    // Payload swap with someone else's MAC fails.
    const other = signSession({ userId: 'attacker', businessId: 'b1' });
    expect(verifySession(`${other.split('.')[0]}.${token.split('.')[1]}`)).toBeNull();
  });

  it('role floors: employee cannot do accountant work; viewer cannot mutate', () => {
    expect(() => requireRole('OWNER', 'ACCOUNTANT')).not.toThrow();
    expect(() => requireRole('ACCOUNTANT', 'ACCOUNTANT')).not.toThrow();
    expect(() => requireRole('EMPLOYEE', 'ACCOUNTANT')).toThrow(ForbiddenError);
    expect(() => requireRole('CONTRACTOR_VIEW', 'EMPLOYEE')).toThrow(ForbiddenError);
    expect(() => requireRole('EMPLOYEE', 'EMPLOYEE')).not.toThrow();
  });
});

describe('period-close ledger lock', () => {
  it('refuses postings dated in a closed period; allows the open period', async () => {
    await createAndPostEntry({
      businessId,
      userId,
      input: {
        date: new Date('2026-01-15'),
        memo: 'Pre-close entry',
        currency: 'USD',
        exchangeRate: '1',
        lines: [
          { accountId: checking, direction: 'DEBIT', amount: usd(1000) },
          { accountId: equity, direction: 'CREDIT', amount: usd(1000) },
        ],
      },
    });
    await prisma.business.update({
      where: { id: businessId },
      data: { booksClosedThrough: new Date('2026-01-31') },
    });

    await expect(
      createAndPostEntry({
        businessId,
        userId,
        input: {
          date: new Date('2026-01-20'),
          memo: 'Backdated into closed period',
          currency: 'USD',
          exchangeRate: '1',
          lines: [
            { accountId: checking, direction: 'DEBIT', amount: usd(5) },
            { accountId: sales, direction: 'CREDIT', amount: usd(5) },
          ],
        },
      }),
    ).rejects.toThrow(/books are closed/i);

    const ok = await createAndPostEntry({
      businessId,
      userId,
      input: {
        date: new Date('2026-02-01'),
        memo: 'Open period entry',
        currency: 'USD',
        exchangeRate: '1',
        lines: [
          { accountId: checking, direction: 'DEBIT', amount: usd(5) },
          { accountId: sales, direction: 'CREDIT', amount: usd(5) },
        ],
      },
    });
    expect(ok.status).toBe('POSTED');
  });
});

describe('new reports', () => {
  it('cash flow classifies operating vs financing and reconciles opening/closing', async () => {
    const report = await cashFlow(businessId, { from: new Date('2026-01-01'), to: new Date('2026-12-31') });
    expect(report.openingCash).toBe(0n);
    expect(report.financing).toBe(usd(1000)); // equity contribution
    expect(report.operating).toBe(usd(5)); // sales receipt
    expect(report.closingCash).toBe(report.openingCash + report.netChange);
  });

  it('sales tax report aggregates taxed invoice lines; aged receivables buckets balances', async () => {
    const customer = await prisma.customer.create({ data: { businessId, name: 'Aging Customer' } });
    const rate = await prisma.taxRate.create({
      data: { businessId, name: 'Test 10%', ratePpm: 100000, liabilityAccountId: salesTaxAccount },
    });
    const inv = await createDraftInvoice({
      businessId,
      userId,
      input: {
        customerId: customer.id,
        issueDate: new Date('2026-03-01'),
        dueDate: new Date('2026-03-31'),
        currency: 'USD',
        exchangeRate: '1',
        lines: [
          { description: 'Taxed work', quantityMilli: 1000n, unitPrice: usd(500), incomeAccountId: sales, taxRateId: rate.id },
        ],
      },
    });
    await approveInvoice({ businessId, userId, invoiceId: inv.id });

    const st = await salesTaxReport(businessId, { from: new Date('2026-01-01'), to: new Date('2026-12-31') });
    const row = st.byRate.find((r) => r.taxRateId === rate.id)!;
    expect(row.taxable).toBe(usd(500));
    expect(row.collected).toBe(usd(50));

    const aged = await agedReceivables(businessId, new Date('2026-06-15'));
    const agedRow = aged.rows.find((r) => r.invoiceId === inv.id)!;
    expect(agedRow.balance).toBe(usd(550));
    expect(agedRow.bucket).toBe('61-90'); // due 3/31, as-of 6/15 = 76 days
    expect(aged.buckets['61-90']).toBe(usd(550));
  });
});

describe('API tokens', () => {
  it('bearer tokens resolve to their business; revocation and garbage are rejected', async () => {
    const token = generateToken();
    await prisma.apiToken.create({ data: { businessId, name: 'test', tokenHash: hashToken(token) } });

    const resolved = await resolveApiToken(`Bearer ${token}`);
    expect(resolved?.businessId).toBe(businessId);

    expect(await resolveApiToken('Bearer wave_deadbeef')).toBeNull();
    expect(await resolveApiToken(null)).toBeNull();
    expect(await resolveApiToken(`Bearer ${generateToken()}`)).toBeNull(); // unknown token

    await prisma.apiToken.updateMany({ where: { businessId }, data: { revokedAt: new Date() } });
    expect(await resolveApiToken(`Bearer ${token}`)).toBeNull();
  });
});
