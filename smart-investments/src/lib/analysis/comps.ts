// Value estimate from county-recorded sales. This is an AS-IS market estimate:
// county data has no condition or photos, so it cannot tell a renovated sale from a
// fixer. The user adjusts the comp list and sets ARV themselves.

import type { SaleComp } from "@/lib/adapters/types";
import type { Confidence } from "@/lib/sourced";

export interface CompTier {
  radiusMiles: number;
  months: number;
  label: string;
}

/** Search widens in this order until at least MIN_COMPS market sales are found. */
export const COMP_TIERS: CompTier[] = [
  { radiusMiles: 0.5, months: 6, label: "within 0.5 mi, last 6 months" },
  { radiusMiles: 0.5, months: 12, label: "within 0.5 mi, last 12 months" },
  { radiusMiles: 1, months: 12, label: "within 1 mi, last 12 months" },
  { radiusMiles: 1, months: 18, label: "within 1 mi, last 18 months" },
];

export const MIN_COMPS = 3;
export const SQFT_BAND = 0.2;

/**
 * A recorded transfer counts as a market sale when the price is real money and not
 * far below the county's assessed value (which filters family and partial-interest deeds).
 */
export function isMarketSale(c: SaleComp): boolean {
  if (!(c.price >= 10_000)) return false;
  if (c.qualified === true) return true;
  if (c.qualified === false) return false;
  if (c.assessedValue !== null && c.price < 0.5 * c.assessedValue) return false;
  return true;
}

export function usableComps(subjectFolio: string, comps: SaleComp[]): SaleComp[] {
  return comps
    .filter((c) => c.folio !== subjectFolio && isMarketSale(c) && c.saleDate !== "")
    .sort((a, b) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99));
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface ValueEstimate {
  low: number | null;
  likely: number | null;
  high: number | null;
  /** Median price per unit of size (heated sq ft, or lot sq ft for land). */
  medianPerSqft: number | null;
  basis: "heated_sqft" | "lot_sqft" | "price_only";
  compCount: number;
  confidence: Confidence;
}

export function estimateValue(
  subject: { heatedSqft: number | null; lotSqft: number | null },
  comps: SaleComp[],
  tierIndex: number,
): ValueEstimate {
  const empty: ValueEstimate = {
    low: null,
    likely: null,
    high: null,
    medianPerSqft: null,
    basis: "price_only",
    compCount: comps.length,
    confidence: "low",
  };
  if (comps.length === 0) return empty;

  let basis: ValueEstimate["basis"] = "price_only";
  let size: number | null = null;
  if (subject.heatedSqft && comps.every((c) => c.heatedSqft)) {
    basis = "heated_sqft";
    size = subject.heatedSqft;
  } else if (!subject.heatedSqft && subject.lotSqft && comps.every((c) => c.lotSqft)) {
    basis = "lot_sqft";
    size = subject.lotSqft;
  }

  const ratios = comps
    .map((c) => {
      if (basis === "heated_sqft") return c.price / (c.heatedSqft as number);
      if (basis === "lot_sqft") return c.price / (c.lotSqft as number);
      return c.price;
    })
    .sort((a, b) => a - b);

  const mult = size ?? 1;
  let confidence: Confidence = "low";
  if (comps.length >= 5 && tierIndex === 0 && basis === "heated_sqft") confidence = "high";
  else if (comps.length >= MIN_COMPS && tierIndex <= 1 && basis !== "price_only") confidence = "medium";

  return {
    low: Math.round(percentile(ratios, 0.25) * mult),
    likely: Math.round(percentile(ratios, 0.5) * mult),
    high: Math.round(percentile(ratios, 0.75) * mult),
    medianPerSqft: basis === "price_only" ? null : percentile(ratios, 0.5),
    basis,
    compCount: comps.length,
    confidence,
  };
}

export function monthsAgoIso(months: number, today: Date = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, today.getUTCDate()));
  return d.toISOString().slice(0, 10);
}
