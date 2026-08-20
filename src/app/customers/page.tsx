import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { createCustomerAction } from '@/app/invoicing-actions';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const { business } = await getCurrentContext();
  const customers = await prisma.customer.findMany({
    where: { businessId: business.id },
    orderBy: { name: 'asc' },
    include: { invoices: { where: { status: { in: ['OPEN'] } }, include: { payments: true } } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Customers</h1>
      <SimpleRecordForm
        action={createCustomerAction}
        submitLabel="Add customer"
        fields={[
          { name: 'name', label: 'Name', required: true, width: 'flex-1 min-w-48' },
          { name: 'email', label: 'Email', width: 'w-56' },
          { name: 'address', label: 'Address', width: 'flex-1 min-w-48' },
        ]}
      />
      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-3 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium text-right">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => {
              const outstanding = c.invoices.reduce(
                (s, inv) => s + inv.total - inv.payments.reduce((p, x) => p + x.amount, 0n),
                0n,
              );
              return (
                <tr key={c.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3">{c.name}</td>
                  <td className="px-3 py-3 text-slate-500">{c.email}</td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {formatMoney(outstanding, business.functionalCurrency)}
                  </td>
                </tr>
              );
            })}
            {customers.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={3}>
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
