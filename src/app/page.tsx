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

export default async function Dashboard() {
  const { business } = await getCurrentContext();
  const currency = business.functionalCurrency;
  const fyStart = fiscalYearStart(business.fiscalYearStartMonth);

  const [tb, pnl, recent] = await Promise.all([
    trialBalance(business.id),
    profitAndLoss(business.id, { from: fyStart, to: new Date() }),
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
    { label: 'Cash & Bank', value: cash },
    { label: `Net Income (FY from ${fyStart.toISOString().slice(0, 10)})`, value: pnl.netIncome },
    { label: 'Accounts Receivable', value: receivable },
    { label: 'Payables & Credit Cards', value: payable },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{business.name}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {business.accountingBasis === 'ACCRUAL' ? 'Accrual basis' : 'Cash basis'} · Functional currency {currency}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{c.label}</p>
            <p className={`mt-2 text-xl font-semibold tabular-nums ${c.value < 0n ? 'text-red-600' : ''}`}>
              {formatMoney(c.value, currency)}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-medium">Recent journal entries</h2>
          <Link href="/journal/new" className="text-sm font-medium text-blue-600 hover:underline">
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
