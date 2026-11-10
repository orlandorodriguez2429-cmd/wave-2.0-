// Automatic categorization, run right after every import. In order:
//   0. transfers between the business's own connected accounts (paired by
//      mirrored amount within 3 days) → one balance-sheet entry,
//   1. this business's own rules (incl. ones learned from corrections),
//   2. built-in merchant rules (merchant-rules.ts),
//   3. the AI fallback (ai-categorize.ts): applied when confidence ≥ 0.85,
//      otherwise its guess is pre-filled and the row waits for review.
// Never auto-posted, always left for a person: loan payments (need an
// interest/principal split), rows in a closed month, rows the bank changed
// after posting. Every automatic posting is a normal immutable journal entry
// marked with how it was decided, and can be undone by reversal.
import { prisma } from '@/lib/db';
import { formatAmount } from '@/lib/money';
import { LedgerValidationError } from '@/lib/ledger/validate';
import { categorizeTransaction, postTransfer, type CategorizedBy } from './categorize';
import { matchMerchantRule } from './merchant-rules';
import { matchRule } from './suggest';
import { systemUserId } from './system-user';
import {
  AUTO_APPLY_CONFIDENCE,
  cleanDescription,
  createAnthropicClassifier,
  type AiCategory,
  type AiItem,
  type Classifier,
} from './ai-categorize';

export interface AutoStats {
  considered: number;
  transfers: number;
  rule: number;
  merchant: number;
  ai: number;
  leftForReview: number;
}

const TRANSFER_WINDOW_DAYS = 3;
const LOAN_SUBTYPES = new Set(['long_term_liability']);

