import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { amountsFromJson, efileMandate } from '@/lib/forms1099/forms';
import { stateFilingNote } from '@/lib/forms1099/transmitter';
import { ActionButton } from '@/components/action-button';
import { generateFormsAction, submitFormsAction } from '@/app/forms1099-actions';

export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  READY: 'bg-teal-50 text-teal-700',
  SUBMITTED: 'bg-amber-100 text-amber-700',
  ACCEPTED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};

export default async function FormsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year } = await searchParams;
  const { business } = await getCurrentContext();
  const taxYear = Number(year) || new Date().getUTCFullYear();

  const [forms, mandate] = await Promise.all([
    prisma.form1099.findMany({
      where: { businessId: business.id, taxYear },
      orderBy: [{ createdAt: 'asc' }],
    }),
    efileMandate(business.id, taxYear),
  ]);
  const vendors = new Map(
    (
      await prisma.vendor.findMany({ where: { id: { in: [...new Set(forms.map((f) => f.vendorId))] } } })
    ).map((v) => [v.id, v]),
  );
  const readyCount = forms.filter((f) => f.status === 'READY').length;
  const cur = business.functionalCurrency;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="text-sm text-slate-400">
            <Link href="/1099" className="hover:underline">1099 Tracking</Link> / Forms
          </p>
          <h1 className="text-2xl font-semibold mt-1">1099 Forms — Tax year {taxYear}</h1>
        </div>
        <div className="flex gap-2">
          <ActionButton action={generateFormsAction.bind(null, taxYear)} label="Generate drafts from payment data" />
          {readyCount > 0 && (
            <ActionButton
              action={submitFormsAction.bind(null, taxYear)}
              label={`Submit ${readyCount} form(s) to IRS…`}
              confirmLabel="CONFIRM: Submit to IRS"
              variant="danger"
            />
          )}
        </div>
      </div>

      <div className={`rounded-md border px-4 py-2.5 text-sm ${
        mandate.mandatory ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'
      }`}>
        Information returns this year: <strong>{mandate.count}</strong> · e-filing becomes mandatory at{' '}
        {mandate.mandateAt} <em>combined</em> returns (1099s + W-2s + other covered types — this counter only
        sees 1099s, so treat it as a floor).{mandate.mandatory && ' E-filing is MANDATORY for this business.'}
      </div>
      <p className="text-xs text-slate-400">
        Transmitter: {process.env.EFILE_TRANSMITTER ?? 'mock'} (sandbox provider path). Direct IRS IRIS A2A
        activates with an IRIS TCC (application ≈ 45 business days); IRIS replaced the retired FIRE system
        and is required for TY2026+ e-filing. Recipient Copy B is due January 31.
      </p>

      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Recipient</th>
              <th className="px-3 py-3 font-medium">Form</th>
              <th className="px-3 py-3 font-medium">Ver.</th>
              <th className="px-3 py-3 font-medium text-right">Total</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Copy B</th>
              <th className="px-5 py-3 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {forms.map((f) => {
              const vendor = vendors.get(f.vendorId);
              const total = Object.values(amountsFromJson(f.amounts)).reduce((s, v) => s + v, 0n);
              const note = stateFilingNote(vendor?.taxState);
              return (
                <tr key={f.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link href={`/1099/forms/${f.id}`} className="font-medium text-teal-700 hover:underline">
                      {vendor?.name ?? '—'}
                    </Link>
                    {f.correctsId && <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-700">correction</span>}
                  </td>
                  <td className="px-3 py-3">1099-{f.formKind}</td>
                  <td className="px-3 py-3 text-slate-500">v{f.version}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatMoney(total, cur)}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[f.status]}`}>
                      {f.status.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">
                    {f.copyBDeliveredAt ? `${f.copyBDeliveryMethod} ✓` : '—'}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500">{note ?? '—'}</td>
                </tr>
              );
            })}
            {forms.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={7}>
                  No forms yet — generate drafts from this year&apos;s payment data. Vendors without a
                  completed W-9 are skipped with a warning on the tracking page.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
