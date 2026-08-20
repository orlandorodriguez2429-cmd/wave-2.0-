import { getCurrentContext } from '@/lib/context';
import { cashFlow } from '@/lib/ledger/more-reports';
import { formatMoney } from '@/lib/money';
import { DateRangeForm } from '../date-range-form';

export const dynamic = 'force-dynamic';

export default async function CashFlowPage({
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
  const report = await cashFlow(business.id, { from: new Date(from), to: new Date(to) });

  const line = (label: string, value: bigint, bold = false) => (
    <p className={`flex justify-between py-1.5 ${bold ? 'font-semibold border-t border-slate-200 mt-1 pt-2' : ''}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${value < 0n ? 'text-red-600' : ''}`}>{formatMoney(value, cur)}</span>
    </p>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Cash Flow Statement</h1>
          <p className="text-sm text-slate-500 mt-1">
            {from} → {to} · {cur} ·{' '}
            <a href={`/reports/export/cash-flow?from=${from}&to=${to}`} className="text-blue-700 hover:underline">CSV</a>
          </p>
        </div>
        <DateRangeForm from={from} to={to} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
        {line('Opening cash', report.openingCash)}
        {line('Net cash from operating activities', report.operating)}
        {line('Net cash from investing activities', report.investing)}
        {line('Net cash from financing activities', report.financing)}
        {line('Net change in cash', report.netChange, true)}
        {line('Closing cash', report.closingCash, true)}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <h2 className="px-5 py-3 border-b border-slate-100 font-medium">Cash movements</h2>
        <table className="w-full text-sm">
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.entryId} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2 text-slate-500 whitespace-nowrap">{r.date}</td>
                <td className="px-3 py-2 text-slate-400 whitespace-nowrap">JE-{r.entryNumber}</td>
                <td className="px-3 py-2 w-full">{r.memo}</td>
                <td className="px-3 py-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.bucket}</span>
                </td>
                <td className={`px-5 py-2 text-right tabular-nums ${r.delta < 0n ? '' : 'text-green-700'}`}>
                  {formatMoney(r.delta, cur)}
                </td>
              </tr>
            ))}
            {report.rows.length === 0 && (
              <tr><td className="px-5 py-6 text-slate-400">No cash movements in this period.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
