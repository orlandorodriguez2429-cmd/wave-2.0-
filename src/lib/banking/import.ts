// Bank connection lifecycle: connect (mock or Plaid), remap an account's
// ledger account, reconnect, disconnect, and clearing review flags.
// Syncing itself lives in ./sync.ts.
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { LedgerValidationError } from '@/lib/ledger/validate';
import { MOCK_ACCOUNTS, MOCK_INSTITUTION, type ExternalBankAccount } from './provider';
import { exchangePublicToken, removeItem, IMPORTED_ACCOUNT_TYPES, SKIPPED_SUBTYPES } from './plaid';

export { syncConnection } from './sync';

/** Mock (sandbox) connection; every account maps onto the chosen ledger account. */
export async function connectBank(opts: {
  businessId: string;
  userId: string;
  provider: 'mock';
  /** Ledger (chart of accounts) account the imported feed maps onto. */
  ledgerAccountId: string;
}) {
  await assertFeedLedgerAccount(prisma, opts.businessId, opts.ledgerAccountId);
  const connection = await prisma.bankConnection.create({
    data: {
      businessId: opts.businessId,
      provider: 'mock',
      institutionName: MOCK_INSTITUTION,
      createdById: opts.userId,
      accounts: {
        create: MOCK_ACCOUNTS.map((a) => ({
          businessId: opts.businessId,
          externalAccountId: a.externalAccountId,
          name: a.name,
          mask: a.mask,
          currency: a.currency,
          type: a.type,
          subtype: a.subtype,
          ledgerAccountId: opts.ledgerAccountId,
        })),
      },
    },
    include: { accounts: true },
  });
  await audit(opts.businessId, opts.userId, 'bank_connection.created', connection.id, {
    provider: 'mock',
    institution: MOCK_INSTITUTION,
  });
  return connection;
}

/**
 * Finish a Plaid Link session: exchange the public token, store the access
 * token encrypted, and create one ledger account per imported bank account
 * (checking/savings → Cash & Bank asset, credit card → Credit Card liability).
 * Returns the connection id only — never the token.
 */
export async function connectPlaidItem(opts: { businessId: string; userId: string; publicToken: string }) {
  const item = await exchangePublicToken(opts.publicToken);
  const accounts = item.accounts.filter(
    (a) => a.type && IMPORTED_ACCOUNT_TYPES.has(a.type) && !SKIPPED_SUBTYPES.has(a.subtype ?? ''),
  );
  if (accounts.length === 0) {
    await removeItem(item.accessToken).catch(() => undefined);
    throw new LedgerValidationError(
      'That login has no checking, savings or credit card accounts to import. Nothing was connected.',
    );
  }

  const existing = await prisma.bankConnection.findUnique({ where: { itemId: item.itemId } });
  if (existing) throw new LedgerValidationError('This bank login is already connected.');

  const connection = await prisma.$transaction(async (tx) => {
    const business = await tx.business.findUniqueOrThrow({ where: { id: opts.businessId } });
    const links: Prisma.BankAccountLinkCreateWithoutConnectionInput[] = [];
    for (const a of accounts) {
      const ledger = await createFeedLedgerAccount(tx, opts.businessId, business.functionalCurrency, item.institutionName, a);
      links.push({
        businessId: opts.businessId,
        externalAccountId: a.externalAccountId,
        name: a.name,
        mask: a.mask,
        currency: a.currency,
        type: a.type,
        subtype: a.subtype,
        ledgerAccountId: ledger.id,
      });
    }
    return tx.bankConnection.create({
      data: {
        businessId: opts.businessId,
        provider: 'plaid',
        institutionName: item.institutionName,
        institutionId: item.institutionId,
        itemId: item.itemId,
        accessTokenEncrypted: encryptSecret(item.accessToken),
        createdById: opts.userId,
        syncRequestedAt: new Date(),
        accounts: { create: links },
      },
      select: { id: true },
    });
  });

  await audit(opts.businessId, opts.userId, 'bank_connection.created', connection.id, {
    provider: 'plaid',
    institution: item.institutionName,
    accounts: accounts.length,
    skippedAccounts: item.accounts.length - accounts.length,
  });
  return connection;
}

/** New ledger account for a bank feed, with the next free code in its range. */
export async function createFeedLedgerAccount(
  tx: Prisma.TransactionClient,
  businessId: string,
  functionalCurrency: string,
  institution: string,
  a: ExternalBankAccount,
) {
  const isCredit = a.type === 'credit';
  const [from, to] = isCredit ? [2101, 2199] : [1011, 1099];
  const used = new Set(
    (
      await tx.account.findMany({
        where: { businessId, code: { gte: String(from), lte: String(to) } },
        select: { code: true },
      })
    ).map((x) => x.code),
  );
  let code: string | null = null;
  for (let n = from; n <= to; n++) {
    if (!used.has(String(n))) {
      code = String(n);
      break;
    }
  }
  if (!code) throw new LedgerValidationError('No free account codes left for bank accounts.');
  const name = `${institution} ${a.name}${a.mask ? ` ••${a.mask}` : ''}`.slice(0, 120);
  return tx.account.create({
    data: {
      businessId,
      code,
      name,
      type: isCredit ? 'LIABILITY' : 'ASSET',
      subtype: isCredit ? 'credit_card' : 'cash_and_bank',
      currency: a.currency === functionalCurrency ? null : a.currency,
      description: 'Created automatically for a connected bank feed.',
    },
  });
}

