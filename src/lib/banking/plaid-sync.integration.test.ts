// Plaid pipeline against real Postgres with recorded-format fixtures:
// connect (token exchange stubbed) → auto ledger accounts → paged initial
// sync → post some rows → bank-side modifications/removals → flags, never
// ledger edits. Plus restart, failure status, webhooks, remap, disconnect.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { decryptSecret } from '@/lib/crypto';
import { createBusiness } from '@/lib/ledger/business';
import { categorizeTransaction, excludeTransaction } from './categorize';
import { FixtureProvider, FIXTURES } from './__fixtures__/fixture-provider';
import accountsGet from './__fixtures__/plaid/accounts-get.json';
import { SyncRestartRequired } from './provider';
import { PlaidRequestError } from './plaid-client';

const ACCESS_TOKEN = 'access-sandbox-11111111-2222-3333-4444-555555555555';
const removeItem = vi.fn(async (token: string) => void token);

vi.mock('./plaid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./plaid')>();
  return {
    ...actual,
    exchangePublicToken: vi.fn(async () => ({
      accessToken: ACCESS_TOKEN,
      itemId: `${accountsGet.item.item_id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      institutionId: accountsGet.item.institution_id,
      institutionName: accountsGet.item.institution_name,
      accounts: accountsGet.accounts.map((a) => ({
        externalAccountId: a.account_id,
        name: a.name,
        mask: a.mask,
        currency: 'USD',
        type: a.type,
        subtype: a.subtype,
      })),
    })),
    removeItem: (token: string) => removeItem(token),
  };
});

// Imported after vi.mock so they see the stub.
const { connectPlaidItem, clearReviewFlag, disconnectConnection, markReconnected, remapAccountLink } = await import('./import');
const { syncConnection } = await import('./sync');
const { applyPlaidWebhook } = await import('./plaid-webhook');

let userId: string;
let businessId: string;
let connectionId: string;
let itemId: string;
let sales: string;
let travel: string;
let professional: string;

const txn = (externalId: string) =>
  prisma.importedTransaction.findFirstOrThrow({ where: { businessId, externalId } });

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `plaid-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'Plaid Tester' },
  });
  userId = user.id;
  businessId = (await createBusiness({ userId, name: 'Plaid Test Co' })).id;
  const byCode = async (code: string) =>
    (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code } } })).id;
  [sales, travel, professional] = await Promise.all(['4000', '6700', '6400'].map(byCode));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('connect', () => {
  it('stores the token encrypted and creates one ledger account per imported bank account', async () => {
    const { id } = await connectPlaidItem({ businessId, userId, publicToken: 'public-sandbox-abc' });
    connectionId = id;
    const c = await prisma.bankConnection.findUniqueOrThrow({ where: { id }, include: { accounts: true } });
    itemId = c.itemId!;
    expect(c.provider).toBe('plaid');
    expect(c.institutionName).toBe('First Platypus Bank');
    expect(c.accessTokenEncrypted).not.toContain(ACCESS_TOKEN);
    expect(decryptSecret(c.accessTokenEncrypted!)).toBe(ACCESS_TOKEN);

    // Loan account skipped; masks are last-4.
    expect(c.accounts.map((a) => a.subtype).sort()).toEqual(['checking', 'credit card', 'savings']);
    expect(c.accounts.every((a) => a.mask?.length === 4)).toBe(true);

    const ledger = await prisma.account.findMany({
      where: { id: { in: c.accounts.map((a) => a.ledgerAccountId) } },
      orderBy: { code: 'asc' },
    });
    expect(ledger.map((a) => [a.code, a.type, a.subtype])).toEqual([
      ['1011', 'ASSET', 'cash_and_bank'],
      ['1012', 'ASSET', 'cash_and_bank'],
      ['2101', 'LIABILITY', 'credit_card'],
    ]);
    expect(ledger[0].name).toBe('First Platypus Bank Plaid Checking ••0000');
  });

  it('never writes the access token into the audit log', async () => {
    const logs = await prisma.auditLog.findMany({ where: { businessId } });
    expect(JSON.stringify(logs)).not.toContain(ACCESS_TOKEN);
  });
});

