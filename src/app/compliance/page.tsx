import Link from 'next/link';
import { requireContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { dutyStatuses, incidentDeadlines, liveChecks } from '@/lib/compliance';
import { createIncidentAction, recordDutyAction } from '@/app/compliance-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Compliance · Your Tax Solution Books' };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

export default async function CompliancePage() {
  await requireContext('OWNER');
  const today = new Date();
  const [checks, duties, incidents] = await Promise.all([
    liveChecks(),
    dutyStatuses(today),
    prisma.complianceIncident.findMany({ orderBy: { discoveredAt: 'desc' }, take: 50 }),
  ]);
  const open = incidents.filter((i) => !i.closedAt);
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--brand-navy)]">Compliance</h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            FTC Safeguards Rule (16 CFR 314), IRS Publication 4557 and Florida §501.171 duties for the office. The written
            plan is SECURITY.md in the repository; this page tracks that it is being followed.
          </p>
        </div>
        <Link href="/compliance/report" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Annual report</Link>
      </div>

      {open.length > 0 && (
        <section className="rounded-lg border-2 border-red-300 bg-red-50 p-4 space-y-2">
          <h2 className="font-semibold text-red-800">Open security incidents</h2>
          {open.map((i) => (
            <div key={i.id} className="text-sm text-red-800">
              <Link href={`/compliance/incidents/${i.id}`} className="underline">Discovered {day(i.discoveredAt)}: {i.description.slice(0, 80)}</Link>
              <ul className="list-disc pl-5">
                {incidentDeadlines(i).filter((d) => !d.done).map((d) => (
                  <li key={d.label}>{d.label} — due {day(d.due)}{d.due < today ? ' (OVERDUE)' : ''}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Checked automatically</h2>
        <ul className="divide-y rounded-lg border border-slate-200 bg-white">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start gap-3 p-3 text-sm">
              <span aria-label={c.ok ? 'OK' : 'Needs attention'} className={c.ok ? 'text-green-600' : 'text-amber-600'}>{c.ok ? '✓' : '!'}</span>
              <span><span className="font-medium">{c.label}</span><span className="block text-slate-500">{c.detail}</span></span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Recurring duties</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="p-3">Duty</th><th className="p-3">Every</th><th className="p-3">Last done</th><th className="p-3">Next due</th><th className="p-3">Record it</th></tr>
            </thead>
            <tbody className="divide-y">
              {duties.map(({ duty, lastDone, due, overdue }) => (
                <tr key={duty.key} className="align-top">
                  <td className="p-3">
                    <span className="font-medium">{duty.label}</span> <span className="text-xs text-slate-400">{duty.rule}</span>
                    <span className="block text-xs text-slate-500">{duty.how}</span>
                  </td>
                  <td className="p-3 whitespace-nowrap">{duty.everyMonths} mo</td>
                  <td className="p-3 whitespace-nowrap">{day(lastDone)}</td>
                  <td className={`p-3 whitespace-nowrap ${overdue ? 'font-medium text-amber-700' : ''}`}>{due ? day(due) : 'Not done yet'}</td>
                  <td className="p-3">
                    <form action={recordDutyAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="item" value={duty.key} />
                      <label className="sr-only" htmlFor={`d-${duty.key}`}>Date done</label>
                      <input id={`d-${duty.key}`} type="date" name="doneAt" defaultValue={today.toISOString().slice(0, 10)} className="rounded border border-slate-300 px-2 py-1 text-xs" />
                      <label className="sr-only" htmlFor={`n-${duty.key}`}>Note</label>
                      <input id={`n-${duty.key}`} name="note" placeholder="Note (who, result)" className="w-40 rounded border border-slate-300 px-2 py-1 text-xs" />
                      <button className="rounded bg-teal-600 px-2 py-1 text-xs text-white">Done</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Security incidents</h2>
        <p className="text-sm text-slate-500">Record anything suspicious right away — lost laptop or phone, phishing click, someone seeing data they should not. The deadlines are computed for you.</p>
        <form action={createIncidentAction} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
          <label className="sm:col-span-2">What happened
            <textarea name="description" required rows={2} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
          </label>
          <label>Discovered on <input type="date" name="discoveredAt" defaultValue={today.toISOString().slice(0, 10)} className="mt-1 block rounded border border-slate-300 px-2 py-1" /></label>
          <label>People possibly affected <input type="number" min={0} name="peopleAffected" defaultValue={0} className="mt-1 block w-28 rounded border border-slate-300 px-2 py-1" /></label>
          <label>Of whom Florida residents <input type="number" min={0} name="floridaResidents" defaultValue={0} className="mt-1 block w-28 rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex items-center gap-2"><input type="checkbox" name="unencryptedData" /> Unencrypted data involved (or the encryption key was also exposed)</label>
          <div className="sm:col-span-2"><button className="rounded-md bg-[var(--brand-red)] px-3 py-2 text-white">Record incident</button></div>
        </form>
        {incidents.length > 0 && (
          <ul className="divide-y rounded-lg border border-slate-200 bg-white text-sm">
            {incidents.map((i) => (
              <li key={i.id} className="p-3">
                <Link href={`/compliance/incidents/${i.id}`} className="text-teal-700 underline">{day(i.discoveredAt)} — {i.description.slice(0, 100)}</Link>
                <span className="ml-2 text-xs text-slate-500">{i.closedAt ? `closed ${day(i.closedAt)}` : 'open'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
