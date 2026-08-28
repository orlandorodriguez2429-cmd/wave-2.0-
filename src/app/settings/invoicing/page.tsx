import { getCurrentContext } from '@/lib/context';
import { LateFeeForm } from './late-fee-form';

export const dynamic = 'force-dynamic';

export default async function InvoicingSettingsPage() {
  const { business } = await getCurrentContext();
  const ratePercent = business.lateFeePercentagePpm
    ? (business.lateFeePercentagePpm / 10_000).toString()
    : '';

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-semibold">Invoicing Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Late fees are opt&#8209;in, one&#8209;time per invoice (not compounding), and post to a dedicated
          Late Fee Income account so they never blend into service revenue on the P&amp;L.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <LateFeeForm
          initialEnabled={business.lateFeePercentagePpm != null}
          initialRatePercent={ratePercent}
          initialGraceDays={business.lateFeeGraceDays}
        />
      </div>
    </div>
  );
}
