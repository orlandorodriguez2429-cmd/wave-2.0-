import { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { EntrySource } from '@/generated/prisma/enums';
import { prisma } from '@/lib/db';
import { convertMinorUnits, currencyExponent } from '@/lib/money';
import { EntryInput, LedgerValidationError, validateEntryInput } from './validate';

type Tx = Prisma.TransactionClient | PrismaClient;

export interface PostEntryOptions {
  businessId: string;
  userId: string;
  input: EntryInput;
  source?: EntrySource;
  /** Set when this entry reverses a previously posted entry. */
  reversesId?: string;
  /**
   * Pre-computed functional-currency minor units, one per line. Used by
   * reversals to mirror the original's amounts exactly instead of re-deriving
   * them (re-deriving could allocate FX rounding to a different line and leave
   * a residue). The DB posting gate still verifies balance.
   */
  functionalAmounts?: bigint[];
}

/**
 * Create and post a balanced journal entry atomically.
 *
 * Inside one DB transaction: validates, converts each line to functional
 * currency, assigns the next sequential entry number, inserts the entry as
 * DRAFT plus its lines, flips it to POSTED (which fires the Postgres
 * posting-gate trigger re-checking balance), and writes an audit log row.
 */
export async function createAndPostEntry(opts: PostEntryOptions) {
  const { businessId, userId, input } = opts;
  validateEntryInput(input);

  return prisma.$transaction(async (tx) => {
    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });

    // Period-close lock: closed periods accept no new postings. Corrections
    // to a closed period are entered in the current (open) period instead.
    if (business.booksClosedThrough && input.date <= business.booksClosedThrough) {
      throw new LedgerValidationError(
        `The books are closed through ${business.booksClosedThrough.toISOString().slice(0, 10)} — ` +
          'post the entry in the open period or reopen the period first.',
      );
    }

    if (input.currency === business.functionalCurrency && input.exchangeRate.trim() !== '1') {
      throw new LedgerValidationError(
        'Entries in the functional currency must use an exchange rate of exactly 1.',
      );
    }

    const functionalAmounts =
      opts.functionalAmounts ?? computeFunctionalAmounts(input, business.functionalCurrency);
    if (functionalAmounts.length !== input.lines.length) {
      throw new LedgerValidationError('functionalAmounts must match the number of lines.');
    }

    // Atomic increment doubles as the business-row lock for numbering.
    const { nextEntryNumber } = await tx.business.update({
      where: { id: businessId },
      data: { nextEntryNumber: { increment: 1 } },
      select: { nextEntryNumber: true },
    });
    const entryNumber = nextEntryNumber - 1;

    const entry = await tx.journalEntry.create({
      data: {
        businessId,
        date: input.date,
        memo: input.memo.trim(),
        status: 'DRAFT',
        source: opts.source ?? 'MANUAL',
        currency: input.currency,
        exchangeRate: new Prisma.Decimal(input.exchangeRate),
        createdById: userId,
        reversesId: opts.reversesId,
        lines: {
          create: input.lines.map((line, i) => ({
            lineNo: i + 1,
            accountId: line.accountId,
            direction: line.direction,
            amount: line.amount,
            functionalAmount: functionalAmounts[i],
            description: line.description?.trim() || null,
          })),
        },
      },
    });

    const posted = await tx.journalEntry.update({
      where: { id: entry.id },
      data: { status: 'POSTED', entryNumber, postedAt: new Date() },
      include: { lines: true },
    });

    await tx.auditLog.create({
      data: {
        businessId,
        userId,
        action: opts.reversesId ? 'journal_entry.reversal_posted' : 'journal_entry.posted',
        entityType: 'journal_entry',
        entityId: posted.id,
        payload: {
          entryNumber,
          memo: posted.memo,
          date: input.date.toISOString().slice(0, 10),
          currency: input.currency,
          lineCount: input.lines.length,
          totalMinorUnits: input.lines
            .filter((l) => l.direction === 'DEBIT')
            .reduce((sum, l) => sum + l.amount, 0n)
            .toString(),
          ...(opts.reversesId ? { reversesId: opts.reversesId } : {}),
        },
      },
    });

    return posted;
  });
}

