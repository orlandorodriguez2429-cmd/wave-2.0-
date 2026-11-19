// PDF statements in three common layouts, generated with pdfkit so the text
// really goes through PDF rendering + extraction.
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { parseStatementPdf } from './statement-pdf';

function pdf(draw: (doc: PDFKit.PDFDocument, row: (y: number, cells: Array<[number, string]>) => void) => void): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((r) => doc.on('end', () => r(new Uint8Array(Buffer.concat(chunks)))));
  doc.font('Helvetica').fontSize(10);
  const row = (y: number, cells: Array<[number, string]>) => cells.forEach(([x, s]) => doc.text(s, x, y, { lineBreak: false }));
  draw(doc, row);
  doc.end();
  return done;
}

describe('parseStatementPdf', () => {
  it('section layout: Deposits / Withdrawals / Checks, no running balance', async () => {
    const file = await pdf((doc, row) => {
      row(40, [[40, 'Community Credit Union'], [380, 'Statement Period 09/01/2026 - 09/30/2026']]);
      row(70, [[40, 'Beginning Balance'], [460, '$1,000.00']]);
      row(100, [[40, 'Deposits and Other Credits']]);
      row(120, [[40, '09/03'], [90, 'MOBILE DEPOSIT HOMEOWNER INV 1063'], [460, '385.00']]);
      row(135, [[40, '09/15'], [90, 'SQUARE INC DEPOSIT'], [460, '2,043.00']]);
      row(150, [[40, 'Total Deposits'], [460, '2,428.00']]);
      row(180, [[40, 'Withdrawals and Other Debits']]);
      row(200, [[40, '09/10'], [90, 'ZELLE TO MARIA GARCIA'], [460, '750.00']]);
      row(215, [[40, '09/30'], [90, 'MONTHLY MAINTENANCE FEE'], [460, '15.00']]);
      row(245, [[40, 'Checks Paid']]);
      row(265, [[40, '09/22'], [90, 'CHECK 1043'], [460, '120.50']]);
      row(300, [[40, 'Ending Balance'], [460, '$2,542.50']]);
    });
    const r = await parseStatementPdf(file, 'USD');
    expect(r.openingBalance).toBe(100000n);
    expect(r.closingBalance).toBe(254250n);
    expect(r.rows).toEqual([
      { date: '2026-09-03', description: 'MOBILE DEPOSIT HOMEOWNER INV 1063', amount: 38500n },
      { date: '2026-09-15', description: 'SQUARE INC DEPOSIT', amount: 204300n },
      { date: '2026-09-10', description: 'ZELLE TO MARIA GARCIA', amount: -75000n },
      { date: '2026-09-30', description: 'MONTHLY MAINTENANCE FEE', amount: -1500n },
      { date: '2026-09-22', description: 'CHECK 1043', amount: -12050n },
    ]);
    expect(r.openingBalance! + r.rows.reduce((s, x) => s + x.amount, 0n)).toBe(r.closingBalance);
  });

  it('running-balance layout: unsigned amounts, sign from the balance column', async () => {
    const file = await pdf((doc, row) => {
      row(40, [[40, 'Statement through December 31, 2026']]);
      row(70, [[40, 'Date'], [90, 'Description'], [380, 'Amount'], [470, 'Balance']]);
      row(85, [[40, '12/01'], [90, 'Previous balance'], [470, '500.00']]);
      row(100, [[40, '12/02'], [90, 'STRIPE PAYOUT'], [380, '1,200.00'], [470, '1,700.00']]);
      row(115, [[40, '12/05'], [90, 'GOOGLE *WORKSPACE'], [380, '14.00'], [470, '1,686.00']]);
      row(130, [[40, '12/09'], [90, 'OWNER DRAW'], [380, '600.00'], [470, '1,086.00']]);
    });
    const r = await parseStatementPdf(file, 'USD');
    expect(r.openingBalance).toBe(50000n);
    expect(r.rows.map((x) => [x.date, x.amount])).toEqual([
      ['2026-12-02', 120000n],
      ['2026-12-05', -1400n],
      ['2026-12-09', -60000n],
    ]);
  });

  it('signed amounts with full dates; a December line on a January statement gets last year', async () => {
    const file = await pdf((doc, row) => {
      row(40, [[40, 'Period 12/15/2026 to 01/14/2027']]);
      row(70, [[40, '12/28'], [90, 'AWS EMEA'], [460, '-187.42']]);
      row(85, [[40, '01/03'], [90, 'CLIENT ACH CREDIT'], [460, '900.00']]);
      row(100, [[40, '01/06/2027'], [90, 'GEICO AUTO PMT'], [460, '(189.00)']]);
      row(115, [[40, '01/09'], [90, '7-ELEVEN 33012'], [460, '-8.25']]);
    });
    const r = await parseStatementPdf(file, 'USD');
    expect(r.rows.map((x) => [x.date, x.amount])).toEqual([
      ['2026-12-28', -18742n],
      ['2027-01-03', 90000n],
      ['2027-01-06', -18900n],
      ['2027-01-09', -825n],
    ]);
  });

  it('refuses lines whose direction it cannot tell, and image-only PDFs', async () => {
    const ambiguous = await pdf((doc, row) => {
      row(40, [[40, 'Statement Period 09/01/2026 - 09/30/2026']]);
      row(70, [[40, '09/03'], [90, 'SOMETHING'], [460, '385.00']]);
    });
    await expect(parseStatementPdf(ambiguous, 'USD')).rejects.toThrow(/money in or out/);
    const empty = await pdf((doc) => doc.rect(40, 40, 200, 200).fill('#888'));
    await expect(parseStatementPdf(empty, 'USD')).rejects.toThrow(/scanned image/);
    await expect(parseStatementPdf(new Uint8Array([1, 2, 3]), 'USD')).rejects.toThrow(/could not be opened/);
  });
});
