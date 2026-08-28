'use client';

import { useTransition } from 'react';
import { payCheckoutAction } from '@/app/checkouts-actions';

export function CheckoutPayButton({ token, amountLabel }: { token: string; amountLabel: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => startTransition(() => payCheckoutAction(token))}
      disabled={pending}
      className="w-full rounded-md bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
    >
      {pending ? 'Processing…' : `Pay ${amountLabel} now`}
    </button>
  );
}
