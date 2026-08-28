import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { profitAndLoss, trialBalance } from '@/lib/ledger/reports';
import { signedBalance } from '@/lib/ledger/validate';
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

  const [tb, pnl, monthlyPnl, invoices, recent] = await Promise.all([
    trialBalance(business.id),
    profitAndLoss(business.id, { from: fyStart, to: new Date() }),
    Promise.all(months.map((m) => profitAndLoss(business.id, { from: m.from, to: m.to }))),
    prisma.invoice.findMany({
      where: { businessId: business.id, status: { in: ['OPEN', 'PAID'] } },
      select: { status: true, total: true, dueDate: true, updatedAt: true },
    }),
    prisma.journalEntry.findMany({
      where: { businessId: business.id, status: 'POSTED' },
      orderBy: [{ date: 'desc' }, { entryNumber: 'desc' }],
      take: 6,
      include: { lines: true, reversedBy: { select: { id: true } } },
    }),
  ]);

  const sumBy = (pred: (r: (typeof tb.rows)[number]) => boolean) =>
    tb.rows.filter(pred).reduce((s, r) => s + signedBalance(r.type, r.debits, r.credits), 0n);

  const cash = sumBy((r) => r.subtype === 'cash_and_bank');
  const receivable = sumBy((r) => r.subtype === 'accounts_receivable');
  const payable = sumBy((r) => r.subtype === 'accounts_payable' || r.subtype === 'credit_card');

  const cards = [
    { label: 'Cash You Have', value: cash },
    { label: 'Money Owed to You', value: receivable },
    { label: 'Money You Owe', value: payable },
    { label: `Profit (FY from ${fyStart.toISOString().slice(0, 10)})`, value: pnl.netIncome },
  ];

  const trend = months.map((m, i) => ({ label: m.label, netIncome: monthlyPnl[i].netIncome }));
  const maxAbs = trend.reduce((m, t) => (t.netIncome < 0n ? -t.netIncome : t.netIncome) > m ? (t.netIncome < 0n ? -t.netIncome : t.netIncome) : m, 1n);

  const today = new Date();
  const overdue = invoices.filter((i) => i.status === 'OPEN' && i.dueDate < today);
  const openNotOverdue = invoices.filter((i) => i.status === 'OPEN' && i.dueDate >= today);
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const paidRecently = invoices.filter((i) => i.status === 'PAID' && i.updatedAt >= thirtyDaysAgo);
  const invoiceBuckets = [
    { label: 'Overdue', count: overdue.length, total: overdue.reduce((s, i) => s + i.total, 0n), color: 'bg-red-400' },
    { label: 'Open', count: openNotOverdue.length, total: openNotOverdue.reduce((s, i) => s + i.total, 0n), color: 'bg-amber-400' },
    { label: 'Paid (30 days)', count: paidRecently.length, total: paidRecently.reduce((s, i) => s + i.total, 0n), color: 'bg-teal-400' },
  ];
  const invoiceGrandTotal = invoiceBuckets.reduce((s, b) => s + b.total, 0n) || 1n;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--wave-navy)]">{business.name}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {business.accountingBasis === 'ACCRUAL' ? 'Accrual basis' : 'Cash basis'} · Functional currency {currency}
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
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-medium text-[var(--wave-navy)]">Profit &amp; Loss</h2>
          <p className="text-xs text-slate-500 mt-0.5">Net income by month, last 6 months</p>
          <div className="mt-5 flex items-end gap-3 h-32">
            {trend.map((t) => {
              const barHeight = Math.max(4, Number((t.netIncome < 0n ? -t.netIncome : t.netIncome) * 100n / maxAbs));
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

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-[var(--wave-navy)]">Invoices</h2>
            <Link href="/invoices" className="text-sm font-medium text-teal-600 hover:underline">
              View all
            </Link>
          </div>
          <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            {invoiceBuckets.map((b) => (
              <div
                key={b.label}
                className={b.color}
                style={{ width: `${Number((b.total * 100n) / invoiceGrandTotal)}%` }}
              />
            ))}
          </div>
          <ul className="mt-4 space-y-2.5">
            {invoiceBuckets.map((b) => (
              <li key={b.label} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-slate-600">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${b.color}`} />
                  {b.label} ({b.count})
                </span>
                <span className="font-medium tabular-nums text-[var(--wave-navy)]">
                  {formatMoney(b.total, currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-medium text-[var(--wave-navy)]">Recent journal entries</h2>
          <Link
            href="/journal/new"
            className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600"
          >
            + New entry
          </Link>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {recent.map((e) => {
              const total = e.lines
                .filter((l) => l.direction === 'DEBIT')
                .reduce((s, l) => s + l.functionalAmount, 0n);
              return (
                <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                    {e.date.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-3 py-3 text-slate-400 whitespace-nowrap">JE-{e.entryNumber}</td>
                  <td className="px-3 py-3 w-full">
                    <Link href={`/journal/${e.id}`} className="hover:underline">
                      {e.memo}
                    </Link>
                    {e.reversedBy && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                        Reversed
                      </span>
                    )}
                    {e.reversesId && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        Reversal
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums whitespace-nowrap">
                    {formatMoney(total, currency)}
                  </td>
                </tr>
              );
            })}
            {recent.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={4}>
                  No entries yet — post your first journal entry.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
