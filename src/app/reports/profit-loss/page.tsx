import { getCurrentContext } from '@/lib/context';
import { profitAndLoss, type PnlSection } from '@/lib/ledger/reports';
import { formatMoney } from '@/lib/money';
import { DateRangeForm } from '../date-range-form';

export const dynamic = 'force-dynamic';

function Section({ section, currency }: { section: PnlSection; currency: string }) {
  return (
    <>
      <tr className="bg-slate-50">
        <td className="px-5 py-2.5 font-medium" colSpan={2}>
          {section.title}
        </td>
      </tr>
      {section.rows.map((r) => (
        <tr key={r.accountId} className="border-b border-slate-50">
          <td className="px-5 py-2 pl-9">
            <span className="font-mono text-xs text-slate-400 mr-2">{r.code}</span>
            {r.name}
          </td>
          <td className="px-5 py-2 text-right tabular-nums">{formatMoney(r.amount, currency)}</td>
        </tr>
      ))}
      <tr className="border-b border-slate-100">
        <td className="px-5 py-2.5 font-medium">Total {section.title}</td>
        <td className="px-5 py-2.5 text-right tabular-nums font-medium">
          {formatMoney(section.total, currency)}
        </td>
      </tr>
    </>
  );
}

export default async function ProfitLossPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const { business } = await getCurrentContext();
  const currency = business.functionalCurrency;

  const year = new Date().getUTCFullYear();
  const from = params.from || `${year}-01-01`;
  const to = params.to || new Date().toISOString().slice(0, 10);

  const pnl = await profitAndLoss(business.id, { from: new Date(from), to: new Date(to) });

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Profit &amp; Loss</h1>
          <p className="text-sm text-slate-500 mt-1">
            {from} → {to} · {currency} ·{' '}
            <a href={`/reports/export/profit-loss?from=${from}&to=${to}`} className="text-teal-700 hover:underline">CSV</a>
          </p>
        </div>
        <DateRangeForm from={from} to={to} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            <Section section={pnl.income} currency={currency} />
            <Section section={pnl.cogs} currency={currency} />
            <tr className="border-b border-slate-200 bg-teal-50/50">
              <td className="px-5 py-2.5 font-medium">Gross Profit</td>
              <td className="px-5 py-2.5 text-right tabular-nums font-medium">
                {formatMoney(pnl.grossProfit, currency)}
              </td>
            </tr>
            <Section section={pnl.expenses} currency={currency} />
            <tr className="bg-slate-100">
              <td className="px-5 py-3 font-semibold">Net Income</td>
              <td
                className={`px-5 py-3 text-right tabular-nums font-semibold ${
                  pnl.netIncome < 0n ? 'text-red-600' : 'text-green-700'
                }`}
              >
                {formatMoney(pnl.netIncome, currency)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
