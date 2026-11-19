import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { encryptSecret } from '@/lib/crypto';
import { createBusiness } from '@/lib/ledger/business';
import { createAndPostEntry, reverseEntry } from '@/lib/ledger/post';
import { deleteBusiness } from './retention';

afterAll(async () => prisma.$disconnect());

async function setup() {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const owner = (await prisma.user.create({ data: { email: `ret-${tag}@t.local`, name: 'O' } })).id;
  const biz = await createBusiness({ userId: owner, name: `Delete Me ${tag}` });
  const acct = async (c: string) => (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId: biz.id, code: c } } })).id;
  const [chk, sales] = [await acct('1010'), await acct('4000')];
  const e = await createAndPostEntry({ businessId: biz.id, userId: owner, input: { date: new Date('2026-09-01'), memo: 'sale', currency: 'USD', exchangeRate: '1', lines: [
    { accountId: chk, direction: 'DEBIT', amount: 1000n }, { accountId: sales, direction: 'CREDIT', amount: 1000n }] } });
  await reverseEntry({ businessId: biz.id, userId: owner, entryId: e.id });
  const conn = await prisma.bankConnection.create({
    data: { businessId: biz.id, provider: 'plaid', institutionName: 'B', itemId: `item-${tag}`, accessTokenEncrypted: encryptSecret('access-sandbox-xyz'),
      accounts: { create: { businessId: biz.id, externalAccountId: 'a', name: 'Chk', currency: 'USD', ledgerAccountId: chk } } },
    include: { accounts: true },
  });
  await prisma.importedTransaction.create({ data: { businessId: biz.id, bankAccountLinkId: conn.accounts[0].id, externalId: 't', date: new Date('2026-09-01'), description: 'x', amount: 1000n } });
  return { owner, biz };
}

describe('deleteBusiness', () => {
  it('only an owner, only with the exact name', async () => {
    const { owner, biz } = await setup();
    await expect(deleteBusiness({ businessId: biz.id, userId: owner, confirmName: 'nope', removePlaidItem: async () => {} })).rejects.toThrow(/exactly/);
    const acct = (await prisma.user.create({ data: { email: `acc-${Date.now()}@t.local`, name: 'A' } })).id;
    await prisma.membership.create({ data: { userId: acct, businessId: biz.id, role: 'ACCOUNTANT' } });
    await expect(deleteBusiness({ businessId: biz.id, userId: acct, confirmName: biz.name, removePlaidItem: async () => {} })).rejects.toThrow(/owner/);
  });

  it('if Plaid removal fails, nothing is deleted', async () => {
    const { owner, biz } = await setup();
    await expect(deleteBusiness({ businessId: biz.id, userId: owner, confirmName: biz.name, removePlaidItem: async () => { throw new Error('plaid down'); } })).rejects.toThrow('plaid down');
    expect(await prisma.business.findUnique({ where: { id: biz.id } })).not.toBeNull();
  });

  it('removes Plaid items, deletes everything (posted ledger included), keeps a record', async () => {
    const { owner, biz } = await setup();
    const removed = vi.fn(async () => {});
    const r = await deleteBusiness({ businessId: biz.id, userId: owner, confirmName: biz.name, removePlaidItem: removed });
    expect(removed).toHaveBeenCalledWith('access-sandbox-xyz');
    expect(r.plaidItemsRemoved).toBe(1);
    expect(await prisma.business.findUnique({ where: { id: biz.id } })).toBeNull();
    expect(await prisma.journalEntry.count({ where: { businessId: biz.id } })).toBe(0);
    expect(await prisma.importedTransaction.count({ where: { businessId: biz.id } })).toBe(0);
    const rec = await prisma.deletionRecord.findFirstOrThrow({ where: { businessId: biz.id } });
    expect(rec.summary).toMatchObject({ journalEntries: 2, importedTransactions: 1, bankConnections: 1 });
  });

  it('outside that routine, posted entries still cannot be deleted or edited', async () => {
    const { biz } = await setup();
    const e = await prisma.journalEntry.findFirstOrThrow({ where: { businessId: biz.id, status: 'POSTED' } });
    await expect(prisma.journalEntry.delete({ where: { id: e.id } })).rejects.toThrow(/immutable/);
    await expect(prisma.journalEntry.update({ where: { id: e.id }, data: { memo: 'edited' } })).rejects.toThrow(/immutable/);
  });
});
