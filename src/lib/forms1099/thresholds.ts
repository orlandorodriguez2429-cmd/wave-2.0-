import { prisma } from '@/lib/db';

// Default per-tax-year thresholds, in cents. These are SEED DEFAULTS, stored
// in the tax_year_configs table and editable there — never hardcode them at
// call sites. Basis (verify against IRS.gov before each filing season):
//  - TY ≤ 2025: 1099-NEC/MISC minimum $600.
//  - TY 2026+: $2,000 (One Big Beautiful Bill Act change for payments made in
//    tax years beginning after 2025), inflation-indexed starting 2027 — the
//    2027 row keeps $2,000 as a placeholder until the IRS publishes the
//    adjusted figure.
//  - 1099-INT/DIV minimum $10.
//  - E-file mandate: 10+ combined information returns.
const DEFAULTS: Array<{
  taxYear: number;
  necMiscThreshold: bigint;
  intThreshold: bigint;
  divThreshold: bigint;
  efileMandateCount: number;
  notes: string;
}> = [
  { taxYear: 2024, necMiscThreshold: 60000n, intThreshold: 1000n, divThreshold: 1000n, efileMandateCount: 10, notes: '$600 NEC/MISC minimum.' },
  { taxYear: 2025, necMiscThreshold: 60000n, intThreshold: 1000n, divThreshold: 1000n, efileMandateCount: 10, notes: '$600 NEC/MISC minimum (last year before OBBBA increase).' },
  { taxYear: 2026, necMiscThreshold: 200000n, intThreshold: 1000n, divThreshold: 1000n, efileMandateCount: 10, notes: '$2,000 NEC/MISC minimum per OBBBA. VERIFY against IRS.gov before filing.' },
  { taxYear: 2027, necMiscThreshold: 200000n, intThreshold: 1000n, divThreshold: 1000n, efileMandateCount: 10, notes: 'Placeholder — inflation-adjusted amount not yet published. VERIFY before filing.' },
];

export async function getTaxYearConfig(taxYear: number) {
  const existing = await prisma.taxYearConfig.findUnique({ where: { taxYear } });
  if (existing) return existing;
  const fallback =
    DEFAULTS.find((d) => d.taxYear === taxYear) ??
    // Unknown future year: copy the latest known defaults but flag it.
    { ...DEFAULTS[DEFAULTS.length - 1], taxYear, notes: 'Auto-created from latest defaults — VERIFY thresholds against IRS.gov.' };
  return prisma.taxYearConfig.upsert({
    where: { taxYear },
    create: fallback,
    update: {},
  });
}

export function thresholdFor(
  config: { necMiscThreshold: bigint; intThreshold: bigint; divThreshold: bigint },
  key: 'necMisc' | 'int' | 'div',
): bigint {
  return key === 'necMisc' ? config.necMiscThreshold : key === 'int' ? config.intThreshold : config.divThreshold;
}
