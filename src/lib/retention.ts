// Data retention: delete a business completely.
//   1. Every live Plaid item is removed at Plaid (/item/remove) first; if
//      that fails, nothing is deleted.
//   2. The business and everything under it (ledger, imported bank data,
//      vendors/W-9s, 1099s, uploads metadata, audit log) is deleted in one
//      transaction. Posted ledger rows can only be deleted here (see the
//      business_deletion migration); they can never be edited.
//   3. A DeletionRecord (who, when, what — counts only) is kept.
// IRS rules may require keeping filed 1099 copies and the records behind a
// return: export what must be retained BEFORE deleting.
import { prisma } from '@/lib/db';
import { decryptSecret } from '@/lib/crypto';
import { LedgerValidationError } from '@/lib/ledger/validate';
import { removeItem } from '@/lib/banking/plaid';

export async function deleteBusiness(opts: {
  businessId: string;
  userId: string;
  confirmName: string;
  /** Test seam. */
  removePlaidItem?: (accessToken: string) => Promise<void>;
}) {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: opts.businessId } });
  const membership = await prisma.membership.findUnique({
    where: { userId_businessId: { userId: opts.userId, businessId: business.id } },
  });
  if (membership?.role !== 'OWNER') throw new LedgerValidationError('Only an owner can delete a business.');
  if (opts.confirmName.trim() !== business.name) {
    throw new LedgerValidationError('Type the business name exactly to confirm.');
  }

  const connections = await prisma.bankConnection.findMany({ where: { businessId: business.id } });
  const remove = opts.removePlaidItem ?? removeItem;
  let plaidItemsRemoved = 0;
  for (const c of connections) {
    if (c.provider === 'plaid' && c.accessTokenEncrypted && c.status !== 'REMOVED') {
      await remove(decryptSecret(c.accessTokenEncrypted)); // throws → nothing deleted
      plaidItemsRemoved++;
    }
  }

  const [entries, imported, vendors, forms, members] = await Promise.all([
    prisma.journalEntry.count({ where: { businessId: business.id } }),
    prisma.importedTransaction.count({ where: { businessId: business.id } }),
    prisma.vendor.count({ where: { businessId: business.id } }),
    prisma.form1099.count({ where: { businessId: business.id } }),
    prisma.membership.findMany({ where: { businessId: business.id }, select: { userId: true } }),
  ]);
  const summary = {
    journalEntries: entries,
    importedTransactions: imported,
    bankConnections: connections.length,
    vendors,
    forms1099: forms,
  };

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.business_deletion = 'on'`);
      // Children first where relations don't cascade from the business.
      await tx.importedTransaction.deleteMany({ where: { businessId: business.id } });
      await tx.statementUpload.deleteMany({ where: { businessId: business.id } });
      await tx.invite.deleteMany({ where: { businessId: business.id } });
      await tx.journalLine.deleteMany({ where: { entry: { businessId: business.id } } });
      // Reversals reference their originals: drop the links, then the entries.
      await tx.$executeRaw`DELETE FROM "journal_entries" WHERE "businessId" = ${business.id} AND "reversesId" IS NOT NULL`;
      await tx.business.delete({ where: { id: business.id } });
      await tx.deletionRecord.create({
        data: {
          businessId: business.id,
          businessName: business.name,
          deletedById: opts.userId,
          plaidItemsRemoved,
          summary,
        },
      });
    },
    { timeout: 120_000 },
  );
  // Anyone who was signed in to it must sign in again.
  await prisma.user.updateMany({
    where: { id: { in: members.map((m) => m.userId) } },
    data: { sessionVersion: { increment: 1 } },
  });
  // Client logins existed only for this business; they can't sign in to anything now.
  return { plaidItemsRemoved, summary };
}
