import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function JournalPage() {
  const { business } = await getCurrentContext();
  const entries = await prisma.journalEntry.findMany({
    where: { businessId: business.id, status: 'POSTED' },
    orderBy: [{ date: 'desc' }, { entryNumber: 'desc' }],
    take: 200,
    include: { lines: true, reversedBy: { select: { id: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Journal</h1>
        <Link
          href="/journal/new"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + New entry
        </Link>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">No.</th>
              <th className="px-3 py-3 font-medium">Memo</th>
              <th className="px-3 py-3 font-medium">Currency</th>
              <th className="px-5 py-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const total = e.lines
                .filter((l) => l.direction === 'DEBIT')
                .reduce((s, l) => s + l.functionalAmount, 0n);
              return (
                <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{e.date.toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-3 text-slate-400 whitespace-nowrap">JE-{e.entryNumber}</td>
                  <td className="px-3 py-3 w-full">
                    <Link href={`/journal/${e.id}`} className="hover:underline">
                      {e.memo}
                    </Link>
                    {e.reversedBy && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">Reversed</span>
                    )}
                    {e.reversesId && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">Reversal</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-500">{e.currency}</td>
                  <td className="px-5 py-3 text-right tabular-nums whitespace-nowrap">
                    {formatMoney(total, business.functionalCurrency)}
                  </td>
                </tr>
              );
            })}
            {entries.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={5}>
                  No posted entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
