'use client';

import { useActionState, useState } from 'react';
import type { ActionResult } from '@/app/actions';
import { createExpenseAction } from '@/app/invoicing-actions';
import type { Option } from '@/components/document-form';

interface Row {
  accountId: string;
  amount: string;
  description: string;
}

export function NewExpenseForm({
  vendors,
  expenseAccounts,
  paymentAccounts,
  currencies,
  functionalCurrency,
}: {
  vendors: Option[];
  expenseAccounts: Option[];
  paymentAccounts: Option[];
  currencies: string[];
  functionalCurrency: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(createExpenseAction, {});
  const [rows, setRows] = useState<Row[]>([{ accountId: expenseAccounts[0]?.value ?? '', amount: '', description: '' }]);
  const [currency, setCurrency] = useState(functionalCurrency);
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form action={formAction} className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white p-5 flex flex-wrap gap-4">
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Date</span>
          <input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="block flex-1 min-w-56">
          <span className="block text-xs font-medium text-slate-500 mb-1">Memo</span>
          <input name="memo" required placeholder="What was purchased?" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Vendor</span>
          <select name="vendorId" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            <option value="">— none —</option>
            {vendors.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Paid from</span>
          <select name="paymentAccountId" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            {paymentAccounts.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Method</span>
          <select name="paymentMethod" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            {['ACH', 'CHECK', 'CASH', 'WIRE', 'CARD', 'OTHER'].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Currency</span>
          <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            {currencies.map((c) => (
              <option key={c} value={c}>{c}{c === functionalCurrency ? ' (home)' : ''}</option>
            ))}
          </select>
        </label>
        {currency !== functionalCurrency && (
          <label className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1">Rate → {functionalCurrency}</span>
            <input name="exchangeRate" placeholder="1.0850" required className="w-28 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
        )}
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Receipt (image/PDF)</span>
          <input type="file" name="receipt" accept="image/*,application/pdf" className="text-sm" />
        </label>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-medium">Expense account</th>
              <th className="px-3 py-3 font-medium text-right">Amount</th>
              <th className="px-3 py-3 font-medium">Description</th>
              <th className="px-2 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2">
                  <select
                    value={row.accountId}
                    onChange={(e) => setRow(i, { accountId: e.target.value })}
                    name="lineAccountId"
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white"
                  >
                    {expenseAccounts.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    value={row.amount}
                    onChange={(e) => setRow(i, { amount: e.target.value })}
                    name="lineAmount"
                    placeholder="0.00"
                    inputMode="decimal"
                    className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-right"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={row.description}
                    onChange={(e) => setRow(i, { description: e.target.value })}
                    name="lineDescription"
                    placeholder="optional"
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  {rows.length > 1 && (
                    <button type="button" onClick={() => setRows((p) => p.filter((_, j) => j !== i))} className="px-1.5 text-slate-300 hover:text-red-600">
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50">
              <td colSpan={4} className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => setRows((p) => [...p, { accountId: expenseAccounts[0]?.value ?? '', amount: '', description: '' }])}
                  className="text-teal-600 hover:underline text-sm font-medium"
                >
                  + Split line
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {state.error && <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="rounded-md bg-teal-600 px-5 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
        {pending ? 'Saving…' : 'Save expense'}
      </button>
    </form>
  );
}
