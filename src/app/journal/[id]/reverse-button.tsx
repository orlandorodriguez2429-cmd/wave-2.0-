'use client';

import { useState, useTransition } from 'react';
import { reverseEntryAction } from '@/app/actions';

export function ReverseButton({ entryId }: { entryId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Reverse entry…
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-slate-500">Post a reversing entry?</span>
      <button
        onClick={() => startTransition(() => reverseEntryAction(entryId))}
        disabled={pending}
        className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {pending ? 'Reversing…' : 'Confirm reverse'}
      </button>
      <button
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="rounded-md px-3 py-2 text-sm text-slate-500 hover:text-slate-700"
      >
        Cancel
      </button>
    </div>
  );
}
