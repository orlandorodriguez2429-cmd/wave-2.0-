import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { monthStatuses, type MonthStatus } from '@/lib/months';
import { profitAndLoss } from '@/lib/ledger/reports';
import { formatMoney } from '@/lib/money';
import { ActionButton } from '@/components/action-button';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { closeMonthAction, reopenMonthAction, saveBooksSettingsAction } from '@/app/months-actions';
import { MonthReopen } from './month-reopen';

export const dynamic = 'force-dynamic';

const STATUS: Record<MonthStatus, { label: (n: number) => string; cls: string }> = {
  CLOSED: { label: () => 'Closed', cls: 'bg-green-100 text-green-700' },
  READY: { label: () => 'Ready to close', cls: 'bg-teal-100 text-teal-800' },
  NEEDS_REVIEW: { label: (n) => `${n} to review`, cls: 'bg-amber-100 text-amber-800' },
  NO_DATA: { label: () => 'No bank data', cls: 'bg-slate-100 text-slate-500' },
  NOT_CONNECTED: { label: () => 'Bank not connected', cls: 'bg-slate-100 text-slate-500' },
  IN_PROGRESS: { label: () => 'In progress', cls: 'bg-sky-50 text-sky-700' },
};

export default async function MonthsPage() {
  const { business, role } = await getCurrentContext();
  const canManage = role === 'OWNER' || role === 'ACCOUNTANT';
  const months = (await monthStatuses(business.id)).reverse();
  const nets = await Promise.all(months.map((m) => profitAndLoss(business.id, { from: m.start, to: m.end })));
  const firstOpenIdx = [...months].reverse().findIndex((m) => m.status !== 'CLOSED');
  const nextToClose = firstOpenIdx >= 0 ? [...months].reverse()[firstOpenIdx] : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Months</h1>
        <p className="text-sm text-slate-500 mt-1">
          Each month: bank transactions come in, get sorted automatically, you review what&apos;s unclear, then close it.
          A closed month is locked — nothing can post into it until an owner or accountant reopens it (with a reason, kept in
          the audit log). Closed through{' '}
          <strong>{business.booksClosedThrough?.toISOString().slice(0, 10) ?? 'never'}</strong>.
        </p>
      </div>

      {canManage && (
        <SimpleRecordForm
          action={saveBooksSettingsAction}
          submitLabel="Save"
          fields={[
            { name: 'booksStart', label: 'First month we keep books for (YYYY-MM)', placeholder: '2026-01', defaultValue: business.booksStartDate?.toISOString().slice(0, 7) ?? '', width: 'w-64' },
            { name: 'businessType', label: 'Business type (helps the AI sort; no names)', placeholder: 'e.g. residential cleaning', defaultValue: business.businessType ?? '', width: 'w-72' },
          ]}
        />
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5 font-medium">Month</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium text-right">Bank txns</th>
              <th className="px-3 py-2.5 font-medium text-right">Net income</th>
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => {
              const st = STATUS[m.status];
              const isNext = nextToClose?.key === m.key;
              return (
                <tr key={m.key} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3 font-medium">{m.label}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label(m.toReview + m.flagged)}</span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{m.imported}</td>
                  <td className={`px-3 py-3 text-right tabular-nums ${nets[i].netIncome < 0n ? 'text-red-600' : ''}`}>
                    {formatMoney(nets[i].netIncome, business.functionalCurrency)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {canManage && m.status === 'NEEDS_REVIEW' && (
                      <Link href="/banking" className="text-sm text-teal-700 hover:underline">Review</Link>
                    )}
                    {canManage && isNext && (m.status === 'READY' || m.status === 'NO_DATA' || m.status === 'NOT_CONNECTED') && (
                      <ActionButton
                        action={closeMonthAction.bind(null, m.key)}
                        label="Close month"
                        confirmLabel={`Lock ${m.label}`}
                        variant="primary"
                      />
                    )}
                    {canManage && m.status === 'CLOSED' && (
                      <MonthReopen action={reopenMonthAction.bind(null, m.key)} />
                    )}
                  </td>
                </tr>
              );
            })}
            {months.length === 0 && (
              <tr><td className="px-5 py-6 text-slate-400">Set the first month above to start.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Months close in order. Reopening a month also reopens every later month, because the lock is &quot;closed through&quot; a date.
      </p>
    </div>
  );
}
