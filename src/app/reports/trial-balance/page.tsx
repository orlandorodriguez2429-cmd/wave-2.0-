import { getCurrentContext } from '@/lib/context';
import { trialBalance } from '@/lib/ledger/reports';
import { formatMoney } from '@/lib/money';
import { DateRangeForm } from '../date-range-form';

export const dynamic = 'force-dynamic';

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;
  const { business } = await getCurrentContext();
  const currency = business.functionalCurrency;
  const toDate = to || new Date().toISOString().slice(0, 10);

  const tb = await trialBalance(business.id, {
    from: from ? new Date(from) : undefined,
    to: new Date(toDate),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Trial Balance</h1>
          <p className="text-sm text-slate-500 mt-1">
            {from ? `${from} → ${toDate}` : `Through ${toDate}`} · {currency} ·{' '}
            <a href={`/reports/export/trial-balance?from=${from ?? ''}&to=${toDate}`} className="text-blue-700 hover:underline">CSV</a>
          </p>
        </div>
        <DateRangeForm from={from} to={toDate} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-3 py-3 font-medium text-right">Debit</th>
              <th className="px-5 py-3 font-medium text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((r) => (
              <tr key={r.accountId} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5">
                  <span className="font-mono text-xs text-slate-400 mr-2">{r.code}</span>
                  {r.name}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.debitBalance !== 0n ? formatMoney(r.debitBalance, currency) : ''}
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums">
                  {r.creditBalance !== 0n ? formatMoney(r.creditBalance, currency) : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
              <td className="px-5 py-3">Total</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatMoney(tb.totalDebits, currency)}</td>
              <td className="px-5 py-3 text-right tabular-nums">{formatMoney(tb.totalCredits, currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {tb.totalDebits === tb.totalCredits ? (
        <p className="text-sm text-green-600">Debits equal credits — the ledger is in balance.</p>
      ) : (
        <p className="text-sm text-red-600">Out of balance — this should be impossible; check the ledger.</p>
      )}
    </div>
  );
}
