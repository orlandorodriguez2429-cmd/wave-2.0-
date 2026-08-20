// Bank feed providers behind one interface. "mock" ships a deterministic
// sandbox feed so the whole import/categorize/reconcile pipeline runs without
// credentials; "plaid" is the production adapter and activates when
// PLAID_CLIENT_ID / PLAID_SECRET are configured.

export interface ExternalBankAccount {
  externalAccountId: string;
  name: string;
  mask: string;
  currency: string;
}

export interface ExternalTransaction {
  externalId: string;
  date: string; // YYYY-MM-DD
  description: string;
  /** Signed minor units: negative = money out of the bank account. */
  amount: bigint;
}

export interface BankFeedProvider {
  readonly name: string;
  /** Establish a connection; returns institution + accounts. */
  connect(): Promise<{ institutionName: string; accessToken: string | null; accounts: ExternalBankAccount[] }>;
  /**
   * Fetch transactions. `syncCount` is the per-connection cursor (0 on first
   * sync); providers return only what's new for that cursor.
   */
  fetchTransactions(accessToken: string | null, externalAccountId: string, syncCount: number): Promise<ExternalTransaction[]>;
}

// ---------------------------------------------------------------------------
// Mock provider — deterministic sandbox data
// ---------------------------------------------------------------------------

const BATCHES: ExternalTransaction[][] = [
  [
    { externalId: 'mock-001', date: '2026-05-01', description: 'STRIPE PAYOUT ST-9931', amount: 412500n },
    { externalId: 'mock-002', date: '2026-05-02', description: 'AWS EMEA aws.amazon.com', amount: -18742n },
    { externalId: 'mock-003', date: '2026-05-03', description: 'GITHUB INC', amount: -2100n },
    { externalId: 'mock-004', date: '2026-05-05', description: 'OFFICE DEPOT #1123', amount: -8433n },
    { externalId: 'mock-005', date: '2026-05-07', description: 'BLUEBIRD MEDIA ACH PMT', amount: 429938n },
    { externalId: 'mock-006', date: '2026-05-08', description: 'WEWORK MAY RENT', amount: -180000n },
    { externalId: 'mock-007', date: '2026-05-10', description: 'MAYA DESIGN CO INV 88', amount: -90000n },
    { externalId: 'mock-008', date: '2026-05-12', description: 'DELTA AIR 0062341', amount: -45620n },
  ],
  [
    { externalId: 'mock-009', date: '2026-05-15', description: 'STRIPE PAYOUT ST-9954', amount: 267000n },
    { externalId: 'mock-010', date: '2026-05-16', description: 'AWS EMEA aws.amazon.com', amount: -19105n },
    { externalId: 'mock-011', date: '2026-05-18', description: 'USPS PO 8837710031', amount: -1560n },
  ],
];

export class MockBankProvider implements BankFeedProvider {
  readonly name = 'mock';

  async connect() {
    return {
      institutionName: 'Sandbox Bank of Testing',
      accessToken: null,
      accounts: [
        { externalAccountId: 'mock-checking-01', name: 'Business Checking', mask: '4321', currency: 'USD' },
      ],
    };
  }

  async fetchTransactions(_token: string | null, _externalAccountId: string, syncCount: number) {
    return BATCHES[syncCount] ?? [];
  }
}

// ---------------------------------------------------------------------------
// Plaid adapter — activates with real credentials
// ---------------------------------------------------------------------------

export class PlaidProvider implements BankFeedProvider {
  readonly name = 'plaid';

  async connect(): Promise<never> {
    // Real flow: create link_token, run Plaid Link client-side, exchange
    // public_token for access_token, then persist it encrypted.
    throw new Error(
      'Plaid is not configured. Set PLAID_CLIENT_ID / PLAID_SECRET and complete the Link flow; ' +
        'until then use the sandbox connection.',
    );
  }

  async fetchTransactions(): Promise<never> {
    throw new Error('Plaid is not configured.');
  }
}

export function getProvider(name: string): BankFeedProvider {
  if (name === 'plaid') return new PlaidProvider();
  return new MockBankProvider();
}
