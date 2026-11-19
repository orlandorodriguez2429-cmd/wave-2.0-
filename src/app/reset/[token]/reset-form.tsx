'use client';

import { useActionState } from 'react';
import { resetPasswordAction } from '@/app/auth-actions';
import type { ActionResult } from '@/app/actions';

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(resetPasswordAction.bind(null, token), {});
  const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="block text-xs font-medium text-slate-500 mb-1">New password (at least 12 characters)</span>
        <input name="password" type="password" required minLength={12} autoComplete="new-password" className={input} />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-slate-500 mb-1">Repeat it</span>
        <input name="confirm" type="password" required autoComplete="new-password" className={input} />
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
        {pending ? '…' : 'Save new password'}
      </button>
    </form>
  );
}
