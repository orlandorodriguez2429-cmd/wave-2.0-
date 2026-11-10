// Real Plaid adapter. Server-only: access tokens are decrypted in memory here
// and never logged, returned to a client component, or put in audit payloads.
import { CountryCode, Products, type Transaction, type RemovedTransaction as PlaidRemoved } from 'plaid/legacy';
import { parseAmount } from '@/lib/money';
import { plaidClient, plaidConfig, plaidErrorCode, safePlaidError } from './plaid-client';
import {
  SyncRestartRequired,
  type BankFeedProvider,
  type ExternalBankAccount,
  type ExternalTransaction,
  type RemovedTransaction,
  type SyncPage,
} from './provider';

/** History requested on first connect (Plaid max is 730 days). */
export const DAYS_REQUESTED = 730;

/** Account types we import as bank feeds. Loans/investments come later. */
export const IMPORTED_ACCOUNT_TYPES = new Set(['depository', 'credit']);

const CLIENT_NAME = 'Wave 2.0';

// --- Mapping (pure, unit-tested) ---------------------------------------------

/**
 * Plaid amounts are decimal numbers where POSITIVE = money out of the account.
 * Ours are signed integer minor units where NEGATIVE = money out. This is the
 * only place the sign flips.
 */
export function plaidAmountToMinor(amount: number, currency: string): bigint {
  // Plaid amounts carry at most the currency's decimals; toFixed(2) of such a
  // double is exact, and parseAmount does integer-only parsing from there.
  const minor = parseAmount(amount.toFixed(2), currency);
  return -minor;
}

export function mapPlaidTransaction(t: Transaction): ExternalTransaction {
  const currency = t.iso_currency_code ?? 'USD';
  return {
    externalId: t.transaction_id,
    externalAccountId: t.account_id,
    date: t.date,
    description: (t.original_description || t.name || t.merchant_name || 'Bank transaction').trim(),
    amount: plaidAmountToMinor(t.amount, currency),
    currency,
    pending: t.pending,
    merchantName: t.merchant_name ?? null,
    providerCategory: t.personal_finance_category?.primary ?? null,
  };
}

export function mapPlaidRemoved(r: PlaidRemoved): RemovedTransaction {
  return { externalId: r.transaction_id, externalAccountId: r.account_id };
}

// --- Provider ------------------------------------------------------------------

export class PlaidProvider implements BankFeedProvider {
  readonly name = 'plaid';

  async syncPage(accessToken: string | null, cursor: string | null): Promise<SyncPage> {
    if (!accessToken) throw new Error('Plaid connection has no access token.');
    try {
      const { data } = await plaidClient().transactionsSync({
        access_token: accessToken,
        cursor: cursor ?? undefined,
        count: 500,
        options: { include_original_description: true, days_requested: DAYS_REQUESTED },
      });
      return {
        added: data.added.map(mapPlaidTransaction),
        modified: data.modified.map(mapPlaidTransaction),
        removed: data.removed.map(mapPlaidRemoved),
        nextCursor: data.next_cursor,
        hasMore: data.has_more,
      };
    } catch (err) {
      if (plaidErrorCode(err) === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') throw new SyncRestartRequired();
      throw safePlaidError('transactions sync', err);
    }
  }
}

// --- Link + item lifecycle ---------------------------------------------------------

/**
 * Link token for a new connection, or — with `accessToken` — update mode to
 * repair a broken login. `clientUserId` is our internal user id, never an
 * email or name.
 */
export async function createLinkToken(opts: { clientUserId: string; accessToken?: string }): Promise<string> {
  const config = plaidConfig();
  try {
    const { data } = await plaidClient().linkTokenCreate({
      client_name: CLIENT_NAME,
      language: 'en',
      country_codes: [CountryCode.Us],
      user: { client_user_id: opts.clientUserId },
      webhook: config?.webhookUrl ?? undefined,
      ...(opts.accessToken
        ? { access_token: opts.accessToken }
        : { products: [Products.Transactions], transactions: { days_requested: DAYS_REQUESTED } }),
    });
    return data.link_token;
  } catch (err) {
    throw safePlaidError('link token create', err);
  }
}

export interface ExchangedItem {
  accessToken: string;
  itemId: string;
  institutionId: string | null;
  institutionName: string;
  accounts: ExternalBankAccount[];
}

/** Exchange a Link public_token and look up the item's institution and accounts. */
export async function exchangePublicToken(publicToken: string): Promise<ExchangedItem> {
  const client = plaidClient();
  let accessToken: string;
  let itemId: string;
  try {
    const { data } = await client.itemPublicTokenExchange({ public_token: publicToken });
    accessToken = data.access_token;
    itemId = data.item_id;
  } catch (err) {
    throw safePlaidError('public token exchange', err);
  }
  try {
    const { data } = await client.accountsGet({ access_token: accessToken });
    const institutionId = data.item.institution_id ?? null;
    let institutionName = data.item.institution_name ?? null;
    if (!institutionName && institutionId) {
      const inst = await client.institutionsGetById({ institution_id: institutionId, country_codes: [CountryCode.Us] });
      institutionName = inst.data.institution.name;
    }
    return {
      accessToken,
      itemId,
      institutionId,
      institutionName: institutionName ?? 'Bank',
      accounts: data.accounts.map((a) => ({
        externalAccountId: a.account_id,
        name: a.name,
        mask: a.mask ? a.mask.slice(-4) : null,
        currency: a.balances.iso_currency_code ?? 'USD',
        type: a.type ?? null,
        subtype: a.subtype ?? null,
      })),
    };
  } catch (err) {
    // Don't leave an orphaned item at Plaid if we can't finish setting it up.
    await removeItem(accessToken).catch(() => undefined);
    throw safePlaidError('accounts get', err);
  }
}

/** /item/remove. An already-removed item counts as success. */
export async function removeItem(accessToken: string): Promise<void> {
  try {
    await plaidClient().itemRemove({ access_token: accessToken });
  } catch (err) {
    const code = plaidErrorCode(err);
    if (code === 'ITEM_NOT_FOUND' || code === 'INVALID_ACCESS_TOKEN') return;
    throw safePlaidError('item remove', err);
  }
}
