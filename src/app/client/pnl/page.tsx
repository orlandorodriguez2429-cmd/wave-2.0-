import { getClientContext } from '@/lib/context';
import { parsePeriod, portalPnl } from '@/lib/client-portal';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function ClientPnl({ searchParams }: { searchParams: Promise<{ period?: string; value?: string }> }) {
  const sp = await searchParams;
  const { business } = await getClientContext();
  const period = parsePeriod(sp.period, sp.value);
  const pnl = await portalPnl(business.id, period.from, period.to);
  const cur = business.functionalCurrency;
  const qs = `period=${period.kind}&value=${encodeURIComponent(period.value)}`;
  const input = 'rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white';
  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Profit &amp; Loss</h1>
          <p className="text-sm text-slate-500">{period.label} · {business.accountingBasis === 'CASH' ? 'cash' : 'accrual'} basis</p>
        </div>
        <div className="flex gap-2 text-sm">
          <a href={`/client/pnl/export?${qs}&format=pdf`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">Download PDF</a>
          <a href={`/client/pnl/export?${qs}&format=csv`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">Download CSV</a>
        </div>
      </div>
      <form method="GET" className="flex flex-wrap items-end gap-2">
        <select name="period" defaultValue={period.kind} className={input}>
          <option value="month">Month</option>
          <option value="quarter">Quarter</option>
          <option value="year">Year</option>
        </select>
        <input name="value" defaultValue={period.value} placeholder="2026-09 · 2026-Q3 · 2026" className={`${input} w-44`} />
        <button className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white">Show</button>
      </form>
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        {[pnl.income, pnl.cogs, pnl.expenses].map((section) =>
          section.rows.length === 0 && section !== pnl.income ? null : (
            <div key={section.title} className="mb-4">
              <h2 className="font-medium mb-1">{section.title}</h2>
              {section.rows.map((r) => (
                <div key={r.code} className="flex justify-between py-1 pl-3 text-sm">
                  <span className="text-slate-600">{r.name}</span>
                  <span className="tabular-nums">{formatMoney(r.amount, cur)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-slate-100 pt-1 text-sm font-medium">
                <span>Total {section.title}</span>
                <span className="tabular-nums">{formatMoney(section.total, cur)}</span>
              </div>
            </div>
          ),
        )}
        <div className="flex justify-between border-t-2 border-slate-200 pt-2 font-semibold">
          <span>Net income</span>
          <span className={`tabular-nums ${pnl.netIncome < 0n ? 'text-red-600' : ''}`}>{formatMoney(pnl.netIncome, cur)}</span>
        </div>
      </div>
    </div>
  );
}