/**
 * Convert every line to functional-currency minor units. Per-line rounding can
 * leave debits and credits off by a few minor units; the difference is
 * absorbed by the largest line on the appropriate side so the functional view
 * balances exactly — standard FX rounding allocation.
 */
function computeFunctionalAmounts(input: EntryInput, functionalCurrency: string): bigint[] {
  const fromExp = currencyExponent(input.currency);
  const toExp = currencyExponent(functionalCurrency);
  const amounts = input.lines.map((line) =>
    convertMinorUnits(line.amount, input.exchangeRate, fromExp, toExp),
  );

  if (amounts.some((a) => a <= 0n)) {
    throw new LedgerValidationError(
      'Exchange rate is too small: a line rounds to zero in the functional currency.',
    );
  }

  let fDebits = 0n;
  let fCredits = 0n;
  input.lines.forEach((line, i) => {
    if (line.direction === 'DEBIT') fDebits += amounts[i];
    else fCredits += amounts[i];
  });

  const diff = fDebits - fCredits; // positive: debits too big OR credits too small
  if (diff !== 0n) {
    const tolerance = BigInt(input.lines.length); // at most 1 minor unit per line of rounding
    if (diff > tolerance || -diff > tolerance) {
      throw new LedgerValidationError(
        `Functional-currency conversion is off by ${diff} minor units — more than rounding can explain.`,
      );
    }
    // Shrink the largest line on the heavy side (never below 1).
    const heavySide = diff > 0n ? 'DEBIT' : 'CREDIT';
    const magnitude = diff > 0n ? diff : -diff;
    let target = -1;
    input.lines.forEach((line, i) => {
      if (line.direction === heavySide && (target === -1 || amounts[i] > amounts[target])) {
        target = i;
      }
    });
    if (target === -1 || amounts[target] - magnitude < 1n) {
      throw new LedgerValidationError('Cannot balance functional-currency rounding for this entry.');
    }
    amounts[target] -= magnitude;
  }

  return amounts;
}

/**
 * Reverse a posted entry: post a new entry with every debit/credit flipped,
 * linked to the original via `reversesId`. The original row is never touched.
 */
export async function reverseEntry(opts: {
  businessId: string;
  userId: string;
  entryId: string;
  /** Accounting date of the reversal; defaults to today. */
  date?: Date;
  memo?: string;
}) {
  const original = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: opts.entryId },
    include: { lines: { orderBy: { lineNo: 'asc' } }, reversedBy: { select: { id: true } } },
  });

  if (original.businessId !== opts.businessId) {
    throw new LedgerValidationError('Entry does not belong to this business.');
  }
  if (original.status !== 'POSTED') {
    throw new LedgerValidationError('Only posted entries can be reversed.');
  }
  if (original.reversedBy) {
    throw new LedgerValidationError('This entry has already been reversed.');
  }
  if (original.reversesId) {
    throw new LedgerValidationError(
      'This entry is itself a reversal; reverse the underlying original instead.',
    );
  }

  return createAndPostEntry({
    businessId: opts.businessId,
    userId: opts.userId,
    reversesId: original.id,
    source: 'SYSTEM',
    functionalAmounts: original.lines.map((line) => line.functionalAmount),
    input: {
      date: opts.date ?? new Date(),
      memo: opts.memo?.trim() || `Reversal of JE-${original.entryNumber}: ${original.memo}`,
      currency: original.currency,
      exchangeRate: original.exchangeRate.toString(),
      lines: original.lines.map((line) => ({
        accountId: line.accountId,
        direction: line.direction === 'DEBIT' ? ('CREDIT' as const) : ('DEBIT' as const),
        amount: line.amount,
        description: line.description ?? undefined,
      })),
    },
  });
}

export type { Tx };
