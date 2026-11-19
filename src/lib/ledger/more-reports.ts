import { prisma } from '@/lib/db';
import type { PnlSection } from './reports';

// Phase 6 reports: cash flow, sales tax, aged receivables. Like the core
// reports these are derived from posted entries (or open invoices) at query
// time — nothing stored, everything in functional-currency minor units.

// ---------------------------------------------------------------------------
// Cash flow (classified by counterpart accounts)
// ---------------------------------------------------------------------------

export interface CashFlowReport {
  openingCash: bigint;
  closingCash: bigint;
  operating: bigint;
  investing: bigint;
  financing: bigint;
  netChange: bigint;
  /** Rows for drill-down: per entry cash delta + classification. */
  rows: Array<{ entryId: string; entryNumber: number | null; date: string; memo: string; delta: bigint; bucket: string }>;
}

function classify(counterparts: Array<{ type: string; subtype: string | null }>): 'operating' | 'investing' | 'financing' {
  // Dominant counterpart wins; ties resolve conservatively to operating.
  let investing = 0;
  let financing = 0;
  let operating = 0;
  for (const c of counterparts) {
    if (c.subtype === 'fixed_asset' || c.subtype === 'contra_asset' || c.subtype === 'inventory') investing++;
    else if (c.type === 'EQUITY' || c.subtype === 'long_term_liability') financing++;
    else operating++;
  }
  if (investing > operating && investing >= financing) return 'investing';
  if (financing > operating && financing > investing) return 'financing';
  return 'operating';
}

export async function cashFlow(businessId: string, opts: { from: Date; to: Date }): Promise<CashFlowReport> {
  const cashAccounts = await prisma.account.findMany({
    where: { businessId, subtype: 'cash_and_bank' },
    select: { id: true },
  });
  const cashIds = new Set(cashAccounts.map((a) => a.id));

  const balanceAsOf = async (to: Date): Promise<bigint> => {
    if (cashIds.size === 0) return 0n;
    const rows = await prisma.journalLine.findMany({
      where: {
        accountId: { in: [...cashIds] },
        entry: { businessId, status: 'POSTED', date: { lte: to } },
      },
      select: { direction: true, functionalAmount: true },
    });
    return rows.reduce((s, l) => s + (l.direction === 'DEBIT' ? l.functionalAmount : -l.functionalAmount), 0n);
  };

  const dayBefore = new Date(opts.from.getTime() - 86400_000);
  const openingCash = await balanceAsOf(dayBefore);

  const entries = await prisma.journalEntry.findMany({
    where: {
      businessId,
      status: 'POSTED',
      date: { gte: opts.from, lte: opts.to },
      lines: { some: { accountId: { in: [...cashIds] } } },
    },
    include: { lines: { include: { account: { select: { type: true, subtype: true } } } } },
    orderBy: [{ date: 'asc' }, { entryNumber: 'asc' }],
  });

  let operating = 0n;
  let investing = 0n;
  let financing = 0n;
  const rows: CashFlowReport['rows'] = [];
  for (const entry of entries) {
    const delta = entry.lines
      .filter((l) => cashIds.has(l.accountId))
      .reduce((s, l) => s + (l.direction === 'DEBIT' ? l.functionalAmount : -l.functionalAmount), 0n);
    if (delta === 0n) continue;
    const bucket = classify(entry.lines.filter((l) => !cashIds.has(l.accountId)).map((l) => l.account));
    if (bucket === 'operating') operating += delta;
    else if (bucket === 'investing') investing += delta;
    else financing += delta;
    rows.push({
      entryId: entry.id,
      entryNumber: entry.entryNumber,
      date: entry.date.toISOString().slice(0, 10),
      memo: entry.memo,
      delta,
      bucket,
    });
  }

  const netChange = operating + investing + financing;
  return { openingCash, closingCash: openingCash + netChange, operating, investing, financing, netChange, rows };
}

// ---------------------------------------------------------------------------
// Sales tax
// ---------------------------------------------------------------------------