export async function autoCategorize(opts: {
  businessId: string;
  /** Defaults to the Anthropic classifier when ANTHROPIC_API_KEY is set; null disables AI. */
  classifier?: Classifier | null;
}): Promise<AutoStats> {
  const stats: AutoStats = { considered: 0, transfers: 0, rule: 0, merchant: 0, ai: 0, leftForReview: 0 };
  const business = await prisma.business.findUniqueOrThrow({ where: { id: opts.businessId } });
  const fresh = await prisma.importedTransaction.findMany({
    where: { businessId: business.id, status: 'PENDING', autoProcessedAt: null, needsReview: false },
    include: { bankAccountLink: true },
    orderBy: { date: 'asc' },
  });
  if (fresh.length === 0) return stats;
  stats.considered = fresh.length;

  const userId = await systemUserId();
  const closedThrough = business.booksClosedThrough;
  const isClosed = (d: Date) => !!closedThrough && d <= closedThrough;
  const done = new Set<string>();
  const accounts = await prisma.account.findMany({ where: { businessId: business.id, isArchived: false } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const isLoan = (accountId: string) => LOAN_SUBTYPES.has(byId.get(accountId)?.subtype ?? '');

  const post = async (
    t: (typeof fresh)[number],
    accountId: string,
    by: CategorizedBy,
    ai?: { confidence: number; reason: string },
  ) => {
    try {
      await categorizeTransaction({ businessId: business.id, userId, transactionId: t.id, categoryAccountId: accountId, categorizedBy: by, ai });
      done.add(t.id);
      return true;
    } catch (err) {
      if (err instanceof LedgerValidationError) return false;
      throw err;
    }
  };
  const suggest = (t: (typeof fresh)[number], accountId: string | null, note: { confidence?: number; reason: string }) =>
    prisma.importedTransaction.update({
      where: { id: t.id },
      data: { suggestedAccountId: accountId, aiConfidence: note.confidence ?? null, aiReason: note.reason },
    });

  // 0. Transfers between own accounts. The other half may have arrived in an
  //    earlier sync, so look at every pending row in the window.
  const pendingAll = await prisma.importedTransaction.findMany({
    where: { businessId: business.id, status: 'PENDING', needsReview: false },
    select: { id: true, amount: true, date: true, bankAccountLinkId: true },
  });
  for (const out of fresh) {
    if (out.amount >= 0n || done.has(out.id) || isClosed(out.date)) continue;
    const partner = pendingAll.find(
      (p) =>
        !done.has(p.id) &&
        p.id !== out.id &&
        p.bankAccountLinkId !== out.bankAccountLinkId &&
        p.amount === -out.amount &&
        Math.abs(p.date.getTime() - out.date.getTime()) <= TRANSFER_WINDOW_DAYS * 86400_000,
    );
    if (!partner) continue;
    try {
      await postTransfer({ businessId: business.id, userId, outId: out.id, inId: partner.id });
      done.add(out.id).add(partner.id);
      stats.transfers++;
    } catch (err) {
      if (!(err instanceof LedgerValidationError)) throw err;
    }
  }

  // 1 + 2. Business rules, then built-in merchant rules.
  const rules = await prisma.categorizationRule.findMany({
    where: { businessId: business.id },
    orderBy: { priority: 'asc' },
  });
  const forAi: typeof fresh = [];
  for (const t of fresh) {
    if (done.has(t.id)) continue;
    if (isClosed(t.date)) {
      await suggest(t, t.suggestedAccountId, { reason: 'This month is closed — reopen it to post.' });
      continue;
    }
    const outflow = t.amount < 0n;
    const rule = matchRule(rules, t.description, t.amount) ?? (t.merchantName ? matchRule(rules, t.merchantName, t.amount) : null);
    if (rule && byId.has(rule.accountId)) {
      if (outflow && isLoan(rule.accountId)) {
        await suggest(t, rule.accountId, { reason: 'Loan payment: enter the interest part so only principal reduces the loan.' });
        continue;
      }
      if (await post(t, rule.accountId, 'RULE')) stats.rule++;
      continue;
    }
    const merchant = matchMerchantRule(t.description, t.amount, t.bankAccountLink.type);
    const merchantAccount = merchant ? byCode.get(merchant.accountCode) : undefined;
    if (merchant && merchantAccount && merchantAccount.id !== t.bankAccountLink.ledgerAccountId) {
      if (merchant.suggestOnly) {
        await suggest(t, merchantAccount.id, { reason: merchant.suggestOnly });
        continue;
      }
      if (await post(t, merchantAccount.id, 'MERCHANT', { confidence: 1, reason: `Built-in rule: ${merchant.name}` })) stats.merchant++;
      continue;
    }
    forAi.push(t);
  }

  // 3. AI fallback, batched. Only categories, never client details.
  const classifier = opts.classifier === undefined ? createAnthropicClassifier() : opts.classifier;
  if (classifier && forAi.length > 0) {
    const categories: AiCategory[] = accounts
      .filter(
        (a) =>
          a.type === 'INCOME' ||
          a.type === 'EXPENSE' ||
          (a.type === 'EQUITY' && a.subtype !== 'retained_earnings') ||
          (a.type === 'LIABILITY' && ['credit_card', 'sales_tax', 'long_term_liability'].includes(a.subtype ?? '')),
      )
      .map((a) => ({ code: a.code, name: a.name, type: a.type }));
    const items: AiItem[] = forAi.map((t) => ({
      description: cleanDescription(t.description, t.merchantName),
      amount: formatAmount(t.amount, t.bankAccountLink.currency),
      date: t.date.toISOString().slice(0, 10),
      direction: t.amount < 0n ? 'money out' : 'money in',
      feed: t.bankAccountLink.type === 'credit' ? 'credit card' : 'bank account',
      bankCategory: t.providerCategory,
    }));
    let guesses: Awaited<ReturnType<Classifier>> = [];
    try {
      guesses = await classifier({ businessType: business.businessType, categories, items });
    } catch {
      guesses = []; // AI down → everything goes to review.
    }
    const allowed = new Set(categories.map((c) => c.code));
    for (const g of guesses) {
      const t = forAi[g.index];
      if (!t || done.has(t.id)) continue;
      const account = g.accountCode && allowed.has(g.accountCode) ? byCode.get(g.accountCode) : undefined;
      if (!account) {
        await suggest(t, null, { confidence: g.confidence, reason: g.reason || 'AI could not tell.' });
        continue;
      }
      const loanPayment = t.amount < 0n && isLoan(account.id);
      if (g.confidence >= AUTO_APPLY_CONFIDENCE && !loanPayment) {
        if (await post(t, account.id, 'AI', { confidence: g.confidence, reason: g.reason })) {
          stats.ai++;
          continue;
        }
      }
      await suggest(t, account.id, {
        confidence: g.confidence,
        reason: loanPayment ? `${g.reason} Loan payment: enter the interest part.` : g.reason,
      });
    }
  }

  // Everything still pending has been looked at; it now waits for a person.
  const left = fresh.filter((t) => !done.has(t.id)).map((t) => t.id);
  stats.leftForReview = left.length;
  await prisma.importedTransaction.updateMany({
    where: { id: { in: fresh.map((t) => t.id) }, status: 'PENDING' },
    data: { autoProcessedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      businessId: business.id,
      userId: null,
      action: 'bank_txn.auto_categorized',
      entityType: 'business',
      entityId: business.id,
      payload: { ...stats, aiEnabled: !!classifier },
    },
  });
  return stats;
}
