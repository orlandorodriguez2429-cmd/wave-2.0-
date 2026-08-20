import { prisma } from '@/lib/db';
import { encryptSecret } from '@/lib/crypto';
import { getProvider } from './provider';
import { suggestAccount } from './suggest';

/** Create a connection via the named provider and map its accounts to a ledger account. */
export async function connectBank(opts: {
  businessId: string;
  userId: string;
  provider: string;
  /** Ledger (chart of accounts) account the imported feed maps onto. */
  ledgerAccountId: string;
}) {
  const provider = getProvider(opts.provider);
  const result = await provider.connect();

  const connection = await prisma.bankConnection.create({
    data: {
      businessId: opts.businessId,
      provider: provider.name,
      institutionName: result.institutionName,
      accessTokenEncrypted: result.accessToken ? encryptSecret(result.accessToken) : null,
      accounts: {
        create: result.accounts.map((a) => ({
          businessId: opts.businessId,
          externalAccountId: a.externalAccountId,
          name: a.name,
          mask: a.mask,
          currency: a.currency,
          ledgerAccountId: opts.ledgerAccountId,
        })),
      },
    },
    include: { accounts: true },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'bank_connection.created',
      entityType: 'bank_connection',
      entityId: connection.id,
      payload: { provider: provider.name, institution: result.institutionName },
    },
  });
  return connection;
}

/**
 * Pull new transactions for every account of a connection. Idempotent: the
 * (link, externalId) unique constraint turns duplicate rows into no-ops.
 * Each new transaction gets a rule/heuristic account suggestion.
 */
export async function syncConnection(opts: { businessId: string; userId: string; connectionId: string }) {
  const connection = await prisma.bankConnection.findUniqueOrThrow({
    where: { id: opts.connectionId },
    include: { accounts: true },
  });
  if (connection.businessId !== opts.businessId) throw new Error('Wrong business.');
  const provider = getProvider(connection.provider);

  let imported = 0;
  for (const link of connection.accounts) {
    const txns = await provider.fetchTransactions(null, link.externalAccountId, connection.syncCount);
    for (const t of txns) {
      const suggestion = await suggestAccount(opts.businessId, t.description, t.amount);
      const created = await prisma.importedTransaction.createMany({
        data: [
          {
            businessId: opts.businessId,
            bankAccountLinkId: link.id,
            externalId: t.externalId,
            date: new Date(t.date),
            description: t.description,
            amount: t.amount,
            suggestedAccountId: suggestion?.accountId ?? null,
            suggestedByRuleId: suggestion?.ruleId ?? null,
          },
        ],
        skipDuplicates: true,
      });
      imported += created.count;
    }
  }

  await prisma.bankConnection.update({
    where: { id: connection.id },
    data: { syncCount: { increment: 1 }, lastSyncAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'bank_connection.synced',
      entityType: 'bank_connection',
      entityId: connection.id,
      payload: { imported },
    },
  });
  return { imported };
}
