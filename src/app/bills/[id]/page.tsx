import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { StatusChip } from '@/components/status-chip';
import { ActionButton } from '@/components/action-button';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { approveBillAction, recordBillPaymentAction, voidBillAction } from '@/app/bill-actions';

export const dynamic = 'force-dynamic';

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await getCurrentContext();
  const bill = await prisma.bill.findUnique({
    where: { id },
    include: {
      vendor: true,
      lines: { orderBy: { lineNo: 'asc' } },
      payments: { orderBy: { date: 'asc' } },
    },
  });
  if (!bill || bill.businessId !== business.id) notFound();

  const accounts = await prisma.account.findMany({
    where: { id: { in: bill.lines.map((l) => l.expenseAccountId) } },
    select: { id: true, code: true, name: true },
  });
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const entryIds = [bill.journalEntryId, bill.voidJournalEntryId].filter((x): x is string => !!x);
  const entries = await prisma.journalEntry.findMany({
    where: { id: { in: entryIds } },
    select: { id: true, entryNumber: true },
  });
  const journalEntry = entries.find((e) => e.id === bill.journalEntryId) ?? null;
  const voidJournalEntry = entries.find((e) => e.id === bill.voidJournalEntryId) ?? null;

  const paid = bill.payments.reduce((s, p) => s + p.amount, 0n);
  const balance = bill.total - paid;
  const paymentAccounts = await prisma.account.findMany({
    where: {
      businessId: business.id,
      isArchived: false,
      OR: [{ subtype: 'cash_and_bank' }, { subtype: 'credit_card' }],
    },
    orderBy: { code: 'asc' },
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">
            <Link href="/bills" className="hover:underline">Bills</Link> / #{bill.number}
          </p>
          <h1 className="text-2xl font-semibold mt-1 flex items-center gap-3">
            Bill #{bill.number} <StatusChip status={bill.status} />
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {bill.vendor.name} · billed {bill.billDate.toISOString().slice(0, 10)} · due{' '}
            {bill.dueDate.toISOString().slice(0, 10)} · {bill.currency}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {journalEntry && (
              <Link href={`/journal/${journalEntry.id}`} className="rounded bg-slate-100 px-2 py-0.5 text-slate-600 hover:underline">
                Ledger: JE-{journalEntry.entryNumber}
              </Link>
            )}
            {voidJournalEntry && (
              <Link href={`/journal/${voidJournalEntry.id}`} className="rounded bg-amber-100 px-2 py-0.5 text-amber-700 hover:underline">
                Void reversal: JE-{voidJournalEntry.entryNumber}
              </Link>
            )}
            <Link href={`/vendors/${bill.vendorId}`} className="rounded bg-slate-100 px-2 py-0.5 text-slate-600 hover:underline">
              Vendor page
            </Link>
          </div>
        </div>
        <div className="flex gap-2">
          {bill.status === 'DRAFT' && (
            <ActionButton action={approveBillAction.bind(null, bill.id)} label="Approve & post" variant="primary" />
          )}
          {bill.status === 'OPEN' && bill.payments.length === 0 && (
            <ActionButton action={voidBillAction.bind(null, bill.id)} label="Void…" confirmLabel="Confirm void" variant="danger" />
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Description</th>
              <th className="px-3 py-3 font-medium">Account</th>
              <th className="px-5 py-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3">{l.description ?? '—'}</td>
                <td className="px-3 py-3 text-slate-500">
                  {(() => {
                    const a = accountById.get(l.expenseAccountId);
                    return a ? `${a.code} · ${a.name}` : '—';
                  })()}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(l.amount, bill.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-semibold">
              <td colSpan={2} className="px-5 py-3 text-right">Total</td>
              <td className="px-5 py-3 text-right tabular-nums">{formatMoney(bill.total, bill.currency)}</td>
            </tr>
            {paid > 0n && (
              <tr className="font-medium">
                <td colSpan={2} className="px-5 py-2 text-right text-slate-500">Paid / Balance</td>
                <td className="px-5 py-2 text-right tabular-nums">
                  {formatMoney(paid, bill.currency)} / {formatMoney(balance, bill.currency)}
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {bill.payments.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <h2 className="px-5 py-3 border-b border-slate-100 font-medium">Payments</h2>
          <table className="w-full text-sm">
            <tbody>
              {bill.payments.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2.5 text-slate-500">{p.date.toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-2.5">{p.method}</td>
                  <td className="px-3 py-2.5 text-slate-500">{p.memo}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(p.amount, bill.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bill.status === 'OPEN' && balance > 0n && (
        <div className="space-y-2">
          <h2 className="font-medium">Record a payment</h2>
          <SimpleRecordForm
            action={recordBillPaymentAction}
            submitLabel="Record payment"
            fields={[
              { name: 'billId', label: '', type: 'text', defaultValue: bill.id, width: 'hidden' },
              { name: 'date', label: 'Date', type: 'date', defaultValue: new Date().toISOString().slice(0, 10) },
              { name: 'amount', label: `Amount (${bill.currency})`, placeholder: '0.00', required: true, width: 'w-32' },
              {
                name: 'method',
                label: 'Method',
                type: 'select',
                options: ['ACH', 'CHECK', 'CASH', 'WIRE', 'CARD', 'OTHER'].map((m) => ({ value: m, label: m })),
              },
              {
                name: 'paymentAccountId',
                label: 'Pay from',
                type: 'select',
                options: paymentAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
              },
              { name: 'memo', label: 'Memo', width: 'w-44' },
            ]}
          />
        </div>
      )}
    </div>
  );
}