export interface SalesTaxReport {
  byRate: Array<{ taxRateId: string; name: string; jurisdiction: string | null; taxable: bigint; collected: bigint }>;
  totalCollected: bigint;
}

/** Tax collected via approved (non-void) invoices in the period, by rate/jurisdiction. */
export async function salesTaxReport(businessId: string, opts: { from: Date; to: Date }): Promise<SalesTaxReport> {
  const lines = await prisma.invoiceLine.findMany({
    where: {
      taxRateId: { not: null },
      invoice: {
        businessId,
        status: { in: ['OPEN', 'PAID'] },
        issueDate: { gte: opts.from, lte: opts.to },
      },
    },
    include: { taxRate: true },
  });
  const byRate = new Map<string, { taxRateId: string; name: string; jurisdiction: string | null; taxable: bigint; collected: bigint }>();
  for (const line of lines) {
    if (!line.taxRate) continue;
    let row = byRate.get(line.taxRate.id);
    if (!row) {
      row = { taxRateId: line.taxRate.id, name: line.taxRate.name, jurisdiction: line.taxRate.jurisdiction, taxable: 0n, collected: 0n };
      byRate.set(line.taxRate.id, row);
    }
    row.taxable += line.amount;
    row.collected += line.taxAmount;
  }
  const rows = [...byRate.values()].sort((a, b) => (b.collected > a.collected ? 1 : -1));
  return { byRate: rows, totalCollected: rows.reduce((s, r) => s + r.collected, 0n) };
}

// ---------------------------------------------------------------------------
// Aged receivables
// ---------------------------------------------------------------------------

export interface AgedRow {
  invoiceId: string;
  number: number;
  customerName: string;
  dueDate: string;
  balance: bigint;
  bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+';
}

export async function agedReceivables(businessId: string, asOf: Date) {
  const invoices = await prisma.invoice.findMany({
    where: { businessId, status: 'OPEN' },
    include: { customer: true, payments: true },
  });
  const rows: AgedRow[] = [];
  for (const inv of invoices) {
    const balance = inv.total - inv.payments.reduce((s, p) => s + p.amount, 0n);
    if (balance <= 0n) continue;
    const daysOver = Math.floor((asOf.getTime() - inv.dueDate.getTime()) / 86400_000);
    const bucket = daysOver <= 0 ? 'current' : daysOver <= 30 ? '1-30' : daysOver <= 60 ? '31-60' : daysOver <= 90 ? '61-90' : '90+';
    rows.push({
      invoiceId: inv.id,
      number: inv.number,
      customerName: inv.customer.name,
      dueDate: inv.dueDate.toISOString().slice(0, 10),
      balance,
      bucket,
    });
  }
  const buckets = { current: 0n, '1-30': 0n, '31-60': 0n, '61-90': 0n, '90+': 0n };
  for (const r of rows) buckets[r.bucket] += r.balance;
  const total = rows.reduce((s, r) => s + r.balance, 0n);
  return { rows: rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate)), buckets, total };
}

// ---------------------------------------------------------------------------
// Cash-basis Profit & Loss
// ---------------------------------------------------------------------------
//
// The ledger itself is accrual (invoices/bills post revenue/expense at
// approval, not at cash movement), so a true cash-basis view can't just
// re-filter posted entries — it has to re-derive recognition from the
// source documents: a customer payment allocates back across the invoice's
// income lines (plus any late fee charged), and a bill payment allocates
// back across the bill's expense lines. Standalone Expenses are already a
// cash event at entry time, so they count on both bases identically.

function accrueByAccount(map: Map<string, bigint>, accountId: string, amount: bigint) {
  map.set(accountId, (map.get(accountId) ?? 0n) + amount);
}

