'use client';

import { useActionState } from 'react';
import { createAccountAction, type ActionResult } from '@/app/actions';

export function NewAccountForm() {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(createAccountAction, {});

  return (
    <form action={formAction} className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Code</span>
          <input
            name="code"
            placeholder="6150"
            className="w-24 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
            required
          />
        </label>
        <label className="block flex-1 min-w-48">
          <span className="block text-xs font-medium text-slate-500 mb-1">Name</span>
          <input
            name="name"
            placeholder="Equipment Rental"
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
            required
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Type</span>
          <select name="type" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            <option value="ASSET">Asset</option>
            <option value="LIABILITY">Liability</option>
            <option value="EQUITY">Equity</option>
            <option value="INCOME">Income</option>
            <option value="EXPENSE">Expense</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Subtype (optional)</span>
          <input
            name="subtype"
            placeholder="cogs, cash_and_bank…"
            className="w-44 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add account'}
        </button>
      </div>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
