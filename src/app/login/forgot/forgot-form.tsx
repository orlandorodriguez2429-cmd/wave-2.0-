'use client';

import { useActionState } from 'react';
import { requestResetAction } from '@/app/auth-actions';

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestResetAction, {});
  if (state.message) return <p className="text-sm text-green-700">{state.message}</p>;
  return (
    <form action={action} className="space-y-3">
      <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
        {pending ? '…' : 'Email me a reset link'}
      </button>
    </form>
  );
}
