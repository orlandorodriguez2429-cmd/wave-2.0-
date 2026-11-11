import PDFDocument from 'pdfkit';
import { formatMoney } from '@/lib/money';
import type { profitAndLoss } from '@/lib/ledger/reports';

type Pnl = Awaited<ReturnType<typeof profitAndLoss>>;

/** Profit & Loss statement as a PDF buffer. */
export async function renderPnlPdf(opts: { businessName: string; periodLabel: string; basis: string; currency: string; pnl: Pnl }): Promise<Buffer> {
  const { pnl, currency } = opts;
  const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.fontSize(18).font('Helvetica-Bold').text(opts.businessName);
  doc.fontSize(13).font('Helvetica').text('Profit & Loss');
  doc.fontSize(10).fillColor('#555555').text(`${opts.periodLabel} · ${opts.basis} basis`).fillColor('#000000');
  doc.moveDown(1);

  const left = 54;
  const right = 558;
  const row = (label: string, amount: string, bold = false, indent = 0) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
    doc.text(label, left + indent, y, { width: 360 });
    doc.text(amount, right - 150, y, { width: 150, align: 'right' });
    doc.moveDown(0.3);
  };
  const line = () => {
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.3);
  };

  for (const section of [pnl.income, pnl.cogs, pnl.expenses]) {
    if (section.rows.length === 0 && section !== pnl.income) continue;
    row(section.title, '', true);
    for (const r of section.rows) row(`${r.code}  ${r.name}`, formatMoney(r.amount, currency), false, 12);
    line();
    row(`Total ${section.title}`, formatMoney(section.total, currency), true);
    doc.moveDown(0.6);
    if (section === pnl.cogs && section.rows.length) {
      row('Gross Profit', formatMoney(pnl.grossProfit, currency), true);
      doc.moveDown(0.6);
    }
  }
  line();
  row('Net Income', formatMoney(pnl.netIncome, currency), true);

  doc.moveDown(2);
  doc.fontSize(8).fillColor('#888888').text(`Generated ${new Date().toISOString().slice(0, 10)} by Your Tax Solution Books.`);
  doc.end();
  return done;
}
