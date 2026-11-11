'use client';

import { useActionState } from 'react';
import { useTransition } from 'react';
import { enrollMfaAction, finishEnrollmentAction, verifyMfaAction } from '@/app/auth-actions';

const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-lg tracking-widest text-center';
const button = 'w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50';

export function MfaVerifyForm() {
  const [state, action, pending] = useActionState(verifyMfaAction, {});
  return (
    <form action={action} className="space-y-3">
      <input name="code" required autoFocus autoComplete="one-time-code" inputMode="text" placeholder="123456" className={input} />
      <p className="text-xs text-slate-500">Lost your phone? Enter one of your backup codes instead.</p>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className={button}>{pending ? 'Checking…' : 'Verify'}</button>
    </form>
  );
}

export function MfaEnrollForm() {
  const [state, action, pending] = useActionState(enrollMfaAction, {});
  if (state.backupCodes) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-green-700">Two-step verification is on.</p>
        <p className="text-sm text-slate-600">
          Save these backup codes somewhere safe. Each works once if you lose your phone. They won&apos;t be shown again.
        </p>
        <ul className="grid grid-cols-2 gap-1 rounded-md bg-slate-50 p-3 font-mono text-sm">
          {state.backupCodes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <ContinueButton />
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <input name="code" required autoComplete="one-time-code" inputMode="numeric" placeholder="123456" className={input} />
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className={button}>{pending ? 'Checking…' : 'Turn on two-step verification'}</button>
    </form>
  );
}

export function ContinueButton({ label = 'I saved them — continue' }: { label?: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => start(() => finishEnrollmentAction())} className={button}>
      {pending ? '…' : label}
    </button>
  );
}
