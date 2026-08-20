'use client';

// Shared line-item document form for invoices and estimates.
import { useActionState, useMemo, useState } from 'react';
import type { ActionResult } from '@/app/actions';
import { formatMoney, parseAmount } from '@/lib/money';
import { parseQuantity } from '@/lib/invoicing/totals';

export interface Option {
  value: string;
  label: string;
}

interface Row {
  description: string;
  quantity: string;
  price: string;
  incomeAccountId: string;
  taxRateId: string;
}

const emptyRow = (defaultAccount: string): Row => ({
  description: '',
  quantity: '1',
  price: '',
  incomeAccountId: defaultAccount,
  taxRateId: '',
});

export function DocumentForm({
  mode,
  action,
  customers,
  incomeAccounts,
  taxRates,
  taxRatePpm,
  currencies,
  functionalCurrency,
}: {
  mode: 'invoice' | 'estimate';
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  customers: Option[];
  incomeAccounts: Option[];
  taxRates: Option[];
  /** ppm keyed by tax rate id, for live totals. */
  taxRatePpm: Record<string, number>;
  currencies: string[];
  functionalCurrency: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});
  const defaultAccount = incomeAccounts[0]?.value ?? '';
  const [rows, setRows] = useState<Row[]>([emptyRow(defaultAccount)]);
  const [currency, setCurrency] = useState(functionalCurrency);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const totals = useMemo(() => {
    let subtotal = 0n;
    let tax = 0n;
    let error: string | null = null;
    for (const row of rows) {
      if (!row.price.trim()) continue;
      try {
        const qty = parseQuantity(row.quantity || '1');
        const price = parseAmount(row.price, currency);
        const amount = (qty * price + 500n) / 1000n;
        subtotal += amount;
        const ppm = row.taxRateId ? taxRatePpm[row.taxRateId] : undefined;
        if (ppm) tax += (amount * BigInt(ppm) + 500_000n) / 1_000_000n;
      } catch (e) {
        error = e instanceof Error ? e.message : 'Invalid line';
      }
    }
    return { subtotal, tax, total: subtotal + tax, error };
  }, [rows, currency, taxRatePpm]);

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

  return (
    <form action={formAction} className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white p-5 flex flex-wrap gap-4">
        <label className="block flex-1 min-w-56">
          <span className="block text-xs font-medium text-slate-500 mb-1">Customer</span>
          <select name="customerId" required className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            <option value="">— select —</option>
            {customers.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Issue date</span>
          <input type="date" name="issueDate" defaultValue={today} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">
            {mode === 'invoice' ? 'Due date' : 'Expiry date'}
          </span>
          <input
            type="date"
            name={mode === 'invoice' ? 'dueDate' : 'expiryDate'}
            defaultValue={mode === 'invoice' ? in30 : ''}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Currency</span>
          <select
            name="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white"
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
                {c === functionalCurrency ? ' (home)' : ''}
              </option>
            ))}
          </select>
        </label>
        {currency !== functionalCurrency && (
          <label className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1">Rate → {functionalCurrency}</span>
            <input name="exchangeRate" placeholder="1.0850" required className="w-28 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
        )}
        <label className="block flex-1 min-w-56">
          <span className="block text-xs font-medium text-slate-500 mb-1">Memo</span>
          <input name="memo" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        {mode === 'invoice' && (
          <label className="block flex-1 min-w-56">
            <span className="block text-xs font-medium text-slate-500 mb-1">Terms</span>
            <input name="terms" placeholder="Net 30" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-medium w-1/3">Description</th>
              <th className="px-3 py-3 font-medium text-right">Qty</th>
              <th className="px-3 py-3 font-medium text-right">Unit price</th>
              <th className="px-3 py-3 font-medium">Income account</th>
              <th className="px-3 py-3 font-medium">Tax</th>
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
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={row.taxRateId}
                    onChange={(e) => setRow(i, { taxRateId: e.target.value })}
                    name="lineTaxRateId"
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white max-w-36"
                  >
                    <option value="">No tax</option>
                    {taxRates.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
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
                  className="text-blue-600 hover:underline font-medium"
                >
                  + Add line
                </button>
              </td>
              <td colSpan={5} className="px-4 py-3 text-right">
                {totals.error ? (
                  <span className="text-red-600">{totals.error}</span>
                ) : (
                  <span className="space-x-4 tabular-nums">
                    <span className="text-slate-500">Subtotal {formatMoney(totals.subtotal, currency)}</span>
                    <span className="text-slate-500">Tax {formatMoney(totals.tax, currency)}</span>
                    <span className="font-semibold">Total {formatMoney(totals.total, currency)}</span>
                  </span>
                )}
              </td>
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
        className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? 'Saving…' : mode === 'invoice' ? 'Save draft invoice' : 'Save estimate'}
      </button>
    </form>
  );
}
