import { describe, expect, it } from 'vitest';
import { formatQuantity, lineAmount, parseQuantity, taxAmount } from './totals';

describe('quantity parsing', () => {
  it('parses to thousandths', () => {
    expect(parseQuantity('1')).toBe(1000n);
    expect(parseQuantity('2.5')).toBe(2500n);
    expect(parseQuantity('0.125')).toBe(125n);
    expect(() => parseQuantity('1.2345')).toThrow();
    expect(() => parseQuantity('-1')).toThrow();
  });
  it('formats back', () => {
    expect(formatQuantity(2500n)).toBe('2.5');
    expect(formatQuantity(1000n)).toBe('1');
    expect(formatQuantity(125n)).toBe('0.125');
  });
});

describe('line math', () => {
  it('computes qty × price with half-up rounding', () => {
    expect(lineAmount(1000n, 4500_00n)).toBe(4500_00n);
    expect(lineAmount(2500n, 100_00n)).toBe(250_00n);
    // 0.333 × $1.00 = $0.333 → rounds to $0.33
    expect(lineAmount(333n, 100n)).toBe(33n);
    // 0.335 × $1.00 = $0.335 → rounds up to $0.34
    expect(lineAmount(335n, 100n)).toBe(34n);
  });

  it('computes ppm tax with half-up rounding', () => {
    // 8.875% of $100.00 = $8.875 → $8.88
    expect(taxAmount(100_00n, 88750)).toBe(888n);
    // 5% of $0.10 = $0.005 → $0.01
    expect(taxAmount(10n, 50000)).toBe(1n);
    expect(taxAmount(100_00n, 0)).toBe(0n);
  });
});
