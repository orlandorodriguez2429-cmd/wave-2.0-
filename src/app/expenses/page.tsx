import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function ExpensesPage() {
  const { business } = await getCurrentContext();
  const expenses = await prisma.expense.findMany({
    where: { businessId: business.id },
    orderBy: { date: 'desc' },
    take: 200,
    include: { vendor: true, lines: true, receiptFile: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Expenses</h1>
        <Link href="/expenses/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          + New expense
        </Link>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Memo</th>
              <th className="px-3 py-3 font-medium">Vendor</th>
              <th className="px-3 py-3 font-medium">Method</th>
              <th className="px-3 py-3 font-medium">Receipt</th>
              <th className="px-5 py-3 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{e.date.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-3">{e.memo}</td>
                <td className="px-3 py-3 text-slate-500">{e.vendor?.name ?? '—'}</td>
                <td className="px-3 py-3 text-slate-500">{e.paymentMethod}</td>
                <td className="px-3 py-3">
                  {e.receiptFile ? (
                    <a href={`/receipts/${e.receiptFile.id}`} className="text-blue-700 hover:underline">
                      view
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(e.total, e.currency)}</td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={6}>
                  No expenses yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
