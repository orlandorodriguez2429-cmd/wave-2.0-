// Per-adapter call counts for the Data page. Kept in memory until the Supabase
// project is connected; the adapter_usage table in the migration is where this
// moves so counts survive restarts and paid calls can be budgeted.

interface Usage {
  calls: number;
  lastCallAt: string | null;
}

const usage = new Map<string, Usage>();

export function recordCall(adapterId: string): void {
  const u = usage.get(adapterId) ?? { calls: 0, lastCallAt: null };
  u.calls += 1;
  u.lastCallAt = new Date().toISOString();
  usage.set(adapterId, u);
}

export function getUsage(adapterId: string): Usage {
  return usage.get(adapterId) ?? { calls: 0, lastCallAt: null };
}
