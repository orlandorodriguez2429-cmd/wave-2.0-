// Money is always an integer number of minor units (cents). These helpers
// convert between user-facing decimal strings and minor units without ever
// touching floating point.

/** ISO 4217 minor-unit exponents for currencies we expose in the UI. */
const CURRENCY_EXPONENTS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  MXN: 2,
  JPY: 0,
  CHF: 2,
  INR: 2,
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_EXPONENTS);

export function currencyExponent(currency: string): number {
  const exp = CURRENCY_EXPONENTS[currency];
  if (exp === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return exp;
}

/**
 * Parse a user-entered decimal amount ("1,234.56") into minor units (123456n).
 * Rejects anything that would lose precision. Never uses parseFloat.
 */
export function parseAmount(input: string, currency: string): bigint {
  const exp = currencyExponent(currency);
  const cleaned = input.trim().replace(/,/g, '');
  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) throw new Error(`Invalid amount: "${input}"`);
  const [, sign, whole, fracRaw = ''] = match;
  if (fracRaw.length > exp) {
    throw new Error(`Amount "${input}" has more decimal places than ${currency} allows (${exp})`);
  }
  const frac = fracRaw.padEnd(exp, '0');
  const minor = BigInt(whole) * 10n ** BigInt(exp) + BigInt(frac || '0');
  return sign ? -minor : minor;
}

/** Format minor units as a plain decimal string, e.g. 123456n -> "1234.56". */
export function formatAmount(minor: bigint, currency: string): string {
  const exp = currencyExponent(currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const base = 10n ** BigInt(exp);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(exp, '0');
  const body = exp > 0 ? `${whole}.${frac}` : whole.toString();
  return negative ? `-${body}` : body;
}

/** Format minor units with currency symbol/grouping for display, e.g. "$1,234.56". */
export function formatMoney(minor: bigint, currency: string): string {
  const exp = currencyExponent(currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const base = 10n ** BigInt(exp);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(exp, '0');
  // Group the integer part manually — Intl.NumberFormat would force us through
  // floats or its own bigint quirks; grouping a digit string is trivial.
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = exp > 0 ? `${grouped}.${frac}` : grouped;
  const formatted = `${currencySymbol(currency)}${body}`;
  return negative ? `-${formatted}` : formatted;
}

function currencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    CAD: 'CA$',
    AUD: 'A$',
    MXN: 'MX$',
    JPY: '¥',
    CHF: 'CHF ',
    INR: '₹',
  };
  return symbols[currency] ?? `${currency} `;
}

/**
 * Convert a transaction-currency amount to functional currency using a decimal
 * exchange-rate string (e.g. "1.0850"), with banker's-free half-up rounding,
 * entirely in integer arithmetic.
 */
export function convertMinorUnits(
  amount: bigint,
  rate: string,
  fromExponent: number,
  toExponent: number,
): bigint {
  const rateMatch = /^(\d+)(?:\.(\d*))?$/.exec(rate.trim());
  if (!rateMatch) throw new Error(`Invalid exchange rate: "${rate}"`);
  const [, whole, frac = ''] = rateMatch;
  const rateScale = BigInt(frac.length);
  const rateInt = BigInt(whole + frac);
  if (rateInt <= 0n) throw new Error('Exchange rate must be positive');

  // amount * rate * 10^(to - from), then divide by rate scale with half-up rounding.
  const expShift = BigInt(toExponent - fromExponent);
  let numerator = amount * rateInt;
  let denominator = 10n ** rateScale;
  if (expShift >= 0n) {
    numerator *= 10n ** expShift;
  } else {
    denominator *= 10n ** -expShift;
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}
