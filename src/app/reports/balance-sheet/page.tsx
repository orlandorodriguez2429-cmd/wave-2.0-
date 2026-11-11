import { getCurrentContext } from '@/lib/context';
import { balanceSheet, type BalanceSheetSection } from '@/lib/ledger/reports';
import { formatMoney } from '@/lib/money';
import { DateRangeForm } from '../date-range-form';

export const dynamic = 'force-dynamic';

function Section({
  section,
  currency,
  extraRows = [],
  totalOverride,
  totalLabel,
}: {
  section: BalanceSheetSection;
  currency: string;
  extraRows?: Array<{ label: string; amount: bigint }>;
  totalOverride?: bigint;
  totalLabel?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <h2 className="px-5 py-3 border-b border-slate-100 font-medium">{section.title}</h2>
      <table className="w-full text-sm">
        <tbody>
          {section.rows.map((r) => (
            <tr key={r.accountId} className="border-b border-slate-50">
              <td className="px-5 py-2">
                <span className="font-mono text-xs text-slate-400 mr-2">{r.code}</span>
                {r.name}
              </td>
              <td className="px-5 py-2 text-right tabular-nums">{formatMoney(r.amount, currency)}</td>
            </tr>
          ))}
          {extraRows.map((r) => (
            <tr key={r.label} className="border-b border-slate-50">
              <td className="px-5 py-2 italic text-slate-600">{r.label}</td>
              <td className="px-5 py-2 text-right tabular-nums">{formatMoney(r.amount, currency)}</td>
            </tr>
          ))}
          <tr className="bg-slate-50 font-medium">
            <td className="px-5 py-2.5">{totalLabel ?? `Total ${section.title}`}</td>
            <td className="px-5 py-2.5 text-right tabular-nums">
              {formatMoney(totalOverride ?? section.total, currency)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const params = await searchParams;
  const { business } = await getCurrentContext();
  const currency = business.functionalCurrency;
  const asOf = params.to || new Date().toISOString().slice(0, 10);

  const bs = await balanceSheet(business.id, new Date(asOf));

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Balance Sheet</h1>
          <p className="text-sm text-slate-500 mt-1">
            As of {asOf} · {currency} ·{' '}
            <a href={`/reports/export/balance-sheet?to=${asOf}`} className="text-teal-700 hover:underline">CSV</a>
          </p>
        </div>
        <DateRangeForm to={asOf} toOnly />
      </div>

      <Section section={bs.assets} currency={currency} />
      <Section section={bs.liabilities} currency={currency} />
      <Section
        section={bs.equity}
        currency={currency}
        extraRows={[{ label: 'Current Year Earnings', amount: bs.netIncomeToDate }]}
        totalOverride={bs.equityTotal}
        totalLabel="Total Equity"
      />

      <div
        className={`rounded-lg border px-5 py-4 text-sm font-medium ${
          bs.balances
            ? 'border-green-200 bg-green-50 text-green-700'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}
      >
        Assets {formatMoney(bs.assets.total, currency)} = Liabilities + Equity{' '}
        {formatMoney(bs.liabilitiesAndEquity, currency)}
        {bs.balances ? ' ✓' : ' — OUT OF BALANCE'}
      </div>
    </div>
  );
}
