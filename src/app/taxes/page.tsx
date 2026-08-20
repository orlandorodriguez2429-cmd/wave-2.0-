import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { createTaxRateAction } from '@/app/invoicing-actions';

export const dynamic = 'force-dynamic';

export default async function TaxesPage() {
  const { business } = await getCurrentContext();
  const [rates, liabilityAccounts] = await Promise.all([
    prisma.taxRate.findMany({ where: { businessId: business.id }, orderBy: { name: 'asc' } }),
    prisma.account.findMany({
      where: { businessId: business.id, type: 'LIABILITY', isArchived: false },
      orderBy: { code: 'asc' },
    }),
  ]);
  const accountName = new Map(liabilityAccounts.map((a) => [a.id, `${a.code} · ${a.name}`]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sales Tax Rates</h1>
        <p className="text-sm text-slate-500 mt-1">
          Applied per invoice line; collected tax credits the chosen liability account by jurisdiction.
        </p>
      </div>
      <SimpleRecordForm
        action={createTaxRateAction}
        submitLabel="Add rate"
        fields={[
          { name: 'name', label: 'Name', placeholder: 'NY State + City', required: true, width: 'w-52' },
          { name: 'jurisdiction', label: 'Jurisdiction', placeholder: 'NY', width: 'w-32' },
          { name: 'rate', label: 'Rate %', placeholder: '8.875', required: true, width: 'w-28' },
          {
            name: 'liabilityAccountId',
            label: 'Liability account',
            type: 'select',
            options: liabilityAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
            defaultValue: liabilityAccounts.find((a) => a.subtype === 'sales_tax')?.id,
          },
        ]}
      />
      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-3 py-3 font-medium">Jurisdiction</th>
              <th className="px-3 py-3 font-medium text-right">Rate</th>
              <th className="px-5 py-3 font-medium">Liability account</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3">{r.name}</td>
                <td className="px-3 py-3 text-slate-500">{r.jurisdiction}</td>
                <td className="px-3 py-3 text-right tabular-nums">{(r.ratePpm / 10000).toFixed(4).replace(/\.?0+$/, '')}%</td>
                <td className="px-5 py-3 text-slate-500">{accountName.get(r.liabilityAccountId) ?? '—'}</td>
              </tr>
            ))}
            {rates.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={4}>
                  No tax rates yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
