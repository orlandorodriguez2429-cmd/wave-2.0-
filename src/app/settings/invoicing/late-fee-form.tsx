'use client';

import { useActionState, useState } from 'react';
import type { ActionResult } from '@/app/actions';
import { updateLateFeeSettingsAction } from '@/app/invoicing-actions';

export function LateFeeForm({
  initialEnabled,
  initialRatePercent,
  initialGraceDays,
}: {
  initialEnabled: boolean;
  initialRatePercent: string;
  initialGraceDays: number;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(updateLateFeeSettingsAction, {});
  const [enabled, setEnabled] = useState(initialEnabled);

  return (
    <form action={formAction} className="space-y-4">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4"
        />
        Enable late fees on overdue invoices
      </label>

      {enabled && (
        <div className="flex flex-wrap gap-4">
          <label className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1">Rate (% of balance, one-time)</span>
            <input
              name="ratePercent"
              defaultValue={initialRatePercent}
              placeholder="1.5"
              className="w-28 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1">Grace period (days past due)</span>
            <input
              name="graceDays"
              defaultValue={String(initialGraceDays)}
              inputMode="numeric"
              className="w-28 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
            />
          </label>
        </div>
      )}

      {state.error && <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="rounded-md bg-teal-600 px-5 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
