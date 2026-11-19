'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { switchBusinessAction } from '@/app/auth-actions';

export function OpenClient({ businessId, to = '/' }: { businessId: string; to?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          await switchBusinessAction(businessId);
          router.push(to);
        })
      }
      className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
    >
      {pending ? '…' : 'Open'}
    </button>
  );
}
