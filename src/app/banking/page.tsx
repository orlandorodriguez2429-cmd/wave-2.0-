import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { matchCandidates } from '@/lib/banking/categorize';
import { ActionButton } from '@/components/action-button';
import { SimpleRecordForm } from '@/components/simple-record-form';
import {
  clearReviewFlagAction,
  connectSandboxBankAction,
  disconnectConnectionAction,
  remapAccountLinkAction,
  syncConnectionAction,
} from '@/app/banking-actions';
import { isPlaidConfigured, plaidConfig } from '@/lib/banking/plaid-client';
import { TxnRow, type Candidate } from './txn-row';
import { PlaidLinkButton } from './plaid-link-button';

const CONNECTION_STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'connected', cls: 'bg-green-100 text-green-700' },
  ERROR: { label: 'sync error', cls: 'bg-red-100 text-red-700' },
  NEEDS_RECONNECT: { label: 'needs reconnect', cls: 'bg-amber-100 text-amber-800' },
  REMOVED: { label: 'disconnected', cls: 'bg-slate-200 text-slate-500' },
};

function fmtTime(d: Date | null) {
  return d ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'never';
}

export const dynamic = 'force-dynamic';

export default async function BankingPage() {
  const { business, role } = await getCurrentContext();
  const canManage = role === 'OWNER' || role === 'ACCOUNTANT';
  const plaidOn = isPlaidConfigured();
  const webhookMissing = plaidOn && !plaidConfig()?.webhookUrl;
  const [connections, bankAccounts, feedAccounts, categoryAccounts, flagged] = await Promise.all([
    prisma.bankConnection.findMany({
      where: { businessId: business.id },
      include: { accounts: true },
      orderBy: [{ removedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'asc' }],
    }),
    prisma.account.findMany({
      where: { businessId: business.id, subtype: 'cash_and_bank', isArchived: false },
      orderBy: { code: 'asc' },
    }),
    prisma.account.findMany({
      where: { businessId: business.id, subtype: { in: ['cash_and_bank', 'credit_card'] }, isArchived: false },
      orderBy: { code: 'asc' },
    }),
    prisma.account.findMany({
      where: { businessId: business.id, isArchived: false },
      orderBy: { code: 'asc' },
    }),
    prisma.importedTransaction.findMany({
      where: { businessId: business.id, needsReview: true },
      orderBy: { date: 'desc' },
      include: { bankAccountLink: true },
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
          <Link href="/banking/rules" className="text-teal-700 hover:underline">Rules</Link>
          <Link href="/banking/reconcile" className="text-teal-700 hover:underline">Reconciliation</Link>
        </div>
      </div>

      {plaidOn && canManage && (
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 flex items-center justify-between gap-4">
          <p className="text-sm text-slate-500">
            Connect a checking, savings or credit card account through Plaid. The bank login happens in
            Plaid&apos;s window; this app never sees or stores bank usernames or passwords.
            {webhookMissing && (
              <span className="block text-amber-700 mt-1">
                PLAID_WEBHOOK_URL is not set, so new transactions only arrive when you press Sync now.
              </span>
            )}
          </p>
          <PlaidLinkButton label="Connect a bank" />
        </div>
      )}

      {!plaidOn && canManage && connections.every((c) => c.status === 'REMOVED') && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">
            No bank connected. The sandbox connection imports a deterministic feed so the whole
            categorize/match/reconcile flow works without credentials; real bank connections through
            Plaid turn on when PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV are configured.
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

      {connections.map((c) => {
        const st = CONNECTION_STATUS[c.status] ?? CONNECTION_STATUS.ERROR;
        const removed = c.status === 'REMOVED';
        return (
          <div key={c.id} className={`rounded-lg border bg-white px-5 py-4 space-y-3 ${removed ? 'border-slate-200 opacity-70' : c.status === 'ACTIVE' ? 'border-slate-200' : 'border-amber-300'}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">
                  {c.institutionName}{' '}
                  <span className={`ml-1 rounded px-1.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                </p>
                <p className="text-sm text-slate-500">
                  provider: {c.provider} · last sync: {fmtTime(c.lastSyncAt)}
                  {removed && c.removedAt && <> · disconnected {fmtTime(c.removedAt)} (history kept)</>}
                  {c.errorCode && !removed && <> · error: <code className="text-xs">{c.errorCode}</code></>}
                </p>
                {c.status === 'NEEDS_RECONNECT' && (
                  <p className="text-sm text-amber-800 mt-1">
                    The bank needs the login confirmed again before new transactions can come in.
                  </p>
                )}
              </div>
              {canManage && !removed && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {c.status === 'NEEDS_RECONNECT' && c.provider === 'plaid' && plaidOn && (
                    <PlaidLinkButton reconnectConnectionId={c.id} label="Reconnect" variant="secondary" />
                  )}
                  {c.status !== 'NEEDS_RECONNECT' && (
                    <ActionButton action={syncConnectionAction.bind(null, c.id)} label="Sync now" />
                  )}
                  <ActionButton
                    action={disconnectConnectionAction.bind(null, c.id)}
                    label="Disconnect"
                    confirmLabel="Yes, disconnect"
                    variant="danger"
                  />
                </div>
              )}
            </div>
            <ul className="divide-y divide-slate-50 text-sm">
              {c.accounts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span>
                    {a.name} {a.mask && <span className="text-slate-400">••{a.mask}</span>}
                    {a.subtype && <span className="ml-2 text-xs text-slate-400">{a.subtype}</span>}
                  </span>
                  {canManage && !removed ? (
                    <div className="[&_form]:border-0 [&_form]:p-0">
                      <SimpleRecordForm
                        action={remapAccountLinkAction.bind(null, a.id)}
                        submitLabel="Save"
                        fields={[
                          {
                            name: 'ledgerAccountId',
                            label: 'Posts to ledger account',
                            type: 'select',
                            defaultValue: a.ledgerAccountId,
                            options: feedAccounts.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` })),
                          },
                        ]}
                      />
                    </div>
                  ) : (
                    <span className="text-slate-500">→ {accountName.get(a.ledgerAccountId) ?? 'ledger account'}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {flagged.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-white">
          <h2 className="px-5 py-3 border-b border-amber-100 font-medium">
            Changed by the bank after posting{' '}
            <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{flagged.length}</span>
          </h2>
          <p className="px-5 pt-3 text-sm text-slate-500">
            These were already on the books when the bank changed or removed them. The ledger was not
            touched. If the books need fixing, reverse the entry and categorize the corrected transaction.
          </p>
          <div className="divide-y divide-slate-50">
            {flagged.map((t) => {
              const change = t.providerChange as { date?: string; description?: string; amount?: string } | null;
              return (
                <div key={t.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div>
                    <p>
                      {t.date.toISOString().slice(0, 10)} · {t.description} ·{' '}
                      <span className="tabular-nums">{formatMoney(t.amount, t.bankAccountLink.currency)}</span>
                    </p>
                    <p className="text-amber-800">
                      {t.reviewReason === 'PROVIDER_REMOVED'
                        ? 'The bank removed this transaction.'
                        : `The bank now shows: ${change?.date ?? '?'} · ${change?.description ?? ''} · ${
                            change?.amount ? formatMoney(BigInt(change.amount), t.bankAccountLink.currency) : '?'
                          }`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {t.journalEntryId && (
                      <Link href={`/journal/${t.journalEntryId}`} className="text-teal-700 hover:underline">
                        view entry
                      </Link>
                    )}
                    {canManage && <ActionButton action={clearReviewFlagAction.bind(null, t.id)} label="Mark reviewed" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                    : t.status === 'MATCHED' ? 'bg-teal-50 text-teal-700'
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
                    <Link href={`/journal/${t.journalEntryId}`} className="text-teal-700 hover:underline">
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
