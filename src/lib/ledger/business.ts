import { prisma } from '@/lib/db';
import type { AccountingBasis } from '@/generated/prisma/enums';
import { STANDARD_COA } from './coa-template';

/**
 * Create a business owned by `userId`, seeded with the standard chart of
 * accounts. Everything happens in one transaction.
 */
export async function createBusiness(opts: {
  userId: string;
  name: string;
  legalName?: string;
  functionalCurrency?: string;
  fiscalYearStartMonth?: number;
  accountingBasis?: AccountingBasis;
}) {
  const fiscalStart = opts.fiscalYearStartMonth ?? 1;
  if (fiscalStart < 1 || fiscalStart > 12) {
    throw new Error('fiscalYearStartMonth must be 1-12');
  }

  return prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: {
        name: opts.name.trim(),
        legalName: opts.legalName?.trim() || null,
        functionalCurrency: opts.functionalCurrency ?? 'USD',
        fiscalYearStartMonth: fiscalStart,
        accountingBasis: opts.accountingBasis ?? 'ACCRUAL',
        memberships: { create: { userId: opts.userId, role: 'OWNER' } },
        accounts: {
          create: STANDARD_COA.map((a) => ({
            code: a.code,
            name: a.name,
            type: a.type,
            subtype: a.subtype,
            description: a.description,
            isSystem: a.isSystem ?? false,
          })),
        },
      },
    });

    await tx.auditLog.create({
      data: {
        businessId: business.id,
        userId: opts.userId,
        action: 'business.created',
        entityType: 'business',
        entityId: business.id,
        payload: { name: business.name, accountCount: STANDARD_COA.length },
      },
    });

    return business;
  });
}
