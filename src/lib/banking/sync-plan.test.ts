// Sync planning rules against Plaid-format fixtures (no database).
import { describe, expect, it } from 'vitest';
import { planSync, rowKey, type ExistingRow, type RowStatus } from './sync-plan';
import { FIXTURES, ACCOUNT_IDS, toSyncPage } from './__fixtures__/fixture-provider';

const links = new Map([
  [ACCOUNT_IDS.checking, 'link-chk'],
  [ACCOUNT_IDS.savings, 'link-sav'],
  [ACCOUNT_IDS.credit, 'link-cc'],
  // loan deliberately not linked
]);

function existingFrom(rows: Array<Omit<ExistingRow, 'id'> & { id?: string }>) {
  return new Map(rows.map((r) => [rowKey(r.linkId, r.externalId), { id: r.id ?? `row-${r.externalId}`, ...r }]));
}

describe('initial sync (two pages)', () => {
  const plan = planSync({ links, existing: new Map(), pages: [toSyncPage(FIXTURES.page1), toSyncPage(FIXTURES.page2)] });

  it('inserts posted transactions only, from imported account types only', () => {
    expect(plan.inserts.map((i) => i.txn.externalId).sort()).toEqual(
      ['txn_deposit', 'txn_intrst', 'txn_sparkfun', 'txn_tectra', 'txn_uber_1', 'txn_united'].sort(),
    );
    expect(plan.stats.skippedPending).toBe(1); // McDonald's pending
    expect(plan.stats.skippedUnknownAccount).toBe(1); // loan payment
  });
  it('routes each transaction to its own account link', () => {
    const byId = new Map(plan.inserts.map((i) => [i.txn.externalId, i.linkId]));
    expect(byId.get('txn_sparkfun')).toBe('link-cc');
    expect(byId.get('txn_intrst')).toBe('link-sav');
    expect(byId.get('txn_tectra')).toBe('link-chk');
  });
  it('has nothing to update, delete or flag', () => {
    expect([plan.updates, plan.deletes, plan.flags]).toEqual([[], [], []]);
  });
});

describe('later sync: modified / removed', () => {
  const row = (externalId: string, linkId: string, status: RowStatus, date: string, description: string, amount: bigint) => ({
    externalId, linkId, status, date, description, amount,
  });
  const existing = existingFrom([
    row('txn_uber_1', 'link-chk', 'PENDING', '2026-10-01', 'Uber 063015 SF**POOL**', -540n),
    row('txn_tectra', 'link-chk', 'CATEGORIZED', '2026-10-02', 'Tectra Inc', -50000n),
    row('txn_united', 'link-chk', 'MATCHED', '2026-10-03', 'United Airlines', -50000n),
    row('txn_sparkfun', 'link-cc', 'EXCLUDED', '2026-10-05', 'SparkFun', -8940n),
    row('txn_deposit', 'link-chk', 'CATEGORIZED', '2026-10-07', 'CD DEPOSIT .INITIAL.', 100000n),
  ]);
  const plan = planSync({ links, existing, pages: [toSyncPage(FIXTURES.update)] });

  it('imports the posted version of a formerly pending transaction', () => {
    expect(plan.inserts.map((i) => i.txn.externalId)).toEqual(['txn_mcd_posted']);
    expect(plan.inserts[0].txn.amount).toBe(-1250n);
  });
  it('updates an unposted row in place', () => {
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ id: 'row-txn_uber_1', txn: { amount: -610n } });
  });
  it('flags a posted row whose amount changed, with the new values, and never updates it', () => {
    const flag = plan.flags.find((f) => f.id === 'row-txn_tectra');
    expect(flag).toEqual({
      id: 'row-txn_tectra',
      reason: 'PROVIDER_MODIFIED',
      change: { date: '2026-10-02', description: 'Tectra Inc', amount: '-52500' },
    });
    expect(plan.updates.some((u) => u.id === 'row-txn_tectra')).toBe(false);
  });
  it('ignores description-only changes on posted rows', () => {
    expect(plan.flags.some((f) => f.id === 'row-txn_united')).toBe(false);
    expect(plan.updates.some((u) => u.id === 'row-txn_united')).toBe(false);
  });
  it('deletes an unposted removed row and flags a posted removed row', () => {
    expect(plan.deletes).toEqual(['row-txn_sparkfun']);
    expect(plan.flags.find((f) => f.id === 'row-txn_deposit')).toEqual({
      id: 'row-txn_deposit',
      reason: 'PROVIDER_REMOVED',
      change: null,
    });
  });
  it('treats removal of a never-imported pending id as a no-op', () => {
    expect(plan.stats).toMatchObject({ added: 1, updated: 1, deleted: 1, flagged: 2 });
  });
});

describe('events within one run collapse', () => {
  it('added then removed in a later page → nothing inserted', () => {
    const add = toSyncPage(FIXTURES.page1);
    const remove = { added: [], modified: [], removed: [{ externalId: 'txn_tectra', externalAccountId: ACCOUNT_IDS.checking }], nextCursor: 'x', hasMore: false };
    const plan = planSync({ links, existing: new Map(), pages: [{ ...add, hasMore: true }, remove] });
    expect(plan.inserts.some((i) => i.txn.externalId === 'txn_tectra')).toBe(false);
    expect(plan.deletes).toEqual([]);
  });
  it('added then modified → inserted with the modified values', () => {
    const add = toSyncPage(FIXTURES.page1);
    const mod = { ...toSyncPage(FIXTURES.update), added: [], removed: [] };
    const plan = planSync({ links, existing: new Map(), pages: [add, mod] });
    expect(plan.inserts.find((i) => i.txn.externalId === 'txn_tectra')?.txn.amount).toBe(-52500n);
    expect(plan.updates).toEqual([]);
  });
  it('re-delivered identical added rows are deduped', () => {
    const page = toSyncPage(FIXTURES.page2);
    const plan = planSync({ links, existing: new Map(), pages: [page, page] });
    expect(plan.inserts).toHaveLength(3);
  });
});
