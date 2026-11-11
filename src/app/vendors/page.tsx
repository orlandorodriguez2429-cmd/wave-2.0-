import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { createVendorAction } from '@/app/invoicing-actions';

export const dynamic = 'force-dynamic';

export default async function VendorsPage() {
  const { business } = await getCurrentContext();
  const vendors = await prisma.vendor.findMany({
    where: { businessId: business.id },
    orderBy: { name: 'asc' },
    include: { expenses: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Vendors</h1>
        <p className="text-sm text-slate-500 mt-1">
          Open a vendor for W-9 collection, 1099 payment history, and threshold status.
        </p>
      </div>
      <SimpleRecordForm
        action={createVendorAction}
        submitLabel="Add vendor"
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
              <th className="px-3 py-3 font-medium">W-9</th>
              <th className="px-5 py-3 font-medium text-right">Paid (all time)</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3">
                  <a href={`/vendors/${v.id}`} className="font-medium text-teal-700 hover:underline">{v.name}</a>
                </td>
                <td className="px-3 py-3 text-slate-500">{v.email}</td>
                <td className="px-3 py-3">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    v.w9Status === 'COMPLETED' ? 'bg-green-100 text-green-700'
                    : v.w9Status === 'REQUESTED' ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-600'
                  }`}>
                    {v.w9Status.replace('_', ' ').toLowerCase()}
                  </span>
                </td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {formatMoney(
                    v.expenses.reduce((s, e) => s + e.total, 0n),
                    business.functionalCurrency,
                  )}
                </td>
              </tr>
            ))}
            {vendors.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={4}>
                  No vendors yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
