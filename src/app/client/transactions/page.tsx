import { getClientContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function ClientTransactions({ searchParams }: { searchParams: Promise<{ month?: string; category?: string }> }) {
  const sp = await searchParams;
  const { business } = await getClientContext();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month! : new Date().toISOString().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));

  // Scoped by business from the session; the category filter is matched
  // within this business's own entries only.
  const txns = await prisma.importedTransaction.findMany({
    where: { businessId: business.id, date: { gte: from, lte: to } },
    orderBy: { date: 'desc' },
    include: { bankAccountLink: { select: { name: true, mask: true, ledgerAccountId: true, currency: true } } },
  });
  const entryIds = txns.map((t) => t.journalEntryId).filter((x): x is string => !!x);
  const lines = entryIds.length
    ? await prisma.journalLine.findMany({
        where: { entryId: { in: entryIds }, entry: { businessId: business.id } },
        include: { account: { select: { id: true, name: true } } },
      })
    : [];
  const categoryOf = new Map<string, { id: string; name: string }>();
  for (const t of txns) {
    const l = lines.find((x) => x.entryId === t.journalEntryId && x.accountId !== t.bankAccountLink.ledgerAccountId);
    if (l) categoryOf.set(t.id, l.account);
  }
  const categories = [...new Map([...categoryOf.values()].map((c) => [c.id, c])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const shown = sp.category ? txns.filter((t) => categoryOf.get(t.id)?.id === sp.category) : txns;
  const input = 'rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white';

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Transactions</h1>
      <form method="GET" className="flex flex-wrap items-end gap-2">
        <input type="month" name="month" defaultValue={month} className={input} />
        <select name="category" defaultValue={sp.category ?? ''} className={input}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white">Filter</button>
      </form>
      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {shown.map((t) => (
              <tr key={t.id} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{t.date.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-2.5 w-full">{t.description}</td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                  {categoryOf.get(t.id)?.name ?? (t.status === 'PENDING' ? 'Being reviewed' : t.status === 'EXCLUDED' ? 'Not business' : 'Transfer / matched')}
                </td>
                <td className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap ${t.amount < 0n ? '' : 'text-green-700'}`}>
                  {formatMoney(t.amount, t.bankAccountLink.currency)}
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td className="px-4 py-6 text-slate-400">No transactions for this month.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
