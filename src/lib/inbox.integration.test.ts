// Statement inbox end to end with generated PDF statements.
import PDFDocument from 'pdfkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { processInbox, processStatementFile } from './inbox';
import { readStatementInfo } from './banking/statement-info';

const TODAY = new Date('2026-11-18T12:00:00Z');
const tag = Math.random().toString(36).slice(2, 7).toUpperCase();
let userId: string;
let otherUserId: string;

type Line = [date: string, desc: string, amount: string];
function statement(opts: {
  bank: string;
  holder: string;
  mask: string;
  period: [string, string];
  opening: string;
  closing: string;
  deposits?: Line[];
  withdrawals?: Line[];
  card?: boolean;
}): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((r) => doc.on('end', () => r(new Uint8Array(Buffer.concat(chunks)))));
  let y = 40;
  const row = (cells: Array<[number, string]>) => {
    cells.forEach(([x, s]) => doc.fontSize(10).text(s, x, y, { lineBreak: false }));
    y += 16;
  };
  row([[40, opts.bank.toUpperCase()]]);
  row([[40, opts.holder]]);
  row([[40, `${opts.card ? 'Card' : 'Account'} ending in ${opts.mask}`], [330, `Statement Period ${opts.period[0]} - ${opts.period[1]}`]]);
  if (opts.card) row([[40, 'Payment Due Date 12/25/2026   Minimum Payment $25.00']]);
  y += 10;
  row([[40, opts.card ? 'Previous Balance' : 'Beginning Balance'], [470, opts.opening]]);
  if (opts.deposits?.length) {
    row([[40, opts.card ? 'Payments and Credits' : 'Deposits and Other Credits']]);
    for (const [d, s, a] of opts.deposits) row([[40, d], [90, s], [470, a]]);
  }
  if (opts.withdrawals?.length) {
    row([[40, opts.card ? 'Purchases' : 'Withdrawals and Other Debits']]);
    for (const [d, s, a] of opts.withdrawals) row([[40, d], [90, s], [470, a]]);
  }
  row([[40, opts.card ? 'New Balance' : 'Ending Balance'], [470, opts.closing]]);
  doc.end();
  return done;
}

const drop = (fileName: string, bytes: Uint8Array, who = userId) => processStatementFile({ userId: who, fileName, bytes, today: TODAY });

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: `inbox-${tag}@t.local`, name: 'Inbox' } })).id;
  otherUserId = (await prisma.user.create({ data: { email: `inbox-other-${tag}@t.local`, name: 'Other' } })).id;
});
afterAll(async () => prisma.$disconnect());

