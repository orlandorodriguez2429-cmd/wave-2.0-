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
