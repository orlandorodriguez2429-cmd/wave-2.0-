import { prisma } from '@/lib/db';
import { LedgerValidationError } from '@/lib/ledger/validate';

/**
 * Reconciliation math for a session. Everything is derived, nothing stored:
 * - ledger balance of the account at statement start / end (posted entries only)
 * - the variance the bookkeeper is driving to zero:
 *     endingBalance(statement) − ledgerBalance(end)
 * plus the imported-transaction worklist for the period.
 */
export async function reconciliationReport(businessId: string, sessionId: string) {
  const session = await prisma.reconciliationSession.findUniqueOrThrow({ where: { id: sessionId } });
  if (session.businessId !== businessId) throw new LedgerValidationError('Wrong business.');
  const account = await prisma.account.findUniqueOrThrow({ where: { id: session.ledgerAccountId } });

  const balanceAsOf = async (to: Date): Promise<bigint> => {
    const rows = await prisma.$queryRaw<Array<{ debits: bigint | string | null; credits: bigint | string | null }>>`
      SELECT (sum(l."functionalAmount") FILTER (WHERE l.direction = 'DEBIT'))::bigint  AS debits,
             (sum(l."functionalAmount") FILTER (WHERE l.direction = 'CREDIT'))::bigint AS credits
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."entryId"
       WHERE e."businessId" = ${businessId} AND e.status = 'POSTED'
         AND l."accountId" = ${session.ledgerAccountId}
         AND e.date <= ${to.toISOString().slice(0, 10)}::date
    `;
    const debits = rows[0]?.debits == null ? 0n : BigInt(rows[0].debits);
    const credits = rows[0]?.credits == null ? 0n : BigInt(rows[0].credits);
    return debits - credits; // asset account: debit-normal
  };

  const dayBeforeStart = new Date(session.statementStart.getTime() - 86400_000);
  const [ledgerStart, ledgerEnd] = await Promise.all([
    balanceAsOf(dayBeforeStart),
    balanceAsOf(session.statementEnd),
  ]);

  const links = await prisma.bankAccountLink.findMany({
    where: { businessId, ledgerAccountId: session.ledgerAccountId },
    select: { id: true },
  });
  const transactions = await prisma.importedTransaction.findMany({
    where: {
      bankAccountLinkId: { in: links.map((l) => l.id) },
      date: { gte: session.statementStart, lte: session.statementEnd },
    },
    orderBy: { date: 'asc' },
  });

  const unresolved = transactions.filter((t) => t.status === 'PENDING');
  return {
    session,
    account,
    ledgerStart,
    ledgerEnd,
    // The statement says the account moved start→end; the ledger should agree.
    statementMovement: session.endingBalance - session.startingBalance,
    ledgerMovement: ledgerEnd - ledgerStart,
    variance: session.endingBalance - ledgerEnd,
    openingVariance: session.startingBalance - ledgerStart,
    transactions,
    unresolvedCount: unresolved.length,
  };
}

export async function completeReconciliation(opts: { businessId: string; userId: string; sessionId: string }) {
  const report = await reconciliationReport(opts.businessId, opts.sessionId);
  if (report.session.status !== 'OPEN') throw new LedgerValidationError('Session already completed.');
  if (report.variance !== 0n) {
    throw new LedgerValidationError(
      `Cannot complete: variance is not zero (${report.variance} minor units). Categorize, match, or adjust first.`,
    );
  }
  if (report.unresolvedCount > 0) {
    throw new LedgerValidationError(
      `Cannot complete: ${report.unresolvedCount} imported transaction(s) in the period are still pending.`,
    );
  }
  const session = await prisma.reconciliationSession.update({
    where: { id: opts.sessionId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'reconciliation.completed',
      entityType: 'reconciliation_session',
      entityId: session.id,
      payload: {
        account: report.account.code,
        period: `${session.statementStart.toISOString().slice(0, 10)}..${session.statementEnd.toISOString().slice(0, 10)}`,
      },
    },
  });
  return session;
}
