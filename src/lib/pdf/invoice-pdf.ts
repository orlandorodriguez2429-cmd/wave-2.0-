import PDFDocument from 'pdfkit';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { formatQuantity } from '@/lib/invoicing/totals';

/** Render an invoice as a PDF buffer (server-side, pdfkit). */
export async function renderInvoicePdf(invoiceId: string): Promise<Buffer> {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      business: true,
      customer: true,
      lines: { orderBy: { lineNo: 'asc' } },
      payments: { orderBy: { date: 'asc' } },
    },
  });
  const cur = invoice.currency;
  const paid = invoice.payments.reduce((s, p) => s + p.amount, 0n);

  const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Header
  doc.fontSize(20).font('Helvetica-Bold').text(invoice.business.name);
  doc.moveDown(0.2);
  doc.fontSize(10).font('Helvetica').fillColor('#555555');
  if (invoice.business.legalName) doc.text(invoice.business.legalName);
  doc.fillColor('#000000');

  doc.fontSize(24).font('Helvetica-Bold').text(`INVOICE #${invoice.number}`, 54, 54, { align: 'right' });
  doc
    .fontSize(10)
    .font('Helvetica')
    .text(`Issued: ${invoice.issueDate.toISOString().slice(0, 10)}`, { align: 'right' })
    .text(`Due: ${invoice.dueDate.toISOString().slice(0, 10)}`, { align: 'right' })
    .text(`Status: ${invoice.status}`, { align: 'right' });

  // Bill to
  doc.moveDown(2);
  const billToY = 150;
  doc.fontSize(9).fillColor('#888888').text('BILL TO', 54, billToY);
  doc.fontSize(11).fillColor('#000000').font('Helvetica-Bold').text(invoice.customer.name, 54);
  doc.font('Helvetica').fontSize(10);
  if (invoice.customer.address) doc.text(invoice.customer.address);
  if (invoice.customer.email) doc.text(invoice.customer.email);

  // Lines table
  let y = 240;
  const col = { desc: 54, qty: 330, price: 390, amount: 480 };
  doc.fontSize(9).fillColor('#888888');
  doc.text('DESCRIPTION', col.desc, y);
  doc.text('QTY', col.qty, y, { width: 50, align: 'right' });
  doc.text('PRICE', col.price, y, { width: 70, align: 'right' });
  doc.text('AMOUNT', col.amount, y, { width: 78, align: 'right' });
  y += 14;
  doc.moveTo(54, y).lineTo(558, y).strokeColor('#cccccc').stroke();
  y += 8;

  doc.fillColor('#000000').fontSize(10);
  for (const line of invoice.lines) {
    doc.text(line.description, col.desc, y, { width: 260 });
    doc.text(formatQuantity(line.quantityMilli), col.qty, y, { width: 50, align: 'right' });
    doc.text(formatMoney(line.unitPrice, cur), col.price, y, { width: 70, align: 'right' });
    doc.text(formatMoney(line.amount, cur), col.amount, y, { width: 78, align: 'right' });
    y += Math.max(doc.heightOfString(line.description, { width: 260 }), 14) + 6;
  }

  y += 6;
  doc.moveTo(330, y).lineTo(558, y).strokeColor('#cccccc').stroke();
  y += 10;
  const totalRow = (label: string, value: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10);
    doc.text(label, 330, y, { width: 140, align: 'right' });
    doc.text(value, col.amount, y, { width: 78, align: 'right' });
    y += bold ? 18 : 15;
  };
  totalRow('Subtotal', formatMoney(invoice.subtotal, cur));
  if (invoice.taxTotal > 0n) totalRow('Tax', formatMoney(invoice.taxTotal, cur));
  totalRow('Total', formatMoney(invoice.total, cur), true);
  if (paid > 0n) {
    totalRow('Paid', `-${formatMoney(paid, cur)}`);
    totalRow('Balance due', formatMoney(invoice.total - paid, cur), true);
  }

  if (invoice.memo || invoice.terms) {
    y += 16;
    if (invoice.memo) {
      doc.fontSize(9).fillColor('#888888').text('NOTES', 54, y);
      doc.fontSize(10).fillColor('#000000').text(invoice.memo, 54, y + 12, { width: 400 });
      y += 12 + doc.heightOfString(invoice.memo, { width: 400 }) + 10;
    }
    if (invoice.terms) {
      doc.fontSize(9).fillColor('#888888').text('TERMS', 54, y);
      doc.fontSize(10).fillColor('#000000').text(invoice.terms, 54, y + 12, { width: 400 });
    }
  }

  doc.end();
  return done;
}
