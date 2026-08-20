'use client';

import { useTransition } from 'react';
import { setAccountArchivedAction } from '@/app/actions';

export function ArchiveToggle({ accountId, archived }: { accountId: string; archived: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => startTransition(() => setAccountArchivedAction(accountId, !archived))}
      disabled={pending}
      className="text-xs font-medium text-slate-400 hover:text-slate-700 disabled:opacity-50"
    >
      {archived ? 'Restore' : 'Archive'}
    </button>
  );
}
