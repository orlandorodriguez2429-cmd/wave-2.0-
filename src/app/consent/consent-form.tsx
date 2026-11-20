'use client';

import { useActionState, useState } from 'react';
import { acceptTermsAction, logoutAction } from '@/app/auth-actions';

export function ConsentForm({ isClient }: { isClient: boolean }) {
  const [state, action, pending] = useActionState(acceptTermsAction, {});
  const [ok, setOk] = useState(false);
  return (
    <form action={action} className="space-y-3">
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="agree" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-1" />
        <span>
          I have read the Privacy notice and agree to the Terms of use
          {isClient ? ', including connecting my bank accounts through Plaid for bookkeeping' : ''}.
        </span>
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex items-center gap-3">
        <button disabled={!ok || pending} className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? '…' : 'Agree and continue'}
        </button>
        <button type="button" onClick={() => logoutAction()} className="text-sm text-slate-500 hover:underline">
          Sign out
        </button>
      </div>
    </form>
  );
}