describe('readStatementInfo', () => {
  it('reads bank, holder, last 4, kind and period from header lines', () => {
    const info = readStatementInfo([
      'MAIN STREET COMMUNITY BANK',
      'OAK & IVY FLORIST LLC',
      'Account ending in 4410 Statement Period 09/01/2026 - 09/30/2026',
    ]);
    expect(info).toEqual({
      bankName: 'MAIN STREET COMMUNITY BANK',
      holderName: 'Oak & Ivy Florist LLC',
      mask: '4410',
      kind: 'depository',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    expect(readStatementInfo(['Chase', 'Card Member: ACME CORP', 'Account Number XXXX XXXX XXXX 3012', 'Minimum Payment Due']).kind).toBe('credit');
  });
});

describe('statement inbox', () => {
  const pine = `PINE TREE PLUMBING ${tag} LLC`;

  it('creates a new client from the statement, sorts it, and auto-closes a clean month', async () => {
    const r = await drop('pine-aug.pdf', await statement({
      bank: 'First Coastal Bank', holder: pine, mask: '5521', period: ['08/01/2026', '08/31/2026'],
      opening: '$2,000.00', closing: '$3,971.00',
      deposits: [['08/05', 'SQUARE INC DEPOSIT 080526', '2,500.00']],
      withdrawals: [['08/08', 'GOOGLE *WORKSPACE', '14.00'], ['08/15', 'GEICO AUTO PMT', '500.00'], ['08/31', 'MONTHLY MAINTENANCE FEE', '15.00']],
    }));
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ ok: true, createdClient: true, createdAccount: true, imported: 4, autoSorted: 4, toReview: 0, closedMonths: ['August 2026'] });
    const b = await prisma.business.findUniqueOrThrow({ where: { id: r.businessId! } });
    expect(b.name).toMatch(/^Pine Tree Plumbing [A-Za-z0-9]+ LLC$/);
    expect(b.booksStartDate?.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(b.booksClosedThrough?.toISOString().slice(0, 10)).toBe('2026-08-31');
    const log = await prisma.auditLog.findFirst({ where: { businessId: b.id, action: 'month.closed' } });
    expect(log?.payload).toMatchObject({ month: '2026-08', automatic: true });
  });

  it('files the next statement under the same account by its last 4 digits', async () => {
    const r = await drop('pine-sep.pdf', await statement({
      bank: 'First Coastal Bank', holder: pine, mask: '5521', period: ['09/01/2026', '09/30/2026'],
      opening: '$3,971.00', closing: '$3,671.00',
      withdrawals: [['09/12', 'ZELLE TO JOSE REYES', '300.00']],
    }));
    expect(r).toMatchObject({ ok: true, createdClient: false, createdAccount: false, imported: 1, toReview: 1, closedMonths: [] });
    expect(r.notClosedBecause).toMatch(/September 2026: 1 transaction\(s\) need your review/);
    expect(await prisma.business.count({ where: { name: { contains: `PLUMBING ${tag}`, mode: 'insensitive' } } })).toBe(1);
  });

  it('dropping the same statement twice imports nothing new', async () => {
    const bytes = await statement({
      bank: 'First Coastal Bank', holder: pine, mask: '5521', period: ['09/01/2026', '09/30/2026'],
      opening: '$3,971.00', closing: '$3,671.00',
      withdrawals: [['09/12', 'ZELLE TO JOSE REYES', '300.00']],
    });
    const r = await drop('pine-sep-again.pdf', bytes);
    expect(r).toMatchObject({ ok: true, imported: 0, duplicates: 1 });
  });

  it('waits for every account before closing a month', async () => {
    const holder = `MAPLE DENTAL ${tag} PLLC`;
    const chk = await drop('maple-chk-oct.pdf', await statement({
      bank: 'Harbor Bank', holder, mask: '1111', period: ['10/01/2026', '10/31/2026'],
      opening: '$1,000.00', closing: '$3,486.00',
      deposits: [['10/03', 'SQUARE INC DEPOSIT 100326', '2,500.00']], withdrawals: [['10/31', 'MONTHLY MAINTENANCE FEE', '14.00']],
    }));
    expect(chk.closedMonths).toEqual(['October 2026']); // only account so far

    // Checking and card for one client dropped together: nothing closes until
    // the card's statements cover the whole month too.
    const holder2 = `BIRCH YOGA ${tag} LLC`;
    const batch = await processInbox({
      userId,
      today: TODAY,
      files: [
        { fileName: 'birch-chk-sep.pdf', bytes: await statement({
          bank: 'Harbor Bank', holder: holder2, mask: '2222', period: ['09/01/2026', '09/30/2026'],
          opening: '$500.00', closing: '$486.00', withdrawals: [['09/30', 'MONTHLY MAINTENANCE FEE', '14.00']],
        }) },
        { fileName: 'birch-card-sep.pdf', bytes: await statement({
          bank: 'Harbor Bank', holder: holder2, mask: '3333', card: true, period: ['08/21/2026', '09/20/2026'],
          opening: '$0.00', closing: '$14.00', withdrawals: [['09/02', 'GOOGLE *WORKSPACE', '14.00']],
        }) },
      ],
    });
    expect(batch.map((r) => r.ok)).toEqual([true, true]);
    expect(batch[0].businessId).toBe(batch[1].businessId);
    expect(batch[1].closedMonths).toEqual([]);
    expect(batch[1].notClosedBecause).toMatch(/September 2026: waiting for the full month from: Harbor Bank Card 3333/);
    const [card2] = await processInbox({ userId, today: TODAY, files: [{ fileName: 'birch-card-oct.pdf', bytes: await statement({
      bank: 'Harbor Bank', holder: holder2, mask: '3333', card: true, period: ['09/21/2026', '10/20/2026'],
      opening: '$14.00', closing: '$28.00', withdrawals: [['10/02', 'GOOGLE *WORKSPACE', '14.00']],
    }) }] });
    expect(card2.closedMonths).toEqual(['September 2026']); // October still needs the checking statement
    expect(card2.notClosedBecause).toMatch(/October 2026: waiting for the full month from: Harbor Bank Checking 2222, Harbor Bank Card 3333/);
  });

  it('warns when a new account lands in a month that was already closed', async () => {
    const holder = `ELM BAKERY ${tag} LLC`;
    const first = await drop('elm-chk-aug.pdf', await statement({
      bank: 'Harbor Bank', holder, mask: '6060', period: ['08/01/2026', '08/31/2026'],
      opening: '$100.00', closing: '$86.00', withdrawals: [['08/31', 'MONTHLY MAINTENANCE FEE', '14.00']],
    }));
    expect(first.closedMonths).toEqual(['August 2026']);
    const late = await drop('elm-card-aug.pdf', await statement({
      bank: 'Harbor Bank', holder, mask: '7070', card: true, period: ['08/01/2026', '08/31/2026'],
      opening: '$0.00', closing: '$14.00', withdrawals: [['08/09', 'GOOGLE *WORKSPACE', '14.00']],
    }));
    expect(late).toMatchObject({ ok: true, inClosedMonth: 1 });
  });

  it('a card payment pairs with the card statement in the same drop (transfer, not P&L)', async () => {
    const holder = `CEDAR CREEK ${tag} LLC`;
    const res = await processInbox({ userId, today: TODAY, files: [
      { fileName: 'cedar-chk.pdf', bytes: await statement({
        bank: 'Harbor Bank', holder, mask: '8812', period: ['10/01/2026', '10/31/2026'], opening: '$5,000.00', closing: '$3,280.00',
        withdrawals: [['10/20', 'CHASE CREDIT CRD AUTOPAY', '1,720.00']],
      }) },
      { fileName: 'cedar-card.pdf', bytes: await statement({
        bank: 'Harbor Bank', holder, mask: '4027', card: true, period: ['10/01/2026', '10/31/2026'], opening: '$1,720.00', closing: '$0.00',
        deposits: [['10/21', 'PAYMENT THANK YOU', '1,720.00']],
      }) },
    ] });
    expect(res.map((r) => r.ok)).toEqual([true, true]);
    const rows = await prisma.importedTransaction.findMany({ where: { businessId: res[0].businessId } });
    expect(rows.map((r) => r.categorizedBy).sort()).toEqual(['TRANSFER', 'TRANSFER']);
    expect(res[0].toReview).toBe(0);
  });

  it('files by business name when the account is new', async () => {
    const existing = await createBusiness({ userId, name: `Sunny Side ${tag}, L.L.C.` });
    const r = await drop('sunny.pdf', await statement({
      bank: 'Harbor Bank', holder: `SUNNY SIDE ${tag} LLC`, mask: '9090', period: ['10/01/2026', '10/31/2026'],
      opening: '$100.00', closing: '$86.00', withdrawals: [['10/31', 'MONTHLY MAINTENANCE FEE', '14.00']],
    }));
    expect(r).toMatchObject({ ok: true, businessId: existing.id, createdClient: false, createdAccount: true });
  });

  it("never touches someone else's clients", async () => {
    const r = await drop('pine-as-other.pdf', await statement({
      bank: 'First Coastal Bank', holder: pine, mask: '5521', period: ['10/01/2026', '10/31/2026'],
      opening: '$3,671.00', closing: '$3,657.00', withdrawals: [['10/31', 'MONTHLY MAINTENANCE FEE', '14.00']],
    }), otherUserId);
    expect(r.ok).toBe(true);
    expect(r.createdClient).toBe(true); // a new client of their own, not the first user's
    const mine = await prisma.membership.findMany({ where: { userId: otherUserId } });
    expect(mine.map((m) => m.businessId)).toContain(r.businessId);
  });

  it('refuses bad files without creating anything', async () => {
    const before = await prisma.business.count();
    const bad = await drop('bad.pdf', await statement({
      bank: 'Harbor Bank', holder: `NEW CLIENT ${tag} LLC`, mask: '4444', period: ['10/01/2026', '10/31/2026'],
      opening: '$100.00', closing: '$999.00', withdrawals: [['10/31', 'MONTHLY MAINTENANCE FEE', '14.00']],
    }));
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Balance check failed/);
    expect((await drop('x.csv', new Uint8Array([1]))).error).toMatch(/Only PDF/);
    expect((await drop('x.pdf', new Uint8Array([1, 2, 3]))).error).toMatch(/could not be opened/);
    expect(await prisma.business.count()).toBe(before);
  });
});
