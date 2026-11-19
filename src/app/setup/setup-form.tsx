'use client';

import { useActionState, useState } from 'react';
import { setupAction } from '@/app/auth-actions';
import type { ActionResult } from '@/app/actions';

export function SetupForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(setupAction, {});
  const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';
  // Keep typed values after an error (React resets uncontrolled fields after a form action).
  const [kept, setKept] = useState<Record<string, string>>({});
  const field = (name: string, label: string, type = 'text', extra: Record<string, unknown> = {}) => (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      <input
        name={name}
        type={type}
        required
        className={input}
        {...(type === 'password' ? {} : { value: kept[name] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setKept((k) => ({ ...k, [name]: e.target.value })) })}
        {...extra}
      />
    </label>
  );
  return (
    <form action={action} className="space-y-3">
      {field('code', 'Setup code', 'password', { autoComplete: 'off' })}
      {field('businessName', 'Your office name', 'text', { placeholder: 'Your Tax Solution LLC' })}
      {field('name', 'Your name', 'text', { autoComplete: 'name' })}
      {field('email', 'Your email', 'email', { autoComplete: 'email' })}
      {field('password', 'Password (at least 12 characters)', 'password', { minLength: 12, autoComplete: 'new-password' })}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
        {pending ? '…' : 'Create my account'}
      </button>
      <p className="text-xs text-slate-400">Next you&apos;ll set up two-step verification with an authenticator app.</p>
    </form>
  );
}
