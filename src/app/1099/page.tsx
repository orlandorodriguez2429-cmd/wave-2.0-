import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { formatMoney } from '@/lib/money';
import { vendor1099Totals } from '@/lib/forms1099/tracking';
import { getTaxYearConfig } from '@/lib/forms1099/thresholds';
import { boxLabel } from '@/lib/forms1099/boxes';

export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  BELOW: 'bg-slate-100 text-slate-600',
  APPROACHING: 'bg-amber-100 text-amber-700',
  REPORTABLE: 'bg-red-100 text-red-700',
};

export default async function Dashboard1099({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year } = await searchParams;
  const { business } = await getCurrentContext();
  const taxYear = Number(year) || new Date().getUTCFullYear();
  const [config, totals] = await Promise.all([
    getTaxYearConfig(taxYear),
    vendor1099Totals(business.id, taxYear),
  ]);
  const cur = business.functionalCurrency;
  const reportable = totals.filter((t) => t.status === 'REPORTABLE');
  const missingW9 = reportable.filter((t) => !t.is1099Eligible);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold">1099 Tracking</h1>
          <p className="text-sm text-slate-500 mt-1">
            Tax year {taxYear} · NEC/MISC threshold {formatMoney(config.necMiscThreshold, cur)} ·{' '}
            <Link href="/settings/1099" className="text-blue-700 hover:underline">thresholds &amp; settings</Link>
          </p>
        </div>
        <form method="GET" className="flex items-end gap-2">
          <label className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1">Tax year</span>
            <input name="year" defaultValue={taxYear} className="w-24 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          <button className="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium">Go</button>
        </form>
      </div>

      {config.notes && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <strong>Threshold note:</strong> {config.notes}
        </p>
      )}
      {missingW9.length > 0 && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {missingW9.length} vendor(s) have crossed the reporting threshold but have no completed W-9 —
          collect those before filing season.
        </p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Vendor</th>
              <th className="px-3 py-3 font-medium">W-9</th>
              <th className="px-3 py-3 font-medium">Boxes</th>
              <th className="px-3 py-3 font-medium text-right">Reportable</th>
              <th className="px-3 py-3 font-medium text-right">Card (excl.)</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t) => (
              <tr key={t.vendorId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3">
                  <Link href={`/vendors/${t.vendorId}?year=${taxYear}`} className="font-medium text-blue-700 hover:underline">
                    {t.vendorName}
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    t.w9Status === 'COMPLETED' ? 'bg-green-100 text-green-700'
                    : t.w9Status === 'REQUESTED' ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-600'
                  }`}>
                    {t.w9Status.replace('_', ' ').toLowerCase()}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs text-slate-500">
                  {Object.keys(t.byBox).map((c) => boxLabel(c)).join(', ') || '—'}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMoney(t.reportableTotal, cur)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-slate-400">
                  {t.excludedTotal > 0n ? formatMoney(t.excludedTotal, cur) : '—'}
                </td>
                <td className="px-5 py-3">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status]}`}>
                    {t.status.toLowerCase()}
                  </span>
                </td>
              </tr>
            ))}
            {totals.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={6}>
                  No vendor payments tracked for {taxYear}. Payments accrue automatically from expenses with a
                  vendor, or log them manually on a vendor page.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        Form generation and e-filing arrive in Phase 5. Card/third-party payments are excluded from payer
        1099 totals (processor reports them on 1099-K).
      </p>
    </div>
  );
}
