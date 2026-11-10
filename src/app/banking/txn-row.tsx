'use client';

import { useActionState, useState, useTransition } from 'react';
import type { ActionResult } from '@/app/actions';
import { categorizeTxnAction, excludeTxnAction, matchTxnAction } from '@/app/banking-actions';
import type { Option } from '@/components/document-form';

export interface Candidate {
  journalLineId: string;
  label: string;
}

export function TxnRow({
  txn,
  accounts,
  candidates,
  loanAccountIds = [],
}: {
  txn: {
    id: string;
    date: string;
    description: string;
    amountLabel: string;
    negative: boolean;
    suggestedAccountId: string | null;
    suggestedByRule: boolean;
    aiConfidence: number | null;
    aiReason: string | null;
  };
  accounts: Option[];
  candidates: Candidate[];
  /** Account ids that are loans (show the interest field on money out). */
  loanAccountIds?: string[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(categorizeTxnAction, {});
  const [selected, setSelected] = useState(txn.suggestedAccountId ?? '');
  const [busy, startTransition] = useTransition();

  return (
    <div className="px-5 py-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-slate-500 text-sm whitespace-nowrap">{txn.date}</span>
        <span className="flex-1 text-sm font-medium">{txn.description}</span>
        <span className={`tabular-nums text-sm ${txn.negative ? '' : 'text-green-700'}`}>{txn.amountLabel}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="transactionId" value={txn.id} />
          <select
            name="categoryAccountId"
            required
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm bg-white max-w-56"
          >
            <option value="" disabled>Choose a category…</option>
            {accounts.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          {txn.suggestedAccountId && selected === txn.suggestedAccountId && (
            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">
              {txn.suggestedByRule ? 'rule' : txn.aiConfidence !== null ? `AI guess ${Math.round(txn.aiConfidence * 100)}%` : 'suggested'}
            </span>
          )}
          {txn.negative && loanAccountIds.includes(selected) && (
            <label className="flex items-center gap-1 text-xs text-slate-600">
              Interest part
              <input name="interest" required placeholder="0.00" className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm" />
            </label>
          )}
          <label className="flex items-center gap-1 text-xs text-slate-500" title="Create a rule so this payee is categorized automatically next time">
            <input type="checkbox" name="remember" /> Remember for this payee
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-teal-600 px-3 py-1 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {pending ? '…' : 'Categorize'}
          </button>
        </form>
        {candidates.map((c) => (
          <button
            key={c.journalLineId}
            onClick={() => startTransition(() => matchTxnAction(txn.id, c.journalLineId))}
            disabled={busy}
            className="rounded-md border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700 hover:bg-teal-100 disabled:opacity-50"
            title="Match to this existing ledger entry — no new entry is created"
          >
            Match: {c.label}
          </button>
        ))}
        <button
          onClick={() => startTransition(() => excludeTxnAction(txn.id))}
          disabled={busy}
          className="rounded-md px-3 py-1 text-xs font-medium text-slate-400 hover:text-slate-700 disabled:opacity-50"
        >
          Exclude
        </button>
      </div>
      {txn.aiReason && <p className="text-xs text-slate-500">{txn.aiReason}</p>}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
