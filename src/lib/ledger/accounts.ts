import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Locate the business's system account for an engine-required role
 * (accounts_receivable, accounts_payable, sales_tax, …). These are seeded
 * with every business and cannot be deleted, so absence is a hard error.
 */
export async function systemAccount(db: Db, businessId: string, subtype: string) {
  const account = await db.account.findFirst({
    where: { businessId, subtype, isSystem: true, isArchived: false },
    orderBy: { code: 'asc' },
  });
  if (!account) {
    throw new Error(`Business is missing its system "${subtype}" account.`);
  }
  return account;
}
