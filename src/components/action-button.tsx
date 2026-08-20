'use client';

import { useState, useTransition } from 'react';

/** Button bound to a zero-arg server action, with optional confirm step. */
export function ActionButton({
  action,
  label,
  confirmLabel,
  variant = 'secondary',
}: {
  action: () => Promise<void>;
  label: string;
  confirmLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cls =
    variant === 'primary'
      ? 'bg-blue-600 text-white hover:bg-blue-700'
      : variant === 'danger'
        ? 'bg-red-600 text-white hover:bg-red-700'
        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50';

  const run = () =>
    startTransition(async () => {
      try {
        setError(null);
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed.');
      }
    });

  if (confirmLabel && !confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className={`rounded-md px-4 py-2 text-sm font-medium ${cls}`}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={pending}
        className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${cls}`}
      >
        {pending ? '…' : confirmLabel && confirming ? confirmLabel : label}
      </button>
      {confirming && !pending && (
        <button onClick={() => setConfirming(false)} className="text-sm text-slate-500 hover:text-slate-700">
          Cancel
        </button>
      )}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </span>
  );
}
