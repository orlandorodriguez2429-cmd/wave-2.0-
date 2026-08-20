import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AuditLogPage() {
  const { business } = await getCurrentContext();
  const logs = await prisma.auditLog.findMany({
    where: { businessId: business.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { name: true, email: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-sm text-slate-500 mt-1">
          Every ledger-affecting action, with who and when. Append-only.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">When (UTC)</th>
              <th className="px-3 py-3 font-medium">Who</th>
              <th className="px-3 py-3 font-medium">Action</th>
              <th className="px-5 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-slate-50 last:border-0 align-top">
                <td className="px-5 py-2.5 text-slate-500 whitespace-nowrap">
                  {log.createdAt.toISOString().replace('T', ' ').slice(0, 19)}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">{log.user?.name ?? 'system'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono">{log.action}</span>
                </td>
                <td className="px-5 py-2.5 text-xs text-slate-500 font-mono break-all">
                  {log.payload ? JSON.stringify(log.payload) : ''}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={4}>
                  Nothing logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
