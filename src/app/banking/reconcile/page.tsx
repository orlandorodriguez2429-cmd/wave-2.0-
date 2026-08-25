import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { createReconciliationAction } from '@/app/banking-actions';

export const dynamic = 'force-dynamic';

export default async function ReconcileListPage() {
  const { business } = await getCurrentContext();
  const [sessions, bankAccounts] = await Promise.all([
    prisma.reconciliationSession.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.account.findMany({
      where: { businessId: business.id, subtype: 'cash_and_bank', isArchived: false },
      orderBy: { code: 'asc' },
    }),
  ]);
  const accountName = new Map(bankAccounts.map((a) => [a.id, `${a.code} · ${a.name}`]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bank Reconciliation</h1>
        <p className="text-sm text-slate-500 mt-1">
          Enter the statement period and balances, then work the imported transactions until the running
          variance hits zero.
        </p>
      </div>
      <SimpleRecordForm
        action={createReconciliationAction}
        submitLabel="Start reconciliation"
        fields={[
          {
            name: 'ledgerAccountId',
            label: 'Account',
            type: 'select',
            options: bankAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
          },
          { name: 'statementStart', label: 'Statement start', type: 'date', required: true },
          { name: 'statementEnd', label: 'Statement end', type: 'date', required: true },
          { name: 'startingBalance', label: `Opening balance (${business.functionalCurrency})`, placeholder: '0.00', required: true, width: 'w-36' },
          { name: 'endingBalance', label: `Closing balance (${business.functionalCurrency})`, placeholder: '0.00', required: true, width: 'w-36' },
        ]}
      />
      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3">
                  <Link href={`/banking/reconcile/${s.id}`} className="font-medium text-teal-700 hover:underline">
                    {accountName.get(s.ledgerAccountId) ?? 'Account'}
                  </Link>
                </td>
                <td className="px-3 py-3 text-slate-500">
                  {s.statementStart.toISOString().slice(0, 10)} → {s.statementEnd.toISOString().slice(0, 10)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatMoney(s.endingBalance, business.functionalCurrency)}
                </td>
                <td className="px-5 py-3">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    s.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {s.status.toLowerCase()}
                  </span>
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400">No reconciliations yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
