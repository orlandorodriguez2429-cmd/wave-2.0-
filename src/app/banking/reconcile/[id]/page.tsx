import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentContext } from '@/lib/context';
import { formatMoney } from '@/lib/money';
import { reconciliationReport } from '@/lib/banking/reconcile';
import { ActionButton } from '@/components/action-button';
import { completeReconciliationAction } from '@/app/banking-actions';

export const dynamic = 'force-dynamic';

export default async function ReconcileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await getCurrentContext();
  let report;
  try {
    report = await reconciliationReport(business.id, id);
  } catch {
    notFound();
  }
  const cur = business.functionalCurrency;
  const { session, account } = report;

  const stat = (label: string, value: bigint, highlight = false) => (
    <div className={`rounded-lg border p-4 ${highlight ? (value === 0n ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50') : 'border-slate-200 bg-white'}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${highlight && value !== 0n ? 'text-red-700' : ''}`}>
        {formatMoney(value, cur)}
      </p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">
            <Link href="/banking/reconcile" className="hover:underline">Reconciliation</Link> / {account.code}
          </p>
          <h1 className="text-2xl font-semibold mt-1">
            {account.code} · {account.name}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Statement {session.statementStart.toISOString().slice(0, 10)} → {session.statementEnd.toISOString().slice(0, 10)} ·{' '}
            {session.status === 'COMPLETED' ? 'completed' : 'in progress'}
          </p>
        </div>
        {session.status === 'OPEN' && (
          <ActionButton
            action={completeReconciliationAction.bind(null, session.id)}
            label="Complete reconciliation"
            variant="primary"
          />
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {stat('Statement opening', session.startingBalance)}
        {stat('Statement closing', session.endingBalance)}
        {stat('Ledger @ start', report.ledgerStart)}
        {stat('Ledger @ end', report.ledgerEnd)}
        {stat('Variance', report.variance, true)}
      </div>
      {report.openingVariance !== 0n && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-4 py-2">
          Opening balances differ by {formatMoney(report.openingVariance, cur)} — the prior period may not be
          reconciled.
        </p>
      )}
      {report.unresolvedCount > 0 && (
        <p className="text-sm text-slate-600">
          {report.unresolvedCount} imported transaction(s) in this period still need review on the{' '}
          <Link href="/banking" className="text-teal-700 hover:underline">Banking</Link> page. The variance
          updates as you categorize or match them.
        </p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <h2 className="px-5 py-3 border-b border-slate-100 font-medium">Statement-period transactions</h2>
        <table className="w-full text-sm">
          <tbody>
            {report.transactions.map((t) => (
              <tr key={t.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5 text-slate-500 whitespace-nowrap">{t.date.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-2.5 w-full">{t.description}</td>
                <td className="px-3 py-2.5">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    t.status === 'PENDING' ? 'bg-amber-100 text-amber-700'
                    : t.status === 'EXCLUDED' ? 'bg-slate-100 text-slate-500'
                    : 'bg-green-100 text-green-700'
                  }`}>
                    {t.status.toLowerCase()}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {formatMoney(t.amount, cur)}
                </td>
              </tr>
            ))}
            {report.transactions.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400">No imported transactions in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
