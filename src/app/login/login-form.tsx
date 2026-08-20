'use client';

import { useActionState } from 'react';
import { loginAction } from '@/app/auth-actions';
import type { ActionResult } from '@/app/actions';

export function LoginForm() {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(loginAction, {});
  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="block text-xs font-medium text-slate-500 mb-1">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-slate-500 mb-1">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
