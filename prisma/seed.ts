// Development seed: one demo user + business with the standard chart of
// accounts and a handful of posted journal entries so reports have data.
// Idempotent: skips if the demo user already exists.
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { createBusiness } from '../src/lib/ledger/business';
import { createAndPostEntry } from '../src/lib/ledger/post';
import { parseAmount } from '../src/lib/money';

const DEMO_EMAIL = 'demo@wave2.local';

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    console.log('Seed: demo user already exists, skipping.');
    return;
  }

  const user = await prisma.user.create({
    data: { email: DEMO_EMAIL, name: 'Demo Owner' },
  });

  const business = await createBusiness({
    userId: user.id,
    name: 'Acme Consulting LLC',
    functionalCurrency: 'USD',
  });

  const account = async (code: string) => {
    const a = await prisma.account.findUniqueOrThrow({
      where: { businessId_code: { businessId: business.id, code } },
    });
    return a.id;
  };

  const [checking, ownerEquity, sales, ar, rent, software, contractor] = await Promise.all(
    ['1010', '3000', '4000', '1100', '6500', '6600', '6900'].map(account),
  );

  const usd = (s: string) => parseAmount(s, 'USD');
  const post = (date: string, memo: string, lines: Array<{ accountId: string; direction: 'DEBIT' | 'CREDIT'; amount: bigint; description?: string }>) =>
    createAndPostEntry({
      businessId: business.id,
      userId: user.id,
      input: { date: new Date(date), memo, currency: 'USD', exchangeRate: '1', lines },
    });

  await post('2026-01-05', 'Owner capital contribution', [
    { accountId: checking, direction: 'DEBIT', amount: usd('25000.00') },
    { accountId: ownerEquity, direction: 'CREDIT', amount: usd('25000.00') },
  ]);

  await post('2026-02-01', 'Invoice #1001 — Q1 consulting retainer', [
    { accountId: ar, direction: 'DEBIT', amount: usd('12000.00') },
    { accountId: sales, direction: 'CREDIT', amount: usd('12000.00') },
  ]);

  await post('2026-02-20', 'Payment received on invoice #1001', [
    { accountId: checking, direction: 'DEBIT', amount: usd('12000.00') },
    { accountId: ar, direction: 'CREDIT', amount: usd('12000.00') },
  ]);

  await post('2026-03-01', 'March office rent', [
    { accountId: rent, direction: 'DEBIT', amount: usd('1800.00') },
    { accountId: checking, direction: 'CREDIT', amount: usd('1800.00') },
  ]);

  await post('2026-03-10', 'Design contractor — landing page project', [
    { accountId: contractor, direction: 'DEBIT', amount: usd('2400.00') },
    { accountId: checking, direction: 'CREDIT', amount: usd('2400.00') },
  ]);

  await post('2026-03-15', 'Annual software subscriptions', [
    { accountId: software, direction: 'DEBIT', amount: usd('960.00') },
    { accountId: checking, direction: 'CREDIT', amount: usd('960.00') },
  ]);

  console.log(`Seed: created ${DEMO_EMAIL} with business "${business.name}" and 6 posted entries.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
