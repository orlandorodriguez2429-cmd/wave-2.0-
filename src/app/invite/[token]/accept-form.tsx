'use client';

import { useActionState } from 'react';
import { acceptInviteAction } from '@/app/auth-actions';
import type { ActionResult } from '@/app/actions';

export function AcceptInviteForm({ token, existingUser, minLength }: { token: string; existingUser: boolean; minLength: number }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(acceptInviteAction.bind(null, token), {});
  const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';
  return (
    <form action={action} className="space-y-3">
      {!existingUser && (
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Your name</span>
          <input name="name" autoComplete="name" className={input} />
        </label>
      )}
      <label className="block">
        <span className="block text-xs font-medium text-slate-500 mb-1">{existingUser ? 'Password' : `New password (at least ${minLength} characters)`}</span>
        <input name="password" type="password" required minLength={existingUser ? undefined : minLength} autoComplete={existingUser ? 'current-password' : 'new-password'} className={input} />
      </label>
      {!existingUser && (
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Repeat password</span>
          <input name="confirm" type="password" required autoComplete="new-password" className={input} />
        </label>
      )}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
        {pending ? '…' : 'Accept invitation'}
      </button>
    </form>
  );
}
