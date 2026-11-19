// Statement upload: CSV parsing, balance check, dedupe, auto-categorization.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { importStatement, parseStatementCsv, readCsv } from './statement';

let businessId: string;
let userId: string;

const CSV = `Date,Description,Amount
09/02/2026,"OPENING DEPOSIT, CLIENT",1500.00
09/03/2026,AWS EMEA aws.amazon.com,-187.42
09/05/2026,ZELLE TO JOHN SMITH,-200.00
09/05/2026,ZELLE TO JOHN SMITH,-200.00
`;

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: `stmt-${Date.now()}-${Math.random().toString(36).slice(2)}@t.local`, name: 'S' } })).id;
  businessId = (await createBusiness({ userId, name: 'Statement Co' })).id;
});
afterAll(async () => prisma.$disconnect());

describe('parsing', () => {
  it('reads quoted CSV and debit/credit columns', () => {
    expect(readCsv('a,"b, c","d ""e"""\n1,2,3')).toEqual([['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
    const rows = parseStatementCsv('Posted Date,Payee,Debit,Credit\n2026-09-01,RENT,"1,200.00",\n2026-09-02,DEPOSIT,,(50.00)\n', 'USD');
    expect(rows.map((r) => r.amount)).toEqual([-120000n, 5000n]);
  });
  it('explains missing columns', () => {
    expect(() => parseStatementCsv('Foo,Bar\n1,2\n', 'USD')).toThrow(/Date, Description/);
  });
});

describe('importStatement', () => {
  let linkId: string;

  it('refuses a statement whose balances do not add up, importing nothing', async () => {
    await expect(
      importStatement({ businessId, userId, fileName: 'sep.csv', csvText: CSV, openingBalance: '1000.00', closingBalance: '2000.00', newAccount: { name: 'Local CU Checking', kind: 'depository' } }),
    ).rejects.toThrow(/Balance check failed.*off by/);
    expect(await prisma.importedTransaction.count({ where: { businessId } })).toBe(0);
  });

  it('imports a balanced statement into a new account and auto-sorts it', async () => {
    const r = await importStatement({
      businessId, userId, fileName: 'sep.csv', csvText: CSV, openingBalance: '1000.00', closingBalance: '1912.58',
      newAccount: { name: 'Local CU Checking', kind: 'depository' }, // AI off in tests (no key)
    });
    expect(r).toMatchObject({ imported: 4, duplicates: 0 });
    const rows = await prisma.importedTransaction.findMany({ where: { businessId }, orderBy: { date: 'asc' } });
    linkId = rows[0].bankAccountLinkId;
    expect(rows.find((t) => t.description.startsWith('AWS'))?.categorizedBy).toBe('MERCHANT');
    const conn = await prisma.bankConnection.findFirstOrThrow({ where: { businessId } });
    expect(conn.provider).toBe('upload');
  });

  it('re-uploading or overlapping statements never double-counts', async () => {
    const r = await importStatement({ businessId, userId, fileName: 'sep-again.csv', csvText: CSV, openingBalance: '1000.00', closingBalance: '1912.58', linkId });
    expect(r).toMatchObject({ imported: 0, duplicates: 4 });
    const more = CSV + '09/05/2026,ZELLE TO JOHN SMITH,-200.00\n';
    const r2 = await importStatement({ businessId, userId, fileName: 'sep-v2.csv', csvText: more, openingBalance: '1000.00', closingBalance: '1712.58', linkId });
    expect(r2).toMatchObject({ imported: 1, duplicates: 4 }); // only the third identical Zelle is new
    expect(await prisma.importedTransaction.count({ where: { businessId } })).toBe(5);
  });
});

describe('PDF statements', () => {
  const makePdf = async (ending: string) => {
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Uint8Array>((r) => doc.on('end', () => r(new Uint8Array(Buffer.concat(chunks)))));
    const row = (y: number, cells: Array<[number, string]>) => cells.forEach(([x, s]) => doc.fontSize(10).text(s, x, y, { lineBreak: false }));
    row(40, [[40, 'Statement Period 10/01/2026 - 10/31/2026']]);
    row(60, [[40, 'Beginning Balance'], [460, '$500.00']]);
    row(80, [[40, 'Deposits']]);
    row(95, [[40, '10/02'], [90, 'SQUARE INC DEPOSIT 100226'], [460, '2,318.00']]);
    row(115, [[40, 'Withdrawals']]);
    row(130, [[40, '10/08'], [90, 'GOOGLE *WORKSPACE'], [460, '14.00']]);
    row(150, [[40, 'Ending Balance'], [460, ending]]);
    doc.end();
    return done;
  };

  it('imports with the balances printed on the PDF', async () => {
    const r = await importStatement({
      businessId, userId, fileName: 'oct.pdf', pdf: await makePdf('$2,804.00'), openingBalance: '', closingBalance: '',
      newAccount: { name: 'Savings Bank Checking', kind: 'depository' },
    });
    expect(r).toMatchObject({ imported: 2, duplicates: 0 });
    const up = await prisma.statementUpload.findUniqueOrThrow({ where: { id: r.uploadId } });
    expect([up.openingBalance, up.closingBalance]).toEqual([50000n, 280400n]);
  });

  it('a PDF whose lines do not add up to its printed ending balance imports nothing', async () => {
    const before = await prisma.importedTransaction.count({ where: { businessId } });
    await expect(
      importStatement({ businessId, userId, fileName: 'bad.pdf', pdf: await makePdf('$2,900.00'), openingBalance: '', closingBalance: '', newAccount: { name: 'X', kind: 'depository' } }),
    ).rejects.toThrow(/Balance check failed/);
    expect(await prisma.importedTransaction.count({ where: { businessId } })).toBe(before);
  });
});
