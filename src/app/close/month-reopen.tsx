'use client';

import { useActionState, useState } from 'react';
import type { ActionResult } from '@/app/actions';

export function MonthReopen({ action }: { action: (prev: ActionResult, fd: FormData) => Promise<ActionResult> }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-slate-500 hover:text-slate-800">
        Reopen…
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        name="reason"
        required
        placeholder="Why? (kept in the audit log)"
        className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      <button disabled={pending} className="rounded-md border border-amber-400 bg-amber-50 px-3 py-1 text-sm text-amber-800 disabled:opacity-50">
        {pending ? '…' : 'Reopen'}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">Cancel</button>
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}
