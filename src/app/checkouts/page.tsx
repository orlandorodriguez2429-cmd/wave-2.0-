import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { ActionButton } from '@/components/action-button';
import { createCheckoutAction, voidCheckoutAction } from '@/app/checkouts-actions';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-700',
  PAID: 'bg-green-100 text-green-700',
  VOID: 'bg-slate-100 text-slate-600',
};

export default async function CheckoutsPage() {
  const { business } = await getCurrentContext();
  const [checkouts, incomeAccounts] = await Promise.all([
    prisma.checkout.findMany({ where: { businessId: business.id }, orderBy: { createdAt: 'desc' } }),
    prisma.account.findMany({
      where: { businessId: business.id, type: 'INCOME', isArchived: false },
      orderBy: { code: 'asc' },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Checkouts</h1>
        <p className="text-sm text-slate-500 mt-1">
          Standalone payment links for one-off charges that aren&apos;t tied to an invoice. Sandbox
          payments — a real card processor plugs into the same &quot;Pay now&quot; step in production.
        </p>
      </div>
      <SimpleRecordForm
        action={createCheckoutAction}
        submitLabel="Create checkout link"
        fields={[
          { name: 'description', label: 'Description', required: true, width: 'flex-1 min-w-48' },
          { name: 'amount', label: 'Amount', placeholder: '0.00', required: true, width: 'w-28' },
          {
            name: 'incomeAccountId',
            label: 'Income account',
            type: 'select',
            width: 'w-56',
            options: incomeAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
          },
        ]}
      />
      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Description</th>
              <th className="px-3 py-3 font-medium text-right">Amount</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Link</th>
              <th className="px-5 py-3 font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            {checkouts.map((c) => (
              <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3 font-medium">{c.description}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMoney(c.amount, c.currency)}</td>
                <td className="px-3 py-3">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                </td>
                <td className="px-3 py-3">
                  {c.status === 'OPEN' ? (
                    <a href={`/pay/${c.token}`} target="_blank" className="text-teal-700 hover:underline">
                      /pay/{c.token.slice(0, 10)}…
                    </a>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  {c.status === 'OPEN' && (
                    <ActionButton
                      action={voidCheckoutAction.bind(null, c.id)}
                      label="Void"
                      confirmLabel="Confirm void"
                      variant="danger"
                    />
                  )}
                </td>
              </tr>
            ))}
            {checkouts.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={5}>
                  No checkout links yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
