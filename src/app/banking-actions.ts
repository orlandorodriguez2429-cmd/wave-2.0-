'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireContext } from '@/lib/context';
import {
  clearReviewFlag,
  connectBank,
  connectPlaidItem,
  disconnectConnection,
  markReconnected,
  remapAccountLink,
  syncConnection,
} from '@/lib/banking/import';
import { createLinkToken } from '@/lib/banking/plaid';
import { isPlaidConfigured } from '@/lib/banking/plaid-client';
import { decryptSecret } from '@/lib/crypto';
import { importStatement } from '@/lib/banking/statement';
import { categorizeTransaction, excludeTransaction, matchTransaction, recategorizeTransaction } from '@/lib/banking/categorize';
import { ensureTemplateAccount } from '@/lib/ledger/accounts';
import { completeReconciliation } from '@/lib/banking/reconcile';
import { parseAmount } from '@/lib/money';
import type { ActionResult } from './actions';

function errorResult(err: unknown): ActionResult {
  if (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    String((err as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT')
  ) {
    throw err;
  }
  return { error: err instanceof Error ? err.message : 'Something went wrong.' };
}

export async function connectSandboxBankAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await requireContext('ACCOUNTANT');
  const ledgerAccountId = String(formData.get('ledgerAccountId') ?? '');
  if (!ledgerAccountId) return { error: 'Pick the ledger account this bank feed maps to.' };
  try {
    const connection = await connectBank({
      businessId: business.id,
      userId: user.id,
      provider: 'mock',
      ledgerAccountId,
    });
    await syncConnection({ businessId: business.id, userId: user.id, connectionId: connection.id, trigger: 'connect' });
    revalidatePath('/banking');
    return {};
  } catch (err) {
    return errorResult(err);
  }
}

export async function syncConnectionAction(connectionId: string): Promise<void> {
  const { user, business } = await requireContext('ACCOUNTANT');
  try {
    await syncConnection({ businessId: business.id, userId: user.id, connectionId, trigger: 'manual' });
  } finally {
    // The connection's status/error is updated even when the sync fails.
    revalidatePath('/banking');
  }
}

// --- Plaid Link ---------------------------------------------------------------
// The browser only ever receives a short-lived link_token. The public_token
// it gets back from Link is exchanged here; the access_token stays on the
// server, encrypted at rest.

export async function createLinkTokenAction(
  reconnectConnectionId?: string,
): Promise<{ linkToken?: string; error?: string }> {
  const { user, business } = await requireContext('ACCOUNTANT');
  if (!isPlaidConfigured()) return { error: 'Plaid is not configured on this server.' };
  try {
    let accessToken: string | undefined;
    if (reconnectConnectionId) {
      const c = await prisma.bankConnection.findUnique({ where: { id: reconnectConnectionId } });
      if (!c || c.businessId !== business.id || c.provider !== 'plaid' || !c.accessTokenEncrypted || c.status === 'REMOVED') {
        return { error: 'Connection not found.' };
      }
      accessToken = decryptSecret(c.accessTokenEncrypted);
    }
    // client_user_id is our internal user id — never an email or name.
    return { linkToken: await createLinkToken({ clientUserId: user.id, accessToken }) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not start Plaid Link.' };
  }
}

export async function exchangePublicTokenAction(publicToken: string): Promise<ActionResult> {
  const { user, business } = await requireContext('ACCOUNTANT');
  if (!isPlaidConfigured()) return { error: 'Plaid is not configured on this server.' };
  if (typeof publicToken !== 'string' || !publicToken.startsWith('public-')) return { error: 'Invalid Link response.' };
  try {
    const { id } = await connectPlaidItem({ businessId: business.id, userId: user.id, publicToken });
    // First pull. Plaid may still be preparing history; the
    // SYNC_UPDATES_AVAILABLE webhook brings the rest.
    await syncConnection({ businessId: business.id, userId: user.id, connectionId: id, trigger: 'connect' }).catch(
      () => undefined,
    );
    revalidatePath('/banking');
    return {};
  } catch (err) {
    return errorResult(err);
  }
}

export async function markReconnectedAction(connectionId: string): Promise<ActionResult> {
  const { user, business } = await requireContext('ACCOUNTANT');
  try {
    await markReconnected({ businessId: business.id, userId: user.id, connectionId });
    await syncConnection({ businessId: business.id, userId: user.id, connectionId, trigger: 'manual' }).catch(
      () => undefined,
    );
    revalidatePath('/banking');
    return {};
  } catch (err) {
    return errorResult(err);
  }
}

export async function disconnectConnectionAction(connectionId: string): Promise<void> {
  const { user, business } = await requireContext('ACCOUNTANT');
  await disconnectConnection({ businessId: business.id, userId: user.id, connectionId });
  revalidatePath('/banking');
}

export async function remapAccountLinkAction(
  linkId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { user, business } = await requireContext('ACCOUNTANT');
  try {
    await remapAccountLink({
      businessId: business.id,
      userId: user.id,
      linkId,
      ledgerAccountId: String(formData.get('ledgerAccountId') ?? ''),
    });
    revalidatePath('/banking');
    return {};
  } catch (err) {
    return errorResult(err);
  }
}

export async function clearReviewFlagAction(transactionId: string): Promise<void> {
  const { user, business } = await requireContext('ACCOUNTANT');
  await clearReviewFlag({ businessId: business.id, userId: user.id, transactionId });
  revalidatePath('/banking');
}

export async function categorizeTxnAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await requireContext('ACCOUNTANT');
  try {
    const transactionId = String(formData.get('transactionId') ?? '');
    const categoryAccountId = String(formData.get('categoryAccountId') ?? '');
    const interestRaw = String(formData.get('interest') ?? '').trim();
    let splits: Array<{ accountId: string; amount: bigint }> | undefined;
    if (interestRaw) {
      // Loan payment: principal to the loan account, interest to Interest Expense.
      const txn = await prisma.importedTransaction.findUniqueOrThrow({ where: { id: transactionId }, include: { bankAccountLink: true } });
      const total = txn.amount < 0n ? -txn.amount : txn.amount;
      const interest = parseAmount(interestRaw, txn.bankAccountLink.currency);
      if (interest <= 0n || interest > total) return { error: 'Interest must be more than 0 and no more than the payment.' };
      const interestAccount = await ensureTemplateAccount(prisma, business.id, '7100');
      splits = [
        { accountId: categoryAccountId, amount: total - interest },
        { accountId: interestAccount.id, amount: interest },
      ];
    }
    await categorizeTransaction({
      businessId: business.id,
      userId: user.id,
      transactionId,
      categoryAccountId,
      splits,
      rememberPayee: formData.get('remember') === 'on',
    });
    revalidatePath('/banking');
    revalidatePath('/close');
    return {};
  } catch (err) {
    return errorResult(err);
  }
}

export async function matchTxnAction(transactionId: string, journalLineId: string): Promise<void> {
  const { user, business } = await requireContext('ACCOUNTANT');
  await matchTransaction({ businessId: business.id, userId: user.id, transactionId, journalLineId });
  revalidatePath('/banking');
}

export async function excludeTxnAction(transactionId: string): Promise<void> {
  const { user, business } = await requireContext('ACCOUNTANT');
  await excludeTransaction({ businessId: business.id, userId: user.id, transactionId });
  revalidatePath('/banking');
}

export async function createRuleAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await requireContext('ACCOUNTANT');
  const pattern = String(formData.get('pattern') ?? '').trim();
  const accountId = String(formData.get('accountId') ?? '');
  const matchType = String(formData.get('matchType') ?? 'CONTAINS') === 'REGEX' ? 'REGEX' : 'CONTAINS';
  const appliesToRaw = String(formData.get('appliesTo') ?? 'BOTH');
  const appliesTo = ['INFLOW', 'OUTFLOW'].includes(appliesToRaw)
    ? (appliesToRaw as 'INFLOW' | 'OUTFLOW')
    : 'BOTH';
  const priority = Number(formData.get('priority') ?? 100) || 100;
  if (!pattern) return { error: 'Pattern is required.' };
  if (!accountId) return { error: 'Pick the category account.' };
  if (matchType === 'REGEX') {
    try {
      new RegExp(pattern);
    } catch {
      return { error: 'Invalid regular expression.' };
    }
  }
  const rule = await prisma.categorizationRule.create({
    data: { businessId: business.id, pattern, matchType, appliesTo, accountId, priority },
  });
  await prisma.auditLog.create({
    data: {
      businessId: business.id,
      userId: user.id,
      action: 'categorization_rule.created',
      entityType: 'categorization_rule',
      entityId: rule.id,
      payload: { pattern, matchType, appliesTo },
    },
  });
  revalidatePath('/banking/rules');
  return {};
}

