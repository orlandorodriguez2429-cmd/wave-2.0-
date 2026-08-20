import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { StatusChip } from '@/components/status-chip';

export const dynamic = 'force-dynamic';

export default async function EstimatesPage() {
  const { business } = await getCurrentContext();
  const estimates = await prisma.estimate.findMany({
    where: { businessId: business.id },
    orderBy: { number: 'desc' },
    include: { customer: true, convertedInvoice: { select: { id: true, number: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Estimates</h1>
        <Link href="/estimates/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          + New estimate
        </Link>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">No.</th>
              <th className="px-3 py-3 font-medium">Customer</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Issued</th>
              <th className="px-3 py-3 font-medium">Invoice</th>
              <th className="px-5 py-3 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {estimates.map((e) => (
              <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3">
                  <Link href={`/estimates/${e.id}`} className="font-medium text-blue-700 hover:underline">
                    EST-{e.number}
                  </Link>
                </td>
                <td className="px-3 py-3">{e.customer.name}</td>
                <td className="px-3 py-3"><StatusChip status={e.status} /></td>
                <td className="px-3 py-3 text-slate-500">{e.issueDate.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-3">
                  {e.convertedInvoice ? (
                    <Link href={`/invoices/${e.convertedInvoice.id}`} className="text-blue-700 hover:underline">
                      #{e.convertedInvoice.number}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(e.total, e.currency)}</td>
              </tr>
            ))}
            {estimates.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={6}>
                  No estimates yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
