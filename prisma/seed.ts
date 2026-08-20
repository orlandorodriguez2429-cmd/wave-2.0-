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
  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  let business;
  if (user) {
    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, role: 'OWNER' },
      include: { business: true },
    });
    business = membership!.business;
    console.log('Seed: demo user exists, topping up newer sample data only.');
  } else {
    user = await prisma.user.create({ data: { email: DEMO_EMAIL, name: 'Demo Owner' } });
    business = await createBusiness({
      userId: user.id,
      name: 'Acme Consulting LLC',
      functionalCurrency: 'USD',
    });
  }

  if (!user || !business) throw new Error('Seed: failed to resolve demo user/business.');

  const account = async (code: string) => {
    const a = await prisma.account.findUniqueOrThrow({
      where: { businessId_code: { businessId: business.id, code } },
    });
    return a.id;
  };

  const [checking, ownerEquity, sales, serviceRevenue, ar, rent, software, contractor, salesTaxPayable] =
    await Promise.all(['1010', '3000', '4000', '4100', '1100', '6500', '6600', '6900', '2200'].map(account));

  const usd = (s: string) => parseAmount(s, 'USD');
  const hasEntries = (await prisma.journalEntry.count({ where: { businessId: business.id } })) > 0;
  const post = (date: string, memo: string, lines: Array<{ accountId: string; direction: 'DEBIT' | 'CREDIT'; amount: bigint; description?: string }>) =>
    createAndPostEntry({
      businessId: business.id,
      userId: user.id,
      input: { date: new Date(date), memo, currency: 'USD', exchangeRate: '1', lines },
    });

  if (!hasEntries) {
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
  }

  // --- Phase 2 sample data: customers, vendors, tax, invoices, expenses ---
  if ((await prisma.customer.count({ where: { businessId: business.id } })) === 0) {
    const [{ createDraftInvoice, approveInvoice, recordPayment }, { createEstimate }, { createExpense }] =
      await Promise.all([
        import('../src/lib/invoicing/invoices'),
        import('../src/lib/invoicing/estimates'),
        import('../src/lib/expenses'),
      ]);

    const nyTax = await prisma.taxRate.create({
      data: {
        businessId: business.id,
        name: 'NY State + City',
        jurisdiction: 'NY',
        ratePpm: 88750,
        liabilityAccountId: salesTaxPayable,
      },
    });
    const customer = await prisma.customer.create({
      data: {
        businessId: business.id,
        name: 'Bluebird Media Inc.',
        email: 'ap@bluebird.example',
        address: '77 Hudson St, New York, NY',
      },
    });
    const customer2 = await prisma.customer.create({
      data: { businessId: business.id, name: 'Cedar & Pine Studio', email: 'hello@cedarpine.example' },
    });
    const vendor = await prisma.vendor.create({
      data: { businessId: business.id, name: 'Maya Design Co.', email: 'maya@design.example' },
    });

    const inv = await createDraftInvoice({
      businessId: business.id,
      userId: user.id,
      input: {
        customerId: customer.id,
        issueDate: new Date('2026-04-01'),
        dueDate: new Date('2026-05-01'),
        currency: 'USD',
        exchangeRate: '1',
        terms: 'Net 30',
        lines: [
          {
            description: 'Brand strategy engagement — April',
            quantityMilli: 1000n,
            unitPrice: usd('4500.00'),
            incomeAccountId: serviceRevenue,
            taxRateId: nyTax.id,
          },
          {
            description: 'Design sprints (2)',
            quantityMilli: 2000n,
            unitPrice: usd('1200.00'),
            incomeAccountId: sales,
          },
        ],
      },
    });
    await approveInvoice({ businessId: business.id, userId: user.id, invoiceId: inv.id });
    await recordPayment({
      businessId: business.id,
      userId: user.id,
      invoiceId: inv.id,
      date: new Date('2026-04-15'),
      amount: usd('3000.00'),
      method: 'ACH',
      depositAccountId: checking,
      memo: 'Partial payment',
    });

    await createEstimate({
      businessId: business.id,
      userId: user.id,
      input: {
        customerId: customer2.id,
        issueDate: new Date('2026-04-10'),
        expiryDate: new Date('2026-05-10'),
        currency: 'USD',
        exchangeRate: '1',
        memo: 'Website refresh proposal',
        lines: [
          {
            description: 'Website redesign — fixed fee',
            quantityMilli: 1000n,
            unitPrice: usd('8500.00'),
            incomeAccountId: serviceRevenue,
          },
        ],
      },
    });

    await createExpense({
      businessId: business.id,
      userId: user.id,
      input: {
        vendorId: vendor.id,
        date: new Date('2026-04-08'),
        memo: 'Landing page illustrations',
        currency: 'USD',
        exchangeRate: '1',
        paymentAccountId: checking,
        paymentMethod: 'ACH',
        lines: [{ expenseAccountId: contractor, amount: usd('1500.00'), description: 'Contract design work' }],
      },
    });
    console.log('Seed: phase 2 sample data created (tax rate, customers, invoice+payment, estimate, expense).');
  }

  console.log(`Seed complete for ${DEMO_EMAIL} ("${business.name}").`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
