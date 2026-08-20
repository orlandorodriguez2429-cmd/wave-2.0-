import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/context';
import { balanceSheet, profitAndLoss, trialBalance } from '@/lib/ledger/reports';
import { agedReceivables, cashFlow, salesTaxReport } from '@/lib/ledger/more-reports';
import { formatAmount } from '@/lib/money';

// CSV export for every report: /reports/export/<report>?from=&to=
// Money renders as plain decimals in the business's functional currency.

function csv(rows: Array<Array<string | number>>): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell);
          return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ report: string }> }) {
  const { report } = await ctx.params;
  const { business } = await getCurrentContext();
  const cur = business.functionalCurrency;
  const fmt = (v: bigint) => formatAmount(v, cur);

  const sp = req.nextUrl.searchParams;
  const year = new Date().getUTCFullYear();
  const from = new Date(sp.get('from') || `${year}-01-01`);
  const to = new Date(sp.get('to') || new Date().toISOString().slice(0, 10));

  let rows: Array<Array<string | number>>;
  switch (report) {
    case 'trial-balance': {
      const tb = await trialBalance(business.id, { from: sp.get('from') ? from : undefined, to });
      rows = [
        ['Code', 'Account', 'Type', `Debit (${cur})`, `Credit (${cur})`],
        ...tb.rows.map((r) => [r.code, r.name, r.type, fmt(r.debitBalance), fmt(r.creditBalance)]),
        ['', 'TOTAL', '', fmt(tb.totalDebits), fmt(tb.totalCredits)],
      ];
      break;
    }
    case 'profit-loss': {
      const pnl = await profitAndLoss(business.id, { from, to });
      rows = [['Section', 'Code', 'Account', `Amount (${cur})`]];
      for (const section of [pnl.income, pnl.cogs, pnl.expenses]) {
        for (const r of section.rows) rows.push([section.title, r.code, r.name, fmt(r.amount)]);
        rows.push([`Total ${section.title}`, '', '', fmt(section.total)]);
      }
      rows.push(['Gross Profit', '', '', fmt(pnl.grossProfit)]);
      rows.push(['Net Income', '', '', fmt(pnl.netIncome)]);
      break;
    }
    case 'balance-sheet': {
      const bs = await balanceSheet(business.id, to);
      rows = [['Section', 'Code', 'Account', `Amount (${cur})`]];
      for (const section of [bs.assets, bs.liabilities, bs.equity]) {
        for (const r of section.rows) rows.push([section.title, r.code, r.name, fmt(r.amount)]);
      }
      rows.push(['Equity', '', 'Current Year Earnings', fmt(bs.netIncomeToDate)]);
      rows.push(['Total Assets', '', '', fmt(bs.assets.total)]);
      rows.push(['Total Liabilities + Equity', '', '', fmt(bs.liabilitiesAndEquity)]);
      break;
    }
    case 'cash-flow': {
      const cf = await cashFlow(business.id, { from, to });
      rows = [
        ['Line', `Amount (${cur})`],
        ['Opening cash', fmt(cf.openingCash)],
        ['Operating activities', fmt(cf.operating)],
        ['Investing activities', fmt(cf.investing)],
        ['Financing activities', fmt(cf.financing)],
        ['Net change', fmt(cf.netChange)],
        ['Closing cash', fmt(cf.closingCash)],
        [],
        ['Date', 'Entry', 'Memo', 'Bucket', `Delta (${cur})`],
        ...cf.rows.map((r) => [r.date, `JE-${r.entryNumber}`, r.memo, r.bucket, fmt(r.delta)]),
      ];
      break;
    }
    case 'sales-tax': {
      const st = await salesTaxReport(business.id, { from, to });
      rows = [
        ['Tax rate', 'Jurisdiction', `Taxable (${cur})`, `Collected (${cur})`],
        ...st.byRate.map((r) => [r.name, r.jurisdiction ?? '', fmt(r.taxable), fmt(r.collected)]),
        ['TOTAL', '', '', fmt(st.totalCollected)],
      ];
      break;
    }
    case 'aged-receivables': {
      const ar = await agedReceivables(business.id, to);
      rows = [
        ['Invoice', 'Customer', 'Due date', 'Bucket', `Balance (${cur})`],
        ...ar.rows.map((r) => [`#${r.number}`, r.customerName, r.dueDate, r.bucket, fmt(r.balance)]),
        ['TOTAL', '', '', '', fmt(ar.total)],
      ];
      break;
    }
    default:
      return new NextResponse('Unknown report', { status: 404 });
  }

  return new NextResponse(csv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${report}-${to.toISOString().slice(0, 10)}.csv"`,
    },
  });
}
