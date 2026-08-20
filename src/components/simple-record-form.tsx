'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/app/actions';

export interface FieldSpec {
  name: string;
  label: string;
  type?: 'text' | 'date' | 'select' | 'checkbox';
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  options?: Array<{ value: string; label: string }>;
  width?: string; // tailwind width class
}

/** Generic inline "add a record" form: renders fields in a row, posts to a server action. */
export function SimpleRecordForm({
  action,
  fields,
  submitLabel,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  fields: FieldSpec[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});
  return (
    <form action={formAction} className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        {fields.map((f) =>
          f.type === 'checkbox' ? (
            <label key={f.name} className="flex items-center gap-2 pb-2 text-sm text-slate-600">
              <input type="checkbox" name={f.name} /> {f.label}
            </label>
          ) : (
            <label key={f.name} className={`block ${f.width ?? ''}`}>
              <span className="block text-xs font-medium text-slate-500 mb-1">{f.label}</span>
              {f.type === 'select' ? (
                <select
                  name={f.name}
                  defaultValue={f.defaultValue}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white"
                >
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={f.name}
                  type={f.type ?? 'text'}
                  placeholder={f.placeholder}
                  required={f.required}
                  defaultValue={f.defaultValue}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              )}
            </label>
          ),
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
