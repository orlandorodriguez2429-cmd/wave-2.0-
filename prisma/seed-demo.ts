// Demo clients for the local trial (never in production — see seed.ts).
// Drives the REAL pipeline: sync → automatic categorization → the accountant
// reviews August (teaching rules) → close August → sync Sep–Nov, where the
// learned rules do most of the work.
import { prisma } from '../src/lib/db';
import { createBusiness } from '../src/lib/ledger/business';
import { ensureTemplateAccount } from '../src/lib/ledger/accounts';
import { createFeedLedgerAccount, connectBank } from '../src/lib/banking/import';
import { syncConnection } from '../src/lib/banking/sync';
import { categorizeTransaction } from '../src/lib/banking/categorize';
import { DEMO_ACCOUNTS } from '../src/lib/banking/provider';
import { closeMonth } from '../src/lib/months';
import { recordVendorPayment } from '../src/lib/forms1099/tracking';

export async function seedDemoClients(ownerId: string) {
  if (await prisma.business.findFirst({ where: { name: 'Sunrise Cleaning LLC', memberships: { some: { userId: ownerId } } } })) {
    console.log('Seed: demo clients already exist.');
    return;
  }

  // --- Sunrise Cleaning LLC: the full month-to-month story -------------------
  const biz = await createBusiness({ userId: ownerId, name: 'Sunrise Cleaning LLC' });
  await prisma.business.update({
    where: { id: biz.id },
    data: { booksStartDate: new Date('2026-08-01'), businessType: 'residential cleaning service' },
  });
  const code = async (c: string) => (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId: biz.id, code: c } } })).id;
  const conn = await prisma.$transaction(async (tx) => {
    const links = [];
    for (const a of DEMO_ACCOUNTS) {
      const ledger = await createFeedLedgerAccount(tx, biz.id, 'USD', 'Chase', a);
      links.push({ businessId: biz.id, externalAccountId: a.externalAccountId, name: a.name, mask: a.mask, currency: a.currency, type: a.type, subtype: a.subtype, ledgerAccountId: ledger.id });
    }
    return tx.bankConnection.create({
      data: { businessId: biz.id, provider: 'demo', institutionName: 'Chase (demo feed)', createdById: ownerId, accounts: { create: links } },
    });
  });

  // August arrives; the pipeline sorts what it can.
  const aug = await syncConnection({ connectionId: conn.id, userId: null, trigger: 'connect', classifier: null });
  console.log('Seed: August imported', aug.auto);

  // The accountant reviews August's leftovers, teaching rules as they go.
  const pending = async (desc: string) =>
    prisma.importedTransaction.findFirstOrThrow({ where: { businessId: biz.id, status: 'PENDING', description: { startsWith: desc } } });
  const cat = async (desc: string, account: string, remember = true) =>
    categorizeTransaction({ businessId: biz.id, userId: ownerId, transactionId: (await pending(desc)).id, categoryAccountId: await code(account), rememberPayee: remember });
  await cat('MOBILE DEPOSIT HOMEOWNER', '4100'); // service revenue
  await cat('HOME DEPOT', '5000'); // cleaning supplies → cost of goods sold
  await cat('ZELLE TO MARIA GARCIA', '6900'); // contractor (1099)
  await cat('SHELL OIL', '6700', false);
  const interest = await ensureTemplateAccount(prisma, biz.id, '7100');
  await categorizeTransaction({
    businessId: biz.id, userId: ownerId, transactionId: (await pending('SBA LOAN PMT')).id,
    splits: [{ accountId: await code('2500'), amount: 47400n }, { accountId: interest.id, amount: 4600n }],
  });
  await closeMonth({ businessId: biz.id, userId: ownerId, month: '2026-08' });
  console.log('Seed: August reviewed and closed.');

  // September–November arrive; learned rules handle the repeats.
  const later = await syncConnection({ connectionId: conn.id, userId: null, trigger: 'webhook', classifier: null });
  console.log('Seed: Sep–Nov imported', later.auto);

  // Review September fully (so it's ready to close); leave October for the demo.
  for (const t of await prisma.importedTransaction.findMany({
    where: { businessId: biz.id, status: 'PENDING', date: { gte: new Date('2026-09-01'), lte: new Date('2026-09-30') } },
  })) {
    if (t.description.startsWith('SBA LOAN PMT')) {
      await categorizeTransaction({ businessId: biz.id, userId: ownerId, transactionId: t.id, splits: [{ accountId: await code('2500'), amount: 47600n }, { accountId: interest.id, amount: 4400n }] });
    } else if (t.description.startsWith('VERIZON')) {
      await categorizeTransaction({ businessId: biz.id, userId: ownerId, transactionId: t.id, categoryAccountId: await code('6800'), rememberPayee: true });
    }
  }

  // 1099 side: the Zelle contractor, no W-9 yet.
  const maria = await prisma.vendor.create({
    data: { businessId: biz.id, name: 'Maria Garcia', w9Status: 'REQUESTED', defaultBoxCode: 'NEC_1' },
  });
  for (const [date, amount] of [['2026-08-10', 60000n], ['2026-09-10', 75000n], ['2026-10-10', 90000n]] as const) {
    await recordVendorPayment({ businessId: biz.id, userId: ownerId, vendorId: maria.id, date: new Date(date), amount, method: 'ACH', memo: 'Zelle' });
  }

  // --- Bayside Auto Repair: bank login expired ----------------------------------------
  const bayside = await createBusiness({ userId: ownerId, name: 'Bayside Auto Repair' });
  const bChk = (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId: bayside.id, code: '1010' } } })).id;
  const bConn = await connectBank({ businessId: bayside.id, userId: ownerId, provider: 'mock', ledgerAccountId: bChk });
  await syncConnection({ connectionId: bConn.id, userId: null, classifier: null });
  await prisma.bankConnection.update({ where: { id: bConn.id }, data: { status: 'NEEDS_RECONNECT', errorCode: 'ITEM_LOGIN_REQUIRED' } });

  // --- Oak Street Bakery: not connected yet --------------------------------------------
  await createBusiness({ userId: ownerId, name: 'Oak Street Bakery' });
  console.log('Seed: demo clients created (Sunrise Cleaning, Bayside Auto Repair, Oak Street Bakery).');
}
