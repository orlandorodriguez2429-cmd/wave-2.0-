import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { SUPPORTED_CURRENCIES } from '@/lib/money';
import { NewBillForm } from './new-bill-form';

export const dynamic = 'force-dynamic';

export default async function NewBillPage() {
  const { business } = await getCurrentContext();
  const [vendors, expenseAccounts] = await Promise.all([
    prisma.vendor.findMany({ where: { businessId: business.id, isArchived: false }, orderBy: { name: 'asc' } }),
    prisma.account.findMany({
      where: { businessId: business.id, type: 'EXPENSE', isArchived: false },
      orderBy: { code: 'asc' },
    }),
  ]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">New bill</h1>
        <p className="text-sm text-slate-500 mt-1">
          Money owed to a vendor, due on a future date — approving posts to Accounts Payable, not cash.
          For money already paid, use <span className="font-medium">Expenses</span> instead.
        </p>
      </div>
      <NewBillForm
        vendors={vendors.map((v) => ({ value: v.id, label: v.name }))}
        expenseAccounts={expenseAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
        currencies={SUPPORTED_CURRENCIES}
        functionalCurrency={business.functionalCurrency}
      />
    </div>
  );
}
