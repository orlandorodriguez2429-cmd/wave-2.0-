import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { incidentDeadlines } from '@/lib/compliance';
import { updateIncidentAction } from '@/app/compliance-actions';

export const dynamic = 'force-dynamic';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireContext('OWNER');
  const { id } = await params;
  const i = await prisma.complianceIncident.findUnique({ where: { id } });
  if (!i) notFound();
  const deadlines = incidentDeadlines(i);
  const field = (name: string, label: string, value: Date | null) => (
    <label className="text-sm">{label}<input type="date" name={name} defaultValue={day(value)} className="mt-1 block rounded border border-slate-300 px-2 py-1" /></label>
  );
  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/compliance" className="text-sm text-teal-700">← Compliance</Link>
      <h1 className="text-xl font-semibold">Incident discovered {day(i.discoveredAt)}</h1>
      <p className="whitespace-pre-wrap text-sm text-slate-700">{i.description}</p>

      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm space-y-2">
        <h2 className="font-semibold">Deadlines</h2>
        {deadlines.length === 0 ? (
          <p className="text-slate-500">No notification deadline by these facts (encrypted data with the key safe, or nobody affected). Keep a record of what happened and what you did, and confirm with your attorney.</p>
        ) : (
          <ul className="list-disc pl-5">
            {deadlines.map((d) => (
              <li key={d.label} className={d.done ? 'text-green-700' : d.due < new Date() ? 'font-medium text-red-700' : ''}>
                {d.label} — due {day(d.due)} {d.done ? `· done ${day(d.done)}` : ''}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">
          First steps (SECURITY.md §10): contain it (reset passwords, end sessions, rotate secrets), find out what was
          accessed using the audit log, then decide on notifications with your attorney. If taxpayer data is involved, also
          contact your IRS Stakeholder Liaison.
        </p>
      </section>

      <form action={updateIncidentAction.bind(null, i.id)} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <label className="text-sm">People possibly affected<input type="number" min={0} name="peopleAffected" defaultValue={i.peopleAffected} className="mt-1 block w-28 rounded border border-slate-300 px-2 py-1" /></label>
        <label className="text-sm">Of whom Florida residents<input type="number" min={0} name="floridaResidents" defaultValue={i.floridaResidents} className="mt-1 block w-28 rounded border border-slate-300 px-2 py-1" /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="unencryptedData" defaultChecked={i.unencryptedData} /> Unencrypted data involved (or the encryption key was also exposed)</label>
        {field('containedAt', 'Contained on', i.containedAt)}
        {field('individualsNotifiedAt', 'Individuals notified on', i.individualsNotifiedAt)}
        {field('floridaAgNotifiedAt', 'Florida AG notified on', i.floridaAgNotifiedAt)}
        {field('ftcNotifiedAt', 'FTC notified on', i.ftcNotifiedAt)}
        {field('closedAt', 'Closed on', i.closedAt)}
        <label className="text-sm sm:col-span-2">Notes (what was done, by whom)
          <textarea name="notes" rows={4} defaultValue={i.notes} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
        </label>
        <div className="sm:col-span-2"><button className="rounded-md bg-teal-600 px-3 py-2 text-sm text-white">Save</button></div>
      </form>
    </div>
  );
}
