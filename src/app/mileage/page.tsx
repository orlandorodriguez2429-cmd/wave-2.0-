import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { createMileageAction } from '@/app/invoicing-actions';

export const dynamic = 'force-dynamic';

export default async function MileagePage() {
  const { business } = await getCurrentContext();
  const entries = await prisma.mileageEntry.findMany({
    where: { businessId: business.id },
    orderBy: { date: 'desc' },
    take: 200,
  });
  // deduction = miles × rate; milesTenths × cents / 10, half-up.
  const deduction = (e: (typeof entries)[number]) =>
    (BigInt(e.milesTenths) * BigInt(e.ratePerMileCents) + 5n) / 10n;
  const total = entries.reduce((s, e) => s + deduction(e), 0n);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Mileage</h1>
        <p className="text-sm text-slate-500 mt-1">
          Tracked for the standard mileage deduction at tax time. The IRS rate changes yearly — enter the
          rate in effect on the trip date (it is configuration, not a constant).
        </p>
      </div>
      <SimpleRecordForm
        action={createMileageAction}
        submitLabel="Add trip"
        fields={[
          { name: 'date', label: 'Date', type: 'date', defaultValue: new Date().toISOString().slice(0, 10) },
          { name: 'miles', label: 'Miles', placeholder: '12.5', required: true, width: 'w-24' },
          { name: 'ratePerMile', label: '$ / mile', placeholder: '0.70', required: true, width: 'w-24' },
          { name: 'purpose', label: 'Purpose', placeholder: 'Client visit', required: true, width: 'flex-1 min-w-48' },
          { name: 'vehicle', label: 'Vehicle', width: 'w-32' },
        ]}
      />
      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Purpose</th>
              <th className="px-3 py-3 font-medium">Vehicle</th>
              <th className="px-3 py-3 font-medium text-right">Miles</th>
              <th className="px-3 py-3 font-medium text-right">Rate</th>
              <th className="px-5 py-3 font-medium text-right">Deduction</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5 text-slate-500">{e.date.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-2.5">{e.purpose}</td>
                <td className="px-3 py-2.5 text-slate-500">{e.vehicle ?? '—'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{(e.milesTenths / 10).toFixed(1)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">${(e.ratePerMileCents / 100).toFixed(2)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(deduction(e), business.functionalCurrency)}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={6}>No trips logged yet.</td>
              </tr>
            )}
          </tbody>
          {entries.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="px-5 py-3" colSpan={5}>Total deduction</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(total, business.functionalCurrency)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
