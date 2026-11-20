'use client';

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded-md border border-slate-300 px-3 py-2 text-sm print:hidden">
      Print
    </button>
  );
}
