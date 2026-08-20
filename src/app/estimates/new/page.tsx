import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { SUPPORTED_CURRENCIES } from '@/lib/money';
import { DocumentForm } from '@/components/document-form';
import { createEstimateAction } from '@/app/invoicing-actions';

export const dynamic = 'force-dynamic';

export default async function NewEstimatePage() {
  const { business } = await getCurrentContext();
  const [customers, incomeAccounts, taxRates] = await Promise.all([
    prisma.customer.findMany({ where: { businessId: business.id, isArchived: false }, orderBy: { name: 'asc' } }),
    prisma.account.findMany({
      where: { businessId: business.id, type: 'INCOME', isArchived: false },
      orderBy: { code: 'asc' },
    }),
    prisma.taxRate.findMany({ where: { businessId: business.id, isArchived: false }, orderBy: { name: 'asc' } }),
  ]);

  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-2xl font-semibold">New estimate</h1>
      <DocumentForm
        mode="estimate"
        action={createEstimateAction}
        customers={customers.map((c) => ({ value: c.id, label: c.name }))}
        incomeAccounts={incomeAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
        taxRates={taxRates.map((t) => ({ value: t.id, label: `${t.name} (${(t.ratePpm / 10000).toFixed(3).replace(/\.?0+$/, '')}%)` }))}
        taxRatePpm={Object.fromEntries(taxRates.map((t) => [t.id, t.ratePpm]))}
        currencies={SUPPORTED_CURRENCIES}
        functionalCurrency={business.functionalCurrency}
      />
    </div>
  );
}
