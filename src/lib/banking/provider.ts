// Bank feed providers behind one cursor-based interface, modelled on Plaid's
// /transactions/sync: each call returns what was added, modified and removed
// since the cursor, plus the next cursor. "mock" ships a deterministic
// sandbox feed so the whole import/categorize/reconcile pipeline runs without
// credentials; "plaid" (src/lib/banking/plaid.ts) is the real adapter and is
// used whenever PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV are configured.

export interface ExternalBankAccount {
  externalAccountId: string;
  name: string;
  /** Last 4 digits only. */
  mask: string | null;
  currency: string;
  /** Provider account type, e.g. "depository" or "credit". */
  type: string | null;
  subtype: string | null;
}

export interface ExternalTransaction {
  externalId: string;
  externalAccountId: string;
  date: string; // YYYY-MM-DD (posted date)
  description: string;
  /** Signed minor units: negative = money out of the bank account. */
  amount: bigint;
  currency: string;
  /** Pending (not yet posted) transactions are never imported. */
  pending: boolean;
  merchantName?: string | null;
  providerCategory?: string | null;
}

export interface RemovedTransaction {
  externalId: string;
  externalAccountId: string;
}

export interface SyncPage {
  added: ExternalTransaction[];
  modified: ExternalTransaction[];
  removed: RemovedTransaction[];
  nextCursor: string;
  hasMore: boolean;
}

export interface BankFeedProvider {
  readonly name: string;
  /** One page of changes since `cursor` (null = from the beginning). */
  syncPage(accessToken: string | null, cursor: string | null): Promise<SyncPage>;
}

/**
 * Thrown by a provider when the data changed while we were paging; the sync
 * restarts from the last committed cursor (Plaid:
 * TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION).
 */
export class SyncRestartRequired extends Error {
  constructor() {
    super('Provider data changed during pagination; restart from the saved cursor.');
    this.name = 'SyncRestartRequired';
  }
}

// ---------------------------------------------------------------------------
// Mock provider — deterministic sandbox data. Cursor = number of batches
// already delivered ("0", "1", …). One batch per sync run, like before.
// ---------------------------------------------------------------------------

const MOCK_ACCOUNT = 'mock-checking-01';

function mock(externalId: string, date: string, description: string, amount: bigint): ExternalTransaction {
  return { externalId, externalAccountId: MOCK_ACCOUNT, date, description, amount, currency: 'USD', pending: false };
}

const BATCHES: ExternalTransaction[][] = [
  [
    mock('mock-001', '2026-05-01', 'STRIPE PAYOUT ST-9931', 412500n),
    mock('mock-002', '2026-05-02', 'AWS EMEA aws.amazon.com', -18742n),
    mock('mock-003', '2026-05-03', 'GITHUB INC', -2100n),
    mock('mock-004', '2026-05-05', 'OFFICE DEPOT #1123', -8433n),
    mock('mock-005', '2026-05-07', 'BLUEBIRD MEDIA ACH PMT', 429938n),
    mock('mock-006', '2026-05-08', 'WEWORK MAY RENT', -180000n),
    mock('mock-007', '2026-05-10', 'MAYA DESIGN CO INV 88', -90000n),
    mock('mock-008', '2026-05-12', 'DELTA AIR 0062341', -45620n),
  ],
  [
    mock('mock-009', '2026-05-15', 'STRIPE PAYOUT ST-9954', 267000n),
    mock('mock-010', '2026-05-16', 'AWS EMEA aws.amazon.com', -19105n),
    mock('mock-011', '2026-05-18', 'USPS PO 8837710031', -1560n),
  ],
];

export const MOCK_INSTITUTION = 'Sandbox Bank of Testing';
export const MOCK_ACCOUNTS: ExternalBankAccount[] = [
  { externalAccountId: MOCK_ACCOUNT, name: 'Business Checking', mask: '4321', currency: 'USD', type: 'depository', subtype: 'checking' },
];

export class MockBankProvider implements BankFeedProvider {
  readonly name = 'mock';

  async syncPage(_token: string | null, cursor: string | null): Promise<SyncPage> {
    const delivered = cursor ? Number(cursor) || 0 : 0;
    const batch = BATCHES[delivered];
    return {
      added: batch ?? [],
      modified: [],
      removed: [],
      nextCursor: String(batch ? delivered + 1 : delivered),
      hasMore: false,
    };
  }
}