export async function cashBasisProfitAndLoss(businessId: string, opts: { from: Date; to: Date }) {
  const accounts = await prisma.account.findMany({ where: { businessId } });
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const lateFeeAccountId = accounts.find((a) => a.subtype === 'late_fee_income')?.id;

  const perAccount = new Map<string, bigint>();

  const payments = await prisma.payment.findMany({
    where: { businessId, date: { gte: opts.from, lte: opts.to } },
    include: {
      invoice: {
        include: { lines: true, lateFeeCharges: true },
      },
    },
  });
  for (const payment of payments) {
    const invoice = payment.invoice;
    if (invoice.total === 0n) continue;
    const parts: Array<{ accountId: string; amount: bigint }> = [
      ...invoice.lines.map((l) => ({ accountId: l.incomeAccountId, amount: l.amount })),
      ...(lateFeeAccountId
        ? invoice.lateFeeCharges.map((f) => ({ accountId: lateFeeAccountId, amount: f.amount }))
        : []),
    ];
    for (const part of parts) {
      const allocated = (payment.amount * part.amount) / invoice.total;
      accrueByAccount(perAccount, part.accountId, allocated);
    }
  }

  const billPayments = await prisma.billPayment.findMany({
    where: { businessId, date: { gte: opts.from, lte: opts.to } },
    include: { bill: { include: { lines: true } } },
  });
  for (const payment of billPayments) {
    const bill = payment.bill;
    if (bill.total === 0n) continue;
    for (const line of bill.lines) {
      const allocated = (payment.amount * line.amount) / bill.total;
      accrueByAccount(perAccount, line.expenseAccountId, -allocated);
    }
  }

  const expenseLines = await prisma.expenseLine.findMany({
    where: { expense: { businessId, date: { gte: opts.from, lte: opts.to } } },
  });
  for (const line of expenseLines) {
    accrueByAccount(perAccount, line.expenseAccountId, -line.amount);
  }

  const section = (filter: (accountId: string) => boolean, title: string): PnlSection => {
    const rows = [...perAccount.entries()]
      .filter(([id]) => filter(id))
      .map(([id, amount]) => {
        const a = accountById.get(id)!;
        return { accountId: id, code: a.code, name: a.name, amount: a.type === 'INCOME' ? amount : -amount };
      })
      .filter((r) => r.amount !== 0n)
      .sort((a, b) => a.code.localeCompare(b.code));
    return { title, rows, total: rows.reduce((s, r) => s + r.amount, 0n) };
  };

  const income = section((id) => accountById.get(id)?.type === 'INCOME', 'Income');
  const cogs = section((id) => accountById.get(id)?.subtype === 'cogs', 'Cost of Goods Sold');
  const expenses = section(
    (id) => accountById.get(id)?.type === 'EXPENSE' && accountById.get(id)?.subtype !== 'cogs',
    'Operating Expenses',
  );

  const grossProfit = income.total - cogs.total;
  const netIncome = grossProfit - expenses.total;
  return { income, cogs, expenses, grossProfit, netIncome };
}

// ---------------------------------------------------------------------------
// Aged payables
// ---------------------------------------------------------------------------

export interface AgedPayableRow {
  billId: string;
  number: number;
  vendorName: string;
  dueDate: string;
  balance: bigint;
  bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+';
}

export async function agedPayables(businessId: string, asOf: Date) {
  const bills = await prisma.bill.findMany({
    where: { businessId, status: 'OPEN' },
    include: { vendor: true, payments: true },
  });
  const rows: AgedPayableRow[] = [];
  for (const bill of bills) {
    const balance = bill.total - bill.payments.reduce((s, p) => s + p.amount, 0n);
    if (balance <= 0n) continue;
    const daysOver = Math.floor((asOf.getTime() - bill.dueDate.getTime()) / 86400_000);
    const bucket = daysOver <= 0 ? 'current' : daysOver <= 30 ? '1-30' : daysOver <= 60 ? '31-60' : daysOver <= 90 ? '61-90' : '90+';
    rows.push({
      billId: bill.id,
      number: bill.number,
      vendorName: bill.vendor.name,
      dueDate: bill.dueDate.toISOString().slice(0, 10),
      balance,
      bucket,
    });
  }
  const buckets = { current: 0n, '1-30': 0n, '31-60': 0n, '61-90': 0n, '90+': 0n };
  for (const r of rows) buckets[r.bucket] += r.balance;
  const total = rows.reduce((s, r) => s + r.balance, 0n);
  return { rows: rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate)), buckets, total };
}