export async function deleteRuleAction(ruleId: string): Promise<void> {
  const { user, business } = await requireContext('ACCOUNTANT');
  const rule = await prisma.categorizationRule.findUniqueOrThrow({ where: { id: ruleId } });
  if (rule.businessId !== business.id) throw new Error('Wrong business.');
  await prisma.categorizationRule.delete({ where: { id: ruleId } });
  await prisma.auditLog.create({
    data: {
      businessId: business.id,
      userId: user.id,
      action: 'categorization_rule.deleted',
      entityType: 'categorization_rule',
      entityId: ruleId,
      payload: { pattern: rule.pattern },
    },
  });
  revalidatePath('/banking/rules');
}

export async function createReconciliationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await requireContext('ACCOUNTANT');
  try {
    const start = String(formData.get('statementStart') ?? '');
    const end = String(formData.get('statementEnd') ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return { error: 'Pick the statement period dates.' };
    }
    const session = await prisma.reconciliationSession.create({
      data: {
        businessId: business.id,
        ledgerAccountId: String(formData.get('ledgerAccountId') ?? ''),
        statementStart: new Date(start),
        statementEnd: new Date(end),
        startingBalance: parseAmount(String(formData.get('startingBalance') ?? '0'), business.functionalCurrency),
        endingBalance: parseAmount(String(formData.get('endingBalance') ?? '0'), business.functionalCurrency),
      },
    });
    await prisma.auditLog.create({
      data: {
        businessId: business.id,
        userId: user.id,
        action: 'reconciliation.started',
        entityType: 'reconciliation_session',
        entityId: session.id,
        payload: { period: `${start}..${end}` },
      },
    });
    revalidatePath('/banking/reconcile');
    redirect(`/banking/reconcile/${session.id}`);
  } catch (err) {
    return errorResult(err);
  }
}

