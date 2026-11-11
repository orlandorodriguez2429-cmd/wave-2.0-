import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { ActionButton } from '@/components/action-button';
import { createProductAction, archiveProductAction } from '@/app/products-actions';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const { business } = await getCurrentContext();
  const [products, incomeAccounts] = await Promise.all([
    prisma.product.findMany({
      where: { businessId: business.id, isArchived: false },
      orderBy: { name: 'asc' },
    }),
    prisma.account.findMany({
      where: { businessId: business.id, type: 'INCOME', isArchived: false },
      orderBy: { code: 'asc' },
    }),
  ]);
  const accountById = new Map(incomeAccounts.map((a) => [a.id, a]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Products &amp; Services</h1>
        <p className="text-sm text-slate-500 mt-1">
          A reusable price list for consistent naming, pricing, and income accounts. Pick prices and
          accounts manually on invoices and bills for now — this catalog isn&apos;t wired into the line-item
          picker yet.
        </p>
      </div>
      <SimpleRecordForm
        action={createProductAction}
        submitLabel="Add product/service"
        fields={[
          { name: 'name', label: 'Name', required: true, width: 'flex-1 min-w-40' },
          { name: 'sku', label: 'SKU', width: 'w-28' },
          { name: 'unitPrice', label: 'Price', placeholder: '0.00', width: 'w-28' },
          {
            name: 'incomeAccountId',
            label: 'Income account',
            type: 'select',
            width: 'w-56',
            options: incomeAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
          },
          { name: 'description', label: 'Description', width: 'flex-1 min-w-40' },
        ]}
      />
      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-3 py-3 font-medium">SKU</th>
              <th className="px-3 py-3 font-medium">Income account</th>
              <th className="px-3 py-3 font-medium text-right">Price</th>
              <th className="px-5 py-3 font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3">
                  <div className="font-medium">{p.name}</div>
                  {p.description && <div className="text-xs text-slate-400">{p.description}</div>}
                </td>
                <td className="px-3 py-3 text-slate-500">{p.sku ?? '—'}</td>
                <td className="px-3 py-3 text-slate-500">
                  {accountById.get(p.incomeAccountId)
                    ? `${accountById.get(p.incomeAccountId)!.code} · ${accountById.get(p.incomeAccountId)!.name}`
                    : '—'}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatMoney(p.unitPrice, business.functionalCurrency)}
                </td>
                <td className="px-5 py-3 text-right">
                  <ActionButton action={archiveProductAction.bind(null, p.id)} label="Archive" />
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={5}>
                  No products or services yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
