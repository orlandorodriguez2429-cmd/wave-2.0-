import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { ActionButton } from '@/components/action-button';
import { RecurringInvoiceForm } from '@/components/recurring-invoice-form';
import {
  createRecurringInvoiceAction,
  deleteRecurringInvoiceAction,
  setRecurringInvoicePausedAction,
} from '@/app/recurring-actions';
import type { RecurringTemplate } from '@/lib/invoicing/recurring';

export const dynamic = 'force-dynamic';

const FREQUENCY_LABEL: Record<string, string> = {
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
};

export default async function RecurringInvoicesPage() {
  const { business } = await getCurrentContext();
  const [schedules, customers, incomeAccounts] = await Promise.all([
    prisma.recurringInvoice.findMany({
      where: { businessId: business.id },
      include: { customer: true },
      orderBy: { nextRunDate: 'asc' },
    }),
    prisma.customer.findMany({ where: { businessId: business.id, isArchived: false }, orderBy: { name: 'asc' } }),
    prisma.account.findMany({
      where: { businessId: business.id, type: 'INCOME', isArchived: false },
      orderBy: { code: 'asc' },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Recurring Invoices</h1>
        <p className="text-sm text-slate-500 mt-1">
          Schedules run automatically via the background jobs runner (<code className="font-mono text-xs">npx tsx scripts/run-jobs.ts</code>{' '}
          on a cron); this page just manages them.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Customer</th>
              <th className="px-3 py-3 font-medium">Frequency</th>
              <th className="px-3 py-3 font-medium">Next run</th>
              <th className="px-3 py-3 font-medium text-right">Amount</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => {
              const template = s.template as unknown as RecurringTemplate;
              const amount = template.lines.reduce(
                (sum, l) => sum + (BigInt(l.quantityMilli) * BigInt(l.unitPrice) + 500n) / 1000n,
                0n,
              );
              return (
                <tr key={s.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium">{s.customer.name}</td>
                  <td className="px-3 py-3 text-slate-500">{FREQUENCY_LABEL[s.frequency]}</td>
                  <td className="px-3 py-3 text-slate-500">{s.nextRunDate.toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatMoney(amount, template.currency)}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${s.isPaused ? 'bg-slate-100 text-slate-600' : 'bg-green-100 text-green-700'}`}>
                      {s.isPaused ? 'Paused' : 'Active'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right space-x-2">
                    <ActionButton
                      action={setRecurringInvoicePausedAction.bind(null, s.id, !s.isPaused)}
                      label={s.isPaused ? 'Resume' : 'Pause'}
                    />
                    <ActionButton
                      action={deleteRecurringInvoiceAction.bind(null, s.id)}
                      label="Delete"
                      confirmLabel="Confirm delete"
                      variant="danger"
                    />
                  </td>
                </tr>
              );
            })}
            {schedules.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={6}>
                  No recurring invoices yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">New recurring invoice</h2>
        <RecurringInvoiceForm
          action={createRecurringInvoiceAction}
          customers={customers.map((c) => ({ value: c.id, label: c.name }))}
          incomeAccounts={incomeAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
          functionalCurrency={business.functionalCurrency}
        />
      </div>
    </div>
  );
}
