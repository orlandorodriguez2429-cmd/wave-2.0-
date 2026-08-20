'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentContext } from '@/lib/context';
import { createAndPostEntry, reverseEntry } from '@/lib/ledger/post';
import { LedgerValidationError } from '@/lib/ledger/validate';
import { parseAmount } from '@/lib/money';
import type { AccountType } from '@/generated/prisma/enums';

export interface ActionResult {
  error?: string;
}

const ACCOUNT_TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

export async function createAccountAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const type = String(formData.get('type') ?? '') as AccountType;
  const subtype = String(formData.get('subtype') ?? '').trim() || null;

  if (!/^\d{3,6}$/.test(code)) return { error: 'Account code must be 3–6 digits.' };
  if (!name) return { error: 'Account name is required.' };
  if (!ACCOUNT_TYPES.includes(type)) return { error: 'Pick an account type.' };

  const clash = await prisma.account.findUnique({
    where: { businessId_code: { businessId: business.id, code } },
  });
  if (clash) return { error: `Code ${code} is already used by "${clash.name}".` };

  const account = await prisma.account.create({
    data: { businessId: business.id, code, name, type, subtype },
  });
  await prisma.auditLog.create({
    data: {
      businessId: business.id,
      userId: user.id,
      action: 'account.created',
      entityType: 'account',
      entityId: account.id,
      payload: { code, name, type },
    },
  });
  revalidatePath('/accounts');
  return {};
}

export async function setAccountArchivedAction(accountId: string, archived: boolean): Promise<void> {
  const { user, business } = await getCurrentContext();
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  if (account.businessId !== business.id) throw new Error('Account not in current business.');
  if (account.isSystem && archived) throw new Error('System accounts cannot be archived.');

  await prisma.account.update({ where: { id: accountId }, data: { isArchived: archived } });
  await prisma.auditLog.create({
    data: {
      businessId: business.id,
      userId: user.id,
      action: archived ? 'account.archived' : 'account.unarchived',
      entityType: 'account',
      entityId: accountId,
      payload: { code: account.code, name: account.name },
    },
  });
  revalidatePath('/accounts');
}

// ---------------------------------------------------------------------------
// Journal entries
// ---------------------------------------------------------------------------

export async function createJournalEntryAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await getCurrentContext();

  const dateStr = String(formData.get('date') ?? '');
  const memo = String(formData.get('memo') ?? '');
  const currency = String(formData.get('currency') ?? business.functionalCurrency);
  const exchangeRate = String(formData.get('exchangeRate') ?? '1').trim() || '1';

  const accountIds = formData.getAll('lineAccountId').map(String);
  const directions = formData.getAll('lineDirection').map(String);
  const amounts = formData.getAll('lineAmount').map(String);
  const descriptions = formData.getAll('lineDescription').map(String);

  try {
    const lines = accountIds
      .map((accountId, i) => ({
        accountId,
        direction: directions[i] === 'CREDIT' ? ('CREDIT' as const) : ('DEBIT' as const),
        rawAmount: amounts[i]?.trim() ?? '',
        description: descriptions[i]?.trim() || undefined,
      }))
      // Ignore fully blank rows so an untouched extra row doesn't block submit.
      .filter((l) => l.accountId || l.rawAmount)
      .map((l, idx) => {
        if (!l.rawAmount) throw new LedgerValidationError(`Line ${idx + 1}: enter an amount.`);
        return {
          accountId: l.accountId,
          direction: l.direction,
          amount: parseAmount(l.rawAmount, currency),
          description: l.description,
        };
      });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return { error: 'Pick an entry date.' };
    }

    const entry = await createAndPostEntry({
      businessId: business.id,
      userId: user.id,
      input: { date: new Date(dateStr), memo, currency, exchangeRate, lines },
    });

    revalidatePath('/journal');
    revalidatePath('/');
    redirect(`/journal/${entry.id}`);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    if (err instanceof LedgerValidationError || err instanceof Error) {
      return { error: err instanceof LedgerValidationError ? err.message : err.message };
    }
    return { error: 'Failed to post entry.' };
  }
}

export async function reverseEntryAction(entryId: string): Promise<void> {
  const { user, business } = await getCurrentContext();
  await reverseEntry({ businessId: business.id, userId: user.id, entryId });
  revalidatePath('/journal');
  revalidatePath(`/journal/${entryId}`);
  revalidatePath('/');
}

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}
