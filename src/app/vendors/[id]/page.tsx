import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { maskedTin } from '@/lib/forms1099/w9';
import { vendor1099Totals } from '@/lib/forms1099/tracking';
import { getTaxYearConfig } from '@/lib/forms1099/thresholds';
import { BOXES, boxLabel } from '@/lib/forms1099/boxes';
import { ActionButton } from '@/components/action-button';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { W9Form } from '@/components/w9-form';
import { enterW9Action, logVendorPaymentAction, requestW9Action } from '@/app/vendor-actions';

export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  BELOW: 'bg-slate-100 text-slate-600',
  APPROACHING: 'bg-amber-100 text-amber-700',
  REPORTABLE: 'bg-red-100 text-red-700',
};

export default async function VendorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { id } = await params;
  const { year } = await searchParams;
  const { business } = await getCurrentContext();
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.businessId !== business.id) notFound();

  const taxYear = Number(year) || new Date().getUTCFullYear();
  const config = await getTaxYearConfig(taxYear);
  const totals = (await vendor1099Totals(business.id, taxYear)).find((t) => t.vendorId === vendor.id);
  const payments = await prisma.vendorPayment.findMany({
    where: { vendorId: vendor.id },
    orderBy: { date: 'desc' },
    take: 100,
  });
  const cur = business.functionalCurrency;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <p className="text-sm text-slate-400">
          <Link href="/vendors" className="hover:underline">Vendors</Link> / {vendor.name}
        </p>
        <h1 className="text-2xl font-semibold mt-1">{vendor.name}</h1>
        <p className="text-sm text-slate-500 mt-1">{vendor.email}</p>
      </div>

      {/* W-9 status card */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">W-9 &amp; 1099 eligibility</h2>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${
            vendor.w9Status === 'COMPLETED' ? 'bg-green-100 text-green-700'
            : vendor.w9Status === 'REQUESTED' ? 'bg-amber-100 text-amber-700'
            : 'bg-slate-100 text-slate-600'
          }`}>
            {vendor.w9Status.replace('_', ' ').toLowerCase()}
          </span>
        </div>

        {vendor.w9Status === 'COMPLETED' ? (
          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 text-sm">
            <p><span className="text-slate-500">Legal name:</span> {vendor.legalName}</p>
            <p><span className="text-slate-500">Entity type:</span> {vendor.taxEntityType?.replaceAll('_', ' ').toLowerCase()}</p>
            <p><span className="text-slate-500">TIN ({vendor.tinType}):</span> <span className="font-mono">{maskedTin(vendor)}</span></p>
            <p><span className="text-slate-500">Address:</span> {vendor.taxStreet}, {vendor.taxCity}, {vendor.taxState} {vendor.taxZip}</p>
            <p><span className="text-slate-500">Copy B delivery:</span> {vendor.eDeliveryConsentAt ? 'electronic (consented)' : 'paper mail (no e-consent)'}</p>
            <p><span className="text-slate-500">Default box:</span> {boxLabel(vendor.defaultBoxCode)}</p>
          </div>
        ) : (
          <>
            {vendor.w9Status === 'REQUESTED' && vendor.w9RequestToken && (
              <p className="text-sm text-slate-600">
                Waiting on the contractor. Share this secure link:{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">/w9/{vendor.w9RequestToken}</code>
              </p>
            )}
            {vendor.w9Status === 'NOT_REQUESTED' && (
              <div className="flex items-center gap-3">
                <ActionButton action={requestW9Action.bind(null, vendor.id)} label="Request W-9 (generate secure link)" variant="primary" />
                <span className="text-sm text-slate-400">or enter it manually below</span>
              </div>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-blue-700">Enter W-9 manually</summary>
              <div className="mt-3">
                <W9Form action={enterW9Action} hidden={{ vendorId: vendor.id }} submitLabel="Save W-9 data" />
              </div>
            </details>
          </>
        )}
      </div>

      {/* Year totals */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Tax year {taxYear} totals</h2>
          {totals && (
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[totals.status]}`}>
              {totals.status.toLowerCase()}
            </span>
          )}
        </div>
        {totals ? (
          <div className="text-sm space-y-1">
            {Object.entries(totals.byBox).map(([code, amount]) => (
              <p key={code} className="flex justify-between">
                <span>{boxLabel(code)}</span>
                <span className="tabular-nums font-medium">{formatMoney(amount, cur)}</span>
              </p>
            ))}
            {totals.excludedTotal > 0n && (
              <p className="flex justify-between text-slate-500">
                <span>Card/third-party payments (excluded — 1099-K reported by processor)</span>
                <span className="tabular-nums">{formatMoney(totals.excludedTotal, cur)}</span>
              </p>
            )}
            <p className="flex justify-between border-t border-slate-100 pt-1 font-semibold">
              <span>Reportable total (threshold {formatMoney(config.necMiscThreshold, cur)})</span>
              <span className="tabular-nums">{formatMoney(totals.reportableTotal, cur)}</span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No payments recorded for {taxYear}.</p>
        )}
      </div>

      {/* Log manual payment */}
      <div className="space-y-2">
        <h2 className="font-medium">Log a payment (outside the app: checks, wires…)</h2>
        <SimpleRecordForm
          action={logVendorPaymentAction}
          submitLabel="Log payment"
          fields={[
            { name: 'vendorId', label: '', defaultValue: vendor.id, width: 'hidden' },
            { name: 'date', label: 'Date', type: 'date', defaultValue: new Date().toISOString().slice(0, 10) },
            { name: 'amount', label: `Amount (${cur})`, placeholder: '0.00', required: true, width: 'w-32' },
            {
              name: 'method',
              label: 'Method',
              type: 'select',
              options: ['CHECK', 'ACH', 'WIRE', 'CASH', 'CARD', 'OTHER'].map((m) => ({ value: m, label: m })),
            },
            {
              name: 'boxCode',
              label: '1099 box',
              type: 'select',
              defaultValue: vendor.defaultBoxCode,
              options: BOXES.map((b) => ({ value: b.code, label: boxLabel(b.code) })),
            },
            { name: 'memo', label: 'Memo', width: 'w-44' },
          ]}
        />
        <p className="text-xs text-slate-400">
          Card payments are logged but excluded from 1099 totals — the processor reports those on 1099-K.
          Expenses entered with this vendor accrue here automatically.
        </p>
      </div>

      {/* Payment history */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <h2 className="px-5 py-3 border-b border-slate-100 font-medium">Payment history</h2>
        <table className="w-full text-sm">
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className={`border-b border-slate-50 last:border-0 ${p.excludedFrom1099 ? 'opacity-50' : ''}`}>
                <td className="px-5 py-2.5 text-slate-500 whitespace-nowrap">{p.date.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-2.5">{p.memo ?? '—'}</td>
                <td className="px-3 py-2.5 text-slate-500">{p.method}{p.excludedFrom1099 ? ' (excluded)' : ''}</td>
                <td className="px-3 py-2.5 text-slate-500 text-xs">{p.boxCode}</td>
                <td className="px-3 py-2.5 text-slate-400 text-xs">{p.source.toLowerCase()}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(p.amount, cur)}</td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr><td className="px-5 py-6 text-slate-400">No payments yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
