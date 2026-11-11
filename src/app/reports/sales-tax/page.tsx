import { getCurrentContext } from '@/lib/context';
import { salesTaxReport } from '@/lib/ledger/more-reports';
import { formatMoney } from '@/lib/money';
import { DateRangeForm } from '../date-range-form';

export const dynamic = 'force-dynamic';

export default async function SalesTaxReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const { business } = await getCurrentContext();
  const cur = business.functionalCurrency;
  const year = new Date().getUTCFullYear();
  const from = params.from || `${year}-01-01`;
  const to = params.to || new Date().toISOString().slice(0, 10);
  const report = await salesTaxReport(business.id, { from: new Date(from), to: new Date(to) });

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Sales Tax Report</h1>
          <p className="text-sm text-slate-500 mt-1">
            Collected on approved invoices, {from} → {to} ·{' '}
            <a href={`/reports/export/sales-tax?from=${from}&to=${to}`} className="text-teal-700 hover:underline">CSV</a>
          </p>
        </div>
        <DateRangeForm from={from} to={to} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Tax rate</th>
              <th className="px-3 py-3 font-medium">Jurisdiction</th>
              <th className="px-3 py-3 font-medium text-right">Taxable sales</th>
              <th className="px-5 py-3 font-medium text-right">Tax collected</th>
            </tr>
          </thead>
          <tbody>
            {report.byRate.map((r) => (
              <tr key={r.taxRateId} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5">{r.name}</td>
                <td className="px-3 py-2.5 text-slate-500">{r.jurisdiction ?? '—'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(r.taxable, cur)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(r.collected, cur)}</td>
              </tr>
            ))}
            {report.byRate.length === 0 && (
              <tr><td className="px-5 py-6 text-slate-400" colSpan={4}>No taxed invoices in this period.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
              <td className="px-5 py-3" colSpan={3}>Total collected (owed to jurisdictions)</td>
              <td className="px-5 py-3 text-right tabular-nums">{formatMoney(report.totalCollected, cur)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
