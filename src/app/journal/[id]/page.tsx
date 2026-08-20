import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { ReverseButton } from './reverse-button';

export const dynamic = 'force-dynamic';

export default async function EntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await getCurrentContext();

  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { lineNo: 'asc' }, include: { account: true } },
      reversedBy: { select: { id: true, entryNumber: true } },
      reverses: { select: { id: true, entryNumber: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });
  if (!entry || entry.businessId !== business.id) notFound();

  const isForeign = entry.currency !== business.functionalCurrency;
  const debitTotal = entry.lines
    .filter((l) => l.direction === 'DEBIT')
    .reduce((s, l) => s + l.amount, 0n);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">
            <Link href="/journal" className="hover:underline">
              Journal
            </Link>{' '}
            / JE-{entry.entryNumber}
          </p>
          <h1 className="text-2xl font-semibold mt-1">{entry.memo}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {entry.date.toISOString().slice(0, 10)} · {entry.currency}
            {isForeign && ` @ ${entry.exchangeRate.toString()} → ${business.functionalCurrency}`} · posted by{' '}
            {entry.createdBy.name}
          </p>
          <div className="mt-2 flex gap-2">
            {entry.reversedBy && (
              <Link
                href={`/journal/${entry.reversedBy.id}`}
                className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 hover:underline"
              >
                Reversed by JE-{entry.reversedBy.entryNumber}
              </Link>
            )}
            {entry.reverses && (
              <Link
                href={`/journal/${entry.reverses.id}`}
                className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:underline"
              >
                Reverses JE-{entry.reverses.entryNumber}
              </Link>
            )}
          </div>
        </div>
        {entry.status === 'POSTED' && !entry.reversedBy && !entry.reverses && (
          <ReverseButton entryId={entry.id} />
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-3 py-3 font-medium">Description</th>
              <th className="px-3 py-3 font-medium text-right">Debit</th>
              <th className="px-3 py-3 font-medium text-right">Credit</th>
              {isForeign && (
                <th className="px-5 py-3 font-medium text-right">{business.functionalCurrency}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3">
                  <span className="font-mono text-xs text-slate-400 mr-2">{l.account.code}</span>
                  {l.account.name}
                </td>
                <td className="px-3 py-3 text-slate-500">{l.description}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {l.direction === 'DEBIT' ? formatMoney(l.amount, entry.currency) : ''}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {l.direction === 'CREDIT' ? formatMoney(l.amount, entry.currency) : ''}
                </td>
                {isForeign && (
                  <td className="px-5 py-3 text-right tabular-nums text-slate-500">
                    {formatMoney(l.functionalAmount, business.functionalCurrency)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 font-medium">
              <td className="px-5 py-3" colSpan={2}>
                Total
              </td>
              <td className="px-3 py-3 text-right tabular-nums">{formatMoney(debitTotal, entry.currency)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatMoney(debitTotal, entry.currency)}</td>
              {isForeign && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Posted entries are immutable. To correct this entry, reverse it and post a new one — the full history
        stays on record.
      </p>
    </div>
  );
}
