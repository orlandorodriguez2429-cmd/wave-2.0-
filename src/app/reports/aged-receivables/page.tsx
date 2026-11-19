import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { agedReceivables } from '@/lib/ledger/more-reports';
import { formatMoney } from '@/lib/money';
import { DateRangeForm } from '../date-range-form';

export const dynamic = 'force-dynamic';

export default async function AgedReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const params = await searchParams;
  const { business } = await getCurrentContext();
  const cur = business.functionalCurrency;
  const asOf = params.to || new Date().toISOString().slice(0, 10);
  const report = await agedReceivables(business.id, new Date(asOf));

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Aged Receivables</h1>
          <p className="text-sm text-slate-500 mt-1">
            Open invoice balances as of {asOf} ·{' '}
            <a href={`/reports/export/aged-receivables?to=${asOf}`} className="text-teal-700 hover:underline">CSV</a>
          </p>
        </div>
        <DateRangeForm to={asOf} toOnly />
      </div>

      <div className="grid grid-cols-5 gap-3">
        {(Object.entries(report.buckets) as Array<[string, bigint]>).map(([bucket, amount]) => (
          <div key={bucket} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-medium uppercase text-slate-500">{bucket}</p>
            <p className="mt-1 font-semibold tabular-nums">{formatMoney(amount, cur)}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Invoice</th>
              <th className="px-3 py-3 font-medium">Customer</th>
              <th className="px-3 py-3 font-medium">Due</th>
              <th className="px-3 py-3 font-medium">Bucket</th>
              <th className="px-5 py-3 font-medium text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.invoiceId} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5">
                  <Link href={`/invoices/${r.invoiceId}`} className="text-teal-700 hover:underline">#{r.number}</Link>
                </td>
                <td className="px-3 py-2.5">{r.customerName}</td>
                <td className="px-3 py-2.5 text-slate-500">{r.dueDate}</td>
                <td className="px-3 py-2.5">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    r.bucket === 'current' ? 'bg-slate-100 text-slate-600' : r.bucket === '90+' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>{r.bucket}</span>
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(r.balance, cur)}</td>
              </tr>
            ))}
            {report.rows.length === 0 && (
              <tr><td className="px-5 py-6 text-slate-400" colSpan={5}>Nothing outstanding — nice.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
              <td className="px-5 py-3" colSpan={4}>Total outstanding</td>
              <td className="px-5 py-3 text-right tabular-nums">{formatMoney(report.total, cur)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        Aged Payables arrives with the bills (enter-now-pay-later) module — expenses today are recorded as
        paid, so there is no payable aging yet.
      </p>
    </div>
  );
}
