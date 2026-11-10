import { getClientContext } from '@/lib/context';
import { monthStatuses } from '@/lib/months';

export const dynamic = 'force-dynamic';

const LABEL: Record<string, { text: string; cls: string }> = {
  CLOSED: { text: 'Done', cls: 'bg-green-100 text-green-700' },
  READY: { text: 'Reviewed', cls: 'bg-teal-100 text-teal-800' },
  NEEDS_REVIEW: { text: 'Being reviewed', cls: 'bg-amber-100 text-amber-800' },
  NO_DATA: { text: 'No bank activity received', cls: 'bg-slate-100 text-slate-500' },
  NOT_CONNECTED: { text: 'Bank not connected', cls: 'bg-slate-100 text-slate-500' },
  IN_PROGRESS: { text: 'This month', cls: 'bg-sky-50 text-sky-700' },
};

export default async function ClientMonths() {
  const { business } = await getClientContext();
  const months = (await monthStatuses(business.id)).reverse();
  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-semibold">Months</h1>
      <p className="text-sm text-slate-500">Where your bookkeeper is with each month. &quot;Done&quot; means the month is reviewed and closed.</p>
      <ul className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-50">
        {months.map((m) => (
          <li key={m.key} className="flex items-center justify-between px-5 py-3 text-sm">
            <span className="font-medium">{m.label}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${LABEL[m.status].cls}`}>{LABEL[m.status].text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
