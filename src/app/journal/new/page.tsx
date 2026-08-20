import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { SUPPORTED_CURRENCIES } from '@/lib/money';
import { NewEntryForm } from './new-entry-form';

export const dynamic = 'force-dynamic';

export default async function NewEntryPage() {
  const { business } = await getCurrentContext();
  const accounts = await prisma.account.findMany({
    where: { businessId: business.id, isArchived: false },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true, type: true },
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">New journal entry</h1>
        <p className="text-sm text-slate-500 mt-1">
          Debits must equal credits. Posted entries are immutable — corrections are made by reversing.
        </p>
      </div>
      <NewEntryForm
        accounts={accounts}
        functionalCurrency={business.functionalCurrency}
        currencies={SUPPORTED_CURRENCIES}
      />
    </div>
  );
}
