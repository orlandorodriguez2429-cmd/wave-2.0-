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

/**
 * Find a business's account by code, creating it from the standard template
 * if this (older) business doesn't have it yet. Used for accounts added to
 * the template after a business was created (e.g. 7100 Interest Expense).
 */
export async function ensureTemplateAccount(db: Db, businessId: string, code: string) {
  const existing = await db.account.findUnique({ where: { businessId_code: { businessId, code } } });
  if (existing) return existing;
  const { STANDARD_COA } = await import('./coa-template');
  const spec = STANDARD_COA.find((a) => a.code === code);
  if (!spec) throw new Error(`No template account ${code}.`);
  return db.account.create({
    data: {
      businessId,
      code: spec.code,
      name: spec.name,
      type: spec.type,
      subtype: spec.subtype,
      description: spec.description,
      isSystem: spec.isSystem ?? false,
    },
  });
}
