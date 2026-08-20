'use client';

import { useTransition } from 'react';
import { portalPayAction } from '@/app/invoicing-actions';

export function PortalPayButton({ token, amountLabel }: { token: string; amountLabel: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => startTransition(() => portalPayAction(token))}
      disabled={pending}
      className="w-full rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
    >
      {pending ? 'Processing…' : `Pay ${amountLabel} now`}
    </button>
  );
}
