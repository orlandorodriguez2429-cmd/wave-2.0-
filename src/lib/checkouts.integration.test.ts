// Checkouts are standalone payment links (Wave's "Checkouts") — paying one
// posts directly to the ledger with no invoice in between, so this exercises
// that path end to end against a real Postgres.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { trialBalance } from '@/lib/ledger/reports';
import { signedBalance } from '@/lib/ledger/validate';
import { createCheckout, payCheckout, voidCheckout } from './checkouts';

let userId: string;
let businessId: string;
let checking: string;
let serviceRevenue: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'Checkout Tester' },
  });
  userId = user.id;
  const business = await createBusiness({ userId, name: 'Checkouts Test Co' });
  businessId = business.id;
  const byCode = async (code: string) =>
    (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code } } })).id;
  [checking, serviceRevenue] = await Promise.all(['1010', '4100'].map(byCode));
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function serviceRevenueBalance() {
  const tb = await trialBalance(businessId);
  const row = tb.rows.find((r) => r.accountId === serviceRevenue);
  return row ? signedBalance(row.type, row.debits, row.credits) : 0n;
}

describe('checkouts', () => {
  it('paying an open checkout posts a balanced entry to the chosen income account', async () => {
    const before = await serviceRevenueBalance();
    const checkout = await createCheckout({
      businessId,
      userId,
      input: { description: 'Workshop seat', amount: 5000n, currency: 'USD', incomeAccountId: serviceRevenue },
    });
    expect(checkout.status).toBe('OPEN');

    const paid = await payCheckout({ token: checkout.token, payerName: 'Jamie' });
    expect(paid.status).toBe('PAID');
    expect(paid.payerName).toBe('Jamie');
    expect(await serviceRevenueBalance()).toBe(before + 5000n);

    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: paid.journalEntryId! },
      include: { lines: true },
    });
    const debits = entry.lines.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s + l.functionalAmount, 0n);
    const credits = entry.lines.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s + l.functionalAmount, 0n);
    expect(debits).toBe(credits);
    expect(debits).toBe(5000n);
  });

  it('refuses to pay a checkout twice', async () => {
    const checkout = await createCheckout({
      businessId,
      userId,
      input: { description: 'One-time fee', amount: 2000n, currency: 'USD', incomeAccountId: serviceRevenue },
    });
    await payCheckout({ token: checkout.token });
    await expect(payCheckout({ token: checkout.token })).rejects.toThrow(/already been paid|voided/i);
  });

  it('voiding an unpaid checkout marks it void with no ledger effect', async () => {
    const before = await serviceRevenueBalance();
    const checkout = await createCheckout({
      businessId,
      userId,
      input: { description: 'Cancelled request', amount: 1000n, currency: 'USD', incomeAccountId: serviceRevenue },
    });
    const voided = await voidCheckout({ businessId, userId, checkoutId: checkout.id });
    expect(voided.status).toBe('VOID');
    expect(await serviceRevenueBalance()).toBe(before);
    await expect(payCheckout({ token: checkout.token })).rejects.toThrow(/already been paid|voided/i);
  });

  it('voiding a paid checkout reverses the posted entry', async () => {
    const before = await serviceRevenueBalance();
    const checkout = await createCheckout({
      businessId,
      userId,
      input: { description: 'Refundable deposit', amount: 3000n, currency: 'USD', incomeAccountId: serviceRevenue },
    });
    await payCheckout({ token: checkout.token });
    expect(await serviceRevenueBalance()).toBe(before + 3000n);

    await voidCheckout({ businessId, userId, checkoutId: checkout.id });
    expect(await serviceRevenueBalance()).toBe(before);
  });
});
