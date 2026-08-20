// Integer-only line math shared by invoices and estimates.
// Quantities are thousandths (2.5 → 2500n); tax rates are parts-per-million
// (8.875% → 88750). Rounding is half-up.

export function lineAmount(quantityMilli: bigint, unitPrice: bigint): bigint {
  return divRoundHalfUp(quantityMilli * unitPrice, 1000n);
}

export function taxAmount(amount: bigint, ratePpm: number): bigint {
  return divRoundHalfUp(amount * BigInt(ratePpm), 1_000_000n);
}

export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Denominator must be positive');
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const q = abs / denominator;
  const r = abs % denominator;
  const rounded = r * 2n >= denominator ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** Parse a quantity string ("2.5") into thousandths (2500n). */
export function parseQuantity(input: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(input.trim());
  if (!m) throw new Error(`Invalid quantity: "${input}" (up to 3 decimal places)`);
  const [, whole, frac = ''] = m;
  return BigInt(whole) * 1000n + BigInt(frac.padEnd(3, '0') || '0');
}

export function formatQuantity(quantityMilli: bigint): string {
  const whole = quantityMilli / 1000n;
  const frac = (quantityMilli % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}
