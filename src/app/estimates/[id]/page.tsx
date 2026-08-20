import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { formatQuantity } from '@/lib/invoicing/totals';
import { StatusChip } from '@/components/status-chip';
import { ActionButton } from '@/components/action-button';
import { convertEstimateAction, setEstimateStatusAction } from '@/app/invoicing-actions';

export const dynamic = 'force-dynamic';

export default async function EstimateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await getCurrentContext();
  const estimate = await prisma.estimate.findUnique({
    where: { id },
    include: {
      customer: true,
      lines: { orderBy: { lineNo: 'asc' }, include: { taxRate: true } },
      convertedInvoice: { select: { id: true, number: true } },
    },
  });
  if (!estimate || estimate.businessId !== business.id) notFound();

  const active = !['CONVERTED', 'DECLINED'].includes(estimate.status);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">
            <Link href="/estimates" className="hover:underline">Estimates</Link> / EST-{estimate.number}
          </p>
          <h1 className="text-2xl font-semibold mt-1 flex items-center gap-3">
            Estimate EST-{estimate.number} <StatusChip status={estimate.status} />
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {estimate.customer.name} · issued {estimate.issueDate.toISOString().slice(0, 10)}
            {estimate.expiryDate && ` · expires ${estimate.expiryDate.toISOString().slice(0, 10)}`} · {estimate.currency}
          </p>
          {estimate.convertedInvoice && (
            <p className="mt-2 text-sm">
              <Link href={`/invoices/${estimate.convertedInvoice.id}`} className="text-blue-700 hover:underline">
                → Invoice #{estimate.convertedInvoice.number}
              </Link>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {estimate.status === 'DRAFT' && (
            <ActionButton action={setEstimateStatusAction.bind(null, estimate.id, 'SENT')} label="Mark sent" />
          )}
          {['DRAFT', 'SENT'].includes(estimate.status) && (
            <>
              <ActionButton action={setEstimateStatusAction.bind(null, estimate.id, 'ACCEPTED')} label="Mark accepted" />
              <ActionButton action={setEstimateStatusAction.bind(null, estimate.id, 'DECLINED')} label="Mark declined" />
            </>
          )}
          {active && (
            <ActionButton action={convertEstimateAction.bind(null, estimate.id)} label="Convert to invoice" variant="primary" />
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
            {estimate.lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3">{l.description}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatQuantity(l.quantityMilli)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMoney(l.unitPrice, estimate.currency)}</td>
                <td className="px-3 py-3 text-slate-500">{l.taxRate?.name ?? '—'}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(l.amount, estimate.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
              <td colSpan={4} className="px-5 py-3 text-right">Total (incl. tax {formatMoney(estimate.taxTotal, estimate.currency)})</td>
              <td className="px-5 py-3 text-right tabular-nums">{formatMoney(estimate.total, estimate.currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
