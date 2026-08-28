import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { StatusChip } from '@/components/status-chip';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  const { business } = await getCurrentContext();
  const invoices = await prisma.invoice.findMany({
    where: { businessId: business.id },
    orderBy: { number: 'desc' },
    take: 200,
    include: { customer: true, payments: true },
  });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <Link href="/invoices/new" className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700">
          + New invoice
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
              <th className="px-3 py-3 font-medium">Due</th>
              <th className="px-3 py-3 font-medium text-right">Total</th>
              <th className="px-5 py-3 font-medium text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const paid = inv.payments.reduce((s, p) => s + p.amount, 0n);
              const overdue = inv.status === 'OPEN' && inv.dueDate.toISOString().slice(0, 10) < today;
              return (
                <tr key={inv.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link href={`/invoices/${inv.id}`} className="font-medium text-teal-700 hover:underline">
                      #{inv.number}
                    </Link>
                  </td>
                  <td className="px-3 py-3">{inv.customer.name}</td>
                  <td className="px-3 py-3">
                    <StatusChip status={overdue ? 'OVERDUE' : inv.status} />
                    {paid > 0n && inv.status === 'OPEN' && (
                      <span className="ml-1 text-xs text-slate-400">partial</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-500">{inv.issueDate.toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-3 text-slate-500">{inv.dueDate.toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatMoney(inv.total, inv.currency)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {inv.status === 'OPEN' ? formatMoney(inv.total - paid, inv.currency) : '—'}
                  </td>
                </tr>
              );
            })}
            {invoices.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={7}>
                  No invoices yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
