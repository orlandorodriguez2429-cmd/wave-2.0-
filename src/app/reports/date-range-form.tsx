export function DateRangeForm({
  from,
  to,
  toOnly = false,
}: {
  from?: string;
  to: string;
  toOnly?: boolean;
}) {
  return (
    <form method="GET" className="flex items-end gap-3">
      {!toOnly && (
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">From</span>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </label>
      )}
      <label className="block">
        <span className="block text-xs font-medium text-slate-500 mb-1">{toOnly ? 'As of' : 'To'}</span>
        <input
          type="date"
          name="to"
          defaultValue={to}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </label>
      <button
        type="submit"
        className="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Run
      </button>
    </form>
  );
}