describe('sync', () => {
  it('pages through the initial sync and saves the final cursor', async () => {
    const provider = new FixtureProvider({ '': FIXTURES.page1, 'cursor-1a': FIXTURES.page2 });
    const r = await syncConnection({ connectionId, businessId, userId, provider });
    expect(provider.calls).toEqual([null, 'cursor-1a']);
    expect(r).toMatchObject({ added: 6, skippedPending: 1, skippedUnknownAccount: 1 });
    const c = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(c.cursor).toBe('cursor-1b');
    expect(c.syncRequestedAt).toBeNull();
    expect(await prisma.importedTransaction.count({ where: { businessId } })).toBe(6);
    expect((await txn('txn_intrst')).amount).toBe(422n);
  });

  it('is idempotent: re-running from the saved cursor imports nothing', async () => {
    const provider = new FixtureProvider({ '': FIXTURES.page1, 'cursor-1a': FIXTURES.page2 });
    const r = await syncConnection({ connectionId, businessId, userId, provider });
    expect(provider.calls).toEqual(['cursor-1b']);
    expect(r.added).toBe(0);
    expect(await prisma.importedTransaction.count({ where: { businessId } })).toBe(6);
  });

  let tectraEntryLines: Array<{ amount: bigint }>;

  it('applies bank-side changes: unposted rows change, posted rows only get flagged', async () => {
    // Post three to the ledger, exclude one, leave Uber pending.
    for (const [id, account] of [
      ['txn_tectra', professional],
      ['txn_united', travel],
      ['txn_deposit', sales],
    ] as const) {
      await categorizeTransaction({ businessId, userId, transactionId: (await txn(id)).id, categoryAccountId: account });
    }
    await excludeTransaction({ businessId, userId, transactionId: (await txn('txn_sparkfun')).id });
    const tectraBefore = await txn('txn_tectra');
    tectraEntryLines = await prisma.journalLine.findMany({ where: { entryId: tectraBefore.journalEntryId! } });

    const r = await syncConnection({
      connectionId,
      businessId,
      userId: null,
      trigger: 'webhook',
      provider: new FixtureProvider({ 'cursor-1b': FIXTURES.update }),
    });
    expect(r).toMatchObject({ added: 1, updated: 1, deleted: 1, flagged: 2 });

    // Unposted Uber: amount updated in place.
    expect((await txn('txn_uber_1')).amount).toBe(-610n);
    // Pending McDonald's now imported as its posted version.
    expect((await txn('txn_mcd_posted')).amount).toBe(-1250n);
    // Excluded SparkFun removed by the bank: deleted.
    expect(await prisma.importedTransaction.count({ where: { businessId, externalId: 'txn_sparkfun' } })).toBe(0);

    // Posted Tectra: row and ledger untouched, flagged with the new amount.
    const tectra = await txn('txn_tectra');
    expect(tectra.amount).toBe(-50000n);
    expect(tectra.status).toBe('CATEGORIZED');
    expect(tectra.needsReview).toBe(true);
    expect(tectra.reviewReason).toBe('PROVIDER_MODIFIED');
    expect(tectra.providerChange).toEqual({ date: '2026-10-02', description: 'Tectra Inc', amount: '-52500' });
    const linesAfter = await prisma.journalLine.findMany({ where: { entryId: tectra.journalEntryId! } });
    expect(linesAfter.map((l) => l.amount)).toEqual(tectraEntryLines.map((l) => l.amount));

    // Posted deposit removed by the bank: kept, flagged.
    const deposit = await txn('txn_deposit');
    expect(deposit.status).toBe('CATEGORIZED');
    expect(deposit.reviewReason).toBe('PROVIDER_REMOVED');

    // Posted United, description-only change: left alone.
    const united = await txn('txn_united');
    expect(united.needsReview).toBe(false);
    expect(united.description).toBe('United Airlines');

    expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).cursor).toBe('cursor-2');
  });

  it('restarts from the saved cursor when the provider says data changed mid-pagination', async () => {
    let first = true;
    const calls: Array<string | null> = [];
    const provider = {
      name: 'plaid',
      calls,
      async syncPage(_token: string | null, cursor: string | null) {
        calls.push(cursor);
        if (first) {
          first = false;
          throw new SyncRestartRequired();
        }
        return { added: [], modified: [], removed: [], nextCursor: 'cursor-3', hasMore: false };
      },
    };
    await syncConnection({ connectionId, businessId, userId, provider });
    expect(provider.calls).toEqual(['cursor-2', 'cursor-2']);
    expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).cursor).toBe('cursor-3');
  });

  it('on a login error: no changes applied, cursor kept, connection needs reconnect', async () => {
    const provider = new FixtureProvider({
      'cursor-3': () => {
        throw new PlaidRequestError('transactions sync', 'ITEM_LOGIN_REQUIRED');
      },
    });
    await expect(syncConnection({ connectionId, businessId, userId: null, trigger: 'cron', provider })).rejects.toThrow(
      'ITEM_LOGIN_REQUIRED',
    );
    const c = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(c.status).toBe('NEEDS_RECONNECT');
    expect(c.errorCode).toBe('ITEM_LOGIN_REQUIRED');
    expect(c.cursor).toBe('cursor-3');
    const failed = await prisma.auditLog.findFirst({ where: { entityId: connectionId, action: 'bank_connection.sync_failed' } });
    expect(failed?.payload).toMatchObject({ trigger: 'cron', errorCode: 'ITEM_LOGIN_REQUIRED' });
  });

  it('a successful sync does not clear NEEDS_RECONNECT; reconnecting does', async () => {
    await syncConnection({ connectionId, businessId, userId, provider: new FixtureProvider({}) });
    expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).status).toBe('NEEDS_RECONNECT');
    await markReconnected({ businessId, userId, connectionId });
    const c = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(c.status).toBe('ACTIVE');
    expect(c.errorCode).toBeNull();
  });
});

