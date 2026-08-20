import { describe, expect, it } from 'vitest';
import { convertMinorUnits, formatAmount, formatMoney, parseAmount } from './money';

describe('parseAmount', () => {
  it('parses plain decimals into minor units', () => {
    expect(parseAmount('1234.56', 'USD')).toBe(123456n);
    expect(parseAmount('0.01', 'USD')).toBe(1n);
    expect(parseAmount('1,000,000.00', 'USD')).toBe(100000000n);
    expect(parseAmount('42', 'USD')).toBe(4200n);
  });

  it('handles zero-decimal currencies', () => {
    expect(parseAmount('500', 'JPY')).toBe(500n);
    expect(() => parseAmount('500.5', 'JPY')).toThrow(/decimal places/);
  });

  it('rejects precision loss and garbage', () => {
    expect(() => parseAmount('1.999', 'USD')).toThrow(/decimal places/);
    expect(() => parseAmount('12.3.4', 'USD')).toThrow(/Invalid amount/);
    expect(() => parseAmount('abc', 'USD')).toThrow(/Invalid amount/);
    expect(() => parseAmount('1e5', 'USD')).toThrow(/Invalid amount/);
  });

  it('survives amounts beyond Number.MAX_SAFE_INTEGER', () => {
    expect(parseAmount('92233720368547758.07', 'USD')).toBe(9223372036854775807n);
  });
});

describe('formatAmount / formatMoney', () => {
  it('round-trips with parseAmount', () => {
    expect(formatAmount(123456n, 'USD')).toBe('1234.56');
    expect(formatAmount(-5n, 'USD')).toBe('-0.05');
    expect(formatAmount(500n, 'JPY')).toBe('500');
  });

  it('formats display money with grouping', () => {
    expect(formatMoney(123456789n, 'USD')).toBe('$1,234,567.89');
    expect(formatMoney(-9900n, 'USD')).toBe('-$99.00');
    expect(formatMoney(1234n, 'JPY')).toBe('¥1,234');
  });
});

describe('convertMinorUnits', () => {
  it('applies decimal rates with half-up rounding, no floats', () => {
    // 100.00 EUR @ 1.0850 -> 108.50 USD
    expect(convertMinorUnits(10000n, '1.0850', 2, 2)).toBe(10850n);
    // 0.01 @ 0.5 -> 0.005 rounds to 0.01
    expect(convertMinorUnits(1n, '0.5', 2, 2)).toBe(1n);
    // 1000 JPY @ 0.0067 -> 6.70 USD (exponent shift 0 -> 2)
    expect(convertMinorUnits(1000n, '0.0067', 0, 2)).toBe(670n);
    // 10.00 USD -> JPY @ 149.32 (exponent shift 2 -> 0)
    expect(convertMinorUnits(1000n, '149.32', 2, 0)).toBe(1493n);
  });

  it('rejects invalid rates', () => {
    expect(() => convertMinorUnits(100n, '0', 2, 2)).toThrow(/positive/);
    expect(() => convertMinorUnits(100n, 'x', 2, 2)).toThrow(/Invalid exchange rate/);
  });
});
