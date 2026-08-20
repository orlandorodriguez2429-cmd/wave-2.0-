import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { ActionButton } from '@/components/action-button';
import { ChecklistItemToggle } from './checklist-toggle';
import { closePeriodAction, reopenPeriodAction, startPeriodCloseAction } from '@/app/close-actions';

export const dynamic = 'force-dynamic';

export default async function ClosePage() {
  const { business, role } = await getCurrentContext();
  const closes = await prisma.periodClose.findMany({
    where: { businessId: business.id },
    orderBy: { periodEnd: 'desc' },
  });
  const lastMonthEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 0))
    .toISOString()
    .slice(0, 10);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Close the Books</h1>
        <p className="text-sm text-slate-500 mt-1">
          Work the checklist, then close the period — the ledger refuses new postings dated in a closed
          period. Books currently closed through:{' '}
          <strong>{business.booksClosedThrough?.toISOString().slice(0, 10) ?? 'never'}</strong>.
        </p>
      </div>

      <SimpleRecordForm
        action={startPeriodCloseAction}
        submitLabel="Start period close"
        fields={[{ name: 'periodEnd', label: 'Period end', type: 'date', defaultValue: lastMonthEnd, required: true }]}
      />

      {closes.map((close) => {
        const checklist = close.checklist as Array<{ key: string; label: string; done: boolean }>;
        const remaining = checklist.filter((i) => !i.done).length;
        return (
          <div key={close.id} className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">
                Period ending {close.periodEnd.toISOString().slice(0, 10)}
                <span className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${
                  close.status === 'CLOSED' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {close.status.toLowerCase()}
                </span>
              </h2>
              {close.status === 'OPEN' ? (
                <ActionButton
                  action={closePeriodAction.bind(null, close.id)}
                  label={remaining > 0 ? `Close (${remaining} item(s) left)` : 'Close period'}
                  confirmLabel="Confirm close — locks the ledger"
                  variant="primary"
                />
              ) : (
                role === 'OWNER' && (
                  <ActionButton
                    action={reopenPeriodAction.bind(null, close.id)}
                    label="Reopen…"
                    confirmLabel="Confirm reopen"
                  />
                )
              )}
            </div>
            <ul className="space-y-1.5">
              {checklist.map((item) => (
                <ChecklistItemToggle
                  key={item.key}
                  closeId={close.id}
                  itemKey={item.key}
                  label={item.label}
                  done={item.done}
                  locked={close.status !== 'OPEN'}
                />
              ))}
            </ul>
          </div>
        );
      })}
      {closes.length === 0 && (
        <p className="text-sm text-slate-400">No period closes yet — start one for last month.</p>
      )}
    </div>
  );
}
