import { NextRequest, NextResponse } from 'next/server';
import { getClientContext } from '@/lib/context';
import { parsePeriod, portalPnl } from '@/lib/client-portal';
import { formatAmount } from '@/lib/money';
import { renderPnlPdf } from '@/lib/pdf/pnl-pdf';

export const dynamic = 'force-dynamic';

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

export async function GET(req: NextRequest) {
  const { business } = await getClientContext();
  const sp = req.nextUrl.searchParams;
  const period = parsePeriod(sp.get('period') ?? undefined, sp.get('value') ?? undefined);
  const pnl = await portalPnl(business.id, period.from, period.to);
  const cur = business.functionalCurrency;
  const basis = business.accountingBasis === 'CASH' ? 'Cash' : 'Accrual';
  const file = `profit-loss-${period.value}`;

  if (sp.get('format') === 'pdf') {
    const pdf = await renderPnlPdf({ businessName: business.name, periodLabel: period.label, basis, currency: cur, pnl });
    return new NextResponse(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${file}.pdf"` },
    });
  }
  const rows: string[][] = [['Section', 'Account', `Amount (${cur})`]];
  for (const s of [pnl.income, pnl.cogs, pnl.expenses]) {
    for (const r of s.rows) rows.push([s.title, r.name, formatAmount(r.amount, cur)]);
    rows.push([`Total ${s.title}`, '', formatAmount(s.total, cur)]);
  }
  rows.push(['Net Income', '', formatAmount(pnl.netIncome, cur)]);
  return new NextResponse(rows.map((r) => r.map(csvCell).join(',')).join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}.csv"` },
  });
}
