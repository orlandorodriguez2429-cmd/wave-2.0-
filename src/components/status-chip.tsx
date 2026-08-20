const STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  OPEN: 'bg-blue-50 text-blue-700',
  SENT: 'bg-blue-50 text-blue-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  OVERDUE: 'bg-red-100 text-red-700',
  PAID: 'bg-green-100 text-green-700',
  ACCEPTED: 'bg-green-100 text-green-700',
  DECLINED: 'bg-red-100 text-red-700',
  CONVERTED: 'bg-violet-100 text-violet-700',
  VOID: 'bg-slate-200 text-slate-500',
};

export function StatusChip({ status }: { status: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STYLES[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status.toLowerCase()}
    </span>
  );
}
