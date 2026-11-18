'use client';

import { useActionState, useRef, useState } from 'react';
import { dropStatementsAction } from '@/app/inbox-actions';
import { OpenClient } from '@/app/firm/open-client';

export function DropZone() {
  const [state, action, pending] = useActionState(dropStatementsAction, {});
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [hover, setHover] = useState(false);
  const [names, setNames] = useState<string[]>([]);

  const takeFiles = (list: FileList | null) => {
    if (!list || !input.current) return;
    const dt = new DataTransfer();
    for (const f of Array.from(list)) dt.items.add(f);
    input.current.files = dt.files;
    setNames(Array.from(list).map((f) => f.name));
  };

  return (
    <div className="space-y-5">
      <form ref={form} action={action}>
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setHover(true);
          }}
          onDragLeave={() => setHover(false)}
          onDrop={(e) => {
            e.preventDefault();
            setHover(false);
            takeFiles(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center cursor-pointer transition ${
            hover ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-white hover:border-teal-400'
          }`}
        >
          <span className="text-4xl">📄</span>
          <span className="text-base font-medium">Drop bank statements here</span>
          <span className="text-sm text-slate-500">PDFs downloaded from online banking · any clients, any months · up to 40 at a time</span>
          <input
            ref={input}
            type="file"
            name="files"
            multiple
            accept=".pdf,application/pdf"
            className="sr-only"
            onChange={(e) => setNames(Array.from(e.target.files ?? []).map((f) => f.name))}
          />
        </label>
        {names.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-600">{names.length} file{names.length === 1 ? '' : 's'}: {names.slice(0, 4).join(', ')}{names.length > 4 ? '…' : ''}</span>
            <button disabled={pending} className="rounded-md bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
              {pending ? 'Working… reading, filing, sorting' : 'Process statements'}
            </button>
          </div>
        )}
      </form>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      {state.results && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-medium">Results</h2>
            <span className="text-sm text-slate-500">
              {state.results.filter((r) => r.ok).length} filed · {state.results.filter((r) => !r.ok).length} need attention
            </span>
          </div>
          <ul className="divide-y divide-slate-50">
            {state.results.map((r, i) => (
              <li key={i} className="px-5 py-3 text-sm space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{r.ok ? '✅' : '⚠️'} {r.fileName}</span>
                  {r.ok && r.businessId && <OpenClient businessId={r.businessId} />}
                </div>
                {r.ok ? (
                  <>
                    <p className="text-slate-600">
                      → <strong>{r.businessName}</strong>
                      {r.createdClient && <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-700">new client</span>} · {r.account}
                      {r.createdAccount && !r.createdClient && <span className="ml-1 rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-700">new account</span>} · {r.period}
                    </p>
                    <p className="text-slate-600">
                      {r.imported} imported{r.duplicates ? `, ${r.duplicates} already on file` : ''} · {r.autoSorted} sorted automatically ·{' '}
                      {r.toReview ? <span className="text-amber-700">{r.toReview} for you to review</span> : 'nothing to review'}
                    </p>
                    {r.closedMonths && r.closedMonths.length > 0 && (
                      <p className="text-green-700">Closed: {r.closedMonths.join(', ')}</p>
                    )}
                    {r.notClosedBecause && <p className="text-slate-500">Not closed yet — {r.notClosedBecause}</p>}
                    {!!r.inClosedMonth && (
                      <p className="text-amber-700">
                        {r.inClosedMonth} line(s) fall in a month that was already closed. Reopen that month on the client&apos;s Months page to post them.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-red-700">{r.error}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
