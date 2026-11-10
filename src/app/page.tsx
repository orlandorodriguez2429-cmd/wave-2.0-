import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { profitAndLoss } from '@/lib/ledger/reports';
import { vendor1099Totals } from '@/lib/forms1099/tracking';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

function fiscalYearStart(fiscalYearStartMonth: number, today = new Date()): Date {
  const year =
    today.getUTCMonth() + 1 >= fiscalYearStartMonth ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  return new Date(Date.UTC(year, fiscalYearStartMonth - 1, 1));
}

/** Last `count` calendar months (oldest first), as [monthStart, monthEnd] UTC date pairs. */
function trailingMonths(count: number, today = new Date()): Array<{ from: Date; to: Date; label: string }> {
  const months = [];
  for (let i = count - 1; i >= 0; i--) {
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i + 1, 0));
    months.push({ from, to, label: from.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) });
  }
  return months;
}

export default async function Dashboard() {
  const { business } = await getCurrentContext();
  const currency = business.functionalCurrency;
  const fyStart = fiscalYearStart(business.fiscalYearStartMonth);
  const months = trailingMonths(6);
  const thisMonth = months[months.length - 1];
  const taxYear = new Date().getUTCFullYear();

  const [ytd, monthlyPnl, connections, toReviewByMonth, flaggedCount, closes, totals1099] = await Promise.all([
    profitAndLoss(business.id, { from: fyStart, to: new Date() }),
    Promise.all(months.map((m) => profitAndLoss(business.id, { from: m.from, to: m.to }))),
    prisma.bankConnection.findMany({
      where: { businessId: business.id, status: { not: 'REMOVED' } },
      include: { _count: { select: { accounts: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    Promise.all(
      months.map((m) =>
        prisma.importedTransaction.groupBy({
          by: ['status'],
          where: { businessId: business.id, date: { gte: m.from, lte: m.to } },
          _count: { _all: true },
        }),
      ),
    ),
    prisma.importedTransaction.count({ where: { businessId: business.id, needsReview: true } }),
    prisma.periodClose.findMany({ where: { businessId: business.id, status: 'CLOSED' }, select: { periodEnd: true } }),
    vendor1099Totals(business.id, taxYear),
  ]);

  const expensesOf = (p: (typeof monthlyPnl)[number]) => p.cogs.total + p.expenses.total;
  const current = monthlyPnl[monthlyPnl.length - 1];
  const cards = [
    { label: `Income · ${thisMonth.label}`, value: current.income.total },
    { label: `Expenses · ${thisMonth.label}`, value: expensesOf(current) },
    { label: `Net · ${thisMonth.label}`, value: current.netIncome },
    { label: 'Net · year to date', value: ytd.netIncome },
  ];

  const trend = months.map((m, i) => ({ label: m.label, netIncome: monthlyPnl[i].netIncome }));
  const abs = (n: bigint) => (n < 0n ? -n : n);
  const maxAbs = trend.reduce((m, t) => (abs(t.netIncome) > m ? abs(t.netIncome) : m), 1n);

  // Month-to-month status, newest first. (Phase B turns this into the full
  // per-month checklist with close/reopen rules.)
  const closedThrough = business.booksClosedThrough;
  const closedEnds = new Set(closes.map((c) => c.periodEnd.toISOString().slice(0, 10)));
  const monthRows = months
    .map((m, i) => {
      const counts = Object.fromEntries(toReviewByMonth[i].map((g) => [g.status, g._count._all]));
      const total = Object.values(counts).reduce((s: number, n) => s + (n as number), 0);
      const pending = counts.PENDING ?? 0;
      const isCurrent = i === months.length - 1;
      const closed = (closedThrough && m.to <= closedThrough) || closedEnds.has(m.to.toISOString().slice(0, 10));
      const status = closed
        ? { label: 'Closed', cls: 'bg-green-100 text-green-700' }
        : pending > 0
          ? { label: `${pending} to review`, cls: 'bg-amber-100 text-amber-800' }
          : total === 0
            ? { label: connections.length ? 'No bank data' : 'Bank not connected', cls: 'bg-slate-100 text-slate-500' }
            : isCurrent
              ? { label: 'In progress', cls: 'bg-teal-50 text-teal-700' }
              : { label: 'Ready to close', cls: 'bg-teal-100 text-teal-800' };
      return { label: m.from.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), status, net: monthlyPnl[i].netIncome };
    })
    .reverse();
  const totalToReview = toReviewByMonth.flat().filter((g) => g.status === 'PENDING').reduce((s, g) => s + g._count._all, 0);

  const reportable = totals1099.filter((t) => t.status === 'REPORTABLE');
  const approaching = totals1099.filter((t) => t.status === 'APPROACHING');
  const missingW9 = reportable.filter((t) => !t.is1099Eligible);

  const CONN: Record<string, { label: string; cls: string }> = {
    ACTIVE: { label: 'OK', cls: 'bg-green-100 text-green-700' },
    ERROR: { label: 'Sync error', cls: 'bg-red-100 text-red-700' },
    NEEDS_RECONNECT: { label: 'Needs reconnect', cls: 'bg-amber-100 text-amber-800' },
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--wave-navy)]">{business.name}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {business.accountingBasis === 'ACCRUAL' ? 'Accrual basis' : 'Cash basis'} · books closed through{' '}
          {closedThrough ? closedThrough.toISOString().slice(0, 10) : 'never'}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{c.label}</p>
            <p className={`mt-2 text-xl font-semibold tabular-nums ${c.value < 0n ? 'text-red-600' : 'text-[var(--wave-navy)]'}`}>
              {formatMoney(c.value, currency)}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="font-medium text-[var(--wave-navy)]">Months</h2>
            <Link href="/close" className="text-sm font-medium text-teal-600 hover:underline">Open months</Link>
          </div>
          <ul className="divide-y divide-slate-50">
            {monthRows.map((m) => (
              <li key={m.label} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span>{m.label}</span>
                <span className="flex items-center gap-3">
                  <span className={`tabular-nums ${m.net < 0n ? 'text-red-600' : 'text-slate-600'}`}>{formatMoney(m.net, currency)}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${m.status.cls}`}>{m.status.label}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-[var(--wave-navy)]">Profit &amp; Loss</h2>
            <Link href="/reports/profit-loss" className="text-sm font-medium text-teal-600 hover:underline">Full report</Link>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">Net income by month, last 6 months</p>
          <div className="mt-5 flex items-end gap-3 h-40">
            {trend.map((t) => {
              const barHeight = Math.max(4, Number((abs(t.netIncome) * 100n) / maxAbs));
              return (
                <div key={t.label} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
                  <div className="w-full flex flex-col justify-end h-full">
                    <div
                      className={`w-full rounded-t-sm ${t.netIncome < 0n ? 'bg-red-300' : 'bg-teal-400'}`}
                      style={{ height: `${barHeight}%` }}
                      title={formatMoney(t.netIncome, currency)}
                    />
                  </div>
                  <span className="text-xs text-slate-400">{t.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-[var(--wave-navy)]">Bank accounts</h2>
            <Link href="/banking" className="text-sm font-medium text-teal-600 hover:underline">
              {connections.length ? 'Manage' : 'Connect a bank'}
            </Link>
          </div>
          {connections.length === 0 ? (
            <p className="text-sm text-slate-500">No bank connected yet. Connect one and transactions arrive on their own.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {connections.map((c) => {
                const st = CONN[c.status] ?? CONN.ERROR;
                return (
                  <li key={c.id} className="flex items-center justify-between">
                    <span>
                      {c.institutionName}{' '}
                      <span className="text-slate-400">
                        · {c._count.accounts} account{c._count.accounts === 1 ? '' : 's'} · last sync{' '}
                        {c.lastSyncAt ? c.lastSyncAt.toISOString().slice(0, 10) : 'never'}
                      </span>
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {(totalToReview > 0 || flaggedCount > 0) && (
            <Link href="/banking" className="block rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 hover:bg-amber-100">
              {totalToReview > 0 && <>{totalToReview} transaction{totalToReview === 1 ? '' : 's'} to review</>}
              {totalToReview > 0 && flaggedCount > 0 && ' · '}
              {flaggedCount > 0 && <>{flaggedCount} changed by the bank after posting</>}
            </Link>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-[var(--wave-navy)]">1099 watch · {taxYear}</h2>
            <Link href="/1099" className="text-sm font-medium text-teal-600 hover:underline">Open 1099s</Link>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-slate-50 py-3">
              <dt className="text-xs text-slate-500">Need a 1099</dt>
              <dd className="text-xl font-semibold text-[var(--wave-navy)]">{reportable.length}</dd>
            </div>
            <div className="rounded-lg bg-slate-50 py-3">
              <dt className="text-xs text-slate-500">Approaching</dt>
              <dd className="text-xl font-semibold text-[var(--wave-navy)]">{approaching.length}</dd>
            </div>
            <div className={`rounded-lg py-3 ${missingW9.length ? 'bg-red-50' : 'bg-slate-50'}`}>
              <dt className="text-xs text-slate-500">Missing W-9</dt>
              <dd className={`text-xl font-semibold ${missingW9.length ? 'text-red-600' : 'text-[var(--wave-navy)]'}`}>{missingW9.length}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
