import Link from 'next/link';
import { getClientContext } from '@/lib/context';
import { portalDashboard } from '@/lib/client-portal';
import { formatMoney } from '@/lib/money';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function ClientDashboard() {
  const { business } = await getClientContext();
  const cur = business.functionalCurrency;
  const [d, needsReconnect] = await Promise.all([
    portalDashboard(business.id),
    prisma.bankConnection.count({ where: { businessId: business.id, status: { in: ['NEEDS_RECONNECT', 'ERROR'] } } }),
  ]);
  const max = d.trend.reduce((m, t) => {
    const v = t.income > t.expenses ? t.income : t.expenses;
    return v > m ? v : m;
  }, 1n);
  const pct = (v: bigint) => Math.max(2, Number((v * 100n) / max));
  const card = (label: string, v: bigint) => (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-xl font-semibold tabular-nums ${v < 0n ? 'text-red-600' : 'text-[var(--wave-navy)]'}`}>{formatMoney(v, cur)}</p>
    </div>
  );
  return (
    <div className="space-y-6">
      {needsReconnect > 0 && (
        <Link href="/client/bank" className="block rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Your bank needs you to sign in again so new transactions keep coming in. <strong>Reconnect now →</strong>
        </Link>
      )}
      <h1 className="text-2xl font-semibold">How the business is doing</h1>
      <div>
        <p className="mb-2 text-sm text-slate-500">This month ({d.thisMonth.label})</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {card('Income', d.thisMonth.income)}
          {card('Expenses', d.thisMonth.expenses)}
          {card('Net', d.thisMonth.net)}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm text-slate-500">Year to date</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {card('Income', d.ytd.income)}
          {card('Expenses', d.ytd.expenses)}
          {card('Net', d.ytd.net)}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-medium">Month by month</h2>
          <p className="text-xs text-slate-500 flex gap-3 mt-1">
            <span><span className="inline-block h-2 w-2 rounded-full bg-teal-500 mr-1" />Income</span>
            <span><span className="inline-block h-2 w-2 rounded-full bg-slate-400 mr-1" />Expenses</span>
          </p>
          <div className="mt-4 flex items-end gap-2 h-44">
            {d.trend.map((t) => (
              <div key={t.label} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`Net ${formatMoney(t.net, cur)}`}>
                <div className="w-full flex items-end justify-center gap-0.5 h-full">
                  <div className="w-1/2 rounded-t-sm bg-teal-500" style={{ height: `${pct(t.income)}%` }} />
                  <div className="w-1/2 rounded-t-sm bg-slate-400" style={{ height: `${pct(t.expenses)}%` }} />
                </div>
                <span className="text-[11px] text-slate-400">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-medium">Top expenses this year</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {d.topExpenses.map((e) => (
              <li key={e.code} className="flex justify-between gap-2">
                <span className="text-slate-600">{e.name}</span>
                <span className="tabular-nums">{formatMoney(e.amount, cur)}</span>
              </li>
            ))}
            {d.topExpenses.length === 0 && <li className="text-slate-400">Nothing yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