describe('webhooks (already verified)', () => {
  it('SYNC_UPDATES_AVAILABLE requests a sync', async () => {
    const out = await applyPlaidWebhook({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: itemId });
    expect(out).toEqual({ action: 'sync', connectionId });
    const c = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(c.syncRequestedAt).not.toBeNull();
    expect(c.lastWebhookAt).not.toBeNull();
  });

  it.each([
    ['ERROR', { error_code: 'ITEM_LOGIN_REQUIRED' }, 'ITEM_LOGIN_REQUIRED'],
    ['PENDING_EXPIRATION', null, 'PENDING_EXPIRATION'],
    ['ITEM_LOGIN_REQUIRED', null, 'ITEM_LOGIN_REQUIRED'],
  ])('ITEM %s → needs reconnect', async (code, error, expected) => {
    const out = await applyPlaidWebhook({ webhook_type: 'ITEM', webhook_code: code, item_id: itemId, error });
    expect(out).toMatchObject({ action: 'status', status: 'NEEDS_RECONNECT' });
    const c = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(c.status).toBe('NEEDS_RECONNECT');
    expect(c.errorCode).toBe(expected);
  });

  it('LOGIN_REPAIRED → active again and syncs', async () => {
    const out = await applyPlaidWebhook({ webhook_type: 'ITEM', webhook_code: 'LOGIN_REPAIRED', item_id: itemId });
    expect(out.action).toBe('sync');
    expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).status).toBe('ACTIVE');
  });

  it('ignores unknown items', async () => {
    expect(await applyPlaidWebhook({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'nope' })).toEqual({
      action: 'ignored',
    });
  });
});

describe('review, remap, disconnect', () => {
  it('clears a review flag (audit-logged)', async () => {
    const t = await txn('txn_tectra');
    await clearReviewFlag({ businessId, userId, transactionId: t.id });
    const after = await txn('txn_tectra');
    expect([after.needsReview, after.reviewReason, after.providerChange]).toEqual([false, null, null]);
  });

  it('remaps an account with nothing posted, refuses one with posted rows', async () => {
    const links = await prisma.bankAccountLink.findMany({ where: { connectionId } });
    const checking = links.find((l) => l.subtype === 'checking')!;
    const savings = links.find((l) => l.subtype === 'savings')!;
    await expect(
      remapAccountLink({ businessId, userId, linkId: checking.id, ledgerAccountId: savings.ledgerAccountId }),
    ).rejects.toThrow(/already on the books/);
    await expect(remapAccountLink({ businessId, userId, linkId: savings.id, ledgerAccountId: sales })).rejects.toThrow(
      /Cash & Bank or Credit Card/,
    );
    await remapAccountLink({ businessId, userId, linkId: savings.id, ledgerAccountId: checking.ledgerAccountId });
  });

  it('disconnect removes the Plaid item, wipes the token and keeps history', async () => {
    const before = await prisma.importedTransaction.count({ where: { businessId } });
    await disconnectConnection({ businessId, userId, connectionId });
    expect(removeItem).toHaveBeenCalledWith(ACCESS_TOKEN);
    const c = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(c.status).toBe('REMOVED');
    expect(c.accessTokenEncrypted).toBeNull();
    expect(c.removedAt).not.toBeNull();
    expect(await prisma.importedTransaction.count({ where: { businessId } })).toBe(before);
    await expect(syncConnection({ connectionId, businessId, userId, provider: new FixtureProvider({}) })).rejects.toThrow(
      /disconnected/,
    );
    // Webhooks for a removed item are ignored.
    expect((await applyPlaidWebhook({ webhook_type: 'ITEM', webhook_code: 'ERROR', item_id: itemId })).action).toBe('ignored');
  });

  it('refuses to act on another business’s connection', async () => {
    const other = await createBusiness({ userId, name: 'Other Co' });
    await expect(syncConnection({ connectionId, businessId: other.id, userId })).rejects.toThrow(/Wrong business/);
    await expect(disconnectConnection({ businessId: other.id, userId, connectionId })).rejects.toThrow(/Wrong business/);
  });
});
