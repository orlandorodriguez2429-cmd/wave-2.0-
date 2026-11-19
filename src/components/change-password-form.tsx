'use client';

import { useActionState } from 'react';
import { changePasswordAction } from '@/app/auth-actions';

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, {});
  const input = 'w-48 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm';
  return (
    <form action={action} className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="block text-xs font-medium text-slate-500 mb-1">Current password</span>
        <input name="current" type="password" required autoComplete="current-password" className={input} />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-slate-500 mb-1">New password (12+ characters)</span>
        <input name="next" type="password" required minLength={12} autoComplete="new-password" className={input} />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-slate-500 mb-1">Repeat new password</span>
        <input name="confirm" type="password" required autoComplete="new-password" className={input} />
      </label>
      <button disabled={pending} className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? '…' : 'Change password'}
      </button>
      {state.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
      {state.message && <p className="w-full text-sm text-green-700">{state.message}</p>}
    </form>
  );
}
