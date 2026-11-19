'use client';

import { useTransition } from 'react';
import { logoutAction, switchBusinessAction } from '@/app/auth-actions';

export function SessionBox({
  userName,
  role,
  businessId,
  memberships,
}: {
  userName: string;
  role: string;
  businessId: string;
  memberships: Array<{ businessId: string; businessName: string; role: string }>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="border-t border-white/10 p-3 space-y-2">
      {memberships.length > 1 ? (
        <select
          value={businessId}
          disabled={pending}
          onChange={(e) => startTransition(() => switchBusinessAction(e.target.value))}
          className="w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white"
        >
          {memberships.map((m) => (
            <option key={m.businessId} value={m.businessId} className="text-slate-900">
              {m.businessName}
            </option>
          ))}
        </select>
      ) : null}
      <div className="flex items-center justify-between px-1">
        <div className="text-xs">
          <p className="font-medium text-slate-200">{userName}</p>
          <p className="text-slate-500">{role.toLowerCase().replace('_', ' ')}</p>
        </div>
        <button
          onClick={() => startTransition(() => logoutAction())}
          disabled={pending}
          className="text-xs font-medium text-slate-500 hover:text-teal-400"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
