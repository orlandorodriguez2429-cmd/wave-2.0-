// Read-only data for the client portal. Every function takes the business id
// from getClientContext() — never from the URL.
import { prisma } from '@/lib/db';
import { profitAndLoss } from '@/lib/ledger/reports';
import { cashBasisProfitAndLoss } from '@/lib/ledger/more-reports';

export type PeriodKind = 'month' | 'quarter' | 'year';

export interface Period {
  kind: PeriodKind;
  /** "2026-09", "2026-Q3", "2026" */
  value: string;
  from: Date;
  to: Date;
  label: string;
}

export function parsePeriod(kindRaw: string | undefined, valueRaw: string | undefined, today = new Date()): Period {
  const kind: PeriodKind = kindRaw === 'quarter' || kindRaw === 'year' ? kindRaw : 'month';
  const y = today.getUTCFullYear();
  const mo = today.getUTCMonth();
  if (kind === 'year') {
    const year = /^\d{4}$/.test(valueRaw ?? '') ? Number(valueRaw) : y;
    return { kind, value: String(year), from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year, 11, 31)), label: `Year ${year}` };
  }
  if (kind === 'quarter') {
    const m = /^(\d{4})-Q([1-4])$/.exec(valueRaw ?? '');
    const year = m ? Number(m[1]) : y;
    const q = m ? Number(m[2]) : Math.floor(mo / 3) + 1;
    return {
      kind,
      value: `${year}-Q${q}`,
      from: new Date(Date.UTC(year, (q - 1) * 3, 1)),
      to: new Date(Date.UTC(year, q * 3, 0)),
      label: `Q${q} ${year}`,
    };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(valueRaw ?? '');
  const year = m ? Number(m[1]) : y;
  const month = m ? Number(m[2]) - 1 : mo;
  const from = new Date(Date.UTC(year, month, 1));
  return {
    kind,
    value: from.toISOString().slice(0, 7),
    from,
    to: new Date(Date.UTC(year, month + 1, 0)),
    label: from.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

/** P&L on the business's own basis (cash or accrual). */
export async function portalPnl(businessId: string, from: Date, to: Date) {
  const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { accountingBasis: true } });
  return b.accountingBasis === 'CASH' ? cashBasisProfitAndLoss(businessId, { from, to }) : profitAndLoss(businessId, { from, to });
}

export async function portalDashboard(businessId: string, today = new Date()) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const months = Array.from({ length: 12 }, (_, i) => {
    const from = new Date(Date.UTC(y, m - 11 + i, 1));
    return { from, to: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)), label: from.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) };
  });
  const [thisMonth, ytd, trend] = await Promise.all([
    portalPnl(businessId, months[11].from, months[11].to),
    portalPnl(businessId, new Date(Date.UTC(y, 0, 1)), today),
    Promise.all(months.map((mm) => portalPnl(businessId, mm.from, mm.to))),
  ]);
  const expenses = (p: typeof ytd) => p.cogs.total + p.expenses.total;
  const topExpenses = [...ytd.cogs.rows, ...ytd.expenses.rows].sort((a, b) => (b.amount > a.amount ? 1 : -1)).slice(0, 6);
  return {
    thisMonth: { income: thisMonth.income.total, expenses: expenses(thisMonth), net: thisMonth.netIncome, label: months[11].label },
    ytd: { income: ytd.income.total, expenses: expenses(ytd), net: ytd.netIncome },
    trend: months.map((mm, i) => ({ label: mm.label, income: trend[i].income.total, expenses: expenses(trend[i]), net: trend[i].netIncome })),
    topExpenses,
  };
}
