import { requireContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { dutyStatuses, liveChecks } from '@/lib/compliance';
import { firmIdentity } from '@/lib/legal';
import { PrintButton } from './print-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Annual security report · Your Tax Solution Books' };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

// The Qualified Individual's written report to the owner (16 CFR 314.4(i)):
// overall status of the information security program and material matters.
export default async function AnnualReportPage() {
  const { user } = await requireContext('OWNER');
  const now = new Date();
  const from = new Date(now.getTime() - 365 * 86_400_000);
  const firm = firmIdentity();
  const [checks, duties, incidents, logins, views, people, clients] = await Promise.all([
    liveChecks(),
    dutyStatuses(now),
    prisma.complianceIncident.findMany({ where: { discoveredAt: { gte: from } }, orderBy: { discoveredAt: 'asc' } }),
    prisma.auditLog.count({ where: { action: 'auth.login', createdAt: { gte: from } } }),
    prisma.auditLog.count({ where: { action: 'data.viewed', createdAt: { gte: from } } }),
    prisma.user.count({ where: { passwordHash: { not: null } } }),
    prisma.business.count(),
  ]);
  return (
    <article className="max-w-3xl space-y-5 text-sm text-slate-800">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Annual information security report</h1>
          <p className="text-slate-500">{firm.legalName} · period {day(from)} to {day(now)} · prepared by {user.name}</p>
        </div>
        <PrintButton />
      </div>
      <p>
        Written report of the Qualified Individual to the owner under the FTC Safeguards Rule, 16 CFR 314.4(i), on the
        overall status of the information security program and compliance with the rule, and material matters.
      </p>
      <h2 className="font-semibold">1. Scope</h2>
      <p>{clients} client business(es) and {people} login(s) in Your Tax Solution Books. Vendors: hosting (Render), bank connections (Plaid), AI categorization (Anthropic, masked data only), email provider.</p>
      <h2 className="font-semibold">2. Safeguards in place</h2>
      <ul className="list-disc pl-5">
        {checks.map((c) => <li key={c.label}>{c.ok ? '✓' : '✗'} {c.label} — {c.detail}</li>)}
      </ul>
      <h2 className="font-semibold">3. Recurring duties</h2>
      <table className="w-full border text-xs">
        <thead className="bg-slate-50"><tr><th className="p-2 text-left">Duty</th><th className="p-2 text-left">Last done</th><th className="p-2 text-left">Status</th></tr></thead>
        <tbody>
          {duties.map((d) => (
            <tr key={d.duty.key} className="border-t"><td className="p-2">{d.duty.label} ({d.duty.rule})</td><td className="p-2">{day(d.lastDone)}</td><td className="p-2">{d.overdue ? 'Overdue / not done' : `Current until ${day(d.due)}`}</td></tr>
          ))}
        </tbody>
      </table>
      <h2 className="font-semibold">4. Security events</h2>
      {incidents.length === 0 ? <p>No security incidents were recorded in the period.</p> : (
        <ul className="list-disc pl-5">{incidents.map((i) => <li key={i.id}>{day(i.discoveredAt)}: {i.description} — {i.closedAt ? `closed ${day(i.closedAt)}` : 'open'}</li>)}</ul>
      )}
      <p>Sign-ins recorded: {logins}. Staff views of client data recorded in the audit log: {views}.</p>
      <h2 className="font-semibold">5. Recommendations and changes</h2>
      <p className="h-24 border border-dashed border-slate-300 p-2 text-slate-400">(write here)</p>
      <div className="grid grid-cols-2 gap-8 pt-8">
        <p className="border-t pt-1">Qualified Individual — signature, date</p>
        <p className="border-t pt-1">Owner — signature, date</p>
      </div>
    </article>
  );
}