type Db = Prisma.TransactionClient | typeof prisma;

async function assertFeedLedgerAccount(db: Db, businessId: string, ledgerAccountId: string) {
  const account = await db.account.findUnique({ where: { id: ledgerAccountId } });
  if (!account || account.businessId !== businessId || account.isArchived) {
    throw new LedgerValidationError('Pick an active ledger account from this business.');
  }
  if (account.subtype !== 'cash_and_bank' && account.subtype !== 'credit_card') {
    throw new LedgerValidationError('A bank feed must map to a Cash & Bank or Credit Card account.');
  }
  return account;
}

/** Point a bank account at a different ledger account — only before anything from it is on the books. */
export async function remapAccountLink(opts: {
  businessId: string;
  userId: string;
  linkId: string;
  ledgerAccountId: string;
}) {
  const link = await prisma.bankAccountLink.findUniqueOrThrow({ where: { id: opts.linkId } });
  if (link.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  await assertFeedLedgerAccount(prisma, opts.businessId, opts.ledgerAccountId);
  const posted = await prisma.importedTransaction.count({
    where: { bankAccountLinkId: link.id, status: { in: ['CATEGORIZED', 'MATCHED'] } },
  });
  if (posted > 0) {
    throw new LedgerValidationError(
      'Transactions from this account are already on the books, so its ledger account can no longer change.',
    );
  }
  await prisma.bankAccountLink.update({ where: { id: link.id }, data: { ledgerAccountId: opts.ledgerAccountId } });
  await audit(opts.businessId, opts.userId, 'bank_account_link.remapped', link.id, {
    from: link.ledgerAccountId,
    to: opts.ledgerAccountId,
  });
}

/** After a successful Link update-mode session: login repaired, sync again. */
export async function markReconnected(opts: { businessId: string; userId: string; connectionId: string }) {
  const c = await prisma.bankConnection.findUniqueOrThrow({ where: { id: opts.connectionId } });
  if (c.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (c.status === 'REMOVED') throw new LedgerValidationError('This connection was disconnected.');
  await prisma.bankConnection.update({
    where: { id: c.id },
    data: { status: 'ACTIVE', errorCode: null, syncRequestedAt: new Date() },
  });
  await audit(opts.businessId, opts.userId, 'bank_connection.reconnected', c.id, {});
}

/**
 * Disconnect: /item/remove at Plaid first, then mark the connection removed
 * and wipe the access token. Imported history (and anything posted from it)
 * stays.
 */
export async function disconnectConnection(opts: { businessId: string; userId: string; connectionId: string }) {
  const c = await prisma.bankConnection.findUniqueOrThrow({ where: { id: opts.connectionId } });
  if (c.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (c.status === 'REMOVED') return;
  if (c.provider === 'plaid' && c.accessTokenEncrypted) {
    await removeItem(decryptSecret(c.accessTokenEncrypted));
  }
  await prisma.bankConnection.update({
    where: { id: c.id },
    data: { status: 'REMOVED', removedAt: new Date(), accessTokenEncrypted: null, syncRequestedAt: null },
  });
  await audit(opts.businessId, opts.userId, 'bank_connection.removed', c.id, { provider: c.provider });
}

/** Accountant has looked at a provider change on a posted transaction. */
export async function clearReviewFlag(opts: { businessId: string; userId: string; transactionId: string }) {
  const t = await prisma.importedTransaction.findUniqueOrThrow({ where: { id: opts.transactionId } });
  if (t.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (!t.needsReview) return;
  await prisma.importedTransaction.update({
    where: { id: t.id },
    data: { needsReview: false, reviewReason: null, providerChange: Prisma.DbNull },
  });
  await audit(opts.businessId, opts.userId, 'bank_txn.review_cleared', t.id, { reason: t.reviewReason });
}

async function audit(businessId: string, userId: string | null, action: string, entityId: string, payload: Prisma.InputJsonObject) {
  await prisma.auditLog.create({
    data: {
      businessId,
      userId,
      action,
      entityType: action.startsWith('bank_txn') ? 'imported_transaction' : action.startsWith('bank_account_link') ? 'bank_account_link' : 'bank_connection',
      entityId,
      payload,
    },
  });
}
