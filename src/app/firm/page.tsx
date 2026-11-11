import { redirect } from 'next/navigation';
import { getCurrentContext } from '@/lib/context';
import { firmOverview } from '@/lib/firm';
import { OpenClient } from './open-client';

export const dynamic = 'force-dynamic';

const BANK = {
  OK: { label: 'OK', cls: 'bg-green-100 text-green-700' },
  NEEDS_RECONNECT: { label: 'Needs reconnect', cls: 'bg-red-100 text-red-700' },
  NOT_CONNECTED: { label: 'Not connected', cls: 'bg-slate-100 text-slate-600' },
} as const;

export default async function FirmPage() {
  const { user, role } = await getCurrentContext();
  if (role !== 'OWNER' && role !== 'ACCOUNTANT') redirect('/');
  const rows = await firmOverview(user.id);
  const attention = rows.filter((r) => r.problemScore > 0).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">All clients</h1>
        <p className="text-sm text-slate-500 mt-1">
          {rows.length} client{rows.length === 1 ? '' : 's'} · {attention} need attention. Problems are sorted to the top.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5 font-medium">Client</th>
              <th className="px-3 py-2.5 font-medium">Bank</th>
              <th className="px-3 py-2.5 font-medium">Last sync</th>
              <th className="px-3 py-2.5 font-medium text-right">To review</th>
              <th className="px-3 py-2.5 font-medium">Months not closed</th>
              <th className="px-3 py-2.5 font-medium">1099 watch</th>
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.businessId} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3 font-medium">{r.name}</td>
                <td className="px-3 py-3">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${BANK[r.bank].cls}`}>{BANK[r.bank].label}</span>
                </td>
                <td className="px-3 py-3 text-slate-500 whitespace-nowrap">
                  {r.lastSyncAt ? r.lastSyncAt.toISOString().slice(0, 16).replace('T', ' ') : '—'}
                </td>
                <td className={`px-3 py-3 text-right tabular-nums ${r.toReview ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>{r.toReview}</td>
                <td className="px-3 py-3">
                  {r.monthsNotClosed ? (
                    <span>{r.monthsNotClosed} <span className="text-slate-400">(from {r.oldestOpenMonth})</span></span>
                  ) : (
                    <span className="text-slate-400">all closed</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  {r.missingW9 > 0 ? (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">{r.missingW9} missing W-9</span>
                  ) : r.needs1099 > 0 ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">{r.needs1099} need 1099</span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right"><OpenClient businessId={r.businessId} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
