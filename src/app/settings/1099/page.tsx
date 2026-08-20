import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { getTaxYearConfig } from '@/lib/forms1099/thresholds';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { updateThresholdAction } from '@/app/vendor-actions';

export const dynamic = 'force-dynamic';

export default async function Settings1099Page() {
  const { business } = await getCurrentContext();
  const currentYear = new Date().getUTCFullYear();
  // Materialize defaults for the years around now, then list all stored rows.
  await Promise.all([currentYear - 1, currentYear, currentYear + 1].map((y) => getTaxYearConfig(y)));
  const configs = await prisma.taxYearConfig.findMany({ orderBy: { taxYear: 'desc' } });
  const cur = business.functionalCurrency;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">1099 Thresholds</h1>
        <p className="text-sm text-slate-500 mt-1">
          Reporting minimums are per-tax-year <strong>configuration, not code constants</strong> — the
          NEC/MISC minimum changed from $600 to $2,000 for tax years after 2025 and is inflation-indexed
          from 2027. Verify each year&apos;s figures against IRS.gov before filing.
        </p>
      </div>

      {configs.map((c) => (
        <div key={c.taxYear} className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Tax year {c.taxYear}</h2>
            <span className="text-sm text-slate-500">
              NEC/MISC {formatMoney(c.necMiscThreshold, cur)} · INT {formatMoney(c.intThreshold, cur)} · DIV{' '}
              {formatMoney(c.divThreshold, cur)} · e-file mandate at {c.efileMandateCount} returns
            </span>
          </div>
          {c.notes && <p className="text-sm text-amber-700">{c.notes}</p>}
          <SimpleRecordForm
            action={updateThresholdAction}
            submitLabel="Update"
            fields={[
              { name: 'taxYear', label: '', defaultValue: String(c.taxYear), width: 'hidden' },
              {
                name: 'necMiscThreshold',
                label: `NEC/MISC minimum (${cur})`,
                defaultValue: (Number(c.necMiscThreshold) / 100).toFixed(2),
                width: 'w-36',
              },
              { name: 'notes', label: 'Notes', defaultValue: c.notes ?? '', width: 'flex-1 min-w-64' },
            ]}
          />
        </div>
      ))}
    </div>
  );
}
