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

// ---------------------------------------------------------------------------
// Demo provider — a realistic few months for a small cleaning company, for
// the local demo only (prisma/seed.ts). Checking + credit card. Two pages so
// the demo can show rules learned from August being applied in September.
// ---------------------------------------------------------------------------

const DEMO_CHK = 'demo-checking';
const DEMO_CC = 'demo-card';
const d = (id: string, acct: string, date: string, description: string, amount: bigint, merchantName?: string): ExternalTransaction => ({
  externalId: id, externalAccountId: acct, date, description, amount, currency: 'USD', pending: false, merchantName: merchantName ?? null,
});

export const DEMO_ACCOUNTS: ExternalBankAccount[] = [
  { externalAccountId: DEMO_CHK, name: 'Business Checking', mask: '7781', currency: 'USD', type: 'depository', subtype: 'checking' },
  { externalAccountId: DEMO_CC, name: 'Business Card', mask: '3012', currency: 'USD', type: 'credit', subtype: 'credit card' },
];

const DEMO_AUGUST: ExternalTransaction[] = [
  d('aug-01', DEMO_CHK, '2026-08-01', 'OWNER CONTRIBUTION', 500000n),
  d('aug-02', DEMO_CHK, '2026-08-03', 'MOBILE DEPOSIT HOMEOWNER INV 1041', 42000n),
  d('aug-03', DEMO_CHK, '2026-08-05', 'SQUARE INC DEPOSIT 080526', 186500n, 'Square'),
  d('aug-04', DEMO_CC, '2026-08-07', 'HOME DEPOT #4411 ATLANTA GA', -12873n, 'The Home Depot'),
  d('aug-05', DEMO_CC, '2026-08-08', 'GOOGLE *WORKSPACE', -1400n, 'Google Workspace'),
  d('aug-06', DEMO_CHK, '2026-08-10', 'ZELLE TO MARIA GARCIA 5521', -60000n),
  d('aug-07', DEMO_CC, '2026-08-12', 'SHELL OIL 57442', -6420n, 'Shell'),
  d('aug-08', DEMO_CHK, '2026-08-15', 'GEICO AUTO PMT', -18900n, 'GEICO'),
  d('aug-09', DEMO_CHK, '2026-08-20', 'CHASE CREDIT CRD AUTOPAY', -21000n),
  d('aug-10', DEMO_CC, '2026-08-21', 'PAYMENT THANK YOU', 21000n),
  d('aug-11', DEMO_CHK, '2026-08-25', 'CA DEPT OF TAX AND FEE ADMIN CDTFA', -9800n),
  d('aug-12', DEMO_CHK, '2026-08-28', 'SBA LOAN PMT 004419', -52000n),
  d('aug-13', DEMO_CHK, '2026-08-31', 'MONTHLY MAINTENANCE FEE', -1500n),
];

const DEMO_LATER: ExternalTransaction[] = [
  // September
  d('sep-01', DEMO_CHK, '2026-09-02', 'SQUARE INC DEPOSIT 090226', 204300n, 'Square'),
  d('sep-02', DEMO_CHK, '2026-09-04', 'MOBILE DEPOSIT HOMEOWNER INV 1063', 38500n),
  d('sep-03', DEMO_CC, '2026-09-06', 'HOME DEPOT #4411 ATLANTA GA', -9215n, 'The Home Depot'),
  d('sep-04', DEMO_CC, '2026-09-08', 'GOOGLE *WORKSPACE', -1400n, 'Google Workspace'),
  d('sep-05', DEMO_CHK, '2026-09-10', 'ZELLE TO MARIA GARCIA 5521', -75000n),
  d('sep-06', DEMO_CHK, '2026-09-12', 'VERIZON WIRELESS PMT', -8500n, 'Verizon'),
  d('sep-07', DEMO_CHK, '2026-09-15', 'GEICO AUTO PMT', -18900n, 'GEICO'),
  d('sep-08', DEMO_CHK, '2026-09-18', 'OWNER DRAW', -150000n),
  d('sep-09', DEMO_CHK, '2026-09-20', 'CHASE CREDIT CRD AUTOPAY', -10615n),
  d('sep-10', DEMO_CC, '2026-09-21', 'PAYMENT THANK YOU', 10615n),
  d('sep-11', DEMO_CHK, '2026-09-25', 'CA DEPT OF TAX AND FEE ADMIN CDTFA', -11200n),
  d('sep-12', DEMO_CHK, '2026-09-28', 'SBA LOAN PMT 004419', -52000n),
  d('sep-13', DEMO_CHK, '2026-09-30', 'MONTHLY MAINTENANCE FEE', -1500n),
  // October
  d('oct-01', DEMO_CHK, '2026-10-02', 'SQUARE INC DEPOSIT 100226', 231800n, 'Square'),
  d('oct-02', DEMO_CHK, '2026-10-06', 'MOBILE DEPOSIT HOMEOWNER INV 1088', 46000n),
  d('oct-03', DEMO_CC, '2026-10-07', 'HOME DEPOT #4411 ATLANTA GA', -15402n, 'The Home Depot'),
  d('oct-04', DEMO_CC, '2026-10-08', 'GOOGLE *WORKSPACE', -1400n, 'Google Workspace'),
  d('oct-05', DEMO_CHK, '2026-10-10', 'ZELLE TO MARIA GARCIA 5521', -90000n),
  d('oct-06', DEMO_CC, '2026-10-11', 'CLEANSOURCE SUPPLY CO', -24750n),
  d('oct-07', DEMO_CHK, '2026-10-12', 'VERIZON WIRELESS PMT', -8500n, 'Verizon'),
  d('oct-08', DEMO_CHK, '2026-10-15', 'GEICO AUTO PMT', -18900n, 'GEICO'),
  d('oct-09', DEMO_CC, '2026-10-17', 'SHELL OIL 57442', -7110n, 'Shell'),
  d('oct-10', DEMO_CHK, '2026-10-20', 'CHASE CREDIT CRD AUTOPAY', -16802n),
  d('oct-11', DEMO_CC, '2026-10-21', 'PAYMENT THANK YOU', 16802n),
  d('oct-12', DEMO_CHK, '2026-10-23', 'VENMO PAYMENT JAMES OKAFOR', -20000n),
  d('oct-13', DEMO_CHK, '2026-10-28', 'SBA LOAN PMT 004419', -52000n),
  d('oct-14', DEMO_CHK, '2026-10-31', 'MONTHLY MAINTENANCE FEE', -1500n),
  // November so far
  d('nov-01', DEMO_CHK, '2026-11-03', 'SQUARE INC DEPOSIT 110326', 98400n, 'Square'),
  d('nov-02', DEMO_CC, '2026-11-05', 'HOME DEPOT #4411 ATLANTA GA', -6630n, 'The Home Depot'),
  d('nov-03', DEMO_CC, '2026-11-08', 'GOOGLE *WORKSPACE', -1400n, 'Google Workspace'),
];

export class DemoBankProvider implements BankFeedProvider {
  readonly name = 'demo';
  async syncPage(_token: string | null, cursor: string | null): Promise<SyncPage> {
    if (!cursor) return { added: DEMO_AUGUST, modified: [], removed: [], nextCursor: 'aug', hasMore: false };
    if (cursor === 'aug') return { added: DEMO_LATER, modified: [], removed: [], nextCursor: 'done', hasMore: false };
    return { added: [], modified: [], removed: [], nextCursor: cursor, hasMore: false };
  }
}
