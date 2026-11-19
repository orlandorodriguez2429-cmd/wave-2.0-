'use client';

import { useActionState } from 'react';
import { createBusinessAction, deleteBusinessAction, inviteClientAction } from '@/app/auth-actions';
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

export function DeleteBusinessForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(deleteBusinessAction, {});
  return (
    <form action={action} className="rounded-lg border border-red-200 bg-red-50/40 p-4 space-y-2">
      <p className="text-sm text-slate-700">
        Permanently deletes <strong>{name}</strong>: its bank connections (removed at Plaid first), imported transactions, ledger,
        contractors/W-9s, 1099s and audit log. A deletion record (who, when, counts) is kept. <strong>Export anything you are
        required to keep first</strong> (e.g. filed 1099 copies and records supporting a filed return).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Type the business name to confirm</span>
          <input name="confirmName" required autoComplete="off" className="w-64 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <button disabled={pending} className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
          {pending ? 'Deleting…' : 'Delete business'}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
