// Pure validation of journal entry input — no database access, fully unit
// tested. The posting service re-runs this before touching the DB, and the
// Postgres posting-gate trigger enforces the same invariants as a backstop.

export interface EntryLineInput {
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  /** Minor units of the entry's transaction currency; must be > 0. */
  amount: bigint;
  description?: string;
}

export interface EntryInput {
  date: Date;
  memo: string;
  currency: string;
  /** Decimal string, e.g. "1" or "1.0850". Must be "1" for functional-currency entries. */
  exchangeRate: string;
  lines: EntryLineInput[];
}

export class LedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerValidationError';
  }
}

export function validateEntryInput(input: EntryInput): void {
  if (!input.memo.trim()) {
    throw new LedgerValidationError('Journal entries need a memo describing the transaction.');
  }
  if (Number.isNaN(input.date.getTime())) {
    throw new LedgerValidationError('Invalid entry date.');
  }
  if (input.lines.length < 2) {
    throw new LedgerValidationError('A journal entry needs at least two lines (a debit and a credit).');
  }

  let debits = 0n;
  let credits = 0n;
  for (const [i, line] of input.lines.entries()) {
    if (!line.accountId) {
      throw new LedgerValidationError(`Line ${i + 1}: pick an account.`);
    }
    if (line.amount <= 0n) {
      throw new LedgerValidationError(
        `Line ${i + 1}: amount must be positive — the debit/credit direction carries the sign.`,
      );
    }
    if (line.direction === 'DEBIT') debits += line.amount;
    else credits += line.amount;
  }

  if (debits !== credits) {
    throw new LedgerValidationError(
      `Entry is unbalanced: debits ${debits} ≠ credits ${credits} (minor units).`,
    );
  }
  if (debits === 0n) {
    throw new LedgerValidationError('Entry total cannot be zero.');
  }
}

/** Debit increases assets/expenses; credit increases liabilities/equity/income. */
export function normalBalance(type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'): 'DEBIT' | 'CREDIT' {
  return type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
}

/**
 * Signed balance from raw debit/credit sums, following the account's normal
 * balance: a healthy asset account reports positive, as does a healthy
 * liability account.
 */
export function signedBalance(
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE',
  debits: bigint,
  credits: bigint,
): bigint {
  return normalBalance(type) === 'DEBIT' ? debits - credits : credits - debits;
}
