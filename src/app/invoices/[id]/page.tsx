import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { formatQuantity } from '@/lib/invoicing/totals';
import { StatusChip } from '@/components/status-chip';
import { ActionButton } from '@/components/action-button';
import { SimpleRecordForm } from '@/components/simple-record-form';
import {
  approveInvoiceAction,
  deleteDraftInvoiceAction,
  makeRecurringAction,
  recordPaymentAction,
  sendInvoiceReminderAction,
  voidInvoiceAction,
} from '@/app/invoicing-actions';

export const dynamic = 'force-dynamic';

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await getCurrentContext();
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      lines: { orderBy: { lineNo: 'asc' }, include: { taxRate: true } },
      payments: { orderBy: { date: 'asc' } },
      recurringInvoice: true,
      estimate: { select: { id: true, number: true } },
      emailMessages: { orderBy: { sentAt: 'desc' } },
    },
  });
  if (!invoice || invoice.businessId !== business.id) notFound();

  const entryIds = [invoice.journalEntryId, invoice.voidJournalEntryId].filter((x): x is string => !!x);
  const entries = await prisma.journalEntry.findMany({
    where: { id: { in: entryIds } },
    select: { id: true, entryNumber: true },
  });
  const journalEntry = entries.find((e) => e.id === invoice.journalEntryId) ?? null;
  const voidJournalEntry = entries.find((e) => e.id === invoice.voidJournalEntryId) ?? null;

  const paid = invoice.payments.reduce((s, p) => s + p.amount, 0n);
  const balance = invoice.total - paid;
  const depositAccounts = await prisma.account.findMany({
    where: { businessId: business.id, subtype: 'cash_and_bank', isArchived: false },
    orderBy: { code: 'asc' },
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">
            <Link href="/invoices" className="hover:underline">Invoices</Link> / #{invoice.number}
          </p>
          <h1 className="text-2xl font-semibold mt-1 flex items-center gap-3">
            Invoice #{invoice.number} <StatusChip status={invoice.status} />
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {invoice.customer.name} · issued {invoice.issueDate.toISOString().slice(0, 10)} · due{' '}
            {invoice.dueDate.toISOString().slice(0, 10)} · {invoice.currency}
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
            {invoice.estimate && (
              <Link href={`/estimates/${invoice.estimate.id}`} className="rounded bg-violet-100 px-2 py-0.5 text-violet-700 hover:underline">
                From estimate #{invoice.estimate.number}
              </Link>
            )}
            <a href={`/invoices/${invoice.id}/pdf`} className="rounded bg-slate-100 px-2 py-0.5 text-slate-600 hover:underline">
              Download PDF
            </a>
            <Link href={`/portal/${invoice.portalToken}`} className="rounded bg-slate-100 px-2 py-0.5 text-slate-600 hover:underline">
              Client portal link
            </Link>
          </div>
        </div>
        <div className="flex gap-2">
          {invoice.status === 'DRAFT' && (
            <>
              <ActionButton action={approveInvoiceAction.bind(null, invoice.id)} label="Approve & post" variant="primary" />
              <ActionButton
                action={deleteDraftInvoiceAction.bind(null, invoice.id)}
                label="Delete draft"
                confirmLabel="Confirm delete"
                variant="danger"
              />
            </>
          )}
          {invoice.status === 'OPEN' && (
            <ActionButton action={sendInvoiceReminderAction.bind(null, invoice.id)} label="Send reminder" />
          )}
          {invoice.status === 'OPEN' && invoice.payments.length === 0 && (
            <ActionButton action={voidInvoiceAction.bind(null, invoice.id)} label="Void…" confirmLabel="Confirm void" variant="danger" />
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Description</th>
              <th className="px-3 py-3 font-medium text-right">Qty</th>
              <th className="px-3 py-3 font-medium text-right">Unit price</th>
              <th className="px-3 py-3 font-medium">Tax</th>
              <th className="px-5 py-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3">{l.description}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatQuantity(l.quantityMilli)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMoney(l.unitPrice, invoice.currency)}</td>
                <td className="px-3 py-3 text-slate-500">{l.taxRate?.name ?? '—'}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(l.amount, invoice.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 text-sm">
              <td colSpan={4} className="px-5 py-2 text-right text-slate-500">Subtotal</td>
              <td className="px-5 py-2 text-right tabular-nums">{formatMoney(invoice.subtotal, invoice.currency)}</td>
            </tr>
            <tr className="text-sm">
              <td colSpan={4} className="px-5 py-2 text-right text-slate-500">Tax</td>
              <td className="px-5 py-2 text-right tabular-nums">{formatMoney(invoice.taxTotal, invoice.currency)}</td>
            </tr>
            <tr className="bg-slate-50 font-semibold">
              <td colSpan={4} className="px-5 py-3 text-right">Total</td>
              <td className="px-5 py-3 text-right tabular-nums">{formatMoney(invoice.total, invoice.currency)}</td>
            </tr>
            {paid > 0n && (
              <tr className="font-medium">
                <td colSpan={4} className="px-5 py-2 text-right text-slate-500">Paid / Balance</td>
                <td className="px-5 py-2 text-right tabular-nums">
                  {formatMoney(paid, invoice.currency)} / {formatMoney(balance, invoice.currency)}
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {invoice.payments.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <h2 className="px-5 py-3 border-b border-slate-100 font-medium">Payments</h2>
          <table className="w-full text-sm">
            <tbody>
              {invoice.payments.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2.5 text-slate-500">{p.date.toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-2.5">{p.method}</td>
                  <td className="px-3 py-2.5 text-slate-500">{p.memo}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(p.amount, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {invoice.emailMessages.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <h2 className="px-5 py-3 border-b border-slate-100 font-medium">Reminders sent</h2>
          <table className="w-full text-sm">
            <tbody>
              {invoice.emailMessages.map((m) => (
                <tr key={m.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2.5 text-slate-500 whitespace-nowrap">
                    {m.sentAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="px-3 py-2.5">{m.toEmail}</td>
                  <td className="px-3 py-2.5 text-slate-500">{m.subject}</td>
                  <td className="px-5 py-2.5 text-right text-xs text-slate-400 whitespace-nowrap">
                    via {m.providerName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {invoice.status === 'OPEN' && balance > 0n && (
        <div className="space-y-2">
          <h2 className="font-medium">Record a payment</h2>
          <SimpleRecordForm
            action={recordPaymentAction}
            submitLabel="Record payment"
            fields={[
              { name: 'invoiceId', label: '', type: 'text', defaultValue: invoice.id, width: 'hidden' },
              { name: 'date', label: 'Date', type: 'date', defaultValue: new Date().toISOString().slice(0, 10) },
              { name: 'amount', label: `Amount (${invoice.currency})`, placeholder: '0.00', required: true, width: 'w-32' },
              {
                name: 'method',
                label: 'Method',
                type: 'select',
                options: ['ACH', 'CHECK', 'CASH', 'WIRE', 'CARD', 'OTHER'].map((m) => ({ value: m, label: m })),
              },
              {
                name: 'depositAccountId',
                label: 'Deposit to',
                type: 'select',
                options: depositAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
              },
              { name: 'memo', label: 'Memo', width: 'w-44' },
            ]}
          />
        </div>
      )}

      {invoice.status !== 'DRAFT' && !invoice.recurringInvoiceId && (
        <div className="space-y-2">
          <h2 className="font-medium">Make recurring</h2>
          <SimpleRecordForm
            action={makeRecurringAction}
            submitLabel="Create recurring schedule"
            fields={[
              { name: 'invoiceId', label: '', type: 'text', defaultValue: invoice.id, width: 'hidden' },
              {
                name: 'frequency',
                label: 'Frequency',
                type: 'select',
                defaultValue: 'MONTHLY',
                options: ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'].map((f) => ({ value: f, label: f.toLowerCase() })),
              },
              { name: 'nextRunDate', label: 'First run', type: 'date', required: true },
              { name: 'autoApprove', label: 'Auto-approve each invoice', type: 'checkbox' },
            ]}
          />
        </div>
      )}
      {invoice.recurringInvoice && (
        <p className="text-sm text-slate-500">
          Recurring: {invoice.recurringInvoice.frequency.toLowerCase()}, next run{' '}
          {invoice.recurringInvoice.nextRunDate.toISOString().slice(0, 10)}
          {invoice.recurringInvoice.isPaused ? ' (paused)' : ''} — generated by the jobs runner
          (`npx tsx scripts/run-jobs.ts`).
        </p>
      )}
    </div>
  );
}