export async function completeReconciliationAction(sessionId: string): Promise<void> {
  const { user, business } = await requireContext('ACCOUNTANT');
  await completeReconciliation({ businessId: business.id, userId: user.id, sessionId });
  revalidatePath(`/banking/reconcile/${sessionId}`);
  revalidatePath('/banking/reconcile');
}

/** Undo a categorization (reversal entry) and send the row back to review. */
export async function recategorizeTxnAction(transactionId: string): Promise<void> {
  const { user, business } = await requireContext('ACCOUNTANT');
  await recategorizeTransaction({ businessId: business.id, userId: user.id, transactionId });
  revalidatePath('/banking');
  revalidatePath('/close');
}

const MAX_STATEMENT_BYTES = 2 * 1024 * 1024;

export async function uploadStatementAction(_prev: ActionResult & { message?: string }, formData: FormData): Promise<ActionResult & { message?: string }> {
  const { user, business } = await requireContext('ACCOUNTANT');
  try {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { error: 'Choose the statement CSV file.' };
    if (file.size > MAX_STATEMENT_BYTES) return { error: 'That file is larger than 2 MB.' };
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (!isPdf && !/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      return { error: 'Upload the statement as a PDF or CSV file.' };
    }
    const target = String(formData.get('linkId') ?? '');
    const r = await importStatement({
      businessId: business.id,
      userId: user.id,
      fileName: file.name,
      ...(isPdf ? { pdf: new Uint8Array(await file.arrayBuffer()) } : { csvText: await file.text() }),
      openingBalance: String(formData.get('opening') ?? ''),
      closingBalance: String(formData.get('closing') ?? ''),
      positiveIsMoneyOut: formData.get('positiveIsMoneyOut') === 'on',
      ...(target && target !== 'new'
        ? { linkId: target }
        : {
            newAccount: {
              name: String(formData.get('newName') ?? ''),
              kind: formData.get('newKind') === 'credit' ? ('credit' as const) : ('depository' as const),
            },
          }),
    });
    revalidatePath('/banking');
    revalidatePath('/close');
    const sorted = r.auto ? r.auto.transfers * 2 + r.auto.rule + r.auto.merchant + r.auto.ai : 0;
    return { message: `Balance check passed. Imported ${r.imported} new transaction(s)${r.duplicates ? `, skipped ${r.duplicates} already on file` : ''}; ${sorted} sorted automatically.` };
  } catch (err) {
    return errorResult(err);
  }
}
