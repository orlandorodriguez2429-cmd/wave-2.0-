// Test-only provider that replays Plaid /transactions/sync responses from
// fixtures, keyed by the cursor they answer ("" = first call). Goes through
// the real Plaid → internal mapping (mapPlaidTransaction), so fixtures
// exercise the same code path as live data.
import type { TransactionsSyncResponse } from 'plaid/legacy';
import { mapPlaidRemoved, mapPlaidTransaction } from '../plaid';
import type { BankFeedProvider, SyncPage } from '../provider';

import page1 from './plaid/sync-initial-page1.json';
import page2 from './plaid/sync-initial-page2.json';
import update from './plaid/sync-update.json';

export const FIXTURES = {
  page1: page1 as unknown as TransactionsSyncResponse,
  page2: page2 as unknown as TransactionsSyncResponse,
  update: update as unknown as TransactionsSyncResponse,
};

export function toSyncPage(r: TransactionsSyncResponse): SyncPage {
  return {
    added: r.added.map(mapPlaidTransaction),
    modified: r.modified.map(mapPlaidTransaction),
    removed: r.removed.map(mapPlaidRemoved),
    nextCursor: r.next_cursor,
    hasMore: r.has_more,
  };
}

/** Responses by the cursor they answer. "" answers the very first call. */
export class FixtureProvider implements BankFeedProvider {
  readonly name = 'plaid';
  calls: Array<string | null> = [];
  constructor(
    private byCursor: Record<string, TransactionsSyncResponse | (() => never)>,
  ) {}
  async syncPage(_token: string | null, cursor: string | null): Promise<SyncPage> {
    this.calls.push(cursor);
    const r = this.byCursor[cursor ?? ''];
    if (!r) return { added: [], modified: [], removed: [], nextCursor: cursor ?? '', hasMore: false };
    if (typeof r === 'function') return r();
    return toSyncPage(r);
  }
}

export const ACCOUNT_IDS = {
  checking: page1.accounts[0].account_id,
  savings: page1.accounts[1].account_id,
  credit: page1.accounts[2].account_id,
  loan: page1.accounts[3].account_id,
};
