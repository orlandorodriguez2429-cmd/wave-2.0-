'use client';

import { useTransition } from 'react';
import { toggleChecklistItemAction } from '@/app/close-actions';

export function ChecklistItemToggle({
  closeId,
  itemKey,
  label,
  done,
  locked,
}: {
  closeId: string;
  itemKey: string;
  label: string;
  done: boolean;
  locked: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={done}
        disabled={locked || pending}
        onChange={() => startTransition(() => toggleChecklistItemAction(closeId, itemKey))}
      />
      <span className={done ? 'text-slate-400 line-through' : 'text-slate-700'}>{label}</span>
    </li>
  );
}
