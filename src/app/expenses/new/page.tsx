import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { SUPPORTED_CURRENCIES } from '@/lib/money';
import { NewExpenseForm } from './new-expense-form';

export const dynamic = 'force-dynamic';

export default async function NewExpensePage() {
  const { business } = await getCurrentContext();
  const [vendors, expenseAccounts, paymentAccounts] = await Promise.all([
    prisma.vendor.findMany({ where: { businessId: business.id, isArchived: false }, orderBy: { name: 'asc' } }),
    prisma.account.findMany({
      where: { businessId: business.id, type: 'EXPENSE', isArchived: false },
      orderBy: { code: 'asc' },
    }),
    prisma.account.findMany({
      where: {
        businessId: business.id,
        isArchived: false,
        OR: [{ subtype: 'cash_and_bank' }, { subtype: 'credit_card' }],
      },
      orderBy: { code: 'asc' },
    }),
  ]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">New expense</h1>
        <p className="text-sm text-slate-500 mt-1">
          Posts to the ledger immediately: debit expense accounts, credit the payment account.
        </p>
      </div>
      <NewExpenseForm
        vendors={vendors.map((v) => ({ value: v.id, label: v.name }))}
        expenseAccounts={expenseAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
        paymentAccounts={paymentAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
        currencies={SUPPORTED_CURRENCIES}
        functionalCurrency={business.functionalCurrency}
      />
    </div>
  );
}
