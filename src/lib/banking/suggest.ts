import { prisma } from '@/lib/db';

export interface Suggestion {
  accountId: string;
  ruleId?: string;
  reason: 'rule' | 'history';
}

/**
 * Suggest a category account for an imported bank transaction.
 * 1. User-defined rules win (priority order, direction-aware).
 * 2. Otherwise a frequency heuristic: the account most often used when
 *    categorizing transactions with overlapping description tokens.
 *    (Deliberately simple and explainable — an ML model can slot in here.)
 */
export async function suggestAccount(
  businessId: string,
  description: string,
  amount: bigint,
): Promise<Suggestion | null> {
  const direction = amount < 0n ? 'OUTFLOW' : 'INFLOW';
  const rules = await prisma.categorizationRule.findMany({
    where: { businessId, appliesTo: { in: [direction, 'BOTH'] } },
    orderBy: { priority: 'asc' },
  });
  const haystack = description.toUpperCase();
  for (const rule of rules) {
    if (rule.matchType === 'CONTAINS') {
      if (haystack.includes(rule.pattern.toUpperCase())) {
        return { accountId: rule.accountId, ruleId: rule.id, reason: 'rule' };
      }
    } else {
      try {
        if (new RegExp(rule.pattern, 'i').test(description)) {
          return { accountId: rule.accountId, ruleId: rule.id, reason: 'rule' };
        }
      } catch {
        // Broken user regex: skip the rule rather than break the import.
      }
    }
  }

  const tokens = tokenize(description);
  if (tokens.length === 0) return null;
  const past = await prisma.importedTransaction.findMany({
    where: { businessId, status: 'CATEGORIZED', journalEntryId: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { bankAccountLink: true },
  });
  const scores = new Map<string, number>();
  for (const txn of past) {
    const overlap = tokenize(txn.description).filter((t) => tokens.includes(t)).length;
    if (overlap === 0 || !txn.journalEntryId) continue;
    // The category account is the entry line that is NOT the bank ledger account.
    const entry = await prisma.journalEntry.findUnique({
      where: { id: txn.journalEntryId },
      include: { lines: true },
    });
    const categoryLine = entry?.lines.find((l) => l.accountId !== txn.bankAccountLink.ledgerAccountId);
    if (!categoryLine) continue;
    scores.set(categoryLine.accountId, (scores.get(categoryLine.accountId) ?? 0) + overlap);
  }
  const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? { accountId: best[0], reason: 'history' } : null;
}

function tokenize(s: string): string[] {
  return s
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((t) => t.length >= 3);
}
