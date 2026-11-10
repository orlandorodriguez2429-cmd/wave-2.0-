'use client';

import { useActionState } from 'react';
import { createBusinessAction, inviteClientAction } from '@/app/auth-actions';
import { createApiTokenAction, type TokenResult } from '@/app/team-actions';
import type { ActionResult } from '@/app/actions';

export function NewBusinessForm() {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(createBusinessAction, {});
  return (
    <form action={formAction} className="flex items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <label className="block flex-1 min-w-48">
        <span className="block text-xs font-medium text-slate-500 mb-1">Business name</span>
        <input name="name" required className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-slate-500 mb-1">Currency</span>
        <select name="currency" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
          {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending} className="rounded-md bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
        {pending ? 'Creating…' : 'Create business'}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

export function TokenForm() {
  const [state, formAction, pending] = useActionState<TokenResult, FormData>(createApiTokenAction, {});
  return (
    <div className="space-y-2">
      <form action={formAction} className="flex items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="block flex-1 min-w-48">
          <span className="block text-xs font-medium text-slate-500 mb-1">Token name</span>
          <input name="name" placeholder="ci-integration" required className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <button type="submit" disabled={pending} className="rounded-md bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
          {pending ? 'Creating…' : 'Create token'}
        </button>
      </form>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.token && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Copy this token now — it is shown only once:{' '}
          <code className="font-mono text-xs break-all">{state.token}</code>
        </p>
      )}
    </div>
  );
}

export function InviteClientForm() {
  const [state, action, pending] = useActionState(inviteClientAction, {});
  return (
    <form action={action} className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="block text-xs font-medium text-slate-500 mb-1">Client&apos;s email</span>
        <input name="email" type="email" required className="w-64 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <button disabled={pending} className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
        {pending ? 'Sending…' : 'Send invite'}
      </button>
      {state.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
      {state.message && <p className="w-full text-sm text-green-700">{state.message}</p>}
    </form>
  );
}
