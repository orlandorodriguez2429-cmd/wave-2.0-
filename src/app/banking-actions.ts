'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentContext } from '@/lib/context';
import { connectBank, syncConnection } from '@/lib/banking/import';
import { categorizeTransaction, excludeTransaction, matchTransaction } from '@/lib/banking/categorize';
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
  const { user, business } = await getCurrentContext();
  const ledgerAccountId = String(formData.get('ledgerAccountId') ?? '');
  if (!ledgerAccountId) return { error: 'Pick the ledger account this bank feed maps to.' };
  try {
    const connection = await connectBank({
      businessId: business.id,
      userId: user.id,
      provider: 'mock',
      ledgerAccountId,
    });
    await syncConnection({ businessId: business.id, userId: user.id, connectionId: connection.id });
    revalidatePath('/banking');
    return {};
  } catch (err) {
    return errorResult(err);
  }
}

export async function syncConnectionAction(connectionId: string): Promise<void> {
  const { user, business } = await getCurrentContext();
  await syncConnection({ businessId: business.id, userId: user.id, connectionId });
  revalidatePath('/banking');
}

export async function categorizeTxnAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  try {
    await categorizeTransaction({
      businessId: business.id,
      userId: user.id,
      transactionId: String(formData.get('transactionId') ?? ''),
      categoryAccountId: String(formData.get('categoryAccountId') ?? ''),
    });
    revalidatePath('/banking');
    return {};
  } catch (err) {
    return errorResult(err);
  }
}

export async function matchTxnAction(transactionId: string, journalLineId: string): Promise<void> {
  const { user, business } = await getCurrentContext();
  await matchTransaction({ businessId: business.id, userId: user.id, transactionId, journalLineId });
  revalidatePath('/banking');
}

export async function excludeTxnAction(transactionId: string): Promise<void> {
  const { user, business } = await getCurrentContext();
  await excludeTransaction({ businessId: business.id, userId: user.id, transactionId });
  revalidatePath('/banking');
}

export async function createRuleAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
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
  const { user, business } = await getCurrentContext();
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
  const { user, business } = await getCurrentContext();
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
  const { user, business } = await getCurrentContext();
  await completeReconciliation({ businessId: business.id, userId: user.id, sessionId });
  revalidatePath(`/banking/reconcile/${sessionId}`);
  revalidatePath('/banking/reconcile');
}
