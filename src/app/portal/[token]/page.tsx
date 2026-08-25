import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { formatQuantity } from '@/lib/invoicing/totals';
import { StatusChip } from '@/components/status-chip';
import { PortalPayButton } from './pay-button';

export const dynamic = 'force-dynamic';

// Public, token-addressed client portal view (no login). The token is an
// unguessable cuid; anyone with the link sees exactly this one invoice.
export default async function PortalInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { portalToken: token },
    include: {
      business: true,
      customer: true,
      lines: { orderBy: { lineNo: 'asc' } },
      payments: { orderBy: { date: 'asc' } },
    },
  });
  if (!invoice || invoice.status === 'DRAFT') notFound();

  const paid = invoice.payments.reduce((s, p) => s + p.amount, 0n);
  const balance = invoice.total - paid;

  return (
    <div className="fixed inset-0 overflow-auto bg-slate-100 py-10">
      <div className="mx-auto max-w-2xl space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-lg font-semibold">{invoice.business.name}</p>
            <p className="text-sm text-slate-500">Invoice for {invoice.customer.name}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold">#{invoice.number}</p>
            <StatusChip status={invoice.status} />
          </div>
        </div>
        <div className="text-sm text-slate-500">
          Issued {invoice.issueDate.toISOString().slice(0, 10)} · Due {invoice.dueDate.toISOString().slice(0, 10)}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 font-medium text-right">Qty</th>
              <th className="py-2 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-50">
                <td className="py-2.5">{l.description}</td>
                <td className="py-2.5 text-right tabular-nums">{formatQuantity(l.quantityMilli)}</td>
                <td className="py-2.5 text-right tabular-nums">{formatMoney(l.amount, invoice.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="py-2 text-right text-slate-500">Tax</td>
              <td className="py-2 text-right tabular-nums">{formatMoney(invoice.taxTotal, invoice.currency)}</td>
            </tr>
            <tr className="font-semibold">
              <td colSpan={2} className="py-2 text-right">Total</td>
              <td className="py-2 text-right tabular-nums">{formatMoney(invoice.total, invoice.currency)}</td>
            </tr>
            {paid > 0n && (
              <tr>
                <td colSpan={2} className="py-2 text-right text-slate-500">Balance due</td>
                <td className="py-2 text-right tabular-nums font-semibold">{formatMoney(balance, invoice.currency)}</td>
              </tr>
            )}
          </tfoot>
        </table>

        {invoice.status === 'OPEN' && balance > 0n && (
          <div className="rounded-lg border border-teal-100 bg-teal-50 p-4 space-y-2">
            <PortalPayButton token={token} amountLabel={formatMoney(balance, invoice.currency)} />
            <p className="text-xs text-slate-500">
              Sandbox payment — records a card payment in the books. Stripe Checkout plugs in here in
              production.
            </p>
          </div>
        )}
        {invoice.status === 'PAID' && (
          <p className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-700">
            Paid in full — thank you!
          </p>
        )}
        {invoice.memo && <p className="text-sm text-slate-500">{invoice.memo}</p>}
      </div>
    </div>
  );
}
