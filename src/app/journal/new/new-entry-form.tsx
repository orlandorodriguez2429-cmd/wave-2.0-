'use client';

import { useActionState, useMemo, useState } from 'react';
import { createJournalEntryAction, type ActionResult } from '@/app/actions';
import { formatMoney, parseAmount } from '@/lib/money';
import type { AccountType } from '@/generated/prisma/enums';

interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: AccountType;
}

interface Row {
  accountId: string;
  debit: string;
  credit: string;
  description: string;
}

const emptyRow = (): Row => ({ accountId: '', debit: '', credit: '', description: '' });

export function NewEntryForm({
  accounts,
  functionalCurrency,
  currencies,
}: {
  accounts: AccountOption[];
  functionalCurrency: string;
  currencies: string[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(createJournalEntryAction, {});
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow()]);
  const [currency, setCurrency] = useState(functionalCurrency);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const { debitTotal, creditTotal, parseError } = useMemo(() => {
    let d = 0n;
    let c = 0n;
    let err: string | null = null;
    for (const row of rows) {
      try {
        if (row.debit.trim()) d += parseAmount(row.debit, currency);
        if (row.credit.trim()) c += parseAmount(row.credit, currency);
      } catch (e) {
        err = e instanceof Error ? e.message : 'Invalid amount';
      }
    }
    return { debitTotal: d, creditTotal: c, parseError: err };
  }, [rows, currency]);

  const balanced = debitTotal === creditTotal && debitTotal > 0n && !parseError;

  return (
    <form action={formAction} className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap gap-4">
          <label className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1">Date</span>
            <input
              type="date"
              name="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              required
            />
          </label>
          <label className="block flex-1 min-w-64">
            <span className="block text-xs font-medium text-slate-500 mb-1">Memo</span>
            <input
              name="memo"
              placeholder="What is this entry for?"
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              required
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
              <span className="block text-xs font-medium text-slate-500 mb-1">
                Rate → {functionalCurrency}
              </span>
              <input
                name="exchangeRate"
                placeholder="1.0850"
                className="w-28 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                required
              />
            </label>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-medium w-2/5">Account</th>
              <th className="px-3 py-3 font-medium text-right">Debit</th>
              <th className="px-3 py-3 font-medium text-right">Credit</th>
              <th className="px-3 py-3 font-medium">Description</th>
              <th className="px-2 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const direction = row.credit.trim() && !row.debit.trim() ? 'CREDIT' : 'DEBIT';
              const amount = direction === 'CREDIT' ? row.credit : row.debit;
              const bothFilled = !!row.debit.trim() && !!row.credit.trim();
              return (
                <tr key={i} className="border-b border-slate-50 last:border-0 align-top">
                  <td className="px-4 py-2">
                    <select
                      value={row.accountId}
                      onChange={(e) => setRow(i, { accountId: e.target.value })}
                      className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white"
                    >
                      <option value="">— select account —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </select>
                    {/* Normalized values the server action reads */}
                    <input type="hidden" name="lineAccountId" value={row.accountId} />
                    <input type="hidden" name="lineDirection" value={direction} />
                    <input type="hidden" name="lineAmount" value={bothFilled ? '' : amount} />
                    <input type="hidden" name="lineDescription" value={row.description} />
                    {bothFilled && (
                      <p className="mt-1 text-xs text-red-600">Fill debit or credit, not both.</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.debit}
                      onChange={(e) => setRow(i, { debit: e.target.value })}
                      placeholder="0.00"
                      inputMode="decimal"
                      className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.credit}
                      onChange={(e) => setRow(i, { credit: e.target.value })}
                      placeholder="0.00"
                      inputMode="decimal"
                      className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.description}
                      onChange={(e) => setRow(i, { description: e.target.value })}
                      placeholder="optional"
                      className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    {rows.length > 2 && (
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
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 text-sm font-medium">
              <td className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => setRows((prev) => [...prev, emptyRow()])}
                  className="text-blue-600 hover:underline text-sm font-medium"
                >
                  + Add line
                </button>
              </td>
              <td className="px-3 py-3 text-right tabular-nums">{formatMoney(debitTotal, currency)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatMoney(creditTotal, currency)}</td>
              <td className="px-3 py-3" colSpan={2}>
                {parseError ? (
                  <span className="text-red-600">{parseError}</span>
                ) : balanced ? (
                  <span className="text-green-600">Balanced ✓</span>
                ) : (
                  <span className="text-amber-600">
                    Out of balance by {formatMoney(debitTotal - creditTotal, currency)}
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
        disabled={pending || !balanced}
        className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? 'Posting…' : 'Post entry'}
      </button>
    </form>
  );
}
