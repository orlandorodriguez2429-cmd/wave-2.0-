'use client';

import { useActionState, useMemo, useState } from 'react';
import type { ActionResult } from '@/app/actions';
import { formatMoney, parseAmount } from '@/lib/money';
import { parseQuantity } from '@/lib/invoicing/totals';
import type { Option } from '@/components/document-form';

interface Row {
  description: string;
  quantity: string;
  price: string;
  incomeAccountId: string;
}

const emptyRow = (defaultAccount: string): Row => ({ description: '', quantity: '1', price: '', incomeAccountId: defaultAccount });

export function RecurringInvoiceForm({
  action,
  customers,
  incomeAccounts,
  functionalCurrency,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  customers: Option[];
  incomeAccounts: Option[];
  functionalCurrency: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});
  const defaultAccount = incomeAccounts[0]?.value ?? '';
  const [rows, setRows] = useState<Row[]>([emptyRow(defaultAccount)]);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const total = useMemo(() => {
    let subtotal = 0n;
    for (const row of rows) {
      if (!row.price.trim()) continue;
      try {
        const qty = parseQuantity(row.quantity || '1');
        subtotal += (qty * parseAmount(row.price, functionalCurrency) + 500n) / 1000n;
      } catch {
        // ignore incomplete rows while typing
      }
    }
    return subtotal;
  }, [rows, functionalCurrency]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white p-5 flex flex-wrap gap-4">
        <label className="block flex-1 min-w-56">
          <span className="block text-xs font-medium text-slate-500 mb-1">Customer</span>
          <select name="customerId" required className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            <option value="">— select —</option>
            {customers.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Frequency</span>
          <select name="frequency" defaultValue="MONTHLY" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
            <option value="QUARTERLY">Quarterly</option>
            <option value="YEARLY">Yearly</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">First issue date</span>
          <input type="date" name="startDate" defaultValue={today} required className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Due in (days)</span>
          <input type="number" name="dueInDays" defaultValue="30" min="0" max="365" className="w-20 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">End date (optional)</span>
          <input type="date" name="endDate" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
          <input type="checkbox" name="autoApprove" defaultChecked /> Auto-approve each run
        </label>
        <label className="block flex-1 min-w-56">
          <span className="block text-xs font-medium text-slate-500 mb-1">Memo</span>
          <input name="memo" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-medium w-1/2">Description</th>
              <th className="px-3 py-3 font-medium text-right">Qty</th>
              <th className="px-3 py-3 font-medium text-right">Unit price</th>
              <th className="px-3 py-3 font-medium">Income account</th>
              <th className="px-2 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-50 last:border-0 align-top">
                <td className="px-4 py-2">
                  <input
                    value={row.description}
                    onChange={(e) => setRow(i, { description: e.target.value })}
                    name="lineDescription"
                    placeholder="Service or product"
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={row.quantity}
                    onChange={(e) => setRow(i, { quantity: e.target.value })}
                    name="lineQuantity"
                    inputMode="decimal"
                    className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-right"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={row.price}
                    onChange={(e) => setRow(i, { price: e.target.value })}
                    name="linePrice"
                    placeholder="0.00"
                    inputMode="decimal"
                    className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-right"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={row.incomeAccountId}
                    onChange={(e) => setRow(i, { incomeAccountId: e.target.value })}
                    name="lineIncomeAccountId"
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white max-w-44"
                  >
                    {incomeAccounts.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                      className="px-1.5 py-1 text-slate-300 hover:text-red-600"
                      aria-label="Remove line"
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 text-sm">
              <td className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => setRows((prev) => [...prev, emptyRow(defaultAccount)])}
                  className="text-teal-600 hover:underline font-medium"
                >
                  + Add line
                </button>
              </td>
              <td colSpan={3} className="px-4 py-3 text-right font-semibold tabular-nums">
                Each invoice: {formatMoney(total, functionalCurrency)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {state.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-teal-600 px-5 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Create recurring invoice'}
      </button>
    </form>
  );
}
