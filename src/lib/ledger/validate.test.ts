import { describe, expect, it } from 'vitest';
import { EntryInput, normalBalance, signedBalance, validateEntryInput } from './validate';

const base = (overrides: Partial<EntryInput> = {}): EntryInput => ({
  date: new Date('2026-03-01'),
  memo: 'Test entry',
  currency: 'USD',
  exchangeRate: '1',
  lines: [
    { accountId: 'a1', direction: 'DEBIT', amount: 5000n },
    { accountId: 'a2', direction: 'CREDIT', amount: 5000n },
  ],
  ...overrides,
});

describe('validateEntryInput', () => {
  it('accepts a balanced two-line entry', () => {
    expect(() => validateEntryInput(base())).not.toThrow();
  });

  it('accepts balanced multi-line entries', () => {
    expect(() =>
      validateEntryInput(
        base({
          lines: [
            { accountId: 'a1', direction: 'DEBIT', amount: 3000n },
            { accountId: 'a2', direction: 'DEBIT', amount: 2000n },
            { accountId: 'a3', direction: 'CREDIT', amount: 5000n },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('rejects unbalanced entries', () => {
    expect(() =>
      validateEntryInput(
        base({
          lines: [
            { accountId: 'a1', direction: 'DEBIT', amount: 5000n },
            { accountId: 'a2', direction: 'CREDIT', amount: 4999n },
          ],
        }),
      ),
    ).toThrow(/unbalanced/i);
  });

  it('rejects single-line, zero-amount, and negative-amount entries', () => {
    expect(() =>
      validateEntryInput(base({ lines: [{ accountId: 'a1', direction: 'DEBIT', amount: 100n }] })),
    ).toThrow(/at least two lines/i);
    expect(() =>
      validateEntryInput(
        base({
          lines: [
            { accountId: 'a1', direction: 'DEBIT', amount: 0n },
            { accountId: 'a2', direction: 'CREDIT', amount: 0n },
          ],
        }),
      ),
    ).toThrow(/positive/i);
    expect(() =>
      validateEntryInput(
        base({
          lines: [
            { accountId: 'a1', direction: 'DEBIT', amount: -100n },
            { accountId: 'a2', direction: 'CREDIT', amount: -100n },
          ],
        }),
      ),
    ).toThrow(/positive/i);
  });

  it('rejects a missing memo or account', () => {
    expect(() => validateEntryInput(base({ memo: '   ' }))).toThrow(/memo/i);
    expect(() =>
      validateEntryInput(
        base({
          lines: [
            { accountId: '', direction: 'DEBIT', amount: 100n },
            { accountId: 'a2', direction: 'CREDIT', amount: 100n },
          ],
        }),
      ),
    ).toThrow(/pick an account/i);
  });
});

describe('normal balances', () => {
  it('debit-normal for assets/expenses, credit-normal otherwise', () => {
    expect(normalBalance('ASSET')).toBe('DEBIT');
    expect(normalBalance('EXPENSE')).toBe('DEBIT');
    expect(normalBalance('LIABILITY')).toBe('CREDIT');
    expect(normalBalance('EQUITY')).toBe('CREDIT');
    expect(normalBalance('INCOME')).toBe('CREDIT');
  });

  it('signedBalance follows normal balance', () => {
    expect(signedBalance('ASSET', 1000n, 300n)).toBe(700n);
    expect(signedBalance('INCOME', 100n, 900n)).toBe(800n);
    expect(signedBalance('LIABILITY', 900n, 100n)).toBe(-800n);
  });
});
