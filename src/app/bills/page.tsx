import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { StatusChip } from '@/components/status-chip';

export const dynamic = 'force-dynamic';

export default async function BillsPage() {
  const { business } = await getCurrentContext();
  const bills = await prisma.bill.findMany({
    where: { businessId: business.id },
    orderBy: { number: 'desc' },
    take: 200,
    include: { vendor: true, payments: true },
  });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bills</h1>
        <Link href="/bills/new" className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700">
          + New bill
        </Link>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">No.</th>
              <th className="px-3 py-3 font-medium">Vendor</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Bill date</th>
              <th className="px-3 py-3 font-medium">Due</th>
              <th className="px-3 py-3 font-medium text-right">Total</th>
              <th className="px-5 py-3 font-medium text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((bill) => {
              const paid = bill.payments.reduce((s, p) => s + p.amount, 0n);
              const overdue = bill.status === 'OPEN' && bill.dueDate.toISOString().slice(0, 10) < today;
              return (
                <tr key={bill.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link href={`/bills/${bill.id}`} className="font-medium text-teal-700 hover:underline">
                      #{bill.number}
                    </Link>
                  </td>
                  <td className="px-3 py-3">{bill.vendor.name}</td>
                  <td className="px-3 py-3">
                    <StatusChip status={overdue ? 'OVERDUE' : bill.status} />
                    {paid > 0n && bill.status === 'OPEN' && (
                      <span className="ml-1 text-xs text-slate-400">partial</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-500">{bill.billDate.toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-3 text-slate-500">{bill.dueDate.toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatMoney(bill.total, bill.currency)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {bill.status === 'OPEN' ? formatMoney(bill.total - paid, bill.currency) : '—'}
                  </td>
                </tr>
              );
            })}
            {bills.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={7}>
                  No bills yet — record an expense for money already paid, or a bill for money owed on a future date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
