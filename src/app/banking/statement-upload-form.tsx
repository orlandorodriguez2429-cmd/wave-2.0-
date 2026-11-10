'use client';

import { useActionState, useState } from 'react';
import { uploadStatementAction } from '@/app/banking-actions';
import { clientUploadStatementAction } from '@/app/client-actions';

export function StatementUploadForm({
  accounts,
  audience = 'staff',
}: {
  accounts: Array<{ value: string; label: string }>;
  audience?: 'staff' | 'client';
}) {
  const [state, formAction, pending] = useActionState(audience === 'client' ? clientUploadStatementAction : uploadStatementAction, {});
  const [target, setTarget] = useState(accounts[0]?.value ?? 'new');
  const input = 'rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white';
  return (
    <form action={formAction} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <div>
        <h2 className="font-medium">Upload a statement instead</h2>
        <p className="text-sm text-slate-500">
          For banks or clients that won&apos;t use Plaid. Upload the bank&apos;s CSV export and the statement&apos;s opening and
          closing balance; nothing is imported unless the balances add up. Lines already on file are skipped.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Account</span>
          <select name="linkId" value={target} onChange={(e) => setTarget(e.target.value)} className={input}>
            {accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            <option value="new">New account…</option>
          </select>
        </label>
        {target === 'new' && (
          <>
            <label className="block">
              <span className="block text-xs font-medium text-slate-500 mb-1">Account name</span>
              <input name="newName" placeholder="e.g. Local CU Checking 1234" className={`${input} w-56`} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-500 mb-1">Type</span>
              <select name="newKind" className={input}>
                <option value="depository">Checking / savings</option>
                <option value="credit">Credit card</option>
              </select>
            </label>
          </>
        )}
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Statement CSV</span>
          <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Opening balance</span>
          <input name="opening" required placeholder="0.00" className={`${input} w-28`} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Closing balance</span>
          <input name="closing" required placeholder="0.00" className={`${input} w-28`} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
          <input type="checkbox" name="positiveIsMoneyOut" /> Positive amounts are money out (some card exports)
        </label>
        <button disabled={pending} className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
          {pending ? 'Checking…' : 'Upload'}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p className="text-sm text-green-700">{state.message}</p>}
    </form>
  );
}
