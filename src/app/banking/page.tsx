import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { matchCandidates } from '@/lib/banking/categorize';
import { ActionButton } from '@/components/action-button';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { connectSandboxBankAction, syncConnectionAction } from '@/app/banking-actions';
import { TxnRow, type Candidate } from './txn-row';

export const dynamic = 'force-dynamic';

export default async function BankingPage() {
  const { business } = await getCurrentContext();
  const [connections, bankAccounts, categoryAccounts] = await Promise.all([
    prisma.bankConnection.findMany({
      where: { businessId: business.id },
      include: { accounts: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.account.findMany({
      where: { businessId: business.id, subtype: 'cash_and_bank', isArchived: false },
      orderBy: { code: 'asc' },
    }),
    prisma.account.findMany({
      where: { businessId: business.id, isArchived: false },
      orderBy: { code: 'asc' },
    }),
  ]);

  const transactions = await prisma.importedTransaction.findMany({
    where: { businessId: business.id },
    orderBy: [{ status: 'asc' }, { date: 'desc' }],
    take: 200,
    include: { bankAccountLink: true },
  });
  const pending = transactions.filter((t) => t.status === 'PENDING');
  const resolved = transactions.filter((t) => t.status !== 'PENDING');

  // Match candidates per pending txn (top 3 each).
  const candidatesByTxn = new Map<string, Candidate[]>();
  for (const txn of pending) {
    const cands = await matchCandidates(business.id, txn.id);
    candidatesByTxn.set(
      txn.id,
      cands.slice(0, 3).map((c) => ({
        journalLineId: c.id,
        label: `JE-${c.entry.entryNumber} · ${c.entry.date.toISOString().slice(0, 10)} · ${c.entry.memo}`,
      })),
    );
  }

  const accountName = new Map(categoryAccounts.map((a) => [a.id, `${a.code} · ${a.name}`]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Banking</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/banking/rules" className="text-blue-700 hover:underline">Rules</Link>
          <Link href="/banking/reconcile" className="text-blue-700 hover:underline">Reconciliation</Link>
        </div>
      </div>

      {connections.length === 0 && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">
            No bank connected. The sandbox connection imports a deterministic feed so the whole
            categorize/match/reconcile flow works without credentials; the Plaid adapter activates when
            PLAID_CLIENT_ID / PLAID_SECRET are configured.
          </p>
          <SimpleRecordForm
            action={connectSandboxBankAction}
            submitLabel="Connect sandbox bank"
            fields={[
              {
                name: 'ledgerAccountId',
                label: 'Map feed to ledger account',
                type: 'select',
                options: bankAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
                defaultValue: bankAccounts.find((a) => a.code === '1010')?.id,
              },
            ]}
          />
        </div>
      )}

      {connections.map((c) => (
        <div key={c.id} className="rounded-lg border border-slate-200 bg-white px-5 py-4 flex items-center justify-between">
          <div>
            <p className="font-medium">{c.institutionName}</p>
            <p className="text-sm text-slate-500">
              {c.accounts.map((a) => `${a.name} ••${a.mask}`).join(', ')} · provider: {c.provider} · last sync:{' '}
              {c.lastSyncAt ? c.lastSyncAt.toISOString().slice(0, 16).replace('T', ' ') : 'never'}
            </p>
          </div>
          <ActionButton action={syncConnectionAction.bind(null, c.id)} label="Sync now" />
        </div>
      ))}

      {pending.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <h2 className="px-5 py-3 border-b border-slate-100 font-medium">
            To review <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{pending.length}</span>
          </h2>
          <div className="divide-y divide-slate-50">
            {pending.map((t) => (
              <TxnRow
                key={t.id}
                txn={{
                  id: t.id,
                  date: t.date.toISOString().slice(0, 10),
                  description: t.description,
                  amountLabel: formatMoney(t.amount, t.bankAccountLink.currency),
                  negative: t.amount < 0n,
                  suggestedAccountId: t.suggestedAccountId,
                  suggestedByRule: !!t.suggestedByRuleId,
                }}
                accounts={categoryAccounts
                  .filter((a) => a.id !== t.bankAccountLink.ledgerAccountId)
                  .map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
                candidates={candidatesByTxn.get(t.id) ?? []}
              />
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <h2 className="px-5 py-3 border-b border-slate-100 font-medium">Resolved</h2>
        <table className="w-full text-sm">
          <tbody>
            {resolved.map((t) => (
              <tr key={t.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5 text-slate-500 whitespace-nowrap">{t.date.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-2.5 w-full">{t.description}</td>
                <td className="px-3 py-2.5">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    t.status === 'CATEGORIZED' ? 'bg-green-100 text-green-700'
                    : t.status === 'MATCHED' ? 'bg-blue-50 text-blue-700'
                    : 'bg-slate-100 text-slate-500'
                  }`}>
                    {t.status.toLowerCase()}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap text-xs">
                  {t.journalEntryId ? accountName.get(
                    // display resolved via journal entry link
                    '') ?? '' : ''}
                  {t.journalEntryId && (
                    <Link href={`/journal/${t.journalEntryId}`} className="text-blue-700 hover:underline">
                      view entry
                    </Link>
                  )}
                </td>
                <td className={`px-5 py-2.5 text-right tabular-nums whitespace-nowrap ${t.amount < 0n ? '' : 'text-green-700'}`}>
                  {formatMoney(t.amount, t.bankAccountLink.currency)}
                </td>
              </tr>
            ))}
            {resolved.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400">Nothing resolved yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
