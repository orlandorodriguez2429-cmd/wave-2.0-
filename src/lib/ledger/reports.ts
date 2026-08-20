import { prisma } from '@/lib/db';
import type { AccountType } from '@/generated/prisma/enums';
import { signedBalance } from './validate';

// All reports aggregate POSTED entries only, in functional-currency minor
// units. Raw grouped queries keep this fast — sums run in Postgres, not JS.

export interface AccountBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  debits: bigint;
  credits: bigint;
}

async function accountTotals(
  businessId: string,
  opts: { from?: Date; to?: Date } = {},
): Promise<AccountBalanceRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      accountId: string;
      code: string;
      name: string;
      type: AccountType;
      subtype: string | null;
      debits: bigint | string | null;
      credits: bigint | string | null;
    }>
  >`
    SELECT a.id AS "accountId", a.code, a.name, a.type::text AS type, a.subtype,
           (sum(l."functionalAmount") FILTER (WHERE l.direction = 'DEBIT'))::bigint  AS debits,
           (sum(l."functionalAmount") FILTER (WHERE l.direction = 'CREDIT'))::bigint AS credits
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l."entryId"
      JOIN accounts a        ON a.id = l."accountId"
     WHERE e."businessId" = ${businessId}
       AND e.status = 'POSTED'
       AND (${opts.from?.toISOString().slice(0, 10) ?? null}::date IS NULL OR e.date >= ${opts.from?.toISOString().slice(0, 10) ?? null}::date)
       AND (${opts.to?.toISOString().slice(0, 10) ?? null}::date IS NULL OR e.date <= ${opts.to?.toISOString().slice(0, 10) ?? null}::date)
     GROUP BY a.id, a.code, a.name, a.type, a.subtype
     ORDER BY a.code
  `;
  // int8 aggregates can surface as bigint or string depending on the driver
  // path; normalize to bigint.
  return rows.map((r) => ({
    ...r,
    debits: r.debits == null ? 0n : BigInt(r.debits),
    credits: r.credits == null ? 0n : BigInt(r.credits),
  }));
}

// ---------------------------------------------------------------------------
// Trial balance
// ---------------------------------------------------------------------------

export interface TrialBalanceRow extends AccountBalanceRow {
  /** Net debit balance (positive) or 0. */
  debitBalance: bigint;
  /** Net credit balance (positive) or 0. */
  creditBalance: bigint;
}

export async function trialBalance(businessId: string, opts: { from?: Date; to?: Date } = {}) {
  const totals = await accountTotals(businessId, opts);
  const rows: TrialBalanceRow[] = totals.map((row) => {
    const net = row.debits - row.credits;
    return {
      ...row,
      debitBalance: net > 0n ? net : 0n,
      creditBalance: net < 0n ? -net : 0n,
    };
  });
  const totalDebits = rows.reduce((s, r) => s + r.debitBalance, 0n);
  const totalCredits = rows.reduce((s, r) => s + r.creditBalance, 0n);
  return { rows, totalDebits, totalCredits };
}

// ---------------------------------------------------------------------------
// Profit & Loss
// ---------------------------------------------------------------------------

export interface PnlSection {
  title: string;
  rows: Array<{ accountId: string; code: string; name: string; amount: bigint }>;
  total: bigint;
}

export async function profitAndLoss(businessId: string, opts: { from: Date; to: Date }) {
  const totals = await accountTotals(businessId, opts);

  const section = (filter: (r: AccountBalanceRow) => boolean, title: string): PnlSection => {
    const rows = totals
      .filter(filter)
      .map((r) => ({
        accountId: r.accountId,
        code: r.code,
        name: r.name,
        amount: signedBalance(r.type, r.debits, r.credits),
      }))
      .filter((r) => r.amount !== 0n);
    return { title, rows, total: rows.reduce((s, r) => s + r.amount, 0n) };
  };

  const income = section((r) => r.type === 'INCOME', 'Income');
  const cogs = section((r) => r.type === 'EXPENSE' && r.subtype === 'cogs', 'Cost of Goods Sold');
  const expenses = section(
    (r) => r.type === 'EXPENSE' && r.subtype !== 'cogs',
    'Operating Expenses',
  );

  const grossProfit = income.total - cogs.total;
  const netIncome = grossProfit - expenses.total;
  return { income, cogs, expenses, grossProfit, netIncome };
}

// ---------------------------------------------------------------------------
// Balance sheet
// ---------------------------------------------------------------------------

export interface BalanceSheetSection {
  title: string;
  rows: Array<{ accountId: string; code: string; name: string; amount: bigint }>;
  total: bigint;
}

/**
 * Balance sheet as of a date. Net income for the period up to `asOf` (i.e.
 * income minus expenses over all time — Phase 1 has no period-close yet) is
 * presented inside equity as "Current Year Earnings" so the statement always
 * balances: Assets = Liabilities + Equity.
 */
export async function balanceSheet(businessId: string, asOf: Date) {
  const totals = await accountTotals(businessId, { to: asOf });

  const section = (type: AccountType, title: string): BalanceSheetSection => {
    const rows = totals
      .filter((r) => r.type === type)
      .map((r) => ({
        accountId: r.accountId,
        code: r.code,
        name: r.name,
        amount: signedBalance(r.type, r.debits, r.credits),
      }))
      .filter((r) => r.amount !== 0n);
    return { title, rows, total: rows.reduce((s, r) => s + r.amount, 0n) };
  };

  const assets = section('ASSET', 'Assets');
  const liabilities = section('LIABILITY', 'Liabilities');
  const equity = section('EQUITY', 'Equity');

  const netIncomeToDate = totals
    .filter((r) => r.type === 'INCOME' || r.type === 'EXPENSE')
    .reduce((s, r) => s + signedBalance(r.type, r.debits, r.credits) * (r.type === 'INCOME' ? 1n : -1n), 0n);

  const equityTotal = equity.total + netIncomeToDate;
  return {
    assets,
    liabilities,
    equity,
    netIncomeToDate,
    equityTotal,
    liabilitiesAndEquity: liabilities.total + equityTotal,
    balances: assets.total === liabilities.total + equityTotal,
  };
}
